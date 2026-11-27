// ===================================================================
// SUPABASE EDGE FUNCTION: purge-expired-photos
// PROJECT: Downtown Teknik – Güvenli 15 Günlük Fotoğraf Arşiv Temizliği
// DESCRIPTION:
//   Kapanmış (`closed` / `cancelled`) ve kapanış üzerinden en az 15 gün
//   geçmiş iş istekleri / iş emirlerinin `work-attachments` bucket'ındaki
//   fotoğraflarını RESMİ Supabase Storage `remove()` API ile siler; ardından
//   yalnızca Storage'dan kaldırılan kayıtların `public.attachments` satırlarını
//   temizler. `energy-documents` bucket'ına ve iş geçmişine kesinlikle dokunmaz.
//
// GÜVENLİK:
//   Yalnızca `X-Cron-Secret` (PHOTO_PURGE_CRON_SECRET) veya
//   `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>` ile çağrılabilir.
// ===================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

interface PurgeRequestBody {
  retentionDays?: number;
  batchLimit?: number;
  maxBatches?: number;
  dryRun?: boolean;
}

interface ExpiredAttachmentRow {
  attachment_id: string;
  file_path: string;
  ticket_id: string | null;
  work_order_id: string | null;
  closed_ref_at: string;
}

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function isAuthorized(req: Request, serviceRoleKey: string): boolean {
  const cronSecret = Deno.env.get('PHOTO_PURGE_CRON_SECRET') || '';
  const headerSecret = req.headers.get('x-cron-secret') || '';
  if (cronSecret && constantTimeEquals(headerSecret, cronSecret)) {
    return true;
  }

  const authHeader = req.headers.get('authorization') || '';
  const bearerPrefix = 'Bearer ';
  if (authHeader.startsWith(bearerPrefix)) {
    const token = authHeader.slice(bearerPrefix.length).trim();
    if (constantTimeEquals(token, serviceRoleKey)) {
      return true;
    }
  }

  return false;
}

Deno.serve(async (req: Request) => {
  const jsonHeaders = { 'Content-Type': 'application/json' };

  try {
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: jsonHeaders,
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    if (!supabaseUrl || !serviceRoleKey) {
      return new Response(
        JSON.stringify({ error: 'Sunucu Supabase ortam değişkenleri eksik.' }),
        { status: 500, headers: jsonHeaders }
      );
    }

    if (!isAuthorized(req, serviceRoleKey)) {
      return new Response(
        JSON.stringify({ error: 'Yetkisiz erişim.' }),
        { status: 401, headers: jsonHeaders }
      );
    }

    let body: PurgeRequestBody = {};
    try {
      const rawText = await req.text();
      if (rawText.trim()) body = JSON.parse(rawText) as PurgeRequestBody;
    } catch {
      return new Response(
        JSON.stringify({ error: 'Geçersiz JSON istek gövdesi.' }),
        { status: 400, headers: jsonHeaders }
      );
    }

    const retentionDays = Math.max(15, Number(body.retentionDays ?? 15) || 15);
    const batchLimit = Math.min(200, Math.max(1, Number(body.batchLimit ?? 100) || 100));
    const maxBatches = Math.min(20, Math.max(1, Number(body.maxBatches ?? 10) || 10));
    const dryRun = body.dryRun === true;

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    if (dryRun) {
      const { data, error } = await supabase.rpc('rpc_list_expired_closed_attachments', {
        p_retention_days: retentionDays,
        p_batch_limit: batchLimit,
      });
      if (error) throw error;
      const rows = (data as ExpiredAttachmentRow[]) ?? [];
      return new Response(
        JSON.stringify({
          ok: true,
          dryRun: true,
          retentionDays,
          bucket: 'work-attachments',
          candidateCount: rows.length,
          sampleIds: rows.slice(0, 10).map((r) => r.attachment_id),
        }),
        { status: 200, headers: jsonHeaders }
      );
    }

    let totalStorageRemoved = 0;
    let totalDbDeleted = 0;
    let batchesRun = 0;
    const errors: string[] = [];

    for (let batch = 0; batch < maxBatches; batch++) {
      const { data, error: listErr } = await supabase.rpc(
        'rpc_list_expired_closed_attachments',
        {
          p_retention_days: retentionDays,
          p_batch_limit: batchLimit,
        }
      );
      if (listErr) throw listErr;

      const rows = (data as ExpiredAttachmentRow[]) ?? [];
      if (rows.length === 0) break;
      batchesRun++;

      const validPaths = rows
        .map((r) => (r.file_path || '').trim())
        .filter((p) => p.length > 0);

      // 1. Önce resmi Storage API ile fiziksel dosyaları sil
      if (validPaths.length > 0) {
        const { data: removedData, error: removeErr } = await supabase.storage
          .from('work-attachments')
          .remove(validPaths);

        if (removeErr) {
          errors.push(`Batch ${batch + 1} storage remove hatası: ${removeErr.message}`);
          break;
        }
        totalStorageRemoved += Array.isArray(removedData)
          ? removedData.length
          : validPaths.length;
      }

      // 2. Storage API başarılı olduktan sonra ilgili public.attachments satırlarını sil
      const ids = rows.map((r) => r.attachment_id);
      const { data: deletedCount, error: delErr } = await supabase.rpc(
        'rpc_delete_purged_attachment_rows',
        { p_attachment_ids: ids }
      );

      if (delErr) {
        errors.push(`Batch ${batch + 1} DB delete hatası: ${delErr.message}`);
        break;
      }
      totalDbDeleted += Number(deletedCount ?? 0);

      if (rows.length < batchLimit) break;
    }

    return new Response(
      JSON.stringify({
        ok: errors.length === 0,
        dryRun: false,
        retentionDays,
        bucket: 'work-attachments',
        batchesRun,
        totalStorageRemoved,
        totalDbDeleted,
        errors,
      }),
      { status: errors.length === 0 ? 200 : 207, headers: jsonHeaders }
    );
  } catch (err: unknown) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      }),
      { status: 500, headers: jsonHeaders }
    );
  }
});

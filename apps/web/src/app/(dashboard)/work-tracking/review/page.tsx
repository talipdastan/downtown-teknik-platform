'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Camera, CheckCircle2, MessageSquare, RotateCcw } from 'lucide-react';
import { createClient } from '@/core/supabase/client';
import { useDebouncedRealtime } from '@/core/hooks/useDebouncedRealtime';
import { formatDateTime } from '@/core/constants';
import { useDashboardAuth } from '@/core/DashboardContext';
import { hasModulePermission } from '@/core/permissions';

type PhotoItem = {
  id: string;
  file_path: string;
  file_name: string | null;
  attachment_type: 'before' | 'after' | 'general';
  signedUrl?: string;
};

type CommentItem = {
  id: string;
  comment: string;
  created_at: string;
  profiles?: { full_name: string } | null;
};

type ReviewItem = {
  id: string;
  ticket_id: string;
  work_description: string | null;
  completed_at: string | null;
  departments?: { name: string } | null;
  tickets?: {
    id: string;
    ticket_number: string | null;
    description: string;
    custom_location: string | null;
    locations?: { name: string; floors?: { name: string } | null } | null;
    equipments?: { code: string; name: string } | null;
  } | null;
  photos: PhotoItem[];
  notes: CommentItem[];
};

export default function WorkTrackingReviewPage() {
  const { profile } = useDashboardAuth();
  const canApprove = hasModulePermission(profile, 'work_tracking', 'approve');

  const [items, setItems] = useState<ReviewItem[]>([]);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const loadPending = useCallback(async () => {
    setLoading(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('work_orders')
        .select(
          'id, ticket_id, work_description, completed_at, departments(name), tickets!inner(id, ticket_number, description, status, custom_location, locations(name, floors(name)), equipments(code, name))'
        )
        .eq('status', 'completed')
        .eq('tickets.status', 'resolved')
        .order('completed_at', { ascending: false })
        .limit(100);
      if (error) throw error;

      const raw = (data as unknown as Omit<ReviewItem, 'photos' | 'notes'>[]) ?? [];
      if (raw.length === 0) {
        setItems([]);
        return;
      }

      const ticketIds = Array.from(new Set(raw.map((r) => r.ticket_id)));
      const woIds = raw.map((r) => r.id);

      const [tAttRes, wAttRes, commRes] = await Promise.all([
        supabase
          .from('attachments')
          .select('id, ticket_id, work_order_id, file_path, file_name, attachment_type')
          .in('ticket_id', ticketIds),
        supabase
          .from('attachments')
          .select('id, ticket_id, work_order_id, file_path, file_name, attachment_type')
          .in('work_order_id', woIds),
        supabase
          .from('comments')
          .select('id, ticket_id, comment, created_at, profiles(full_name)')
          .in('ticket_id', ticketIds)
          .order('created_at', { ascending: true }),
      ]);

      const allAtts = [
        ...((tAttRes.data ?? []) as Array<
          PhotoItem & { ticket_id: string | null; work_order_id: string | null }
        >),
        ...((wAttRes.data ?? []) as Array<
          PhotoItem & { ticket_id: string | null; work_order_id: string | null }
        >),
      ];

      const signedMap = new Map<string, string>();
      if (allAtts.length > 0) {
        const paths = Array.from(new Set(allAtts.map((a) => a.file_path)));
        const { data: signed } = await supabase.storage
          .from('work-attachments')
          .createSignedUrls(paths, 3600);
        for (const s of signed ?? []) {
          if (s.path && s.signedUrl) signedMap.set(s.path, s.signedUrl);
        }
      }

      const allComments =
        (commRes.data as unknown as Array<CommentItem & { ticket_id: string }>) ?? [];

      setItems(
        raw.map((r) => {
          const itemPhotos = allAtts
            .filter((a) => a.ticket_id === r.ticket_id || a.work_order_id === r.id)
            .map((a) => ({
              id: a.id,
              file_path: a.file_path,
              file_name: a.file_name,
              attachment_type: a.attachment_type,
              signedUrl: signedMap.get(a.file_path),
            }));
          const itemNotes = allComments.filter((c) => c.ticket_id === r.ticket_id);
          return { ...r, photos: itemPhotos, notes: itemNotes };
        })
      );
    } catch (err) {
      setMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Onay bekleyen kayıtlar yüklenemedi.',
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPending();
  }, [loadPending]);

  useDebouncedRealtime({
    channelName: 'wt-review-live',
    tables: ['work_orders', 'tickets'],
    onRefresh: loadPending,
    delayMs: 500,
  });

  async function handleApprove(item: ReviewItem) {
    setBusyId(item.id);
    setMsg(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.rpc('rpc_manager_close_ticket', {
        p_ticket_id: item.ticket_id,
        p_resolution_note: 'Yönetici tarafından incelenip onaylanarak kapatıldı.',
        p_reopen: false,
      });
      if (error) throw error;
      setMsg({ type: 'ok', text: 'Arıza ve iş emri onaylanarak kapatıldı.' });
      await loadPending();
    } catch (err) {
      setMsg({ type: 'err', text: err instanceof Error ? err.message : 'Onay başarısız.' });
    } finally {
      setBusyId(null);
    }
  }

  async function handleReject(item: ReviewItem) {
    const reason = (reasons[item.id] ?? '').trim();
    if (!reason) {
      setMsg({ type: 'err', text: 'İade işleminde gerekçe yazılması zorunludur.' });
      return;
    }
    setBusyId(item.id);
    setMsg(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.rpc('rpc_manager_close_ticket', {
        p_ticket_id: item.ticket_id,
        p_resolution_note: reason,
        p_reopen: true,
      });
      if (error) throw error;
      setMsg({ type: 'ok', text: 'İş emri gerekçesiyle birlikte teknisyene iade edildi.' });
      await loadPending();
    } catch (err) {
      setMsg({ type: 'err', text: err instanceof Error ? err.message : 'İade başarısız.' });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href="/work-tracking/work-orders"
            className="text-xs font-bold text-turquoise hover:underline"
          >
            ← İş Emirlerine Dön
          </Link>
          <h1 className="mt-1 text-2xl font-extrabold text-slate-900">
            Çözüm Onay ve Kapatma
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Teknisyenlerin tamamladığı işleri önce/sonra fotoğrafları ve notlarıyla inceleyip
            onaylayın veya iade edin.
          </p>
        </div>

        <span className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2 text-xs font-extrabold text-amber-800">
          Onay Bekleyen: {items.length}
        </span>
      </div>

      {msg && (
        <div
          className={`rounded-xl border p-3 text-sm font-medium ${
            msg.type === 'ok'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-red-200 bg-red-50 text-red-700'
          }`}
        >
          {msg.text}
        </div>
      )}

      {items.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
          {loading ? 'Yükleniyor...' : 'Onay bekleyen tamamlanmış iş emri bulunmuyor.'}
        </div>
      ) : (
        <div className="space-y-4">
          {items.map((item) => {
            const loc = item.tickets?.locations?.name
              ? `${
                  item.tickets.locations.floors?.name
                    ? `${item.tickets.locations.floors.name} - `
                    : ''
                }${item.tickets.locations.name}`
              : item.tickets?.custom_location ?? '-';
            return (
              <div
                key={item.id}
                className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 pb-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-base font-extrabold text-navy">
                        {item.tickets?.ticket_number ?? '-'}
                      </span>
                      <span className="rounded-full bg-navy-soft px-2.5 py-0.5 text-xs font-bold text-navy">
                        {item.departments?.name ?? '-'}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      Konum: <strong className="text-slate-700">{loc}</strong>
                      {item.tickets?.equipments
                        ? ` · Ekipman: ${item.tickets.equipments.code} - ${item.tickets.equipments.name}`
                        : ''}
                      {item.completed_at
                        ? ` · Tamamlanma: ${formatDateTime(item.completed_at)}`
                        : ''}
                    </div>
                  </div>
                </div>

                <p className="text-sm text-slate-700">{item.tickets?.description ?? '-'}</p>

                {/* Önce / Sonra Fotoğrafları */}
                {item.photos.length > 0 && (
                  <div>
                    <div className="mb-2 flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider text-navy">
                      <Camera className="h-3.5 w-3.5 text-turquoise" />
                      Fotoğraflar ({item.photos.length})
                    </div>
                    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-6">
                      {item.photos.map((p) => (
                        <a
                          key={p.id}
                          href={p.signedUrl || '#'}
                          target="_blank"
                          rel="noreferrer"
                          className="overflow-hidden rounded-xl border border-slate-200 bg-canvas"
                        >
                          {p.signedUrl ? (
                            <img
                              src={p.signedUrl}
                              alt={p.file_name || 'Fotoğraf'}
                              className="h-24 w-full object-cover"
                            />
                          ) : (
                            <div className="flex h-24 items-center justify-center text-[11px] text-slate-400">
                              Önizleme Yok
                            </div>
                          )}
                          <div className="px-2 py-1 text-[10px] font-bold">
                            <span
                              className={`rounded px-1.5 py-0.5 ${
                                p.attachment_type === 'before'
                                  ? 'bg-amber-100 text-amber-800'
                                  : p.attachment_type === 'after'
                                  ? 'bg-emerald-100 text-emerald-700'
                                  : 'bg-slate-200 text-slate-700'
                              }`}
                            >
                              {p.attachment_type === 'before'
                                ? 'Önce'
                                : p.attachment_type === 'after'
                                ? 'Sonra'
                                : 'Genel'}
                            </span>
                          </div>
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                {/* Teknisyen Notları */}
                {item.notes.length > 0 && (
                  <div className="rounded-xl border border-slate-200 bg-canvas p-3">
                    <div className="mb-1.5 flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider text-navy">
                      <MessageSquare className="h-3.5 w-3.5 text-turquoise" />
                      Tamamlanma & Süreç Notları
                    </div>
                    <div className="space-y-1">
                      {item.notes.map((n) => (
                        <div key={n.id} className="text-xs text-slate-700">
                          <span className="font-bold text-slate-900">
                            {n.profiles?.full_name || 'Personel'}:
                          </span>{' '}
                          {n.comment}{' '}
                          <span className="text-[11px] text-slate-400">
                            ({formatDateTime(n.created_at)})
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {canApprove && (
                  <div className="flex flex-col gap-2 pt-1 sm:flex-row">
                    <input
                      type="text"
                      placeholder="İade gerekçesi (yalnızca iade edilecekse)..."
                      value={reasons[item.id] ?? ''}
                      onChange={(e) =>
                        setReasons((prev) => ({ ...prev, [item.id]: e.target.value }))
                      }
                      className="flex-1 rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm focus:border-navy focus:outline-none"
                    />
                    <button
                      type="button"
                      disabled={busyId === item.id}
                      onClick={() => handleReject(item)}
                      className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-xs font-bold text-red-700 hover:bg-red-100 disabled:opacity-50"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      İade Et
                    </button>
                    <button
                      type="button"
                      disabled={busyId === item.id}
                      onClick={() => handleApprove(item)}
                      className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Onayla ve Kapat
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

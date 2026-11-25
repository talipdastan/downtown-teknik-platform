// =====================================================================
// SUPABASE EDGE FUNCTION: parse-energy-document
// PROJECT: AVM TECH – Enerji Takip Modülü
// DESCRIPTION: Gemini destekli PDF Fatura ve Bütçe analiz servisi.
// GÜVENLİK: GEMINI_API_KEY yalnızca sunucu ortam değişkeninden (Secret)
//   okunur; çağıran kullanıcının 'energy.manage' yetkisi doğrulanır.
// =====================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface MeterFilterHint {
  name: string;
  meterNo?: string | null;
  contractNo?: string | null;
  eicCode?: string | null;
  tekilCode?: string | null;
  subscriberNo?: string | null;
}

interface ParseRequest {
  mode: 'invoices' | 'budgets';
  pdfBase64?: string;
  storagePath?: string;
  fastMode?: boolean;
  onlyRegisteredMeters?: boolean;
  registeredMeters?: MeterFilterHint[];
  targetYear?: number;
}

const FALLBACK_MODELS = [
  'gemini-3.5-flash-lite',
  'gemini-3.5-flash',
  'gemini-flash-lite-latest',
  'gemini-flash-latest',
  'gemini-2.5-flash',
];

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function base64ToUint8Array(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function buildInvoicesPrompt(onlyRegistered: boolean, meters: MeterFilterHint[]): string {
  const filters = meters
    .map((m) => {
      const parts: string[] = [];
      if (m.eicCode) parts.push(`EIC:${m.eicCode}`);
      if (m.tekilCode) parts.push(`Tekil:${m.tekilCode}`);
      if (m.subscriberNo) parts.push(`Abone:${m.subscriberNo}`);
      if (m.meterNo) parts.push(`Sayaç:${m.meterNo}`);
      if (m.contractNo) parts.push(`Sözleşme:${m.contractNo}`);
      return parts.length ? `- ${m.name} (${parts.join(', ')})` : null;
    })
    .filter((x): x is string => Boolean(x));

  const filterInstruction =
    onlyRegistered && filters.length > 0
      ? `\nÖNEMLİ FİLTRE KURALI:\nSadece aşağıdaki kayıtlı sayaçlardan birine (EIC, Tekil Kod, Abone No, Sayaç No veya Sözleşme No ile) eşleşen faturaları JSON dizisine ekle. Bu liste dışındaki harici faturaları tamamen ATLA:\n${filters.join('\n')}\n`
      : '';

  return `Sen bir AVM enerji ve fatura veri çıkarma uzmanısın. Ekteki PDF dosyasında elektrik (Aras Elektrik, Uludağ Elektrik vb.), doğalgaz (Aksa Doğalgaz vb.) ve su (BUSKİ vb.) faturaları bulunmaktadır. Dosya çok sayfalı olabilir ve her sayfa ayrı bir faturaya ait olabilir.
${filterInstruction}
Uygun HER BİR faturayı ayrı bir JSON nesnesi olarak çıkar ve sadece geçerli bir JSON dizisi (array) döndür.

Her fatura nesnesi şu alanları içermelidir:
- "provider": string (Örn: "Aras Elektrik", "Uludağ Elektrik", "Aksa Doğalgaz", "BUSKİ")
- "utilityType": string ("electric", "gas", veya "water")
- "invoiceType": string (Normal tüketim faturası ise "normal", gecikme zammı / sadece faiz faturası ise "late_fee")
- "invoiceNo": string veya null (Fatura No / Fatura Sıra No)
- "invoiceDate": string veya null ("YYYY-MM-DD" formatında Fatura Tarihi)
- "year": integer (Fatura dönem yılı, örn: 2026)
- "month": integer (1-12 arası fatura dönem ayı)
- "meterNo": string veya null (Sayaç No; başındaki "-" işaretini kaldır)
- "contractNo": string veya null (Sözleşme No, Tesisat No veya Sözleşme Hesabı No)
- "subscriberNo": string veya null (Abone Numarası / Abone No)
- "eicCode": string veya null (Elektrik faturalarında EIC kodu)
- "tekilCode": string veya null (Elektrik faturalarında Tekil Kod)
- "addressHint": string veya null (Adresteki blok/pano ipucu, örn: "GT-ADP-1", "KAZAN", "HAVUZ")
- "consumption": number (Toplam tüketim miktarı kWh veya m³; gecikme zammında 0)
- "amountTL": number (Ödenecek Toplam Tutar TL, ondalık nokta ile)
- "inductivePenaltyTL": number (Endüktif ceza bedeli TL, yoksa 0)
- "capacitivePenaltyTL": number (Net kapasitif ceza bedeli TL, yoksa 0)

Kurallar:
1. Türkçe sayılardaki binlik ayırıcı noktayı kaldır, ondalık virgülü noktaya çevir.
2. Sadece JSON array döndür, markdown veya açıklama ekleme. Eşleşen fatura yoksa [] döndür.`;
}

function buildBudgetsPrompt(targetYear: number): string {
  return `Sen bir AVM bütçe veri çıkarma uzmanısın. Ekteki PDF dosyasında Elektrik, Doğalgaz ve Su için aylık bütçe ve/veya önceki yıl gerçekleşen verileri bulunmaktadır.

PDF içindeki tüm aylık bütçe verilerini sadece geçerli bir JSON dizisi (array) olarak döndür.
Her eleman şu formatta olmalıdır:
- "utilityType": "electric" | "gas" | "water"
- "month": integer (1=Ocak, 2=Şubat, ..., 12=Aralık)
- "budgetConsumption": number (${targetYear} bütçelenen kW veya m³, yoksa 0)
- "budgetTL": number (${targetYear} bütçelenen TL tutarı, yoksa 0)
- "prevYearConsumption": number (${targetYear - 1} gerçekleşen kW veya m³, yoksa 0)
- "prevYearTL": number (${targetYear - 1} gerçekleşen TL tutarı, yoksa 0)

Kurallar:
1. Türkçe sayılardaki binlik ayırıcı noktayı kaldır, ondalık virgülü noktaya çevir.
2. Yalnızca en az bir değeri > 0 olan ayları döndür.
3. Sadece JSON array döndür, markdown veya açıklama ekleme.`;
}

async function tryUploadBinary(pdfBytes: Uint8Array, apiKey: string): Promise<string | null> {
  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/upload/v1beta/files?uploadType=media&key=${apiKey}`,
      { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: pdfBytes }
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    return data?.file?.uri ? String(data.file.uri) : null;
  } catch {
    return null;
  }
}

function extractJsonArray(rawText: string): unknown[] {
  let clean = rawText.trim();
  if (clean.startsWith('```')) {
    clean = clean.replace(/^```[a-zA-Z]*\n?/, '').replace(/```$/, '').trim();
  }
  const start = clean.indexOf('[');
  const end = clean.lastIndexOf(']');
  if (start >= 0 && end > start) {
    clean = clean.slice(start, end + 1);
  }
  const parsed = JSON.parse(clean);
  if (!Array.isArray(parsed)) throw new Error('Gemini çıktısı JSON dizisi değil.');
  return parsed;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const geminiApiKey = Deno.env.get('GEMINI_API_KEY');
    const authHeader = req.headers.get('Authorization');

    if (!supabaseUrl || !supabaseAnonKey) {
      return jsonResponse({ error: 'Sunucu Supabase yapılandırması eksik.' }, 500);
    }
    if (!authHeader) {
      return jsonResponse({ error: 'Yetkilendirme başlığı eksik.' }, 401);
    }
    if (!geminiApiKey) {
      return jsonResponse({ error: 'Sunucuda GEMINI_API_KEY tanımlı değil.' }, 500);
    }

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) {
      return jsonResponse({ error: 'Geçersiz oturum.' }, 401);
    }

    const { data: canManage, error: permErr } = await userClient.rpc('has_module_permission', {
      p_module: 'energy',
      p_permission: 'manage',
    });
    if (permErr || canManage !== true) {
      return jsonResponse({ error: 'Erişim engellendi: Enerji yönetim yetkiniz yok.' }, 403);
    }

    const body = (await req.json()) as ParseRequest;
    let pdfBytes: Uint8Array | null = null;
    let base64Data = body.pdfBase64?.trim() ?? '';

    if (!base64Data && body.storagePath) {
      const { data: fileBlob, error: dlErr } = await userClient.storage
        .from('energy-documents')
        .download(body.storagePath);
      if (dlErr || !fileBlob) {
        return jsonResponse({ error: 'Storage üzerinden PDF indirilemedi.' }, 400);
      }
      pdfBytes = new Uint8Array(await fileBlob.arrayBuffer());
      base64Data = uint8ArrayToBase64(pdfBytes);
    } else if (base64Data) {
      pdfBytes = base64ToUint8Array(base64Data);
    }

    if (!pdfBytes || pdfBytes.length === 0) {
      return jsonResponse({ error: 'PDF verisi boş.' }, 400);
    }

    const prompt =
      body.mode === 'budgets'
        ? buildBudgetsPrompt(body.targetYear ?? new Date().getFullYear())
        : buildInvoicesPrompt(body.onlyRegisteredMeters ?? true, body.registeredMeters ?? []);

    const fastMode = body.fastMode ?? true;
    const uploadedUri = pdfBytes.length > 1024 * 1024 ? await tryUploadBinary(pdfBytes, geminiApiKey) : null;
    const pdfPart = uploadedUri
      ? { fileData: { mimeType: 'application/pdf', fileUri: uploadedUri } }
      : { inlineData: { mimeType: 'application/pdf', data: base64Data } };

    let lastError = 'Gemini API yanıt vermedi.';
    for (const model of FALLBACK_MODELS) {
      const genConfig: Record<string, unknown> = {
        temperature: 0.0,
        responseMimeType: 'application/json',
        mediaResolution: fastMode ? 'MEDIA_RESOLUTION_LOW' : 'MEDIA_RESOLUTION_MEDIUM',
      };
      if (model.includes('gemini-2.5')) {
        genConfig.thinkingConfig = { thinkingBudget: 0 };
      }

      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }, pdfPart] }],
            generationConfig: genConfig,
          }),
        }
      );

      if (!resp.ok) {
        lastError = `HTTP ${resp.status}: ${await resp.text()}`;
        continue;
      }

      const data = await resp.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text || typeof text !== 'string') {
        lastError = 'Model boş içerik döndürdü.';
        continue;
      }

      const items = extractJsonArray(text);
      return jsonResponse({ items, modelUsed: model });
    }

    return jsonResponse({ error: `PDF analiz edilemedi: ${lastError}` }, 502);
  } catch (err) {
    return jsonResponse(
      { error: err instanceof Error ? err.message : String(err) },
      500
    );
  }
});

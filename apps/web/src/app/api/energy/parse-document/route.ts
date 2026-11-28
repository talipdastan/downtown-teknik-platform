import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

const FALLBACK_MODELS = [
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-flash-latest',
  'gemini-flash-lite-latest',
  'gemini-2.5-flash',
];

async function discoverAvailableModels(apiKey: string): Promise<string[]> {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`
    );
    if (!res.ok) return [];
    const data = await res.json();
    const rawModels = Array.isArray(data?.models)
      ? (data.models as Array<{ name?: string; supportedGenerationMethods?: string[] }>)
      : [];

    const candidates = rawModels
      .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
      .map((m) => String(m.name ?? '').replace(/^models\//, ''))
      .filter(
        (name) =>
          name.startsWith('gemini-') &&
          !name.includes('tts') &&
          !name.includes('image') &&
          !name.includes('audio') &&
          !name.includes('embedding') &&
          !name.includes('robotics')
      );

    // Flash modellerini önceliklendir
    candidates.sort((a, b) => {
      const aFlash = a.includes('flash') ? 0 : 1;
      const bFlash = b.includes('flash') ? 0 : 1;
      if (aFlash !== bFlash) return aFlash - bFlash;
      return b.localeCompare(a);
    });

    return candidates;
  } catch {
    return [];
  }
}

type MeterHint = {
  name: string;
  meterNo?: string | null;
  contractNo?: string | null;
  eicCode?: string | null;
  tekilCode?: string | null;
  subscriberNo?: string | null;
};

function buildInvoicesPrompt(onlyRegistered: boolean, meters: MeterHint[]): string {
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
      ? `\nÖNEMLİ FİLTRE KURALI:\nSadece aşağıdaki kayıtlı sayaçlardan birine eşleşen faturaları JSON dizisine ekle, harici faturaları atla:\n${filters.join('\n')}\n`
      : '';

  return `Sen bir AVM enerji fatura analiz uzmanısın. Ekteki PDF dosyasındaki elektrik, doğalgaz ve su faturalarını çıkar.
${filterInstruction}
Sadece geçerli bir JSON dizisi (array) döndür. Her eleman şu alanlara sahip olsun:
- "provider": string
- "utilityType": "electric" | "gas" | "water"
- "invoiceType": "normal" | "late_fee"
- "invoiceNo": string | null
- "invoiceDate": "YYYY-MM-DD" | null
- "year": integer
- "month": integer (1-12)
- "meterNo": string | null
- "contractNo": string | null
- "subscriberNo": string | null
- "eicCode": string | null
- "tekilCode": string | null
- "addressHint": string | null
- "consumption": number
- "amountTL": number
- "inductivePenaltyTL": number
- "capacitivePenaltyTL": number

Kurallar: Binlik ayırıcı noktayı kaldır, ondalık virgülü noktaya çevir. Markdown veya açıklama ekleme, sadece JSON array döndür.`;
}

function buildBudgetsPrompt(targetYear: number): string {
  return `Sen bir AVM enerji bütçe analiz uzmanısın. Ekteki PDF dosyasındaki Elektrik, Doğalgaz ve Su için aylık bütçe ve/veya önceki yıl verilerini çıkar.
Sadece geçerli bir JSON dizisi (array) döndür. Her eleman şu alanlara sahip olsun:
- "utilityType": "electric" | "gas" | "water"
- "month": integer (1-12)
- "budgetConsumption": number (${targetYear} bütçe miktarı, yoksa 0)
- "budgetTL": number (${targetYear} bütçe tutarı TL, yoksa 0)
- "prevYearConsumption": number (önceki yıl tüketim, yoksa 0)
- "prevYearTL": number (önceki yıl tutar TL, yoksa 0)

Kurallar: Türkçe sayılarda binlik noktayı kaldır, ondalık virgülü noktaya çevir. Sadece JSON array döndür.`;
}

function extractJsonArray(rawText: string): unknown[] {
  const cleaned = rawText
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) return [];
  const parsed = JSON.parse(cleaned.slice(start, end + 1));
  return Array.isArray(parsed) ? parsed : [];
}

function isInvalidApiKeyError(status: number, errText: string): boolean {
  if (status === 401 || status === 403) return true;
  if (status === 400) {
    return /API_KEY_INVALID|API key not valid/i.test(errText);
  }
  return false;
}

async function generateWithModel(
  model: string,
  apiKey: string,
  prompt: string,
  pdfBase64: string
): Promise<
  | { ok: true; items: unknown[]; modelUsed: string }
  | { ok: false; fatalStatus?: number; errorText: string }
> {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { text: prompt },
            { inline_data: { mime_type: 'application/pdf', data: pdfBase64 } },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: 'application/json',
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    if (isInvalidApiKeyError(res.status, errText)) {
      return {
        ok: false,
        fatalStatus: res.status,
        errorText: `Gemini API anahtarı geçersiz veya yetkisiz (${res.status}).`,
      };
    }
    return {
      ok: false,
      errorText: `Gemini (${model}) HTTP ${res.status}: ${errText.slice(0, 220)}`,
    };
  }

  const json = await res.json();
  const text =
    json?.candidates?.[0]?.content?.parts
      ?.map((p: { text?: string }) => p.text ?? '')
      .join('\n') ?? '[]';

  const items = extractJsonArray(text);
  return { ok: true, items, modelUsed: model };
}

export async function POST(req: NextRequest) {
  try {
    // Oturum doğrulaması: yetkisiz çağrıların sunucu Gemini kotasını tüketmesini engeller
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (supabaseUrl && supabaseAnonKey) {
      const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
        cookies: {
          getAll() {
            return req.cookies.getAll();
          },
          setAll() {
            // API route salt-okunur oturum doğrulaması
          },
        },
      });
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        return NextResponse.json(
          { error: 'Bu işlem için oturum açmanız gerekiyor.' },
          { status: 401 }
        );
      }
    }

    const body = await req.json();
    const headerKey = req.headers.get('x-gemini-api-key')?.trim();
    const apiKey = process.env.GEMINI_API_KEY?.trim() || headerKey;

    if (!apiKey) {
      return NextResponse.json(
        {
          error:
            'Gemini API anahtarı tanımlı değil. Lütfen sayfadaki "Gemini API Ayarı" bölümüne anahtarınızı girin veya apps/web/.env.local dosyasına GEMINI_API_KEY ekleyin.',
        },
        { status: 400 }
      );
    }

    const pdfBase64 = String(body.pdfBase64 || body.fileBase64 || '').trim();
    if (!pdfBase64) {
      return NextResponse.json(
        { error: 'PDF dosya içeriği bulunamadı.' },
        { status: 400 }
      );
    }

    const mode = body.mode === 'budgets' ? 'budgets' : 'invoices';
    const targetYear = Number(body.targetYear || body.year) || new Date().getFullYear();
    const prompt =
      mode === 'budgets'
        ? buildBudgetsPrompt(targetYear)
        : buildInvoicesPrompt(
            Boolean(body.onlyRegisteredMeters),
            Array.isArray(body.registeredMeters) ? body.registeredMeters : []
          );

    let lastErr = 'Gemini API yanıt vermedi.';
    const tried = new Set<string>();

    for (const model of FALLBACK_MODELS) {
      tried.add(model);
      const attempt = await generateWithModel(model, apiKey, prompt, pdfBase64);
      if (attempt.ok) {
        return NextResponse.json({ items: attempt.items, modelUsed: attempt.modelUsed });
      }
      if (attempt.fatalStatus) {
        return NextResponse.json(
          { error: attempt.errorText },
          { status: attempt.fatalStatus }
        );
      }
      lastErr = attempt.errorText;
    }

    // Statik listedeki modeller başarısız olursa (ör. 404), API anahtarının erişebildiği modelleri keşfet
    const discovered = await discoverAvailableModels(apiKey);
    for (const model of discovered) {
      if (tried.has(model)) continue;
      tried.add(model);
      const attempt = await generateWithModel(model, apiKey, prompt, pdfBase64);
      if (attempt.ok) {
        return NextResponse.json({ items: attempt.items, modelUsed: attempt.modelUsed });
      }
      if (attempt.fatalStatus) {
        return NextResponse.json(
          { error: attempt.errorText },
          { status: attempt.fatalStatus }
        );
      }
      lastErr = attempt.errorText;
    }

    return NextResponse.json({ error: lastErr }, { status: 502 });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : 'PDF analiz sırasında beklenmeyen hata.',
      },
      { status: 500 }
    );
  }
}

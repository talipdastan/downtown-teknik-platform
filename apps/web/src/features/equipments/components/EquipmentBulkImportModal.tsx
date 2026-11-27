'use client';

import { useMemo, useState } from 'react';
import { FileSpreadsheet, Upload, X } from 'lucide-react';
import { createClient } from '@/core/supabase/client';
import { Department } from '@/types/database';

type ParsedEquipRow = {
  code: string;
  name: string;
  equipment_type: string;
  brand: string | null;
  model: string | null;
  serial_number: string | null;
};

const VALID_TYPES = new Set([
  'chiller',
  'ahu',
  'generator',
  'transformer',
  'panel',
  'pump',
  'elevator',
  'escalator',
  'boiler',
  'meter',
  'other',
]);

function normalizeType(raw: string): string {
  const s = raw.trim().toLowerCase();
  if (VALID_TYPES.has(s)) return s;
  if (s.includes('chiller') || s.includes('soğut')) return 'chiller';
  if (s.includes('klima') || s.includes('ahu')) return 'ahu';
  if (s.includes('jenerat')) return 'generator';
  if (s.includes('trafo')) return 'transformer';
  if (s.includes('pano')) return 'panel';
  if (s.includes('pompa') || s.includes('hidrofor')) return 'pump';
  if (s.includes('asans')) return 'elevator';
  if (s.includes('merdiven') || s.includes('yürüyen')) return 'escalator';
  if (s.includes('kazan') || s.includes('boiler')) return 'boiler';
  if (s.includes('sayaç') || s.includes('sayac')) return 'meter';
  return 'other';
}

export function parseEquipmentBulkText(raw: string): ParsedEquipRow[] {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const out: ParsedEquipRow[] = [];
  for (let i = 0; i < lines.length; i++) {
    const sep = lines[i].includes('\t') ? '\t' : lines[i].includes(';') ? ';' : ',';
    const cols = lines[i].split(sep).map((c) => c.trim().replace(/^"|"$/g, ''));
    if (cols.length < 2) continue;
    const code = cols[0].toUpperCase();
    const name = cols[1];
    if (!code || !name) continue;
    // Başlık satırını atla
    if (i === 0 && (code === 'KOD' || code === 'CODE' || name.toLowerCase() === 'ad')) {
      continue;
    }
    out.push({
      code,
      name,
      equipment_type: normalizeType(cols[2] ?? 'other'),
      brand: cols[3] || null,
      model: cols[4] || null,
      serial_number: cols[5] || null,
    });
  }
  return out;
}

export function EquipmentBulkImportModal({
  open,
  departments,
  currentUserId,
  onClose,
  onImported,
}: {
  open: boolean;
  departments: Department[];
  currentUserId?: string | null;
  onClose: () => void;
  onImported: (count: number) => void;
}) {
  const [rawText, setRawText] = useState(
    'CHL-01;Chiller Grubu 1;chiller;Carrier;30XA;SN-001\nJEN-01;Ana Jeneratör 1250 kVA;generator;Aksa;APD-1250;SN-002\nYNG-01;Elektrikli Yangın Pompası;pump;Mas-Daf;ENM;SN-003'
  );
  const [defaultDeptId, setDefaultDeptId] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const parsed = useMemo(() => parseEquipmentBulkText(rawText), [rawText]);

  if (!open) return null;

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const text = await f.text();
    setRawText(text);
    e.target.value = '';
  }

  async function handleImport(e: React.FormEvent) {
    e.preventDefault();
    if (parsed.length === 0) return;
    setSaving(true);
    setErr(null);
    try {
      const supabase = createClient();
      const payload = parsed.map((r) => ({
        code: r.code,
        name: r.name,
        equipment_type: r.equipment_type,
        department_id: defaultDeptId || null,
        brand: r.brand,
        model: r.model,
        serial_number: r.serial_number,
        status: 'active',
        is_active: true,
        created_by: currentUserId ?? null,
      }));
      const { error } = await supabase
        .from('equipments')
        .upsert(payload, { onConflict: 'code' });
      if (error) throw error;
      onImported(payload.length);
      onClose();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Toplu ekipman aktarımı başarısız.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <form
        onSubmit={handleImport}
        className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl bg-white shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-emerald-600" />
            <div>
              <h2 className="text-base font-extrabold text-navy">
                Toplu Ekipman İçe Aktar (Excel / CSV)
              </h2>
              <p className="text-xs text-slate-500">
                Sütun sırası: <code>Kod ; Ekipman Adı ; Tür ; Marka ; Model ; Seri No</code>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-xs font-bold text-navy hover:bg-slate-100">
              <Upload className="h-3.5 w-3.5" />
              CSV / TXT Dosyası Yükle
              <input
                type="file"
                accept=".csv,.tsv,.txt"
                onChange={handleFileChange}
                className="hidden"
              />
            </label>
            <select
              value={defaultDeptId}
              onChange={(e) => setDefaultDeptId(e.target.value)}
              className="rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-xs font-semibold text-slate-700"
            >
              <option value="">Varsayılan Departman (Opsiyonel)</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>

          <textarea
            rows={7}
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            placeholder="Excel'den kopyalayıp doğrudan buraya yapıştırabilirsiniz..."
            className="w-full rounded-xl border border-slate-200 bg-canvas p-3 font-mono text-xs"
          />

          <div className="rounded-xl border border-slate-200 bg-canvas p-3 text-xs">
            <div className="font-extrabold text-navy">
              Önizleme: {parsed.length} ekipman aktarılmaya hazır
            </div>
            {parsed.slice(0, 5).map((r) => (
              <div key={r.code} className="mt-1 text-slate-600">
                • <strong>{r.code}</strong> — {r.name} ({r.equipment_type})
                {r.brand ? ` · ${r.brand}` : ''}
              </div>
            ))}
            {parsed.length > 5 && (
              <div className="mt-1 text-slate-400">... ve {parsed.length - 5} kayıt daha</div>
            )}
          </div>

          {err && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-700">
              {err}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-600"
          >
            Vazgeç
          </button>
          <button
            type="submit"
            disabled={saving || parsed.length === 0}
            className="rounded-xl bg-navy px-5 py-2 text-xs font-bold text-white hover:bg-navy-hover disabled:opacity-50"
          >
            {saving ? 'Aktarılıyor...' : `${parsed.length} Ekipmanı Kaydet`}
          </button>
        </div>
      </form>
    </div>
  );
}

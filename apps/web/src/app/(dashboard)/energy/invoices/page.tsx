'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  FileDown,
  FileSpreadsheet,
  KeyRound,
  Pencil,
  Plus,
  SlidersHorizontal,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { createClient } from '@/core/supabase/client';
import {
  ENERGY_BUDGET_SELECT,
  ENERGY_INVOICE_SELECT,
  METER_SELECT,
} from '@/core/supabase/selects';
import { useDashboardAuth } from '@/core/DashboardContext';
import { hasModulePermission } from '@/core/permissions';
import {
  exportExcelWorkbook,
  exportPrintablePdf,
} from '@/core/utils/report-export';
import {
  buildEnergyExcelWorkbook,
  buildEnergyPdfReportOptions,
  createDefaultEnergyReportConfig,
} from '@/core/utils/energy-report-builder';
import EnergyReportWizardModal from '@/components/energy/EnergyReportWizardModal';
import { EnergyBudget, EnergyInvoice, Meter } from '@/types/database';

const MONTHS = [
  'Tüm Yıl',
  'Ocak',
  'Şubat',
  'Mart',
  'Nisan',
  'Mayıs',
  'Haziran',
  'Temmuz',
  'Ağustos',
  'Eylül',
  'Ekim',
  'Kasım',
  'Aralık',
];

const GEMINI_STORAGE_KEY = 'avm_tech_gemini_api_key';

type ParsedDraft = {
  provider: string;
  utilityType: 'electric' | 'gas' | 'water';
  invoiceType: 'normal' | 'late_fee';
  invoiceNo?: string | null;
  invoiceDate?: string | null;
  year: number;
  month: number;
  meterNo?: string | null;
  contractNo?: string | null;
  subscriberNo?: string | null;
  eicCode?: string | null;
  tekilCode?: string | null;
  addressHint?: string | null;
  consumption: number;
  amountTL: number;
  inductivePenaltyTL: number;
  capacitivePenaltyTL: number;
  selected: boolean;
  matchedMeterId?: string | null;
  meterName: string;
};

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function utilityLabel(t: string) {
  if (t === 'electric') return 'Elektrik';
  if (t === 'gas') return 'Doğalgaz';
  if (t === 'water') return 'Su';
  return t;
}

export default function EnergyInvoicesPage() {
  const { profile } = useDashboardAuth();
  const canManage = hasModulePermission(profile, 'energy', 'manage');
  const canDelete = hasModulePermission(profile, 'energy', 'delete') || canManage;
  const canReports = hasModulePermission(profile, 'energy', 'reports');

  const queryClient = useQueryClient();
  const [year, setYear] = useState(new Date().getFullYear());
  const [monthFilter, setMonthFilter] = useState(0); // 0 = Tüm Yıl
  const [utilityFilter, setUtilityFilter] = useState<'all' | 'electric' | 'gas' | 'water'>('all');
  const [showReportWizard, setShowReportWizard] = useState(false);
  const [drafts, setDrafts] = useState<ParsedDraft[]>([]);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Gemini API Anahtarı Ayarı
  const [geminiKey, setGeminiKey] = useState('');
  const [showKeyPanel, setShowKeyPanel] = useState(false);

  // Seçili faturalar (toplu silme)
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Manuel Ekleme / Düzenleme Modalı
  const [editModal, setEditModal] = useState<{
    mode: 'create' | 'edit';
    id?: string;
    period_year: number;
    period_month: number;
    utility_type: 'electric' | 'gas' | 'water';
    provider: string;
    invoice_no: string;
    invoice_date: string;
    meter_id: string;
    meter_name: string;
    consumption: string;
    amount_tl: string;
    inductive_penalty_tl: string;
    capacitive_penalty_tl: string;
    tenant_amount_tl: string;
  } | null>(null);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(GEMINI_STORAGE_KEY);
      if (saved) setGeminiKey(saved);
    } catch {
      // ignore
    }
  }, []);

  const { data: invoicesData } = useQuery({
    queryKey: ['energy', 'invoices', year],
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const supabase = createClient();
      const [invRes, mRes, bRes] = await Promise.all([
        supabase
          .from('energy_invoices')
          .select(ENERGY_INVOICE_SELECT)
          .eq('period_year', year)
          .order('period_month', { ascending: false })
          .order('meter_name'),
        supabase.from('meters').select(METER_SELECT).eq('is_active', true).order('name'),
        supabase.from('energy_budgets').select(ENERGY_BUDGET_SELECT).eq('period_year', year),
      ]);
      if (invRes.error) throw invRes.error;
      return {
        invoices: (invRes.data as EnergyInvoice[]) ?? [],
        meters: (mRes.data as Meter[]) ?? [],
        budgets: (bRes.data as EnergyBudget[]) ?? [],
      };
    },
  });

  const invoices = useMemo(() => invoicesData?.invoices ?? [], [invoicesData]);
  const meters = useMemo(() => invoicesData?.meters ?? [], [invoicesData]);
  const budgets = useMemo(() => invoicesData?.budgets ?? [], [invoicesData]);

  useEffect(() => {
    setSelectedIds([]);
  }, [year]);

  const loadAll = async () => {
    setSelectedIds([]);
    await queryClient.invalidateQueries({ queryKey: ['energy', 'invoices', year] });
  };

  function saveGeminiKey() {
    try {
      const cleaned = geminiKey.trim();
      if (cleaned) {
        window.localStorage.setItem(GEMINI_STORAGE_KEY, cleaned);
        setMsg({ type: 'ok', text: 'Gemini API anahtarı tarayıcıya kaydedildi.' });
      } else {
        window.localStorage.removeItem(GEMINI_STORAGE_KEY);
        setMsg({ type: 'ok', text: 'Tarayıcıdaki Gemini API anahtarı temizlendi.' });
      }
      setShowKeyPanel(false);
    } catch {
      setMsg({ type: 'err', text: 'Anahtar kaydedilemedi.' });
    }
  }

  async function handlePdfUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setParsing(true);
    setMsg(null);
    try {
      const buf = await file.arrayBuffer();
      const res = await fetch('/api/energy/parse-document', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(geminiKey.trim() ? { 'x-gemini-api-key': geminiKey.trim() } : {}),
        },
        body: JSON.stringify({
          mode: 'invoices',
          onlyRegisteredMeters: true,
          pdfBase64: arrayBufferToBase64(buf),
          registeredMeters: meters.map((m) => ({
            name: m.name,
            meterNo: m.meter_no,
            contractNo: m.contract_no,
            eicCode: m.eic_code,
            tekilCode: m.tekil_code,
            subscriberNo: m.subscriber_no,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 400 || res.status === 401 || res.status === 403) {
          setShowKeyPanel(true);
        }
        throw new Error(data?.error || 'PDF analiz edilemedi.');
      }

      const rawItems = Array.isArray(data?.items) ? data.items : [];
      const mapped: ParsedDraft[] = rawItems.map((it: Record<string, unknown>) => {
        const eic = String(it.eicCode ?? '').trim().toUpperCase();
        const tekil = String(it.tekilCode ?? '').trim();
        const mno = String(it.meterNo ?? '').trim();
        const matched =
          meters.find((m) => eic && m.eic_code?.toUpperCase() === eic) ??
          meters.find((m) => tekil && m.tekil_code === tekil) ??
          meters.find((m) => mno && m.meter_no === mno);
        return {
          provider: String(it.provider ?? 'Bilinmeyen'),
          utilityType: (it.utilityType as ParsedDraft['utilityType']) ?? 'electric',
          invoiceType: (it.invoiceType as ParsedDraft['invoiceType']) ?? 'normal',
          invoiceNo: it.invoiceNo ? String(it.invoiceNo) : null,
          invoiceDate: it.invoiceDate ? String(it.invoiceDate) : null,
          year: Number(it.year) || year,
          month: Number(it.month) || 1,
          meterNo: mno || null,
          contractNo: it.contractNo ? String(it.contractNo) : null,
          subscriberNo: it.subscriberNo ? String(it.subscriberNo) : null,
          eicCode: eic || null,
          tekilCode: tekil || null,
          addressHint: it.addressHint ? String(it.addressHint) : null,
          consumption: Number(it.consumption) || 0,
          amountTL: Number(it.amountTL) || 0,
          inductivePenaltyTL: Number(it.inductivePenaltyTL) || 0,
          capacitivePenaltyTL: Number(it.capacitivePenaltyTL) || 0,
          selected: true,
          matchedMeterId: matched?.id ?? null,
          meterName: matched?.name ?? String(it.addressHint ?? it.provider ?? 'Sayaç'),
        };
      });
      setDrafts(mapped);
      setMsg({
        type: 'ok',
        text: `${mapped.length} fatura taslağı çıkarıldı (${data.modelUsed ?? 'Gemini'}).`,
      });
    } catch (err) {
      setMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'PDF analiz edilemedi.',
      });
    } finally {
      setParsing(false);
      e.target.value = '';
    }
  }

  async function saveDrafts() {
    const selected = drafts.filter((d) => d.selected);
    if (selected.length === 0) return;
    setSaving(true);
    setMsg(null);
    try {
      const supabase = createClient();
      const { data: uRes } = await supabase.auth.getUser();
      const uid = uRes.user?.id ?? null;
      let userName = 'Yönetici';
      if (uid) {
        const { data: prof } = await supabase
          .from('profiles')
          .select('full_name')
          .eq('id', uid)
          .single();
        if (prof?.full_name) userName = prof.full_name;
      }

      const { error } = await supabase.from('energy_invoices').insert(
        selected.map((d) => ({
          period_year: d.year,
          period_month: d.month,
          utility_type: d.utilityType,
          provider: d.provider,
          invoice_no: d.invoiceNo,
          invoice_date: d.invoiceDate,
          invoice_type: d.invoiceType,
          meter_id: d.matchedMeterId,
          meter_name: d.meterName,
          meter_no: d.meterNo,
          contract_no: d.contractNo,
          eic_code: d.eicCode,
          tekil_code: d.tekilCode,
          subscriber_no: d.subscriberNo,
          consumption: d.consumption,
          amount_tl: d.amountTL,
          inductive_penalty_tl: d.utilityType === 'electric' ? d.inductivePenaltyTL : 0,
          capacitive_penalty_tl: d.utilityType === 'electric' ? d.capacitivePenaltyTL : 0,
          notes: d.addressHint,
          entered_by_id: uid,
          entered_by_name: userName,
        }))
      );
      if (error) throw error;
      setDrafts([]);
      setMsg({ type: 'ok', text: `${selected.length} fatura kaydedildi.` });
      await loadAll();
    } catch (err) {
      setMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Kaydedilemedi.',
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveModal(e: React.FormEvent) {
    e.preventDefault();
    if (!editModal) return;
    setSaving(true);
    setMsg(null);
    try {
      const supabase = createClient();
      const payload = {
        period_year: editModal.period_year,
        period_month: editModal.period_month,
        utility_type: editModal.utility_type,
        provider: editModal.provider.trim(),
        invoice_no: editModal.invoice_no.trim() || null,
        invoice_date: editModal.invoice_date || null,
        meter_id: editModal.meter_id || null,
        meter_name: editModal.meter_name.trim() || 'Genel',
        consumption: Number(editModal.consumption) || 0,
        amount_tl: Number(editModal.amount_tl) || 0,
        inductive_penalty_tl:
          editModal.utility_type === 'electric' ? Number(editModal.inductive_penalty_tl) || 0 : 0,
        capacitive_penalty_tl:
          editModal.utility_type === 'electric' ? Number(editModal.capacitive_penalty_tl) || 0 : 0,
        tenant_amount_tl:
          editModal.tenant_amount_tl !== '' ? Number(editModal.tenant_amount_tl) : null,
      };

      if (editModal.mode === 'edit' && editModal.id) {
        const { error } = await supabase
          .from('energy_invoices')
          .update(payload)
          .eq('id', editModal.id);
        if (error) throw error;
        setMsg({ type: 'ok', text: 'Fatura güncellendi.' });
      } else {
        const { data: uRes } = await supabase.auth.getUser();
        const uid = uRes.user?.id ?? null;
        const { error } = await supabase.from('energy_invoices').insert({
          ...payload,
          invoice_type: 'normal',
          entered_by_id: uid,
          entered_by_name: 'Yönetici',
        });
        if (error) throw error;
        setMsg({ type: 'ok', text: 'Yeni fatura eklendi.' });
      }
      setEditModal(null);
      await loadAll();
    } catch (err) {
      setMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'İşlem başarısız.',
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteOne(inv: EnergyInvoice) {
    if (
      !window.confirm(
        `${inv.meter_name} (${MONTHS[inv.period_month]} ${inv.period_year} - ${fmtTl(inv.amount_tl)} ₺) faturasını silmek istiyor musunuz?`
      )
    ) {
      return;
    }
    setMsg(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.from('energy_invoices').delete().eq('id', inv.id);
      if (error) throw error;
      setMsg({ type: 'ok', text: 'Fatura silindi.' });
      await loadAll();
    } catch (err) {
      setMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Fatura silinemedi.',
      });
    }
  }

  async function handleDeleteSelected() {
    if (selectedIds.length === 0) return;
    if (
      !window.confirm(
        `Seçili ${selectedIds.length} faturayı kalıcı olarak silmek istediğinize emin misiniz?`
      )
    ) {
      return;
    }
    setMsg(null);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from('energy_invoices')
        .delete()
        .in('id', selectedIds);
      if (error) throw error;
      setMsg({ type: 'ok', text: `${selectedIds.length} fatura silindi.` });
      await loadAll();
    } catch (err) {
      setMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Toplu silme başarısız.',
      });
    }
  }

  const filteredInvoices = invoices.filter((inv) => {
    if (monthFilter !== 0 && inv.period_month !== monthFilter) return false;
    if (utilityFilter !== 'all' && inv.utility_type !== utilityFilter) return false;
    return true;
  });

  const isNonElectricOnly = utilityFilter === 'gas' || utilityFilter === 'water';
  const totalAmount = filteredInvoices.reduce((s, i) => s + Number(i.amount_tl || 0), 0);
  const totalPenalty = filteredInvoices.reduce(
    (s, i) =>
      i.utility_type === 'electric'
        ? s + Number(i.inductive_penalty_tl || 0) + Number(i.capacitive_penalty_tl || 0)
        : s,
    0
  );

  function handleExportExcel() {
    const cfg = createDefaultEnergyReportConfig({
      year,
      monthFilter,
      utilityFilter,
      defaultPreset: 'executive',
    });
    exportExcelWorkbook(buildEnergyExcelWorkbook(invoices, budgets, cfg));
  }

  function handleExportPdf() {
    const cfg = createDefaultEnergyReportConfig({
      year,
      monthFilter,
      utilityFilter,
      defaultPreset: 'executive',
    });
    exportPrintablePdf(buildEnergyPdfReportOptions(invoices, budgets, cfg));
  }

  const fmtTl = (n: number) =>
    new Intl.NumberFormat('tr-TR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n);

  return (
    <div className="space-y-5">
      {/* Başlık + Dönem Seçici + Rapor & Ekle */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400">
            FATURA YÖNETİMİ & AI ANALİZ
          </div>
          <h1 className="mt-0.5 text-2xl font-extrabold text-slate-900">
            Faturalar & PDF Analizi
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Gemini API ile PDF fatura analizi, ay bazlı raporlama, düzenleme ve silme.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canManage && (
            <>
              <button
                type="button"
                onClick={() => setShowKeyPanel((v) => !v)}
                className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-bold transition ${
                  geminiKey
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : 'border-amber-200 bg-amber-50 text-amber-800'
                }`}
              >
                <KeyRound className="h-3.5 w-3.5" />
                <span>{geminiKey ? 'Gemini API Bağlı' : 'Gemini API Ayarla'}</span>
              </button>
              <button
                type="button"
                onClick={() =>
                  setEditModal({
                    mode: 'create',
                    period_year: year,
                    period_month: monthFilter || new Date().getMonth() + 1,
                    utility_type: 'electric',
                    provider: '',
                    invoice_no: '',
                    invoice_date: new Date().toISOString().slice(0, 10),
                    meter_id: '',
                    meter_name: '',
                    consumption: '0',
                    amount_tl: '0',
                    inductive_penalty_tl: '0',
                    capacitive_penalty_tl: '0',
                    tenant_amount_tl: '',
                  })
                }
                className="inline-flex items-center gap-1.5 rounded-xl bg-navy px-3.5 py-2 text-xs font-bold text-white hover:bg-navy-hover"
              >
                <Plus className="h-4 w-4" />
                <span>Manuel Fatura</span>
              </button>
            </>
          )}
          {canReports && (
            <>
              <button
                type="button"
                onClick={() => setShowReportWizard(true)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-turquoise px-3.5 py-2 text-xs font-extrabold text-white shadow-sm transition hover:bg-cyan-800"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                <span>Rapor Sihirbazı (Tarih &amp; Veri Seç)</span>
              </button>
              <button
                type="button"
                onClick={handleExportExcel}
                disabled={filteredInvoices.length === 0}
                className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800 hover:bg-emerald-100 disabled:opacity-40"
              >
                <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-700" />
                <span>Hızlı Excel (.xls)</span>
              </button>
              <button
                type="button"
                onClick={handleExportPdf}
                disabled={filteredInvoices.length === 0}
                className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-800 hover:bg-rose-100 disabled:opacity-40"
              >
                <FileDown className="h-3.5 w-3.5 text-rose-700" />
                <span>Hızlı PDF</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Gemini API Ayar Paneli */}
      {canManage && showKeyPanel && (
        <div className="rounded-2xl border border-navy/20 bg-white p-4 shadow-sm">
          <div className="text-xs font-extrabold uppercase tracking-wider text-navy">
            Gemini API Anahtarı Yapılandırması
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Google AI Studio (aistudio.google.com) üzerinden aldığınız Gemini API anahtarını girin. Anahtar sunucu rotasına güvenli şekilde iletilir.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <input
              type="password"
              placeholder="AIza..."
              value={geminiKey}
              onChange={(e) => setGeminiKey(e.target.value)}
              className="min-w-[260px] flex-1 rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm"
            />
            <button
              type="button"
              onClick={saveGeminiKey}
              className="rounded-xl bg-turquoise px-4 py-2 text-xs font-bold text-white hover:bg-cyan-800"
            >
              Anahtarı Kaydet
            </button>
          </div>
        </div>
      )}

      {msg && (
        <div
          className={`rounded-xl border p-3 text-sm ${
            msg.type === 'ok'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-red-200 bg-red-50 text-red-700'
          }`}
        >
          {msg.text}
        </div>
      )}

      {/* PDF Fatura Analiz Kutusu */}
      {canManage && (
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-extrabold text-navy">
              PDF Fatura Yükle ve Gemini ile Analiz Et
            </div>
            <div className="text-xs text-slate-500">
              Çok sayfalı elektrik, doğalgaz ve su faturalarını otomatik ayrıştırır.
            </div>
          </div>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-turquoise px-4 py-2 text-xs font-bold text-white hover:bg-cyan-800">
            <Upload className="h-4 w-4" />
            <span>{parsing ? 'Analiz Ediliyor...' : 'PDF Dosyası Seç'}</span>
            <input
              type="file"
              accept="application/pdf"
              disabled={parsing}
              onChange={handlePdfUpload}
              className="hidden"
            />
          </label>
        </div>

        {drafts.length > 0 && (
          <div className="mt-4 space-y-2 border-t border-slate-100 pt-4">
            {drafts.map((d, idx) => (
              <label
                key={idx}
                className="flex items-center justify-between rounded-xl border border-slate-200 bg-canvas/50 p-3 text-sm"
              >
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={d.selected}
                    onChange={(e) =>
                      setDrafts((prev) =>
                        prev.map((item, i) =>
                          i === idx ? { ...item, selected: e.target.checked } : item
                        )
                      )
                    }
                  />
                  <div>
                    <div className="font-bold text-navy">
                      {d.meterName} ({utilityLabel(d.utilityType)} · {MONTHS[d.month]} {d.year})
                    </div>
                    <div className="text-xs text-slate-500">
                      {d.provider} · {d.consumption} {d.utilityType === 'electric' ? 'kWh' : 'm³'}
                      {d.utilityType === 'electric'
                        ? ` · Ceza: ${fmtTl(d.inductivePenaltyTL + d.capacitivePenaltyTL)} ₺`
                        : ''}
                    </div>
                  </div>
                </div>
                <div className="font-extrabold text-slate-900">{fmtTl(d.amountTL)} ₺</div>
              </label>
            ))}
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDrafts([])}
                className="rounded-xl border border-slate-200 px-3.5 py-2 text-xs font-bold text-slate-600"
              >
                İptal
              </button>
              <button
                type="button"
                onClick={saveDrafts}
                disabled={saving}
                className="rounded-xl bg-navy px-4 py-2 text-xs font-bold text-white hover:bg-navy-hover disabled:opacity-50"
              >
                {saving ? 'Kaydediliyor...' : 'Seçili Taslakları Kaydet'}
              </button>
            </div>
          </div>
        )}
      </div>
      )}

      {/* Dönem (Yıl + Ay) + Tür Filtresi + Özet */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="number"
            value={year}
            onChange={(e) => setYear(Number(e.target.value) || new Date().getFullYear())}
            className="w-24 rounded-xl border border-slate-200 bg-canvas px-3 py-1.5 text-sm font-bold text-slate-800"
          />
          <select
            value={monthFilter}
            onChange={(e) => setMonthFilter(Number(e.target.value))}
            className="rounded-xl border border-slate-200 bg-canvas px-3 py-1.5 text-sm font-bold text-slate-800"
          >
            {MONTHS.map((m, idx) => (
              <option key={m} value={idx}>
                {m}
              </option>
            ))}
          </select>
          {(
            [
              ['all', 'Tümü'],
              ['electric', 'Elektrik'],
              ['gas', 'Doğalgaz'],
              ['water', 'Su'],
            ] as const
          ).map(([k, lbl]) => (
            <button
              key={k}
              type="button"
              onClick={() => setUtilityFilter(k)}
              className={`rounded-full px-3.5 py-1.5 text-xs font-bold transition ${
                utilityFilter === k
                  ? 'bg-navy text-white'
                  : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              {lbl}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs">
          <span className="rounded-xl bg-navy-soft px-3 py-1.5 font-bold text-navy">
            {filteredInvoices.length} Fatura · {fmtTl(totalAmount)} ₺
          </span>
          {totalPenalty > 0 && (
            <span className="rounded-xl bg-red-50 px-3 py-1.5 font-bold text-red-700">
              Ceza: {fmtTl(totalPenalty)} ₺
            </span>
          )}
          {canDelete && selectedIds.length > 0 && (
            <button
              type="button"
              onClick={handleDeleteSelected}
              className="inline-flex items-center gap-1 rounded-xl bg-red-600 px-3 py-1.5 font-bold text-white hover:bg-red-700"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>Seçilenleri Sil ({selectedIds.length})</span>
            </button>
          )}
        </div>
      </div>

      {/* Fatura Tablosu */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-canvas text-[11px] font-extrabold uppercase tracking-wider text-slate-500">
              <tr>
                {canDelete && (
                  <th className="px-3 py-3">
                    <input
                      type="checkbox"
                      checked={
                        filteredInvoices.length > 0 &&
                        selectedIds.length === filteredInvoices.length
                      }
                      onChange={(e) =>
                        setSelectedIds(
                          e.target.checked ? filteredInvoices.map((i) => i.id) : []
                        )
                      }
                    />
                  </th>
                )}
                <th className="px-3.5 py-3">Dönem</th>
                <th className="px-3.5 py-3">Tür</th>
                <th className="px-3.5 py-3">Sayaç</th>
                <th className="px-3.5 py-3">Tedarikçi</th>
                <th className="px-3.5 py-3">Tüketim</th>
                <th className="px-3.5 py-3">Tutar (TL)</th>
                {!isNonElectricOnly && <th className="px-3.5 py-3">Ceza (TL)</th>}
                <th className="px-3.5 py-3 text-right">İşlem</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredInvoices.map((inv) => (
                <tr key={inv.id} className="hover:bg-canvas/60">
                  {canDelete && (
                    <td className="px-3 py-2.5">
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(inv.id)}
                        onChange={(e) =>
                          setSelectedIds((prev) =>
                            e.target.checked
                              ? [...prev, inv.id]
                              : prev.filter((id) => id !== inv.id)
                          )
                        }
                      />
                    </td>
                  )}
                  <td className="whitespace-nowrap px-3.5 py-2.5 text-xs font-semibold text-slate-700">
                    {MONTHS[inv.period_month]} {inv.period_year}
                  </td>
                  <td className="whitespace-nowrap px-3.5 py-2.5 text-xs font-bold text-slate-700">
                    {utilityLabel(inv.utility_type)}
                  </td>
                  <td className="whitespace-nowrap px-3.5 py-2.5 font-bold text-navy">
                    {inv.meter_name}
                  </td>
                  <td className="px-3.5 py-2.5 text-xs text-slate-600">{inv.provider}</td>
                  <td className="whitespace-nowrap px-3.5 py-2.5 text-xs text-slate-800">
                    {inv.consumption} {inv.utility_type === 'electric' ? 'kWh' : 'm³'}
                  </td>
                  <td className="whitespace-nowrap px-3.5 py-2.5 font-bold text-slate-900">
                    {fmtTl(inv.amount_tl)} ₺
                  </td>
                  {!isNonElectricOnly && (
                    <td className="whitespace-nowrap px-3.5 py-2.5 text-xs font-bold text-red-600">
                      {inv.utility_type === 'electric' &&
                      inv.inductive_penalty_tl + inv.capacitive_penalty_tl > 0
                        ? `${fmtTl(inv.inductive_penalty_tl + inv.capacitive_penalty_tl)} ₺`
                        : '-'}
                    </td>
                  )}
                  <td className="whitespace-nowrap px-3.5 py-2.5 text-right">
                    {canManage || canDelete ? (
                      <div className="inline-flex items-center gap-1">
                        {canManage && (
                          <button
                            type="button"
                            title="Düzenle"
                            onClick={() =>
                              setEditModal({
                                mode: 'edit',
                                id: inv.id,
                                period_year: inv.period_year,
                                period_month: inv.period_month,
                                utility_type: inv.utility_type,
                                provider: inv.provider,
                                invoice_no: inv.invoice_no ?? '',
                                invoice_date: inv.invoice_date ?? '',
                                meter_id: inv.meter_id ?? '',
                                meter_name: inv.meter_name,
                                consumption: String(inv.consumption),
                                amount_tl: String(inv.amount_tl),
                                inductive_penalty_tl: String(inv.inductive_penalty_tl),
                                capacitive_penalty_tl: String(inv.capacitive_penalty_tl),
                                tenant_amount_tl:
                                  inv.tenant_amount_tl != null
                                    ? String(inv.tenant_amount_tl)
                                    : '',
                              })
                            }
                            className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-navy-soft hover:text-navy"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {canDelete && (
                          <button
                            type="button"
                            title="Sil"
                            onClick={() => handleDeleteOne(inv)}
                            className="rounded-lg border border-slate-200 p-1.5 text-red-600 hover:bg-red-50"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400">Salt Okunur</span>
                    )}
                  </td>
                </tr>
              ))}
              {filteredInvoices.length === 0 && (
                <tr>
                  <td
                    colSpan={(canDelete ? 1 : 0) + (isNonElectricOnly ? 7 : 8)}
                    className="px-4 py-8 text-center text-slate-500"
                  >
                    {year} · {MONTHS[monthFilter]} dönemi için fatura bulunmuyor.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Fatura Ekle / Düzenle Modalı */}
      {editModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <form
            onSubmit={handleSaveModal}
            className="w-full max-w-lg space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-xl"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-base font-extrabold text-navy">
                {editModal.mode === 'edit' ? 'Fatura Düzenle' : 'Yeni Fatura Ekle'}
              </h2>
              <button
                type="button"
                onClick={() => setEditModal(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs font-bold text-slate-600">
                Yıl
                <input
                  type="number"
                  required
                  value={editModal.period_year}
                  onChange={(e) =>
                    setEditModal({
                      ...editModal,
                      period_year: Number(e.target.value) || year,
                    })
                  }
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm font-normal"
                />
              </label>
              <label className="text-xs font-bold text-slate-600">
                Ay
                <select
                  value={editModal.period_month}
                  onChange={(e) =>
                    setEditModal({
                      ...editModal,
                      period_month: Number(e.target.value),
                    })
                  }
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm font-normal"
                >
                  {MONTHS.slice(1).map((m, idx) => (
                    <option key={m} value={idx + 1}>
                      {m}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-bold text-slate-600">
                Enerji Türü
                <select
                  value={editModal.utility_type}
                  onChange={(e) => {
                    const nextType = e.target.value as 'electric' | 'gas' | 'water';
                    setEditModal({
                      ...editModal,
                      utility_type: nextType,
                      inductive_penalty_tl:
                        nextType === 'electric' ? editModal.inductive_penalty_tl : '0',
                      capacitive_penalty_tl:
                        nextType === 'electric' ? editModal.capacitive_penalty_tl : '0',
                    });
                  }}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm font-normal"
                >
                  <option value="electric">Elektrik</option>
                  <option value="gas">Doğalgaz</option>
                  <option value="water">Su</option>
                </select>
              </label>
              <label className="text-xs font-bold text-slate-600">
                Sayaç
                <select
                  value={editModal.meter_id}
                  onChange={(e) => {
                    const m = meters.find((x) => x.id === e.target.value);
                    setEditModal({
                      ...editModal,
                      meter_id: e.target.value,
                      meter_name: m ? m.name : editModal.meter_name,
                    });
                  }}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm font-normal"
                >
                  <option value="">Serbest / Genel</option>
                  {meters.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-bold text-slate-600">
                Sayaç Adı
                <input
                  required
                  value={editModal.meter_name}
                  onChange={(e) =>
                    setEditModal({ ...editModal, meter_name: e.target.value })
                  }
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm font-normal"
                />
              </label>
              <label className="text-xs font-bold text-slate-600">
                Tedarikçi
                <input
                  required
                  value={editModal.provider}
                  onChange={(e) =>
                    setEditModal({ ...editModal, provider: e.target.value })
                  }
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm font-normal"
                />
              </label>
              <label className="text-xs font-bold text-slate-600">
                Tüketim
                <input
                  type="number"
                  step="0.001"
                  required
                  value={editModal.consumption}
                  onChange={(e) =>
                    setEditModal({ ...editModal, consumption: e.target.value })
                  }
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm font-normal"
                />
              </label>
              <label className="text-xs font-bold text-slate-600">
                Tutar (TL)
                <input
                  type="number"
                  step="0.01"
                  required
                  value={editModal.amount_tl}
                  onChange={(e) =>
                    setEditModal({ ...editModal, amount_tl: e.target.value })
                  }
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm font-normal"
                />
              </label>
              {editModal.utility_type === 'electric' && (
                <>
                  <label className="text-xs font-bold text-slate-600">
                    İndüktif Ceza (TL)
                    <input
                      type="number"
                      step="0.01"
                      value={editModal.inductive_penalty_tl}
                      onChange={(e) =>
                        setEditModal({ ...editModal, inductive_penalty_tl: e.target.value })
                      }
                      className="mt-1 w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm font-normal"
                    />
                  </label>
                  <label className="text-xs font-bold text-slate-600">
                    Kapasitif Ceza (TL)
                    <input
                      type="number"
                      step="0.01"
                      value={editModal.capacitive_penalty_tl}
                      onChange={(e) =>
                        setEditModal({ ...editModal, capacitive_penalty_tl: e.target.value })
                      }
                      className="mt-1 w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm font-normal"
                    />
                  </label>
                </>
              )}
              <label className="text-xs font-bold text-slate-600">
                Kiracı Payı (TL)
                <input
                  type="number"
                  step="0.01"
                  value={editModal.tenant_amount_tl}
                  onChange={(e) =>
                    setEditModal({ ...editModal, tenant_amount_tl: e.target.value })
                  }
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm font-normal"
                />
              </label>
              <label className="text-xs font-bold text-slate-600">
                Fatura Tarihi
                <input
                  type="date"
                  value={editModal.invoice_date}
                  onChange={(e) =>
                    setEditModal({ ...editModal, invoice_date: e.target.value })
                  }
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm font-normal"
                />
              </label>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditModal(null)}
                className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-600"
              >
                Vazgeç
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-xl bg-navy px-4 py-2 text-xs font-bold text-white hover:bg-navy-hover disabled:opacity-50"
              >
                {saving ? 'Kaydediliyor...' : 'Kaydet'}
              </button>
            </div>
          </form>
        </div>
      )}

      <EnergyReportWizardModal
        open={showReportWizard}
        onClose={() => setShowReportWizard(false)}
        defaultYear={year}
        defaultMonthFilter={monthFilter}
        defaultUtilityFilter={utilityFilter}
        defaultPreset="executive"
        invoices={invoices}
        budgets={budgets}
        meters={meters}
        onYearChange={(newYear) => setYear(newYear)}
      />
    </div>
  );
}

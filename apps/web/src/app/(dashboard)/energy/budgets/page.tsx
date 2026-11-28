'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Droplets,
  FileDown,
  FileSpreadsheet,
  Flame,
  KeyRound,
  Pencil,
  Plus,
  SlidersHorizontal,
  Trash2,
  Upload,
  X,
  Zap,
} from 'lucide-react';
import {
  deleteEnergyBudget,
  fetchEnergyBudgetsData,
  saveEnergyBudget,
  upsertEnergyBudgetsBatch,
} from '@/features/energy/queries';
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
import { BudgetFormModal } from '@/features/energy/components/BudgetFormModal';
import { BudgetComparisonChart } from '@/features/energy/components/BudgetComparisonChart';
import { EnergyBudget, UtilityType } from '@/types/database';
import {
  arrayBufferToBase64,
  BudgetFormState,
  buildPrintableChartSvg,
  ChartMetric,
  GEMINI_STORAGE_KEY,
  MonthlyChartPoint,
  MONTHS,
  parseMonth,
  parseNumber,
  parseUtility,
  SHORT_MONTHS,
  utilityLabel,
  utilityUnit,
} from '@/features/energy/budget-helpers';

export default function EnergyBudgetsPage() {
  const { profile } = useDashboardAuth();
  const canManage = hasModulePermission(profile, 'energy', 'manage');
  const canReports = hasModulePermission(profile, 'energy', 'reports');

  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(0); // 0 = Tüm Yıl
  const [utilityFilter, setUtilityFilter] = useState<'all' | UtilityType>('all');
  const [chartMetric, setChartMetric] = useState<ChartMetric>('tl');
  const [hoveredMonth, setHoveredMonth] = useState<number | null>(null);

  const queryClient = useQueryClient();
  const [showReportWizard, setShowReportWizard] = useState(false);
  const [importing, setImporting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Gemini API Key config (shared with invoices page)
  const [geminiKey, setGeminiKey] = useState('');
  const [showKeyPanel, setShowKeyPanel] = useState(false);

  // Modal state (Add / Edit)
  const [formModal, setFormModal] = useState<BudgetFormState | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(GEMINI_STORAGE_KEY);
      if (saved) setGeminiKey(saved);
    } catch {
      // ignore storage errors
    }
  }, []);

  const { data: budgetData, isLoading: loading } = useQuery({
    queryKey: ['energy', 'budgets', year],
    placeholderData: (prev) => prev,
    queryFn: () => fetchEnergyBudgetsData(year),
  });

  const budgets = useMemo(() => budgetData?.budgets ?? [], [budgetData]);
  const invoices = useMemo(() => budgetData?.invoices ?? [], [budgetData]);

  const loadAll = async () => {
    await queryClient.invalidateQueries({ queryKey: ['energy', 'budgets', year] });
  };

  const fmtTl = (n: number) =>
    new Intl.NumberFormat('tr-TR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n);

  const fmtQty = (n: number) =>
    new Intl.NumberFormat('tr-TR', {
      maximumFractionDigits: 1,
    }).format(n);

  const filteredBudgets = useMemo(() => {
    return budgets.filter((b) => {
      if (month !== 0 && b.period_month !== month) return false;
      if (utilityFilter !== 'all' && b.utility_type !== utilityFilter) return false;
      return true;
    });
  }, [budgets, month, utilityFilter]);

  const actualFor = useCallback(
    (uType: string, pMonth: number) =>
      invoices
        .filter((i) => i.utility_type === uType && i.period_month === pMonth)
        .reduce((s, i) => s + Math.max(0, i.amount_tl - (i.tenant_amount_tl ?? 0)), 0),
    [invoices]
  );

  const actualQtyFor = useCallback(
    (uType: string, pMonth: number) =>
      invoices
        .filter((i) => i.utility_type === uType && i.period_month === pMonth)
        .reduce(
          (s, i) => s + Math.max(0, (i.consumption ?? 0) - (i.tenant_consumption ?? 0)),
          0
        ),
    [invoices]
  );

  const totals = useMemo(() => {
    let budgetTl = 0;
    let actualTl = 0;
    let prevTl = 0;
    let budgetQty = 0;
    let actualQty = 0;
    let prevQty = 0;

    for (const b of filteredBudgets) {
      budgetTl += b.budget_tl;
      actualTl += actualFor(b.utility_type, b.period_month);
      prevTl += b.prev_year_tl;
      budgetQty += b.budget_consumption ?? 0;
      actualQty += actualQtyFor(b.utility_type, b.period_month);
      prevQty += b.prev_year_consumption ?? 0;
    }

    const diffPct = budgetTl > 0 ? ((actualTl - budgetTl) / budgetTl) * 100 : null;
    const qtyDiffPct = budgetQty > 0 ? ((actualQty - budgetQty) / budgetQty) * 100 : null;
    const yoyTlPct = prevTl > 0 && actualTl > 0 ? ((actualTl - prevTl) / prevTl) * 100 : null;

    return {
      budgetTl,
      actualTl,
      prevTl,
      budgetQty,
      actualQty,
      prevQty,
      diffPct,
      qtyDiffPct,
      yoyTlPct,
    };
  }, [filteredBudgets, actualFor, actualQtyFor]);

  // Enerji türü bazlı miktar & tutar özet kartları
  const utilityCards = useMemo(() => {
    const types: UtilityType[] =
      utilityFilter === 'all' ? ['electric', 'gas', 'water'] : [utilityFilter];

    return types.map((uType) => {
      const bRows = budgets.filter(
        (b) => b.utility_type === uType && (month === 0 || b.period_month === month)
      );
      const iRows = invoices.filter(
        (i) => i.utility_type === uType && (month === 0 || i.period_month === month)
      );

      const budgetQty = bRows.reduce((s, b) => s + (b.budget_consumption ?? 0), 0);
      const budgetTl = bRows.reduce((s, b) => s + (b.budget_tl ?? 0), 0);
      const prevQty = bRows.reduce((s, b) => s + (b.prev_year_consumption ?? 0), 0);
      const prevTl = bRows.reduce((s, b) => s + (b.prev_year_tl ?? 0), 0);

      const actualQty = iRows.reduce(
        (s, i) => s + Math.max(0, (i.consumption ?? 0) - (i.tenant_consumption ?? 0)),
        0
      );
      const actualTl = iRows.reduce(
        (s, i) => s + Math.max(0, i.amount_tl - (i.tenant_amount_tl ?? 0)),
        0
      );

      const qtyDiffPct = budgetQty > 0 ? ((actualQty - budgetQty) / budgetQty) * 100 : null;
      const tlDiffPct = budgetTl > 0 ? ((actualTl - budgetTl) / budgetTl) * 100 : null;
      const realizationPct = budgetTl > 0 ? (actualTl / budgetTl) * 100 : null;
      const budgetUnitPrice = budgetQty > 0 ? budgetTl / budgetQty : null;
      const actualUnitPrice = actualQty > 0 ? actualTl / actualQty : null;

      return {
        uType,
        unit: utilityUnit(uType),
        budgetQty,
        actualQty,
        prevQty,
        budgetTl,
        actualTl,
        prevTl,
        qtyDiffPct,
        tlDiffPct,
        realizationPct,
        budgetUnitPrice,
        actualUnitPrice,
      };
    });
  }, [budgets, invoices, month, utilityFilter]);

  // 12 Aylık Grafik & Analiz Serisi
  const chartMeta = useMemo(() => {
    const activeUtilityForChart: 'all' | UtilityType =
      chartMetric === 'electric_qty'
        ? 'electric'
        : chartMetric === 'gas_qty'
        ? 'gas'
        : chartMetric === 'water_qty'
        ? 'water'
        : utilityFilter;

    const isQty = chartMetric !== 'tl';
    const unit = isQty ? utilityUnit(activeUtilityForChart) : '₺';
    const title =
      chartMetric === 'tl'
        ? `Aylık Tutar Karşılaştırması (${
            utilityFilter === 'all' ? 'Tüm Enerji Türleri' : utilityLabel(utilityFilter)
          } · TL)`
        : chartMetric === 'electric_qty'
        ? 'Aylık Elektrik Tüketim Miktarı (kWh)'
        : chartMetric === 'gas_qty'
        ? 'Aylık Doğalgaz Tüketim Miktarı (m³)'
        : 'Aylık Su Tüketim Miktarı (m³)';

    const points: MonthlyChartPoint[] = SHORT_MONTHS.map((shortLabel, idx) => {
      const mNum = idx + 1;
      const bRows = budgets.filter(
        (b) =>
          b.period_month === mNum &&
          (activeUtilityForChart === 'all' || b.utility_type === activeUtilityForChart)
      );
      const iRows = invoices.filter(
        (i) =>
          i.period_month === mNum &&
          (activeUtilityForChart === 'all' || i.utility_type === activeUtilityForChart)
      );

      const budgetVal = bRows.reduce(
        (s, b) => s + (isQty ? b.budget_consumption ?? 0 : b.budget_tl ?? 0),
        0
      );
      const prevVal = bRows.reduce(
        (s, b) => s + (isQty ? b.prev_year_consumption ?? 0 : b.prev_year_tl ?? 0),
        0
      );
      const actualVal = iRows.reduce(
        (s, i) =>
          s +
          (isQty
            ? Math.max(0, (i.consumption ?? 0) - (i.tenant_consumption ?? 0))
            : Math.max(0, i.amount_tl - (i.tenant_amount_tl ?? 0))),
        0
      );

      const diffPct = budgetVal > 0 ? ((actualVal - budgetVal) / budgetVal) * 100 : null;
      const yoyPct = prevVal > 0 && actualVal > 0 ? ((actualVal - prevVal) / prevVal) * 100 : null;

      return {
        monthNum: mNum,
        shortLabel,
        fullLabel: MONTHS[mNum],
        budgetVal,
        actualVal,
        prevVal,
        diffPct,
        yoyPct,
      };
    });

    const maxVal = Math.max(
      1,
      ...points.flatMap((p) => [p.budgetVal, p.actualVal, p.prevVal])
    );

    // Analiz içgörüleri
    const monthsWithActual = points.filter((p) => p.actualVal > 0 && p.budgetVal > 0);
    let highestDeviationMonth: MonthlyChartPoint | null = null;
    for (const p of monthsWithActual) {
      if (
        !highestDeviationMonth ||
        (p.diffPct ?? -Infinity) > (highestDeviationMonth.diffPct ?? -Infinity)
      ) {
        highestDeviationMonth = p;
      }
    }

    const overBudgetCount = monthsWithActual.filter((p) => p.actualVal > p.budgetVal).length;
    const underBudgetCount = monthsWithActual.filter((p) => p.actualVal <= p.budgetVal).length;

    const yoyComparable = points.filter((p) => p.actualVal > 0 && p.prevVal > 0);
    const yoyActualSum = yoyComparable.reduce((s, p) => s + p.actualVal, 0);
    const yoyPrevSum = yoyComparable.reduce((s, p) => s + p.prevVal, 0);
    const yoyOverallPct =
      yoyPrevSum > 0 ? ((yoyActualSum - yoyPrevSum) / yoyPrevSum) * 100 : null;

    const totalBudgetActive = monthsWithActual.reduce((s, p) => s + p.budgetVal, 0);
    const totalActualActive = monthsWithActual.reduce((s, p) => s + p.actualVal, 0);
    const realizationRatio =
      totalBudgetActive > 0 ? (totalActualActive / totalBudgetActive) * 100 : null;

    return {
      isQty,
      unit,
      title,
      points,
      niceMax: maxVal * 1.12,
      highestDeviationMonth,
      overBudgetCount,
      underBudgetCount,
      yoyOverallPct,
      yoyComparableCount: yoyComparable.length,
      realizationRatio,
    };
  }, [budgets, invoices, chartMetric, utilityFilter]);

  const activeInspectPoint = useMemo(() => {
    if (hoveredMonth) {
      return chartMeta.points.find((p) => p.monthNum === hoveredMonth) ?? null;
    }
    if (month > 0) {
      return chartMeta.points.find((p) => p.monthNum === month) ?? null;
    }
    return (
      chartMeta.points.find((p) => p.actualVal > 0 || p.budgetVal > 0) ??
      chartMeta.points[0]
    );
  }, [chartMeta.points, hoveredMonth, month]);

  function saveGeminiKey() {
    try {
      const trimmed = geminiKey.trim();
      if (trimmed) {
        localStorage.setItem(GEMINI_STORAGE_KEY, trimmed);
        setMsg({ type: 'ok', text: 'Gemini API anahtarı kaydedildi.' });
      } else {
        localStorage.removeItem(GEMINI_STORAGE_KEY);
        setMsg({ type: 'ok', text: 'Gemini API anahtarı temizlendi.' });
      }
      setShowKeyPanel(false);
    } catch {
      setMsg({ type: 'err', text: 'Tarayıcı depolama alanına yazılamadı.' });
    }
  }

  function openNewModal() {
    setFormModal({
      id: null,
      period_year: String(year),
      period_month: String(month > 0 ? month : new Date().getMonth() + 1),
      utility_type: utilityFilter === 'all' ? 'electric' : utilityFilter,
      budget_consumption: '',
      budget_tl: '',
      prev_year_consumption: '',
      prev_year_tl: '',
    });
  }

  function openEditModal(b: EnergyBudget) {
    setFormModal({
      id: b.id,
      period_year: String(b.period_year),
      period_month: String(b.period_month),
      utility_type: b.utility_type,
      budget_consumption: String(b.budget_consumption ?? 0),
      budget_tl: String(b.budget_tl ?? 0),
      prev_year_consumption: String(b.prev_year_consumption ?? 0),
      prev_year_tl: String(b.prev_year_tl ?? 0),
    });
  }

  async function handleSaveModal(e: React.FormEvent) {
    e.preventDefault();
    if (!formModal) return;
    setSaving(true);
    setMsg(null);
    try {
      const payload = {
        period_year: Number(formModal.period_year) || year,
        period_month: Number(formModal.period_month) || 1,
        utility_type: formModal.utility_type,
        budget_consumption: parseNumber(formModal.budget_consumption),
        budget_tl: parseNumber(formModal.budget_tl),
        prev_year_consumption: parseNumber(formModal.prev_year_consumption),
        prev_year_tl: parseNumber(formModal.prev_year_tl),
      };

      await saveEnergyBudget(formModal.id, payload);
      setMsg({
        type: 'ok',
        text: formModal.id ? 'Bütçe kaydı güncellendi.' : 'Bütçe kaydı eklendi.',
      });
      setFormModal(null);
      await loadAll();
    } catch (err) {
      setMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Bütçe kaydedilemedi.',
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(b: EnergyBudget) {
    const label = `${utilityLabel(b.utility_type)} · ${MONTHS[b.period_month]} ${b.period_year}`;
    if (!window.confirm(`${label} bütçe kaydını silmek istediğinize emin misiniz?`)) return;
    setMsg(null);
    try {
      await deleteEnergyBudget(b.id);
      setMsg({ type: 'ok', text: `${label} bütçe kaydı silindi.` });
      await loadAll();
    } catch (err) {
      setMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Bütçe kaydı silinemedi.',
      });
    }
  }

  function downloadTemplate() {
    const rows = [
      ['Tür', 'Ay', 'Bütçe Miktar', 'Bütçe TL', 'Önceki Yıl Miktar', 'Önceki Yıl TL'],
      ['Elektrik', 'Ocak', '150000', '750000', '145000', '680000'],
      ['Doğalgaz', 'Ocak', '25000', '350000', '24000', '310000'],
      ['Su', 'Ocak', '3500', '120000', '3200', '105000'],
    ];
    const csv = '\ufeff' + rows.map((r) => r.join(';')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `downtown_teknik_butce_sablon_${year}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleExportExcel() {
    const cfg = createDefaultEnergyReportConfig({
      year,
      monthFilter: month,
      utilityFilter,
      defaultPreset: 'budget_matrix',
    });
    exportExcelWorkbook(buildEnergyExcelWorkbook(invoices, budgets, cfg));
  }

  function handleExportPdf() {
    const cfg = createDefaultEnergyReportConfig({
      year,
      monthFilter: month,
      utilityFilter,
      defaultPreset: 'budget_matrix',
    });
    exportPrintablePdf(buildEnergyPdfReportOptions(invoices, budgets, cfg));
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setMsg(null);

    try {
      const lowerName = file.name.toLowerCase();

      if (lowerName.endsWith('.csv') || lowerName.endsWith('.txt')) {
        const text = await file.text();
        const lines = text
          .replace(/^\ufeff/, '')
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean);

        if (lines.length < 2) {
          throw new Error('CSV dosyasında en az başlık ve 1 veri satırı olmalıdır.');
        }

        const delimiter = lines[0].includes(';') ? ';' : ',';
        const rowsToUpsert: Array<{
          period_year: number;
          period_month: number;
          utility_type: UtilityType;
          budget_consumption: number;
          budget_tl: number;
          prev_year_consumption: number;
          prev_year_tl: number;
        }> = [];

        for (let i = 1; i < lines.length; i++) {
          const cols = lines[i].split(delimiter).map((c) => c.replace(/^"|"$/g, '').trim());
          if (cols.length < 4) continue;
          const uType = parseUtility(cols[0]);
          const pMonth = parseMonth(cols[1]);
          if (!uType || !pMonth) continue;

          rowsToUpsert.push({
            period_year: year,
            period_month: pMonth,
            utility_type: uType,
            budget_consumption: parseNumber(cols[2]),
            budget_tl: parseNumber(cols[3]),
            prev_year_consumption: parseNumber(cols[4]),
            prev_year_tl: parseNumber(cols[5]),
          });
        }

        if (rowsToUpsert.length === 0) {
          throw new Error(
            'Geçerli bütçe satırı bulunamadı. Lütfen "Şablon İndir" ile uyumlu format kullanın.'
          );
        }

        await upsertEnergyBudgetsBatch(rowsToUpsert);

        setMsg({
          type: 'ok',
          text: `${rowsToUpsert.length} bütçe satırı CSV dosyasından başarıyla içe aktarıldı (${year}).`,
        });
        await loadAll();
      } else if (lowerName.endsWith('.pdf')) {
        const buf = await file.arrayBuffer();
        const base64 = arrayBufferToBase64(buf);
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (geminiKey.trim()) {
          headers['x-gemini-api-key'] = geminiKey.trim();
        }
        const res = await fetch('/api/energy/parse-document', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            mode: 'budgets',
            fileName: file.name,
            pdfBase64: base64,
            targetYear: year,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          if (res.status === 400 && String(data.error || '').includes('Gemini API')) {
            setShowKeyPanel(true);
          }
          throw new Error(data.error || 'PDF bütçe analizi başarısız oldu.');
        }

        const items = (data.items ?? []) as Array<Record<string, unknown>>;
        if (items.length === 0) {
          throw new Error('PDF içinden geçerli bütçe satırı çıkarılamadı.');
        }

        const rowsToUpsert = items
          .map((item) => {
            const uType = parseUtility(String(item.utilityType ?? item.utility_type ?? ''));
            const pMonth = Number(item.month ?? item.period_month);
            if (!uType || !Number.isInteger(pMonth) || pMonth < 1 || pMonth > 12) return null;
            return {
              period_year: Number(item.year ?? item.period_year) || year,
              period_month: pMonth,
              utility_type: uType,
              budget_consumption: Number(item.budgetConsumption ?? item.budget_consumption) || 0,
              budget_tl: Number(item.budgetTL ?? item.budget_tl) || 0,
              prev_year_consumption:
                Number(item.prevYearConsumption ?? item.prev_year_consumption) || 0,
              prev_year_tl: Number(item.prevYearTL ?? item.prev_year_tl) || 0,
            };
          })
          .filter((r): r is NonNullable<typeof r> => r !== null);

        if (rowsToUpsert.length === 0) {
          throw new Error('PDF verisi bütçe formatına dönüştürülemedi.');
        }

        await upsertEnergyBudgetsBatch(rowsToUpsert);

        setMsg({
          type: 'ok',
          text: `${rowsToUpsert.length} bütçe satırı PDF dosyasından Gemini AI ile içe aktarıldı.`,
        });
        await loadAll();
      } else {
        throw new Error('Desteklenen dosya türleri: .csv (Excel) veya .pdf');
      }
    } catch (err) {
      setMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Bütçe içe aktarılamadı.',
      });
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  return (
    <div className="space-y-5">
      {/* Üst Başlık ve Aksiyon Çubuğu */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400">
            ENERJİ BÜTÇESİ
          </div>
          <h1 className="mt-0.5 text-2xl font-extrabold text-slate-900">
            Bütçe & Geçmiş Yıl Karşılaştırma
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Elektrik, doğalgaz ve su için miktar/tutar bazlı bütçe takibi, aylık grafik analizi ve
            Excel / PDF raporlama.
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
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                    : 'border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100'
                }`}
              >
                <KeyRound className="h-3.5 w-3.5" />
                {geminiKey ? 'Gemini API Bağlı' : 'Gemini API Ayarla'}
              </button>

              <button
                type="button"
                onClick={downloadTemplate}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 transition hover:bg-slate-50"
              >
                <FileSpreadsheet className="h-3.5 w-3.5 text-turquoise" />
                Şablon İndir
              </button>

              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-turquoise px-3.5 py-2 text-xs font-bold text-white shadow-sm transition hover:opacity-95">
                <Upload className="h-3.5 w-3.5" />
                {importing ? 'İçe Aktarılıyor...' : 'Bütçe İçe Aktar (CSV / PDF)'}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.txt,.pdf"
                  disabled={importing}
                  onChange={handleImportFile}
                  className="hidden"
                />
              </label>

              <button
                type="button"
                onClick={openNewModal}
                className="inline-flex items-center gap-1.5 rounded-xl bg-navy px-3.5 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-navy-hover"
              >
                <Plus className="h-3.5 w-3.5" />
                Manuel Ekle
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
                disabled={filteredBudgets.length === 0 && invoices.length === 0}
                className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800 transition hover:bg-emerald-100 disabled:opacity-40"
              >
                <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-700" />
                Matris Excel (.xls)
              </button>

              <button
                type="button"
                onClick={handleExportPdf}
                disabled={filteredBudgets.length === 0 && chartMeta.points.every((p) => p.actualVal === 0)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-800 transition hover:bg-rose-100 disabled:opacity-40"
              >
                <FileDown className="h-3.5 w-3.5 text-rose-700" />
                Hızlı PDF
              </button>
            </>
          )}
        </div>
      </div>

      {/* Gemini API Ayar Paneli (PDF İçe Aktarma İçin) */}
      {canManage && showKeyPanel && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-sm font-bold text-slate-900">
                Gemini API Anahtarı (PDF Bütçe & Fatura Analizi)
              </div>
              <p className="text-xs text-slate-500">
                Tarayıcınızda saklanır ve PDF bütçe/fatura analizlerinde kullanılır. CSV içe aktarma
                için API anahtarı gerekmez.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowKeyPanel(false)}
              className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <input
              type="password"
              value={geminiKey}
              onChange={(e) => setGeminiKey(e.target.value)}
              placeholder="AIzaSy..."
              className="min-w-[260px] flex-1 rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm focus:border-navy focus:outline-none"
            />
            <button
              type="button"
              onClick={saveGeminiKey}
              className="rounded-xl bg-navy px-4 py-2 text-xs font-bold text-white hover:bg-navy-hover"
            >
              Kaydet
            </button>
          </div>
        </div>
      )}

      {/* Dönem ve Tür Filtre Barı */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-3">
        <div className="flex flex-wrap gap-2">
          {(
            [
              ['all', 'Tümü'],
              ['electric', 'Elektrik'],
              ['gas', 'Doğalgaz'],
              ['water', 'Su'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setUtilityFilter(key)}
              className={`rounded-full px-4 py-1.5 text-xs font-bold transition ${
                utilityFilter === key
                  ? 'bg-navy text-white shadow-sm'
                  : 'border border-slate-200 bg-canvas text-slate-700 hover:bg-slate-100'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="number"
            value={year}
            onChange={(e) => setYear(Number(e.target.value) || new Date().getFullYear())}
            className="w-24 rounded-xl border border-slate-200 bg-canvas px-3 py-1.5 text-sm font-bold text-slate-800 focus:border-navy focus:outline-none"
          />
          <select
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
            className="rounded-xl border border-slate-200 bg-canvas px-3 py-1.5 text-sm font-bold text-slate-800 focus:border-navy focus:outline-none"
          >
            {MONTHS.map((m, idx) => (
              <option key={m} value={idx}>
                {m}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Üst Özet KPI Kartları */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400">
            Toplam Bütçe
          </div>
          <div className="mt-1 text-xl font-extrabold text-navy">{fmtTl(totals.budgetTl)} ₺</div>
          <div className="mt-0.5 text-xs text-slate-500">
            {utilityFilter !== 'all'
              ? `${fmtQty(totals.budgetQty)} ${utilityUnit(utilityFilter)} · ${filteredBudgets.length} dönem`
              : `${filteredBudgets.length} dönem kaydı`}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400">
            Gerçekleşen Ortak Alan
          </div>
          <div className="mt-1 text-xl font-extrabold text-slate-900">
            {fmtTl(totals.actualTl)} ₺
          </div>
          <div className="mt-0.5 text-xs text-slate-500">
            {utilityFilter !== 'all'
              ? `${fmtQty(totals.actualQty)} ${utilityUnit(utilityFilter)} (net ortak alan)`
              : 'Kiracı düşülmüş net tutar & miktar'}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400">
            Bütçe Sapması (Tutar)
          </div>
          <div
            className={`mt-1 text-xl font-extrabold ${
              totals.diffPct === null
                ? 'text-slate-400'
                : totals.diffPct > 0
                ? 'text-red-600'
                : 'text-emerald-600'
            }`}
          >
            {totals.diffPct !== null
              ? `${totals.diffPct >= 0 ? '+' : ''}${totals.diffPct.toFixed(1)}%`
              : '-'}
          </div>
          <div className="mt-0.5 text-xs text-slate-500">
            {utilityFilter !== 'all' && totals.qtyDiffPct !== null
              ? `Miktar sapması: ${totals.qtyDiffPct >= 0 ? '+' : ''}${totals.qtyDiffPct.toFixed(1)}%`
              : totals.diffPct !== null && totals.diffPct > 0
              ? 'Bütçe aşımı'
              : 'Bütçe dahilinde'}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400">
            Önceki Yıl Toplamı
          </div>
          <div className="mt-1 text-xl font-extrabold text-slate-700">{fmtTl(totals.prevTl)} ₺</div>
          <div className="mt-0.5 text-xs text-slate-500">
            {totals.yoyTlPct !== null
              ? `${year - 1} yılına göre ${totals.yoyTlPct >= 0 ? '+' : ''}${totals.yoyTlPct.toFixed(1)}%`
              : `${year - 1} karşılaştırma baz değeri`}
          </div>
        </div>
      </div>

      {/* Enerji Türü Bazlı Miktar & Tutar Analiz Kartları */}
      <div
        className={`grid gap-3 ${
          utilityCards.length === 1 ? 'grid-cols-1' : 'md:grid-cols-3'
        }`}
      >
        {utilityCards.map((c) => {
          const barPct =
            c.realizationPct !== null ? Math.min(100, Math.max(0, c.realizationPct)) : 0;
          const isOver = (c.tlDiffPct ?? 0) > 0;
          return (
            <div
              key={c.uType}
              className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <span
                    className={`flex h-8 w-8 items-center justify-center rounded-xl ${
                      c.uType === 'electric'
                        ? 'bg-amber-100 text-amber-600'
                        : c.uType === 'gas'
                        ? 'bg-red-100 text-red-600'
                        : 'bg-sky-100 text-sky-600'
                    }`}
                  >
                    {c.uType === 'electric' ? (
                      <Zap className="h-4 w-4" />
                    ) : c.uType === 'gas' ? (
                      <Flame className="h-4 w-4" />
                    ) : (
                      <Droplets className="h-4 w-4" />
                    )}
                  </span>
                  <div>
                    <div className="text-sm font-extrabold text-slate-900">
                      {utilityLabel(c.uType)} Analizi
                    </div>
                    <div className="text-[11px] font-medium text-slate-500">
                      {MONTHS[month]} {year} · {c.unit}
                    </div>
                  </div>
                </div>

                {c.realizationPct !== null && (
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-extrabold ${
                      isOver
                        ? 'bg-red-100 text-red-700'
                        : 'bg-emerald-100 text-emerald-700'
                    }`}
                  >
                    %{c.realizationPct.toFixed(0)} kullanım
                  </span>
                )}
              </div>

              {/* İlerleme Çubuğu */}
              <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className={`h-full rounded-full transition-all ${
                    isOver ? 'bg-red-500' : 'bg-turquoise'
                  }`}
                  style={{ width: `${barPct}%` }}
                />
              </div>

              <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                <div className="rounded-xl bg-canvas p-2.5">
                  <div className="font-bold text-slate-500">Miktar ({c.unit})</div>
                  <div className="mt-1 flex items-baseline justify-between gap-1">
                    <span className="text-slate-500">Bütçe:</span>
                    <span className="font-bold text-slate-800">{fmtQty(c.budgetQty)}</span>
                  </div>
                  <div className="mt-0.5 flex items-baseline justify-between gap-1">
                    <span className="text-slate-500">Gerçek:</span>
                    <span className="font-extrabold text-navy">{fmtQty(c.actualQty)}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between border-t border-slate-200/70 pt-1">
                    <span className="text-[11px] text-slate-400">Miktar Sapması</span>
                    {c.qtyDiffPct !== null ? (
                      <span
                        className={`font-extrabold ${
                          c.qtyDiffPct > 0 ? 'text-red-600' : 'text-emerald-600'
                        }`}
                      >
                        {c.qtyDiffPct >= 0 ? '+' : ''}
                        {c.qtyDiffPct.toFixed(1)}%
                      </span>
                    ) : (
                      <span className="text-slate-400">-</span>
                    )}
                  </div>
                </div>

                <div className="rounded-xl bg-canvas p-2.5">
                  <div className="font-bold text-slate-500">Tutar & Birim Fiyat</div>
                  <div className="mt-1 flex items-baseline justify-between gap-1">
                    <span className="text-slate-500">Bütçe:</span>
                    <span className="font-bold text-slate-800">{fmtTl(c.budgetTl)} ₺</span>
                  </div>
                  <div className="mt-0.5 flex items-baseline justify-between gap-1">
                    <span className="text-slate-500">Gerçek:</span>
                    <span className="font-extrabold text-navy">{fmtTl(c.actualTl)} ₺</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between border-t border-slate-200/70 pt-1">
                    <span className="text-[11px] text-slate-400">Birim (Gerçek/Büt.)</span>
                    <span className="font-bold text-slate-700">
                      {c.actualUnitPrice !== null ? fmtTl(c.actualUnitPrice) : '-'} /{' '}
                      {c.budgetUnitPrice !== null ? fmtTl(c.budgetUnitPrice) : '-'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Ay Bazında Grafik ve Analiz Paneli */}
      <BudgetComparisonChart
        year={year}
        month={month}
        hoveredMonth={hoveredMonth}
        chartMetric={chartMetric}
        chartMeta={chartMeta}
        activeInspectPoint={activeInspectPoint}
        fmtTl={fmtTl}
        fmtQty={fmtQty}
        onMetricChange={setChartMetric}
        onHoverMonth={setHoveredMonth}
        onSelectMonth={setMonth}
      />

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

      {/* Bütçe Tablosu */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-canvas text-[11px] font-extrabold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">Tür</th>
                <th className="px-4 py-3">Dönem</th>
                <th className="px-4 py-3">Bütçe Miktar</th>
                <th className="px-4 py-3">Gerçekleşen Miktar</th>
                <th className="px-4 py-3">Önceki Yıl Miktar</th>
                <th className="px-4 py-3">Bütçe (TL)</th>
                <th className="px-4 py-3">Gerçekleşen Ortak (TL)</th>
                <th className="px-4 py-3">Tutar Sapması</th>
                <th className="px-4 py-3">Önceki Yıl (TL)</th>
                <th className="px-4 py-3 text-right">İşlem</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredBudgets.map((b) => {
                const actualTl = actualFor(b.utility_type, b.period_month);
                const actualQty = actualQtyFor(b.utility_type, b.period_month);
                const qtyDiffPct =
                  b.budget_consumption > 0
                    ? ((actualQty - b.budget_consumption) / b.budget_consumption) * 100
                    : null;
                const tlDiffPct =
                  b.budget_tl > 0 ? ((actualTl - b.budget_tl) / b.budget_tl) * 100 : null;
                const unit = utilityUnit(b.utility_type);

                return (
                  <tr key={b.id} className="hover:bg-canvas/60">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5 font-bold text-slate-900">
                        <span
                          className={`flex h-7 w-7 items-center justify-center rounded-lg ${
                            b.utility_type === 'electric'
                              ? 'bg-amber-100 text-amber-600'
                              : b.utility_type === 'gas'
                              ? 'bg-red-100 text-red-600'
                              : 'bg-sky-100 text-sky-600'
                          }`}
                        >
                          {b.utility_type === 'electric' ? (
                            <Zap className="h-3.5 w-3.5" />
                          ) : b.utility_type === 'gas' ? (
                            <Flame className="h-3.5 w-3.5" />
                          ) : (
                            <Droplets className="h-3.5 w-3.5" />
                          )}
                        </span>
                        <span>{utilityLabel(b.utility_type)}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-700">
                      {MONTHS[b.period_month]} {b.period_year}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {fmtQty(b.budget_consumption)} {unit}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-bold text-slate-900">
                          {fmtQty(actualQty)} {unit}
                        </span>
                        {qtyDiffPct !== null && (
                          <span
                            className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-extrabold ${
                              qtyDiffPct > 0
                                ? 'bg-red-100 text-red-700'
                                : 'bg-emerald-100 text-emerald-700'
                            }`}
                          >
                            {qtyDiffPct >= 0 ? '+' : ''}
                            {qtyDiffPct.toFixed(1)}%
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-500">
                      {fmtQty(b.prev_year_consumption ?? 0)} {unit}
                    </td>
                    <td className="px-4 py-3 font-semibold text-slate-800">
                      {fmtTl(b.budget_tl)} ₺
                    </td>
                    <td className="px-4 py-3 font-bold text-slate-900">{fmtTl(actualTl)} ₺</td>
                    <td className="px-4 py-3">
                      {tlDiffPct !== null ? (
                        <span
                          className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-extrabold ${
                            tlDiffPct > 0
                              ? 'bg-red-100 text-red-700'
                              : 'bg-emerald-100 text-emerald-700'
                          }`}
                        >
                          {tlDiffPct >= 0 ? '+' : ''}
                          {tlDiffPct.toFixed(1)}%
                        </span>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-500">{fmtTl(b.prev_year_tl)} ₺</td>
                    <td className="px-4 py-3">
                      {canManage ? (
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => openEditModal(b)}
                            title="Düzenle"
                            className="rounded-lg border border-slate-200 p-1.5 text-slate-600 transition hover:border-navy hover:bg-navy/5 hover:text-navy"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(b)}
                            title="Sil"
                            className="rounded-lg border border-slate-200 p-1.5 text-slate-600 transition hover:border-red-300 hover:bg-red-50 hover:text-red-600"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ) : (
                        <div className="text-right text-xs text-slate-400">Salt Okunur</div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filteredBudgets.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-10 text-center text-slate-500">
                    {loading
                      ? 'Bütçe verileri yükleniyor...'
                      : `${year} · ${MONTHS[month]} dönemi için bütçe kaydı bulunamadı.`}
                  </td>
                </tr>
              )}
            </tbody>

            {filteredBudgets.length > 0 && (
              <tfoot className="border-t-2 border-slate-200 bg-canvas text-xs font-extrabold text-navy">
                <tr>
                  <td className="px-4 py-3">TOPLAM</td>
                  <td className="px-4 py-3 text-slate-600">{filteredBudgets.length} dönem kaydı</td>
                  <td className="px-4 py-3 text-slate-700">
                    {utilityFilter !== 'all'
                      ? `${fmtQty(totals.budgetQty)} ${utilityUnit(utilityFilter)}`
                      : '-'}
                  </td>
                  <td className="px-4 py-3">
                    {utilityFilter !== 'all' ? (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span>
                          {fmtQty(totals.actualQty)} {utilityUnit(utilityFilter)}
                        </span>
                        {totals.qtyDiffPct !== null && (
                          <span
                            className={`rounded-full px-2 py-0.5 text-[11px] font-extrabold ${
                              totals.qtyDiffPct > 0
                                ? 'bg-red-100 text-red-700'
                                : 'bg-emerald-100 text-emerald-700'
                            }`}
                          >
                            {totals.qtyDiffPct >= 0 ? '+' : ''}
                            {totals.qtyDiffPct.toFixed(1)}%
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="font-medium text-slate-400">Karma birim</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {utilityFilter !== 'all'
                      ? `${fmtQty(totals.prevQty)} ${utilityUnit(utilityFilter)}`
                      : '-'}
                  </td>
                  <td className="px-4 py-3">{fmtTl(totals.budgetTl)} ₺</td>
                  <td className="px-4 py-3">{fmtTl(totals.actualTl)} ₺</td>
                  <td className="px-4 py-3">
                    {totals.diffPct !== null ? (
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-extrabold ${
                          totals.diffPct > 0
                            ? 'bg-red-100 text-red-700'
                            : 'bg-emerald-100 text-emerald-700'
                        }`}
                      >
                        {totals.diffPct >= 0 ? '+' : ''}
                        {totals.diffPct.toFixed(1)}%
                      </span>
                    ) : (
                      '-'
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{fmtTl(totals.prevTl)} ₺</td>
                  <td className="px-4 py-3" />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      <BudgetFormModal
        formModal={formModal}
        setFormModal={setFormModal}
        saving={saving}
        onSubmit={handleSaveModal}
      />

      <EnergyReportWizardModal
        open={showReportWizard}
        onClose={() => setShowReportWizard(false)}
        defaultYear={year}
        defaultMonthFilter={month}
        defaultUtilityFilter={utilityFilter}
        defaultPreset="budget_matrix"
        invoices={invoices}
        budgets={budgets}
        onYearChange={(newYear) => setYear(newYear)}
      />
    </div>
  );
}

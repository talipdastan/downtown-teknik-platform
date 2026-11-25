'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart3,
  Droplets,
  FileDown,
  FileSpreadsheet,
  Flame,
  KeyRound,
  Pencil,
  Plus,
  SlidersHorizontal,
  Trash2,
  TrendingDown,
  TrendingUp,
  Upload,
  X,
  Zap,
} from 'lucide-react';
import { createClient } from '@/core/supabase/client';
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
import { EnergyBudget, EnergyInvoice, UtilityType } from '@/types/database';

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

const SHORT_MONTHS = [
  'Oca',
  'Şub',
  'Mar',
  'Nis',
  'May',
  'Haz',
  'Tem',
  'Ağu',
  'Eyl',
  'Eki',
  'Kas',
  'Ara',
];

const GEMINI_STORAGE_KEY = 'avm_tech_gemini_api_key';

type ChartMetric = 'tl' | 'electric_qty' | 'gas_qty' | 'water_qty';

interface MonthlyChartPoint {
  monthNum: number;
  shortLabel: string;
  fullLabel: string;
  budgetVal: number;
  actualVal: number;
  prevVal: number;
  diffPct: number | null;
  yoyPct: number | null;
}

function utilityLabel(type: string) {
  if (type === 'electric') return 'Elektrik';
  if (type === 'gas') return 'Doğalgaz';
  if (type === 'water') return 'Su';
  return type;
}

function utilityUnit(type: string) {
  if (type === 'electric') return 'kWh';
  return 'm³';
}

function parseUtility(raw: string): UtilityType | null {
  const s = raw.trim().toLowerCase();
  if (s === 'electric' || s === 'elektrik' || s.includes('elekt')) return 'electric';
  if (s === 'gas' || s === 'doğalgaz' || s === 'dogalgaz' || s.includes('gaz')) return 'gas';
  if (s === 'water' || s === 'su') return 'water';
  return null;
}

function parseMonth(raw: string): number | null {
  const s = raw.trim().toLowerCase();
  const num = Number(s);
  if (Number.isInteger(num) && num >= 1 && num <= 12) return num;
  const map: Record<string, number> = {
    ocak: 1,
    şubat: 2,
    subat: 2,
    mart: 3,
    nisan: 4,
    mayıs: 5,
    mayis: 5,
    haziran: 6,
    temmuz: 7,
    ağustos: 8,
    agustos: 8,
    eylül: 9,
    eylul: 9,
    ekim: 10,
    kasım: 11,
    kasim: 11,
    aralık: 12,
    aralik: 12,
  };
  for (const [k, v] of Object.entries(map)) {
    if (s.startsWith(k)) return v;
  }
  return null;
}

function parseNumber(raw: string | undefined): number {
  if (!raw) return 0;
  let s = raw.trim().replace(/[₺\s]/g, '');
  if (!s) return 0;
  // Turkish format: 125.000,50 -> 125000.50
  if (s.includes(',') && s.includes('.')) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      s = s.replace(/,/g, '');
    }
  } else if (s.includes(',')) {
    s = s.replace(',', '.');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const end = Math.min(i + chunkSize, bytes.length);
    for (let j = i; j < end; j++) {
      binary += String.fromCharCode(bytes[j]);
    }
  }
  return btoa(binary);
}

function formatCompactAxis(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace('.', ',')}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}B`;
  return String(Math.round(n));
}

function escapeSvgText(val: string): string {
  return val
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function buildPrintableChartSvg(
  points: MonthlyChartPoint[],
  unitLabel: string,
  highlightMonth: number
): string {
  const width = 920;
  const height = 250;
  const padLeft = 58;
  const padRight = 18;
  const padTop = 26;
  const padBottom = 38;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const maxVal = Math.max(
    1,
    ...points.flatMap((p) => [p.budgetVal, p.actualVal, p.prevVal])
  );
  const niceMax = maxVal * 1.12;
  const groupW = plotW / 12;
  const barW = Math.max(8, Math.min(14, (groupW - 18) / 3));

  const gridLines = [0, 0.25, 0.5, 0.75, 1]
    .map((ratio) => {
      const y = padTop + plotH * (1 - ratio);
      const val = niceMax * ratio;
      return `<line x1="${padLeft}" y1="${y.toFixed(1)}" x2="${width - padRight}" y2="${y.toFixed(1)}" stroke="#E2E8F0" stroke-dasharray="3 3" />
      <text x="${padLeft - 8}" y="${(y + 3).toFixed(1)}" text-anchor="end" font-size="10" fill="#64748B" font-family="Arial, sans-serif">${escapeSvgText(
        formatCompactAxis(val)
      )}</text>`;
    })
    .join('\n');

  const bars = points
    .map((p, idx) => {
      const gx = padLeft + idx * groupW;
      const centerX = gx + groupW / 2;
      const startX = centerX - (barW * 3 + 6) / 2;
      const hBudget = (p.budgetVal / niceMax) * plotH;
      const hActual = (p.actualVal / niceMax) * plotH;
      const hPrev = (p.prevVal / niceMax) * plotH;
      const overBudget = p.budgetVal > 0 && p.actualVal > p.budgetVal;
      const actualColor = overBudget ? '#DC2626' : '#0E7490';
      const isSelected = highlightMonth === p.monthNum;

      const highlightRect = isSelected
        ? `<rect x="${(gx + 3).toFixed(1)}" y="${padTop}" width="${(groupW - 6).toFixed(
            1
          )}" height="${plotH}" rx="4" fill="#EFF6FF" />`
        : '';

      return `${highlightRect}
      <rect x="${startX.toFixed(1)}" y="${(padTop + plotH - hBudget).toFixed(
        1
      )}" width="${barW}" height="${Math.max(1, hBudget).toFixed(
        1
      )}" rx="2" fill="#17365D" />
      <rect x="${(startX + barW + 3).toFixed(1)}" y="${(
        padTop +
        plotH -
        hActual
      ).toFixed(1)}" width="${barW}" height="${Math.max(1, hActual).toFixed(
        1
      )}" rx="2" fill="${actualColor}" />
      <rect x="${(startX + (barW + 3) * 2).toFixed(1)}" y="${(
        padTop +
        plotH -
        hPrev
      ).toFixed(1)}" width="${barW}" height="${Math.max(1, hPrev).toFixed(
        1
      )}" rx="2" fill="#94A3B8" />
      <text x="${centerX.toFixed(1)}" y="${height - 16}" text-anchor="middle" font-size="10.5" font-weight="${
        isSelected ? '700' : '600'
      }" fill="${isSelected ? '#17365D' : '#475569'}" font-family="Arial, sans-serif">${
        p.shortLabel
      }</text>`;
    })
    .join('\n');

  const legend = `
    <g transform="translate(${padLeft}, 8)">
      <rect x="0" y="0" width="10" height="10" rx="2" fill="#17365D"/><text x="14" y="9" font-size="10" font-weight="700" fill="#334155" font-family="Arial, sans-serif">Bütçe (${escapeSvgText(unitLabel)})</text>
      <rect x="115" y="0" width="10" height="10" rx="2" fill="#0E7490"/><text x="129" y="9" font-size="10" font-weight="700" fill="#334155" font-family="Arial, sans-serif">Gerçekleşen (Bütçe İçi)</text>
      <rect x="275" y="0" width="10" height="10" rx="2" fill="#DC2626"/><text x="289" y="9" font-size="10" font-weight="700" fill="#334155" font-family="Arial, sans-serif">Gerçekleşen (Bütçe Aşımı)</text>
      <rect x="460" y="0" width="10" height="10" rx="2" fill="#94A3B8"/><text x="474" y="9" font-size="10" font-weight="700" fill="#334155" font-family="Arial, sans-serif">Önceki Yıl</text>
    </g>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">
    ${legend}
    ${gridLines}
    <line x1="${padLeft}" y1="${padTop + plotH}" x2="${width - padRight}" y2="${
    padTop + plotH
  }" stroke="#CBD5E1" stroke-width="1.2" />
    ${bars}
  </svg>`;
}

interface BudgetFormState {
  id: string | null;
  period_year: string;
  period_month: string;
  utility_type: UtilityType;
  budget_consumption: string;
  budget_tl: string;
  prev_year_consumption: string;
  prev_year_tl: string;
}

export default function EnergyBudgetsPage() {
  const { profile } = useDashboardAuth();
  const canManage = hasModulePermission(profile, 'energy', 'manage');
  const canReports = hasModulePermission(profile, 'energy', 'reports');

  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(0); // 0 = Tüm Yıl
  const [utilityFilter, setUtilityFilter] = useState<'all' | UtilityType>('all');
  const [chartMetric, setChartMetric] = useState<ChartMetric>('tl');
  const [hoveredMonth, setHoveredMonth] = useState<number | null>(null);

  const [budgets, setBudgets] = useState<EnergyBudget[]>([]);
  const [invoices, setInvoices] = useState<EnergyInvoice[]>([]);
  const [showReportWizard, setShowReportWizard] = useState(false);
  const [loading, setLoading] = useState(true);
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

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const supabase = createClient();
      const [bRes, iRes] = await Promise.all([
        supabase
          .from('energy_budgets')
          .select('*')
          .eq('period_year', year)
          .order('period_month')
          .order('utility_type'),
        supabase.from('energy_invoices').select('*').eq('period_year', year),
      ]);
      if (bRes.error) throw bRes.error;
      setBudgets((bRes.data as EnergyBudget[]) ?? []);
      if (iRes.data) setInvoices(iRes.data as EnergyInvoice[]);
    } catch (err) {
      setMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Bütçe verisi alınamadı.',
      });
    } finally {
      setLoading(false);
    }
  }, [year]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

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
      const supabase = createClient();
      const payload = {
        period_year: Number(formModal.period_year) || year,
        period_month: Number(formModal.period_month) || 1,
        utility_type: formModal.utility_type,
        budget_consumption: parseNumber(formModal.budget_consumption),
        budget_tl: parseNumber(formModal.budget_tl),
        prev_year_consumption: parseNumber(formModal.prev_year_consumption),
        prev_year_tl: parseNumber(formModal.prev_year_tl),
      };

      if (formModal.id) {
        const { error } = await supabase
          .from('energy_budgets')
          .update(payload)
          .eq('id', formModal.id);
        if (error) throw error;
        setMsg({ type: 'ok', text: 'Bütçe kaydı güncellendi.' });
      } else {
        const { error } = await supabase
          .from('energy_budgets')
          .upsert(payload, { onConflict: 'period_year,period_month,utility_type' });
        if (error) throw error;
        setMsg({ type: 'ok', text: 'Bütçe kaydı eklendi.' });
      }
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
      const supabase = createClient();
      const { error } = await supabase.from('energy_budgets').delete().eq('id', b.id);
      if (error) throw error;
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
      const supabase = createClient();
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

        const { error } = await supabase
          .from('energy_budgets')
          .upsert(rowsToUpsert, { onConflict: 'period_year,period_month,utility_type' });
        if (error) throw error;

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

        const { error } = await supabase
          .from('energy_budgets')
          .upsert(rowsToUpsert, { onConflict: 'period_year,period_month,utility_type' });
        if (error) throw error;

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
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-navy/10 text-navy">
              <BarChart3 className="h-4 w-4" />
            </span>
            <div>
              <h2 className="text-base font-extrabold text-slate-900">
                Ay Bazında Bütçe, Gerçekleşen & Geçmiş Yıl Analizi ({year})
              </h2>
              <p className="text-xs text-slate-500">{chartMeta.title}</p>
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {(
              [
                ['tl', 'Tutar (TL)'],
                ['electric_qty', 'Elektrik (kWh)'],
                ['gas_qty', 'Doğalgaz (m³)'],
                ['water_qty', 'Su (m³)'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setChartMetric(key)}
                className={`rounded-xl px-3 py-1.5 text-xs font-bold transition ${
                  chartMetric === key
                    ? 'bg-turquoise text-white shadow-sm'
                    : 'border border-slate-200 bg-canvas text-slate-700 hover:bg-slate-100'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Seçili / Üzerine Gelinen Ay İnceleme Şeridi */}
        {activeInspectPoint && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-canvas px-4 py-2.5 text-xs">
            <div className="font-extrabold text-navy">
              {activeInspectPoint.fullLabel} {year} Detayı:
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <span>
                Bütçe:{' '}
                <strong className="text-navy">
                  {chartMeta.isQty
                    ? `${fmtQty(activeInspectPoint.budgetVal)} ${chartMeta.unit}`
                    : `${fmtTl(activeInspectPoint.budgetVal)} ₺`}
                </strong>
              </span>
              <span>
                Gerçekleşen:{' '}
                <strong className="text-turquoise">
                  {chartMeta.isQty
                    ? `${fmtQty(activeInspectPoint.actualVal)} ${chartMeta.unit}`
                    : `${fmtTl(activeInspectPoint.actualVal)} ₺`}
                </strong>
              </span>
              <span>
                Önceki Yıl:{' '}
                <strong className="text-slate-600">
                  {chartMeta.isQty
                    ? `${fmtQty(activeInspectPoint.prevVal)} ${chartMeta.unit}`
                    : `${fmtTl(activeInspectPoint.prevVal)} ₺`}
                </strong>
              </span>
              <span>
                Sapma:{' '}
                <strong
                  className={
                    activeInspectPoint.diffPct === null
                      ? 'text-slate-400'
                      : activeInspectPoint.diffPct > 0
                      ? 'text-red-600'
                      : 'text-emerald-600'
                  }
                >
                  {activeInspectPoint.diffPct !== null
                    ? `${activeInspectPoint.diffPct >= 0 ? '+' : ''}${activeInspectPoint.diffPct.toFixed(1)}%`
                    : '-'}
                </strong>
              </span>
            </div>
          </div>
        )}

        {/* 12 Aylık Gruplanmış Çubuk Grafik (SVG) */}
        <div className="mt-4 overflow-x-auto">
          <div className="min-w-[680px]">
            <svg viewBox="0 0 920 250" className="h-64 w-full select-none">
              {/* Gösterge (Legend) */}
              <g transform="translate(58, 8)">
                <rect x="0" y="0" width="10" height="10" rx="2" fill="#17365D" />
                <text x="15" y="9" fontSize="11" fontWeight="700" fill="#334155">
                  Bütçe ({chartMeta.unit})
                </text>
                <rect x="130" y="0" width="10" height="10" rx="2" fill="#0E7490" />
                <text x="145" y="9" fontSize="11" fontWeight="700" fill="#334155">
                  Gerçekleşen (Bütçe İçi)
                </text>
                <rect x="295" y="0" width="10" height="10" rx="2" fill="#DC2626" />
                <text x="310" y="9" fontSize="11" fontWeight="700" fill="#334155">
                  Gerçekleşen (Bütçe Aşımı)
                </text>
                <rect x="480" y="0" width="10" height="10" rx="2" fill="#94A3B8" />
                <text x="495" y="9" fontSize="11" fontWeight="700" fill="#334155">
                  Önceki Yıl ({year - 1})
                </text>
              </g>

              {/* Y Ekseni Kılavuz Çizgileri */}
              {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
                const padTop = 30;
                const plotH = 182;
                const y = padTop + plotH * (1 - ratio);
                const val = chartMeta.niceMax * ratio;
                return (
                  <g key={ratio}>
                    <line
                      x1="58"
                      y1={y}
                      x2="902"
                      y2={y}
                      stroke="#E2E8F0"
                      strokeDasharray="3 3"
                    />
                    <text
                      x="50"
                      y={y + 3}
                      textAnchor="end"
                      fontSize="10"
                      fill="#64748B"
                    >
                      {formatCompactAxis(val)}
                    </text>
                  </g>
                );
              })}

              <line x1="58" y1="212" x2="902" y2="212" stroke="#CBD5E1" strokeWidth="1.2" />

              {/* 12 Ay Grupları */}
              {chartMeta.points.map((p, idx) => {
                const padLeft = 58;
                const plotW = 844;
                const padTop = 30;
                const plotH = 182;
                const groupW = plotW / 12;
                const barW = 13;
                const gx = padLeft + idx * groupW;
                const centerX = gx + groupW / 2;
                const startX = centerX - (barW * 3 + 6) / 2;

                const hBudget = (p.budgetVal / chartMeta.niceMax) * plotH;
                const hActual = (p.actualVal / chartMeta.niceMax) * plotH;
                const hPrev = (p.prevVal / chartMeta.niceMax) * plotH;
                const isOver = p.budgetVal > 0 && p.actualVal > p.budgetVal;
                const isActive =
                  hoveredMonth === p.monthNum || (hoveredMonth === null && month === p.monthNum);

                return (
                  <g
                    key={p.monthNum}
                    className="cursor-pointer"
                    onMouseEnter={() => setHoveredMonth(p.monthNum)}
                    onMouseLeave={() => setHoveredMonth(null)}
                    onClick={() => setMonth(month === p.monthNum ? 0 : p.monthNum)}
                  >
                    <rect
                      x={gx + 3}
                      y={padTop}
                      width={groupW - 6}
                      height={plotH}
                      rx="6"
                      fill={isActive ? '#EFF6FF' : 'transparent'}
                    />
                    <rect
                      x={startX}
                      y={padTop + plotH - hBudget}
                      width={barW}
                      height={Math.max(2, hBudget)}
                      rx="3"
                      fill="#17365D"
                    />
                    <rect
                      x={startX + barW + 3}
                      y={padTop + plotH - hActual}
                      width={barW}
                      height={Math.max(2, hActual)}
                      rx="3"
                      fill={isOver ? '#DC2626' : '#0E7490'}
                    />
                    <rect
                      x={startX + (barW + 3) * 2}
                      y={padTop + plotH - hPrev}
                      width={barW}
                      height={Math.max(2, hPrev)}
                      rx="3"
                      fill="#94A3B8"
                    />
                    {p.diffPct !== null && (
                      <text
                        x={centerX}
                        y={243}
                        textAnchor="middle"
                        fontSize="9"
                        fontWeight="700"
                        fill={p.diffPct > 0 ? '#DC2626' : '#059669'}
                      >
                        {p.diffPct >= 0 ? '+' : ''}
                        {p.diffPct.toFixed(0)}%
                      </text>
                    )}
                    <text
                      x={centerX}
                      y={229}
                      textAnchor="middle"
                      fontSize="11"
                      fontWeight={isActive ? '800' : '600'}
                      fill={isActive ? '#17365D' : '#475569'}
                    >
                      {p.shortLabel}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        </div>

        {/* Aylık Analiz İçgörüleri */}
        <div className="mt-4 grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-3">
          <div className="rounded-xl bg-canvas p-3">
            <div className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400">
              En Yüksek Sapma Ayı
            </div>
            {chartMeta.highestDeviationMonth ? (
              <div className="mt-1 flex items-center gap-2">
                {(chartMeta.highestDeviationMonth.diffPct ?? 0) > 0 ? (
                  <TrendingUp className="h-4 w-4 text-red-600" />
                ) : (
                  <TrendingDown className="h-4 w-4 text-emerald-600" />
                )}
                <span className="text-sm font-extrabold text-slate-900">
                  {chartMeta.highestDeviationMonth.fullLabel} (
                  {(chartMeta.highestDeviationMonth.diffPct ?? 0) >= 0 ? '+' : ''}
                  {(chartMeta.highestDeviationMonth.diffPct ?? 0).toFixed(1)}%)
                </span>
              </div>
            ) : (
              <div className="mt-1 text-xs text-slate-400">Karşılaştırma verisi bekleniyor</div>
            )}
          </div>

          <div className="rounded-xl bg-canvas p-3">
            <div className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400">
              Geçmiş Yıl Değişimi ({year - 1} vs {year})
            </div>
            {chartMeta.yoyOverallPct !== null ? (
              <div className="mt-1 text-sm font-extrabold text-slate-900">
                <span
                  className={
                    chartMeta.yoyOverallPct > 0 ? 'text-red-600' : 'text-emerald-600'
                  }
                >
                  {chartMeta.yoyOverallPct >= 0 ? '+' : ''}
                  {chartMeta.yoyOverallPct.toFixed(1)}%
                </span>{' '}
                <span className="text-xs font-medium text-slate-500">
                  ({chartMeta.yoyComparableCount} kıyaslanabilir ay)
                </span>
              </div>
            ) : (
              <div className="mt-1 text-xs text-slate-400">
                Geçmiş yıl gerçekleşen baz verisi girilmemiş
              </div>
            )}
          </div>

          <div className="rounded-xl bg-canvas p-3">
            <div className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400">
              Bütçe Gerçekleşme Oranı
            </div>
            {chartMeta.realizationRatio !== null ? (
              <div className="mt-1 text-sm font-extrabold text-navy">
                %{chartMeta.realizationRatio.toFixed(1)}{' '}
                <span className="text-xs font-medium text-slate-500">
                  ({chartMeta.underBudgetCount} ay içi · {chartMeta.overBudgetCount} ay aşım)
                </span>
              </div>
            ) : (
              <div className="mt-1 text-xs text-slate-400">Fatura gerçekleşme verisi yok</div>
            )}
          </div>
        </div>
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

      {/* Ekle / Düzenle Modal */}
      {formModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h2 className="text-lg font-extrabold text-slate-900">
                {formModal.id ? 'Bütçe Kaydını Düzenle' : 'Yeni Bütçe Kaydı Ekle'}
              </h2>
              <button
                type="button"
                onClick={() => setFormModal(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSaveModal} className="mt-4 space-y-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-600">Enerji Türü</label>
                  <select
                    value={formModal.utility_type}
                    onChange={(e) =>
                      setFormModal({
                        ...formModal,
                        utility_type: e.target.value as UtilityType,
                      })
                    }
                    className="w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm font-semibold text-slate-800 focus:border-navy focus:outline-none"
                  >
                    <option value="electric">Elektrik</option>
                    <option value="gas">Doğalgaz</option>
                    <option value="water">Su</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-600">Yıl</label>
                  <input
                    type="number"
                    required
                    value={formModal.period_year}
                    onChange={(e) => setFormModal({ ...formModal, period_year: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm font-semibold text-slate-800 focus:border-navy focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-600">Ay</label>
                  <select
                    value={formModal.period_month}
                    onChange={(e) => setFormModal({ ...formModal, period_month: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm font-semibold text-slate-800 focus:border-navy focus:outline-none"
                  >
                    {MONTHS.slice(1).map((m, idx) => (
                      <option key={m} value={idx + 1}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-600">
                    Bütçe Miktar ({utilityUnit(formModal.utility_type)})
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={formModal.budget_consumption}
                    onChange={(e) =>
                      setFormModal({ ...formModal, budget_consumption: e.target.value })
                    }
                    className="w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm focus:border-navy focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-600">Bütçe (TL)</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={formModal.budget_tl}
                    onChange={(e) => setFormModal({ ...formModal, budget_tl: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm focus:border-navy focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-600">
                    Önceki Yıl Miktar ({utilityUnit(formModal.utility_type)})
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={formModal.prev_year_consumption}
                    onChange={(e) =>
                      setFormModal({ ...formModal, prev_year_consumption: e.target.value })
                    }
                    className="w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm focus:border-navy focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-600">
                    Önceki Yıl (TL)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={formModal.prev_year_tl}
                    onChange={(e) => setFormModal({ ...formModal, prev_year_tl: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm focus:border-navy focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setFormModal(null)}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-xl bg-navy px-5 py-2 text-xs font-bold text-white hover:bg-navy-hover disabled:opacity-50"
                >
                  {saving ? 'Kaydediliyor...' : 'Kaydet'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

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

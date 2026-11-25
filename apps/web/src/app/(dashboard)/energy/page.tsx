'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  Droplets,
  FileDown,
  FileSpreadsheet,
  Flame,
  Snowflake,
  TrendingUp,
  Zap,
} from 'lucide-react';
import { createClient } from '@/core/supabase/client';
import { formatDate, formatDateTime } from '@/core/constants';
import { useDashboardAuth } from '@/core/DashboardContext';
import { hasModulePermission } from '@/core/permissions';
import {
  exportExcelXml,
  exportPrintablePdf,
  ReportCell,
} from '@/core/utils/report-export';

type DashboardItem = {
  meter_id: string;
  meter_name: string;
  meter_type: 'electric' | 'mechanical';
  category: string;
  multiplier: number;
  equipment_code: string | null;
  equipment_name: string | null;
  latest_reading_date: string | null;
  latest_consumption: number | null;
  latest_inductive_percent: number | null;
  latest_capacitive_percent: number | null;
  monthly_total_consumption: number;
};

type RecentReadingRow = {
  reading_date: string;
  meter_id: string;
  consumption: number;
  meters?: {
    name: string;
    meter_type: 'electric' | 'mechanical';
    category: string;
  } | null;
};

type TrendCategory = 'electric' | 'water' | 'gas' | 'cooling';

const MONTHS = [
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

const TREND_META: Record<TrendCategory, { label: string; unit: string; color: string }> = {
  electric: { label: 'Elektrik', unit: 'kWh', color: '#17365D' },
  water: { label: 'Şebeke Suyu', unit: 'm³', color: '#0284C7' },
  gas: { label: 'Doğalgaz', unit: 'm³', color: '#DC2626' },
  cooling: { label: 'Soğutma Kulesi', unit: 'm³', color: '#0E7490' },
};

function categoryLabel(cat: string): string {
  if (cat === 'electric') return 'Elektrik';
  if (cat === 'water') return 'Şebeke Suyu';
  if (cat === 'gas') return 'Doğalgaz';
  if (cat === 'cooling') return 'Soğutma';
  return 'Diğer';
}

function buildTrendSvgMarkup(
  series: Array<{ dateKey: string; label: string; value: number }>,
  unit: string,
  color: string
): string {
  if (series.length === 0) return '';
  const width = 920;
  const height = 210;
  const padLeft = 56;
  const padRight = 16;
  const padTop = 18;
  const padBottom = 34;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;
  const maxVal = Math.max(1, ...series.map((s) => s.value)) * 1.12;
  const stepX = plotW / Math.max(1, series.length);
  const barW = Math.max(6, Math.min(20, stepX * 0.65));

  const grid = [0, 0.5, 1]
    .map((ratio) => {
      const y = padTop + plotH * (1 - ratio);
      const val = Math.round(maxVal * ratio);
      return `<line x1="${padLeft}" y1="${y.toFixed(1)}" x2="${
        width - padRight
      }" y2="${y.toFixed(1)}" stroke="#E2E8F0" stroke-dasharray="3 3" />
      <text x="${padLeft - 6}" y="${(y + 3).toFixed(
        1
      )}" text-anchor="end" font-size="10" fill="#64748B" font-family="Arial, sans-serif">${val}</text>`;
    })
    .join('\n');

  const bars = series
    .map((pt, i) => {
      const cx = padLeft + i * stepX + stepX / 2;
      const h = (pt.value / maxVal) * plotH;
      const showLabel = i === 0 || i === series.length - 1 || i % 5 === 0;
      return `<rect x="${(cx - barW / 2).toFixed(1)}" y="${(padTop + plotH - h).toFixed(
        1
      )}" width="${barW.toFixed(1)}" height="${Math.max(2, h).toFixed(
        1
      )}" rx="2" fill="${color}" />
      ${
        showLabel
          ? `<text x="${cx.toFixed(1)}" y="${
              height - 12
            }" text-anchor="middle" font-size="9.5" fill="#475569" font-family="Arial, sans-serif">${
              pt.label
            }</text>`
          : ''
      }`;
    })
    .join('\n');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">
    ${grid}
    <line x1="${padLeft}" y1="${padTop + plotH}" x2="${width - padRight}" y2="${
    padTop + plotH
  }" stroke="#CBD5E1" />
    ${bars}
    <text x="${width - padRight}" y="12" text-anchor="end" font-size="10" font-weight="700" fill="#334155" font-family="Arial, sans-serif">Birim: ${unit}</text>
  </svg>`;
}

export default function EnergyOverviewPage() {
  const { profile } = useDashboardAuth();
  const canReports = hasModulePermission(profile, 'energy', 'reports');
  const canManage = hasModulePermission(profile, 'energy', 'manage');
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [items, setItems] = useState<DashboardItem[]>([]);
  const [recentReadings, setRecentReadings] = useState<RecentReadingRow[]>([]);
  const [trendCat, setTrendCat] = useState<TrendCategory>('electric');
  const [hoveredDay, setHoveredDay] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [settingUp, setSettingUp] = useState(false);

  const loadSummary = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const since = new Date();
      since.setDate(since.getDate() - 30);

      const [sumRes, recRes] = await Promise.all([
        supabase.rpc('rpc_energy_dashboard_summary', {
          p_year: year,
          p_month: month,
        }),
        supabase
          .from('meter_readings')
          .select('reading_date, meter_id, consumption, meters!inner(name, meter_type, category, deleted_at)')
          .is('meters.deleted_at', null)
          .gte('reading_date', since.toISOString())
          .order('reading_date', { ascending: true })
          .limit(1000),
      ]);
      if (sumRes.error) throw sumRes.error;
      setItems((sumRes.data as DashboardItem[]) ?? []);
      if (recRes.data) {
        setRecentReadings(recRes.data as unknown as RecentReadingRow[]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Enerji özeti yüklenemedi.');
    } finally {
      setLoading(false);
    }
  }, [year, month]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  async function setupDefaults() {
    setSettingUp(true);
    try {
      const supabase = createClient();
      const { error: rpcErr } = await supabase.rpc('rpc_setup_default_meters');
      if (rpcErr) throw rpcErr;
      await loadSummary();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sayaçlar kurulamadı.');
    } finally {
      setSettingUp(false);
    }
  }

  const sumByCategory = (cat: string) =>
    items
      .filter((i) => i.category === cat)
      .reduce((s, i) => s + Number(i.monthly_total_consumption || 0), 0);

  const electricItems = useMemo(
    () => items.filter((i) => i.meter_type === 'electric'),
    [items]
  );

  const mechanicalItems = useMemo(
    () => items.filter((i) => i.meter_type === 'mechanical'),
    [items]
  );

  const penaltyRows = useMemo(
    () =>
      items.filter(
        (i) =>
          i.meter_type === 'electric' &&
          (Number(i.latest_inductive_percent || 0) > 20 ||
            Number(i.latest_capacitive_percent || 0) > 15)
      ),
    [items]
  );

  // Son 30 gün okuma ortalamasına göre > 1.5x sıçrama gösteren sayaçlar
  const anomalyRows = useMemo(() => {
    const grouped = new Map<
      string,
      { name: string; unit: string; values: number[]; latestVal: number; latestDate: string }
    >();

    for (const r of recentReadings) {
      const val = Number(r.consumption || 0);
      if (val <= 0) continue;
      const g = grouped.get(r.meter_id) ?? {
        name: r.meters?.name ?? 'Sayaç',
        unit: r.meters?.meter_type === 'electric' ? 'kWh' : 'm³',
        values: [],
        latestVal: val,
        latestDate: r.reading_date,
      };
      g.values.push(val);
      if (new Date(r.reading_date).getTime() >= new Date(g.latestDate).getTime()) {
        g.latestVal = val;
        g.latestDate = r.reading_date;
      }
      grouped.set(r.meter_id, g);
    }

    const alerts: Array<{
      meterId: string;
      meterName: string;
      unit: string;
      latestVal: number;
      avgVal: number;
      ratio: number;
      latestDate: string;
    }> = [];

    for (const [meterId, g] of Array.from(grouped.entries())) {
      if (g.values.length < 3) continue;
      const avg = g.values.reduce((a, b) => a + b, 0) / g.values.length;
      if (avg > 0 && g.latestVal > avg * 1.5) {
        alerts.push({
          meterId,
          meterName: g.name,
          unit: g.unit,
          latestVal: g.latestVal,
          avgVal: avg,
          ratio: g.latestVal / avg,
          latestDate: g.latestDate,
        });
      }
    }

    return alerts.sort((a, b) => b.ratio - a.ratio);
  }, [recentReadings]);

  // Seçili kategori için son 30 gün günlük tüketim serisi
  const trendSeries = useMemo(() => {
    const dayMap = new Map<string, number>();
    for (const r of recentReadings) {
      const cat = r.meters?.category;
      if (cat !== trendCat) continue;
      const key = r.reading_date.slice(0, 10);
      dayMap.set(key, (dayMap.get(key) ?? 0) + Number(r.consumption || 0));
    }

    const list = Array.from(dayMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([dateKey, value]) => ({
        dateKey,
        label: `${dateKey.slice(8, 10)}.${dateKey.slice(5, 7)}`,
        value,
      }));

    const total = list.reduce((s, x) => s + x.value, 0);
    const avg = list.length > 0 ? total / list.length : 0;
    const max = list.reduce((m, x) => Math.max(m, x.value), 0);

    return { list, total, avg, max };
  }, [recentReadings, trendCat]);

  const activeTrendPoint = useMemo(() => {
    if (hoveredDay) return trendSeries.list.find((x) => x.dateKey === hoveredDay) ?? null;
    return trendSeries.list[trendSeries.list.length - 1] ?? null;
  }, [trendSeries.list, hoveredDay]);

  const fmt = (n: number) =>
    new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 }).format(n);

  function buildExportData() {
    const headers = [
      'Sayaç',
      'Tür',
      'Kategori',
      'Çarpan',
      'Bağlı Ekipman',
      'Son Okuma',
      'Aylık Toplam',
      'Birim',
      'İndüktif (%)',
      'Kapasitif (%)',
      'Reaktif Durum',
    ];
    const exportRows: ReportCell[][] = items.map((item) => {
      const isElec = item.meter_type === 'electric';
      const ind = Number(item.latest_inductive_percent || 0);
      const cap = Number(item.latest_capacitive_percent || 0);
      const penalty = isElec && (ind > 20 || cap > 15);
      return [
        item.meter_name,
        isElec ? 'Elektrik' : 'Mekanik',
        categoryLabel(item.category),
        item.multiplier,
        item.equipment_name
          ? `${item.equipment_code ?? ''} - ${item.equipment_name}`
          : '-',
        formatDateTime(item.latest_reading_date),
        Number(Number(item.monthly_total_consumption || 0).toFixed(2)),
        isElec ? 'kWh' : 'm³',
        isElec ? ind : '-',
        isElec ? cap : '-',
        isElec ? (penalty ? 'Ceza Sınırı Aşıldı' : 'Normal') : '-',
      ];
    });
    return { headers, exportRows };
  }

  function handleExportExcel() {
    const { headers, exportRows } = buildExportData();
    exportExcelXml({
      fileName: `avm_tech_enerji_ozeti_${year}_${String(month).padStart(2, '0')}.xls`,
      sheetName: `Enerji_${MONTHS[month - 1]}`,
      title: `DOWNTOWN TEKNİK · Enerji Tüketim Özeti (${MONTHS[month - 1]} ${year})`,
      subtitle: `${items.length} aktif sayaç · Reaktif ceza sınırları: İndüktif >%20, Kapasitif >%15`,
      headers,
      rows: exportRows,
    });
  }

  function handleExportPdf() {
    const { headers, exportRows } = buildExportData();
    const meta = TREND_META[trendCat];
    const chartSvgHtml = buildTrendSvgMarkup(trendSeries.list, meta.unit, meta.color);
    exportPrintablePdf({
      title: `Enerji Tüketim Özeti & Reaktif Durum Raporu (${MONTHS[month - 1]} ${year})`,
      subtitle: `${items.length} sayaç · Ceza riski taşıyan sayaç: ${penaltyRows.length} · Tüketim sıçrama uyarısı: ${anomalyRows.length}`,
      kpis: [
        { label: 'Elektrik Toplam', value: `${fmt(sumByCategory('electric'))} kWh`, tone: 'navy' },
        { label: 'Şebeke Suyu', value: `${fmt(sumByCategory('water'))} m³`, tone: 'slate' },
        { label: 'Soğutma Kulesi', value: `${fmt(sumByCategory('cooling'))} m³`, tone: 'slate' },
        {
          label: 'Doğalgaz',
          value: `${fmt(sumByCategory('gas'))} m³`,
          tone: 'slate',
        },
      ],
      chartTitle: `Son 30 Günlük ${meta.label} Tüketim Trendi (${meta.unit})`,
      chartSvgHtml,
      headers,
      rows: exportRows,
    });
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400">
            ENERJİ TAKİP MODÜLÜ
          </div>
          <h1 className="mt-0.5 text-2xl font-extrabold text-slate-900">
            Enerji Takip – Genel Bakış
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Aylık tüketim özeti, 30 günlük trend, reaktif güç & anomali monitörü.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-800"
          >
            {MONTHS.map((m, idx) => (
              <option key={m} value={idx + 1}>
                {m}
              </option>
            ))}
          </select>
          <input
            type="number"
            value={year}
            onChange={(e) => setYear(Number(e.target.value) || now.getFullYear())}
            className="w-20 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-800"
          />
          <Link
            href="/energy/meters"
            className="rounded-xl bg-navy px-3.5 py-2 text-xs font-bold text-white hover:bg-navy-hover"
          >
            Sayaçlar
          </Link>
          {canReports && (
            <>
              <button
                type="button"
                onClick={handleExportExcel}
                disabled={items.length === 0}
                className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800 hover:bg-emerald-100 disabled:opacity-40"
              >
                <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-700" />
                Excel (.xls)
              </button>
              <button
                type="button"
                onClick={handleExportPdf}
                disabled={items.length === 0}
                className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-800 hover:bg-rose-100 disabled:opacity-40"
              >
                <FileDown className="h-3.5 w-3.5 text-rose-700" />
                PDF Rapor
              </button>
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Supabase bağlantısı veya yetki kontrolü: {error}
        </div>
      )}

      {!loading && items.length === 0 && (
        <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-5">
          <div className="text-sm text-slate-600">
            {canManage
              ? 'Sistemde henüz tanımlı sayaç bulunmuyor. Ön tanımlı AVM sayaçlarını tek tıkla kurabilirsiniz.'
              : 'Sistemde henüz tanımlı sayaç bulunmuyor.'}
          </div>
          {canManage && (
            <button
              onClick={setupDefaults}
              disabled={settingUp}
              className="rounded-xl bg-navy px-4 py-2 text-xs font-bold text-white hover:bg-navy-hover disabled:opacity-50"
            >
              {settingUp ? 'Kuruluyor...' : 'Varsayılan Sayaçları Kur'}
            </button>
          )}
        </div>
      )}

      {/* 4 Kategori KPI Kartları */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-extrabold uppercase tracking-wide text-slate-500">
              Elektrik
            </span>
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-100 text-amber-600">
              <Zap className="h-4 w-4" />
            </span>
          </div>
          <div className="mt-2.5 text-2xl font-extrabold text-slate-900">
            {loading ? '...' : fmt(sumByCategory('electric'))}{' '}
            <span className="text-xs font-semibold text-slate-500">kWh</span>
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-extrabold uppercase tracking-wide text-slate-500">
              Şebeke Suyu
            </span>
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-sky-100 text-sky-600">
              <Droplets className="h-4 w-4" />
            </span>
          </div>
          <div className="mt-2.5 text-2xl font-extrabold text-slate-900">
            {loading ? '...' : fmt(sumByCategory('water'))}{' '}
            <span className="text-xs font-semibold text-slate-500">m³</span>
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-extrabold uppercase tracking-wide text-slate-500">
              Soğutma Kulesi
            </span>
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-turquoise-soft text-turquoise">
              <Snowflake className="h-4 w-4" />
            </span>
          </div>
          <div className="mt-2.5 text-2xl font-extrabold text-slate-900">
            {loading ? '...' : fmt(sumByCategory('cooling'))}{' '}
            <span className="text-xs font-semibold text-slate-500">m³</span>
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-extrabold uppercase tracking-wide text-slate-500">
              Doğalgaz
            </span>
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-red-100 text-red-600">
              <Flame className="h-4 w-4" />
            </span>
          </div>
          <div className="mt-2.5 text-2xl font-extrabold text-slate-900">
            {loading ? '...' : fmt(sumByCategory('gas'))}{' '}
            <span className="text-xs font-semibold text-slate-500">m³</span>
          </div>
        </div>
      </div>

      {/* Akıllı Uyarılar: Reaktif Ceza + Tüketim Sıçrama Anomalisi */}
      {(penaltyRows.length > 0 || anomalyRows.length > 0) && (
        <div className="grid gap-4 lg:grid-cols-2">
          {penaltyRows.length > 0 && (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4">
              <div className="flex items-center gap-2 text-sm font-extrabold text-red-700">
                <AlertTriangle className="h-4 w-4" />
                Reaktif Güç Ceza Uyarısı ({penaltyRows.length} Sayaç)
              </div>
              <p className="mt-0.5 text-xs text-red-600">
                Sınır: İndüktif &gt; %20 veya Kapasitif &gt; %15
              </p>
              <ul className="mt-2 space-y-1 text-xs text-red-900">
                {penaltyRows.map((p) => (
                  <li key={p.meter_id} className="flex justify-between rounded-lg bg-white/70 px-2.5 py-1.5">
                    <strong>{p.meter_name}</strong>
                    <span>
                      İndüktif: <b>%{p.latest_inductive_percent ?? 0}</b> · Kapasitif:{' '}
                      <b>%{p.latest_capacitive_percent ?? 0}</b>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {anomalyRows.length > 0 && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <div className="flex items-center gap-2 text-sm font-extrabold text-amber-800">
                <TrendingUp className="h-4 w-4" />
                Anormal Tüketim Artışı ({anomalyRows.length} Sayaç)
              </div>
              <p className="mt-0.5 text-xs text-amber-700">
                Son 30 günlük ortalamanın 1,5 katını aşan son günlük okumalar
              </p>
              <ul className="mt-2 space-y-1 text-xs text-amber-950">
                {anomalyRows.map((a) => (
                  <li key={a.meterId} className="flex justify-between rounded-lg bg-white/70 px-2.5 py-1.5">
                    <span>
                      <strong>{a.meterName}</strong> ({formatDate(a.latestDate)})
                    </span>
                    <span>
                      Son: <b>{fmt(a.latestVal)}</b> vs Ort: {fmt(a.avgVal)} {a.unit} (
                      <b>{a.ratio.toFixed(1)}x</b>)
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Son 30 Günlük Tüketim Trend Grafiği */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-extrabold text-navy">
              Son 30 Günlük Tüketim Trendi ({TREND_META[trendCat].label})
            </h2>
            <p className="text-xs text-slate-500">
              30 Gün Toplam: <strong>{fmt(trendSeries.total)} {TREND_META[trendCat].unit}</strong>{' '}
              · Günlük Ort.: <strong>{fmt(trendSeries.avg)} {TREND_META[trendCat].unit}</strong>
              {activeTrendPoint &&
                ` · Seçili (${activeTrendPoint.label}): ${fmt(activeTrendPoint.value)} ${
                  TREND_META[trendCat].unit
                }`}
            </p>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {(['electric', 'water', 'gas', 'cooling'] as TrendCategory[]).map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setTrendCat(cat)}
                className={`rounded-full px-3.5 py-1.5 text-xs font-bold transition ${
                  trendCat === cat
                    ? 'bg-navy text-white shadow-sm'
                    : 'border border-slate-200 bg-canvas text-slate-700 hover:bg-slate-100'
                }`}
              >
                {TREND_META[cat].label} ({TREND_META[cat].unit})
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          {trendSeries.list.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 bg-canvas p-8 text-center text-xs text-slate-400">
              Son 30 gün içinde bu kategoriye ait okuma kaydı bulunamadı.
            </div>
          ) : (
            <div className="min-w-[660px]">
              <svg viewBox="0 0 920 210" className="h-52 w-full select-none">
                {[0, 0.5, 1].map((ratio) => {
                  const y = 18 + 158 * (1 - ratio);
                  const maxV = Math.max(1, trendSeries.max) * 1.12;
                  return (
                    <g key={ratio}>
                      <line
                        x1="56"
                        y1={y}
                        x2="904"
                        y2={y}
                        stroke="#E2E8F0"
                        strokeDasharray="3 3"
                      />
                      <text x="48" y={y + 3} textAnchor="end" fontSize="10" fill="#64748B">
                        {fmt(Math.round(maxV * ratio))}
                      </text>
                    </g>
                  );
                })}
                <line x1="56" y1="176" x2="904" y2="176" stroke="#CBD5E1" />
                {trendSeries.list.map((pt, i) => {
                  const plotW = 848;
                  const plotH = 158;
                  const stepX = plotW / Math.max(1, trendSeries.list.length);
                  const barW = Math.max(6, Math.min(20, stepX * 0.65));
                  const cx = 56 + i * stepX + stepX / 2;
                  const maxV = Math.max(1, trendSeries.max) * 1.12;
                  const h = (pt.value / maxV) * plotH;
                  const showLabel =
                    i === 0 || i === trendSeries.list.length - 1 || i % 5 === 0;
                  const isHover = hoveredDay === pt.dateKey;
                  return (
                    <g
                      key={pt.dateKey}
                      onMouseEnter={() => setHoveredDay(pt.dateKey)}
                      onMouseLeave={() => setHoveredDay(null)}
                      className="cursor-pointer"
                    >
                      <rect
                        x={cx - barW / 2}
                        y={18 + plotH - h}
                        width={barW}
                        height={Math.max(2, h)}
                        rx="3"
                        fill={isHover ? '#0E7490' : TREND_META[trendCat].color}
                      />
                      {showLabel && (
                        <text
                          x={cx}
                          y={196}
                          textAnchor="middle"
                          fontSize="10"
                          fill="#475569"
                        >
                          {pt.label}
                        </text>
                      )}
                    </g>
                  );
                })}
              </svg>
            </div>
          )}
        </div>
      </div>

      {/* Elektrik Sayaçları (Aktif Tüketim & Reaktif Güç Takibi) */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-5 py-3.5 text-sm font-extrabold text-navy">
          Elektrik Sayaçları ve Reaktif Durum ({MONTHS[month - 1]} {year})
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-canvas text-[11px] font-extrabold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">Sayaç</th>
                <th className="px-4 py-3">Bağlı Ekipman</th>
                <th className="px-4 py-3">Son Okuma</th>
                <th className="px-4 py-3">Aylık Toplam (kWh)</th>
                <th className="px-4 py-3">Reaktif (%İnd / %Kap)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {electricItems.map((item) => {
                const ind = Number(item.latest_inductive_percent || 0);
                const cap = Number(item.latest_capacitive_percent || 0);
                const indHigh = ind > 20;
                const capHigh = cap > 15;
                return (
                  <tr key={item.meter_id} className="hover:bg-canvas/60">
                    <td className="px-4 py-3 font-bold text-navy">{item.meter_name}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {item.equipment_name
                        ? `${item.equipment_code ?? ''} - ${item.equipment_name}`
                        : '-'}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {formatDateTime(item.latest_reading_date)}
                    </td>
                    <td className="px-4 py-3 font-extrabold text-slate-900">
                      {fmt(Number(item.monthly_total_consumption || 0))} kWh
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`rounded px-1.5 py-0.5 font-bold ${
                            indHigh
                              ? 'bg-red-100 text-red-700'
                              : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          İnd %{ind}
                        </span>
                        <span
                          className={`rounded px-1.5 py-0.5 font-bold ${
                            capHigh
                              ? 'bg-red-100 text-red-700'
                              : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          Kap %{cap}
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {electricItems.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                    {loading ? 'Yükleniyor...' : 'Elektrik sayacı kaydı yok.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mekanik Sayaçlar (Yalnızca Endeks Bazlı Tüketim - m³) */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-5 py-3.5 text-sm font-extrabold text-navy">
          Mekanik Sayaçlar – Su / Doğalgaz / Soğutma ({MONTHS[month - 1]} {year})
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-canvas text-[11px] font-extrabold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">Sayaç</th>
                <th className="px-4 py-3">Kategori</th>
                <th className="px-4 py-3">Bağlı Ekipman</th>
                <th className="px-4 py-3">Son Okuma</th>
                <th className="px-4 py-3">Aylık Toplam (m³)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {mechanicalItems.map((item) => (
                <tr key={item.meter_id} className="hover:bg-canvas/60">
                  <td className="px-4 py-3 font-bold text-navy">{item.meter_name}</td>
                  <td className="px-4 py-3 text-slate-700">
                    {categoryLabel(item.category)}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {item.equipment_name
                      ? `${item.equipment_code ?? ''} - ${item.equipment_name}`
                      : '-'}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {formatDateTime(item.latest_reading_date)}
                  </td>
                  <td className="px-4 py-3 font-extrabold text-slate-900">
                    {fmt(Number(item.monthly_total_consumption || 0))} m³
                  </td>
                </tr>
              ))}
              {mechanicalItems.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                    {loading ? 'Yükleniyor...' : 'Mekanik sayaç kaydı yok.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

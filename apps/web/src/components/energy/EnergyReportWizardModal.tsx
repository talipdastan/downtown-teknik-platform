'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Calendar,
  Check,
  FileDown,
  FileSpreadsheet,
  Filter,
  Layers,
  Sparkles,
  X,
} from 'lucide-react';
import { EnergyBudget, EnergyInvoice, Meter, UtilityType } from '@/types/database';
import {
  applyReportPreset,
  buildEnergyExcelWorkbook,
  buildEnergyPdfReportOptions,
  createDefaultEnergyReportConfig,
  describeReportPeriod,
  EnergyAmountBasis,
  EnergyInvoiceKindFilter,
  EnergyPeriodMode,
  EnergyReportConfig,
  EnergyReportLayoutStyle,
  EnergyReportPreset,
  filterBudgetsForReport,
  filterInvoicesForReport,
  MONTH_NAMES_TR,
  utilityLabelTr,
} from '@/core/utils/energy-report-builder';
import { exportExcelWorkbook, exportPrintablePdf } from '@/core/utils/report-export';

interface EnergyReportWizardModalProps {
  open: boolean;
  onClose: () => void;
  defaultYear: number;
  defaultMonthFilter?: number;
  defaultUtilityFilter?: 'all' | UtilityType;
  defaultPreset?: EnergyReportPreset;
  invoices: EnergyInvoice[];
  budgets: EnergyBudget[];
  meters?: Meter[];
  onYearChange?: (newYear: number) => void;
}

const PRESET_CARDS: Array<{
  key: EnergyReportPreset;
  title: string;
  desc: string;
  badge: string;
}> = [
  {
    key: 'executive',
    title: 'Kurumsal Yönetici Özeti',
    desc: 'Çok sekmeli kitap: Yönetici Özeti, Elektrik, Doğalgaz/Su, Bütçe Sapma ve Sayaç Kırılımı.',
    badge: 'Önerilen',
  },
  {
    key: 'budget_matrix',
    title: '12 Aylık Yatay Matris (Pivot)',
    desc: 'Ocak–Aralık sütunlu yönetim kurulu bütçe & gerçekleşen karşılaştırma tablosu.',
    badge: 'Sunum',
  },
  {
    key: 'accounting',
    title: 'Muhasebe & Finans Listesi',
    desc: 'Fatura No, Tarih, Abone/EIC/Sayaç No, Brüt Tutar, Kiracı Payı ve Net Tutar.',
    badge: 'Finans',
  },
  {
    key: 'technical_penalty',
    title: 'Teknik & Reaktif Ceza Denetimi',
    desc: 'Elektrik sayaçları, birim kWh maliyeti ve İndüktif/Kapasitif ceza kontrolü.',
    badge: 'Teknik',
  },
];

const PERIOD_MODES: Array<{ key: EnergyPeriodMode; label: string }> = [
  { key: 'full_year', label: 'Tüm Yıl (Ocak–Aralık)' },
  { key: 'ytd', label: 'Yıl Başından Bugüne (YTD)' },
  { key: 'single_month', label: 'Tek Ay Seçimi' },
  { key: 'q1', label: '1. Çeyrek (Oca–Mar)' },
  { key: 'q2', label: '2. Çeyrek (Nis–Haz)' },
  { key: 'q3', label: '3. Çeyrek (Tem–Eyl)' },
  { key: 'q4', label: '4. Çeyrek (Eki–Ara)' },
  { key: 'custom_range', label: 'Özel Ay Aralığı' },
];

export default function EnergyReportWizardModal({
  open,
  onClose,
  defaultYear,
  defaultMonthFilter = 0,
  defaultUtilityFilter = 'all',
  defaultPreset = 'executive',
  invoices,
  budgets,
  meters = [],
  onYearChange,
}: EnergyReportWizardModalProps) {
  const [config, setConfig] = useState<EnergyReportConfig>(() =>
    createDefaultEnergyReportConfig({
      year: defaultYear,
      monthFilter: defaultMonthFilter,
      utilityFilter: defaultUtilityFilter,
      defaultPreset,
    })
  );

  useEffect(() => {
    if (open) {
      setConfig(
        createDefaultEnergyReportConfig({
          year: defaultYear,
          monthFilter: defaultMonthFilter,
          utilityFilter: defaultUtilityFilter,
          defaultPreset,
        })
      );
    }
  }, [open, defaultYear, defaultMonthFilter, defaultUtilityFilter, defaultPreset]);

  const providers = useMemo(() => {
    const set = new Set<string>();
    for (const inv of invoices) {
      if (inv.provider?.trim()) set.add(inv.provider.trim());
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'tr'));
  }, [invoices]);

  const meterOptions = useMemo(() => {
    const names = new Set<string>();
    for (const m of meters) {
      if (m.name?.trim()) names.add(m.name.trim());
    }
    for (const inv of invoices) {
      if (inv.meter_name?.trim()) names.add(inv.meter_name.trim());
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b, 'tr'));
  }, [meters, invoices]);

  const matchedInvoices = useMemo(
    () => filterInvoicesForReport(invoices, config),
    [invoices, config]
  );
  const matchedBudgets = useMemo(
    () => filterBudgetsForReport(budgets, config),
    [budgets, config]
  );

  const previewSummary = useMemo(() => {
    const gross = matchedInvoices.reduce((s, i) => s + Number(i.amount_tl || 0), 0);
    const tenant = matchedInvoices.reduce((s, i) => s + Number(i.tenant_amount_tl || 0), 0);
    const net = matchedInvoices.reduce(
      (s, i) => s + Math.max(0, Number(i.amount_tl || 0) - Number(i.tenant_amount_tl || 0)),
      0
    );
    const budgetTl = matchedBudgets.reduce((s, b) => s + Number(b.budget_tl || 0), 0);
    const diffPct = budgetTl > 0 ? ((net - budgetTl) / budgetTl) * 100 : null;
    return { gross, tenant, net, budgetTl, diffPct };
  }, [matchedInvoices, matchedBudgets]);

  if (!open) return null;

  const hasElectric = config.utilities.includes('electric');
  const currentYear = new Date().getFullYear();
  const years = [currentYear - 2, currentYear - 1, currentYear, currentYear + 1];

  function toggleUtility(u: UtilityType) {
    setConfig((prev) => {
      const exists = prev.utilities.includes(u);
      const nextUtils = exists
        ? prev.utilities.filter((x) => x !== u)
        : [...prev.utilities, u];
      if (nextUtils.length === 0) return prev;
      return {
        ...prev,
        utilities: nextUtils,
        includeReactivePenalty: nextUtils.includes('electric')
          ? prev.includeReactivePenalty
          : false,
      };
    });
  }

  function handleExportExcel() {
    const wb = buildEnergyExcelWorkbook(invoices, budgets, config);
    exportExcelWorkbook(wb);
  }

  function handleExportPdf() {
    const pdfOpts = buildEnergyPdfReportOptions(invoices, budgets, config);
    exportPrintablePdf(pdfOpts);
  }

  const fmtTl = (n: number) =>
    new Intl.NumberFormat('tr-TR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-3 sm:p-5">
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        {/* Üst Başlık */}
        <div className="flex items-center justify-between border-b border-slate-200 bg-gradient-to-r from-navy to-navy-hover px-5 py-4 text-white">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15">
              <Sparkles className="h-5 w-5 text-cyan-200" />
            </div>
            <div>
              <div className="text-[10px] font-extrabold uppercase tracking-wider text-cyan-200">
                DOWNTOWN TEKNİK · AKILLI RAPOR SİHİRBAZI
              </div>
              <h2 className="text-base font-extrabold sm:text-lg">
                Enerji Fatura &amp; Bütçe Raporu Özelleştirme
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-white/10 p-2 text-white/80 transition hover:bg-white/20 hover:text-white"
            aria-label="Kapat"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Gövde */}
        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          {/* 1. Hazır Şablon Seçimi */}
          <div>
            <div className="mb-2 flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider text-navy">
              <Layers className="h-3.5 w-3.5 text-turquoise" />
              <span>1. Hazır Rapor Şablonu Seçin</span>
            </div>
            <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
              {PRESET_CARDS.map((card) => {
                const active = config.preset === card.key;
                return (
                  <button
                    key={card.key}
                    type="button"
                    onClick={() => setConfig((prev) => applyReportPreset(prev, card.key))}
                    className={`flex flex-col justify-between rounded-xl border p-3 text-left transition ${
                      active
                        ? 'border-navy bg-navy-soft/60 ring-2 ring-navy/20'
                        : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-extrabold text-navy">{card.title}</span>
                        <span
                          className={`rounded-md px-1.5 py-0.5 text-[10px] font-extrabold ${
                            active
                              ? 'bg-navy text-white'
                              : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {card.badge}
                        </span>
                      </div>
                      <p className="mt-1.5 text-[11px] leading-snug text-slate-600">
                        {card.desc}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 2. Tarih ve Dönem Seçimi */}
          <div className="rounded-2xl border border-slate-200 bg-canvas p-4">
            <div className="mb-3 flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider text-navy">
              <Calendar className="h-3.5 w-3.5 text-turquoise" />
              <span>2. Tarih &amp; Dönem Aralığı</span>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-700">Rapor Yılı</label>
                <select
                  value={config.year}
                  onChange={(e) => {
                    const y = Number(e.target.value);
                    setConfig((prev) => ({ ...prev, year: y }));
                    onYearChange?.(y);
                  }}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-800"
                >
                  {years.map((y) => (
                    <option key={y} value={y}>
                      {y} Yılı
                    </option>
                  ))}
                </select>
              </div>

              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-bold text-slate-700">
                  Hızlı Dönem Seçimi
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {PERIOD_MODES.map((pm) => {
                    const active = config.periodMode === pm.key;
                    return (
                      <button
                        key={pm.key}
                        type="button"
                        onClick={() =>
                          setConfig((prev) => ({
                            ...prev,
                            periodMode: pm.key,
                            startMonth:
                              pm.key === 'single_month' && prev.startMonth < 1
                                ? new Date().getMonth() + 1
                                : prev.startMonth,
                          }))
                        }
                        className={`rounded-lg px-2.5 py-1.5 text-xs font-bold transition ${
                          active
                            ? 'bg-navy text-white shadow-sm'
                            : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        {pm.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {(config.periodMode === 'single_month' ||
              config.periodMode === 'custom_range' ||
              config.periodMode === 'ytd') && (
              <div className="mt-3 grid gap-3 border-t border-slate-200/80 pt-3 sm:grid-cols-2">
                {config.periodMode !== 'ytd' && (
                  <div>
                    <label className="mb-1 block text-xs font-bold text-slate-700">
                      {config.periodMode === 'single_month' ? 'Seçili Ay' : 'Başlangıç Ayı'}
                    </label>
                    <select
                      value={config.startMonth}
                      onChange={(e) => {
                        const m = Number(e.target.value);
                        setConfig((prev) => ({
                          ...prev,
                          startMonth: m,
                          endMonth:
                            prev.periodMode === 'single_month'
                              ? m
                              : Math.max(m, prev.endMonth),
                        }));
                      }}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-800"
                    >
                      {MONTH_NAMES_TR.slice(1).map((name, i) => (
                        <option key={i + 1} value={i + 1}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {(config.periodMode === 'custom_range' || config.periodMode === 'ytd') && (
                  <div>
                    <label className="mb-1 block text-xs font-bold text-slate-700">
                      Bitiş Ayı
                    </label>
                    <select
                      value={config.endMonth}
                      onChange={(e) => {
                        const m = Number(e.target.value);
                        setConfig((prev) => ({
                          ...prev,
                          endMonth: m,
                          startMonth:
                            prev.periodMode === 'custom_range'
                              ? Math.min(prev.startMonth, m)
                              : 1,
                        }));
                      }}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-800"
                    >
                      {MONTH_NAMES_TR.slice(1).map((name, i) => (
                        <option key={i + 1} value={i + 1}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 3. Enerji Türü, Sayaç & Kapsam Filtreleri */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="mb-3 flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider text-navy">
              <Filter className="h-3.5 w-3.5 text-turquoise" />
              <span>3. Enerji Türü &amp; Kapsam Filtreleri</span>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-700">
                  Enerji Türleri (Çoklu)
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {(['electric', 'gas', 'water'] as UtilityType[]).map((u) => {
                    const checked = config.utilities.includes(u);
                    return (
                      <button
                        key={u}
                        type="button"
                        onClick={() => toggleUtility(u)}
                        className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-bold transition ${
                          checked
                            ? 'bg-navy text-white'
                            : 'border border-slate-200 bg-canvas text-slate-600'
                        }`}
                      >
                        {checked && <Check className="h-3 w-3" />}
                        <span>{utilityLabelTr(u)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-bold text-slate-700">
                  Sayaç / Pano Filtresi
                </label>
                <select
                  value={config.meterFilter}
                  onChange={(e) =>
                    setConfig((prev) => ({ ...prev, meterFilter: e.target.value }))
                  }
                  className="w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-xs font-semibold text-slate-800"
                >
                  <option value="all">Tüm Sayaçlar / Panolar</option>
                  {meterOptions.map((mName) => (
                    <option key={mName} value={mName}>
                      {mName}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs font-bold text-slate-700">
                  Tedarikçi Kurum
                </label>
                <select
                  value={config.providerFilter}
                  onChange={(e) =>
                    setConfig((prev) => ({ ...prev, providerFilter: e.target.value }))
                  }
                  className="w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-xs font-semibold text-slate-800"
                >
                  <option value="all">Tüm Tedarikçiler</option>
                  {providers.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs font-bold text-slate-700">
                  Fatura Niteliği
                </label>
                <select
                  value={config.invoiceKind}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      invoiceKind: e.target.value as EnergyInvoiceKindFilter,
                    }))
                  }
                  className="w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-xs font-semibold text-slate-800"
                >
                  <option value="all">Tüm Faturalar</option>
                  <option value="normal">Yalnızca Normal Faturalar</option>
                  <option value="late_fee">Yalnızca Gecikme / Ek Faturalar</option>
                  {hasElectric && (
                    <option value="penalized_only">Yalnızca Reaktif Cezalı Faturalar</option>
                  )}
                </select>
              </div>
            </div>
          </div>

          {/* 4. Tablo Düzeni ve Veri Sütunları Seçimi */}
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="mb-2.5 text-xs font-extrabold uppercase tracking-wider text-navy">
                4. Rapor Görünüm Formatı &amp; Tutar Bazı
              </div>

              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-700">
                    Excel / Tablo Sayfa Düzeni
                  </label>
                  <select
                    value={config.layoutStyle}
                    onChange={(e) =>
                      setConfig((prev) => ({
                        ...prev,
                        layoutStyle: e.target.value as EnergyReportLayoutStyle,
                      }))
                    }
                    className="w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-xs font-bold text-slate-800"
                  >
                    <option value="multi_sheet">
                      Çok Sekmeli Yönetim Kitabı (Özet + Elektrik + Mekanik + Bütçe + Sayaç)
                    </option>
                    <option value="monthly_matrix">
                      12 Aylık Yatay Matris / Pivot Tablo (Ocak–Aralık Sütunlu)
                    </option>
                    <option value="flat_list">
                      Tek Sayfa Tarih Sıralı Düz Fatura Listesi
                    </option>
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-700">
                    Maliyet Hesaplama Bazı
                  </label>
                  <select
                    value={config.amountBasis}
                    onChange={(e) =>
                      setConfig((prev) => ({
                        ...prev,
                        amountBasis: e.target.value as EnergyAmountBasis,
                      }))
                    }
                    className="w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-xs font-bold text-slate-800"
                  >
                    <option value="both">
                      Tam Kırılım (Brüt Fatura + Kiracı Yansıtma Payı + Net Ortak Alan)
                    </option>
                    <option value="net_common">
                      Yalnızca Net Ortak Alan (Kiracı Payı Düşülmüş AVM Yükü)
                    </option>
                    <option value="gross">Yalnızca Brüt Fatura Tutarı</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="mb-2.5 text-xs font-extrabold uppercase tracking-wider text-navy">
                5. Rapora Dahil Edilecek Veri Sütunları
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {[
                  {
                    key: 'includeQuantity',
                    label: 'Tüketim Miktarı (kWh / m³)',
                    enabled: true,
                  },
                  {
                    key: 'includeUnitCost',
                    label: 'Birim Maliyet (TL/kWh & TL/m³)',
                    enabled: true,
                  },
                  {
                    key: 'includeTenantSplit',
                    label: 'Kiracı Payı & Ortak Alan Ayrımı',
                    enabled: true,
                  },
                  {
                    key: 'includeBudgetComparison',
                    label: 'Bütçe & Sapma Analizi (% / TL)',
                    enabled: true,
                  },
                  {
                    key: 'includePrevYearComparison',
                    label: `${config.year - 1} Yılı (YoY %) Kıyaslaması`,
                    enabled: true,
                  },
                  {
                    key: 'includeReactivePenalty',
                    label: 'Reaktif Ceza (İndüktif / Kapasitif)',
                    enabled: hasElectric,
                  },
                  {
                    key: 'includeTechnicalIds',
                    label: 'Teknik Kodlar (Abone / EIC / Sayaç No)',
                    enabled: true,
                  },
                  {
                    key: 'includeMeterBreakdown',
                    label: 'Sayaç & Pano Maliyet Payı Sekmesi',
                    enabled: true,
                  },
                ].map((item) => {
                  const k = item.key as keyof EnergyReportConfig;
                  const val = Boolean(config[k]);
                  return (
                    <label
                      key={item.key}
                      className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition ${
                        !item.enabled
                          ? 'cursor-not-allowed border-slate-100 bg-slate-50 text-slate-400'
                          : val
                          ? 'border-navy/30 bg-navy-soft/40 text-navy'
                          : 'border-slate-200 bg-white text-slate-600'
                      }`}
                    >
                      <input
                        type="checkbox"
                        disabled={!item.enabled}
                        checked={item.enabled && val}
                        onChange={(e) =>
                          setConfig((prev) => ({
                            ...prev,
                            [k]: e.target.checked,
                          }))
                        }
                        className="h-3.5 w-3.5 rounded border-slate-300 text-navy"
                      />
                      <span className="truncate">{item.label}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Canlı Rapor Kapsam Özeti */}
          <div className="grid gap-3 rounded-2xl border border-turquoise/30 bg-turquoise-soft/40 p-4 sm:grid-cols-4">
            <div>
              <div className="text-[10px] font-extrabold uppercase text-turquoise">
                SEÇİLİ DÖNEM
              </div>
              <div className="mt-0.5 text-xs font-extrabold text-navy">
                {describeReportPeriod(config)}
              </div>
              <div className="text-[11px] text-slate-600">
                {matchedInvoices.length} Fatura · {matchedBudgets.length} Bütçe Satırı
              </div>
            </div>
            <div>
              <div className="text-[10px] font-extrabold uppercase text-slate-500">
                BRÜT FATURA TOPLAMI
              </div>
              <div className="mt-0.5 text-sm font-extrabold text-slate-900">
                {fmtTl(previewSummary.gross)} ₺
              </div>
              <div className="text-[11px] text-slate-500">
                Kiracı: {fmtTl(previewSummary.tenant)} ₺
              </div>
            </div>
            <div>
              <div className="text-[10px] font-extrabold uppercase text-slate-500">
                NET ORTAK ALAN
              </div>
              <div className="mt-0.5 text-sm font-extrabold text-navy">
                {fmtTl(previewSummary.net)} ₺
              </div>
              <div className="text-[11px] text-slate-500">AVM net enerji yükü</div>
            </div>
            <div>
              <div className="text-[10px] font-extrabold uppercase text-slate-500">
                DÖNEM BÜTÇESİ &amp; SAPMA
              </div>
              <div
                className={`mt-0.5 text-sm font-extrabold ${
                  previewSummary.diffPct === null
                    ? 'text-slate-700'
                    : previewSummary.diffPct > 0
                    ? 'text-red-600'
                    : 'text-emerald-700'
                }`}
              >
                {previewSummary.diffPct !== null
                  ? `${previewSummary.diffPct >= 0 ? '+' : ''}${previewSummary.diffPct.toFixed(1)}%`
                  : '-'}
              </div>
              <div className="text-[11px] text-slate-500">
                Bütçe: {fmtTl(previewSummary.budgetTl)} ₺
              </div>
            </div>
          </div>
        </div>

        {/* Alt Aksiyon Barı */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-5 py-3.5">
          <div className="text-xs text-slate-500">
            Renkli koşullu biçimlendirme (aşım=kırmızı, tasarruf=yeşil) otomatik uygulanır.
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100"
            >
              Kapat
            </button>
            <button
              type="button"
              onClick={handleExportExcel}
              disabled={matchedInvoices.length === 0 && matchedBudgets.length === 0}
              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-700 px-4 py-2 text-xs font-extrabold text-white shadow-sm transition hover:bg-emerald-800 disabled:opacity-40"
            >
              <FileSpreadsheet className="h-4 w-4" />
              <span>Çok Sekmeli Excel İndir (.xls)</span>
            </button>
            <button
              type="button"
              onClick={handleExportPdf}
              disabled={matchedInvoices.length === 0 && matchedBudgets.length === 0}
              className="inline-flex items-center gap-1.5 rounded-xl bg-navy px-4 py-2 text-xs font-extrabold text-white shadow-sm transition hover:bg-navy-hover disabled:opacity-40"
            >
              <FileDown className="h-4 w-4" />
              <span>Grafikli Yönetici PDF Raporu</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

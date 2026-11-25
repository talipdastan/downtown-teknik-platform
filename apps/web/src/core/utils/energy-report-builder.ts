import { EnergyBudget, EnergyInvoice, UtilityType } from '@/types/database';
import {
  ExcelWorkbookOptions,
  ExcelWorksheetSpec,
  PdfExportOptions,
  PdfKpiItem,
  PdfSectionTable,
  ReportCell,
} from './report-export';

export type EnergyReportPreset =
  | 'executive'
  | 'accounting'
  | 'budget_matrix'
  | 'technical_penalty';

export type EnergyPeriodMode =
  | 'full_year'
  | 'single_month'
  | 'q1'
  | 'q2'
  | 'q3'
  | 'q4'
  | 'ytd'
  | 'custom_range';

export type EnergyInvoiceKindFilter = 'all' | 'normal' | 'late_fee' | 'penalized_only';

export type EnergyAmountBasis = 'both' | 'net_common' | 'gross';

export type EnergyReportLayoutStyle = 'multi_sheet' | 'monthly_matrix' | 'flat_list';

export interface EnergyReportConfig {
  preset: EnergyReportPreset;
  year: number;
  periodMode: EnergyPeriodMode;
  startMonth: number; // 1..12
  endMonth: number; // 1..12
  utilities: UtilityType[];
  meterFilter: string; // 'all' or meter_id/meter_name
  providerFilter: string; // 'all' or provider
  invoiceKind: EnergyInvoiceKindFilter;
  amountBasis: EnergyAmountBasis;
  layoutStyle: EnergyReportLayoutStyle;
  includeQuantity: boolean;
  includeUnitCost: boolean;
  includeTenantSplit: boolean;
  includeReactivePenalty: boolean;
  includeBudgetComparison: boolean;
  includePrevYearComparison: boolean;
  includeTechnicalIds: boolean;
  includeMeterBreakdown: boolean;
}

export const MONTH_NAMES_TR = [
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

export function utilityLabelTr(u: UtilityType | string): string {
  if (u === 'electric') return 'Elektrik';
  if (u === 'gas') return 'Doğalgaz';
  if (u === 'water') return 'Su';
  return u;
}

export function utilityUnitTr(u: UtilityType | string): string {
  return u === 'electric' ? 'kWh' : 'm³';
}

export function createDefaultEnergyReportConfig(params?: {
  year?: number;
  monthFilter?: number;
  utilityFilter?: 'all' | UtilityType;
  defaultPreset?: EnergyReportPreset;
}): EnergyReportConfig {
  const nowMonth = new Date().getMonth() + 1;
  const year = params?.year ?? new Date().getFullYear();
  const month = params?.monthFilter ?? 0;
  const uf = params?.utilityFilter ?? 'all';
  const preset = params?.defaultPreset ?? 'executive';

  const base: EnergyReportConfig = {
    preset,
    year,
    periodMode: month > 0 ? 'single_month' : 'full_year',
    startMonth: month > 0 ? month : 1,
    endMonth: month > 0 ? month : Math.max(1, nowMonth),
    utilities: uf === 'all' ? ['electric', 'gas', 'water'] : [uf],
    meterFilter: 'all',
    providerFilter: 'all',
    invoiceKind: 'all',
    amountBasis: 'both',
    layoutStyle: preset === 'budget_matrix' ? 'monthly_matrix' : 'multi_sheet',
    includeQuantity: true,
    includeUnitCost: true,
    includeTenantSplit: true,
    includeReactivePenalty: uf !== 'gas' && uf !== 'water',
    includeBudgetComparison: true,
    includePrevYearComparison: true,
    includeTechnicalIds: preset === 'accounting',
    includeMeterBreakdown: true,
  };

  return applyReportPreset(base, preset);
}

export function applyReportPreset(
  current: EnergyReportConfig,
  preset: EnergyReportPreset
): EnergyReportConfig {
  if (preset === 'executive') {
    return {
      ...current,
      preset,
      layoutStyle: 'multi_sheet',
      amountBasis: 'both',
      includeQuantity: true,
      includeUnitCost: true,
      includeTenantSplit: true,
      includeReactivePenalty: current.utilities.includes('electric'),
      includeBudgetComparison: true,
      includePrevYearComparison: true,
      includeTechnicalIds: false,
      includeMeterBreakdown: true,
    };
  }
  if (preset === 'accounting') {
    return {
      ...current,
      preset,
      layoutStyle: 'multi_sheet',
      amountBasis: 'both',
      includeQuantity: true,
      includeUnitCost: true,
      includeTenantSplit: true,
      includeReactivePenalty: current.utilities.includes('electric'),
      includeBudgetComparison: false,
      includePrevYearComparison: false,
      includeTechnicalIds: true,
      includeMeterBreakdown: false,
    };
  }
  if (preset === 'budget_matrix') {
    return {
      ...current,
      preset,
      layoutStyle: 'monthly_matrix',
      amountBasis: 'net_common',
      includeQuantity: true,
      includeUnitCost: true,
      includeTenantSplit: false,
      includeReactivePenalty: false,
      includeBudgetComparison: true,
      includePrevYearComparison: true,
      includeTechnicalIds: false,
      includeMeterBreakdown: true,
    };
  }
  // technical_penalty
  return {
    ...current,
    preset,
    utilities: ['electric'],
    layoutStyle: 'multi_sheet',
    amountBasis: 'both',
    includeQuantity: true,
    includeUnitCost: true,
    includeTenantSplit: true,
    includeReactivePenalty: true,
    includeBudgetComparison: true,
    includePrevYearComparison: false,
    includeTechnicalIds: true,
    includeMeterBreakdown: true,
  };
}

export function resolveActiveMonths(cfg: EnergyReportConfig): number[] {
  const nowMonth = Math.min(12, Math.max(1, new Date().getMonth() + 1));
  switch (cfg.periodMode) {
    case 'single_month': {
      const m = Math.min(12, Math.max(1, cfg.startMonth));
      return [m];
    }
    case 'q1':
      return [1, 2, 3];
    case 'q2':
      return [4, 5, 6];
    case 'q3':
      return [7, 8, 9];
    case 'q4':
      return [10, 11, 12];
    case 'ytd': {
      const end = Math.min(12, Math.max(1, cfg.endMonth || nowMonth));
      return Array.from({ length: end }, (_, i) => i + 1);
    }
    case 'custom_range': {
      const s = Math.min(12, Math.max(1, Math.min(cfg.startMonth, cfg.endMonth)));
      const e = Math.min(12, Math.max(1, Math.max(cfg.startMonth, cfg.endMonth)));
      return Array.from({ length: e - s + 1 }, (_, i) => s + i);
    }
    case 'full_year':
    default:
      return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  }
}

export function describeReportPeriod(cfg: EnergyReportConfig): string {
  const months = resolveActiveMonths(cfg);
  if (months.length === 12) return `${cfg.year} Tüm Yıl (Ocak – Aralık)`;
  if (months.length === 1) return `${MONTH_NAMES_TR[months[0]]} ${cfg.year}`;
  if (cfg.periodMode === 'q1') return `${cfg.year} 1. Çeyrek (Ocak – Mart)`;
  if (cfg.periodMode === 'q2') return `${cfg.year} 2. Çeyrek (Nisan – Haziran)`;
  if (cfg.periodMode === 'q3') return `${cfg.year} 3. Çeyrek (Temmuz – Eylül)`;
  if (cfg.periodMode === 'q4') return `${cfg.year} 4. Çeyrek (Ekim – Aralık)`;
  return `${MONTH_NAMES_TR[months[0]]} – ${MONTH_NAMES_TR[months[months.length - 1]]} ${cfg.year}`;
}

export function filterInvoicesForReport(
  invoices: EnergyInvoice[],
  cfg: EnergyReportConfig
): EnergyInvoice[] {
  const monthSet = new Set(resolveActiveMonths(cfg));
  const utilSet = new Set(cfg.utilities);

  return invoices
    .filter((inv) => {
      if (inv.period_year !== cfg.year) return false;
      if (!monthSet.has(inv.period_month)) return false;
      if (!utilSet.has(inv.utility_type)) return false;
      if (cfg.meterFilter !== 'all') {
        const matchId = inv.meter_id === cfg.meterFilter;
        const matchName = inv.meter_name === cfg.meterFilter;
        if (!matchId && !matchName) return false;
      }
      if (cfg.providerFilter !== 'all' && inv.provider !== cfg.providerFilter) {
        return false;
      }
      if (cfg.invoiceKind === 'normal' && inv.invoice_type === 'late_fee') {
        return false;
      }
      if (cfg.invoiceKind === 'late_fee' && inv.invoice_type !== 'late_fee') {
        return false;
      }
      if (cfg.invoiceKind === 'penalized_only') {
        const pen =
          inv.utility_type === 'electric'
            ? Number(inv.inductive_penalty_tl || 0) + Number(inv.capacitive_penalty_tl || 0)
            : 0;
        if (pen <= 0) return false;
      }
      return true;
    })
    .sort((a, b) => {
      if (a.period_month !== b.period_month) return a.period_month - b.period_month;
      if (a.utility_type !== b.utility_type) return a.utility_type.localeCompare(b.utility_type);
      return a.meter_name.localeCompare(b.meter_name, 'tr');
    });
}

export function filterBudgetsForReport(
  budgets: EnergyBudget[],
  cfg: EnergyReportConfig
): EnergyBudget[] {
  const monthSet = new Set(resolveActiveMonths(cfg));
  const utilSet = new Set(cfg.utilities);

  return budgets
    .filter((b) => {
      if (b.period_year !== cfg.year) return false;
      if (!monthSet.has(b.period_month)) return false;
      if (!utilSet.has(b.utility_type)) return false;
      return true;
    })
    .sort((a, b) => {
      if (a.period_month !== b.period_month) return a.period_month - b.period_month;
      return a.utility_type.localeCompare(b.utility_type);
    });
}

function round2(n: number): number {
  return Number((Number(n) || 0).toFixed(2));
}

function fmtTlText(n: number): string {
  return `${new Intl.NumberFormat('tr-TR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n)} ₺`;
}

function fmtQtyText(n: number): string {
  return new Intl.NumberFormat('tr-TR', {
    maximumFractionDigits: 2,
  }).format(n);
}

function calcCommonTl(inv: EnergyInvoice): number {
  return Math.max(0, Number(inv.amount_tl || 0) - Number(inv.tenant_amount_tl || 0));
}

function calcCommonQty(inv: EnergyInvoice): number {
  return Math.max(0, Number(inv.consumption || 0) - Number(inv.tenant_consumption || 0));
}

function calcPenaltyTl(inv: EnergyInvoice): number {
  if (inv.utility_type !== 'electric') return 0;
  return Number(inv.inductive_penalty_tl || 0) + Number(inv.capacitive_penalty_tl || 0);
}

function varianceCell(actual: number, target: number): ReportCell {
  if (!target || target <= 0) return { value: '-', tone: 'muted' };
  const pct = ((actual - target) / target) * 100;
  const text = `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
  if (pct > 3) return { value: text, tone: 'bad', bold: true };
  if (pct < -1) return { value: text, tone: 'good', bold: true };
  return { value: text, tone: 'info' };
}

function buildUtilityInvoiceSheet(
  titlePrefix: string,
  sheetName: string,
  invoices: EnergyInvoice[],
  cfg: EnergyReportConfig,
  isElectricSheet: boolean
): ExcelWorksheetSpec {
  const unitLabel = isElectricSheet ? 'kWh' : 'm³';
  const showReactive = isElectricSheet && cfg.includeReactivePenalty;
  const showGross = cfg.amountBasis === 'both' || cfg.amountBasis === 'gross';
  const showTenant = cfg.includeTenantSplit && cfg.amountBasis === 'both';
  const showNet = cfg.amountBasis === 'both' || cfg.amountBasis === 'net_common';

  const headers: string[] = ['Dönem', 'Enerji Türü', 'Sayaç / Pano', 'Tedarikçi', 'Fatura Tipi'];
  if (cfg.includeTechnicalIds) {
    headers.push('Fatura No', 'Fatura Tarihi', 'Sayaç No / Abone / EIC');
  } else {
    headers.push('Fatura No', 'Fatura Tarihi');
  }
  if (cfg.includeQuantity) {
    headers.push(`Tüketim (${unitLabel})`);
  }
  if (showGross) {
    headers.push('Brüt Fatura (TL)');
  }
  if (cfg.includeUnitCost) {
    headers.push(`Birim Maliyet (TL/${unitLabel})`);
  }
  if (showReactive) {
    headers.push('İndüktif Ceza (TL)', 'Kapasitif Ceza (TL)', 'Toplam Reaktif (TL)');
  }
  if (showTenant) {
    headers.push('Kiracı Payı (TL)');
  }
  if (showNet) {
    headers.push('Net Ortak Alan (TL)');
  }

  let sumQty = 0;
  let sumGross = 0;
  let sumInd = 0;
  let sumCap = 0;
  let sumTenant = 0;
  let sumNet = 0;

  const rows: ReportCell[][] = invoices.map((inv) => {
    const qty = Number(inv.consumption || 0);
    const gross = Number(inv.amount_tl || 0);
    const ind = inv.utility_type === 'electric' ? Number(inv.inductive_penalty_tl || 0) : 0;
    const cap = inv.utility_type === 'electric' ? Number(inv.capacitive_penalty_tl || 0) : 0;
    const pen = ind + cap;
    const tenant = Number(inv.tenant_amount_tl || 0);
    const net = calcCommonTl(inv);
    const unitCost = qty > 0 ? gross / qty : 0;

    sumQty += qty;
    sumGross += gross;
    sumInd += ind;
    sumCap += cap;
    sumTenant += tenant;
    sumNet += net;

    const row: ReportCell[] = [
      `${MONTH_NAMES_TR[inv.period_month]} ${inv.period_year}`,
      utilityLabelTr(inv.utility_type),
      inv.meter_name,
      inv.provider,
      inv.invoice_type === 'late_fee'
        ? { value: 'Gecikme / Ek Fatura', tone: 'warn' }
        : 'Normal Fatura',
    ];

    if (cfg.includeTechnicalIds) {
      const idBundle = [inv.meter_no, inv.subscriber_no, inv.contract_no, inv.eic_code]
        .filter(Boolean)
        .join(' / ');
      row.push(inv.invoice_no ?? '-', inv.invoice_date ?? '-', idBundle || '-');
    } else {
      row.push(inv.invoice_no ?? '-', inv.invoice_date ?? '-');
    }

    if (cfg.includeQuantity) {
      row.push(round2(qty));
    }
    if (showGross) {
      row.push(round2(gross));
    }
    if (cfg.includeUnitCost) {
      row.push(qty > 0 ? round2(unitCost) : '-');
    }
    if (showReactive) {
      row.push(
        ind > 0 ? { value: round2(ind), tone: 'bad' } : 0,
        cap > 0 ? { value: round2(cap), tone: 'bad' } : 0,
        pen > 0 ? { value: round2(pen), tone: 'bad', bold: true } : { value: 0, tone: 'good' }
      );
    }
    if (showTenant) {
      row.push(round2(tenant));
    }
    if (showNet) {
      row.push({ value: round2(net), bold: true });
    }
    return row;
  });

  const totalsRow: ReportCell[] = [
    'TOPLAM',
    `${invoices.length} Fatura`,
    '-',
    '-',
    '-',
  ];
  if (cfg.includeTechnicalIds) {
    totalsRow.push('-', '-', '-');
  } else {
    totalsRow.push('-', '-');
  }
  if (cfg.includeQuantity) {
    totalsRow.push(round2(sumQty));
  }
  if (showGross) {
    totalsRow.push(round2(sumGross));
  }
  if (cfg.includeUnitCost) {
    totalsRow.push(sumQty > 0 ? round2(sumGross / sumQty) : '-');
  }
  if (showReactive) {
    totalsRow.push(round2(sumInd), round2(sumCap), round2(sumInd + sumCap));
  }
  if (showTenant) {
    totalsRow.push(round2(sumTenant));
  }
  if (showNet) {
    totalsRow.push(round2(sumNet));
  }

  return {
    sheetName,
    title: `DOWNTOWN TEKNİK · ${titlePrefix}`,
    subtitle: `Dönem: ${describeReportPeriod(cfg)} · Kayıt Sayısı: ${invoices.length}`,
    headers,
    rows,
    totalsRow,
  };
}

function buildExecutiveSummarySheet(
  invoices: EnergyInvoice[],
  budgets: EnergyBudget[],
  cfg: EnergyReportConfig
): ExcelWorksheetSpec {
  const headers: string[] = [
    'Enerji Türü',
    'Birim',
    'Fatura Adedi',
    'Toplam Tüketim',
    'Ortak Alan Tüketim',
    'Brüt Fatura (TL)',
    'Kiracı Payı (TL)',
    'Net Ortak Alan (TL)',
    'Ort. Birim Maliyet (TL)',
  ];
  if (cfg.includeReactivePenalty && cfg.utilities.includes('electric')) {
    headers.push('Reaktif Ceza (TL)');
  }
  if (cfg.includeBudgetComparison) {
    headers.push('Dönem Bütçesi (TL)', 'Bütçe Farkı (TL)', 'Bütçe Sapma (%)');
  }
  if (cfg.includePrevYearComparison) {
    headers.push(`${cfg.year - 1} Gerçekleşen (TL)`, 'Yıllık Değişim (YoY %)');
  }

  let totalCount = 0;
  let totalGross = 0;
  let totalTenant = 0;
  let totalNet = 0;
  let totalPen = 0;
  let totalBudgetTl = 0;
  let totalPrevTl = 0;

  const rows: ReportCell[][] = cfg.utilities.map((u) => {
    const uInv = invoices.filter((i) => i.utility_type === u);
    const uBud = budgets.filter((b) => b.utility_type === u);

    const count = uInv.length;
    const qty = uInv.reduce((s, i) => s + Number(i.consumption || 0), 0);
    const commonQty = uInv.reduce((s, i) => s + calcCommonQty(i), 0);
    const gross = uInv.reduce((s, i) => s + Number(i.amount_tl || 0), 0);
    const tenant = uInv.reduce((s, i) => s + Number(i.tenant_amount_tl || 0), 0);
    const net = uInv.reduce((s, i) => s + calcCommonTl(i), 0);
    const pen = uInv.reduce((s, i) => s + calcPenaltyTl(i), 0);
    const budTl = uBud.reduce((s, b) => s + Number(b.budget_tl || 0), 0);
    const prevTl = uBud.reduce((s, b) => s + Number(b.prev_year_tl || 0), 0);
    const unitCost = qty > 0 ? gross / qty : 0;

    totalCount += count;
    totalGross += gross;
    totalTenant += tenant;
    totalNet += net;
    totalPen += pen;
    totalBudgetTl += budTl;
    totalPrevTl += prevTl;

    const row: ReportCell[] = [
      { value: utilityLabelTr(u), bold: true },
      utilityUnitTr(u),
      count,
      round2(qty),
      round2(commonQty),
      round2(gross),
      round2(tenant),
      { value: round2(net), bold: true },
      qty > 0 ? round2(unitCost) : '-',
    ];

    if (cfg.includeReactivePenalty && cfg.utilities.includes('electric')) {
      row.push(
        u === 'electric'
          ? pen > 0
            ? { value: round2(pen), tone: 'bad', bold: true }
            : { value: 0, tone: 'good' }
          : { value: '-', tone: 'muted' }
      );
    }
    if (cfg.includeBudgetComparison) {
      const diffTl = net - budTl;
      row.push(
        round2(budTl),
        budTl > 0
          ? { value: round2(diffTl), tone: diffTl > 0 ? 'bad' : 'good' }
          : '-',
        varianceCell(net, budTl)
      );
    }
    if (cfg.includePrevYearComparison) {
      row.push(round2(prevTl), varianceCell(net, prevTl));
    }
    return row;
  });

  const singleUtil = cfg.utilities.length === 1 ? cfg.utilities[0] : null;
  const singleQty = singleUtil
    ? invoices.reduce((s, i) => s + Number(i.consumption || 0), 0)
    : 0;
  const singleCommonQty = singleUtil
    ? invoices.reduce((s, i) => s + calcCommonQty(i), 0)
    : 0;

  const totalsRow: ReportCell[] = [
    'GENEL TOPLAM',
    singleUtil ? utilityUnitTr(singleUtil) : 'Karma',
    totalCount,
    singleUtil ? round2(singleQty) : '-',
    singleUtil ? round2(singleCommonQty) : '-',
    round2(totalGross),
    round2(totalTenant),
    round2(totalNet),
    singleUtil && singleQty > 0 ? round2(totalGross / singleQty) : '-',
  ];

  if (cfg.includeReactivePenalty && cfg.utilities.includes('electric')) {
    totalsRow.push(round2(totalPen));
  }
  if (cfg.includeBudgetComparison) {
    totalsRow.push(
      round2(totalBudgetTl),
      totalBudgetTl > 0 ? round2(totalNet - totalBudgetTl) : '-',
      varianceCell(totalNet, totalBudgetTl)
    );
  }
  if (cfg.includePrevYearComparison) {
    totalsRow.push(round2(totalPrevTl), varianceCell(totalNet, totalPrevTl));
  }

  return {
    sheetName: 'Yonetici_Ozeti',
    title: `DOWNTOWN TEKNİK · Enerji & Bütçe Yönetici Özeti (${cfg.year})`,
    subtitle: `Dönem: ${describeReportPeriod(cfg)} · Türler: ${cfg.utilities
      .map(utilityLabelTr)
      .join(', ')}`,
    headers,
    rows,
    totalsRow,
    note: 'Not: Net Ortak Alan tutarı, brüt fatura tutarından kiracı yansıtma payları düşülerek hesaplanmıştır. Kırmızı hücreler bütçe aşımını veya reaktif cezayı, yeşil hücreler bütçe altı tasarrufu gösterir.',
  };
}

function buildBudgetComparisonSheet(
  invoices: EnergyInvoice[],
  budgets: EnergyBudget[],
  cfg: EnergyReportConfig
): ExcelWorksheetSpec {
  const activeMonths = resolveActiveMonths(cfg);
  const headers: string[] = ['Ay', 'Enerji Türü', 'Birim'];
  if (cfg.includeQuantity) {
    headers.push('Bütçe Miktar', 'Gerçekleşen Miktar', 'Miktar Sapma (%)');
    if (cfg.includePrevYearComparison) {
      headers.push(`${cfg.year - 1} Miktar`);
    }
  }
  headers.push('Bütçe (TL)', 'Gerçekleşen Ortak Alan (TL)', 'Fark (TL)', 'TL Sapma (%)');
  if (cfg.includeUnitCost) {
    headers.push('Gerçekleşen Birim Maliyet (TL)');
  }
  if (cfg.includePrevYearComparison) {
    headers.push(`${cfg.year - 1} Gerçekleşen (TL)`, 'Geçen Yıla Göre Değişim (%)');
  }

  const rows: ReportCell[][] = [];
  let sumBudQty = 0;
  let sumActQty = 0;
  let sumPrevQty = 0;
  let sumBudTl = 0;
  let sumActTl = 0;
  let sumPrevTl = 0;

  for (const m of activeMonths) {
    for (const u of cfg.utilities) {
      const b = budgets.find((x) => x.period_month === m && x.utility_type === u);
      const mInvs = invoices.filter((x) => x.period_month === m && x.utility_type === u);
      const actTl = mInvs.reduce((s, i) => s + calcCommonTl(i), 0);
      const actQty = mInvs.reduce((s, i) => s + calcCommonQty(i), 0);
      const budTl = Number(b?.budget_tl || 0);
      const budQty = Number(b?.budget_consumption || 0);
      const prevTl = Number(b?.prev_year_tl || 0);
      const prevQty = Number(b?.prev_year_consumption || 0);

      if (!b && actTl === 0 && actQty === 0) continue;

      sumBudQty += budQty;
      sumActQty += actQty;
      sumPrevQty += prevQty;
      sumBudTl += budTl;
      sumActTl += actTl;
      sumPrevTl += prevTl;

      const diffTl = actTl - budTl;
      const row: ReportCell[] = [
        `${MONTH_NAMES_TR[m]} ${cfg.year}`,
        utilityLabelTr(u),
        utilityUnitTr(u),
      ];

      if (cfg.includeQuantity) {
        row.push(round2(budQty), round2(actQty), varianceCell(actQty, budQty));
        if (cfg.includePrevYearComparison) {
          row.push(round2(prevQty));
        }
      }

      row.push(
        round2(budTl),
        { value: round2(actTl), bold: true },
        budTl > 0
          ? { value: round2(diffTl), tone: diffTl > 0 ? 'bad' : 'good' }
          : '-',
        varianceCell(actTl, budTl)
      );

      if (cfg.includeUnitCost) {
        row.push(actQty > 0 ? round2(actTl / actQty) : '-');
      }
      if (cfg.includePrevYearComparison) {
        row.push(round2(prevTl), varianceCell(actTl, prevTl));
      }

      rows.push(row);
    }
  }

  const singleUtil = cfg.utilities.length === 1 ? cfg.utilities[0] : null;
  const totalsRow: ReportCell[] = [
    'TOPLAM',
    `${rows.length} Dönem Kaydı`,
    singleUtil ? utilityUnitTr(singleUtil) : 'Karma',
  ];

  if (cfg.includeQuantity) {
    totalsRow.push(
      singleUtil ? round2(sumBudQty) : '-',
      singleUtil ? round2(sumActQty) : '-',
      singleUtil ? varianceCell(sumActQty, sumBudQty) : '-'
    );
    if (cfg.includePrevYearComparison) {
      totalsRow.push(singleUtil ? round2(sumPrevQty) : '-');
    }
  }

  totalsRow.push(
    round2(sumBudTl),
    round2(sumActTl),
    sumBudTl > 0 ? round2(sumActTl - sumBudTl) : '-',
    varianceCell(sumActTl, sumBudTl)
  );

  if (cfg.includeUnitCost) {
    totalsRow.push(singleUtil && sumActQty > 0 ? round2(sumActTl / sumActQty) : '-');
  }
  if (cfg.includePrevYearComparison) {
    totalsRow.push(round2(sumPrevTl), varianceCell(sumActTl, sumPrevTl));
  }

  return {
    sheetName: 'Butce_Kiyas_Analizi',
    title: `DOWNTOWN TEKNİK · Bütçe & Gerçekleşme Sapma Analizi (${cfg.year})`,
    subtitle: `Dönem: ${describeReportPeriod(cfg)} · Kiracı payları düşülmüş net ortak alan değerleri`,
    headers,
    rows,
    totalsRow,
  };
}

function buildMonthlyMatrixSheet(
  invoices: EnergyInvoice[],
  budgets: EnergyBudget[],
  cfg: EnergyReportConfig
): ExcelWorksheetSpec {
  const activeMonths = resolveActiveMonths(cfg);
  const headers: string[] = [
    'Enerji Türü & Kalem',
    'Birim',
    ...activeMonths.map((m) => MONTH_NAMES_TR[m]),
    'Dönem Toplamı',
    'Bütçe Sapma (%)',
  ];

  const rows: ReportCell[][] = [];
  const monthlyTotalBud = new Map<number, number>();
  const monthlyTotalAct = new Map<number, number>();
  const monthlyTotalPrev = new Map<number, number>();

  for (const u of cfg.utilities) {
    const label = utilityLabelTr(u).toUpperCase();
    const unit = utilityUnitTr(u);

    // Miktar satırları
    if (cfg.includeQuantity) {
      let totBudQ = 0;
      let totActQ = 0;
      const budQCells: ReportCell[] = [];
      const actQCells: ReportCell[] = [];

      for (const m of activeMonths) {
        const b = budgets.find((x) => x.period_month === m && x.utility_type === u);
        const mInvs = invoices.filter((x) => x.period_month === m && x.utility_type === u);
        const bq = Number(b?.budget_consumption || 0);
        const aq = mInvs.reduce((s, i) => s + calcCommonQty(i), 0);
        totBudQ += bq;
        totActQ += aq;
        budQCells.push(round2(bq));
        actQCells.push(
          bq > 0 && aq > bq * 1.05
            ? { value: round2(aq), tone: 'bad' }
            : bq > 0 && aq < bq * 0.98
            ? { value: round2(aq), tone: 'good' }
            : round2(aq)
        );
      }

      if (cfg.includeBudgetComparison) {
        rows.push([`${label} · Bütçe Miktar`, unit, ...budQCells, round2(totBudQ), '-']);
      }
      rows.push([
        { value: `${label} · Gerçekleşen Miktar`, bold: true },
        unit,
        ...actQCells,
        { value: round2(totActQ), bold: true },
        varianceCell(totActQ, totBudQ),
      ]);
    }

    // TL satırları
    let totBudTl = 0;
    let totActTl = 0;
    let totPrevTl = 0;
    const budTlCells: ReportCell[] = [];
    const actTlCells: ReportCell[] = [];
    const prevTlCells: ReportCell[] = [];

    for (const m of activeMonths) {
      const b = budgets.find((x) => x.period_month === m && x.utility_type === u);
      const mInvs = invoices.filter((x) => x.period_month === m && x.utility_type === u);
      const btl = Number(b?.budget_tl || 0);
      const atl = mInvs.reduce((s, i) => s + calcCommonTl(i), 0);
      const ptl = Number(b?.prev_year_tl || 0);

      totBudTl += btl;
      totActTl += atl;
      totPrevTl += ptl;

      monthlyTotalBud.set(m, (monthlyTotalBud.get(m) ?? 0) + btl);
      monthlyTotalAct.set(m, (monthlyTotalAct.get(m) ?? 0) + atl);
      monthlyTotalPrev.set(m, (monthlyTotalPrev.get(m) ?? 0) + ptl);

      budTlCells.push(round2(btl));
      actTlCells.push(
        btl > 0 && atl > btl * 1.03
          ? { value: round2(atl), tone: 'bad', bold: true }
          : btl > 0 && atl < btl * 0.98
          ? { value: round2(atl), tone: 'good', bold: true }
          : { value: round2(atl), bold: true }
      );
      prevTlCells.push(round2(ptl));
    }

    if (cfg.includeBudgetComparison) {
      rows.push([`${label} · Bütçe Tutar`, 'TL', ...budTlCells, round2(totBudTl), '-']);
    }
    rows.push([
      { value: `${label} · Gerçekleşen Ortak Alan`, bold: true },
      'TL',
      ...actTlCells,
      { value: round2(totActTl), bold: true },
      varianceCell(totActTl, totBudTl),
    ]);
    if (cfg.includePrevYearComparison) {
      rows.push([
        { value: `${label} · ${cfg.year - 1} Gerçekleşen`, tone: 'muted' },
        'TL',
        ...prevTlCells,
        round2(totPrevTl),
        varianceCell(totActTl, totPrevTl),
      ]);
    }
  }

  const grandBud = Array.from(monthlyTotalBud.values()).reduce((s, v) => s + v, 0);
  const grandAct = Array.from(monthlyTotalAct.values()).reduce((s, v) => s + v, 0);

  if (cfg.includeBudgetComparison) {
    rows.push([
      { value: 'TOPLAM BÜTÇE (TL)', tone: 'info', bold: true },
      'TL',
      ...activeMonths.map((m) => round2(monthlyTotalBud.get(m) ?? 0)),
      { value: round2(grandBud), tone: 'info', bold: true },
      '-',
    ]);
  }

  const totalsRow: ReportCell[] = [
    'TOPLAM GERÇEKLEŞEN ORTAK ALAN (TL)',
    'TL',
    ...activeMonths.map((m) => round2(monthlyTotalAct.get(m) ?? 0)),
    round2(grandAct),
    varianceCell(grandAct, grandBud),
  ];

  return {
    sheetName: `Aylik_Matris_${cfg.year}`,
    title: `DOWNTOWN TEKNİK · Aylık Yatay Matris (Pivot) Enerji & Bütçe Tablosu (${cfg.year})`,
    subtitle: `Dönem: ${describeReportPeriod(cfg)} · Aylık Yatay Karşılaştırma`,
    headers,
    rows,
    totalsRow,
  };
}

function buildMeterBreakdownSheet(
  invoices: EnergyInvoice[],
  cfg: EnergyReportConfig
): ExcelWorksheetSpec {
  const headers: string[] = [
    'Sayaç / Pano Adı',
    'Enerji Türü',
    'Tedarikçi',
    'Birim',
    'Fatura Adedi',
    'Toplam Tüketim',
    'Brüt Tutar (TL)',
    'Kiracı Payı (TL)',
    'Net Ortak Alan (TL)',
    'Ort. Birim Maliyet (TL)',
    'Toplam Gider Payı (%)',
  ];

  const grouped = new Map<
    string,
    {
      meterName: string;
      utilityType: UtilityType;
      provider: string;
      count: number;
      qty: number;
      gross: number;
      tenant: number;
      net: number;
    }
  >();

  let totalNetAll = 0;
  let totalGrossAll = 0;
  let totalTenantAll = 0;

  for (const inv of invoices) {
    const key = `${inv.utility_type}::${inv.meter_name}`;
    const cur = grouped.get(key) ?? {
      meterName: inv.meter_name,
      utilityType: inv.utility_type,
      provider: inv.provider,
      count: 0,
      qty: 0,
      gross: 0,
      tenant: 0,
      net: 0,
    };
    const net = calcCommonTl(inv);
    cur.count += 1;
    cur.qty += Number(inv.consumption || 0);
    cur.gross += Number(inv.amount_tl || 0);
    cur.tenant += Number(inv.tenant_amount_tl || 0);
    cur.net += net;
    grouped.set(key, cur);

    totalNetAll += net;
    totalGrossAll += Number(inv.amount_tl || 0);
    totalTenantAll += Number(inv.tenant_amount_tl || 0);
  }

  const sorted = Array.from(grouped.values()).sort((a, b) => b.net - a.net);

  const rows: ReportCell[][] = sorted.map((g) => {
    const share = totalNetAll > 0 ? (g.net / totalNetAll) * 100 : 0;
    return [
      { value: g.meterName, bold: true },
      utilityLabelTr(g.utilityType),
      g.provider,
      utilityUnitTr(g.utilityType),
      g.count,
      round2(g.qty),
      round2(g.gross),
      round2(g.tenant),
      { value: round2(g.net), bold: true },
      g.qty > 0 ? round2(g.gross / g.qty) : '-',
      `${share.toFixed(1)}%`,
    ];
  });

  const totalsRow: ReportCell[] = [
    'TOPLAM',
    `${sorted.length} Sayaç/Pano`,
    '-',
    '-',
    invoices.length,
    '-',
    round2(totalGrossAll),
    round2(totalTenantAll),
    round2(totalNetAll),
    '-',
    '100.0%',
  ];

  return {
    sheetName: 'Sayac_Pano_Kirilimi',
    title: `DOWNTOWN TEKNİK · Sayaç & Pano Bazlı Maliyet Dağılımı (${cfg.year})`,
    subtitle: `Dönem: ${describeReportPeriod(cfg)} · En yüksek maliyetli sayaçtan düşüğe sıralı`,
    headers,
    rows,
    totalsRow,
  };
}

export function buildEnergyExcelWorkbook(
  allInvoices: EnergyInvoice[],
  allBudgets: EnergyBudget[],
  cfg: EnergyReportConfig
): ExcelWorkbookOptions {
  const invoices = filterInvoicesForReport(allInvoices, cfg);
  const budgets = filterBudgetsForReport(allBudgets, cfg);

  const activeMonths = resolveActiveMonths(cfg);
  const periodSlug =
    activeMonths.length === 12
      ? 'tum_yil'
      : activeMonths.length === 1
      ? String(activeMonths[0]).padStart(2, '0')
      : `${String(activeMonths[0]).padStart(2, '0')}_${String(
          activeMonths[activeMonths.length - 1]
        ).padStart(2, '0')}`;

  const fileName = `downtown_teknik_enerji_raporu_${cfg.year}_${periodSlug}.xls`;
  const sheets: ExcelWorksheetSpec[] = [];

  if (cfg.layoutStyle === 'monthly_matrix') {
    sheets.push(buildMonthlyMatrixSheet(invoices, budgets, cfg));
    sheets.push(buildExecutiveSummarySheet(invoices, budgets, cfg));
    if (cfg.includeBudgetComparison) {
      sheets.push(buildBudgetComparisonSheet(invoices, budgets, cfg));
    }
  } else if (cfg.layoutStyle === 'flat_list') {
    const onlyMech = !cfg.utilities.includes('electric');
    sheets.push(
      buildUtilityInvoiceSheet(
        `Enerji Faturaları Listesi (${cfg.year})`,
        `Faturalar_${cfg.year}`,
        invoices,
        cfg,
        !onlyMech
      )
    );
    if (cfg.includeBudgetComparison && budgets.length > 0) {
      sheets.push(buildBudgetComparisonSheet(invoices, budgets, cfg));
    }
  } else {
    // multi_sheet (Önerilen Çok Sekmeli Kurumsal Kitap)
    sheets.push(buildExecutiveSummarySheet(invoices, budgets, cfg));

    const elecInvoices = invoices.filter((i) => i.utility_type === 'electric');
    const mechInvoices = invoices.filter(
      (i) => i.utility_type === 'gas' || i.utility_type === 'water'
    );

    if (cfg.utilities.includes('electric') && elecInvoices.length > 0) {
      sheets.push(
        buildUtilityInvoiceSheet(
          `Elektrik Faturaları & Reaktif Ceza Detayı (${cfg.year})`,
          'Elektrik_Faturalari',
          elecInvoices,
          cfg,
          true
        )
      );
    }

    if ((cfg.utilities.includes('gas') || cfg.utilities.includes('water')) && mechInvoices.length > 0) {
      sheets.push(
        buildUtilityInvoiceSheet(
          `Doğalgaz & Su (Mekanik) Faturaları (${cfg.year})`,
          'Dogalgaz_ve_Su',
          mechInvoices,
          cfg,
          false
        )
      );
    }

    if (cfg.includeBudgetComparison) {
      sheets.push(buildBudgetComparisonSheet(invoices, budgets, cfg));
      sheets.push(buildMonthlyMatrixSheet(invoices, budgets, cfg));
    }

    if (cfg.includeMeterBreakdown && invoices.length > 0) {
      sheets.push(buildMeterBreakdownSheet(invoices, cfg));
    }
  }

  return { fileName, sheets };
}

function buildMonthlyTrendSvg(
  invoices: EnergyInvoice[],
  budgets: EnergyBudget[],
  cfg: EnergyReportConfig
): string {
  const months = resolveActiveMonths(cfg);
  const points = months.map((m) => {
    const mBud = budgets
      .filter((b) => b.period_month === m)
      .reduce((s, b) => s + Number(b.budget_tl || 0), 0);
    const mAct = invoices
      .filter((i) => i.period_month === m)
      .reduce((s, i) => s + calcCommonTl(i), 0);
    const mPrev = budgets
      .filter((b) => b.period_month === m)
      .reduce((s, b) => s + Number(b.prev_year_tl || 0), 0);
    return {
      month: m,
      label: MONTH_NAMES_TR[m].slice(0, 3),
      budget: mBud,
      actual: mAct,
      prev: mPrev,
    };
  });

  const maxVal = Math.max(
    1,
    ...points.flatMap((p) => [p.budget, p.actual, cfg.includePrevYearComparison ? p.prev : 0])
  );

  const width = 560;
  const height = 170;
  const padL = 52;
  const padR = 14;
  const padT = 18;
  const padB = 26;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  const slotW = plotW / Math.max(1, points.length);
  const barW = Math.min(16, Math.max(6, slotW * 0.26));

  const gridLines = [0, 0.5, 1]
    .map((ratio) => {
      const y = padT + plotH * (1 - ratio);
      const val = Math.round(maxVal * ratio);
      const label =
        val >= 1_000_000
          ? `${(val / 1_000_000).toFixed(1)}M`
          : val >= 1_000
          ? `${Math.round(val / 1_000)}B`
          : String(val);
      return `<line x1="${padL}" y1="${y}" x2="${width - padR}" y2="${y}" stroke="#E2E8F0" stroke-dasharray="3 3" />
      <text x="${padL - 6}" y="${y + 3}" text-anchor="end" font-size="8.5" fill="#64748B">${label}</text>`;
    })
    .join('');

  const bars = points
    .map((p, idx) => {
      const cx = padL + slotW * idx + slotW / 2;
      const bH = (p.budget / maxVal) * plotH;
      const aH = (p.actual / maxVal) * plotH;
      const pH = (p.prev / maxVal) * plotH;
      const over = p.budget > 0 && p.actual > p.budget;
      const actColor = over ? '#DC2626' : '#0E7490';

      return `
        ${
          cfg.includePrevYearComparison
            ? `<rect x="${cx - barW * 1.5}" y="${padT + plotH - pH}" width="${
                barW * 0.85
              }" height="${Math.max(1, pH)}" rx="2" fill="#CBD5E1" />`
            : ''
        }
        ${
          cfg.includeBudgetComparison
            ? `<rect x="${cx - barW * 0.5}" y="${padT + plotH - bH}" width="${barW}" height="${Math.max(
                1,
                bH
              )}" rx="2" fill="#17365D" />`
            : ''
        }
        <rect x="${cx + barW * 0.6}" y="${padT + plotH - aH}" width="${barW}" height="${Math.max(
        1,
        aH
      )}" rx="2" fill="${actColor}" />
        <text x="${cx}" y="${height - 8}" text-anchor="middle" font-size="8.5" font-weight="700" fill="#334155">${
        p.label
      }</text>
      `;
    })
    .join('');

  const legend = `
    <g transform="translate(${padL}, 10)">
      ${
        cfg.includePrevYearComparison
          ? `<rect x="0" y="-6" width="8" height="8" rx="2" fill="#CBD5E1" /><text x="11" y="1" font-size="8.5" fill="#475569">${
              cfg.year - 1
            } Yılı</text>`
          : ''
      }
      ${
        cfg.includeBudgetComparison
          ? `<rect x="75" y="-6" width="8" height="8" rx="2" fill="#17365D" /><text x="86" y="1" font-size="8.5" fill="#17365D" font-weight="700">Bütçe (TL)</text>`
          : ''
      }
      <rect x="155" y="-6" width="8" height="8" rx="2" fill="#0E7490" /><text x="166" y="1" font-size="8.5" fill="#0E7490" font-weight="700">Gerçekleşen</text>
      <rect x="242" y="-6" width="8" height="8" rx="2" fill="#DC2626" /><text x="253" y="1" font-size="8.5" fill="#DC2626" font-weight="700">Bütçe Aşımı</text>
    </g>
  `;

  return `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
    ${legend}
    ${gridLines}
    ${bars}
  </svg>`;
}

function buildUtilityDistributionSvg(invoices: EnergyInvoice[]): string {
  const items: Array<{ key: UtilityType; label: string; color: string; value: number }> = [
    { key: 'electric', label: 'Elektrik', color: '#17365D', value: 0 },
    { key: 'gas', label: 'Doğalgaz', color: '#EA580C', value: 0 },
    { key: 'water', label: 'Su', color: '#0E7490', value: 0 },
  ];

  for (const inv of invoices) {
    const target = items.find((x) => x.key === inv.utility_type);
    if (target) target.value += calcCommonTl(inv);
  }

  const total = Math.max(
    1,
    items.reduce((s, i) => s + i.value, 0)
  );

  const width = 360;
  const height = 170;

  const rowsSvg = items
    .map((item, idx) => {
      const y = 32 + idx * 44;
      const pct = (item.value / total) * 100;
      const barW = Math.max(4, (pct / 100) * 210);
      return `
        <text x="12" y="${y}" font-size="10" font-weight="800" fill="#1E293B">${item.label}</text>
        <text x="348" y="${y}" text-anchor="end" font-size="9.5" font-weight="700" fill="#334155">${fmtTlText(
        item.value
      )} (%${pct.toFixed(1)})</text>
        <rect x="12" y="${y + 6}" width="220" height="12" rx="6" fill="#F1F5F9" />
        <rect x="12" y="${y + 6}" width="${barW}" height="12" rx="6" fill="${item.color}" />
      `;
    })
    .join('');

  return `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
    <text x="12" y="13" font-size="8.5" font-weight="700" fill="#64748B">NET ORTAK ALAN MALİYET PAYLARI</text>
    ${rowsSvg}
  </svg>`;
}

export function buildEnergyPdfReportOptions(
  allInvoices: EnergyInvoice[],
  allBudgets: EnergyBudget[],
  cfg: EnergyReportConfig
): PdfExportOptions {
  const invoices = filterInvoicesForReport(allInvoices, cfg);
  const budgets = filterBudgetsForReport(allBudgets, cfg);

  const totalGross = invoices.reduce((s, i) => s + Number(i.amount_tl || 0), 0);
  const totalTenant = invoices.reduce((s, i) => s + Number(i.tenant_amount_tl || 0), 0);
  const totalNet = invoices.reduce((s, i) => s + calcCommonTl(i), 0);
  const totalPenalty = invoices.reduce((s, i) => s + calcPenaltyTl(i), 0);
  const totalBudget = budgets.reduce((s, b) => s + Number(b.budget_tl || 0), 0);
  const totalPrev = budgets.reduce((s, b) => s + Number(b.prev_year_tl || 0), 0);

  const budgetDiffPct =
    totalBudget > 0 ? ((totalNet - totalBudget) / totalBudget) * 100 : null;
  const yoyDiffPct = totalPrev > 0 ? ((totalNet - totalPrev) / totalPrev) * 100 : null;

  const kpis: PdfKpiItem[] = [
    {
      label: 'Net Ortak Alan Gideri',
      value: fmtTlText(totalNet),
      sub: `Brüt: ${fmtTlText(totalGross)} · Kiracı: ${fmtTlText(totalTenant)}`,
      tone: 'navy',
    },
    {
      label: 'Dönem Bütçesi & Sapma',
      value:
        budgetDiffPct !== null
          ? `${budgetDiffPct >= 0 ? '+' : ''}${budgetDiffPct.toFixed(1)}%`
          : fmtTlText(totalBudget),
      sub:
        totalBudget > 0
          ? `Bütçe: ${fmtTlText(totalBudget)} (${
              totalNet > totalBudget ? 'Bütçe Aşımı' : 'Bütçe Dahilinde'
            })`
          : 'Bütçe kaydı yok',
      tone:
        budgetDiffPct === null
          ? 'slate'
          : budgetDiffPct > 0
          ? 'red'
          : 'green',
    },
    {
      label: `${cfg.year - 1} Yılı Karşılaştırması`,
      value:
        yoyDiffPct !== null
          ? `${yoyDiffPct >= 0 ? '+' : ''}${yoyDiffPct.toFixed(1)}%`
          : fmtTlText(totalPrev),
      sub: `Geçen Yıl: ${fmtTlText(totalPrev)} · ${invoices.length} Fatura`,
      tone: 'slate',
    },
    cfg.utilities.includes('electric')
      ? {
          label: 'Toplam Reaktif Ceza',
          value: fmtTlText(totalPenalty),
          sub:
            totalPenalty > 0
              ? 'Kompanzasyon kontrolü önerilir'
              : 'Reaktif ceza bulunmuyor',
          tone: totalPenalty > 0 ? 'red' : 'green',
        }
      : {
          label: 'Toplam Mekanik Tüketim',
          value: `${fmtQtyText(
            invoices.reduce((s, i) => s + Number(i.consumption || 0), 0)
          )} m³`,
          sub: `${invoices.length} mekanik sayaç faturası`,
          tone: 'green',
        },
  ];

  const executiveNotes: string[] = [];
  executiveNotes.push(
    `${describeReportPeriod(cfg)} döneminde toplam ${
      invoices.length
    } adet fatura incelenmiş olup kiracı yansıtmaları (${fmtTlText(
      totalTenant
    )}) düşüldükten sonra net ortak alan enerji maliyeti ${fmtTlText(totalNet)} olarak gerçekleşmiştir.`
  );
  if (budgetDiffPct !== null) {
    executiveNotes.push(
      budgetDiffPct > 0
        ? `Gerçekleşen net ortak alan gideri dönem bütçesinin (${fmtTlText(
            totalBudget
          )}) %${budgetDiffPct.toFixed(1)} (${fmtTlText(totalNet - totalBudget)}) üzerindedir.`
        : `Gerçekleşen net ortak alan gideri dönem bütçesinin (${fmtTlText(
            totalBudget
          )}) %${Math.abs(budgetDiffPct).toFixed(1)} (${fmtTlText(
            totalBudget - totalNet
          )}) altında kalarak tasarruf sağlamıştır.`
    );
  }
  if (cfg.utilities.includes('electric')) {
    const penalizedCount = invoices.filter((i) => calcPenaltyTl(i) > 0).length;
    executiveNotes.push(
      penalizedCount > 0
        ? `${penalizedCount} adet elektrik faturasında toplam ${fmtTlText(
            totalPenalty
          )} reaktif (indüktif/kapasitif) ceza tespit edilmiştir.`
        : 'Elektrik faturalarında reaktif güç cezası bulunmamaktadır.'
    );
  }

  const execSheet = buildExecutiveSummarySheet(invoices, budgets, cfg);
  const extraTables: PdfSectionTable[] = [];

  if (cfg.layoutStyle === 'monthly_matrix') {
    const matrix = buildMonthlyMatrixSheet(invoices, budgets, cfg);
    extraTables.push({
      title: '12 Aylık Yatay Matris (Pivot) Bütçe & Gerçekleşme Tablosu',
      subtitle: matrix.subtitle,
      headers: matrix.headers,
      rows: matrix.rows,
      totalsRow: matrix.totalsRow,
    });
  } else {
    if (cfg.includeBudgetComparison && budgets.length > 0) {
      const bSheet = buildBudgetComparisonSheet(invoices, budgets, cfg);
      extraTables.push({
        title: 'Aylık Bütçe & Gerçekleşme Sapma Tablosu',
        subtitle: bSheet.subtitle,
        headers: bSheet.headers,
        rows: bSheet.rows,
        totalsRow: bSheet.totalsRow,
      });
    }

    const elecInvoices = invoices.filter((i) => i.utility_type === 'electric');
    const mechInvoices = invoices.filter((i) => i.utility_type !== 'electric');

    if (elecInvoices.length > 0) {
      const eSheet = buildUtilityInvoiceSheet(
        'Elektrik Faturaları',
        'Elektrik',
        elecInvoices,
        cfg,
        true
      );
      extraTables.push({
        title: 'Elektrik Faturaları & Birim Maliyet Detayı',
        headers: eSheet.headers,
        rows: eSheet.rows,
        totalsRow: eSheet.totalsRow,
      });
    }

    if (mechInvoices.length > 0) {
      const mSheet = buildUtilityInvoiceSheet(
        'Doğalgaz & Su (Mekanik) Faturaları',
        'Mekanik',
        mechInvoices,
        cfg,
        false
      );
      extraTables.push({
        title: 'Doğalgaz & Su (Mekanik) Faturaları Detayı',
        headers: mSheet.headers,
        rows: mSheet.rows,
        totalsRow: mSheet.totalsRow,
      });
    }

    if (cfg.includeMeterBreakdown && invoices.length > 0) {
      const meterSheet = buildMeterBreakdownSheet(invoices, cfg);
      extraTables.push({
        title: 'Sayaç & Pano Bazlı Maliyet Kırılımı',
        headers: meterSheet.headers,
        rows: meterSheet.rows,
        totalsRow: meterSheet.totalsRow,
      });
    }
  }

  return {
    title: `Enerji Fatura & Bütçe Yönetim Raporu (${cfg.year})`,
    subtitle: `Dönem: ${describeReportPeriod(cfg)} · Kapsam: ${cfg.utilities
      .map(utilityLabelTr)
      .join(', ')}`,
    kpis,
    executiveNotes,
    chartTitle: `Aylık Bütçe vs Gerçekleşen Ortak Alan Trendi (${cfg.year})`,
    chartSvgHtml: buildMonthlyTrendSvg(invoices, budgets, cfg),
    secondaryChartTitle: 'Enerji Türü Maliyet Dağılımı',
    secondaryChartSvgHtml: buildUtilityDistributionSvg(invoices),
    headers: execSheet.headers,
    rows: execSheet.rows,
    totalsRow: execSheet.totalsRow,
    extraTables,
    note: execSheet.note,
  };
}

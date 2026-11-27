import { UtilityType } from '@/types/database';

export const MONTHS = [
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

export const SHORT_MONTHS = [
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

export const GEMINI_STORAGE_KEY = 'avm_tech_gemini_api_key';

export type ChartMetric = 'tl' | 'electric_qty' | 'gas_qty' | 'water_qty';

export interface MonthlyChartPoint {
  monthNum: number;
  shortLabel: string;
  fullLabel: string;
  budgetVal: number;
  actualVal: number;
  prevVal: number;
  diffPct: number | null;
  yoyPct: number | null;
}

export interface BudgetFormState {
  id: string | null;
  period_year: string;
  period_month: string;
  utility_type: UtilityType;
  budget_consumption: string;
  budget_tl: string;
  prev_year_consumption: string;
  prev_year_tl: string;
}

export function utilityLabel(type: string) {
  if (type === 'electric') return 'Elektrik';
  if (type === 'gas') return 'Doğalgaz';
  if (type === 'water') return 'Su';
  return type;
}

export function utilityUnit(type: string) {
  if (type === 'electric') return 'kWh';
  return 'm³';
}

export function parseUtility(raw: string): UtilityType | null {
  const s = raw.trim().toLowerCase();
  if (s === 'electric' || s === 'elektrik' || s.includes('elekt')) return 'electric';
  if (s === 'gas' || s === 'doğalgaz' || s === 'dogalgaz' || s.includes('gaz')) return 'gas';
  if (s === 'water' || s === 'su') return 'water';
  return null;
}

export function parseMonth(raw: string): number | null {
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

export function parseNumber(raw: string | undefined): number {
  if (!raw) return 0;
  let s = raw.trim().replace(/[₺\s]/g, '');
  if (!s) return 0;
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

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
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

export function formatCompactAxis(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace('.', ',')}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}B`;
  return String(Math.round(n));
}

export function escapeSvgText(val: string): string {
  return val
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function buildPrintableChartSvg(
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

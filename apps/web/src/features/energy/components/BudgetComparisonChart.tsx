'use client';

import { BarChart3, TrendingDown, TrendingUp } from 'lucide-react';
import {
  ChartMetric,
  formatCompactAxis,
  MonthlyChartPoint,
} from '@/features/energy/budget-helpers';

export interface BudgetChartMeta {
  isQty: boolean;
  unit: string;
  title: string;
  points: MonthlyChartPoint[];
  niceMax: number;
  highestDeviationMonth: MonthlyChartPoint | null;
  overBudgetCount: number;
  underBudgetCount: number;
  yoyOverallPct: number | null;
  yoyComparableCount: number;
  realizationRatio: number | null;
}

interface BudgetComparisonChartProps {
  year: number;
  month: number;
  hoveredMonth: number | null;
  chartMetric: ChartMetric;
  chartMeta: BudgetChartMeta;
  activeInspectPoint: MonthlyChartPoint | null;
  fmtTl: (n: number) => string;
  fmtQty: (n: number) => string;
  onMetricChange: (metric: ChartMetric) => void;
  onHoverMonth: (m: number | null) => void;
  onSelectMonth: (m: number) => void;
}

export function BudgetComparisonChart({
  year,
  month,
  hoveredMonth,
  chartMetric,
  chartMeta,
  activeInspectPoint,
  fmtTl,
  fmtQty,
  onMetricChange,
  onHoverMonth,
  onSelectMonth,
}: BudgetComparisonChartProps) {
  return (
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
              onClick={() => onMetricChange(key)}
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
                  onMouseEnter={() => onHoverMonth(p.monthNum)}
                  onMouseLeave={() => onHoverMonth(null)}
                  onClick={() => onSelectMonth(month === p.monthNum ? 0 : p.monthNum)}
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
  );
}

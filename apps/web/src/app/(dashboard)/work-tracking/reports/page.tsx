'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart3,
  FileDown,
  FileSpreadsheet,
  Users,
  Wrench,
} from 'lucide-react';
import { createClient } from '@/core/supabase/client';
import { formatDate, formatDateTime, PRIORITY_LABELS, TICKET_STATUS_LABELS } from '@/core/constants';
import {
  exportExcelXml,
  exportPrintablePdf,
  ReportCell,
} from '@/core/utils/report-export';
import { TicketPriority, TicketStatus, WorkOrderStatus } from '@/types/database';

type ReportRow = {
  ticket_number: string;
  requester_name: string;
  created_at: string;
  completer_name: string;
  completed_at: string;
  department: string;
  floor: string;
  location: string;
  equipment: string;
  category: string;
  priority: string;
  status: string;
  response_minutes: number | null;
  resolution_minutes: number | null;
};

type RawWO = {
  id: string;
  status: WorkOrderStatus;
  started_at: string | null;
  completed_at: string | null;
  completer?: { full_name: string } | null;
  departments?: { name: string } | null;
  work_order_assignments?: {
    user_id: string;
    profiles?: { full_name: string } | null;
  }[];
};

type RawReportTicket = {
  ticket_number: string | null;
  priority: TicketPriority;
  status: TicketStatus;
  created_at: string;
  resolved_at: string | null;
  closed_at: string | null;
  custom_location: string | null;
  custom_category: string | null;
  profiles?: { full_name: string } | null;
  locations?: { name: string; floors?: { name: string } | null } | null;
  categories?: { name: string; departments?: { name: string } | null } | null;
  equipments?: { code: string; name: string } | null;
  work_orders?: RawWO[] | null;
};

function diffMinutes(startIso?: string | null, endIso?: string | null): number | null {
  if (!startIso || !endIso) return null;
  const s = new Date(startIso).getTime();
  const e = new Date(endIso).getTime();
  if (Number.isNaN(s) || Number.isNaN(e) || e < s) return null;
  return Math.round((e - s) / 60000);
}

function formatDuration(mins: number | null): string {
  if (mins === null) return '-';
  if (mins < 60) return `${mins} dk`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h} sa ${m} dk` : `${h} sa`;
}

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function escapeSvg(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildDeptChartSvg(
  depts: Array<{ department: string; total: number; closed: number }>
): string {
  if (depts.length === 0) return '';
  const shown = depts.slice(0, 8);
  const rowH = 28;
  const padLeft = 170;
  const padRight = 50;
  const padTop = 24;
  const width = 760;
  const height = padTop + shown.length * rowH + 16;
  const plotW = width - padLeft - padRight;
  const maxVal = Math.max(1, ...shown.map((d) => d.total));

  const bars = shown
    .map((d, idx) => {
      const y = padTop + idx * rowH;
      const totalW = (d.total / maxVal) * plotW;
      const closedW = (d.closed / maxVal) * plotW;
      return `<text x="${padLeft - 8}" y="${y + 13}" text-anchor="end" font-size="11" font-weight="600" fill="#1E293B" font-family="Arial, sans-serif">${escapeSvg(
        d.department.slice(0, 24)
      )}</text>
      <rect x="${padLeft}" y="${y + 2}" width="${Math.max(2, totalW).toFixed(
        1
      )}" height="10" rx="3" fill="#17365D" />
      <rect x="${padLeft}" y="${y + 13}" width="${Math.max(0, closedW).toFixed(
        1
      )}" height="8" rx="3" fill="#0E7490" />
      <text x="${(padLeft + totalW + 6).toFixed(1)}" y="${
        y + 13
      }" font-size="10" font-weight="700" fill="#475569" font-family="Arial, sans-serif">${
        d.total
      } (${d.closed} kapalı)</text>`;
    })
    .join('\n');

  const legend = `<g transform="translate(${padLeft}, 6)">
    <rect x="0" y="0" width="10" height="8" rx="2" fill="#17365D"/><text x="14" y="8" font-size="10" font-weight="700" fill="#334155" font-family="Arial, sans-serif">Toplam Arıza</text>
    <rect x="115" y="0" width="10" height="8" rx="2" fill="#0E7490"/><text x="129" y="8" font-size="10" font-weight="700" fill="#334155" font-family="Arial, sans-serif">Çözülen / Kapalı</text>
  </g>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">${legend}${bars}</svg>`;
}

export default function WorkTrackingReportsPage() {
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const {
    data: reportData,
    isLoading: loading,
    error: queryError,
  } = useQuery({
    queryKey: ['wt', 'reports', { startDate, endDate }],
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const supabase = createClient();
      const CHUNK_SIZE = 1000;
      const MAX_ROWS = 5000;
      const collected: RawReportTicket[] = [];
      let exactTotal: number | null = null;

      for (let offset = 0; offset < MAX_ROWS; offset += CHUNK_SIZE) {
        let q = supabase
          .from('tickets')
          .select(
            'ticket_number, priority, status, created_at, resolved_at, closed_at, custom_location, custom_category, profiles!tickets_reporter_id_fkey(full_name), locations(name, floors(name)), categories(name, departments(name)), equipments(code, name), work_orders(id, status, started_at, completed_at, completer:profiles!work_orders_completed_by_fkey(full_name), departments(name), work_order_assignments(user_id, profiles!work_order_assignments_user_id_fkey(full_name)))',
            offset === 0 ? { count: 'exact' } : undefined
          )
          .order('created_at', { ascending: false })
          .range(offset, offset + CHUNK_SIZE - 1);

        if (startDate) q = q.gte('created_at', `${startDate}T00:00:00`);
        if (endDate) q = q.lte('created_at', `${endDate}T23:59:59`);

        const { data, count, error: qErr } = await q;
        if (qErr) throw qErr;
        if (offset === 0 && typeof count === 'number') {
          exactTotal = count;
        }
        const batch = (data as unknown as RawReportTicket[]) ?? [];
        collected.push(...batch);
        if (batch.length < CHUNK_SIZE) break;
      }

      const mttrRes = await supabase.rpc('rpc_get_work_tracking_mttr_stats', { p_days: 90 });
      const mttr =
        !mttrRes.error && mttrRes.data
          ? (mttrRes.data as {
              period_days: number;
              closed_count: number;
              mttr_minutes: number;
              sla_total: number;
              sla_breached: number;
              sla_compliance_pct: number;
              top_equipments: Array<{
                equipment_id: string;
                equipment_code: string;
                equipment_name: string;
                ticket_count: number;
              }>;
            })
          : null;

      return {
        rawTickets: collected,
        totalMatchedCount: exactTotal ?? collected.length,
        mttr,
      };
    },
  });

  const rawTickets = useMemo(() => reportData?.rawTickets ?? [], [reportData]);
  const totalMatchedCount = reportData?.totalMatchedCount ?? null;
  const mttrStats = reportData?.mttr ?? null;
  const error = queryError instanceof Error ? queryError.message : null;

  function applyPreset(preset: 'this_month' | 'last_month' | 'last_30' | 'this_year' | 'clear') {
    const now = new Date();
    if (preset === 'clear') {
      setStartDate('');
      setEndDate('');
      return;
    }
    if (preset === 'this_month') {
      setStartDate(toIsoDate(new Date(now.getFullYear(), now.getMonth(), 1)));
      setEndDate(toIsoDate(now));
      return;
    }
    if (preset === 'last_month') {
      const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const last = new Date(now.getFullYear(), now.getMonth(), 0);
      setStartDate(toIsoDate(first));
      setEndDate(toIsoDate(last));
      return;
    }
    if (preset === 'last_30') {
      const prev = new Date(now);
      prev.setDate(prev.getDate() - 30);
      setStartDate(toIsoDate(prev));
      setEndDate(toIsoDate(now));
      return;
    }
    setStartDate(`${now.getFullYear()}-01-01`);
    setEndDate(toIsoDate(now));
  }

  const rows: ReportRow[] = useMemo(() => {
    return rawTickets.map((d) => {
      const wos = Array.isArray(d.work_orders) ? d.work_orders : [];
      const starts = wos
        .map((w) => w.started_at)
        .filter((x): x is string => Boolean(x))
        .sort();
      const firstStart = starts[0] ?? null;
      const completedWo = wos.find((w) => w.status === 'completed') ?? wos[0] ?? null;
      const doneAt = completedWo?.completed_at ?? d.resolved_at ?? d.closed_at ?? null;
      const deptName =
        wos[0]?.departments?.name ?? d.categories?.departments?.name ?? 'Atanmamış';

      const assignedNames = (completedWo?.work_order_assignments ?? [])
        .map((a) => a.profiles?.full_name)
        .filter(Boolean)
        .join(', ');
      const completerName =
        completedWo?.completer?.full_name ||
        (doneAt ? assignedNames || 'Teknik Ekip' : '-');

      return {
        ticket_number: d.ticket_number ?? '-',
        requester_name: d.profiles?.full_name ?? '-',
        created_at: formatDateTime(d.created_at),
        completer_name: completerName,
        completed_at: doneAt ? formatDateTime(doneAt) : '-',
        department: deptName,
        floor: d.locations?.floors?.name ?? '-',
        location: d.locations?.name ?? d.custom_location ?? '-',
        equipment: d.equipments ? `${d.equipments.code} - ${d.equipments.name}` : '-',
        category: d.categories?.name ?? d.custom_category ?? '-',
        priority: PRIORITY_LABELS[d.priority] ?? d.priority,
        status: TICKET_STATUS_LABELS[d.status] ?? d.status,
        response_minutes: diffMinutes(d.created_at, firstStart),
        resolution_minutes: diffMinutes(d.created_at, doneAt),
      };
    });
  }, [rawTickets]);

  const deptSummary = useMemo(() => {
    const map = new Map<string, { total: number; closed: number; resp: number[]; res: number[] }>();
    for (const r of rows) {
      const e = map.get(r.department) ?? { total: 0, closed: 0, resp: [], res: [] };
      e.total += 1;
      if (r.status === 'Kapandı' || r.status.startsWith('Çözüldü')) e.closed += 1;
      if (r.response_minutes !== null) e.resp.push(r.response_minutes);
      if (r.resolution_minutes !== null) e.res.push(r.resolution_minutes);
      map.set(r.department, e);
    }
    const avg = (arr: number[]) =>
      arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null;
    return Array.from(map.entries())
      .map(([department, v]) => ({
        department,
        total: v.total,
        closed: v.closed,
        avgResp: avg(v.resp),
        avgRes: avg(v.res),
      }))
      .sort((a, b) => b.total - a.total);
  }, [rows]);

  const techSummary = useMemo(() => {
    const map = new Map<
      string,
      { name: string; assigned: number; completed: number; resp: number[]; res: number[] }
    >();

    for (const t of rawTickets) {
      const wos = Array.isArray(t.work_orders) ? t.work_orders : [];
      for (const wo of wos) {
        const assigns = Array.isArray(wo.work_order_assignments)
          ? wo.work_order_assignments
          : [];
        const respMin = diffMinutes(t.created_at, wo.started_at);
        const resMin = diffMinutes(wo.started_at ?? t.created_at, wo.completed_at);

        for (const a of assigns) {
          const name = a.profiles?.full_name || 'Teknisyen';
          const entry = map.get(a.user_id) ?? {
            name,
            assigned: 0,
            completed: 0,
            resp: [],
            res: [],
          };
          entry.assigned += 1;
          if (wo.status === 'completed') entry.completed += 1;
          if (respMin !== null) entry.resp.push(respMin);
          if (resMin !== null) entry.res.push(resMin);
          map.set(a.user_id, entry);
        }
      }
    }

    const avg = (arr: number[]) =>
      arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null;

    return Array.from(map.values())
      .map((v) => ({
        name: v.name,
        assigned: v.assigned,
        completed: v.completed,
        avgResp: avg(v.resp),
        avgRes: avg(v.res),
      }))
      .sort((a, b) => b.completed - a.completed || b.assigned - a.assigned);
  }, [rawTickets]);

  const overallMetrics = useMemo(() => {
    const closedCount = rows.filter(
      (r) => r.status === 'Kapandı' || r.status.startsWith('Çözüldü')
    ).length;
    const respArr = rows
      .map((r) => r.response_minutes)
      .filter((x): x is number => x !== null);
    const resArr = rows
      .map((r) => r.resolution_minutes)
      .filter((x): x is number => x !== null);
    const avg = (arr: number[]) =>
      arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null;

    return {
      total: rows.length,
      closed: closedCount,
      avgResp: avg(respArr),
      avgRes: avg(resArr),
    };
  }, [rows]);

  function buildExportData() {
    const headers = [
      'Arıza No',
      'İstek Açan',
      'Açılış Tarihi',
      'İsteği Tamamlayan',
      'Tamamlanma Tarihi',
      'Departman',
      'Kat',
      'Mahal',
      'Ekipman',
      'Kategori',
      'Öncelik',
      'Durum',
      'Müdahale (dk)',
      'Çözüm (dk)',
    ];
    const exportRows: ReportCell[][] = rows.map((r) => [
      r.ticket_number,
      r.requester_name,
      r.created_at,
      r.completer_name,
      r.completed_at,
      r.department,
      r.floor,
      r.location,
      r.equipment,
      r.category,
      r.priority,
      r.status,
      r.response_minutes ?? '-',
      r.resolution_minutes ?? '-',
    ]);
    return { headers, exportRows };
  }

  function handleExportExcel() {
    const { headers, exportRows } = buildExportData();
    exportExcelXml({
      fileName: `avm_tech_is_takip_rapor_${new Date().toISOString().slice(0, 10)}.xls`,
      sheetName: 'Is_Takip_Rapor',
      title: 'DOWNTOWN TEKNİK · İş Takip & Performans Raporu',
      subtitle: `Tarih Aralığı: ${startDate || 'Başlangıç yok'} – ${endDate || 'Bugün'} · ${
        rows.length
      } kayıt`,
      headers,
      rows: exportRows,
    });
  }

  function handleExportPdf() {
    const { headers, exportRows } = buildExportData();
    const chartSvgHtml = buildDeptChartSvg(deptSummary);
    exportPrintablePdf({
      title: 'İş Takip Performans & Arıza Raporu',
      subtitle: `Tarih Aralığı: ${startDate || 'Tümü'} – ${endDate || 'Bugün'}`,
      kpis: [
        { label: 'Toplam Arıza', value: String(overallMetrics.total), tone: 'navy' },
        { label: 'Çözülen / Kapalı', value: String(overallMetrics.closed), tone: 'green' },
        {
          label: 'Ort. Müdahale',
          value: formatDuration(overallMetrics.avgResp),
          tone: 'slate',
        },
        {
          label: 'Ort. Çözüm',
          value: formatDuration(overallMetrics.avgRes),
          tone: 'slate',
        },
      ],
      chartTitle: 'Departman Bazlı Arıza & Çözüm Dağılımı',
      chartSvgHtml,
      headers,
      rows: exportRows,
    });
  }

  const maxDeptTotal = Math.max(1, ...deptSummary.map((d) => d.total));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400">
            İŞ TAKİP ANALİZİ
          </div>
          <h1 className="mt-0.5 text-2xl font-extrabold text-slate-900">
            İş Takip & Performans Raporları
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Departman ve teknisyen bazlı müdahale/çözüm süreleri, grafik analiz ve Excel / PDF
            raporları.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleExportExcel}
            disabled={rows.length === 0}
            className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2 text-xs font-bold text-emerald-800 transition hover:bg-emerald-100 disabled:opacity-40"
          >
            <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-700" />
            Excel İndir (.xls)
          </button>
          <button
            type="button"
            onClick={handleExportPdf}
            disabled={rows.length === 0}
            className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2 text-xs font-bold text-rose-800 transition hover:bg-rose-100 disabled:opacity-40"
          >
            <FileDown className="h-3.5 w-3.5 text-rose-700" />
            PDF Rapor İndir
          </button>
        </div>
      </div>

      {/* Kurumsal MTTR · SLA Uyum · Tekrarlayan Ekipman Özeti (Son 90 Gün) */}
      {mttrStats && (
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400">
              Ortalama Çözüm Süresi (MTTR · 90 Gün)
            </div>
            <div className="mt-1 text-2xl font-extrabold text-navy">
              {formatDuration(Math.round(mttrStats.mttr_minutes || 0))}
            </div>
            <div className="mt-0.5 text-xs text-slate-500">
              {mttrStats.closed_count} çözülen / kapanan kayıt üzerinden
            </div>
          </div>
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4">
            <div className="text-[11px] font-extrabold uppercase tracking-wider text-emerald-800">
              SLA Uyum Oranı (90 Gün)
            </div>
            <div className="mt-1 text-2xl font-extrabold text-emerald-700">
              %{mttrStats.sla_compliance_pct}
            </div>
            <div className="mt-0.5 text-xs text-emerald-900/70">
              {mttrStats.sla_breached} ihlal / {mttrStats.sla_total} toplam talep
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400">
              En Sık Arızalanan Ekipmanlar
            </div>
            {mttrStats.top_equipments.length === 0 ? (
              <div className="mt-2 text-xs text-slate-400">
                Ekipmana bağlı arıza kaydı oluştuğunda burada listelenir.
              </div>
            ) : (
              <div className="mt-1.5 space-y-1 text-xs">
                {mttrStats.top_equipments.slice(0, 3).map((eq) => (
                  <div key={eq.equipment_id} className="flex items-center justify-between">
                    <span className="truncate font-bold text-slate-800">
                      {eq.equipment_code} · {eq.equipment_name}
                    </span>
                    <span className="ml-2 rounded-full bg-rose-100 px-2 py-0.5 font-extrabold text-rose-800">
                      {eq.ticket_count}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tarih Filtresi ve Hızlı Kısayollar */}
      {totalMatchedCount !== null && totalMatchedCount > rawTickets.length && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs font-semibold text-amber-900">
          Seçili aralıkta toplam <strong>{totalMatchedCount}</strong> kayıt bulundu; performans
          sınırı nedeniyle en güncel <strong>{rawTickets.length}</strong> kayıt analiz edildi. Tam
          sonuç için tarih aralığını daraltın.
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => applyPreset('this_month')}
            className="rounded-full border border-slate-200 bg-canvas px-3 py-1 text-xs font-bold text-slate-700 hover:bg-navy-soft hover:text-navy"
          >
            Bu Ay
          </button>
          <button
            type="button"
            onClick={() => applyPreset('last_month')}
            className="rounded-full border border-slate-200 bg-canvas px-3 py-1 text-xs font-bold text-slate-700 hover:bg-navy-soft hover:text-navy"
          >
            Geçen Ay
          </button>
          <button
            type="button"
            onClick={() => applyPreset('last_30')}
            className="rounded-full border border-slate-200 bg-canvas px-3 py-1 text-xs font-bold text-slate-700 hover:bg-navy-soft hover:text-navy"
          >
            Son 30 Gün
          </button>
          <button
            type="button"
            onClick={() => applyPreset('this_year')}
            className="rounded-full border border-slate-200 bg-canvas px-3 py-1 text-xs font-bold text-slate-700 hover:bg-navy-soft hover:text-navy"
          >
            Bu Yıl
          </button>
          {(startDate || endDate) && (
            <button
              type="button"
              onClick={() => applyPreset('clear')}
              className="rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs font-bold text-red-700 hover:bg-red-100"
            >
              Temizle
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-500">
          <span>Başlangıç:</span>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="rounded-xl border border-slate-200 bg-canvas px-2.5 py-1.5 text-xs text-slate-800"
          />
          <span>Bitiş:</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="rounded-xl border border-slate-200 bg-canvas px-2.5 py-1.5 text-xs text-slate-800"
          />
        </div>
      </div>

      {/* Özet KPI Kartları */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400">
            Toplam Arıza
          </div>
          <div className="mt-1 text-2xl font-extrabold text-navy">{overallMetrics.total}</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400">
            Çözülen / Kapalı
          </div>
          <div className="mt-1 text-2xl font-extrabold text-emerald-600">
            {overallMetrics.closed}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400">
            Ort. Müdahale Süresi
          </div>
          <div className="mt-1 text-2xl font-extrabold text-turquoise">
            {formatDuration(overallMetrics.avgResp)}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400">
            Ort. Çözüm Süresi
          </div>
          <div className="mt-1 text-2xl font-extrabold text-slate-800">
            {formatDuration(overallMetrics.avgRes)}
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Departman Dağılım Grafiği (Görsel Analiz) */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="mb-4 flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-navy-soft text-navy">
            <BarChart3 className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-sm font-extrabold text-navy">
              Departman Bazlı Arıza & Çözüm Dağılımı
            </h2>
            <p className="text-xs text-slate-500">
              Lacivert: Toplam arıza · Turkuaz: Çözülen / Kapatılan
            </p>
          </div>
        </div>

        {deptSummary.length === 0 ? (
          <div className="py-6 text-center text-xs text-slate-400">
            {loading ? 'Hesaplanıyor...' : 'Grafik için kayıt yok.'}
          </div>
        ) : (
          <div className="space-y-2.5">
            {deptSummary.map((d) => {
              const totalPct = Math.round((d.total / maxDeptTotal) * 100);
              const closedPct = Math.round((d.closed / maxDeptTotal) * 100);
              return (
                <div key={d.department} className="grid items-center gap-2 sm:grid-cols-12">
                  <div className="truncate text-xs font-bold text-slate-800 sm:col-span-3">
                    {d.department}
                  </div>
                  <div className="space-y-1 sm:col-span-7">
                    <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-navy"
                        style={{ width: `${Math.max(2, totalPct)}%` }}
                      />
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-turquoise"
                        style={{ width: `${closedPct}%` }}
                      />
                    </div>
                  </div>
                  <div className="text-right text-xs font-bold text-slate-700 sm:col-span-2">
                    {d.closed} / {d.total}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Departman & Teknisyen Performans Tabloları */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3.5 text-sm font-extrabold text-navy">
            <Wrench className="h-4 w-4 text-turquoise" />
            Departman Performans Özeti
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-canvas text-[11px] font-extrabold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-3">Departman</th>
                  <th className="px-4 py-3">Toplam</th>
                  <th className="px-4 py-3">Çözülen</th>
                  <th className="px-4 py-3">Ort. Müdahale</th>
                  <th className="px-4 py-3">Ort. Çözüm</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {deptSummary.map((d) => (
                  <tr key={d.department} className="hover:bg-canvas/60">
                    <td className="px-4 py-2.5 font-bold text-navy">{d.department}</td>
                    <td className="px-4 py-2.5">{d.total}</td>
                    <td className="px-4 py-2.5 font-bold text-emerald-700">{d.closed}</td>
                    <td className="px-4 py-2.5">{formatDuration(d.avgResp)}</td>
                    <td className="px-4 py-2.5">{formatDuration(d.avgRes)}</td>
                  </tr>
                ))}
                {deptSummary.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                      {loading ? 'Hesaplanıyor...' : 'Kayıt yok.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3.5 text-sm font-extrabold text-navy">
            <Users className="h-4 w-4 text-turquoise" />
            Teknisyen Performans Analizi
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-canvas text-[11px] font-extrabold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-3">Teknisyen</th>
                  <th className="px-4 py-3">Atanan İş</th>
                  <th className="px-4 py-3">Tamamlanan</th>
                  <th className="px-4 py-3">Ort. Müdahale</th>
                  <th className="px-4 py-3">Ort. Çözüm</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {techSummary.map((t) => (
                  <tr key={t.name} className="hover:bg-canvas/60">
                    <td className="px-4 py-2.5 font-bold text-navy">{t.name}</td>
                    <td className="px-4 py-2.5">{t.assigned}</td>
                    <td className="px-4 py-2.5 font-bold text-emerald-700">{t.completed}</td>
                    <td className="px-4 py-2.5">{formatDuration(t.avgResp)}</td>
                    <td className="px-4 py-2.5">{formatDuration(t.avgRes)}</td>
                  </tr>
                ))}
                {techSummary.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                      {loading ? 'Hesaplanıyor...' : 'Teknisyen atama verisi bulunmuyor.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

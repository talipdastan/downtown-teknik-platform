'use client';

import { useCallback, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Calendar,
  Camera,
  CheckCircle2,
  Clock,
  FileDown,
  FileSpreadsheet,
  PauseCircle,
  Pencil,
  PlayCircle,
  Plus,
  Search,
  Sparkles,
  Trash2,
  UserCheck,
  UserPlus,
  X,
} from 'lucide-react';
import {
  createWorkOrder,
  deleteWorkOrder,
  fetchWorkOrdersPageData,
  purgeExpiredClosedPhotos,
  technicianCompleteWork,
  technicianPauseWork,
  technicianStartWork,
  updateWorkOrder,
} from '@/features/work-tracking/queries';
import { useDebouncedRealtime } from '@/core/hooks/useDebouncedRealtime';
import {
  WorkOrderDetailDrawer,
  WorkOrderDrawerInput,
} from '@/components/WorkOrderDetailDrawer';
import {
  CompleteWorkOrderModal,
  EditWorkOrderModal,
} from '@/features/work-tracking/components/WorkOrderModals';
import {
  formatDateTime,
  PRIORITY_LABELS,
  WORK_ORDER_STATUS_LABELS,
} from '@/core/constants';
import { useDashboardAuth } from '@/core/DashboardContext';
import { hasModulePermission } from '@/core/permissions';
import {
  exportExcelXml,
  exportPrintablePdf,
  ReportCell,
} from '@/core/utils/report-export';
import { WorkOrderStatus } from '@/types/database';
import {
  calcDurationLabel,
  resolveCompleterName,
  resolveLocationLabel,
  resolveRequesterName,
  resolveRequestOpenDate,
  StatusTab,
  toIsoDate,
  woBadgeClass,
  WorkOrderRow,
} from '@/features/work-tracking/work-order-helpers';

export default function WorkTrackingWorkOrdersPage() {
  const { profile } = useDashboardAuth();
  const canManage = hasModulePermission(profile, 'work_tracking', 'manage');
  const canCreateWO =
    canManage && hasModulePermission(profile, 'work_tracking', 'create');
  const canExecute = hasModulePermission(profile, 'work_tracking', 'edit');
  const canEditWO =
    canManage && hasModulePermission(profile, 'work_tracking', 'edit');
  const canDeleteWO = hasModulePermission(profile, 'work_tracking', 'delete');
  const canReports = hasModulePermission(profile, 'work_tracking', 'reports');

  const queryClient = useQueryClient();

  // Yeni iş emri formu
  const [ticketId, setTicketId] = useState('');
  const [deptId, setDeptId] = useState('');
  const [selectedTechIds, setSelectedTechIds] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [purgingPhotos, setPurgingPhotos] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Filtreler (Durum + Arama + Tarih Aralığı)
  const [statusTab, setStatusTab] = useState<StatusTab>('all');
  const [search, setSearch] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [orderLimit, setOrderLimit] = useState(300);
  const [drawerItem, setDrawerItem] = useState<WorkOrderDrawerInput | null>(null);

  // Düzenleme modalı
  const [editTarget, setEditTarget] = useState<WorkOrderRow | null>(null);
  const [editDeptId, setEditDeptId] = useState('');
  const [editStatus, setEditStatus] = useState<WorkOrderStatus>('assigned');
  const [editDesc, setEditDesc] = useState('');
  const [editWaitingReason, setEditWaitingReason] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  // Tamamla & Fotoğraf Ekle modalı
  const [completeTarget, setCompleteTarget] = useState<WorkOrderRow | null>(null);
  const [completeNote, setCompleteNote] = useState('');
  const [completePhotos, setCompletePhotos] = useState<File[]>([]);
  const [completing, setCompleting] = useState(false);

  const { data: woPageData, isLoading: loading } = useQuery({
    queryKey: ['wt', 'work-orders', { startDate, endDate, orderLimit }],
    placeholderData: (prev) => prev,
    queryFn: () => fetchWorkOrdersPageData({ startDate, endDate, orderLimit }),
  });

  const tickets = useMemo(() => woPageData?.tickets ?? [], [woPageData]);
  const depts = useMemo(() => woPageData?.depts ?? [], [woPageData]);
  const techs = useMemo(() => woPageData?.techs ?? [], [woPageData]);
  const orders = useMemo(() => woPageData?.orders ?? [], [woPageData]);
  const totalOrdersCount = woPageData?.totalOrdersCount ?? null;
  const techWorkloads = useMemo(() => woPageData?.techWorkloads ?? {}, [woPageData]);

  const loadAll = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['wt', 'work-orders'] });
  }, [queryClient]);

  useDebouncedRealtime({
    channelName: 'wt-work-orders-live',
    tables: ['work_orders', 'tickets'],
    onRefresh: loadAll,
    delayMs: 500,
  });

  function applyDatePreset(preset: 'today' | 'this_week' | 'this_month' | 'last_30' | 'clear') {
    const now = new Date();
    if (preset === 'clear') {
      setStartDate('');
      setEndDate('');
      return;
    }
    if (preset === 'today') {
      const iso = toIsoDate(now);
      setStartDate(iso);
      setEndDate(iso);
      return;
    }
    if (preset === 'this_week') {
      const day = now.getDay();
      const diff = day === 0 ? -6 : 1 - day;
      const monday = new Date(now);
      monday.setDate(now.getDate() + diff);
      setStartDate(toIsoDate(monday));
      setEndDate(toIsoDate(now));
      return;
    }
    if (preset === 'this_month') {
      setStartDate(toIsoDate(new Date(now.getFullYear(), now.getMonth(), 1)));
      setEndDate(toIsoDate(now));
      return;
    }
    const prev = new Date(now);
    prev.setDate(prev.getDate() - 30);
    setStartDate(toIsoDate(prev));
    setEndDate(toIsoDate(now));
  }

  const filteredOrders = useMemo(() => {
    const q = search.trim().toLowerCase();
    const startMs = startDate ? new Date(`${startDate}T00:00:00`).getTime() : null;
    const endMs = endDate ? new Date(`${endDate}T23:59:59`).getTime() : null;

    return orders.filter((o) => {
      if (statusTab === 'active' && !['assigned', 'in_progress'].includes(o.status)) {
        return false;
      }
      if (statusTab === 'waiting' && o.status !== 'waiting') return false;
      if (statusTab === 'completed' && !['completed', 'cancelled'].includes(o.status)) {
        return false;
      }

      if (startMs !== null || endMs !== null) {
        const refDateMs = new Date(resolveRequestOpenDate(o)).getTime();
        if (startMs !== null && refDateMs < startMs) return false;
        if (endMs !== null && refDateMs > endMs) return false;
      }

      if (!q) return true;
      const techNames = (o.work_order_assignments ?? [])
        .map((a) => a.profiles?.full_name ?? '')
        .join(' ')
        .toLowerCase();
      const requester = resolveRequesterName(o).toLowerCase();
      const completer = resolveCompleterName(o).toLowerCase();
      const loc = resolveLocationLabel(o).toLowerCase();

      return (
        (o.tickets?.ticket_number ?? '').toLowerCase().includes(q) ||
        (o.tickets?.description ?? '').toLowerCase().includes(q) ||
        (o.work_description ?? '').toLowerCase().includes(q) ||
        (o.departments?.name ?? '').toLowerCase().includes(q) ||
        (o.equipments?.name ?? '').toLowerCase().includes(q) ||
        techNames.includes(q) ||
        requester.includes(q) ||
        completer.includes(q) ||
        loc.includes(q)
      );
    });
  }, [orders, statusTab, search, startDate, endDate]);

  async function handleAssign(e: React.FormEvent) {
    e.preventDefault();
    if (!ticketId || !deptId) return;
    setSubmitting(true);
    setMsg(null);
    try {
      await createWorkOrder({
        ticketId,
        departmentId: deptId,
        assignedUserIds: selectedTechIds,
        workDescription: note.trim() || null,
      });
      setMsg({ type: 'ok', text: 'İş emri oluşturuldu ve atandı.' });
      setTicketId('');
      setDeptId('');
      setSelectedTechIds([]);
      setNote('');
      await loadAll();
    } catch (err) {
      setMsg({ type: 'err', text: err instanceof Error ? err.message : 'Atama başarısız.' });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleStartWork(woId: string) {
    setMsg(null);
    try {
      await technicianStartWork(woId);
      setMsg({ type: 'ok', text: 'İş emri başlatıldı.' });
      await loadAll();
    } catch (err) {
      setMsg({ type: 'err', text: err instanceof Error ? err.message : 'Başlatılamadı.' });
    }
  }

  async function handlePauseWork(woId: string) {
    const reason = window.prompt('Beklemeye alma gerekçesini yazınız:');
    if (!reason || !reason.trim()) return;
    setMsg(null);
    try {
      await technicianPauseWork(woId, reason.trim());
      setMsg({ type: 'ok', text: 'İş emri beklemeye alındı.' });
      await loadAll();
    } catch (err) {
      setMsg({ type: 'err', text: err instanceof Error ? err.message : 'Beklemeye alınamadı.' });
    }
  }

  async function handleCompleteSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!completeTarget) return;
    setCompleting(true);
    setMsg(null);
    try {
      await technicianCompleteWork({
        workOrderId: completeTarget.id,
        note: completeNote.trim() || 'Web panelinden tamamlandı.',
        photos: completePhotos,
      });

      setMsg({
        type: 'ok',
        text:
          completePhotos.length > 0
            ? `İş emri ${completePhotos.length} sıkıştırılmış çözüm fotoğrafıyla tamamlandı ve onaya gönderildi.`
            : 'İş emri tamamlandı ve onaya gönderildi.',
      });
      setCompleteTarget(null);
      setCompleteNote('');
      setCompletePhotos([]);
      await loadAll();
    } catch (err) {
      setMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Tamamlama işlemi başarısız.',
      });
    } finally {
      setCompleting(false);
    }
  }

  async function handlePurgeExpiredPhotos() {
    setPurgingPhotos(true);
    setMsg(null);
    try {
      const totalPurged = await purgeExpiredClosedPhotos(15);

      setMsg({
        type: 'ok',
        text:
          totalPurged > 0
            ? `Kapanmasının üzerinden 15 gün geçmiş işlere ait ${totalPurged} adet fotoğraf resmi Storage API ile depolama ve veritabanından temizlendi.`
            : 'Depolama temiz: Kapanmasının üzerinden 15 gün geçmiş silinecek fotoğraf bulunmuyor.',
      });
    } catch (err) {
      const errText =
        err instanceof Error
          ? err.message
          : typeof err === 'object' && err !== null && 'message' in err
          ? String((err as { message: unknown }).message)
          : 'Fotoğraf temizliği çalıştırılamadı.';
      setMsg({
        type: 'err',
        text: errText,
      });
    } finally {
      setPurgingPhotos(false);
    }
  }

  function openEditModal(o: WorkOrderRow) {
    setEditTarget(o);
    setEditDeptId(o.department_id);
    setEditStatus(o.status);
    setEditDesc(o.work_description ?? '');
    setEditWaitingReason(o.waiting_reason ?? '');
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editTarget) return;
    setSavingEdit(true);
    setMsg(null);
    try {
      await updateWorkOrder(editTarget.id, {
        department_id: editDeptId,
        status: editStatus,
        work_description: editDesc.trim() || null,
        waiting_reason: editStatus === 'waiting' ? editWaitingReason.trim() || null : null,
      });
      setEditTarget(null);
      setMsg({ type: 'ok', text: 'İş emri güncellendi.' });
      await loadAll();
    } catch (err) {
      setMsg({ type: 'err', text: err instanceof Error ? err.message : 'Güncellenemedi.' });
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleDelete(o: WorkOrderRow) {
    const label = o.tickets?.ticket_number ?? o.id.slice(0, 8);
    if (!window.confirm(`${label} iş emrini silmek istediğinize emin misiniz?`)) return;
    setMsg(null);
    try {
      await deleteWorkOrder(o.id);
      setMsg({ type: 'ok', text: `${label} iş emri silindi.` });
      await loadAll();
    } catch (err) {
      setMsg({ type: 'err', text: err instanceof Error ? err.message : 'Silinemedi.' });
    }
  }

  function toggleTech(id: string) {
    setSelectedTechIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function buildReportData() {
    const headers = [
      'Arıza No',
      'Mahal / Konum',
      'İstek Açan',
      'Açılış Tarihi',
      'Departman',
      'Atanan Teknisyenler',
      'İsteği Tamamlayan',
      'Tamamlanma Tarihi',
      'Çözüm Süresi',
      'Ekipman',
      'Açıklama / Talimat',
      'Durum',
    ];
    const reportRows: ReportCell[][] = filteredOrders.map((o) => {
      const techNames =
        (o.work_order_assignments ?? [])
          .map((a) => a.profiles?.full_name)
          .filter(Boolean)
          .join(', ') || '-';
      const openDate = resolveRequestOpenDate(o);
      const duration = calcDurationLabel(openDate, o.completed_at) ?? '-';

      return [
        o.tickets?.ticket_number ?? '-',
        resolveLocationLabel(o),
        resolveRequesterName(o),
        formatDateTime(openDate),
        o.departments?.name ?? '-',
        techNames,
        resolveCompleterName(o),
        o.completed_at ? formatDateTime(o.completed_at) : '-',
        duration,
        o.equipments ? `${o.equipments.code} - ${o.equipments.name}` : '-',
        o.work_description ?? o.tickets?.description ?? '-',
        WORK_ORDER_STATUS_LABELS[o.status] ?? o.status,
      ];
    });
    return { headers, reportRows };
  }

  function handleExportExcel() {
    const { headers, reportRows } = buildReportData();
    const dateLabel =
      startDate || endDate
        ? ` (${startDate || 'Başlangıç'} - ${endDate || 'Bugün'})`
        : '';
    exportExcelXml({
      fileName: `downtown_teknik_is_emirleri_${new Date().toISOString().slice(0, 10)}.xls`,
      sheetName: 'Is_Emirleri',
      title: `DOWNTOWN TEKNİK · İş Emirleri & Tamamlanma Raporu${dateLabel}`,
      subtitle: `${filteredOrders.length} iş emri listeleniyor`,
      headers,
      rows: reportRows,
    });
  }

  function handleExportPdf() {
    const { headers, reportRows } = buildReportData();
    const dateLabel =
      startDate || endDate
        ? `Tarih Aralığı: ${startDate || 'Tümü'} – ${endDate || 'Bugün'}`
        : 'Tüm Dönemler';
    exportPrintablePdf({
      title: 'İş Emirleri, İstek Açan & Tamamlayan Raporu',
      subtitle: `${dateLabel} · ${filteredOrders.length} kayıt`,
      kpis: [
        { label: 'Toplam İş Emri', value: String(filteredOrders.length), tone: 'navy' },
        {
          label: 'Aktif / İşlemde',
          value: String(
            filteredOrders.filter((o) => ['assigned', 'in_progress'].includes(o.status)).length
          ),
          tone: 'slate',
        },
        {
          label: 'Beklemede',
          value: String(filteredOrders.filter((o) => o.status === 'waiting').length),
          tone: 'red',
        },
        {
          label: 'Tamamlanan',
          value: String(filteredOrders.filter((o) => o.status === 'completed').length),
          tone: 'green',
        },
      ],
      headers,
      rows: reportRows,
    });
  }

  return (
    <div className="space-y-5">
      {/* Üst Başlık ve Raporlama Butonları */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400">
            İŞ TAKİP MODÜLÜ
          </div>
          <h1 className="mt-0.5 text-2xl font-extrabold text-slate-900">
            İş Emirleri & Teknisyen Atama
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            İstek açan, açılış tarihi, atanan ekip, işi tamamlayan personel ve tamamlanma süresiyle
            detaylı iş emri yönetimi.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canManage && (
            <button
              type="button"
              onClick={handlePurgeExpiredPhotos}
              disabled={purgingPhotos}
              title="Kapanan işlerde 15 günü geçen fotoğrafları veritabanı ve depolamadan temizler"
              className="inline-flex items-center gap-1.5 rounded-xl border border-cyan-200 bg-cyan-50 px-3 py-2 text-xs font-bold text-cyan-900 transition hover:bg-cyan-100 disabled:opacity-40"
            >
              <Sparkles className="h-3.5 w-3.5 text-turquoise" />
              {purgingPhotos ? 'Temizleniyor...' : '15 Günlük Fotoğraf Temizliği'}
            </button>
          )}
          {canReports && (
            <>
              <button
                type="button"
                onClick={handleExportExcel}
                disabled={filteredOrders.length === 0}
                className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2 text-xs font-bold text-emerald-800 transition hover:bg-emerald-100 disabled:opacity-40"
              >
                <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-700" />
                Excel İndir (.xls)
              </button>
              <button
                type="button"
                onClick={handleExportPdf}
                disabled={filteredOrders.length === 0}
                className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2 text-xs font-bold text-rose-800 transition hover:bg-rose-100 disabled:opacity-40"
              >
                <FileDown className="h-3.5 w-3.5 text-rose-700" />
                PDF Rapor İndir
              </button>
            </>
          )}
        </div>
      </div>

      {totalOrdersCount !== null && totalOrdersCount > orders.length && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs font-semibold text-amber-900">
          <span>
            Seçili tarih aralığında toplam <strong>{totalOrdersCount}</strong> iş emri var; şu an
            en güncel <strong>{orders.length}</strong> kayıt görüntüleniyor.
          </span>
          <button
            type="button"
            onClick={() => setOrderLimit((prev) => prev + 300)}
            className="rounded-lg border border-amber-300 bg-white px-3 py-1 text-xs font-bold text-amber-900 hover:bg-amber-100"
          >
            +300 Daha Yükle
          </button>
        </div>
      )}

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

      {/* Yeni İş Emri Oluştur / Ata */}
      {canCreateWO && (
        <form
          onSubmit={handleAssign}
          className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-extrabold uppercase tracking-wider text-navy">
              Yeni İş Emri Oluştur / Teknisyen Ata ({tickets.length} Atama Bekleyen Arıza)
            </div>
            <span className="text-[11px] font-semibold text-slate-400">
              * Fotoğraflar otomatik ~100 KB boyutuna sıkıştırılır, kapanan işlerin fotoğrafları 15 gün sonra otomatik silinir.
            </span>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <select
              required
              value={ticketId}
              onChange={(e) => setTicketId(e.target.value)}
              className="rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm text-slate-800 focus:border-navy focus:outline-none"
            >
              <option value="">Atama Bekleyen Arıza Kaydı Seçiniz *</option>
              {tickets.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.ticket_number ?? t.id} – {t.description.slice(0, 65)}
                </option>
              ))}
            </select>
            <select
              required
              value={deptId}
              onChange={(e) => setDeptId(e.target.value)}
              className="rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm text-slate-800 focus:border-navy focus:outline-none"
            >
              <option value="">Sorumlu Departman Seçiniz *</option>
              {depts.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div className="mb-1.5 text-xs font-bold text-slate-600">Atanacak Teknisyenler</div>
            <div className="flex flex-wrap gap-2">
              {techs.map((t) => {
                const checked = selectedTechIds.includes(t.id);
                const activeJobs = techWorkloads[t.id] ?? 0;
                return (
                  <button
                    type="button"
                    key={t.id}
                    onClick={() => toggleTech(t.id)}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold transition ${
                      checked
                        ? 'border-navy bg-navy text-white shadow-sm'
                        : 'border-slate-200 bg-canvas text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <span>{t.full_name}</span>
                    <span
                      className={`rounded-full px-1.5 py-0.2 text-[10px] font-extrabold ${
                        checked
                          ? 'bg-white/20 text-white'
                          : activeJobs >= 3
                          ? 'bg-rose-100 text-rose-700'
                          : activeJobs > 0
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-emerald-100 text-emerald-700'
                      }`}
                    >
                      {activeJobs} iş
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <input
              type="text"
              placeholder="Teknisyen talimatı / iş açıklaması (opsiyonel)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="min-w-[240px] flex-1 rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm focus:border-navy focus:outline-none"
            />
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-1.5 rounded-xl bg-navy px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-navy-hover disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" />
              {submitting ? 'Atanıyor...' : 'İş Emri Oluştur'}
            </button>
          </div>
        </form>
      )}

      {/* Filtre, Tarih Aralığı & Arama Barı */}
      <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Durum Sekmeleri */}
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                ['all', `Tümü (${orders.length})`],
                [
                  'active',
                  `Aktif (${
                    orders.filter((o) => ['assigned', 'in_progress'].includes(o.status)).length
                  })`,
                ],
                ['waiting', `Beklemede (${orders.filter((o) => o.status === 'waiting').length})`],
                [
                  'completed',
                  `Tamamlanan (${
                    orders.filter((o) => ['completed', 'cancelled'].includes(o.status)).length
                  })`,
                ],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setStatusTab(key)}
                className={`rounded-full px-4 py-1.5 text-xs font-bold transition ${
                  statusTab === key
                    ? 'bg-navy text-white shadow-sm'
                    : 'border border-slate-200 bg-canvas text-slate-700 hover:bg-slate-100'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Arama */}
          <div className="relative min-w-[260px] flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Arıza no, istek açan, tamamlayan, mahal ara..."
              className="w-full rounded-xl border border-slate-200 bg-canvas py-1.5 pl-9 pr-3 text-sm focus:border-navy focus:outline-none"
            />
          </div>
        </div>

        {/* Rapor & Liste İçin Tarih Aralığı Seçici */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 inline-flex items-center gap-1 text-xs font-extrabold text-navy">
              <Calendar className="h-3.5 w-3.5 text-turquoise" />
              Rapor Tarihi:
            </span>
            <button
              type="button"
              onClick={() => applyDatePreset('today')}
              className="rounded-lg border border-slate-200 bg-canvas px-2.5 py-1 text-xs font-bold text-slate-700 hover:bg-navy-soft hover:text-navy"
            >
              Bugün
            </button>
            <button
              type="button"
              onClick={() => applyDatePreset('this_week')}
              className="rounded-lg border border-slate-200 bg-canvas px-2.5 py-1 text-xs font-bold text-slate-700 hover:bg-navy-soft hover:text-navy"
            >
              Bu Hafta
            </button>
            <button
              type="button"
              onClick={() => applyDatePreset('this_month')}
              className="rounded-lg border border-slate-200 bg-canvas px-2.5 py-1 text-xs font-bold text-slate-700 hover:bg-navy-soft hover:text-navy"
            >
              Bu Ay
            </button>
            <button
              type="button"
              onClick={() => applyDatePreset('last_30')}
              className="rounded-lg border border-slate-200 bg-canvas px-2.5 py-1 text-xs font-bold text-slate-700 hover:bg-navy-soft hover:text-navy"
            >
              Son 30 Gün
            </button>
            {(startDate || endDate) && (
              <button
                type="button"
                onClick={() => applyDatePreset('clear')}
                className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-bold text-red-700 hover:bg-red-100"
              >
                Tüm Tarihler
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-600">
            <span>Başlangıç:</span>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="rounded-xl border border-slate-200 bg-canvas px-2.5 py-1 text-xs font-bold text-slate-800 focus:border-navy focus:outline-none"
            />
            <span>Bitiş:</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="rounded-xl border border-slate-200 bg-canvas px-2.5 py-1 text-xs font-bold text-slate-800 focus:border-navy focus:outline-none"
            />
          </div>
        </div>
      </div>

      {/* Zenginleştirilmiş İş Emirleri Tablosu */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-canvas text-[11px] font-extrabold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">Arıza No & Mahal</th>
                <th className="px-4 py-3">İstek Açan & Açılış Tarihi</th>
                <th className="px-4 py-3">Departman & Atanan</th>
                <th className="px-4 py-3">İsteği Tamamlayan & Bitiş Tarihi</th>
                <th className="px-4 py-3">Ekipman & Açıklama</th>
                <th className="px-4 py-3">Durum</th>
                <th className="px-4 py-3 text-right">İşlem</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredOrders.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-slate-500">
                    {loading ? 'Yükleniyor...' : 'Seçili tarih ve filtrede iş emri bulunamadı.'}
                  </td>
                </tr>
              ) : (
                filteredOrders.map((o) => {
                  const techNames =
                    (o.work_order_assignments ?? [])
                      .map((a) => a.profiles?.full_name)
                      .filter(Boolean)
                      .join(', ') || 'Atanmadı';
                  const requesterName = resolveRequesterName(o);
                  const openDate = resolveRequestOpenDate(o);
                  const completerName = resolveCompleterName(o);
                  const durationLabel = calcDurationLabel(openDate, o.completed_at);
                  const locationLabel = resolveLocationLabel(o);
                  const priority = o.tickets?.priority;

                  const isAssignedToMe = (o.work_order_assignments ?? []).some(
                    (a) => a.user_id === profile?.id
                  );
                  const canRunStatusActions = canExecute && (canManage || isAssignedToMe);
                  const hasAnyRowAction =
                    (canRunStatusActions &&
                      ['assigned', 'waiting', 'in_progress'].includes(o.status)) ||
                    canEditWO ||
                    canDeleteWO;

                  return (
                    <tr key={o.id} className="align-top transition hover:bg-canvas/60">
                      {/* 1. Arıza No & Mahal */}
                      <td className="whitespace-nowrap px-4 py-3.5">
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() =>
                              setDrawerItem({
                                id: o.id,
                                ticket_id: o.ticket_id,
                                status: o.status,
                                work_description: o.work_description,
                                waiting_reason: o.waiting_reason,
                                created_at: o.created_at,
                                started_at: o.started_at,
                                completed_at: o.completed_at,
                                ticket_number: o.tickets?.ticket_number ?? '-',
                                ticket_description: o.tickets?.description ?? '-',
                                requester_name: requesterName,
                                open_date: openDate,
                                completer_name: completerName,
                                department_name: o.departments?.name ?? '-',
                                location_label: locationLabel,
                                equipment_label: o.equipments
                                  ? `${o.equipments.code} - ${o.equipments.name}`
                                  : '-',
                                technicians_label: techNames,
                              })
                            }
                            className="font-extrabold text-navy underline-offset-2 hover:text-turquoise hover:underline"
                            title="İş Emri 360° Detay, Fotoğraf ve Malzemeleri Gör"
                          >
                            {o.tickets?.ticket_number ?? '-'}
                          </button>
                          {priority === 'urgent' && (
                            <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-extrabold text-red-700">
                              Acil
                            </span>
                          )}
                          {priority === 'priority' && (
                            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-extrabold text-amber-800">
                              Öncelikli
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 max-w-[180px] truncate text-xs font-medium text-slate-500">
                          {locationLabel}
                        </div>
                      </td>

                      {/* 2. İstek Açan & Açılış Tarihi */}
                      <td className="whitespace-nowrap px-4 py-3.5">
                        <div className="flex items-center gap-1.5 font-bold text-slate-800">
                          <UserPlus className="h-3.5 w-3.5 text-sky-600" />
                          <span>{requesterName}</span>
                        </div>
                        <div className="mt-0.5 pl-5 text-xs text-slate-500">
                          {formatDateTime(openDate)}
                        </div>
                      </td>

                      {/* 3. Departman & Atanan Teknisyen */}
                      <td className="px-4 py-3.5">
                        <div className="font-bold text-navy">
                          {o.departments?.name ?? '-'}
                        </div>
                        <div className="mt-0.5 text-xs font-medium text-slate-500">
                          {techNames}
                        </div>
                      </td>

                      {/* 4. İsteği Tamamlayan & Tamamlanma Tarihi */}
                      <td className="whitespace-nowrap px-4 py-3.5">
                        {o.status === 'completed' ? (
                          <div>
                            <div className="flex items-center gap-1.5 font-bold text-emerald-700">
                              <UserCheck className="h-3.5 w-3.5 text-emerald-600" />
                              <span>{completerName}</span>
                            </div>
                            <div className="mt-0.5 pl-5 text-xs text-slate-500">
                              {o.completed_at ? formatDateTime(o.completed_at) : '-'}
                            </div>
                            {durationLabel && (
                              <div className="mt-1 inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-[10.5px] font-extrabold text-emerald-800">
                                <Clock className="h-3 w-3" />
                                Süre: {durationLabel}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-500">
                            <Clock className="h-3 w-3" />
                            Devam Ediyor
                          </span>
                        )}
                      </td>

                      {/* 5. Ekipman & Açıklama */}
                      <td className="max-w-[260px] px-4 py-3.5">
                        {o.equipments && (
                          <div className="mb-0.5 text-xs font-extrabold text-turquoise">
                            {o.equipments.code} - {o.equipments.name}
                          </div>
                        )}
                        <div className="line-clamp-2 text-xs font-medium text-slate-700">
                          {o.work_description ?? o.tickets?.description ?? '-'}
                        </div>
                        {o.waiting_reason && (
                          <div className="mt-1 rounded bg-orange-50 px-2 py-0.5 text-[11px] font-semibold text-orange-800">
                            Bekleme: {o.waiting_reason}
                          </div>
                        )}
                      </td>

                      {/* 6. Durum */}
                      <td className="whitespace-nowrap px-4 py-3.5">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-extrabold ${woBadgeClass(
                            o.status
                          )}`}
                        >
                          {WORK_ORDER_STATUS_LABELS[o.status] ?? o.status}
                        </span>
                      </td>

                      {/* 7. İşlem */}
                      <td className="whitespace-nowrap px-4 py-3.5">
                        {hasAnyRowAction ? (
                          <div className="flex flex-wrap items-center justify-end gap-1.5">
                            {canRunStatusActions &&
                              (o.status === 'assigned' || o.status === 'waiting') && (
                                <button
                                  type="button"
                                  onClick={() => handleStartWork(o.id)}
                                  className="inline-flex items-center gap-1 rounded-lg bg-navy px-2.5 py-1 text-xs font-bold text-white hover:bg-navy-hover"
                                >
                                  <PlayCircle className="h-3.5 w-3.5" />
                                  Başlat
                                </button>
                              )}

                            {canRunStatusActions && o.status === 'in_progress' && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handlePauseWork(o.id)}
                                  className="inline-flex items-center gap-1 rounded-lg border border-orange-200 bg-orange-50 px-2.5 py-1 text-xs font-bold text-orange-800 hover:bg-orange-100"
                                >
                                  <PauseCircle className="h-3.5 w-3.5" />
                                  Beklemeye Al
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setCompleteTarget(o);
                                    setCompleteNote('');
                                    setCompletePhotos([]);
                                  }}
                                  className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-bold text-white hover:bg-emerald-700"
                                >
                                  <CheckCircle2 className="h-3.5 w-3.5" />
                                  Tamamla
                                </button>
                              </>
                            )}

                            {canEditWO && (
                              <button
                                type="button"
                                onClick={() => openEditModal(o)}
                                title="Düzenle"
                                className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:border-navy hover:bg-navy-soft hover:text-navy"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                            )}
                            {canDeleteWO && (
                              <button
                                type="button"
                                onClick={() => handleDelete(o)}
                                title="Sil"
                                className="rounded-lg border border-slate-200 p-1.5 text-red-600 hover:border-red-300 hover:bg-red-50"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        ) : (
                          <div className="text-right text-xs text-slate-400">Salt Okunur</div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <CompleteWorkOrderModal
        target={completeTarget}
        completeNote={completeNote}
        setCompleteNote={setCompleteNote}
        completePhotos={completePhotos}
        setCompletePhotos={setCompletePhotos}
        completing={completing}
        onClose={() => setCompleteTarget(null)}
        onSubmit={handleCompleteSubmit}
      />

      <EditWorkOrderModal
        target={editTarget}
        depts={depts}
        editDeptId={editDeptId}
        setEditDeptId={setEditDeptId}
        editStatus={editStatus}
        setEditStatus={setEditStatus}
        editDesc={editDesc}
        setEditDesc={setEditDesc}
        editWaitingReason={editWaitingReason}
        setEditWaitingReason={setEditWaitingReason}
        savingEdit={savingEdit}
        onClose={() => setEditTarget(null)}
        onSubmit={handleSaveEdit}
      />

      <WorkOrderDetailDrawer item={drawerItem} onClose={() => setDrawerItem(null)} />
    </div>
  );
}

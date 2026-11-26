'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Camera,
  CheckCircle2,
  FileDown,
  FileSpreadsheet,
  PauseCircle,
  Pencil,
  PlayCircle,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { createClient } from '@/core/supabase/client';
import { formatDateTime, WORK_ORDER_STATUS_LABELS } from '@/core/constants';
import { useDashboardAuth } from '@/core/DashboardContext';
import { hasModulePermission } from '@/core/permissions';
import {
  exportExcelXml,
  exportPrintablePdf,
  ReportCell,
} from '@/core/utils/report-export';
import { WorkOrderStatus } from '@/types/database';

type OpenTicket = {
  id: string;
  ticket_number: string | null;
  description: string;
  priority: string;
  status: string;
};

type Dept = { id: string; name: string };
type Tech = { id: string; full_name: string; department_id: string | null };
type WorkOrderRow = {
  id: string;
  ticket_id: string;
  department_id: string;
  status: WorkOrderStatus;
  work_description: string | null;
  waiting_reason: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  tickets?: { ticket_number: string | null; description: string } | null;
  departments?: { name: string } | null;
  equipments?: { code: string; name: string } | null;
  work_order_assignments?: {
    user_id: string;
    profiles?: { full_name: string } | null;
  }[];
};

type StatusTab = 'all' | 'active' | 'waiting' | 'completed';

function woBadgeClass(s: WorkOrderStatus): string {
  switch (s) {
    case 'assigned':
      return 'bg-sky-100 text-sky-800';
    case 'in_progress':
      return 'bg-amber-100 text-amber-800';
    case 'waiting':
      return 'bg-orange-100 text-orange-800';
    case 'completed':
      return 'bg-emerald-100 text-emerald-700';
    case 'cancelled':
      return 'bg-rose-100 text-rose-700';
  }
}

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

  const [tickets, setTickets] = useState<OpenTicket[]>([]);
  const [depts, setDepts] = useState<Dept[]>([]);
  const [techs, setTechs] = useState<Tech[]>([]);
  const [orders, setOrders] = useState<WorkOrderRow[]>([]);

  // Yeni iş emri formu
  const [ticketId, setTicketId] = useState('');
  const [deptId, setDeptId] = useState('');
  const [selectedTechIds, setSelectedTechIds] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Filtreler
  const [statusTab, setStatusTab] = useState<StatusTab>('all');
  const [search, setSearch] = useState('');

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

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const supabase = createClient();
      const [tRes, dRes, techRes, woRes] = await Promise.all([
        supabase
          .from('tickets')
          .select('id, ticket_number, description, priority, status')
          .in('status', ['new', 'under_review'])
          .order('created_at', { ascending: false })
          .limit(100),
        supabase.from('departments').select('id, name').eq('is_active', true).order('name'),
        supabase
          .from('profiles')
          .select('id, full_name, department_id')
          .in('role', ['technician', 'team_lead'])
          .eq('approval_status', 'approved')
          .order('full_name'),
        supabase
          .from('work_orders')
          .select(
            'id, ticket_id, department_id, status, work_description, waiting_reason, created_at, started_at, completed_at, tickets(ticket_number, description), departments(name), equipments(code, name), work_order_assignments(user_id, profiles!work_order_assignments_user_id_fkey(full_name))'
          )
          .order('created_at', { ascending: false })
          .limit(200),
      ]);
      if (tRes.data) setTickets(tRes.data as OpenTicket[]);
      if (dRes.data) setDepts(dRes.data as Dept[]);
      if (techRes.data) setTechs(techRes.data as Tech[]);
      if (woRes.error) throw woRes.error;
      setOrders((woRes.data as unknown as WorkOrderRow[]) ?? []);
    } catch (err) {
      setMsg({ type: 'err', text: err instanceof Error ? err.message : 'Veriler alınamadı.' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
    const supabase = createClient();
    const channel = supabase
      .channel('wt-work-orders-live')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'work_orders' },
        () => loadAll()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tickets' },
        () => loadAll()
      )
      .subscribe();
    const onFocus = () => loadAll();
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      supabase.removeChannel(channel);
    };
  }, [loadAll]);

  const filteredOrders = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orders.filter((o) => {
      if (statusTab === 'active' && !['assigned', 'in_progress'].includes(o.status)) {
        return false;
      }
      if (statusTab === 'waiting' && o.status !== 'waiting') return false;
      if (statusTab === 'completed' && !['completed', 'cancelled'].includes(o.status)) {
        return false;
      }
      if (!q) return true;
      const techNames = (o.work_order_assignments ?? [])
        .map((a) => a.profiles?.full_name ?? '')
        .join(' ')
        .toLowerCase();
      return (
        (o.tickets?.ticket_number ?? '').toLowerCase().includes(q) ||
        (o.tickets?.description ?? '').toLowerCase().includes(q) ||
        (o.work_description ?? '').toLowerCase().includes(q) ||
        (o.departments?.name ?? '').toLowerCase().includes(q) ||
        (o.equipments?.name ?? '').toLowerCase().includes(q) ||
        techNames.includes(q)
      );
    });
  }, [orders, statusTab, search]);

  async function handleAssign(e: React.FormEvent) {
    e.preventDefault();
    if (!ticketId || !deptId) return;
    setSubmitting(true);
    setMsg(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.rpc('rpc_create_work_order', {
        p_ticket_id: ticketId,
        p_department_id: deptId,
        p_assigned_user_ids: selectedTechIds,
        p_work_description: note.trim() || null,
      });
      if (error) throw error;
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
      const supabase = createClient();
      const { error } = await supabase.rpc('rpc_technician_start_work', {
        p_work_order_id: woId,
      });
      if (error) throw error;
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
      const supabase = createClient();
      const { error } = await supabase.rpc('rpc_technician_pause_work', {
        p_work_order_id: woId,
        p_waiting_reason: reason.trim(),
      });
      if (error) throw error;
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
      const supabase = createClient();
      const { data: uRes } = await supabase.auth.getUser();
      const uid = uRes.user?.id;

      if (uid && completePhotos.length > 0) {
        for (const file of completePhotos) {
          const safe = (file.name || 'after.jpg').replace(/[^a-zA-Z0-9._-]/g, '_');
          const path = `${uid}/${completeTarget.id}/${Date.now()}_${safe}`;
          const { error: upErr } = await supabase.storage
            .from('work-attachments')
            .upload(path, file, { contentType: file.type || 'image/jpeg', upsert: false });
          if (upErr) throw upErr;

          const { error: attErr } = await supabase.from('attachments').insert({
            work_order_id: completeTarget.id,
            uploaded_by: uid,
            file_path: path,
            file_name: file.name,
            mime_type: file.type || 'image/jpeg',
            attachment_type: 'after',
          });
          if (attErr) throw attErr;
        }
      }

      const { error } = await supabase.rpc('rpc_technician_complete_work', {
        p_work_order_id: completeTarget.id,
        p_note: completeNote.trim() || 'Web panelinden tamamlandı.',
      });
      if (error) throw error;

      setMsg({
        type: 'ok',
        text:
          completePhotos.length > 0
            ? `İş emri ${completePhotos.length} çözüm fotoğrafıyla tamamlandı ve onaya gönderildi.`
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
      const supabase = createClient();
      const { error } = await supabase
        .from('work_orders')
        .update({
          department_id: editDeptId,
          status: editStatus,
          work_description: editDesc.trim() || null,
          waiting_reason: editStatus === 'waiting' ? editWaitingReason.trim() || null : null,
        })
        .eq('id', editTarget.id);
      if (error) throw error;
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
      const supabase = createClient();
      const { error } = await supabase.from('work_orders').delete().eq('id', o.id);
      if (error) throw error;
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
      'Departman',
      'Atanan Teknisyenler',
      'Ekipman',
      'Açıklama',
      'Durum',
      'Bekleme Nedeni',
      'Oluşturma',
    ];
    const reportRows: ReportCell[][] = filteredOrders.map((o) => {
      const techNames =
        (o.work_order_assignments ?? [])
          .map((a) => a.profiles?.full_name)
          .filter(Boolean)
          .join(', ') || '-';
      return [
        o.tickets?.ticket_number ?? '-',
        o.departments?.name ?? '-',
        techNames,
        o.equipments ? `${o.equipments.code} - ${o.equipments.name}` : '-',
        o.work_description ?? o.tickets?.description ?? '-',
        WORK_ORDER_STATUS_LABELS[o.status] ?? o.status,
        o.waiting_reason ?? '-',
        formatDateTime(o.created_at),
      ];
    });
    return { headers, reportRows };
  }

  function handleExportExcel() {
    const { headers, reportRows } = buildReportData();
    exportExcelXml({
      fileName: `avm_tech_is_emirleri_${new Date().toISOString().slice(0, 10)}.xls`,
      sheetName: 'Is_Emirleri',
      title: 'DOWNTOWN TEKNİK · İş Emirleri Listesi',
      subtitle: `${filteredOrders.length} iş emri listeleniyor`,
      headers,
      rows: reportRows,
    });
  }

  function handleExportPdf() {
    const { headers, reportRows } = buildReportData();
    exportPrintablePdf({
      title: 'İş Emirleri & Teknisyen Atama Raporu',
      subtitle: `${filteredOrders.length} kayıt listeleniyor`,
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
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400">
            İŞ TAKİP MODÜLÜ
          </div>
          <h1 className="mt-0.5 text-2xl font-extrabold text-slate-900">
            İş Emirleri & Teknisyen Atama
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Arızalara departman ve teknisyen atayın; başlatma, bekletme ve fotoğraflı tamamlama
            süreçlerini yönetin.
          </p>
        </div>

        {canReports && (
          <div className="flex flex-wrap items-center gap-2">
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
          </div>
        )}
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

      {/* Yeni İş Emri Oluştur / Ata */}
      {canCreateWO && (
        <form
          onSubmit={handleAssign}
          className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
        >
          <div className="text-xs font-extrabold uppercase tracking-wider text-navy">
            Yeni İş Emri Oluştur / Teknisyen Ata
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <select
              required
              value={ticketId}
              onChange={(e) => setTicketId(e.target.value)}
              className="rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm text-slate-800 focus:border-navy focus:outline-none"
            >
              <option value="">Arıza Kaydı Seçiniz *</option>
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
                return (
                  <button
                    type="button"
                    key={t.id}
                    onClick={() => toggleTech(t.id)}
                    className={`rounded-full border px-3 py-1 text-xs font-bold transition ${
                      checked
                        ? 'border-navy bg-navy text-white shadow-sm'
                        : 'border-slate-200 bg-canvas text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    {t.full_name}
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

      {/* Filtre & Arama Barı */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-3">
        <div className="flex flex-wrap gap-2">
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

        <div className="relative min-w-[240px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Arıza no, teknisyen, departman ara..."
            className="w-full rounded-xl border border-slate-200 bg-canvas py-1.5 pl-9 pr-3 text-sm focus:border-navy focus:outline-none"
          />
        </div>
      </div>

      {/* İş Emirleri Tablosu */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-canvas text-[11px] font-extrabold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">Arıza No</th>
                <th className="px-4 py-3">Departman & Teknisyen</th>
                <th className="px-4 py-3">Ekipman</th>
                <th className="px-4 py-3">Açıklama</th>
                <th className="px-4 py-3">Durum</th>
                <th className="px-4 py-3">Tarih</th>
                <th className="px-4 py-3 text-right">İşlem</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredOrders.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-slate-500">
                    {loading ? 'Yükleniyor...' : 'Bu filtrede iş emri bulunamadı.'}
                  </td>
                </tr>
              ) : (
                filteredOrders.map((o) => {
                  const techNames =
                    (o.work_order_assignments ?? [])
                      .map((a) => a.profiles?.full_name)
                      .filter(Boolean)
                      .join(', ') || 'Atanmadı';
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
                    <tr key={o.id} className="align-top hover:bg-canvas/60">
                      <td className="whitespace-nowrap px-4 py-3 font-extrabold text-navy">
                        {o.tickets?.ticket_number ?? '-'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-bold text-slate-800">
                          {o.departments?.name ?? '-'}
                        </div>
                        <div className="text-xs text-slate-500">{techNames}</div>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">
                        {o.equipments ? `${o.equipments.code} - ${o.equipments.name}` : '-'}
                      </td>
                      <td className="max-w-[260px] px-4 py-3">
                        <div className="text-slate-700">
                          {o.work_description ?? o.tickets?.description ?? '-'}
                        </div>
                        {o.waiting_reason && (
                          <div className="mt-1 rounded bg-orange-50 px-2 py-0.5 text-[11px] font-semibold text-orange-800">
                            Bekleme: {o.waiting_reason}
                          </div>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-extrabold ${woBadgeClass(
                            o.status
                          )}`}
                        >
                          {WORK_ORDER_STATUS_LABELS[o.status] ?? o.status}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-500">
                        {formatDateTime(o.created_at)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
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

      {/* Tamamla & Fotoğraf Ekle Modalı */}
      {completeTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
          <form
            onSubmit={handleCompleteSubmit}
            className="w-full max-w-lg space-y-4 rounded-2xl bg-white p-6 shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h2 className="text-lg font-extrabold text-navy">
                İş Emrini Tamamla · {completeTarget.tickets?.ticket_number ?? ''}
              </h2>
              <button
                type="button"
                onClick={() => setCompleteTarget(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div>
              <label className="mb-1 block text-xs font-bold text-slate-600">
                Tamamlanma Notu
              </label>
              <textarea
                rows={3}
                placeholder="Yapılan işlem detayını yazınız..."
                value={completeNote}
                onChange={(e) => setCompleteNote(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm focus:border-navy focus:outline-none"
              />
            </div>

            <div className="rounded-xl border border-dashed border-slate-300 bg-canvas p-3">
              <label className="flex cursor-pointer items-center gap-2 text-xs font-bold text-navy">
                <Camera className="h-4 w-4 text-turquoise" />
                <span>Çözüm Sonrası Fotoğraf Ekle (Opsiyonel)</span>
                <input
                  type="file"
                  multiple
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => {
                    const list = Array.from(e.target.files ?? []);
                    if (list.length > 0) setCompletePhotos((p) => [...p, ...list]);
                    e.target.value = '';
                  }}
                  className="hidden"
                />
              </label>
              {completePhotos.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {completePhotos.map((f, idx) => (
                    <span
                      key={`${f.name}_${idx}`}
                      className="inline-flex items-center gap-1 rounded-lg bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 shadow-sm"
                    >
                      {f.name}
                      <button
                        type="button"
                        onClick={() =>
                          setCompletePhotos((p) => p.filter((_, i) => i !== idx))
                        }
                        className="text-red-600"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setCompleteTarget(null)}
                className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-700"
              >
                Vazgeç
              </button>
              <button
                type="submit"
                disabled={completing}
                className="rounded-xl bg-emerald-600 px-5 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {completing ? 'Tamamlanıyor...' : 'Tamamla ve Onaya Gönder'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* İş Emri Düzenle Modalı */}
      {editTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
          <form
            onSubmit={handleSaveEdit}
            className="w-full max-w-lg space-y-4 rounded-2xl bg-white p-6 shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h2 className="text-lg font-extrabold text-navy">
                İş Emri Düzenle · {editTarget.tickets?.ticket_number ?? ''}
              </h2>
              <button
                type="button"
                onClick={() => setEditTarget(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-600">Departman</label>
                <select
                  required
                  value={editDeptId}
                  onChange={(e) => setEditDeptId(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm"
                >
                  {depts.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-600">Durum</label>
                <select
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value as WorkOrderStatus)}
                  className="w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm"
                >
                  {Object.entries(WORK_ORDER_STATUS_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-bold text-slate-600">
                İş Açıklaması / Talimat
              </label>
              <textarea
                rows={3}
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm"
              />
            </div>

            {editStatus === 'waiting' && (
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-600">
                  Bekleme Gerekçesi
                </label>
                <input
                  type="text"
                  value={editWaitingReason}
                  onChange={(e) => setEditWaitingReason(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm"
                />
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditTarget(null)}
                className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-700"
              >
                Vazgeç
              </button>
              <button
                type="submit"
                disabled={savingEdit}
                className="rounded-xl bg-navy px-5 py-2 text-xs font-bold text-white hover:bg-navy-hover disabled:opacity-50"
              >
                {savingEdit ? 'Kaydediliyor...' : 'Kaydet'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

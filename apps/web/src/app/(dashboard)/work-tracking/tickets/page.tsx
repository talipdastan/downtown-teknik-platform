'use client';

import { useCallback, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Camera,
  Eye,
  FileDown,
  FileSpreadsheet,
  History,
  MessageSquarePlus,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { createClient } from '@/core/supabase/client';
import { EQUIPMENT_SELECT } from '@/core/supabase/selects';
import { useDebouncedRealtime } from '@/core/hooks/useDebouncedRealtime';
import {
  CreateTicketModal,
  EditTicketModal,
  TicketDetailModal,
} from '@/features/work-tracking/components/TicketModals';
import { formatDateTime, PRIORITY_LABELS, TICKET_STATUS_LABELS } from '@/core/constants';
import { useDashboardAuth } from '@/core/DashboardContext';
import { hasModulePermission } from '@/core/permissions';
import {
  exportExcelXml,
  exportPrintablePdf,
  ReportCell,
} from '@/core/utils/report-export';
import { compressImageForUpload } from '@/core/utils/image-compress';
import {
  Equipment,
  TicketPriority,
  TicketStatus,
} from '@/types/database';
import {
  AttachmentView,
  generateUUID,
  LinkedWO,
  Lookup,
  priorityBadgeClass,
  sanitizeFileName,
  statusBadgeClass,
  TICKET_PAGE_SIZE as PAGE_SIZE,
  TicketRow,
  TimelineEvent,
} from '@/features/work-tracking/ticket-helpers';

export default function WorkTrackingTicketsPage() {
  const { profile } = useDashboardAuth();
  const canCreate = hasModulePermission(profile, 'work_tracking', 'create');
  const canManage = hasModulePermission(profile, 'work_tracking', 'manage');
  const canEdit = canManage && hasModulePermission(profile, 'work_tracking', 'edit');
  const canDelete = hasModulePermission(profile, 'work_tracking', 'delete');
  const canApprove = hasModulePermission(profile, 'work_tracking', 'approve');
  const canReports = hasModulePermission(profile, 'work_tracking', 'reports');

  const queryClient = useQueryClient();
  const [page, setPage] = useState(0);
  // Varsayılan 'active' = Atama Bekleyen + Sahada İşlemde + Çözüm Onayı Bekleyenlerin tamamı.
  // Böylece iş teknisyene atandığında veya onay beklediğinde bildiren kişinin listesinden kaybolmaz!
  const [tabMode, setTabMode] = useState<'active' | 'unassigned' | 'in_field' | 'closed' | 'all'>('active');
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards');
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [search, setSearch] = useState('');
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Ortak lookup verileri
  const [floors, setFloors] = useState<Lookup[]>([]);
  const [locations, setLocations] = useState<Lookup[]>([]);
  const [categories, setCategories] = useState<Lookup[]>([]);
  const [equipments, setEquipments] = useState<Equipment[]>([]);

  // Yeni arıza modalı
  const [showNew, setShowNew] = useState(false);
  const [floorId, setFloorId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [customLocation, setCustomLocation] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [customCategory, setCustomCategory] = useState('');
  const [equipmentId, setEquipmentId] = useState('');
  const [priority, setPriority] = useState<TicketPriority>('normal');
  const [description, setDescription] = useState('');
  const [newPhotos, setNewPhotos] = useState<File[]>([]);
  const [creating, setCreating] = useState(false);

  // Düzenleme modalı
  const [editTarget, setEditTarget] = useState<TicketRow | null>(null);
  const [editPriority, setEditPriority] = useState<TicketPriority>('normal');
  const [editStatus, setEditStatus] = useState<TicketStatus>('new');
  const [editLocationId, setEditLocationId] = useState('');
  const [editCategoryId, setEditCategoryId] = useState('');
  const [editEquipmentId, setEditEquipmentId] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editCancelReason, setEditCancelReason] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  // Detay / Zaman Çizelgesi / Fotoğraf modalı
  const [detailTarget, setDetailTarget] = useState<TicketRow | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailAttachments, setDetailAttachments] = useState<AttachmentView[]>([]);
  const [detailTimeline, setDetailTimeline] = useState<TimelineEvent[]>([]);
  const [detailWOs, setDetailWOs] = useState<LinkedWO[]>([]);
  const [newComment, setNewComment] = useState('');
  const [postingComment, setPostingComment] = useState(false);
  const [uploadingDetailPhoto, setUploadingDetailPhoto] = useState(false);

  const loadLookups = useCallback(async () => {
    try {
      const supabase = createClient();
      const [fRes, lRes, cRes, eRes] = await Promise.all([
        supabase.from('floors').select('id, name').eq('is_active', true).order('sort_order'),
        supabase.from('locations').select('id, name, floor_id').eq('is_active', true).order('name'),
        supabase.from('categories').select('id, name').eq('is_active', true).order('name'),
        supabase.from('equipments').select(EQUIPMENT_SELECT).eq('is_active', true).order('name').limit(300),
      ]);
      if (fRes.data) setFloors(fRes.data);
      if (lRes.data) setLocations(lRes.data);
      if (cRes.data) setCategories(cRes.data);
      if (eRes.data) setEquipments(eRes.data as Equipment[]);
    } catch {
      // ignore
    }
  }, []);

  const { data: rows = [], isLoading: loading } = useQuery({
    queryKey: ['wt', 'tickets', { page, statusFilter, priorityFilter }],
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const supabase = createClient();
      let q = supabase
        .from('tickets')
        .select(
          'id, ticket_number, reporter_id, location_id, category_id, description, priority, status, cancellation_reason, created_at, custom_location, custom_category, equipment_id, locations(id, name, floor_id, floors(name)), categories(id, name), equipments(code, name), profiles!tickets_reporter_id_fkey(full_name)'
        )
        .order('created_at', { ascending: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

      if (statusFilter) q = q.eq('status', statusFilter);
      if (priorityFilter) q = q.eq('priority', priorityFilter);

      const { data, error } = await q;
      if (error) throw error;
      return (data as unknown as TicketRow[]) ?? [];
    },
  });

  const loadTickets = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['wt', 'tickets'] });
  }, [queryClient]);

  useDebouncedRealtime({
    channelName: 'wt-tickets-live',
    tables: ['tickets', 'work_orders'],
    onRefresh: loadTickets,
    delayMs: 500,
  });

  async function openNewModal() {
    setShowNew(true);
    setMsg(null);
    setNewPhotos([]);
    if (floors.length === 0) await loadLookups();
  }

  async function uploadTicketPhoto(
    ticketId: string,
    uid: string,
    rawFile: File,
    attType: 'before' | 'after' | 'general'
  ) {
    const supabase = createClient();
    const file = await compressImageForUpload(rawFile);
    const safe = sanitizeFileName(file.name || 'foto.webp');
    const path = `${uid}/${ticketId}/${Date.now()}_${safe}`;

    const { error: upErr } = await supabase.storage
      .from('work-attachments')
      .upload(path, file, { contentType: file.type || 'image/webp', upsert: false });
    if (upErr) throw upErr;

    const { error: dbErr } = await supabase.from('attachments').insert({
      ticket_id: ticketId,
      uploaded_by: uid,
      file_path: path,
      file_name: file.name,
      mime_type: file.type || 'image/webp',
      attachment_type: attType,
    });
    if (dbErr) throw dbErr;
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const isOtherLoc = locationId === '__other__';
    const isOtherCat = categoryId === '__other__';
    if (
      !locationId ||
      (isOtherLoc && !customLocation.trim()) ||
      !categoryId ||
      (isOtherCat && !customCategory.trim()) ||
      !description.trim()
    ) {
      setMsg({ type: 'err', text: 'Lütfen tüm zorunlu alanları doldurun.' });
      return;
    }

    setCreating(true);
    setMsg(null);
    try {
      const supabase = createClient();
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes.user?.id;
      if (!uid) throw new Error('Oturum bulunamadı.');

      const ticketId = generateUUID();
      const floorName = floors.find((f) => f.id === floorId)?.name;
      const finalCustomLoc = isOtherLoc
        ? floorName
          ? `${floorName} - ${customLocation.trim()}`
          : customLocation.trim()
        : null;

      const { error } = await supabase.from('tickets').insert({
        id: ticketId,
        reporter_id: uid,
        location_id: isOtherLoc ? null : locationId,
        custom_location: finalCustomLoc,
        category_id: isOtherCat ? null : categoryId,
        custom_category: isOtherCat ? customCategory.trim() : null,
        equipment_id: equipmentId || null,
        priority,
        description: description.trim(),
      });
      if (error) throw error;

      let uploadedCount = 0;
      for (const file of newPhotos) {
        await uploadTicketPhoto(ticketId, uid, file, 'before');
        uploadedCount++;
      }

      setShowNew(false);
      setDescription('');
      setEquipmentId('');
      setCustomLocation('');
      setCustomCategory('');
      setNewPhotos([]);
      setMsg({
        type: 'ok',
        text:
          uploadedCount > 0
            ? `Arıza kaydı ve ${uploadedCount} adet fotoğraf oluşturuldu.`
            : 'Arıza kaydı oluşturuldu.',
      });
      await loadTickets();
    } catch (err) {
      setMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Kayıt oluşturulamadı.',
      });
    } finally {
      setCreating(false);
    }
  }

  async function openEditModal(t: TicketRow) {
    if (locations.length === 0 || categories.length === 0) {
      await loadLookups();
    }
    setEditTarget(t);
    setEditPriority(t.priority);
    setEditStatus(t.status);
    setEditLocationId(t.location_id ?? '');
    setEditCategoryId(t.category_id ?? '');
    setEditEquipmentId(t.equipment_id ?? '');
    setEditDescription(t.description);
    setEditCancelReason(t.cancellation_reason ?? '');
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editTarget || !editDescription.trim()) return;
    setSavingEdit(true);
    setMsg(null);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from('tickets')
        .update({
          priority: editPriority,
          status: editStatus,
          location_id: editLocationId || null,
          category_id: editCategoryId || null,
          equipment_id: editEquipmentId || null,
          description: editDescription.trim(),
          cancellation_reason: editCancelReason.trim() || null,
        })
        .eq('id', editTarget.id);
      if (error) throw error;

      setEditTarget(null);
      setMsg({ type: 'ok', text: 'Arıza kaydı güncellendi.' });
      await loadTickets();
    } catch (err) {
      setMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Arıza kaydı güncellenemedi.',
      });
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleDeleteTicket(t: TicketRow) {
    const label = t.ticket_number || t.id.slice(0, 8);
    if (!window.confirm(`${label} numaralı arıza kaydını silmek istediğinize emin misiniz?`)) {
      return;
    }
    setMsg(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.from('tickets').delete().eq('id', t.id);
      if (error) throw error;
      setMsg({ type: 'ok', text: `${label} arıza kaydı silindi.` });
      await loadTickets();
    } catch (err) {
      setMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Arıza kaydı silinemedi.',
      });
    }
  }

  async function loadDetail(t: TicketRow) {
    setDetailTarget(t);
    setDetailLoading(true);
    setDetailAttachments([]);
    setDetailTimeline([]);
    setDetailWOs([]);
    setNewComment('');
    try {
      const supabase = createClient();
      const [woRes, histRes, commRes, ticketAttRes] = await Promise.all([
        supabase
          .from('work_orders')
          .select('id, status, work_description, created_at, departments(name)')
          .eq('ticket_id', t.id)
          .order('created_at', { ascending: true }),
        supabase
          .from('status_history')
          .select('id, old_status, new_status, change_note, created_at, profiles(full_name)')
          .eq('ticket_id', t.id)
          .order('created_at', { ascending: true }),
        supabase
          .from('comments')
          .select('id, comment, created_at, profiles(full_name)')
          .eq('ticket_id', t.id)
          .order('created_at', { ascending: true }),
        supabase
          .from('attachments')
          .select('id, file_path, file_name, attachment_type, created_at')
          .eq('ticket_id', t.id)
          .order('created_at', { ascending: true }),
      ]);

      const wos = (woRes.data as unknown as LinkedWO[]) ?? [];
      setDetailWOs(wos);

      let woAtts: AttachmentView[] = [];
      if (wos.length > 0) {
        const { data: wAttData } = await supabase
          .from('attachments')
          .select('id, file_path, file_name, attachment_type, created_at')
          .in(
            'work_order_id',
            wos.map((w) => w.id)
          )
          .order('created_at', { ascending: true });
        woAtts = (wAttData as AttachmentView[]) ?? [];
      }

      const combinedAtts = [
        ...((ticketAttRes.data as AttachmentView[]) ?? []),
        ...woAtts,
      ];

      if (combinedAtts.length > 0) {
        const paths = combinedAtts.map((a) => a.file_path);
        const { data: signedData } = await supabase.storage
          .from('work-attachments')
          .createSignedUrls(paths, 3600);
        const urlMap = new Map<string, string>();
        for (const s of signedData ?? []) {
          if (s.path && s.signedUrl) urlMap.set(s.path, s.signedUrl);
        }
        setDetailAttachments(
          combinedAtts.map((a) => ({ ...a, signedUrl: urlMap.get(a.file_path) }))
        );
      }

      const histEvents: TimelineEvent[] = (
        (histRes.data as unknown as Array<{
          id: string;
          old_status: TicketStatus | null;
          new_status: TicketStatus;
          change_note: string | null;
          created_at: string;
          profiles?: { full_name: string } | null;
        }>) ?? []
      ).map((h) => ({
        id: `h_${h.id}`,
        kind: 'status',
        created_at: h.created_at,
        actor: h.profiles?.full_name || 'Sistem',
        title: h.old_status
          ? `Durum: ${TICKET_STATUS_LABELS[h.old_status] ?? h.old_status} → ${
              TICKET_STATUS_LABELS[h.new_status] ?? h.new_status
            }`
          : `Durum: ${TICKET_STATUS_LABELS[h.new_status] ?? h.new_status}`,
        detail: h.change_note,
      }));

      const commentEvents: TimelineEvent[] = (
        (commRes.data as unknown as Array<{
          id: string;
          comment: string;
          created_at: string;
          profiles?: { full_name: string } | null;
        }>) ?? []
      ).map((c) => ({
        id: `c_${c.id}`,
        kind: 'comment',
        created_at: c.created_at,
        actor: c.profiles?.full_name || 'Kullanıcı',
        title: 'Yorum / Not',
        detail: c.comment,
      }));

      const initialEvent: TimelineEvent = {
        id: `open_${t.id}`,
        kind: 'status',
        created_at: t.created_at,
        actor: t.profiles?.full_name || 'Bildiren',
        title: 'Arıza Kaydı Oluşturuldu',
        detail: t.description,
      };

      const merged = [initialEvent, ...histEvents, ...commentEvents].sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );
      setDetailTimeline(merged);
    } catch (err) {
      setMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Detaylar yüklenemedi.',
      });
    } finally {
      setDetailLoading(false);
    }
  }

  async function handlePostComment(e: React.FormEvent) {
    e.preventDefault();
    if (!detailTarget || !newComment.trim()) return;
    setPostingComment(true);
    try {
      const supabase = createClient();
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes.user?.id;
      if (!uid) throw new Error('Oturum bulunamadı.');
      const { error } = await supabase.from('comments').insert({
        ticket_id: detailTarget.id,
        user_id: uid,
        comment: newComment.trim(),
      });
      if (error) throw error;
      setNewComment('');
      await loadDetail(detailTarget);
    } catch (err) {
      setMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Yorum eklenemedi.',
      });
    } finally {
      setPostingComment(false);
    }
  }

  async function handleAddDetailPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !detailTarget) return;
    setUploadingDetailPhoto(true);
    try {
      const supabase = createClient();
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes.user?.id;
      if (!uid) throw new Error('Oturum bulunamadı.');
      await uploadTicketPhoto(detailTarget.id, uid, file, 'general');
      await loadDetail(detailTarget);
    } catch (err) {
      setMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Fotoğraf yüklenemedi.',
      });
    } finally {
      setUploadingDetailPhoto(false);
      e.target.value = '';
    }
  }

  async function handleConfirm(ticketId: string, reopen: boolean) {
    const note = reopen
      ? window.prompt('İade gerekçesini yazınız:') ?? ''
      : 'Web panelinden onaylanarak kapatıldı.';
    if (reopen && !note.trim()) return;
    try {
      const supabase = createClient();
      const { error } = await supabase.rpc('rpc_manager_close_ticket', {
        p_ticket_id: ticketId,
        p_resolution_note: note.trim(),
        p_reopen: reopen,
      });
      if (error) throw error;
      setMsg({
        type: 'ok',
        text: reopen ? 'Kayıt teknisyene iade edildi.' : 'Arıza onaylanarak kapatıldı.',
      });
      await loadTickets();
    } catch (err) {
      setMsg({ type: 'err', text: err instanceof Error ? err.message : 'İşlem başarısız.' });
    }
  }

  const filtered = rows.filter((r) => {
    const isUnassigned = r.status === 'new' || r.status === 'under_review';
    const isInField =
      r.status === 'assigned' ||
      r.status === 'in_progress' ||
      r.status === 'waiting' ||
      r.status === 'resolved';
    const isClosed = r.status === 'closed' || r.status === 'cancelled';
    if (!statusFilter) {
      if (tabMode === 'active' && isClosed) return false;
      if (tabMode === 'unassigned' && !isUnassigned) return false;
      if (tabMode === 'in_field' && !isInField) return false;
      if (tabMode === 'closed' && !isClosed) return false;
    }
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      (r.ticket_number ?? '').toLowerCase().includes(q) ||
      r.description.toLowerCase().includes(q) ||
      (r.equipments?.name ?? '').toLowerCase().includes(q) ||
      (r.equipments?.code ?? '').toLowerCase().includes(q) ||
      (r.locations?.name ?? r.custom_location ?? '').toLowerCase().includes(q)
    );
  });

  function buildReportRows() {
    const headers = [
      'Kayıt No',
      'Mahal',
      'Kategori',
      'Ekipman',
      'Öncelik',
      'Durum',
      'Bildiren',
      'Tarih',
      'Açıklama',
    ];
    const reportRows: ReportCell[][] = filtered.map((t) => {
      const loc = t.locations?.name
        ? `${t.locations.floors?.name ? `${t.locations.floors.name} - ` : ''}${t.locations.name}`
        : t.custom_location ?? '-';
      return [
        t.ticket_number ?? '-',
        loc,
        t.categories?.name ?? t.custom_category ?? '-',
        t.equipments ? `${t.equipments.code} - ${t.equipments.name}` : '-',
        PRIORITY_LABELS[t.priority] ?? t.priority,
        TICKET_STATUS_LABELS[t.status] ?? t.status,
        t.profiles?.full_name ?? '-',
        formatDateTime(t.created_at),
        t.description,
      ];
    });
    return { headers, reportRows };
  }

  function handleExportExcel() {
    const { headers, reportRows } = buildReportRows();
    exportExcelXml({
      fileName: `avm_tech_ariza_kayitlari_${new Date().toISOString().slice(0, 10)}.xls`,
      sheetName: 'Ariza_Kayitlari',
      title: 'DOWNTOWN TEKNİK · Arıza Kayıtları Listesi',
      subtitle: `${filtered.length} kayıt listeleniyor`,
      headers,
      rows: reportRows,
    });
  }

  function handleExportPdf() {
    const { headers, reportRows } = buildReportRows();
    exportPrintablePdf({
      title: 'Arıza Kayıtları Raporu',
      subtitle: `${filtered.length} kayıt · Sayfa ${page + 1}`,
      kpis: [
        { label: 'Listelenen Kayıt', value: String(filtered.length), tone: 'navy' },
        {
          label: 'Açık / İşlemde',
          value: String(
            filtered.filter((r) => !['closed', 'cancelled'].includes(r.status)).length
          ),
          tone: 'slate',
        },
        {
          label: 'Acil Kayıtlar',
          value: String(filtered.filter((r) => r.priority === 'urgent').length),
          tone: 'red',
        },
        {
          label: 'Onay / Çözüm',
          value: String(
            filtered.filter((r) => r.status === 'resolved' || r.status === 'closed').length
          ),
          tone: 'green',
        },
      ],
      headers,
      rows: reportRows,
    });
  }

  const floorLocations = locations.filter((l) => !floorId || l.floor_id === floorId);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400">
            İŞ TAKİP MODÜLÜ
          </div>
          <h1 className="mt-0.5 text-2xl font-extrabold text-slate-900">Arıza Kayıtları</h1>
          <p className="mt-1 text-sm text-slate-500">
            Arıza bildirimleri, önce/sonra fotoğraf galerisi, zaman çizelgesi ve düzenleme.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canCreate && (
            <button
              type="button"
              onClick={openNewModal}
              className="inline-flex items-center gap-1.5 rounded-xl bg-navy px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-navy-hover"
            >
              <Plus className="h-3.5 w-3.5" />
              Yeni Arıza Kaydı
            </button>
          )}
          {canReports && (
            <>
              <button
                type="button"
                onClick={handleExportExcel}
                disabled={filtered.length === 0}
                className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2 text-xs font-bold text-emerald-800 transition hover:bg-emerald-100 disabled:opacity-40"
              >
                <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-700" />
                Excel İndir (.xls)
              </button>
              <button
                type="button"
                onClick={handleExportPdf}
                disabled={filtered.length === 0}
                className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2 text-xs font-bold text-rose-800 transition hover:bg-rose-100 disabled:opacity-40"
              >
                <FileDown className="h-3.5 w-3.5 text-rose-700" />
                PDF Rapor İndir
              </button>
            </>
          )}
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

      <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-3.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Aktif (Tümü) / Atama Bekleyen / Sahada & Onayda / Kapanan Sekme Geçişi */}
          <div className="inline-flex flex-wrap rounded-xl border border-slate-200 bg-canvas p-1">
            <button
              type="button"
              onClick={() => {
                setTabMode('active');
                setStatusFilter('');
              }}
              className={`rounded-lg px-3.5 py-1.5 text-xs font-extrabold transition ${
                tabMode === 'active'
                  ? 'bg-navy text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Aktif ({rows.filter((r) => r.status !== 'closed' && r.status !== 'cancelled').length})
            </button>
            <button
              type="button"
              onClick={() => {
                setTabMode('unassigned');
                setStatusFilter('');
              }}
              className={`rounded-lg px-3.5 py-1.5 text-xs font-extrabold transition ${
                tabMode === 'unassigned'
                  ? 'bg-navy text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Atama Bekleyen ({rows.filter((r) => r.status === 'new' || r.status === 'under_review').length})
            </button>
            <button
              type="button"
              onClick={() => {
                setTabMode('in_field');
                setStatusFilter('');
              }}
              className={`rounded-lg px-3.5 py-1.5 text-xs font-extrabold transition ${
                tabMode === 'in_field'
                  ? 'bg-navy text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Sahada & Onayda ({rows.filter((r) => ['assigned', 'in_progress', 'waiting', 'resolved'].includes(r.status)).length})
            </button>
            <button
              type="button"
              onClick={() => {
                setTabMode('closed');
                setStatusFilter('');
              }}
              className={`rounded-lg px-3.5 py-1.5 text-xs font-extrabold transition ${
                tabMode === 'closed'
                  ? 'bg-navy text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Kapanan ({rows.filter((r) => r.status === 'closed' || r.status === 'cancelled').length})
            </button>
          </div>

          {/* Kart Görünümü / Tablo Görünümü Seçici */}
          <div className="inline-flex rounded-xl border border-slate-200 bg-canvas p-1">
            <button
              type="button"
              onClick={() => setViewMode('cards')}
              className={`rounded-lg px-3 py-1.5 text-xs font-extrabold transition ${
                viewMode === 'cards'
                  ? 'bg-turquoise text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Kart Görünümü
            </button>
            <button
              type="button"
              onClick={() => setViewMode('table')}
              className={`rounded-lg px-3 py-1.5 text-xs font-extrabold transition ${
                viewMode === 'table'
                  ? 'bg-turquoise text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Tablo Görünümü
            </button>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Kayıt no, açıklama, konum veya ekipman ara..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-canvas py-2 pl-9 pr-3 text-sm focus:border-navy focus:outline-none"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => {
              setPage(0);
              const val = e.target.value;
              setStatusFilter(val);
              if (val === 'closed' || val === 'cancelled') setTabMode('closed');
              else if (val === 'new' || val === 'under_review') setTabMode('unassigned');
              else if (val) setTabMode('in_field');
            }}
            className="rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm font-medium text-slate-800 focus:border-navy focus:outline-none"
          >
            <option value="">Tüm Durumlar</option>
            {Object.entries(TICKET_STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <select
            value={priorityFilter}
            onChange={(e) => {
              setPage(0);
              setPriorityFilter(e.target.value);
            }}
            className="rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm font-medium text-slate-800 focus:border-navy focus:outline-none"
          >
            <option value="">Tüm Öncelikler</option>
            {Object.entries(PRIORITY_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
      </div>

      {viewMode === 'cards' ? (
        <div className="space-y-4">
          {filtered.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
              {loading ? 'Yükleniyor...' : 'Seçili filtreye uyan hizmet talebi / arıza bulunamadı.'}
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {filtered.map((t) => {
                const loc = t.locations?.name
                  ? `${t.locations.floors?.name ? `${t.locations.floors.name} - ` : ''}${t.locations.name}`
                  : t.custom_location ?? '-';
                const cat = t.categories?.name ?? t.custom_category ?? 'Teknik Arıza';
                const eq = t.equipments ? `(${t.equipments.code}) ${t.equipments.name}` : null;

                return (
                  <div
                    key={t.id}
                    className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-slate-300"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="text-sm font-extrabold text-slate-900">
                            Teknik / {cat}
                          </div>
                          {eq && (
                            <div className="mt-0.5 text-xs font-extrabold text-navy">
                              {eq}
                            </div>
                          )}
                        </div>
                        <span
                          className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-extrabold ${priorityBadgeClass(
                            t.priority
                          )}`}
                        >
                          {PRIORITY_LABELS[t.priority] ?? t.priority}
                        </span>
                      </div>

                      <div className="mt-1.5 flex items-center justify-between text-xs font-bold text-slate-700">
                        <span>{formatDateTime(t.created_at)}</span>
                        <span className="text-slate-400">
                          #{t.ticket_number ?? t.id.slice(0, 8)}
                        </span>
                      </div>

                      <div className="my-3 border-t border-slate-100" />

                      <div className="space-y-1.5 text-xs">
                        <div className="flex">
                          <span className="w-28 shrink-0 text-slate-400">Lokasyon</span>
                          <span className="font-semibold text-slate-800">: {loc}</span>
                        </div>
                        <div className="flex items-center">
                          <span className="w-28 shrink-0 text-slate-400">Durum</span>
                          <span className="mr-1 text-slate-400">:</span>
                          <span
                            className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-extrabold ${statusBadgeClass(
                              t.status
                            )}`}
                          >
                            {TICKET_STATUS_LABELS[t.status] ?? t.status}
                          </span>
                        </div>
                        <div className="flex">
                          <span className="w-28 shrink-0 text-slate-400">Bildiren Kişi</span>
                          <span className="font-semibold text-slate-700">
                            : {t.profiles?.full_name ?? '-'}
                          </span>
                        </div>
                        <div className="flex">
                          <span className="w-28 shrink-0 text-slate-400">Açıklama</span>
                          <span className="line-clamp-2 font-medium text-slate-600">
                            : {t.description || '-'}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center justify-end gap-1.5 border-t border-slate-100 pt-3">
                      <button
                        type="button"
                        onClick={() => loadDetail(t)}
                        className="inline-flex items-center gap-1 rounded-lg border border-turquoise/30 bg-turquoise-soft/60 px-2.5 py-1 text-xs font-bold text-turquoise hover:bg-turquoise-soft"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        İncele & Fotoğraflar
                      </button>

                      {t.status === 'resolved' &&
                        canApprove &&
                        (canManage || t.reporter_id === profile?.id) && (
                          <>
                            <button
                              type="button"
                              onClick={() => handleConfirm(t.id, false)}
                              className="rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-bold text-white hover:bg-emerald-700"
                            >
                              Onayla
                            </button>
                            <button
                              type="button"
                              onClick={() => handleConfirm(t.id, true)}
                              className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-bold text-red-700 hover:bg-red-100"
                            >
                              İade
                            </button>
                          </>
                        )}

                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => openEditModal(t)}
                          title="Düzenle"
                          className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:border-navy hover:bg-navy-soft hover:text-navy"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      )}

                      {canDelete && (
                        <button
                          type="button"
                          onClick={() => handleDeleteTicket(t)}
                          title="Sil"
                          className="rounded-lg border border-slate-200 p-1.5 text-red-600 hover:border-red-300 hover:bg-red-50"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-600">
            <span>Sayfa {page + 1}</span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                className="rounded-lg border border-slate-300 px-3 py-1 disabled:opacity-40"
              >
                Önceki
              </button>
              <button
                type="button"
                disabled={rows.length < PAGE_SIZE}
                onClick={() => setPage((p) => p + 1)}
                className="rounded-lg border border-slate-300 px-3 py-1 disabled:opacity-40"
              >
                Sonraki
              </button>
            </div>
          </div>
        </div>
      ) : (
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-canvas text-[11px] font-extrabold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">Kayıt No</th>
                <th className="px-4 py-3">Mahal & Açıklama</th>
                <th className="px-4 py-3">Kategori</th>
                <th className="px-4 py-3">Ekipman</th>
                <th className="px-4 py-3">Öncelik</th>
                <th className="px-4 py-3">Durum</th>
                <th className="px-4 py-3">Bildiren</th>
                <th className="px-4 py-3">Tarih</th>
                <th className="px-4 py-3 text-right">İşlem</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-slate-500">
                    {loading ? 'Yükleniyor...' : 'Kayıt bulunamadı.'}
                  </td>
                </tr>
              ) : (
                filtered.map((t) => {
                  const loc = t.locations?.name
                    ? `${t.locations.floors?.name ? `${t.locations.floors.name} - ` : ''}${t.locations.name}`
                    : t.custom_location ?? '-';
                  return (
                    <tr key={t.id} className="align-top hover:bg-canvas/60">
                      <td className="whitespace-nowrap px-4 py-3 font-extrabold text-navy">
                        {t.ticket_number ?? '-'}
                      </td>
                      <td className="max-w-[260px] px-4 py-3">
                        <div className="font-semibold text-slate-800">{loc}</div>
                        <div className="mt-0.5 line-clamp-2 text-xs text-slate-500">
                          {t.description}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {t.categories?.name ?? t.custom_category ?? '-'}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">
                        {t.equipments ? `${t.equipments.code} - ${t.equipments.name}` : '-'}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-extrabold ${priorityBadgeClass(
                            t.priority
                          )}`}
                        >
                          {PRIORITY_LABELS[t.priority] ?? t.priority}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-extrabold ${statusBadgeClass(
                            t.status
                          )}`}
                        >
                          {TICKET_STATUS_LABELS[t.status] ?? t.status}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-700">
                        {t.profiles?.full_name ?? '-'}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-500">
                        {formatDateTime(t.created_at)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => loadDetail(t)}
                            title="İncele / Fotoğraflar & Geçmiş"
                            className="inline-flex items-center gap-1 rounded-lg border border-turquoise/30 bg-turquoise-soft/60 px-2 py-1 text-xs font-bold text-turquoise hover:bg-turquoise-soft"
                          >
                            <Eye className="h-3.5 w-3.5" />
                            İncele
                          </button>

                          {t.status === 'resolved' &&
                            canApprove &&
                            (canManage || t.reporter_id === profile?.id) && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleConfirm(t.id, false)}
                                  className="rounded-lg bg-emerald-600 px-2 py-1 text-xs font-bold text-white hover:bg-emerald-700"
                                >
                                  Onayla
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleConfirm(t.id, true)}
                                  className="rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-xs font-bold text-red-700 hover:bg-red-100"
                                >
                                  İade
                                </button>
                              </>
                            )}

                          {canEdit && (
                            <button
                              type="button"
                              onClick={() => openEditModal(t)}
                              title="Düzenle"
                              className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:border-navy hover:bg-navy-soft hover:text-navy"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                          )}

                          {canDelete && (
                            <button
                              type="button"
                              onClick={() => handleDeleteTicket(t)}
                              title="Sil"
                              className="rounded-lg border border-slate-200 p-1.5 text-red-600 hover:border-red-300 hover:bg-red-50"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-xs text-slate-600">
          <span>
            Sayfa {page + 1} · {filtered.length} kayıt gösteriliyor
          </span>
          <div className="flex gap-2">
            <button
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="rounded-xl border border-slate-200 px-3 py-1 font-bold hover:bg-slate-50 disabled:opacity-40"
            >
              Önceki
            </button>
            <button
              disabled={rows.length < PAGE_SIZE}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-xl border border-slate-200 px-3 py-1 font-bold hover:bg-slate-50 disabled:opacity-40"
            >
              Sonraki
            </button>
          </div>
        </div>
      </div>
      )}

      <CreateTicketModal
        open={showNew}
        floors={floors}
        floorLocations={floorLocations}
        categories={categories}
        equipments={equipments}
        floorId={floorId}
        setFloorId={setFloorId}
        locationId={locationId}
        setLocationId={setLocationId}
        customLocation={customLocation}
        setCustomLocation={setCustomLocation}
        categoryId={categoryId}
        setCategoryId={setCategoryId}
        customCategory={customCategory}
        setCustomCategory={setCustomCategory}
        equipmentId={equipmentId}
        setEquipmentId={setEquipmentId}
        priority={priority}
        setPriority={setPriority}
        description={description}
        setDescription={setDescription}
        newPhotos={newPhotos}
        setNewPhotos={setNewPhotos}
        creating={creating}
        onClose={() => setShowNew(false)}
        onSubmit={handleCreate}
      />

      <EditTicketModal
        target={editTarget}
        locations={locations}
        categories={categories}
        equipments={equipments}
        editPriority={editPriority}
        setEditPriority={setEditPriority}
        editStatus={editStatus}
        setEditStatus={setEditStatus}
        editLocationId={editLocationId}
        setEditLocationId={setEditLocationId}
        editCategoryId={editCategoryId}
        setEditCategoryId={setEditCategoryId}
        editEquipmentId={editEquipmentId}
        setEditEquipmentId={setEditEquipmentId}
        editDescription={editDescription}
        setEditDescription={setEditDescription}
        editCancelReason={editCancelReason}
        setEditCancelReason={setEditCancelReason}
        savingEdit={savingEdit}
        onClose={() => setEditTarget(null)}
        onSubmit={handleSaveEdit}
      />

      <TicketDetailModal
        target={detailTarget}
        loading={detailLoading}
        attachments={detailAttachments}
        timeline={detailTimeline}
        workOrders={detailWOs}
        canCreate={canCreate}
        uploadingDetailPhoto={uploadingDetailPhoto}
        onAddDetailPhoto={handleAddDetailPhoto}
        newComment={newComment}
        setNewComment={setNewComment}
        postingComment={postingComment}
        onPostComment={handlePostComment}
        onClose={() => setDetailTarget(null)}
      />
    </div>
  );
}

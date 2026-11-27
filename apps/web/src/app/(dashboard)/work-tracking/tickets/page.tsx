'use client';

import { useCallback, useEffect, useState } from 'react';
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
import { useDebouncedRealtime } from '@/core/hooks/useDebouncedRealtime';
import { DuplicateTicketBanner } from '@/components/DuplicateTicketBanner';
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
  WorkOrderStatus,
} from '@/types/database';

type TicketRow = {
  id: string;
  ticket_number: string | null;
  reporter_id: string;
  location_id: string | null;
  category_id: string | null;
  description: string;
  priority: TicketPriority;
  status: TicketStatus;
  cancellation_reason: string | null;
  created_at: string;
  custom_location: string | null;
  custom_category: string | null;
  equipment_id: string | null;
  locations?: { id?: string; name: string; floor_id?: string; floors?: { name: string } | null } | null;
  categories?: { id?: string; name: string } | null;
  equipments?: { code: string; name: string } | null;
  profiles?: { full_name: string } | null;
};

type Lookup = { id: string; name: string; floor_id?: string };

type AttachmentView = {
  id: string;
  file_path: string;
  file_name: string | null;
  attachment_type: 'before' | 'after' | 'general';
  created_at: string;
  signedUrl?: string;
};

type TimelineEvent = {
  id: string;
  kind: 'status' | 'comment';
  created_at: string;
  actor: string;
  title: string;
  detail?: string | null;
};

type LinkedWO = {
  id: string;
  status: WorkOrderStatus;
  work_description: string | null;
  created_at: string;
  departments?: { name: string } | null;
};

const PAGE_SIZE = 25;

function statusBadgeClass(status: TicketStatus): string {
  switch (status) {
    case 'new':
    case 'under_review':
      return 'bg-sky-100 text-sky-800';
    case 'assigned':
    case 'in_progress':
      return 'bg-amber-100 text-amber-800';
    case 'waiting':
      return 'bg-orange-100 text-orange-800';
    case 'resolved':
      return 'bg-emerald-100 text-emerald-700';
    case 'closed':
      return 'bg-slate-200 text-slate-700';
    case 'cancelled':
      return 'bg-rose-100 text-rose-700';
  }
}

function priorityBadgeClass(p: TicketPriority): string {
  if (p === 'urgent') return 'bg-red-100 text-red-700';
  if (p === 'priority') return 'bg-amber-100 text-amber-800';
  return 'bg-slate-100 text-slate-700';
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

/**
 * HTTP (örn. http://10.16.19.19) üzerinde tarayıcılar Secure Context olmadığı için
 * `crypto.randomUUID()` fonksiyonunu devre dışı bırakır. Hem HTTPS hem HTTP'de
 * çalışan RFC4122 v4 uyumlu güvenli UUID üretici:
 */
function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export default function WorkTrackingTicketsPage() {
  const { profile } = useDashboardAuth();
  const canCreate = hasModulePermission(profile, 'work_tracking', 'create');
  const canManage = hasModulePermission(profile, 'work_tracking', 'manage');
  const canEdit = canManage && hasModulePermission(profile, 'work_tracking', 'edit');
  const canDelete = hasModulePermission(profile, 'work_tracking', 'delete');
  const canApprove = hasModulePermission(profile, 'work_tracking', 'approve');
  const canReports = hasModulePermission(profile, 'work_tracking', 'reports');

  const [rows, setRows] = useState<TicketRow[]>([]);
  const [loading, setLoading] = useState(true);
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
        supabase.from('equipments').select('*').eq('is_active', true).order('name').limit(300),
      ]);
      if (fRes.data) setFloors(fRes.data);
      if (lRes.data) setLocations(lRes.data);
      if (cRes.data) setCategories(cRes.data);
      if (eRes.data) setEquipments(eRes.data as Equipment[]);
    } catch {
      // ignore
    }
  }, []);

  const loadTickets = useCallback(async () => {
    setLoading(true);
    try {
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
      setRows((data as unknown as TicketRow[]) ?? []);
    } catch (err) {
      setMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Arıza kayıtları yüklenemedi.',
      });
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, priorityFilter]);

  useEffect(() => {
    loadTickets();
  }, [loadTickets]);

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

      {/* Yeni Arıza Modalı (Fotoğraf Yükleme Dahil) */}
      {showNew && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
          <form
            onSubmit={handleCreate}
            className="max-h-[90vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h2 className="text-lg font-extrabold text-navy">Yeni Arıza Kaydı</h2>
              <button
                type="button"
                onClick={() => setShowNew(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <select
                value={floorId}
                onChange={(e) => {
                  setFloorId(e.target.value);
                  setLocationId('');
                }}
                className="rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm"
              >
                <option value="">Kat Seçiniz</option>
                {floors.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
              <select
                required
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
                className="rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm"
              >
                <option value="">Mahal Seçiniz *</option>
                {floorLocations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
                <option value="__other__">Diğer (Elle Giriş)</option>
              </select>
            </div>

            {locationId === '__other__' && (
              <input
                type="text"
                required
                placeholder="Diğer mahal adı *"
                value={customLocation}
                onChange={(e) => setCustomLocation(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm"
              />
            )}

            <DuplicateTicketBanner
              locationId={locationId && locationId !== '__other__' ? locationId : null}
              equipmentId={equipmentId || null}
            />

            <div className="grid gap-3 sm:grid-cols-2">
              <select
                required
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm"
              >
                <option value="">Arıza Kategorisi *</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
                <option value="__other__">Diğer (Elle Giriş)</option>
              </select>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as TicketPriority)}
                className="rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm"
              >
                <option value="normal">Normal</option>
                <option value="priority">Öncelikli</option>
                <option value="urgent">Acil</option>
              </select>
            </div>

            {categoryId === '__other__' && (
              <input
                type="text"
                required
                placeholder="Diğer arıza kategorisi *"
                value={customCategory}
                onChange={(e) => setCustomCategory(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm"
              />
            )}

            <select
              value={equipmentId}
              onChange={(e) => setEquipmentId(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm"
            >
              <option value="">İlgili Ekipman (Opsiyonel)</option>
              {equipments.map((eq) => (
                <option key={eq.id} value={eq.id}>
                  {eq.code} - {eq.name}
                </option>
              ))}
            </select>

            <textarea
              required
              rows={3}
              placeholder="Arıza açıklaması..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm"
            />

            <div className="rounded-xl border border-dashed border-slate-300 bg-canvas p-3">
              <label className="flex cursor-pointer items-center gap-2 text-xs font-bold text-navy">
                <Camera className="h-4 w-4 text-turquoise" />
                <span>Arıza Öncesi Fotoğraf Ekle (Opsiyonel)</span>
                <input
                  type="file"
                  multiple
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => {
                    const list = Array.from(e.target.files ?? []);
                    if (list.length > 0) {
                      setNewPhotos((prev) => [...prev, ...list]);
                    }
                    e.target.value = '';
                  }}
                  className="hidden"
                />
              </label>
              {newPhotos.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {newPhotos.map((f, idx) => (
                    <span
                      key={`${f.name}_${idx}`}
                      className="inline-flex items-center gap-1 rounded-lg bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 shadow-sm"
                    >
                      {f.name}
                      <button
                        type="button"
                        onClick={() =>
                          setNewPhotos((prev) => prev.filter((_, i) => i !== idx))
                        }
                        className="text-red-600 hover:text-red-800"
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
                onClick={() => setShowNew(false)}
                className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-700"
              >
                Vazgeç
              </button>
              <button
                type="submit"
                disabled={creating}
                className="rounded-xl bg-navy px-5 py-2 text-xs font-bold text-white hover:bg-navy-hover disabled:opacity-50"
              >
                {creating ? 'Kaydediliyor...' : 'Oluştur'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Arıza Düzenleme Modalı */}
      {editTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
          <form
            onSubmit={handleSaveEdit}
            className="max-h-[90vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h2 className="text-lg font-extrabold text-navy">
                Arıza Düzenle · {editTarget.ticket_number ?? ''}
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
                <label className="mb-1 block text-xs font-bold text-slate-600">Öncelik</label>
                <select
                  value={editPriority}
                  onChange={(e) => setEditPriority(e.target.value as TicketPriority)}
                  className="w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm"
                >
                  {Object.entries(PRIORITY_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-600">Durum</label>
                <select
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value as TicketStatus)}
                  className="w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm"
                >
                  {Object.entries(TICKET_STATUS_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-600">Mahal</label>
                <select
                  value={editLocationId}
                  onChange={(e) => setEditLocationId(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm"
                >
                  <option value="">Seçilmedi / Özel</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-600">Kategori</label>
                <select
                  value={editCategoryId}
                  onChange={(e) => setEditCategoryId(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm"
                >
                  <option value="">Seçilmedi / Özel</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-bold text-slate-600">Ekipman</label>
              <select
                value={editEquipmentId}
                onChange={(e) => setEditEquipmentId(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm"
              >
                <option value="">Seçilmedi</option>
                {equipments.map((eq) => (
                  <option key={eq.id} value={eq.id}>
                    {eq.code} - {eq.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-bold text-slate-600">Açıklama *</label>
              <textarea
                required
                rows={3}
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm"
              />
            </div>

            {editStatus === 'cancelled' && (
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-600">
                  İptal Gerekçesi
                </label>
                <input
                  type="text"
                  value={editCancelReason}
                  onChange={(e) => setEditCancelReason(e.target.value)}
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

      {/* Detay, Önce/Sonra Fotoğraflar & Zaman Çizelgesi Modalı */}
      {detailTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
          <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-2xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <div>
                <div className="text-xs font-extrabold uppercase tracking-wider text-turquoise">
                  ARIZA DETAYI & GEÇMİŞ
                </div>
                <h2 className="text-lg font-extrabold text-navy">
                  {detailTarget.ticket_number ?? detailTarget.id.slice(0, 8)} ·{' '}
                  {detailTarget.locations?.name
                    ? `${
                        detailTarget.locations.floors?.name
                          ? `${detailTarget.locations.floors.name} - `
                          : ''
                      }${detailTarget.locations.name}`
                    : detailTarget.custom_location ?? '-'}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setDetailTarget(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-5 overflow-y-auto p-6">
              {detailLoading ? (
                <div className="py-8 text-center text-sm text-slate-500">Yükleniyor...</div>
              ) : (
                <>
                  {/* Önce / Sonra Fotoğraf Galerisi */}
                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider text-navy">
                        <Camera className="h-4 w-4 text-turquoise" />
                        Önce / Sonra Fotoğraf Galerisi ({detailAttachments.length})
                      </div>
                      {canCreate && (
                        <label className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-slate-200 bg-canvas px-2.5 py-1 text-xs font-bold text-navy hover:bg-navy-soft">
                          <Plus className="h-3.5 w-3.5" />
                          {uploadingDetailPhoto ? 'Yükleniyor...' : 'Fotoğraf Ekle'}
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            disabled={uploadingDetailPhoto}
                            onChange={handleAddDetailPhoto}
                            className="hidden"
                          />
                        </label>
                      )}
                    </div>

                    {detailAttachments.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-slate-200 bg-canvas p-4 text-center text-xs text-slate-400">
                        Bu arızaya ait fotoğraf bulunmuyor.
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                        {detailAttachments.map((att) => (
                          <a
                            key={att.id}
                            href={att.signedUrl || '#'}
                            target="_blank"
                            rel="noreferrer"
                            className="group overflow-hidden rounded-xl border border-slate-200 bg-canvas"
                          >
                            {att.signedUrl ? (
                              <img
                                src={att.signedUrl}
                                alt={att.file_name || 'Fotoğraf'}
                                className="h-28 w-full object-cover transition group-hover:scale-105"
                              />
                            ) : (
                              <div className="flex h-28 items-center justify-center text-xs text-slate-400">
                                Önizleme Yok
                              </div>
                            )}
                            <div className="flex items-center justify-between px-2 py-1 text-[10px] font-bold text-slate-600">
                              <span
                                className={`rounded px-1.5 py-0.5 ${
                                  att.attachment_type === 'before'
                                    ? 'bg-amber-100 text-amber-800'
                                    : att.attachment_type === 'after'
                                    ? 'bg-emerald-100 text-emerald-700'
                                    : 'bg-slate-200 text-slate-700'
                                }`}
                              >
                                {att.attachment_type === 'before'
                                  ? 'Önce'
                                  : att.attachment_type === 'after'
                                  ? 'Sonra'
                                  : 'Genel'}
                              </span>
                              <span className="truncate pl-1">{att.file_name ?? ''}</span>
                            </div>
                          </a>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Bağlı İş Emirleri */}
                  {detailWOs.length > 0 && (
                    <div>
                      <div className="mb-2 text-xs font-extrabold uppercase tracking-wider text-navy">
                        Bağlı İş Emirleri ({detailWOs.length})
                      </div>
                      <div className="space-y-1.5">
                        {detailWOs.map((w) => (
                          <div
                            key={w.id}
                            className="flex items-center justify-between rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-xs"
                          >
                            <div>
                              <span className="font-bold text-slate-800">
                                {w.departments?.name ?? 'Departman'}
                              </span>
                              {w.work_description && (
                                <span className="ml-2 text-slate-500">· {w.work_description}</span>
                              )}
                            </div>
                            <span className="rounded-full bg-white px-2 py-0.5 font-bold text-navy shadow-sm">
                              {w.status}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Kronolojik Zaman Çizelgesi */}
                  <div>
                    <div className="mb-2 flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider text-navy">
                      <History className="h-4 w-4 text-turquoise" />
                      Durum Geçmişi & Yorumlar
                    </div>
                    <div className="space-y-2 border-l-2 border-slate-200 pl-3">
                      {detailTimeline.map((ev) => (
                        <div
                          key={ev.id}
                          className="rounded-xl border border-slate-200 bg-canvas/70 p-2.5 text-xs"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-extrabold text-slate-900">
                              {ev.title} · <span className="text-navy">{ev.actor}</span>
                            </span>
                            <span className="text-[11px] text-slate-400">
                              {formatDateTime(ev.created_at)}
                            </span>
                          </div>
                          {ev.detail && <p className="mt-1 text-slate-700">{ev.detail}</p>}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Hızlı Yorum Ekle */}
                  <form onSubmit={handlePostComment} className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Bu arıza kaydına not / yorum ekleyin..."
                      value={newComment}
                      onChange={(e) => setNewComment(e.target.value)}
                      className="flex-1 rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm focus:border-navy focus:outline-none"
                    />
                    <button
                      type="submit"
                      disabled={postingComment || !newComment.trim()}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-navy px-4 py-2 text-xs font-bold text-white hover:bg-navy-hover disabled:opacity-50"
                    >
                      <MessageSquarePlus className="h-3.5 w-3.5" />
                      {postingComment ? 'Ekleniyor...' : 'Yorum Ekle'}
                    </button>
                  </form>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

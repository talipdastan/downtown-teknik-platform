import { createClient } from '@/core/supabase/client';
import { EQUIPMENT_SELECT } from '@/core/supabase/selects';
import { TICKET_STATUS_LABELS } from '@/core/constants';
import { compressImageForUpload } from '@/core/utils/image-compress';
import {
  Equipment,
  TicketPriority,
  TicketStatus,
  WorkOrderStatus,
} from '@/types/database';
import {
  AttachmentView,
  generateUUID,
  LinkedWO,
  sanitizeFileName,
  TicketRow,
  TimelineEvent,
} from '@/features/work-tracking/ticket-helpers';
import {
  Dept,
  OpenTicket,
  Tech,
  WorkOrderRow,
} from '@/features/work-tracking/work-order-helpers';

export type RecentTicket = {
  id: string;
  ticket_number: string | null;
  reporter_id: string;
  description: string;
  priority: TicketPriority;
  status: TicketStatus;
  created_at: string;
  custom_location: string | null;
  custom_category: string | null;
  locations?: { name: string; floors?: { name: string } | null } | null;
  categories?: { name: string } | null;
  equipments?: { code: string; name: string } | null;
  profiles?: { full_name: string } | null;
};

export type RawWO = {
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

export type RawReportTicket = {
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

export type MttrStats = {
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
};

export type ReviewPhotoItem = {
  id: string;
  file_path: string;
  file_name: string | null;
  attachment_type: 'before' | 'after' | 'general';
  signedUrl?: string;
};

export type ReviewCommentItem = {
  id: string;
  comment: string;
  created_at: string;
  profiles?: { full_name: string } | null;
};

export type ReviewItem = {
  id: string;
  ticket_id: string;
  work_description: string | null;
  completed_at: string | null;
  departments?: { name: string } | null;
  tickets?: {
    id: string;
    ticket_number: string | null;
    description: string;
    custom_location: string | null;
    locations?: { name: string; floors?: { name: string } | null } | null;
    equipments?: { code: string; name: string } | null;
  } | null;
  photos: ReviewPhotoItem[];
  notes: ReviewCommentItem[];
};

export async function fetchWorkTrackingOverview() {
  const supabase = createClient();
  const [recRes, summaryRes] = await Promise.all([
    supabase
      .from('tickets')
      .select(
        'id, ticket_number, reporter_id, description, priority, status, created_at, custom_location, custom_category, locations(name, floors(name)), categories(name), equipments(code, name), profiles!tickets_reporter_id_fkey(full_name)'
      )
      .order('created_at', { ascending: false })
      .limit(50),
    supabase.rpc('rpc_work_tracking_dashboard_summary'),
  ]);

  if (recRes.error) throw recRes.error;
  const recentList = (recRes.data as unknown as RecentTicket[]) ?? [];

  const summaryRow = Array.isArray(summaryRes.data)
    ? (summaryRes.data[0] as Record<string, number> | undefined)
    : (summaryRes.data as Record<string, number> | null);

  if (!summaryRes.error && summaryRow) {
    return {
      recent: recentList,
      unassignedCount: Number(summaryRow.unassigned_count ?? 0),
      inFieldCount: Number(summaryRow.in_field_count ?? 0),
      awaitingApprovalCount: Number(summaryRow.awaiting_approval_count ?? 0),
      closedTotal: Number(summaryRow.closed_count ?? 0),
      urgentOpenCount: Number(summaryRow.urgent_open_count ?? 0),
    };
  }

  const [unassignedRes, inFieldRes, resolvedRes, closedRes, urgentRes] =
    await Promise.all([
      supabase
        .from('tickets')
        .select('id', { count: 'exact', head: true })
        .in('status', ['new', 'under_review']),
      supabase
        .from('tickets')
        .select('id', { count: 'exact', head: true })
        .in('status', ['assigned', 'in_progress', 'waiting']),
      supabase
        .from('tickets')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'resolved'),
      supabase
        .from('tickets')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'closed'),
      supabase
        .from('tickets')
        .select('id', { count: 'exact', head: true })
        .eq('priority', 'urgent')
        .not('status', 'in', '("closed","cancelled")'),
    ]);

  return {
    recent: recentList,
    unassignedCount: unassignedRes.count ?? 0,
    inFieldCount: inFieldRes.count ?? 0,
    awaitingApprovalCount: resolvedRes.count ?? 0,
    closedTotal: closedRes.count ?? 0,
    urgentOpenCount: urgentRes.count ?? 0,
  };
}

export async function fetchWorkTrackingReports(startDate: string, endDate: string) {
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
  const mttr: MttrStats | null =
    !mttrRes.error && mttrRes.data ? (mttrRes.data as MttrStats) : null;

  return {
    rawTickets: collected,
    totalMatchedCount: exactTotal ?? collected.length,
    mttr,
  };
}

export async function fetchPendingReviews(): Promise<ReviewItem[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('work_orders')
    .select(
      'id, ticket_id, work_description, completed_at, departments(name), tickets!inner(id, ticket_number, description, status, custom_location, locations(name, floors(name)), equipments(code, name))'
    )
    .eq('status', 'completed')
    .eq('tickets.status', 'resolved')
    .order('completed_at', { ascending: false })
    .limit(100);
  if (error) throw error;

  const raw = (data as unknown as Omit<ReviewItem, 'photos' | 'notes'>[]) ?? [];
  if (raw.length === 0) return [];

  const ticketIds = Array.from(new Set(raw.map((r) => r.ticket_id)));
  const woIds = raw.map((r) => r.id);

  const [tAttRes, wAttRes, commRes] = await Promise.all([
    supabase
      .from('attachments')
      .select('id, ticket_id, work_order_id, file_path, file_name, attachment_type')
      .in('ticket_id', ticketIds),
    supabase
      .from('attachments')
      .select('id, ticket_id, work_order_id, file_path, file_name, attachment_type')
      .in('work_order_id', woIds),
    supabase
      .from('comments')
      .select('id, ticket_id, comment, created_at, profiles(full_name)')
      .in('ticket_id', ticketIds)
      .order('created_at', { ascending: true }),
  ]);

  const allAtts = [
    ...((tAttRes.data ?? []) as Array<
      ReviewPhotoItem & { ticket_id: string | null; work_order_id: string | null }
    >),
    ...((wAttRes.data ?? []) as Array<
      ReviewPhotoItem & { ticket_id: string | null; work_order_id: string | null }
    >),
  ];

  const signedMap = new Map<string, string>();
  if (allAtts.length > 0) {
    const paths = Array.from(new Set(allAtts.map((a) => a.file_path)));
    const { data: signed } = await supabase.storage
      .from('work-attachments')
      .createSignedUrls(paths, 3600);
    for (const s of signed ?? []) {
      if (s.path && s.signedUrl) signedMap.set(s.path, s.signedUrl);
    }
  }

  const allComments =
    (commRes.data as unknown as Array<ReviewCommentItem & { ticket_id: string }>) ?? [];

  return raw.map((r) => {
    const itemPhotos = allAtts
      .filter((a) => a.ticket_id === r.ticket_id || a.work_order_id === r.id)
      .map((a) => ({
        id: a.id,
        file_path: a.file_path,
        file_name: a.file_name,
        attachment_type: a.attachment_type,
        signedUrl: signedMap.get(a.file_path),
      }));
    const itemNotes = allComments.filter((c) => c.ticket_id === r.ticket_id);
    return { ...r, photos: itemPhotos, notes: itemNotes };
  });
}

export async function managerCloseTicket(params: {
  ticketId: string;
  resolutionNote: string;
  reopen: boolean;
}): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc('rpc_manager_close_ticket', {
    p_ticket_id: params.ticketId,
    p_resolution_note: params.resolutionNote,
    p_reopen: params.reopen,
  });
  if (error) throw error;
}

export async function fetchTicketLookups() {
  const supabase = createClient();
  const [fRes, lRes, cRes, eRes] = await Promise.all([
    supabase.from('floors').select('id, name').eq('is_active', true).order('sort_order'),
    supabase
      .from('locations')
      .select('id, name, floor_id')
      .eq('is_active', true)
      .order('name'),
    supabase.from('categories').select('id, name').eq('is_active', true).order('name'),
    supabase
      .from('equipments')
      .select(EQUIPMENT_SELECT)
      .eq('is_active', true)
      .order('name')
      .limit(300),
  ]);
  return {
    floors: fRes.data ?? [],
    locations: lRes.data ?? [],
    categories: cRes.data ?? [],
    equipments: (eRes.data as Equipment[]) ?? [],
  };
}

export async function fetchTicketsPage(params: {
  page: number;
  pageSize: number;
  statusFilter: string;
  priorityFilter: string;
}): Promise<TicketRow[]> {
  const supabase = createClient();
  let q = supabase
    .from('tickets')
    .select(
      'id, ticket_number, reporter_id, location_id, category_id, description, priority, status, cancellation_reason, created_at, custom_location, custom_category, equipment_id, locations(id, name, floor_id, floors(name)), categories(id, name), equipments(code, name), profiles!tickets_reporter_id_fkey(full_name)'
    )
    .order('created_at', { ascending: false })
    .range(
      params.page * params.pageSize,
      params.page * params.pageSize + params.pageSize - 1
    );

  if (params.statusFilter) q = q.eq('status', params.statusFilter);
  if (params.priorityFilter) q = q.eq('priority', params.priorityFilter);

  const { data, error } = await q;
  if (error) throw error;
  return (data as unknown as TicketRow[]) ?? [];
}

export async function uploadTicketPhoto(
  ticketId: string,
  uid: string,
  rawFile: File,
  attType: 'before' | 'after' | 'general'
): Promise<void> {
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

export async function createTicketWithPhotos(params: {
  locationId: string | null;
  customLocation: string | null;
  categoryId: string | null;
  customCategory: string | null;
  equipmentId: string | null;
  priority: TicketPriority;
  description: string;
  photos: File[];
}): Promise<number> {
  const supabase = createClient();
  const { data: userRes } = await supabase.auth.getUser();
  const uid = userRes.user?.id;
  if (!uid) throw new Error('Oturum bulunamadı.');

  const ticketId = generateUUID();
  const { error } = await supabase.from('tickets').insert({
    id: ticketId,
    reporter_id: uid,
    location_id: params.locationId,
    custom_location: params.customLocation,
    category_id: params.categoryId,
    custom_category: params.customCategory,
    equipment_id: params.equipmentId,
    priority: params.priority,
    description: params.description,
  });
  if (error) throw error;

  let uploadedCount = 0;
  for (const file of params.photos) {
    await uploadTicketPhoto(ticketId, uid, file, 'before');
    uploadedCount++;
  }
  return uploadedCount;
}

export async function updateTicket(
  ticketId: string,
  payload: {
    priority: TicketPriority;
    status: TicketStatus;
    location_id: string | null;
    category_id: string | null;
    equipment_id: string | null;
    description: string;
    cancellation_reason: string | null;
  }
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from('tickets').update(payload).eq('id', ticketId);
  if (error) throw error;
}

export async function deleteTicket(ticketId: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from('tickets').delete().eq('id', ticketId);
  if (error) throw error;
}

export async function fetchTicketDetail(t: TicketRow): Promise<{
  workOrders: LinkedWO[];
  attachments: AttachmentView[];
  timeline: TimelineEvent[];
}> {
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

  let attachments: AttachmentView[] = combinedAtts;
  if (combinedAtts.length > 0) {
    const paths = combinedAtts.map((a) => a.file_path);
    const { data: signedData } = await supabase.storage
      .from('work-attachments')
      .createSignedUrls(paths, 3600);
    const urlMap = new Map<string, string>();
    for (const s of signedData ?? []) {
      if (s.path && s.signedUrl) urlMap.set(s.path, s.signedUrl);
    }
    attachments = combinedAtts.map((a) => ({ ...a, signedUrl: urlMap.get(a.file_path) }));
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

  const timeline = [initialEvent, ...histEvents, ...commentEvents].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  return { workOrders: wos, attachments, timeline };
}

export async function postTicketComment(ticketId: string, comment: string): Promise<void> {
  const supabase = createClient();
  const { data: userRes } = await supabase.auth.getUser();
  const uid = userRes.user?.id;
  if (!uid) throw new Error('Oturum bulunamadı.');
  const { error } = await supabase.from('comments').insert({
    ticket_id: ticketId,
    user_id: uid,
    comment,
  });
  if (error) throw error;
}

export async function uploadTicketDetailPhoto(
  ticketId: string,
  file: File
): Promise<void> {
  const supabase = createClient();
  const { data: userRes } = await supabase.auth.getUser();
  const uid = userRes.user?.id;
  if (!uid) throw new Error('Oturum bulunamadı.');
  await uploadTicketPhoto(ticketId, uid, file, 'general');
}

export async function fetchWorkOrdersPageData(params: {
  startDate: string;
  endDate: string;
  orderLimit: number;
}) {
  const supabase = createClient();
  let woQuery = supabase
    .from('work_orders')
    .select(
      'id, ticket_id, department_id, status, work_description, waiting_reason, created_at, started_at, completed_at, completed_by, completer:profiles!work_orders_completed_by_fkey(full_name), tickets(ticket_number, description, priority, created_at, resolved_at, closed_at, custom_location, locations(name, floors(name)), profiles!tickets_reporter_id_fkey(full_name)), departments(name), equipments(code, name), work_order_assignments(user_id, profiles!work_order_assignments_user_id_fkey(full_name))',
      { count: 'exact' }
    )
    .order('created_at', { ascending: false })
    .limit(params.orderLimit);

  if (params.startDate) {
    woQuery = woQuery.gte('created_at', `${params.startDate}T00:00:00`);
  }
  if (params.endDate) {
    woQuery = woQuery.lte('created_at', `${params.endDate}T23:59:59`);
  }

  const [tRes, dRes, techRes, woRes, wlRes] = await Promise.all([
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
    woQuery,
    supabase.rpc('rpc_get_technician_workloads'),
  ]);
  if (woRes.error) throw woRes.error;
  const workloads: Record<string, number> = {};
  if (!wlRes.error && Array.isArray(wlRes.data)) {
    for (const r of wlRes.data as Array<{ user_id: string; active_count: number }>) {
      workloads[r.user_id] = Number(r.active_count ?? 0);
    }
  }
  return {
    tickets: (tRes.data as OpenTicket[]) ?? [],
    depts: (dRes.data as Dept[]) ?? [],
    techs: (techRes.data as Tech[]) ?? [],
    orders: (woRes.data as unknown as WorkOrderRow[]) ?? [],
    totalOrdersCount: woRes.count ?? null,
    techWorkloads: workloads,
  };
}

export async function createWorkOrder(params: {
  ticketId: string;
  departmentId: string;
  assignedUserIds: string[];
  workDescription: string | null;
}): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc('rpc_create_work_order', {
    p_ticket_id: params.ticketId,
    p_department_id: params.departmentId,
    p_assigned_user_ids: params.assignedUserIds,
    p_work_description: params.workDescription,
  });
  if (error) throw error;
}

export async function technicianStartWork(workOrderId: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc('rpc_technician_start_work', {
    p_work_order_id: workOrderId,
  });
  if (error) throw error;
}

export async function technicianPauseWork(
  workOrderId: string,
  waitingReason: string
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc('rpc_technician_pause_work', {
    p_work_order_id: workOrderId,
    p_waiting_reason: waitingReason,
  });
  if (error) throw error;
}

export async function technicianCompleteWork(params: {
  workOrderId: string;
  note: string;
  photos: File[];
}): Promise<void> {
  const supabase = createClient();
  const { data: uRes } = await supabase.auth.getUser();
  const uid = uRes.user?.id;

  if (uid && params.photos.length > 0) {
    for (const rawFile of params.photos) {
      const file = await compressImageForUpload(rawFile);
      const safe = (file.name || 'after.webp').replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = `${uid}/${params.workOrderId}/${Date.now()}_${safe}`;
      const { error: upErr } = await supabase.storage
        .from('work-attachments')
        .upload(path, file, { contentType: file.type || 'image/webp', upsert: false });
      if (upErr) throw upErr;

      const { error: attErr } = await supabase.from('attachments').insert({
        work_order_id: params.workOrderId,
        uploaded_by: uid,
        file_path: path,
        file_name: file.name,
        mime_type: file.type || 'image/webp',
        attachment_type: 'after',
      });
      if (attErr) throw attErr;
    }
  }

  const { error } = await supabase.rpc('rpc_technician_complete_work', {
    p_work_order_id: params.workOrderId,
    p_note: params.note || 'Web panelinden tamamlandı.',
  });
  if (error) throw error;
}

export async function purgeExpiredClosedPhotos(retentionDays = 15): Promise<number> {
  const supabase = createClient();
  let totalPurged = 0;

  for (let round = 0; round < 10; round++) {
    const { data, error } = await supabase.rpc(
      'rpc_manager_list_expired_closed_attachments',
      {
        p_retention_days: retentionDays,
        p_batch_limit: 100,
      }
    );
    if (error) throw error;

    const rows =
      (data as Array<{ attachment_id: string; file_path: string }> | null) ?? [];
    if (rows.length === 0) break;

    const paths = rows.map((r) => (r.file_path || '').trim()).filter(Boolean);
    if (paths.length > 0) {
      const { error: remErr } = await supabase.storage
        .from('work-attachments')
        .remove(paths);
      if (remErr) throw remErr;
    }

    const ids = rows.map((r) => r.attachment_id);
    const { data: delCount, error: delErr } = await supabase.rpc(
      'rpc_manager_confirm_purged_attachments',
      { p_attachment_ids: ids }
    );
    if (delErr) throw delErr;
    totalPurged += typeof delCount === 'number' ? delCount : rows.length;

    if (rows.length < 100) break;
  }

  return totalPurged;
}

export async function updateWorkOrder(
  workOrderId: string,
  payload: {
    department_id: string;
    status: WorkOrderStatus;
    work_description: string | null;
    waiting_reason: string | null;
  }
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from('work_orders')
    .update(payload)
    .eq('id', workOrderId);
  if (error) throw error;
}

export async function deleteWorkOrder(workOrderId: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from('work_orders').delete().eq('id', workOrderId);
  if (error) throw error;
}

export type DuplicateOpenTicket = {
  id: string;
  ticket_number: string | null;
  status: TicketStatus;
  description: string;
  created_at: string;
};

export async function findDuplicateOpenTickets(params: {
  equipmentId: string | null;
  locationId: string | null;
}): Promise<DuplicateOpenTicket[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('rpc_find_duplicate_open_tickets', {
    p_equipment_id: params.equipmentId,
    p_location_id: params.locationId,
  });
  if (error) throw error;
  return (data as DuplicateOpenTicket[]) ?? [];
}

export type DrawerAttachmentRow = {
  id: string;
  file_path: string;
  file_name: string | null;
  attachment_type: string;
  created_at: string;
  signedUrl?: string | null;
};

export type DrawerMaterialRow = {
  id: string;
  material_name: string;
  quantity: number;
  unit: string;
  note: string | null;
  created_at: string;
};

export type DrawerCommentRow = {
  id: string;
  comment: string;
  created_at: string;
  profiles?: { full_name: string } | null;
};

export type DrawerHistoryRow = {
  id: string;
  old_status: TicketStatus | null;
  new_status: TicketStatus;
  change_note: string | null;
  created_at: string;
  profiles?: { full_name: string } | null;
};

export async function fetchWorkOrderDrawerDetail(params: {
  workOrderId: string;
  ticketId: string;
}): Promise<{
  attachments: DrawerAttachmentRow[];
  materials: DrawerMaterialRow[];
  comments: DrawerCommentRow[];
  history: DrawerHistoryRow[];
}> {
  const supabase = createClient();
  const [attTicketRes, attWoRes, matRes, comRes, histRes] = await Promise.all([
    supabase
      .from('attachments')
      .select('id, file_path, file_name, attachment_type, created_at')
      .eq('ticket_id', params.ticketId)
      .order('created_at', { ascending: true }),
    supabase
      .from('attachments')
      .select('id, file_path, file_name, attachment_type, created_at')
      .eq('work_order_id', params.workOrderId)
      .order('created_at', { ascending: true }),
    supabase
      .from('work_order_materials')
      .select('id, material_name, quantity, unit, note, created_at')
      .eq('work_order_id', params.workOrderId)
      .order('created_at', { ascending: true }),
    supabase
      .from('comments')
      .select('id, comment, created_at, profiles(full_name)')
      .eq('ticket_id', params.ticketId)
      .order('created_at', { ascending: true }),
    supabase
      .from('status_history')
      .select('id, old_status, new_status, change_note, created_at, profiles(full_name)')
      .eq('ticket_id', params.ticketId)
      .order('created_at', { ascending: true }),
  ]);

  const rawAtts = [
    ...((attTicketRes.data as DrawerAttachmentRow[]) ?? []),
    ...((attWoRes.data as DrawerAttachmentRow[]) ?? []),
  ];
  let attachments: DrawerAttachmentRow[] = rawAtts;
  if (rawAtts.length > 0) {
    const paths = Array.from(new Set(rawAtts.map((a) => a.file_path)));
    const { data: signedData } = await supabase.storage
      .from('work-attachments')
      .createSignedUrls(paths, 3600);
    const urlMap = new Map<string, string>();
    for (const s of signedData ?? []) {
      if (s.path && s.signedUrl) urlMap.set(s.path, s.signedUrl);
    }
    attachments = rawAtts.map((a) => ({
      ...a,
      signedUrl: urlMap.get(a.file_path) ?? null,
    }));
  }

  return {
    attachments,
    materials: (matRes.data as DrawerMaterialRow[]) ?? [],
    comments: (comRes.data as unknown as DrawerCommentRow[]) ?? [],
    history: (histRes.data as unknown as DrawerHistoryRow[]) ?? [],
  };
}

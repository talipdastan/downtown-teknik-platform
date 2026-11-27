import { TicketPriority, WorkOrderStatus } from '@/types/database';

export type OpenTicket = {
  id: string;
  ticket_number: string | null;
  description: string;
  priority: string;
  status: string;
};

export type Dept = { id: string; name: string };
export type Tech = { id: string; full_name: string; department_id: string | null };

export type WorkOrderRow = {
  id: string;
  ticket_id: string;
  department_id: string;
  status: WorkOrderStatus;
  work_description: string | null;
  waiting_reason: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  completed_by: string | null;
  completer?: { full_name: string } | null;
  tickets?: {
    ticket_number: string | null;
    description: string;
    priority?: TicketPriority;
    created_at?: string;
    resolved_at?: string | null;
    closed_at?: string | null;
    custom_location?: string | null;
    locations?: { name: string; floors?: { name: string } | null } | null;
    profiles?: { full_name: string } | null;
  } | null;
  departments?: { name: string } | null;
  equipments?: { code: string; name: string } | null;
  work_order_assignments?: {
    user_id: string;
    profiles?: { full_name: string } | null;
  }[];
};

export type StatusTab = 'all' | 'active' | 'waiting' | 'completed';

export function woBadgeClass(s: WorkOrderStatus): string {
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

export function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function calcDurationLabel(
  startIso?: string | null,
  endIso?: string | null
): string | null {
  if (!startIso || !endIso) return null;
  const s = new Date(startIso).getTime();
  const e = new Date(endIso).getTime();
  if (Number.isNaN(s) || Number.isNaN(e) || e < s) return null;
  const mins = Math.round((e - s) / 60000);
  if (mins < 1) return '< 1 dk';
  if (mins < 60) return `${mins} dk`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h} sa ${m} dk` : `${h} sa`;
}

export function resolveRequesterName(o: WorkOrderRow): string {
  return o.tickets?.profiles?.full_name || 'Belirtilmedi';
}

export function resolveRequestOpenDate(o: WorkOrderRow): string {
  return o.tickets?.created_at || o.created_at;
}

export function resolveCompleterName(o: WorkOrderRow): string {
  if (o.status !== 'completed') return '-';
  if (o.completer?.full_name) return o.completer.full_name;
  const assignedNames = (o.work_order_assignments ?? [])
    .map((a) => a.profiles?.full_name)
    .filter(Boolean);
  return assignedNames.length > 0 ? assignedNames.join(', ') : 'Teknik Ekip';
}

export function resolveLocationLabel(o: WorkOrderRow): string {
  const loc = o.tickets?.locations;
  if (loc?.name) {
    return `${loc.floors?.name ? `${loc.floors.name} - ` : ''}${loc.name}`;
  }
  return o.tickets?.custom_location || '-';
}

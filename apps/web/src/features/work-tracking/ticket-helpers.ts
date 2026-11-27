import {
  TicketPriority,
  TicketStatus,
  WorkOrderStatus,
} from '@/types/database';

export type TicketRow = {
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
  locations?: {
    id?: string;
    name: string;
    floor_id?: string;
    floors?: { name: string } | null;
  } | null;
  categories?: { id?: string; name: string } | null;
  equipments?: { code: string; name: string } | null;
  profiles?: { full_name: string } | null;
};

export type Lookup = { id: string; name: string; floor_id?: string };

export type AttachmentView = {
  id: string;
  file_path: string;
  file_name: string | null;
  attachment_type: 'before' | 'after' | 'general';
  created_at: string;
  signedUrl?: string;
};

export type TimelineEvent = {
  id: string;
  kind: 'status' | 'comment';
  created_at: string;
  actor: string;
  title: string;
  detail?: string | null;
};

export type LinkedWO = {
  id: string;
  status: WorkOrderStatus;
  work_description: string | null;
  created_at: string;
  departments?: { name: string } | null;
};

export const TICKET_PAGE_SIZE = 25;

export function statusBadgeClass(status: TicketStatus): string {
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

export function priorityBadgeClass(p: TicketPriority): string {
  if (p === 'urgent') return 'bg-red-100 text-red-700';
  if (p === 'priority') return 'bg-amber-100 text-amber-800';
  return 'bg-slate-100 text-slate-700';
}

export function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

/**
 * Hem HTTPS hem HTTP üzerinde çalışan RFC4122 v4 uyumlu güvenli UUID üretici.
 */
export function generateUUID(): string {
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

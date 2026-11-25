import { TicketPriority, TicketStatus, WorkOrderStatus } from '@/types/database';

export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  new: 'Yeni',
  under_review: 'İnceleniyor',
  assigned: 'Atandı',
  in_progress: 'İşlemde',
  waiting: 'Beklemede',
  resolved: 'Çözüldü (Onay Bekliyor)',
  closed: 'Kapandı',
  cancelled: 'İptal Edildi',
};

export const WORK_ORDER_STATUS_LABELS: Record<WorkOrderStatus, string> = {
  assigned: 'Atandı',
  in_progress: 'İşlemde',
  waiting: 'Beklemede',
  completed: 'Tamamlandı',
  cancelled: 'İptal Edildi',
};

export const PRIORITY_LABELS: Record<TicketPriority, string> = {
  normal: 'Normal',
  priority: 'Öncelikli',
  urgent: 'Acil',
};

export function formatDate(iso?: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

export function formatDateTime(iso?: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${formatDate(iso)} ${hh}:${min}`;
}

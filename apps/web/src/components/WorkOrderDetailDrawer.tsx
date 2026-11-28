'use client';

import { useEffect, useState } from 'react';
import {
  Camera,
  Clock,
  MessageSquare,
  Package,
  UserCheck,
  UserPlus,
  Wrench,
  X,
} from 'lucide-react';
import {
  formatDateTime,
  TICKET_STATUS_LABELS,
  WORK_ORDER_STATUS_LABELS,
} from '@/core/constants';
import {
  DrawerAttachmentRow,
  DrawerCommentRow,
  DrawerHistoryRow,
  DrawerMaterialRow,
  fetchWorkOrderDrawerDetail,
} from '@/features/work-tracking/queries';
import { WorkOrderStatus } from '@/types/database';

export interface WorkOrderDrawerInput {
  id: string;
  ticket_id: string;
  status: WorkOrderStatus;
  work_description: string | null;
  waiting_reason: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  ticket_number: string;
  ticket_description: string;
  requester_name: string;
  open_date: string;
  completer_name: string;
  department_name: string;
  location_label: string;
  equipment_label: string;
  technicians_label: string;
}

export function WorkOrderDetailDrawer({
  item,
  onClose,
}: {
  item: WorkOrderDrawerInput | null;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [attachments, setAttachments] = useState<DrawerAttachmentRow[]>([]);
  const [materials, setMaterials] = useState<DrawerMaterialRow[]>([]);
  const [comments, setComments] = useState<DrawerCommentRow[]>([]);
  const [history, setHistory] = useState<DrawerHistoryRow[]>([]);

  useEffect(() => {
    if (!item) return;
    let active = true;

    async function loadDetail() {
      if (!item) return;
      setLoading(true);
      try {
        const detail = await fetchWorkOrderDrawerDetail({
          workOrderId: item.id,
          ticketId: item.ticket_id,
        });
        if (!active) return;
        setAttachments(detail.attachments);
        setMaterials(detail.materials);
        setComments(detail.comments);
        setHistory(detail.history);
      } catch {
        // Sessiz geç
      } finally {
        if (active) setLoading(false);
      }
    }

    loadDetail();
    return () => {
      active = false;
    };
  }, [item]);

  if (!item) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/45 backdrop-blur-[1px]">
      <div className="flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl">
        {/* Başlık */}
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 bg-navy px-5 py-4 text-white">
          <div>
            <div className="text-[11px] font-extrabold uppercase tracking-wider text-cyan-200">
              İŞ EMRİ DETAY KARTI · 360° İZLEME
            </div>
            <h2 className="mt-0.5 text-lg font-extrabold">
              {item.ticket_number} – {item.department_name}
            </h2>
            <div className="mt-1 text-xs text-slate-200">
              {item.location_label}
              {item.equipment_label !== '-' ? ` · ${item.equipment_label}` : ''}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-white/10 p-2 text-white hover:bg-white/20"
            aria-label="Kapat"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Gövde */}
        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          {/* Özet Kartı */}
          <div className="grid gap-3 rounded-2xl border border-slate-200 bg-canvas p-4 sm:grid-cols-2">
            <div>
              <div className="flex items-center gap-1.5 text-[11px] font-extrabold uppercase text-slate-400">
                <UserPlus className="h-3.5 w-3.5 text-sky-600" />
                İstek Açan & Tarih
              </div>
              <div className="mt-1 text-sm font-bold text-slate-900">{item.requester_name}</div>
              <div className="text-xs text-slate-500">{formatDateTime(item.open_date)}</div>
            </div>
            <div>
              <div className="flex items-center gap-1.5 text-[11px] font-extrabold uppercase text-slate-400">
                <UserCheck className="h-3.5 w-3.5 text-emerald-600" />
                Tamamlayan & Tarih
              </div>
              <div className="mt-1 text-sm font-bold text-slate-900">{item.completer_name}</div>
              <div className="text-xs text-slate-500">
                {item.completed_at ? formatDateTime(item.completed_at) : WORK_ORDER_STATUS_LABELS[item.status]}
              </div>
            </div>
            <div className="sm:col-span-2">
              <div className="flex items-center gap-1.5 text-[11px] font-extrabold uppercase text-slate-400">
                <Wrench className="h-3.5 w-3.5 text-navy" />
                Atanan Teknisyenler & Açıklama
              </div>
              <div className="mt-1 text-xs font-bold text-navy">{item.technicians_label}</div>
              <p className="mt-1 text-sm text-slate-700">{item.ticket_description}</p>
              {item.work_description && (
                <p className="mt-1 rounded-lg bg-white px-2.5 py-1.5 text-xs text-slate-600">
                  <strong>Talimat:</strong> {item.work_description}
                </p>
              )}
              {item.waiting_reason && (
                <p className="mt-1 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs font-semibold text-amber-900">
                  <strong>Bekleme Gerekçesi:</strong> {item.waiting_reason}
                </p>
              )}
            </div>
          </div>

          {loading ? (
            <div className="py-8 text-center text-sm text-slate-400">
              Fotoğraflar, malzemeler ve durum geçmişi yükleniyor...
            </div>
          ) : (
            <>
              {/* Fotoğraflar */}
              <section>
                <h3 className="mb-2 flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider text-slate-500">
                  <Camera className="h-3.5 w-3.5 text-navy" />
                  Saha Fotoğrafları ({attachments.length})
                </h3>
                {attachments.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-200 p-4 text-xs text-slate-400">
                    Kayıtlı fotoğraf yok (veya 15 günlük saklama süresi sonunda temizlenmiş olabilir).
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {attachments.map((att) => (
                      <a
                        key={att.id}
                        href={att.signedUrl || '#'}
                        target="_blank"
                        rel="noreferrer"
                        className="group overflow-hidden rounded-xl border border-slate-200 bg-slate-50"
                      >
                        {att.signedUrl ? (
                          <img
                            src={att.signedUrl}
                            alt={att.file_name || 'Fotoğraf'}
                            className="h-28 w-full object-cover transition group-hover:scale-105"
                          />
                        ) : (
                          <div className="flex h-28 items-center justify-center text-xs text-slate-400">
                            Önizleme yok
                          </div>
                        )}
                        <div className="flex items-center justify-between px-2 py-1 text-[10px] font-bold text-slate-600">
                          <span className="uppercase">
                            {att.attachment_type === 'after'
                              ? 'Sonrası'
                              : att.attachment_type === 'before'
                              ? 'Öncesi'
                              : 'Açılış'}
                          </span>
                          <span className="truncate pl-1 text-slate-400">
                            {formatDateTime(att.created_at).slice(0, 10)}
                          </span>
                        </div>
                      </a>
                    ))}
                  </div>
                )}
              </section>

              {/* Kullanılan Malzemeler */}
              <section>
                <h3 className="mb-2 flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider text-slate-500">
                  <Package className="h-3.5 w-3.5 text-emerald-700" />
                  Kullanılan Malzemeler ({materials.length})
                </h3>
                {materials.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-200 p-3 text-xs text-slate-400">
                    Malzeme kaydı girilmemiş.
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                    {materials.map((m) => (
                      <div key={m.id} className="flex items-center justify-between px-3 py-2 text-xs">
                        <div>
                          <span className="font-bold text-slate-800">{m.material_name}</span>
                          {m.note && <span className="ml-2 text-slate-500">({m.note})</span>}
                        </div>
                        <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 font-extrabold text-emerald-800">
                          {m.quantity} {m.unit}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Notlar & Yorumlar */}
              {comments.length > 0 && (
                <section>
                  <h3 className="mb-2 flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider text-slate-500">
                    <MessageSquare className="h-3.5 w-3.5 text-sky-600" />
                    Notlar & Yorumlar ({comments.length})
                  </h3>
                  <div className="space-y-2">
                    {comments.map((c) => (
                      <div key={c.id} className="rounded-xl border border-slate-200 bg-canvas p-3 text-xs">
                        <div className="flex items-center justify-between font-bold text-slate-700">
                          <span>{c.profiles?.full_name ?? 'Personel'}</span>
                          <span className="font-normal text-slate-400">
                            {formatDateTime(c.created_at)}
                          </span>
                        </div>
                        <p className="mt-1 text-slate-600">{c.comment}</p>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Kronolojik Durum Geçmişi */}
              <section>
                <h3 className="mb-2 flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider text-slate-500">
                  <Clock className="h-3.5 w-3.5 text-navy" />
                  Kronolojik Durum Geçmişi ({history.length})
                </h3>
                {history.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-200 p-3 text-xs text-slate-400">
                    Durum geçmişi kaydı bulunmuyor.
                  </div>
                ) : (
                  <ol className="space-y-2 border-l-2 border-slate-200 pl-3.5">
                    {history.map((h) => (
                      <li key={h.id} className="text-xs">
                        <div className="font-bold text-slate-800">
                          {h.old_status
                            ? `${TICKET_STATUS_LABELS[h.old_status] ?? h.old_status} → `
                            : ''}
                          {TICKET_STATUS_LABELS[h.new_status] ?? h.new_status}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {h.profiles?.full_name ?? 'Sistem'} · {formatDateTime(h.created_at)}
                        </div>
                        {h.change_note && (
                          <div className="mt-0.5 text-slate-600">{h.change_note}</div>
                        )}
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

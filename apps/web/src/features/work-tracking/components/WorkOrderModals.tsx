'use client';

import { Camera, X } from 'lucide-react';
import { WORK_ORDER_STATUS_LABELS } from '@/core/constants';
import { WorkOrderStatus } from '@/types/database';
import { Dept, WorkOrderRow } from '@/features/work-tracking/work-order-helpers';

export function CompleteWorkOrderModal({
  target,
  completeNote,
  setCompleteNote,
  completePhotos,
  setCompletePhotos,
  completing,
  onClose,
  onSubmit,
}: {
  target: WorkOrderRow | null;
  completeNote: string;
  setCompleteNote: (v: string) => void;
  completePhotos: File[];
  setCompletePhotos: (v: File[]) => void;
  completing: boolean;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
}) {
  if (!target) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-lg space-y-4 rounded-2xl bg-white p-6 shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <h2 className="text-lg font-extrabold text-navy">
            İş Emrini Tamamla · {target.tickets?.ticket_number ?? ''}
          </h2>
          <button
            type="button"
            onClick={onClose}
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
            <span>Çözüm Sonrası Fotoğraf Ekle (Otomatik ~100 KB Sıkıştırmalı)</span>
            <input
              type="file"
              multiple
              accept="image/*"
              onChange={(e) =>
                setCompletePhotos(Array.from(e.target.files ?? []).slice(0, 5))
              }
              className="hidden"
            />
          </label>
          {completePhotos.length > 0 && (
            <div className="mt-2 space-y-1 text-xs text-slate-600">
              {completePhotos.map((f, i) => (
                <div key={i} className="truncate">
                  • {f.name}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-600"
          >
            Vazgeç
          </button>
          <button
            type="submit"
            disabled={completing}
            className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {completing ? 'Gönderiliyor...' : 'Tamamla ve Onaya Gönder'}
          </button>
        </div>
      </form>
    </div>
  );
}

export function EditWorkOrderModal({
  target,
  depts,
  editDeptId,
  setEditDeptId,
  editStatus,
  setEditStatus,
  editDesc,
  setEditDesc,
  editWaitingReason,
  setEditWaitingReason,
  savingEdit,
  onClose,
  onSubmit,
}: {
  target: WorkOrderRow | null;
  depts: Dept[];
  editDeptId: string;
  setEditDeptId: (v: string) => void;
  editStatus: WorkOrderStatus;
  setEditStatus: (v: WorkOrderStatus) => void;
  editDesc: string;
  setEditDesc: (v: string) => void;
  editWaitingReason: string;
  setEditWaitingReason: (v: string) => void;
  savingEdit: boolean;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
}) {
  if (!target) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-lg space-y-4 rounded-2xl bg-white p-6 shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <h2 className="text-lg font-extrabold text-navy">
            İş Emri Düzenle · {target.tickets?.ticket_number ?? ''}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-600">Departman</label>
            <select
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
            <label className="mb-1 block text-xs font-bold text-orange-700">
              Bekleme Gerekçesi
            </label>
            <input
              type="text"
              value={editWaitingReason}
              onChange={(e) => setEditWaitingReason(e.target.value)}
              className="w-full rounded-xl border border-orange-200 bg-orange-50/50 px-3 py-2 text-sm"
            />
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-600"
          >
            Vazgeç
          </button>
          <button
            type="submit"
            disabled={savingEdit}
            className="rounded-xl bg-navy px-4 py-2 text-xs font-bold text-white hover:bg-navy-hover disabled:opacity-50"
          >
            {savingEdit ? 'Kaydediliyor...' : 'Değişiklikleri Kaydet'}
          </button>
        </div>
      </form>
    </div>
  );
}

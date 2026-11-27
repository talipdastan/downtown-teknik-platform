'use client';

import { Camera, History, MessageSquarePlus, Plus, X } from 'lucide-react';
import { DuplicateTicketBanner } from '@/components/DuplicateTicketBanner';
import { formatDateTime, PRIORITY_LABELS, TICKET_STATUS_LABELS } from '@/core/constants';
import { Equipment, TicketPriority, TicketStatus } from '@/types/database';
import {
  AttachmentView,
  LinkedWO,
  Lookup,
  TicketRow,
  TimelineEvent,
} from '@/features/work-tracking/ticket-helpers';

export function CreateTicketModal({
  open,
  floors,
  floorLocations,
  categories,
  equipments,
  floorId,
  setFloorId,
  locationId,
  setLocationId,
  customLocation,
  setCustomLocation,
  categoryId,
  setCategoryId,
  customCategory,
  setCustomCategory,
  equipmentId,
  setEquipmentId,
  priority,
  setPriority,
  description,
  setDescription,
  newPhotos,
  setNewPhotos,
  creating,
  onClose,
  onSubmit,
}: {
  open: boolean;
  floors: Lookup[];
  floorLocations: Lookup[];
  categories: Lookup[];
  equipments: Equipment[];
  floorId: string;
  setFloorId: (v: string) => void;
  locationId: string;
  setLocationId: (v: string) => void;
  customLocation: string;
  setCustomLocation: (v: string) => void;
  categoryId: string;
  setCategoryId: (v: string) => void;
  customCategory: string;
  setCustomCategory: (v: string) => void;
  equipmentId: string;
  setEquipmentId: (v: string) => void;
  priority: TicketPriority;
  setPriority: (v: TicketPriority) => void;
  description: string;
  setDescription: (v: string) => void;
  newPhotos: File[];
  setNewPhotos: React.Dispatch<React.SetStateAction<File[]>>;
  creating: boolean;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
      <form
        onSubmit={onSubmit}
        className="max-h-[90vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <h2 className="text-lg font-extrabold text-navy">Yeni Arıza Kaydı</h2>
          <button
            type="button"
            onClick={onClose}
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
            onClick={onClose}
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
  );
}

export function EditTicketModal({
  target,
  locations,
  categories,
  equipments,
  editPriority,
  setEditPriority,
  editStatus,
  setEditStatus,
  editLocationId,
  setEditLocationId,
  editCategoryId,
  setEditCategoryId,
  editEquipmentId,
  setEditEquipmentId,
  editDescription,
  setEditDescription,
  editCancelReason,
  setEditCancelReason,
  savingEdit,
  onClose,
  onSubmit,
}: {
  target: TicketRow | null;
  locations: Lookup[];
  categories: Lookup[];
  equipments: Equipment[];
  editPriority: TicketPriority;
  setEditPriority: (v: TicketPriority) => void;
  editStatus: TicketStatus;
  setEditStatus: (v: TicketStatus) => void;
  editLocationId: string;
  setEditLocationId: (v: string) => void;
  editCategoryId: string;
  setEditCategoryId: (v: string) => void;
  editEquipmentId: string;
  setEditEquipmentId: (v: string) => void;
  editDescription: string;
  setEditDescription: (v: string) => void;
  editCancelReason: string;
  setEditCancelReason: (v: string) => void;
  savingEdit: boolean;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
}) {
  if (!target) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
      <form
        onSubmit={onSubmit}
        className="max-h-[90vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <h2 className="text-lg font-extrabold text-navy">
            Arıza Düzenle · {target.ticket_number ?? ''}
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
            onClick={onClose}
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
  );
}

export function TicketDetailModal({
  target,
  loading,
  attachments,
  timeline,
  workOrders,
  canCreate,
  uploadingDetailPhoto,
  onAddDetailPhoto,
  newComment,
  setNewComment,
  postingComment,
  onPostComment,
  onClose,
}: {
  target: TicketRow | null;
  loading: boolean;
  attachments: AttachmentView[];
  timeline: TimelineEvent[];
  workOrders: LinkedWO[];
  canCreate: boolean;
  uploadingDetailPhoto: boolean;
  onAddDetailPhoto: (e: React.ChangeEvent<HTMLInputElement>) => void;
  newComment: string;
  setNewComment: (v: string) => void;
  postingComment: boolean;
  onPostComment: (e: React.FormEvent) => void;
  onClose: () => void;
}) {
  if (!target) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div>
            <div className="text-xs font-extrabold uppercase tracking-wider text-turquoise">
              ARIZA DETAYI & GEÇMİŞ
            </div>
            <h2 className="text-lg font-extrabold text-navy">
              {target.ticket_number ?? target.id.slice(0, 8)} ·{' '}
              {target.locations?.name
                ? `${
                    target.locations.floors?.name
                      ? `${target.locations.floors.name} - `
                      : ''
                  }${target.locations.name}`
                : target.custom_location ?? '-'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-5 overflow-y-auto p-6">
          {loading ? (
            <div className="py-8 text-center text-sm text-slate-500">Yükleniyor...</div>
          ) : (
            <>
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider text-navy">
                    <Camera className="h-4 w-4 text-turquoise" />
                    Önce / Sonra Fotoğraf Galerisi ({attachments.length})
                  </div>
                  {canCreate && (
                    <label className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-slate-200 bg-canvas px-2.5 py-1 text-xs font-bold text-navy hover:bg-navy-soft">
                      <Plus className="h-3.5 w-3.5" />
                      {uploadingDetailPhoto ? 'Yükleniyor...' : 'Fotoğraf Ekle'}
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        disabled={uploadingDetailPhoto}
                        onChange={onAddDetailPhoto}
                        className="hidden"
                      />
                    </label>
                  )}
                </div>

                {attachments.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-200 bg-canvas p-4 text-center text-xs text-slate-400">
                    Bu arızaya ait fotoğraf bulunmuyor.
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {attachments.map((att) => (
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

              {workOrders.length > 0 && (
                <div>
                  <div className="mb-2 text-xs font-extrabold uppercase tracking-wider text-navy">
                    Bağlı İş Emirleri ({workOrders.length})
                  </div>
                  <div className="space-y-1.5">
                    {workOrders.map((w) => (
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

              <div>
                <div className="mb-2 flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider text-navy">
                  <History className="h-4 w-4 text-turquoise" />
                  Durum Geçmişi & Yorumlar
                </div>
                <div className="space-y-2 border-l-2 border-slate-200 pl-3">
                  {timeline.map((ev) => (
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

              <form onSubmit={onPostComment} className="flex gap-2">
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
  );
}

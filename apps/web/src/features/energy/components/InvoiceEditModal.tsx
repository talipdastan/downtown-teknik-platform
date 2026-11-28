'use client';

import { X } from 'lucide-react';
import { Meter } from '@/types/database';

export interface InvoiceEditModalState {
  mode: 'create' | 'edit';
  id?: string;
  period_year: number;
  period_month: number;
  utility_type: 'electric' | 'gas' | 'water';
  provider: string;
  invoice_no: string;
  invoice_date: string;
  meter_id: string;
  meter_name: string;
  consumption: string;
  amount_tl: string;
  inductive_penalty_tl: string;
  capacitive_penalty_tl: string;
  tenant_amount_tl: string;
}

interface InvoiceEditModalProps {
  editModal: InvoiceEditModalState;
  year: number;
  months: string[];
  meters: Meter[];
  saving: boolean;
  onChange: (next: InvoiceEditModalState) => void;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
}

export function InvoiceEditModal({
  editModal,
  year,
  months,
  meters,
  saving,
  onChange,
  onClose,
  onSubmit,
}: InvoiceEditModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-lg space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-xl"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-extrabold text-navy">
            {editModal.mode === 'edit' ? 'Fatura Düzenle' : 'Yeni Fatura Ekle'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-bold text-slate-600">
            Yıl
            <input
              type="number"
              required
              value={editModal.period_year}
              onChange={(e) =>
                onChange({
                  ...editModal,
                  period_year: Number(e.target.value) || year,
                })
              }
              className="mt-1 w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm font-normal"
            />
          </label>
          <label className="text-xs font-bold text-slate-600">
            Ay
            <select
              value={editModal.period_month}
              onChange={(e) =>
                onChange({
                  ...editModal,
                  period_month: Number(e.target.value),
                })
              }
              className="mt-1 w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm font-normal"
            >
              {months.slice(1).map((m, idx) => (
                <option key={m} value={idx + 1}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-bold text-slate-600">
            Enerji Türü
            <select
              value={editModal.utility_type}
              onChange={(e) => {
                const nextType = e.target.value as 'electric' | 'gas' | 'water';
                onChange({
                  ...editModal,
                  utility_type: nextType,
                  inductive_penalty_tl:
                    nextType === 'electric' ? editModal.inductive_penalty_tl : '0',
                  capacitive_penalty_tl:
                    nextType === 'electric' ? editModal.capacitive_penalty_tl : '0',
                });
              }}
              className="mt-1 w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm font-normal"
            >
              <option value="electric">Elektrik</option>
              <option value="gas">Doğalgaz</option>
              <option value="water">Su</option>
            </select>
          </label>
          <label className="text-xs font-bold text-slate-600">
            Sayaç
            <select
              value={editModal.meter_id}
              onChange={(e) => {
                const m = meters.find((x) => x.id === e.target.value);
                onChange({
                  ...editModal,
                  meter_id: e.target.value,
                  meter_name: m ? m.name : editModal.meter_name,
                });
              }}
              className="mt-1 w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm font-normal"
            >
              <option value="">Serbest / Genel</option>
              {meters.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-bold text-slate-600">
            Sayaç Adı
            <input
              required
              value={editModal.meter_name}
              onChange={(e) => onChange({ ...editModal, meter_name: e.target.value })}
              className="mt-1 w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm font-normal"
            />
          </label>
          <label className="text-xs font-bold text-slate-600">
            Tedarikçi
            <input
              required
              value={editModal.provider}
              onChange={(e) => onChange({ ...editModal, provider: e.target.value })}
              className="mt-1 w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm font-normal"
            />
          </label>
          <label className="text-xs font-bold text-slate-600">
            Tüketim
            <input
              type="number"
              step="0.001"
              required
              value={editModal.consumption}
              onChange={(e) => onChange({ ...editModal, consumption: e.target.value })}
              className="mt-1 w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm font-normal"
            />
          </label>
          <label className="text-xs font-bold text-slate-600">
            Tutar (TL)
            <input
              type="number"
              step="0.01"
              required
              value={editModal.amount_tl}
              onChange={(e) => onChange({ ...editModal, amount_tl: e.target.value })}
              className="mt-1 w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm font-normal"
            />
          </label>
          {editModal.utility_type === 'electric' && (
            <>
              <label className="text-xs font-bold text-slate-600">
                İndüktif Ceza (TL)
                <input
                  type="number"
                  step="0.01"
                  value={editModal.inductive_penalty_tl}
                  onChange={(e) =>
                    onChange({ ...editModal, inductive_penalty_tl: e.target.value })
                  }
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm font-normal"
                />
              </label>
              <label className="text-xs font-bold text-slate-600">
                Kapasitif Ceza (TL)
                <input
                  type="number"
                  step="0.01"
                  value={editModal.capacitive_penalty_tl}
                  onChange={(e) =>
                    onChange({ ...editModal, capacitive_penalty_tl: e.target.value })
                  }
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm font-normal"
                />
              </label>
            </>
          )}
          <label className="text-xs font-bold text-slate-600">
            Kiracı Payı (TL)
            <input
              type="number"
              step="0.01"
              value={editModal.tenant_amount_tl}
              onChange={(e) => onChange({ ...editModal, tenant_amount_tl: e.target.value })}
              className="mt-1 w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm font-normal"
            />
          </label>
          <label className="text-xs font-bold text-slate-600">
            Fatura Tarihi
            <input
              type="date"
              value={editModal.invoice_date}
              onChange={(e) => onChange({ ...editModal, invoice_date: e.target.value })}
              className="mt-1 w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm font-normal"
            />
          </label>
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
            disabled={saving}
            className="rounded-xl bg-navy px-4 py-2 text-xs font-bold text-white hover:bg-navy-hover disabled:opacity-50"
          >
            {saving ? 'Kaydediliyor...' : 'Kaydet'}
          </button>
        </div>
      </form>
    </div>
  );
}

'use client';

import { X } from 'lucide-react';
import { UtilityType } from '@/types/database';
import { BudgetFormState, MONTHS, utilityUnit } from '@/features/energy/budget-helpers';

export function BudgetFormModal({
  formModal,
  setFormModal,
  saving,
  onSubmit,
}: {
  formModal: BudgetFormState | null;
  setFormModal: (v: BudgetFormState | null) => void;
  saving: boolean;
  onSubmit: (e: React.FormEvent) => void;
}) {
  if (!formModal) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <h2 className="text-lg font-extrabold text-slate-900">
            {formModal.id ? 'Bütçe Kaydını Düzenle' : 'Yeni Bütçe Kaydı Ekle'}
          </h2>
          <button
            type="button"
            onClick={() => setFormModal(null)}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={onSubmit} className="mt-4 space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-600">Enerji Türü</label>
              <select
                value={formModal.utility_type}
                onChange={(e) =>
                  setFormModal({
                    ...formModal,
                    utility_type: e.target.value as UtilityType,
                  })
                }
                className="w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm font-semibold text-slate-800 focus:border-navy focus:outline-none"
              >
                <option value="electric">Elektrik</option>
                <option value="gas">Doğalgaz</option>
                <option value="water">Su</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-600">Yıl</label>
              <input
                type="number"
                required
                value={formModal.period_year}
                onChange={(e) => setFormModal({ ...formModal, period_year: e.target.value })}
                className="w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm font-semibold text-slate-800 focus:border-navy focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-600">Ay</label>
              <select
                value={formModal.period_month}
                onChange={(e) => setFormModal({ ...formModal, period_month: e.target.value })}
                className="w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm font-semibold text-slate-800 focus:border-navy focus:outline-none"
              >
                {MONTHS.slice(1).map((m, idx) => (
                  <option key={m} value={idx + 1}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-600">
                Bütçe Miktar ({utilityUnit(formModal.utility_type)})
              </label>
              <input
                type="number"
                step="0.01"
                value={formModal.budget_consumption}
                onChange={(e) =>
                  setFormModal({ ...formModal, budget_consumption: e.target.value })
                }
                className="w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm focus:border-navy focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-600">Bütçe (TL)</label>
              <input
                type="number"
                step="0.01"
                required
                value={formModal.budget_tl}
                onChange={(e) => setFormModal({ ...formModal, budget_tl: e.target.value })}
                className="w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm focus:border-navy focus:outline-none"
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-600">
                Önceki Yıl Miktar ({utilityUnit(formModal.utility_type)})
              </label>
              <input
                type="number"
                step="0.01"
                value={formModal.prev_year_consumption}
                onChange={(e) =>
                  setFormModal({ ...formModal, prev_year_consumption: e.target.value })
                }
                className="w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm focus:border-navy focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-600">
                Önceki Yıl (TL)
              </label>
              <input
                type="number"
                step="0.01"
                value={formModal.prev_year_tl}
                onChange={(e) => setFormModal({ ...formModal, prev_year_tl: e.target.value })}
                className="w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm focus:border-navy focus:outline-none"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setFormModal(null)}
              className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
            >
              İptal
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-xl bg-navy px-5 py-2 text-xs font-bold text-white hover:bg-navy-hover disabled:opacity-50"
            >
              {saving ? 'Kaydediliyor...' : 'Kaydet'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

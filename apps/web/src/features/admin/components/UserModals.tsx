'use client';

import { KeyRound, Pencil, Shield, Trash2, X } from 'lucide-react';
import { MODULE_PERMISSION_DEFS, ROLE_LABELS } from '@/core/permissions';
import {
  ApprovalStatus,
  CoreActionKey,
  Department,
  ModulePermissionKey,
  ModulePermissionSet,
  UserRole,
} from '@/types/database';
import {
  ALL_ROLES,
  APPROVAL_LABELS,
  CORE_ACTION_DEFS,
  CUSTOM_PREFIX,
  CustomRole,
  EDITABLE_MODULES,
  EditableModuleKey,
  OTHER_VALUE,
  UserRow,
} from '@/features/admin/user-helpers';

export function EditUserModal({
  target,
  currentProfileId,
  depts,
  roleOptions,
  customRoles,
  editFullName,
  setEditFullName,
  editPhone,
  setEditPhone,
  editEmail,
  setEditEmail,
  editApprovalStatus,
  setEditApprovalStatus,
  editRoleSelect,
  setEditRoleSelect,
  editCustomRoleText,
  setEditCustomRoleText,
  editDeptSelect,
  setEditDeptSelect,
  editCustomDeptText,
  setEditCustomDeptText,
  editPassword,
  setEditPassword,
  savingEdit,
  onClose,
  onSubmit,
}: {
  target: UserRow | null;
  currentProfileId?: string;
  depts: Department[];
  roleOptions: UserRole[];
  customRoles: CustomRole[];
  editFullName: string;
  setEditFullName: (v: string) => void;
  editPhone: string;
  setEditPhone: (v: string) => void;
  editEmail: string;
  setEditEmail: (v: string) => void;
  editApprovalStatus: ApprovalStatus;
  setEditApprovalStatus: (v: ApprovalStatus) => void;
  editRoleSelect: string;
  setEditRoleSelect: (v: string) => void;
  editCustomRoleText: string;
  setEditCustomRoleText: (v: string) => void;
  editDeptSelect: string;
  setEditDeptSelect: (v: string) => void;
  editCustomDeptText: string;
  setEditCustomDeptText: (v: string) => void;
  editPassword: string;
  setEditPassword: (v: string) => void;
  savingEdit: boolean;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
}) {
  if (!target) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
      <form
        onSubmit={onSubmit}
        className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl bg-white shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <h2 className="flex items-center gap-2 text-lg font-extrabold text-navy">
            <Pencil className="h-5 w-5 text-turquoise" />
            Personel Bilgileri & Şifre Düzenle
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid grid-cols-1 gap-4 overflow-y-auto p-6 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-600">Ad Soyad *</label>
            <input
              type="text"
              required
              value={editFullName}
              onChange={(e) => setEditFullName(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm focus:border-navy focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-bold text-slate-600">Telefon</label>
            <input
              type="tel"
              value={editPhone}
              onChange={(e) => setEditPhone(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm focus:border-navy focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-bold text-slate-600">E-Posta Adresi</label>
            <input
              type="email"
              value={editEmail}
              onChange={(e) => setEditEmail(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm focus:border-navy focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-bold text-slate-600">
              Hesap / Onay Durumu
            </label>
            <select
              disabled={target.id === currentProfileId}
              value={editApprovalStatus}
              onChange={(e) => setEditApprovalStatus(e.target.value as ApprovalStatus)}
              className="w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm font-medium focus:border-navy focus:outline-none disabled:opacity-60"
            >
              {(Object.keys(APPROVAL_LABELS) as ApprovalStatus[]).map((s) => (
                <option key={s} value={s}>
                  {APPROVAL_LABELS[s]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-bold text-slate-600">Rol / Ünvan</label>
            <select
              disabled={target.id === currentProfileId}
              value={editRoleSelect}
              onChange={(e) => {
                setEditRoleSelect(e.target.value);
                if (e.target.value !== OTHER_VALUE) setEditCustomRoleText('');
              }}
              className="w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm font-medium focus:border-navy focus:outline-none disabled:opacity-60"
            >
              {roleOptions.map((x) => (
                <option key={x} value={x}>
                  {ROLE_LABELS[x]}
                </option>
              ))}
              {customRoles.map((cr) => (
                <option key={cr.id} value={CUSTOM_PREFIX + cr.id}>
                  {cr.name} ({ROLE_LABELS[cr.base_role]})
                </option>
              ))}
              <option value={OTHER_VALUE}>Diğer (Manuel Giriş)</option>
            </select>
            {editRoleSelect === OTHER_VALUE && (
              <input
                type="text"
                required
                value={editCustomRoleText}
                onChange={(e) => setEditCustomRoleText(e.target.value)}
                placeholder="Özel rol / ünvan yazınız..."
                className="mt-2 w-full rounded-xl border border-navy/40 bg-navy-soft/40 px-3 py-2 text-sm focus:border-navy focus:outline-none"
              />
            )}
          </div>

          <div>
            <label className="mb-1 block text-xs font-bold text-slate-600">Departman</label>
            <select
              value={editDeptSelect}
              onChange={(e) => {
                setEditDeptSelect(e.target.value);
                if (e.target.value !== OTHER_VALUE) setEditCustomDeptText('');
              }}
              className="w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm font-medium focus:border-navy focus:outline-none"
            >
              <option value="">Departman yok</option>
              {depts.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
              <option value={OTHER_VALUE}>Diğer (Manuel Giriş)</option>
            </select>
            {editDeptSelect === OTHER_VALUE && (
              <input
                type="text"
                required
                value={editCustomDeptText}
                onChange={(e) => setEditCustomDeptText(e.target.value)}
                placeholder="Yeni departman adını yazınız..."
                className="mt-2 w-full rounded-xl border border-navy/40 bg-navy-soft/40 px-3 py-2 text-sm focus:border-navy focus:outline-none"
              />
            )}
          </div>

          <div className="space-y-2 rounded-xl border border-slate-200 bg-canvas p-4 sm:col-span-2">
            <label className="flex items-center gap-1.5 text-xs font-extrabold uppercase text-navy">
              <KeyRound className="h-3.5 w-3.5 text-turquoise" />
              Şifre Sıfırlama / Manuel Şifre Belirleme
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                type="text"
                value={editPassword}
                onChange={(e) => setEditPassword(e.target.value)}
                placeholder="Değiştirmek istemiyorsanız boş bırakın (en az 6 karakter)"
                className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-navy focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setEditPassword('123456')}
                className="shrink-0 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800 hover:bg-amber-100"
              >
                123456 Olarak Sıfırla
              </button>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 rounded-b-2xl border-t border-slate-100 bg-canvas px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
          >
            Vazgeç
          </button>
          <button
            type="submit"
            disabled={savingEdit}
            className="rounded-xl bg-navy px-5 py-2 text-xs font-bold text-white hover:bg-navy-hover disabled:opacity-50"
          >
            {savingEdit ? 'Kaydediliyor...' : 'Değişiklikleri Kaydet'}
          </button>
        </div>
      </form>
    </div>
  );
}

export function UserPermissionsModal({
  target,
  isAdmin,
  permModules,
  permCoreActions,
  savingPerm,
  onSetAllModulePerms,
  onToggleModulePerm,
  onToggleCoreAction,
  onResetToDefault,
  onSave,
  onClose,
}: {
  target: UserRow | null;
  isAdmin: boolean;
  permModules: Record<EditableModuleKey, ModulePermissionSet>;
  permCoreActions: CoreActionKey[];
  savingPerm: boolean;
  onSetAllModulePerms: (mod: EditableModuleKey, val: boolean) => void;
  onToggleModulePerm: (mod: EditableModuleKey, key: ModulePermissionKey) => void;
  onToggleCoreAction: (act: CoreActionKey) => void;
  onResetToDefault: () => void;
  onSave: () => void;
  onClose: () => void;
}) {
  if (!target) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-extrabold text-navy">
              <Shield className="h-5 w-5 text-turquoise" />
              Merkezi Modül & İşlem Yetkileri
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {target.full_name} · {target.custom_role || ROLE_LABELS[target.role]}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-6 overflow-y-auto p-6">
          <div className="space-y-4">
            <div className="text-xs font-extrabold uppercase tracking-wider text-navy">
              1. Modül Bazlı 8 Bağımsız İzin Anahtarı
            </div>

            {EDITABLE_MODULES.map((mod) => {
              const modState = permModules[mod.key];
              return (
                <div
                  key={mod.key}
                  className="rounded-2xl border border-slate-200 bg-canvas p-4"
                >
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-extrabold text-slate-900">
                        {mod.label}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-extrabold ${
                          modState.enabled
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-slate-200 text-slate-600'
                        }`}
                      >
                        {modState.enabled ? 'Aktif' : 'Kapalı'}
                      </span>
                    </div>

                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        onClick={() => onSetAllModulePerms(mod.key, true)}
                        className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-bold text-navy hover:bg-navy-soft"
                      >
                        Tümünü Seç
                      </button>
                      <button
                        type="button"
                        onClick={() => onSetAllModulePerms(mod.key, false)}
                        className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-600 hover:bg-slate-100"
                      >
                        Temizle
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {MODULE_PERMISSION_DEFS.map((def) => {
                      const checked = Boolean(modState[def.key]);
                      return (
                        <label
                          key={def.key}
                          className={`flex cursor-pointer items-center gap-2 rounded-xl border p-2.5 text-xs transition ${
                            checked
                              ? 'border-turquoise bg-white font-bold text-slate-900 shadow-sm'
                              : 'border-slate-200 bg-white/60 font-medium text-slate-600 hover:bg-white'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => onToggleModulePerm(mod.key, def.key)}
                            className="h-4 w-4 rounded border-slate-300 text-navy"
                          />
                          <span className="leading-tight">{def.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="space-y-3">
            <div className="text-xs font-extrabold uppercase tracking-wider text-navy">
              2. Çekirdek Yönetim Yetkileri (Core Actions)
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              {CORE_ACTION_DEFS.map((act) => {
                const checked = permCoreActions.includes(act.key);
                const locked = act.key === 'manage_modules' && !isAdmin;
                return (
                  <label
                    key={act.key}
                    className={`flex items-start gap-2.5 rounded-xl border p-3 transition ${
                      locked
                        ? 'cursor-not-allowed border-slate-200 bg-slate-50 opacity-60'
                        : checked
                        ? 'cursor-pointer border-navy bg-navy-soft/40'
                        : 'cursor-pointer border-slate-200 bg-white hover:bg-canvas'
                    }`}
                  >
                    <input
                      type="checkbox"
                      disabled={locked}
                      checked={checked}
                      onChange={() => onToggleCoreAction(act.key)}
                      className="mt-0.5 h-4 w-4 rounded border-slate-300 text-navy"
                    />
                    <div>
                      <div className="text-xs font-bold text-slate-900">{act.label}</div>
                      <div className="mt-0.5 text-[11px] text-slate-500">
                        {locked ? 'Yalnızca Sistem Yöneticisi verebilir.' : act.desc}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 rounded-b-2xl border-t border-slate-100 bg-canvas px-6 py-4">
          <button
            type="button"
            onClick={onResetToDefault}
            className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
          >
            Rol Varsayılanına Döndür
          </button>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
            >
              Vazgeç
            </button>
            <button
              type="button"
              disabled={savingPerm}
              onClick={onSave}
              className="rounded-xl bg-navy px-5 py-2 text-xs font-bold text-white hover:bg-navy-hover disabled:opacity-50"
            >
              {savingPerm ? 'Kaydediliyor...' : 'Yetkileri Kaydet'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function CustomRolesModal({
  open,
  customRoles,
  newCustomRoleName,
  setNewCustomRoleName,
  newCustomRoleBase,
  setNewCustomRoleBase,
  savingRole,
  onAddRole,
  onDeleteRole,
  onClose,
}: {
  open: boolean;
  customRoles: CustomRole[];
  newCustomRoleName: string;
  setNewCustomRoleName: (v: string) => void;
  newCustomRoleBase: UserRole;
  setNewCustomRoleBase: (v: UserRole) => void;
  savingRole: boolean;
  onAddRole: (e: React.FormEvent) => void;
  onDeleteRole: (cr: CustomRole) => void;
  onClose: () => void;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <h2 className="flex items-center gap-2 text-lg font-extrabold text-navy">
            <Shield className="h-5 w-5 text-turquoise" />
            Rolleri Yönet (Ekle / Çıkar)
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-5 overflow-y-auto p-6">
          <form
            onSubmit={onAddRole}
            className="space-y-3 rounded-2xl border border-slate-200 bg-canvas p-4"
          >
            <div className="text-xs font-extrabold uppercase text-navy">
              Yeni Özel Rol / Ünvan Ekle
            </div>
            <input
              type="text"
              required
              value={newCustomRoleName}
              onChange={(e) => setNewCustomRoleName(e.target.value)}
              placeholder="Rol adı (örn: Vardiya Amiri, Danışma, Güvenlik Şefi)"
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-navy focus:outline-none"
            />
            <div className="flex gap-2">
              <select
                value={newCustomRoleBase}
                onChange={(e) => setNewCustomRoleBase(e.target.value as UserRole)}
                className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-navy focus:outline-none"
              >
                <option value="employee">Temel Yetki: AVM Personeli</option>
                <option value="technician">Temel Yetki: Teknik Personel</option>
                <option value="team_lead">Temel Yetki: Ekip Sorumlusu</option>
                <option value="technical_manager">Temel Yetki: Teknik Yönetici</option>
              </select>
              <button
                type="submit"
                disabled={savingRole}
                className="rounded-xl bg-navy px-4 py-2 text-xs font-bold text-white hover:bg-navy-hover disabled:opacity-50"
              >
                {savingRole ? 'Ekleniyor...' : 'Ekle'}
              </button>
            </div>
          </form>

          <div>
            <div className="mb-2 text-xs font-extrabold uppercase text-slate-500">
              Eklenen Özel Roller
            </div>
            {customRoles.length === 0 ? (
              <p className="text-xs text-slate-400">Henüz özel rol eklenmemiş.</p>
            ) : (
              <div className="space-y-2">
                {customRoles.map((cr) => (
                  <div
                    key={cr.id}
                    className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-3 text-sm"
                  >
                    <div>
                      <span className="font-bold text-slate-800">{cr.name}</span>
                      <span className="ml-2 text-xs text-slate-500">
                        ({ROLE_LABELS[cr.base_role]})
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => onDeleteRole(cr)}
                      className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-bold text-red-700 hover:bg-red-100"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Çıkar
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="mb-2 text-xs font-extrabold uppercase text-slate-500">
              Sabit Sistem Rolleri
            </div>
            <div className="flex flex-wrap gap-1.5">
              {ALL_ROLES.map((r) => (
                <span
                  key={r}
                  className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700"
                >
                  {ROLE_LABELS[r]}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

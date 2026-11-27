import {
  defaultModulePermission,
  MODULE_PERMISSION_DEFS,
} from '@/core/permissions';
import {
  ApprovalStatus,
  CoreActionKey,
  ModulePermissionKey,
  ModulePermissionSet,
  Profile,
  UserPermissionsJson,
  UserRole,
} from '@/types/database';

export type UserRow = Profile & {
  departments?: { name: string } | null;
};

export type CustomRole = {
  id: string;
  name: string;
  base_role: UserRole;
};

export const ALL_ROLES: UserRole[] = [
  'employee',
  'technician',
  'team_lead',
  'technical_manager',
  'system_admin',
];

export const APPROVAL_LABELS: Record<ApprovalStatus, string> = {
  approved: 'Onaylı',
  pending: 'Onay Bekliyor',
  rejected: 'Reddedildi',
  disabled: 'Pasif',
};

export const CORE_ACTION_DEFS: {
  key: CoreActionKey;
  label: string;
  desc: string;
}[] = [
  {
    key: 'manage_users',
    label: 'Personel Onay & Yönetimi',
    desc: 'Bekleyen kayıtları onaylar, yeni personel ekler ve bilgileri düzenler.',
  },
  {
    key: 'manage_definitions',
    label: 'Kat / Mahal / Kategori Yönetimi',
    desc: 'Departman, kat, mahal ve arıza kategorilerini tanımlar.',
  },
  {
    key: 'manage_equipments',
    label: 'Ortak Ekipman Envanteri',
    desc: 'Teknik ekipman ekler, günceller ve modüller arası eşler.',
  },
  {
    key: 'manage_modules',
    label: 'Sistem Modül Yönetimi',
    desc: 'Platform modüllerini açıp kapatma yetkisi (Sistem Yöneticisi).',
  },
];

export type EditableModuleKey =
  | 'energy'
  | 'work_tracking'
  | 'maintenance'
  | 'inventory'
  | 'shifts'
  | 'contracts';

export const EDITABLE_MODULES: { key: EditableModuleKey; label: string }[] = [
  { key: 'energy', label: 'Enerji Takip Modülü' },
  { key: 'work_tracking', label: 'İş Takip Modülü' },
  { key: 'maintenance', label: 'Planlı Bakım & Checklist' },
  { key: 'inventory', label: 'Yedek Parça & Stok' },
  { key: 'shifts', label: 'Vardiya Devir Defteri' },
  { key: 'contracts', label: 'Dış Servis & Sözleşmeler' },
];

export const OTHER_VALUE = '__other__';
export const CUSTOM_PREFIX = 'custom:';

export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'AT';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function buildModuleMapForRole(
  role: UserRole,
  existing?: UserPermissionsJson
): Record<EditableModuleKey, Record<ModulePermissionKey, boolean>> {
  const result = {} as Record<
    EditableModuleKey,
    Record<ModulePermissionKey, boolean>
  >;

  for (const mod of EDITABLE_MODULES) {
    const modPerms = {} as Record<ModulePermissionKey, boolean>;
    const customMod: ModulePermissionSet | undefined = existing?.modules?.[mod.key];
    for (const def of MODULE_PERMISSION_DEFS) {
      if (role === 'system_admin') {
        modPerms[def.key] = true;
      } else if (customMod && customMod.enabled === false) {
        modPerms[def.key] = false;
      } else if (customMod && typeof customMod[def.key] === 'boolean') {
        modPerms[def.key] = Boolean(customMod[def.key]);
      } else {
        modPerms[def.key] = defaultModulePermission(role, mod.key, def.key);
      }
    }
    result[mod.key] = modPerms;
  }
  return result;
}

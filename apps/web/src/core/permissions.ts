import {
  CoreActionKey,
  ModulePermissionKey,
  Profile,
  UserRole,
} from '@/types/database';

export const MODULE_PERMISSION_DEFS: {
  key: ModulePermissionKey;
  label: string;
}[] = [
  { key: 'enabled', label: 'Modül Görüntüleme' },
  { key: 'view', label: 'Kayıt Görüntüleme' },
  { key: 'create', label: 'Kayıt Ekleme' },
  { key: 'edit', label: 'Kayıt Düzenleme' },
  { key: 'delete', label: 'Kayıt Silme' },
  { key: 'approve', label: 'Onaylama' },
  { key: 'reports', label: 'Raporlama' },
  { key: 'manage', label: 'Yönetim İşlemleri' },
];

export const ROLE_LABELS: Record<UserRole, string> = {
  employee: 'AVM Personeli',
  technician: 'Teknik Personel',
  team_lead: 'Ekip Sorumlusu',
  technical_manager: 'Teknik Yönetici',
  system_admin: 'Sistem Yöneticisi',
};

export function defaultModulePermission(
  role: UserRole,
  moduleKey: string,
  perm: ModulePermissionKey
): boolean {
  if (role === 'system_admin') return true;

  if (moduleKey === 'work_tracking') {
    if (role === 'technical_manager' || role === 'team_lead') {
      return perm !== 'delete';
    }
    if (role === 'technician') {
      return ['enabled', 'view', 'create', 'edit'].includes(perm);
    }
    if (role === 'employee') {
      return ['enabled', 'view', 'create', 'approve'].includes(perm);
    }
    return false;
  }

  if (moduleKey === 'energy') {
    if (role === 'technical_manager') return true;
    if (role === 'team_lead') {
      return ['enabled', 'view', 'create', 'edit', 'reports'].includes(perm);
    }
    if (role === 'technician') {
      return ['enabled', 'view', 'create'].includes(perm);
    }
    return false;
  }

  if (role === 'technical_manager') {
    return ['enabled', 'view', 'reports'].includes(perm);
  }
  return false;
}

export function hasModulePermission(
  profile: Profile | null | undefined,
  moduleKey: string,
  perm: ModulePermissionKey
): boolean {
  if (!profile || profile.approval_status !== 'approved') return false;
  if (profile.role === 'system_admin') return true;

  const customMod = profile.permissions?.modules?.[moduleKey];
  if (customMod) {
    if (customMod.enabled === false) return false;
    if (typeof customMod[perm] === 'boolean') return Boolean(customMod[perm]);
  }

  return defaultModulePermission(profile.role, moduleKey, perm);
}

export function hasCoreAction(
  profile: Profile | null | undefined,
  action: CoreActionKey
): boolean {
  if (!profile || profile.approval_status !== 'approved') return false;
  if (profile.role === 'system_admin') return true;
  return Boolean(profile.permissions?.core_actions?.includes(action));
}

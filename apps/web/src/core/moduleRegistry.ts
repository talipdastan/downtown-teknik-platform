import { ModulePermissionKey, Profile, SystemModule } from '@/types/database';
import { hasCoreAction, hasModulePermission } from './permissions';

export interface WebModuleNavItem {
  label: string;
  href: string;
  /// Bu alt sayfanın görünmesi ve açılabilmesi için ilgili modülde
  /// belirtilen izinlerden en az birinin açık olması gerekir.
  requiredAnyPerms?: ModulePermissionKey[];
}

export interface WebModuleDefinition {
  key: string;
  name: string;
  description: string;
  routePrefix: string;
  sortOrder: number;
  isComingSoon?: boolean;
  navItems: WebModuleNavItem[];
}

/// Sade ve genişletilebilir Web Modül Kayıt Listesi.
export const WEB_MODULES: WebModuleDefinition[] = [
  {
    key: 'energy',
    name: 'Enerji Takip',
    description: 'Sayaçlar, okumalar, faturalar, bütçe ve enerji raporları',
    routePrefix: '/energy',
    sortOrder: 1,
    navItems: [
      { label: 'Enerji Özeti', href: '/energy', requiredAnyPerms: ['enabled', 'view'] },
      { label: 'Sayaç Yönetimi', href: '/energy/meters', requiredAnyPerms: ['view', 'manage'] },
      { label: 'Okuma Geçmişi', href: '/energy/readings', requiredAnyPerms: ['view', 'create'] },
      {
        label: 'Faturalar & PDF Analiz',
        href: '/energy/invoices',
        requiredAnyPerms: ['reports', 'manage'],
      },
      {
        label: 'Bütçe & Karşılaştırma',
        href: '/energy/budgets',
        requiredAnyPerms: ['reports', 'manage'],
      },
    ],
  },
  {
    key: 'work_tracking',
    name: 'İş Takip',
    description: 'Arıza, iş emirleri, teknisyenler, fotoğraflar ve onaylar',
    routePrefix: '/work-tracking',
    sortOrder: 2,
    navItems: [
      {
        label: 'Genel Bakış & Özet',
        href: '/work-tracking',
        requiredAnyPerms: ['enabled', 'view'],
      },
      {
        label: 'Arıza Kayıtları',
        href: '/work-tracking/tickets',
        requiredAnyPerms: ['view', 'create'],
      },
      {
        label: 'İş Emirleri',
        href: '/work-tracking/work-orders',
        requiredAnyPerms: ['edit', 'manage', 'reports'],
      },
      {
        label: 'Çözüm Onay & İade',
        href: '/work-tracking/review',
        requiredAnyPerms: ['approve'],
      },
      {
        label: 'Raporlar',
        href: '/work-tracking/reports',
        requiredAnyPerms: ['reports'],
      },
    ],
  },
  {
    key: 'maintenance',
    name: 'Planlı Bakım',
    description: 'Periyodik bakım, bakım takvimi ve kontrol listeleri',
    routePrefix: '/maintenance',
    sortOrder: 3,
    isComingSoon: true,
    navItems: [],
  },
  {
    key: 'assets',
    name: 'Demirbaş & Ekipman',
    description: 'Ekipman envanteri, garanti ve teknik geçmiş',
    routePrefix: '/assets',
    sortOrder: 4,
    isComingSoon: true,
    navItems: [],
  },
];

function isModuleVisibleWithServerMap(
  profile: Profile | null | undefined,
  mod: WebModuleDefinition,
  serverMap: Map<string, SystemModule>
): boolean {
  if (!profile || profile.approval_status !== 'approved') return false;

  const server = serverMap.get(mod.key);
  const isComingSoon = server ? server.is_coming_soon : Boolean(mod.isComingSoon);
  const isEnabled = server ? server.is_enabled : !mod.isComingSoon;

  if (isComingSoon) return profile.role === 'system_admin';
  if (!isEnabled && profile.role !== 'system_admin') return false;
  return hasModulePermission(profile, mod.key, 'enabled');
}

export function getVisibleWebModules(
  profile: Profile | null | undefined,
  serverModules?: SystemModule[]
): WebModuleDefinition[] {
  if (!profile || profile.approval_status !== 'approved') return [];

  const serverMap = new Map(serverModules?.map((m) => [m.key, m]) ?? []);

  return [...WEB_MODULES]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .filter((mod) => isModuleVisibleWithServerMap(profile, mod, serverMap));
}

export function getVisibleNavItems(
  profile: Profile | null | undefined,
  mod: WebModuleDefinition
): WebModuleNavItem[] {
  if (!profile || profile.approval_status !== 'approved') return [];
  if (profile.role === 'system_admin') return mod.navItems;
  if (!hasModulePermission(profile, mod.key, 'enabled')) return [];

  return mod.navItems.filter((item) => {
    if (!item.requiredAnyPerms || item.requiredAnyPerms.length === 0) return true;
    return item.requiredAnyPerms.some((perm) =>
      hasModulePermission(profile, mod.key, perm)
    );
  });
}

function normalizePath(pathname: string): string {
  if (!pathname || pathname === '/') return '/';
  return pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
}

export function canAccessDashboardPath(
  profile: Profile | null | undefined,
  pathname: string,
  serverModules?: SystemModule[]
): boolean {
  if (!profile || profile.approval_status !== 'approved') return false;

  const clean = normalizePath(pathname);
  if (clean === '/home' || clean === '/') return true;

  if (clean.startsWith('/admin/users')) {
    return (
      profile.role === 'system_admin' ||
      hasCoreAction(profile, 'manage_users') ||
      profile.role === 'technical_manager' ||
      profile.role === 'team_lead'
    );
  }
  if (clean.startsWith('/admin/modules')) {
    return (
      profile.role === 'system_admin' || hasCoreAction(profile, 'manage_modules')
    );
  }
  if (clean.startsWith('/admin/equipments')) {
    return (
      profile.role === 'system_admin' ||
      hasCoreAction(profile, 'manage_equipments') ||
      profile.role === 'technical_manager' ||
      profile.role === 'team_lead'
    );
  }
  if (clean.startsWith('/admin/definitions')) {
    return (
      profile.role === 'system_admin' ||
      hasCoreAction(profile, 'manage_definitions')
    );
  }

  const serverMap = new Map(serverModules?.map((m) => [m.key, m]) ?? []);
  const matchedMod = WEB_MODULES.find(
    (m) => clean === m.routePrefix || clean.startsWith(`${m.routePrefix}/`)
  );
  if (!matchedMod) return profile.role === 'system_admin';

  if (!isModuleVisibleWithServerMap(profile, matchedMod, serverMap)) {
    return false;
  }

  if (profile.role === 'system_admin') return true;

  const matchedNav = matchedMod.navItems.find((item) => clean === item.href);
  if (matchedNav?.requiredAnyPerms && matchedNav.requiredAnyPerms.length > 0) {
    return matchedNav.requiredAnyPerms.some((perm) =>
      hasModulePermission(profile, matchedMod.key, perm)
    );
  }

  return true;
}

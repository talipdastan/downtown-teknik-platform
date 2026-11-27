'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Bell,
  BookOpen,
  Boxes,
  CheckCheck,
  ClipboardCheck,
  Cpu,
  FileSignature,
  LayoutGrid,
  LogOut,
  Menu,
  Package,
  SlidersHorizontal,
  Users,
  Wrench,
  X,
  Zap,
} from 'lucide-react';
import { createClient } from '@/core/supabase/client';
import { formatDateTime } from '@/core/constants';
import {
  AccessDeniedCard,
  DashboardProvider,
} from '@/core/DashboardContext';
import {
  canAccessDashboardPath,
  getVisibleNavItems,
  getVisibleWebModules,
} from '@/core/moduleRegistry';
import { ROLE_LABELS } from '@/core/permissions';
import { Profile, SystemModule } from '@/types/database';

type NotificationItem = {
  id: string;
  user_id: string;
  module_key: string;
  entity_type: string | null;
  entity_id: string | null;
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
};

const CORE_ADMIN_NAV = [
  { href: '/admin/users', label: 'Personel & Yetkiler', icon: Users },
  { href: '/admin/modules', label: 'Modül Yönetimi', icon: Boxes },
  { href: '/admin/equipments', label: 'Ortak Ekipmanlar', icon: Cpu },
  {
    href: '/admin/definitions',
    label: 'Kat / Mahal / Kategori',
    icon: SlidersHorizontal,
  },
];

function getInitials(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return 'AT';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function moduleBadgeLabel(key: string): string {
  if (key === 'energy') return 'Enerji';
  if (key === 'work_tracking') return 'İş Takip';
  if (key === 'maintenance') return 'Planlı Bakım';
  if (key === 'inventory') return 'Stok';
  if (key === 'shifts') return 'Vardiya';
  if (key === 'contracts') return 'Sözleşme';
  return 'Sistem';
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [serverModules, setServerModules] = useState<SystemModule[]>([]);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Canlı Bildirim Zili
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [notifOpen, setNotifOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement | null>(null);

  const refreshProfile = useCallback(async () => {
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const [profRes, modRes] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', user.id).single(),
        supabase.from('system_modules').select('*').order('sort_order').order('key'),
      ]);
      if (profRes.data) setProfile(profRes.data as Profile);
      if (modRes.data) setServerModules(modRes.data as SystemModule[]);
    } catch {
      // Yapılandırma yoksa sessiz geç
    }
  }, []);

  useEffect(() => {
    let active = true;
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;

    async function loadUserAndNotifications() {
      setLoadingProfile(true);
      try {
        const {
          data: { user },
          error: userErr,
        } = await supabase.auth.getUser();
        if (!active) return;

        if (!userErr && !user) {
          setProfile(null);
          setLoadingProfile(false);
          router.replace('/login');
          return;
        }
        if (!user) {
          setLoadingProfile(false);
          return;
        }

        setUserId(user.id);

        const [profRes, modRes, notifRes] = await Promise.all([
          supabase.from('profiles').select('*').eq('id', user.id).single(),
          supabase.from('system_modules').select('*').order('sort_order').order('key'),
          supabase
            .from('notifications')
            .select('*')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false })
            .limit(25),
        ]);

        if (!active) return;

        const loadedProfile = (profRes.data as Profile | null) ?? null;
        if (loadedProfile) {
          setProfile(loadedProfile);
          if (loadedProfile.approval_status !== 'approved') {
            router.replace('/pending');
          }
        }
        if (modRes.data) {
          setServerModules(modRes.data as SystemModule[]);
        }
        if (notifRes.data) {
          setNotifications(notifRes.data as NotificationItem[]);
        }

        channel = supabase
          .channel(`user-notifications-${user.id}`)
          .on(
            'postgres_changes',
            {
              event: 'INSERT',
              schema: 'public',
              table: 'notifications',
              filter: `user_id=eq.${user.id}`,
            },
            (payload) => {
              const incoming = payload.new as NotificationItem;
              setNotifications((prev) => {
                if (prev.some((n) => n.id === incoming.id)) return prev;
                return [incoming, ...prev].slice(0, 25);
              });
            }
          )
          .subscribe();
      } catch {
        // Yapılandırma yoksa sessiz geç
      } finally {
        if (active) setLoadingProfile(false);
      }
    }

    loadUserAndNotifications();
    return () => {
      active = false;
      if (channel) {
        supabase.removeChannel(channel);
      }
    };
  }, [router]);

  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
    }
    if (notifOpen) {
      document.addEventListener('mousedown', handleOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleOutside);
    };
  }, [notifOpen]);

  async function markNotificationRead(item: NotificationItem) {
    if (!item.is_read) {
      setNotifications((prev) =>
        prev.map((n) => (n.id === item.id ? { ...n, is_read: true } : n))
      );
      try {
        const supabase = createClient();
        await supabase
          .from('notifications')
          .update({ is_read: true })
          .eq('id', item.id);
      } catch {
        // ignore
      }
    }
    setNotifOpen(false);
    if (item.entity_type === 'profile') {
      if (canAccessDashboardPath(profile, '/admin/users', serverModules)) {
        router.push('/admin/users');
      } else {
        router.push('/home');
      }
    } else if (item.module_key === 'work_tracking') {
      if (canAccessDashboardPath(profile, '/work-tracking/tickets', serverModules)) {
        router.push('/work-tracking/tickets');
      } else {
        router.push('/home');
      }
    } else if (item.module_key === 'energy') {
      if (canAccessDashboardPath(profile, '/energy', serverModules)) {
        router.push('/energy');
      } else {
        router.push('/home');
      }
    }
  }

  async function markAllRead() {
    if (!userId) return;
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    try {
      const supabase = createClient();
      await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('user_id', userId)
        .eq('is_read', false);
    } catch {
      // ignore
    }
  }

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
  }

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  const visibleSidebarModules = useMemo(
    () =>
      getVisibleWebModules(profile, serverModules).filter((m) => !m.isComingSoon),
    [profile, serverModules]
  );

  const visibleAdminLinks = useMemo(
    () =>
      CORE_ADMIN_NAV.filter((item) =>
        canAccessDashboardPath(profile, item.href, serverModules)
      ),
    [profile, serverModules]
  );

  const canAccessCurrentRoute = useMemo(() => {
    if (!profile) return false;
    return canAccessDashboardPath(profile, pathname, serverModules);
  }, [profile, pathname, serverModules]);

  const displayName = (profile?.full_name || 'DOWNTOWN TEKNİK').toUpperCase();
  const displayTitle = (
    profile?.custom_role?.trim() ||
    (profile?.role ? ROLE_LABELS[profile.role] : 'TEKNİK OPERASYON PANELİ')
  ).toUpperCase();

  const moduleIcon = (key: string) => {
    if (key === 'energy') return <Zap className="h-4 w-4" />;
    if (key === 'maintenance') return <ClipboardCheck className="h-4 w-4" />;
    if (key === 'inventory') return <Package className="h-4 w-4" />;
    if (key === 'shifts') return <BookOpen className="h-4 w-4" />;
    if (key === 'contracts') return <FileSignature className="h-4 w-4" />;
    return <Wrench className="h-4 w-4" />;
  };

  const sidebarContent = (
    <div className="flex h-full flex-col border-r border-slate-200 bg-white">
      {/* Marka Başlığı */}
      <div className="flex h-16 items-center gap-3 border-b border-slate-200 px-4">
        <img
          src="/downtown-teknik-icon.png"
          alt="Downtown Teknik"
          className="h-10 w-10 shrink-0 rounded-xl border border-slate-100 bg-white object-contain p-0.5 shadow-sm"
        />
        <div className="min-w-0">
          <div className="truncate text-sm font-extrabold tracking-wide text-navy">
            DOWNTOWN TEKNİK
          </div>
          <div className="truncate text-[10.5px] font-semibold tracking-wider text-slate-500">
            TEKNİK OPERASYON
          </div>
        </div>
      </div>

      {/* Menü */}
      <nav className="flex-1 space-y-5 overflow-y-auto p-3 text-sm">
        <div>
          <div className="mb-1.5 px-2.5 text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
            Platform
          </div>
          <Link
            href="/home"
            onClick={() => setMobileMenuOpen(false)}
            className={`flex items-center gap-2.5 rounded-xl px-3 py-2 font-semibold transition ${
              pathname === '/home'
                ? 'bg-navy-soft text-navy'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            <LayoutGrid className="h-4 w-4" />
            <span>Modül Seçimi</span>
          </Link>
        </div>

        {visibleSidebarModules.length > 0 && (
          <div>
            <div className="mb-1.5 px-2.5 text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
              Aktif Modüller
            </div>
            <div className="space-y-1">
              {visibleSidebarModules.map((mod) => {
                const isActive = pathname.startsWith(mod.routePrefix);
                const navItems = getVisibleNavItems(profile, mod);
                return (
                  <div key={mod.key} className="space-y-0.5">
                    <Link
                      href={mod.routePrefix}
                      onClick={() => setMobileMenuOpen(false)}
                      className={`flex items-center gap-2.5 rounded-xl px-3 py-2 font-semibold transition ${
                        isActive
                          ? 'bg-navy-soft text-navy'
                          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                      }`}
                    >
                      <span className={isActive ? 'text-turquoise' : 'text-slate-400'}>
                        {moduleIcon(mod.key)}
                      </span>
                      <span>{mod.name}</span>
                    </Link>
                    {isActive && navItems.length > 0 && (
                      <div className="ml-4 space-y-0.5 border-l-2 border-slate-200 pl-2.5">
                        {navItems.map((item) => {
                          const subActive = pathname === item.href;
                          return (
                            <Link
                              key={item.href}
                              href={item.href}
                              onClick={() => setMobileMenuOpen(false)}
                              className={`block rounded-lg px-2.5 py-1.5 text-xs transition ${
                                subActive
                                  ? 'bg-turquoise-soft/70 font-bold text-turquoise'
                                  : 'font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-900'
                              }`}
                            >
                              {item.label}
                            </Link>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {visibleAdminLinks.length > 0 && (
          <div>
            <div className="mb-1.5 px-2.5 text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
              Çekirdek Yönetim
            </div>
            <div className="space-y-1">
              {visibleAdminLinks.map((item) => {
                const Icon = item.icon;
                const active = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className={`flex items-center gap-2.5 rounded-xl px-3 py-2 font-semibold transition ${
                      active
                        ? 'bg-navy-soft text-navy'
                        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                    }`}
                  >
                    <Icon
                      className={`h-4 w-4 ${active ? 'text-turquoise' : 'text-slate-400'}`}
                    />
                    <span className="truncate">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        )}
      </nav>

      <div className="border-t border-slate-200 p-3 space-y-2">
        <Link
          href="/download"
          onClick={() => setMobileMenuOpen(false)}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-turquoise/40 bg-turquoise-soft/50 px-3 py-2 text-xs font-extrabold text-turquoise transition hover:bg-turquoise-soft"
        >
          <span>📱 Mobil Uygulama (APK / PWA)</span>
        </Link>
        <button
          onClick={handleSignOut}
          className="flex w-full items-center gap-2.5 rounded-xl border border-red-200 bg-red-50/70 px-3 py-2 text-xs font-bold text-red-700 transition hover:bg-red-100"
        >
          <LogOut className="h-4 w-4" />
          <span>Oturumu Kapat</span>
        </button>
      </div>
    </div>
  );

  const authValue = useMemo(
    () => ({ profile, serverModules, loadingProfile, refreshProfile }),
    [profile, serverModules, loadingProfile, refreshProfile]
  );

  return (
    <div className="flex min-h-screen bg-canvas">
      {/* Masaüstü Sol Menü */}
      <aside className="hidden w-64 shrink-0 lg:block">{sidebarContent}</aside>

      {/* Mobil / Tablet Çekmece Menü */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div className="w-64 shrink-0 shadow-2xl">{sidebarContent}</div>
          <div
            className="flex-1 bg-slate-900/40"
            onClick={() => setMobileMenuOpen(false)}
          />
        </div>
      )}

      {/* Sağ Ana İçerik */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Tasarım B – En Üstte İsim Soy İsim + Ünvan Gösteren Saf Beyaz Üst Bar */}
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 lg:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileMenuOpen((v) => !v)}
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-canvas text-navy lg:hidden"
              aria-label="Menü"
            >
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-navy to-navy-hover text-xs font-extrabold text-white">
              {getInitials(profile?.full_name || 'DOWNTOWN TEKNİK')}
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-extrabold tracking-tight text-slate-900">
                {displayName}
              </div>
              <div className="truncate text-[11px] font-semibold tracking-wide text-slate-500">
                {displayTitle}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Canlı Bildirim Zili */}
            <div ref={notifRef} className="relative">
              <button
                type="button"
                onClick={() => setNotifOpen((v) => !v)}
                aria-label="Bildirimler"
                className="relative flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-canvas text-navy transition hover:bg-navy-soft"
              >
                <Bell className="h-4 w-4" />
                {unreadCount > 0 && (
                  <span className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-extrabold text-white">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </button>

              {notifOpen && (
                <div className="absolute right-0 mt-2 w-80 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl sm:w-96">
                  <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                    <div>
                      <div className="text-xs font-extrabold uppercase tracking-wider text-navy">
                        Bildirimler
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {unreadCount > 0
                          ? `${unreadCount} okunmamış bildirim`
                          : 'Tüm bildirimler okundu'}
                      </div>
                    </div>
                    {unreadCount > 0 && (
                      <button
                        type="button"
                        onClick={markAllRead}
                        className="inline-flex items-center gap-1 rounded-lg bg-navy-soft px-2.5 py-1 text-[11px] font-bold text-navy hover:bg-navy hover:text-white"
                      >
                        <CheckCheck className="h-3.5 w-3.5" />
                        Tümünü Okundu İşaretle
                      </button>
                    )}
                  </div>

                  <div className="max-h-96 divide-y divide-slate-100 overflow-y-auto">
                    {notifications.length === 0 ? (
                      <div className="px-4 py-8 text-center text-xs text-slate-400">
                        Henüz bildirim bulunmuyor.
                      </div>
                    ) : (
                      notifications.map((n) => (
                        <button
                          key={n.id}
                          type="button"
                          onClick={() => markNotificationRead(n)}
                          className={`block w-full px-4 py-3 text-left transition hover:bg-canvas ${
                            n.is_read ? 'bg-white' : 'bg-navy-soft/35'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span
                              className={`rounded-md px-1.5 py-0.5 text-[10px] font-extrabold ${
                                n.module_key === 'energy'
                                  ? 'bg-amber-100 text-amber-800'
                                  : n.module_key === 'work_tracking'
                                  ? 'bg-sky-100 text-sky-800'
                                  : 'bg-slate-100 text-slate-700'
                              }`}
                            >
                              {moduleBadgeLabel(n.module_key)}
                            </span>
                            <span className="text-[10px] text-slate-400">
                              {formatDateTime(n.created_at)}
                            </span>
                          </div>
                          <div className="mt-1 flex items-center gap-1.5 text-xs font-extrabold text-slate-900">
                            {!n.is_read && (
                              <span className="h-2 w-2 shrink-0 rounded-full bg-turquoise" />
                            )}
                            <span className="truncate">{n.title}</span>
                          </div>
                          <p className="mt-0.5 line-clamp-2 text-xs text-slate-600">
                            {n.message}
                          </p>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            <span className="hidden rounded-xl bg-turquoise-soft px-3 py-1.5 text-xs font-bold text-turquoise sm:inline-flex">
              ● Downtown Teknik Canlı
            </span>
            <button
              type="button"
              onClick={handleSignOut}
              title="Oturumu Kapat"
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-canvas text-red-600 transition hover:bg-red-50"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </header>

        <DashboardProvider value={authValue}>
          <main className="flex-1 p-4 lg:p-6">
            {loadingProfile ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
                Oturum ve yetkiler doğrulanıyor...
              </div>
            ) : !profile ? (
              <AccessDeniedCard message="Oturum doğrulanamadı. Giriş sayfasına yönlendiriliyorsunuz..." />
            ) : profile.approval_status !== 'approved' ? (
              <AccessDeniedCard message="Hesabınız onay bekliyor veya erişime kapatılmış durumda." />
            ) : !canAccessCurrentRoute ? (
              <AccessDeniedCard />
            ) : (
              children
            )}
          </main>
        </DashboardProvider>
      </div>
    </div>
  );
}

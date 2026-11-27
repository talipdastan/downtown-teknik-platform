'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  BookOpen,
  CalendarClock,
  FileSignature,
  Package,
  ShieldAlert,
  Users,
  Wrench,
  Zap,
} from 'lucide-react';
import { useDashboardAuth } from '@/core/DashboardContext';
import {
  canAccessDashboardPath,
  getVisibleWebModules,
} from '@/core/moduleRegistry';

function getModuleVisual(key: string) {
  switch (key) {
    case 'energy':
      return {
        icon: Zap,
        iconBg: 'bg-turquoise-soft text-turquoise',
        btn: 'bg-turquoise hover:bg-cyan-800',
      };
    case 'work_tracking':
      return {
        icon: Wrench,
        iconBg: 'bg-navy-soft text-navy',
        btn: 'bg-navy hover:bg-navy-hover',
      };
    case 'maintenance':
      return {
        icon: CalendarClock,
        iconBg: 'bg-sky-50 text-sky-700',
        btn: 'bg-navy hover:bg-navy-hover',
      };
    case 'inventory':
      return {
        icon: Package,
        iconBg: 'bg-emerald-50 text-emerald-700',
        btn: 'bg-navy hover:bg-navy-hover',
      };
    case 'shifts':
      return {
        icon: BookOpen,
        iconBg: 'bg-amber-50 text-amber-800',
        btn: 'bg-navy hover:bg-navy-hover',
      };
    case 'contracts':
      return {
        icon: FileSignature,
        iconBg: 'bg-indigo-50 text-indigo-700',
        btn: 'bg-navy hover:bg-navy-hover',
      };
    default:
      return {
        icon: Package,
        iconBg: 'bg-slate-100 text-slate-500',
        btn: 'bg-navy hover:bg-navy-hover',
      };
  }
}

export default function HomePage() {
  const { profile, serverModules, loadingProfile } = useDashboardAuth();

  const visibleModules = useMemo(
    () => getVisibleWebModules(profile, serverModules),
    [profile, serverModules]
  );

  const serverModuleMap = useMemo(
    () => new Map(serverModules.map((m) => [m.key, m])),
    [serverModules]
  );

  const canSeeUsersCard = useMemo(
    () => canAccessDashboardPath(profile, '/admin/users', serverModules),
    [profile, serverModules]
  );

  return (
    <div className="space-y-6">
      <div>
        <div className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400">
          PLATFORM MODÜLLERİ
        </div>
        <h1 className="mt-1 text-2xl font-extrabold text-slate-900">
          Modül Seçimi
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Tek kullanıcı, tek giriş ve tek veritabanı altında yetkili olduğunuz teknik modüller.
        </p>
      </div>

      {!loadingProfile && visibleModules.length === 0 && !canSeeUsersCard ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
            <div>
              <div className="font-extrabold">Henüz Aktif Modül Yetkiniz Bulunmuyor</div>
              <p className="mt-1 text-xs leading-relaxed">
                Hesabınız için tanımlı aktif bir operasyon modülü bulunamadı. Yetki tanımlaması
                için Sistem Yöneticinizle iletişime geçiniz.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {visibleModules.map((mod) => {
            const vis = getModuleVisual(mod.key);
            const Icon = vis.icon;
            const serverMod = serverModuleMap.get(mod.key);
            const isComingSoon = serverMod
              ? serverMod.is_coming_soon
              : Boolean(mod.isComingSoon);
            const isEnabled = serverMod ? serverMod.is_enabled : !mod.isComingSoon;

            return (
              <div
                key={mod.key}
                className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-5 transition hover:border-slate-300 hover:shadow-sm"
              >
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <div
                      className={`flex h-11 w-11 items-center justify-center rounded-xl ${
                        isComingSoon ? 'bg-slate-100 text-slate-400' : vis.iconBg
                      }`}
                    >
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="flex items-center gap-1.5">
                      {!isEnabled && (
                        <span className="rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-[11px] font-bold text-red-700">
                          Pasif
                        </span>
                      )}
                      {isComingSoon && (
                        <span className="rounded-full border border-slate-200 bg-canvas px-2.5 py-0.5 text-[11px] font-bold text-slate-500">
                          Yakında
                        </span>
                      )}
                    </div>
                  </div>
                  <h2
                    className={`mt-4 text-base font-extrabold ${
                      isComingSoon ? 'text-slate-500' : 'text-slate-900'
                    }`}
                  >
                    {serverMod?.name || mod.name}
                  </h2>
                  <p className="mt-1 text-xs leading-relaxed text-slate-500">
                    {serverMod?.description || mod.description}
                  </p>
                </div>
                <div className="mt-5">
                  {isComingSoon ? (
                    <span className="text-xs font-medium text-slate-400">
                      Gelecek sürüm için mimari hazır
                    </span>
                  ) : (
                    <Link
                      href={mod.routePrefix}
                      className={`inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold text-white transition ${vis.btn}`}
                    >
                      <span>Modülü Aç</span>
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  )}
                </div>
              </div>
            );
          })}

          {canSeeUsersCard && (
            <div className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-5 transition hover:border-slate-300 hover:shadow-sm">
              <div>
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-navy-soft text-navy">
                  <Users className="h-5 w-5" />
                </div>
                <h2 className="mt-4 text-base font-extrabold text-slate-900">
                  Personel & Yetkiler
                </h2>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">
                  Yeni kayıt onayları, sistem rolleri, departman ataması ve modül bazlı izin
                  yönetimi.
                </p>
              </div>
              <div className="mt-5">
                <Link
                  href="/admin/users"
                  className="inline-flex items-center gap-1.5 rounded-xl bg-navy px-4 py-2 text-xs font-bold text-white transition hover:bg-navy-hover"
                >
                  <span>Yönetime Git</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

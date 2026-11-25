'use client';

import { createContext, useContext } from 'react';
import Link from 'next/link';
import { ShieldAlert } from 'lucide-react';
import { Profile, SystemModule } from '@/types/database';

export interface DashboardAuthContextValue {
  profile: Profile | null;
  serverModules: SystemModule[];
  loadingProfile: boolean;
  refreshProfile: () => Promise<void>;
}

export const DashboardAuthContext = createContext<DashboardAuthContextValue>({
  profile: null,
  serverModules: [],
  loadingProfile: true,
  refreshProfile: async () => {},
});

export function DashboardProvider({
  value,
  children,
}: {
  value: DashboardAuthContextValue;
  children: React.ReactNode;
}) {
  return (
    <DashboardAuthContext.Provider value={value}>
      {children}
    </DashboardAuthContext.Provider>
  );
}

export function useDashboardAuth(): DashboardAuthContextValue {
  return useContext(DashboardAuthContext);
}

export function AccessDeniedCard({
  message = 'Bu sayfa veya modül için görüntüleme yetkiniz bulunmuyor.',
}: {
  message?: string;
}) {
  return (
    <div className="mx-auto max-w-xl rounded-2xl border border-amber-200 bg-amber-50 p-6 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-800">
          <ShieldAlert className="h-5 w-5" />
        </span>
        <div>
          <h2 className="text-base font-extrabold text-amber-950">Erişim Yetkisi Gerekli</h2>
          <p className="mt-1 text-sm text-amber-900">{message}</p>
          <div className="mt-4">
            <Link
              href="/home"
              className="inline-flex items-center rounded-xl bg-navy px-4 py-2 text-xs font-bold text-white transition hover:bg-navy-hover"
            >
              Modül Seçimine Dön
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

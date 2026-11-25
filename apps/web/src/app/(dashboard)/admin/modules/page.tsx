'use client';

import { useCallback, useEffect, useState } from 'react';
import { Boxes, Cpu, Power, Sparkles, Wrench, Zap } from 'lucide-react';
import { createClient } from '@/core/supabase/client';
import { useDashboardAuth } from '@/core/DashboardContext';
import { WEB_MODULES } from '@/core/moduleRegistry';
import { hasCoreAction } from '@/core/permissions';
import { SystemModule } from '@/types/database';

function moduleIcon(key: string) {
  if (key === 'energy') return <Zap className="h-4 w-4 text-amber-600" />;
  if (key === 'work_tracking') return <Wrench className="h-4 w-4 text-sky-600" />;
  if (key === 'maintenance') return <Sparkles className="h-4 w-4 text-violet-600" />;
  if (key === 'assets') return <Cpu className="h-4 w-4 text-emerald-600" />;
  return <Boxes className="h-4 w-4 text-navy" />;
}

export default function AdminModulesPage() {
  const { profile, refreshProfile } = useDashboardAuth();
  const canManageModules =
    profile?.role === 'system_admin' || hasCoreAction(profile, 'manage_modules');

  const [modules, setModules] = useState<SystemModule[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const loadModules = useCallback(async () => {
    setLoading(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('system_modules')
        .select('*')
        .order('sort_order')
        .order('key');
      if (error) throw error;

      const list = (data as SystemModule[]) ?? [];
      if (list.length > 0) {
        setModules(list);
      } else {
        setModules(
          WEB_MODULES.map((m) => ({
            key: m.key,
            name: m.name,
            description: m.description,
            icon: m.key,
            route_prefix: m.routePrefix,
            is_enabled: !m.isComingSoon,
            is_coming_soon: Boolean(m.isComingSoon),
            sort_order: m.sortOrder,
          }))
        );
      }
    } catch (err) {
      setMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Modül listesi yüklenemedi.',
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadModules();
  }, [loadModules]);

  async function toggleModule(
    mod: SystemModule,
    nextEnabled: boolean,
    nextComingSoon: boolean
  ) {
    setBusyKey(mod.key);
    setMsg(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.rpc('rpc_toggle_system_module', {
        p_key: mod.key,
        p_is_enabled: nextEnabled,
        p_is_coming_soon: nextComingSoon,
      });
      if (error) throw error;
      setMsg({
        type: 'ok',
        text: `"${mod.name}" modülü güncellendi (${
          nextEnabled ? 'Aktif' : 'Pasif'
        } / ${nextComingSoon ? 'Yakında' : 'Canlıda'}).`,
      });
      await loadModules();
      await refreshProfile();
    } catch (err) {
      setMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Modül güncellenemedi.',
      });
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <div className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400">
          ÇEKİRDEK YÖNETİM
        </div>
        <h1 className="mt-0.5 text-2xl font-extrabold text-slate-900">
          Modül Yönetimi (Canlı Aç / Kapat)
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Merkezi <code>system_modules</code> kayıt tablosu üzerinden platform modüllerinin
          erişim durumunu canlı yönetin.
        </p>
      </div>

      {msg && (
        <div
          className={`rounded-xl border p-3 text-sm font-medium ${
            msg.type === 'ok'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-red-200 bg-red-50 text-red-700'
          }`}
        >
          {msg.text}
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-canvas text-[11px] font-extrabold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">Modül</th>
                <th className="px-4 py-3">Anahtar & Rota</th>
                <th className="px-4 py-3">Açıklama</th>
                <th className="px-4 py-3">Durum</th>
                <th className="px-4 py-3 text-right">Canlı Yönetim</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {modules.map((m) => {
                const busy = busyKey === m.key;
                return (
                  <tr key={m.key} className="hover:bg-canvas/60">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5 font-extrabold text-navy">
                        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-canvas">
                          {moduleIcon(m.key)}
                        </span>
                        <span>{m.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-600">
                      <div>{m.key}</div>
                      <div className="text-[11px] text-slate-400">{m.route_prefix}</div>
                    </td>
                    <td className="max-w-xs px-4 py-3 text-xs text-slate-600">
                      {m.description}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-xs font-extrabold ${
                            m.is_enabled
                              ? 'bg-emerald-100 text-emerald-700'
                              : 'bg-red-100 text-red-700'
                          }`}
                        >
                          {m.is_enabled ? 'Aktif' : 'Pasif'}
                        </span>
                        {m.is_coming_soon && (
                          <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-extrabold text-amber-800">
                            Yakında
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      {canManageModules ? (
                        <div className="inline-flex items-center gap-2">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              toggleModule(m, !m.is_enabled, m.is_coming_soon)
                            }
                            className={`inline-flex items-center gap-1 rounded-xl border px-3 py-1.5 text-xs font-bold transition disabled:opacity-50 ${
                              m.is_enabled
                                ? 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100'
                                : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                            }`}
                          >
                            <Power className="h-3.5 w-3.5" />
                            {m.is_enabled ? 'Pasife Al' : 'Aktifleştir'}
                          </button>

                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              toggleModule(m, m.is_enabled, !m.is_coming_soon)
                            }
                            className="rounded-xl border border-slate-200 bg-canvas px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-navy-soft hover:text-navy disabled:opacity-50"
                          >
                            {m.is_coming_soon ? 'Canlıya Al' : 'Yakında Yap'}
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400">
                          Modül Yönetim Yetkisi Gerekli
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}

              {modules.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                    {loading ? 'Modüller yükleniyor...' : 'Modül kaydı bulunamadı.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

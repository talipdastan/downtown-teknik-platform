'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  Calendar,
  Clock,
  Layers,
  RefreshCw,
} from 'lucide-react';
import { createClient } from '@/core/supabase/client';
import { useDebouncedRealtime } from '@/core/hooks/useDebouncedRealtime';
import { formatDateTime, PRIORITY_LABELS, TICKET_STATUS_LABELS } from '@/core/constants';
import { useDashboardAuth } from '@/core/DashboardContext';
import { canAccessDashboardPath } from '@/core/moduleRegistry';
import { TicketPriority, TicketStatus } from '@/types/database';

type RecentTicket = {
  id: string;
  ticket_number: string | null;
  reporter_id: string;
  description: string;
  priority: TicketPriority;
  status: TicketStatus;
  created_at: string;
  custom_location: string | null;
  custom_category: string | null;
  locations?: { name: string; floors?: { name: string } | null } | null;
  categories?: { name: string } | null;
  equipments?: { code: string; name: string } | null;
  profiles?: { full_name: string } | null;
};

const WEEKDAY_NAMES = ['Pzt', 'Salı', 'Çrş', 'Prş', 'Cuma', 'Cmt', 'Pzr'];

function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function getCurrentWeekDays(): Date[] {
  const now = new Date();
  const normalized = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = normalized.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(normalized);
  monday.setDate(normalized.getDate() + diffToMonday);
  return Array.from({ length: 7 }, (_, idx) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + idx);
    return d;
  });
}

export default function WorkTrackingOverviewPage() {
  const { profile, serverModules } = useDashboardAuth();
  const [recent, setRecent] = useState<RecentTicket[]>([]);
  const [unassignedCount, setUnassignedCount] = useState<number>(0);
  const [inFieldCount, setInFieldCount] = useState<number>(0);
  const [awaitingApprovalCount, setAwaitingApprovalCount] = useState<number>(0);
  const [closedTotal, setClosedTotal] = useState<number>(0);
  const [urgentOpenCount, setUrgentOpenCount] = useState<number>(0);
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadOverview = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const supabase = createClient();

      const [recRes, summaryRes] = await Promise.all([
        supabase
          .from('tickets')
          .select(
            'id, ticket_number, reporter_id, description, priority, status, created_at, custom_location, custom_category, locations(name, floors(name)), categories(name), equipments(code, name), profiles!tickets_reporter_id_fkey(full_name)'
          )
          .order('created_at', { ascending: false })
          .limit(50),
        supabase.rpc('rpc_work_tracking_dashboard_summary'),
      ]);

      if (recRes.error) throw recRes.error;
      setRecent((recRes.data as unknown as RecentTicket[]) ?? []);

      const summaryRow = Array.isArray(summaryRes.data)
        ? (summaryRes.data[0] as Record<string, number> | undefined)
        : (summaryRes.data as Record<string, number> | null);

      if (!summaryRes.error && summaryRow) {
        setUnassignedCount(Number(summaryRow.unassigned_count ?? 0));
        setInFieldCount(Number(summaryRow.in_field_count ?? 0));
        setAwaitingApprovalCount(Number(summaryRow.awaiting_approval_count ?? 0));
        setClosedTotal(Number(summaryRow.closed_count ?? 0));
        setUrgentOpenCount(Number(summaryRow.urgent_open_count ?? 0));
      } else {
        // Migration 0018 henüz canlıya alınmadıysa geriye uyumlu fallback
        const [unassignedRes, inFieldRes, resolvedRes, closedRes, urgentRes] =
          await Promise.all([
            supabase
              .from('tickets')
              .select('id', { count: 'exact', head: true })
              .in('status', ['new', 'under_review']),
            supabase
              .from('tickets')
              .select('id', { count: 'exact', head: true })
              .in('status', ['assigned', 'in_progress', 'waiting']),
            supabase
              .from('tickets')
              .select('id', { count: 'exact', head: true })
              .eq('status', 'resolved'),
            supabase
              .from('tickets')
              .select('id', { count: 'exact', head: true })
              .eq('status', 'closed'),
            supabase
              .from('tickets')
              .select('id', { count: 'exact', head: true })
              .eq('priority', 'urgent')
              .not('status', 'in', '("closed","cancelled")'),
          ]);
        setUnassignedCount(unassignedRes.count ?? 0);
        setInFieldCount(inFieldRes.count ?? 0);
        setAwaitingApprovalCount(resolvedRes.count ?? 0);
        setClosedTotal(closedRes.count ?? 0);
        setUrgentOpenCount(urgentRes.count ?? 0);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Özet verileri yüklenemedi.');
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  useDebouncedRealtime({
    channelName: 'wt-overview-live',
    tables: ['tickets', 'work_orders'],
    onRefresh: () => loadOverview(true),
    delayMs: 500,
  });

  const weekDays = useMemo(() => getCurrentWeekDays(), []);
  const today = useMemo(() => new Date(), []);

  const visibleRecent = useMemo(() => {
    if (!selectedDay) return recent.slice(0, 12);
    return recent.filter((t) => isSameLocalDay(new Date(t.created_at), selectedDay));
  }, [recent, selectedDay]);

  const grandTotal =
    unassignedCount + inFieldCount + awaitingApprovalCount + closedTotal;

  return (
    <div className="space-y-5">
      {/* Üst Başlık ve Hızlı Aksiyonlar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400">
            DOWNTOWN TEKNİK · SAHA OPERASYON MERKEZİ
          </div>
          <h1 className="text-2xl font-extrabold text-navy">İş Takip – Genel Bakış</h1>
          <p className="text-sm text-slate-500">
            Atama Bekleyen → Sahada / İşlemde → Çözüm Onayı Bekleyen → Kapanan iş akışı özeti.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => loadOverview()}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 transition hover:bg-slate-50"
          >
            <RefreshCw className="h-3.5 w-3.5 text-turquoise" />
            Yenile
          </button>
          {canAccessDashboardPath(profile, '/work-tracking/tickets', serverModules) && (
            <Link
              href="/work-tracking/tickets"
              className="rounded-xl bg-navy px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-navy-hover"
            >
              Hizmet Talepleri / Arızalar ({unassignedCount + inFieldCount + awaitingApprovalCount} Aktif)
            </Link>
          )}
          {canAccessDashboardPath(profile, '/work-tracking/work-orders', serverModules) && (
            <Link
              href="/work-tracking/work-orders"
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 transition hover:bg-slate-50"
            >
              İş Emirleri ({inFieldCount} Sahada)
            </Link>
          )}
          {canAccessDashboardPath(profile, '/work-tracking/review', serverModules) && (
            <Link
              href="/work-tracking/review"
              className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs font-bold text-emerald-800 transition hover:bg-emerald-100"
            >
              Çözüm Onay ({awaitingApprovalCount})
            </Link>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Supabase bağlantısı veya yetki kontrolü: {error}
        </div>
      )}

      {/* 1. TEK VE TUTARLI KOYU LACİVERT HERO KPI KARTI (4 Net Aşama) */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#0F2342] via-navy to-[#1E4474] p-6 text-white shadow-md">
        <div className="pointer-events-none absolute -right-10 -top-10 h-44 w-44 rounded-full bg-white/5" />
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-cyan-300">
                CANLI İŞ AKIŞI ÖZETİ
              </span>
              {urgentOpenCount > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-rose-600 px-2.5 py-0.5 text-[11px] font-bold text-white">
                  <AlertTriangle className="h-3 w-3" />
                  {urgentOpenCount} Acil Açık
                </span>
              )}
            </div>
            <h2 className="mt-1 text-xl font-extrabold text-white">
              Toplam Talepler & Saha İşleri
            </h2>
          </div>
          <div className="rounded-2xl bg-white/10 px-5 py-2 text-3xl font-black tracking-tight text-white">
            {loading ? '...' : grandTotal}
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3 text-center sm:grid-cols-4">
          <Link
            href="/work-tracking/tickets"
            className="group flex flex-col items-center rounded-xl bg-white/5 p-3 transition hover:bg-white/15"
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-base font-black text-sky-700 shadow-sm">
              {loading ? '·' : unassignedCount}
            </div>
            <span className="mt-2 text-xs font-bold text-white">
              1. Atama Bekleyen
            </span>
            <span className="text-[10.5px] text-slate-300">
              Henüz teknisyene atanmadı
            </span>
          </Link>

          <Link
            href="/work-tracking/work-orders"
            className="group flex flex-col items-center rounded-xl bg-white/5 p-3 transition hover:bg-white/15"
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-base font-black text-amber-700 shadow-sm">
              {loading ? '·' : inFieldCount}
            </div>
            <span className="mt-2 text-xs font-bold text-white">
              2. Sahada / İşlemde
            </span>
            <span className="text-[10.5px] text-slate-300">
              Atandı, işlemde veya beklemede
            </span>
          </Link>

          <Link
            href="/work-tracking/review"
            className="group flex flex-col items-center rounded-xl bg-white/5 p-3 transition hover:bg-white/15"
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-base font-black text-emerald-700 shadow-sm">
              {loading ? '·' : awaitingApprovalCount}
            </div>
            <span className="mt-2 text-xs font-bold text-white">
              3. Onay Bekleyen
            </span>
            <span className="text-[10.5px] text-slate-300">
              Teknisyen tamamladı, onayda
            </span>
          </Link>

          <Link
            href="/work-tracking/tickets"
            className="group flex flex-col items-center rounded-xl bg-white/5 p-3 transition hover:bg-white/15"
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-base font-black text-navy shadow-sm">
              {loading ? '·' : closedTotal}
            </div>
            <span className="mt-2 text-xs font-bold text-white">
              4. Kapandı
            </span>
            <span className="text-[10.5px] text-slate-300">
              Onaylanarak kapatıldı
            </span>
          </Link>
        </div>
      </div>

      {/* 2. HAFTALIK YATAY TAKVİM & VARDİYA ŞERİDİ */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="mr-2 flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider text-navy">
            <Calendar className="h-4 w-4 text-turquoise" />
            Haftalık Takvim
          </div>
          {weekDays.map((d, idx) => {
            const isToday = isSameLocalDay(d, today);
            const isSelected = selectedDay !== null && isSameLocalDay(d, selectedDay);
            return (
              <button
                key={d.toISOString()}
                type="button"
                onClick={() => setSelectedDay(isSelected ? null : d)}
                className={`flex min-w-[54px] flex-col items-center rounded-xl border px-3 py-1.5 text-center transition ${
                  isSelected
                    ? 'border-navy bg-navy text-white shadow-sm'
                    : isToday
                    ? 'border-turquoise bg-cyan-50/60 text-navy'
                    : 'border-slate-200 bg-canvas text-slate-700 hover:bg-slate-100'
                }`}
              >
                <span className="text-sm font-extrabold">{d.getDate()}</span>
                <span
                  className={`text-[11px] font-semibold ${
                    isSelected ? 'text-slate-200' : 'text-slate-500'
                  }`}
                >
                  {WEEKDAY_NAMES[idx]}
                </span>
              </button>
            );
          })}
          {selectedDay && (
            <button
              type="button"
              onClick={() => setSelectedDay(null)}
              className="ml-2 text-xs font-bold text-turquoise hover:underline"
            >
              Filtreyi Temizle
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs font-bold text-slate-600">
          <div className="inline-flex items-center gap-1.5 rounded-xl bg-slate-100 px-3 py-1.5">
            <Clock className="h-3.5 w-3.5 text-turquoise" />
            Vardiya: <span className="text-slate-900">09:00 – 18:00</span>
          </div>
          <div className="inline-flex items-center gap-1.5 rounded-xl bg-slate-100 px-3 py-1.5">
            <Layers className="h-3.5 w-3.5 text-navy" />
            Aktif Süreçteki İşler:{' '}
            <span className="text-navy">
              {unassignedCount + inFieldCount + awaitingApprovalCount}
            </span>
          </div>
        </div>
      </div>

      {/* 3. SON HİZMET TALEPLERİ / ARIZA KARTLARI */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-extrabold uppercase tracking-wider text-navy">
            {selectedDay
              ? `Seçili Gün Hizmet Talepleri (${visibleRecent.length})`
              : 'Son Hizmet Talepleri & Arıza Kayıtları'}
          </h2>
          <Link
            href="/work-tracking/tickets"
            className="text-xs font-bold text-turquoise hover:underline"
          >
            Tüm Talepleri Gör →
          </Link>
        </div>

        {visibleRecent.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
            {loading ? 'Yükleniyor...' : 'Seçili kriterde arıza veya hizmet talebi bulunamadı.'}
          </div>
        ) : (
          <div className="grid gap-3.5 md:grid-cols-2">
            {visibleRecent.map((t) => {
              const loc = t.locations?.name
                ? `${t.locations.floors?.name ? `${t.locations.floors.name} - ` : ''}${t.locations.name}`
                : t.custom_location ?? '-';
              const cat = t.categories?.name ?? t.custom_category ?? 'Genel Teknik';
              const eq = t.equipments ? `(${t.equipments.code}) ${t.equipments.name}` : null;

              return (
                <div
                  key={t.id}
                  className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-slate-300"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-sm font-extrabold text-slate-900">
                        Teknik / {cat}
                      </div>
                      {eq && (
                        <div className="mt-0.5 text-xs font-extrabold text-navy">
                          {eq}
                        </div>
                      )}
                    </div>
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                        t.priority === 'urgent'
                          ? 'bg-red-100 text-red-700'
                          : t.priority === 'priority'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-slate-100 text-slate-700'
                      }`}
                    >
                      {PRIORITY_LABELS[t.priority] ?? t.priority}
                    </span>
                  </div>

                  <div className="mt-1.5 flex items-center justify-between text-xs font-bold text-slate-600">
                    <span>{formatDateTime(t.created_at)}</span>
                    <span className="text-slate-400">#{t.ticket_number ?? t.id.slice(0, 8)}</span>
                  </div>

                  <div className="my-2.5 border-t border-slate-100" />

                  <div className="space-y-1 text-xs">
                    <div className="flex">
                      <span className="w-28 shrink-0 text-slate-400">Lokasyon</span>
                      <span className="font-semibold text-slate-700">: {loc}</span>
                    </div>
                    <div className="flex">
                      <span className="w-28 shrink-0 text-slate-400">Durum</span>
                      <span className="font-extrabold text-navy">
                        : {TICKET_STATUS_LABELS[t.status] ?? t.status}
                      </span>
                    </div>
                    <div className="flex">
                      <span className="w-28 shrink-0 text-slate-400">Bildiren Kişi</span>
                      <span className="font-semibold text-slate-700">
                        : {t.profiles?.full_name ?? 'Downtown Teknik'}
                      </span>
                    </div>
                    <div className="flex">
                      <span className="w-28 shrink-0 text-slate-400">Açıklama</span>
                      <span className="line-clamp-1 font-medium text-slate-600">
                        : {t.description || '-'}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

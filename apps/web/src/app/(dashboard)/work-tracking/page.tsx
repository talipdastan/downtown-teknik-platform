'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  Briefcase,
  Calendar,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  FileText,
  Layers,
  RefreshCw,
} from 'lucide-react';
import { createClient } from '@/core/supabase/client';
import { formatDateTime, PRIORITY_LABELS, TICKET_STATUS_LABELS } from '@/core/constants';
import { useDashboardAuth } from '@/core/DashboardContext';
import { canAccessDashboardPath } from '@/core/moduleRegistry';
import { TicketPriority, TicketStatus, WorkOrderStatus } from '@/types/database';

type Summary = {
  total_open: number;
  new_count: number;
  in_progress_count: number;
  waiting_count: number;
  awaiting_approval_count: number;
  urgent_open_count: number;
};

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

type MyWorkOrderRow = {
  id: string;
  status: WorkOrderStatus;
  created_at: string;
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
  const [summary, setSummary] = useState<Summary | null>(null);
  const [recent, setRecent] = useState<RecentTicket[]>([]);
  const [myOrders, setMyOrders] = useState<MyWorkOrderRow[]>([]);
  const [unassignedCount, setUnassignedCount] = useState<number>(0);
  const [activeWoCount, setActiveWoCount] = useState<number>(0);
  const [closedTotal, setClosedTotal] = useState<number>(0);
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadOverview = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const uid = user?.id;

      const [
        sumRes,
        recRes,
        unassignedRes,
        activeWoRes,
        closedRes,
        myWoRes,
      ] = await Promise.all([
        supabase.rpc('rpc_work_tracking_summary'),
        supabase
          .from('tickets')
          .select(
            'id, ticket_number, reporter_id, description, priority, status, created_at, custom_location, custom_category, locations(name, floors(name)), categories(name), equipments(code, name), profiles!tickets_reporter_id_fkey(full_name)'
          )
          .order('created_at', { ascending: false })
          .limit(40),
        // 1. Kutu: Henüz iş emrine dönüştürülmemiş (Atama Bekleyen) arızalar
        supabase
          .from('tickets')
          .select('id', { count: 'exact', head: true })
          .in('status', ['new', 'under_review']),
        // 2. Kutu: Sahada aktif olan (Atandı / İşlemde / Beklemede) iş emirleri
        supabase
          .from('work_orders')
          .select('id', { count: 'exact', head: true })
          .in('status', ['assigned', 'in_progress', 'waiting']),
        // 4. Kutu: Onaylanıp kapatılmış kayıtlar
        supabase
          .from('tickets')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'closed'),
        // Sol Koyu Kart ("Üzerimdeki Toplam İşler"): Doğrudan giriş yapan kullanıcıya atanmış iş emirleri
        uid
          ? supabase
              .from('work_orders')
              .select('id, status, created_at, work_order_assignments!inner(user_id)')
              .eq('work_order_assignments.user_id', uid)
              .neq('status', 'cancelled')
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (sumRes.error) throw sumRes.error;
      if (recRes.error) throw recRes.error;

      const sumRow = Array.isArray(sumRes.data) ? sumRes.data[0] : sumRes.data;
      setSummary(sumRow ?? null);
      setRecent((recRes.data as unknown as RecentTicket[]) ?? []);
      setUnassignedCount(unassignedRes.count ?? 0);
      setActiveWoCount(activeWoRes.count ?? 0);
      setClosedTotal(closedRes.count ?? 0);
      setMyOrders((myWoRes.data as unknown as MyWorkOrderRow[]) ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Özet verileri yüklenemedi.');
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOverview();

    // Supabase Realtime + Pencere Odaklandığında Anlık Otomatik Yenileme
    const supabase = createClient();
    const channel = supabase
      .channel('wt-overview-live')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tickets' },
        () => loadOverview(true)
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'work_orders' },
        () => loadOverview(true)
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'work_order_assignments' },
        () => loadOverview(true)
      )
      .subscribe();

    const onFocus = () => loadOverview(true);
    window.addEventListener('focus', onFocus);

    return () => {
      window.removeEventListener('focus', onFocus);
      supabase.removeChannel(channel);
    };
  }, [loadOverview]);

  const weekDays = useMemo(() => getCurrentWeekDays(), []);
  const today = useMemo(() => new Date(), []);

  const visibleRecent = useMemo(() => {
    if (!selectedDay) return recent.slice(0, 10);
    return recent.filter((t) => isSameLocalDay(new Date(t.created_at), selectedDay));
  }, [recent, selectedDay]);

  const awaitingApprovalCount = summary?.awaiting_approval_count ?? 0;
  const urgentOpenCount = summary?.urgent_open_count ?? 0;

  // SOL KOYU KART ("Üzerimdeki Toplam İşler"):
  // Kullanıcıya atanmış iş emri varsa onları, yoksa kendi açtığı arıza kayıtlarını sayar.
  // Böylece sağdaki "Genel Saha Operasyon Kutuları" ile aynı sayıyı tekrar etmez!
  const myAssignedCount = myOrders.length;
  const myOwnReported = recent.filter((t) => t.reporter_id === profile?.id);
  const useAssignedForHero = myAssignedCount > 0;

  const heroNew = useAssignedForHero
    ? myOrders.filter((o) => o.status === 'assigned').length
    : myOwnReported.filter((t) => t.status === 'new' || t.status === 'under_review').length;

  const heroInProgress = useAssignedForHero
    ? myOrders.filter((o) => o.status === 'in_progress').length
    : myOwnReported.filter((t) => t.status === 'assigned' || t.status === 'in_progress').length;

  const heroWaiting = useAssignedForHero
    ? myOrders.filter((o) => o.status === 'waiting').length
    : myOwnReported.filter((t) => t.status === 'waiting').length;

  const heroCompleted = useAssignedForHero
    ? myOrders.filter((o) => o.status === 'completed').length
    : myOwnReported.filter((t) => t.status === 'resolved' || t.status === 'closed').length;

  const heroTotal = heroNew + heroInProgress + heroWaiting + heroCompleted;

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
            Kişisel iş yükünüz, genel saha iş akışı (Atama Bekleyen → Sahada → Onay → Kapanan) ve haftalık takvim.
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
              Arıza Kayıtları ({unassignedCount} Atama Bekleyen)
            </Link>
          )}
          {canAccessDashboardPath(profile, '/work-tracking/work-orders', serverModules) && (
            <Link
              href="/work-tracking/work-orders"
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 transition hover:bg-slate-50"
            >
              İş Emirleri ({activeWoCount} Sahada)
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

      {/* 1. ÜST BÖLÜM: Sol Kişisel İş Yükü Kartı + Sağ 4 Aşamalı Genel Saha Operasyon Kutuları */}
      <div className="grid gap-4 lg:grid-cols-12">
        {/* SOL KART: Kişisel İş Yükü ("Bana Atanan / Açtığım İşler") */}
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#0F2342] via-navy to-[#1E4474] p-6 text-white shadow-md lg:col-span-6">
          <div className="pointer-events-none absolute -right-10 -top-10 h-44 w-44 rounded-full bg-white/5" />
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-cyan-300">
                KİŞİSEL İŞ YÜKÜ ÖZETİ ({profile?.full_name ?? 'Kullanıcı'})
              </div>
              <h2 className="mt-1 text-lg font-extrabold text-white">
                {useAssignedForHero
                  ? 'Bana Atanan İş Emirleri'
                  : 'Üzerimdeki / Açtığım Talepler'}
              </h2>
            </div>
            <div className="rounded-2xl bg-white/10 px-4 py-2 text-3xl font-black tracking-tight text-white">
              {loading ? '...' : heroTotal}
            </div>
          </div>

          <div className="mt-6 grid grid-cols-4 gap-3 text-center">
            <Link
              href={useAssignedForHero ? '/work-tracking/work-orders' : '/work-tracking/tickets'}
              className="group flex flex-col items-center rounded-xl p-2 transition hover:bg-white/10"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-base font-black text-navy shadow-sm">
                {loading ? '·' : heroNew}
              </div>
              <span className="mt-2 text-xs font-semibold text-slate-200 group-hover:text-white">
                {useAssignedForHero ? 'Yeni Atanan' : 'Yeni'}
              </span>
            </Link>

            <Link
              href="/work-tracking/work-orders"
              className="group flex flex-col items-center rounded-xl p-2 transition hover:bg-white/10"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-base font-black text-amber-700 shadow-sm">
                {loading ? '·' : heroInProgress}
              </div>
              <span className="mt-2 text-xs font-semibold text-slate-200 group-hover:text-white">
                İş Devam Ediyor
              </span>
            </Link>

            <Link
              href="/work-tracking/work-orders"
              className="group flex flex-col items-center rounded-xl p-2 transition hover:bg-white/10"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-base font-black text-orange-600 shadow-sm">
                {loading ? '·' : heroWaiting}
              </div>
              <span className="mt-2 text-xs font-semibold text-slate-200 group-hover:text-white">
                Beklemede
              </span>
            </Link>

            <Link
              href={useAssignedForHero ? '/work-tracking/work-orders' : '/work-tracking/tickets'}
              className="group flex flex-col items-center rounded-xl p-2 transition hover:bg-white/10"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-base font-black text-emerald-700 shadow-sm">
                {loading ? '·' : heroCompleted}
              </div>
              <span className="mt-2 text-xs font-semibold text-slate-200 group-hover:text-white">
                Tamamlanan
              </span>
            </Link>
          </div>
        </div>

        {/* SAĞ 2x2 BENTO KUTULARI: Tesis Genel Saha İş Akışı (4 Farklı Aşama) */}
        <div className="grid grid-cols-2 gap-3.5 lg:col-span-6">
          {/* Aşama 1: Atama Bekleyen Yeni Arıza */}
          <Link
            href="/work-tracking/tickets"
            className="flex flex-col justify-between rounded-2xl border border-rose-300 bg-rose-50/70 p-4 transition hover:shadow-sm"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-extrabold text-slate-800">
                1. Atama Bekleyen Arıza
              </span>
              {urgentOpenCount > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-rose-600 px-2 py-0.5 text-[10px] font-bold text-white">
                  <AlertTriangle className="h-3 w-3" />
                  {urgentOpenCount} Acil
                </span>
              )}
            </div>
            <div className="mt-1 text-[11px] text-slate-500">
              Henüz iş emri atanmamış yeni kayıtlar
            </div>
            <div className="mt-3 flex items-end justify-between">
              <span className="text-2xl font-black text-rose-600">
                {loading ? '...' : unassignedCount}
              </span>
              <FileText className="h-6 w-6 text-rose-500" />
            </div>
          </Link>

          {/* Aşama 2: Sahada Aktif İş Emirleri */}
          <Link
            href="/work-tracking/work-orders"
            className="flex flex-col justify-between rounded-2xl border border-blue-300 bg-blue-50/70 p-4 transition hover:shadow-sm"
          >
            <div className="text-sm font-extrabold text-slate-800">
              2. Sahada Aktif İş Emirleri
            </div>
            <div className="mt-1 text-[11px] text-slate-500">
              Teknisyene atanmış, işlemde veya bekleyen
            </div>
            <div className="mt-3 flex items-end justify-between">
              <span className="text-2xl font-black text-blue-600">
                {loading ? '...' : activeWoCount}
              </span>
              <Briefcase className="h-6 w-6 text-blue-500" />
            </div>
          </Link>

          {/* Aşama 3: Çözüm Onay / Kontrol */}
          <Link
            href="/work-tracking/review"
            className="flex flex-col justify-between rounded-2xl border border-lime-300 bg-lime-50/70 p-4 transition hover:shadow-sm"
          >
            <div className="text-sm font-extrabold text-slate-800">
              3. Çözüm Onay / Kontrol
            </div>
            <div className="mt-1 text-[11px] text-slate-500">
              Teknisyen tamamladı, yönetici onayı bekliyor
            </div>
            <div className="mt-3 flex items-end justify-between">
              <span className="text-2xl font-black text-lime-700">
                {loading ? '...' : awaitingApprovalCount}
              </span>
              <ClipboardCheck className="h-6 w-6 text-lime-600" />
            </div>
          </Link>

          {/* Aşama 4: Kapanan / Arşivlenen */}
          <Link
            href="/work-tracking/tickets"
            className="flex flex-col justify-between rounded-2xl border border-teal-300 bg-teal-50/70 p-4 transition hover:shadow-sm"
          >
            <div className="text-sm font-extrabold text-slate-800">
              4. Kapanan / Tamamlanan
            </div>
            <div className="mt-1 text-[11px] text-slate-500">
              Onaylanarak kalıcı kapatılan işler
            </div>
            <div className="mt-3 flex items-end justify-between">
              <span className="text-2xl font-black text-teal-600">
                {loading ? '...' : closedTotal}
              </span>
              <CheckCircle2 className="h-6 w-6 text-teal-500" />
            </div>
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
            Bana Atanan İş Emri: <span className="text-navy">{myAssignedCount}</span>
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

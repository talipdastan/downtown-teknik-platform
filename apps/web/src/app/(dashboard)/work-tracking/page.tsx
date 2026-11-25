'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/core/supabase/client';
import { formatDateTime, PRIORITY_LABELS, TICKET_STATUS_LABELS } from '@/core/constants';
import { useDashboardAuth } from '@/core/DashboardContext';
import { canAccessDashboardPath } from '@/core/moduleRegistry';
import { TicketPriority, TicketStatus } from '@/types/database';

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
  description: string;
  priority: TicketPriority;
  status: TicketStatus;
  created_at: string;
  custom_location: string | null;
  locations?: { name: string; floors?: { name: string } | null } | null;
  equipments?: { code: string; name: string } | null;
};

export default function WorkTrackingOverviewPage() {
  const { profile, serverModules } = useDashboardAuth();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [recent, setRecent] = useState<RecentTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadOverview() {
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const [sumRes, recRes] = await Promise.all([
        supabase.rpc('rpc_work_tracking_summary'),
        supabase
          .from('tickets')
          .select(
            'id, ticket_number, description, priority, status, created_at, custom_location, locations(name, floors(name)), equipments(code, name)'
          )
          .order('created_at', { ascending: false })
          .limit(8),
      ]);

      if (sumRes.error) throw sumRes.error;
      if (recRes.error) throw recRes.error;

      const sumRow = Array.isArray(sumRes.data) ? sumRes.data[0] : sumRes.data;
      setSummary(sumRow ?? null);
      setRecent((recRes.data as unknown as RecentTicket[]) ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Özet verileri yüklenemedi.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadOverview();
  }, []);

  const cards = [
    { label: 'Toplam Açık Arıza', value: summary?.total_open ?? 0, tone: 'text-navy' },
    { label: 'Yeni Bildirim', value: summary?.new_count ?? 0, tone: 'text-sky-700' },
    { label: 'İşlemde', value: summary?.in_progress_count ?? 0, tone: 'text-amber-700' },
    { label: 'Beklemede', value: summary?.waiting_count ?? 0, tone: 'text-orange-700' },
    { label: 'Onay Bekleyen', value: summary?.awaiting_approval_count ?? 0, tone: 'text-emerald-700' },
    { label: 'Acil Açık', value: summary?.urgent_open_count ?? 0, tone: 'text-red-600' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-navy">İş Takip – Genel Bakış</h1>
          <p className="text-sm text-slate-500">
            Arıza bildirimleri, aktif iş emirleri ve çözüm onay durumlarının özeti.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canAccessDashboardPath(profile, '/work-tracking/tickets', serverModules) && (
            <Link
              href="/work-tracking/tickets"
              className="rounded-lg bg-navy px-3.5 py-2 text-sm font-medium text-white hover:bg-navy-hover"
            >
              Arıza Kayıtları
            </Link>
          )}
          {canAccessDashboardPath(profile, '/work-tracking/work-orders', serverModules) && (
            <Link
              href="/work-tracking/work-orders"
              className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              İş Emirleri
            </Link>
          )}
          {canAccessDashboardPath(profile, '/work-tracking/review', serverModules) && (
            <Link
              href="/work-tracking/review"
              className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Onay Bekleyenler
            </Link>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Supabase bağlantısı veya yetki kontrolü: {error}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {cards.map((c) => (
          <div key={c.label} className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-xs font-medium text-slate-500">{c.label}</div>
            <div className={`mt-2 text-2xl font-bold ${c.tone}`}>
              {loading ? '...' : c.value}
            </div>
          </div>
        ))}
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
          <h2 className="text-sm font-semibold text-navy">Son Arıza Kayıtları</h2>
          <Link
            href="/work-tracking/tickets"
            className="text-xs font-medium text-navy hover:underline"
          >
            Tümünü Gör →
          </Link>
        </div>
        {recent.length === 0 ? (
          <div className="p-6 text-sm text-slate-500">
            {loading ? 'Yükleniyor...' : 'Görüntülenecek arıza kaydı bulunamadı.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Kayıt No</th>
                  <th className="px-4 py-3">Konum</th>
                  <th className="px-4 py-3">Ekipman</th>
                  <th className="px-4 py-3">Öncelik</th>
                  <th className="px-4 py-3">Durum</th>
                  <th className="px-4 py-3">Tarih</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {recent.map((t) => {
                  const loc = t.locations?.name
                    ? `${t.locations.floors?.name ? `${t.locations.floors.name} - ` : ''}${t.locations.name}`
                    : t.custom_location ?? '-';
                  return (
                    <tr key={t.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium text-navy">
                        {t.ticket_number ?? '-'}
                      </td>
                      <td className="px-4 py-3 text-slate-700">{loc}</td>
                      <td className="px-4 py-3 text-slate-600">
                        {t.equipments ? `${t.equipments.code} - ${t.equipments.name}` : '-'}
                      </td>
                      <td className="px-4 py-3">{PRIORITY_LABELS[t.priority] ?? t.priority}</td>
                      <td className="px-4 py-3">
                        {TICKET_STATUS_LABELS[t.status] ?? t.status}
                      </td>
                      <td className="px-4 py-3 text-slate-500">
                        {formatDateTime(t.created_at)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

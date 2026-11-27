'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Clock,
  Plus,
  Zap,
} from 'lucide-react';
import { createClient } from '@/core/supabase/client';
import { formatDate, formatDateTime } from '@/core/constants';
import { useDashboardAuth } from '@/core/DashboardContext';

type ShiftRow = {
  id: string;
  shift_date: string;
  shift_type: 'morning' | 'evening' | 'night';
  summary_notes: string;
  incoming_notes: string | null;
  status: 'pending_acceptance' | 'accepted';
  handed_over_at: string;
  accepted_at: string | null;
  open_critical_snapshot: Array<{ ticket_number?: string; priority?: string; description?: string }>;
  energy_alerts_snapshot: Array<{ meter_name?: string; inductive_percent?: number; capacitive_percent?: number }>;
  outgoing?: { full_name: string } | null;
  incoming?: { full_name: string } | null;
  departments?: { name: string } | null;
};

const SHIFT_LABELS: Record<ShiftRow['shift_type'], string> = {
  morning: 'Sabah Vardiyası (08:00 - 16:00)',
  evening: 'Akşam Vardiyası (16:00 - 00:00)',
  night: 'Gece Vardiyası (00:00 - 08:00)',
};

export default function ShiftHandoversPage() {
  const { profile } = useDashboardAuth();
  const queryClient = useQueryClient();
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const [shiftDate, setShiftDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [shiftType, setShiftType] = useState<ShiftRow['shift_type']>('morning');
  const [summaryNotes, setSummaryNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const { data: rows = [], isLoading: loading } = useQuery({
    queryKey: ['cmms', 'shifts'],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('shift_handovers')
        .select(
          'id, shift_date, shift_type, summary_notes, incoming_notes, status, handed_over_at, accepted_at, open_critical_snapshot, energy_alerts_snapshot, outgoing:profiles!shift_handovers_outgoing_user_id_fkey(full_name), incoming:profiles!shift_handovers_incoming_user_id_fkey(full_name), departments(name)'
        )
        .order('shift_date', { ascending: false })
        .order('handed_over_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data as unknown as ShiftRow[]) ?? [];
    },
  });

  const loadAll = async () => {
    await queryClient.invalidateQueries({ queryKey: ['cmms', 'shifts'] });
  };

  async function handleCreateHandover(e: React.FormEvent) {
    e.preventDefault();
    if (!summaryNotes.trim()) return;
    setSubmitting(true);
    setMsg(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.rpc('rpc_create_shift_handover', {
        p_shift_date: shiftDate,
        p_shift_type: shiftType,
        p_department_id: profile?.department_id ?? null,
        p_summary_notes: summaryNotes.trim(),
      });
      if (error) throw error;
      setMsg({
        type: 'ok',
        text: 'Vardiya devri oluşturuldu; açık kritik arızalar ve enerji alarmları otomatik iliştirildi.',
      });
      setSummaryNotes('');
      await loadAll();
    } catch (err) {
      setMsg({ type: 'err', text: err instanceof Error ? err.message : 'Vardiya devri oluşturulamadı.' });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAccept(id: string) {
    const incomingNote = window.prompt('Teslim alma notu (opsiyonel):') ?? '';
    setMsg(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.rpc('rpc_accept_shift_handover', {
        p_handover_id: id,
        p_incoming_notes: incomingNote.trim() || null,
      });
      if (error) throw error;
      setMsg({ type: 'ok', text: 'Vardiya başarıyla teslim alındı ve dijital olarak imzalandı.' });
      await loadAll();
    } catch (err) {
      setMsg({ type: 'err', text: err instanceof Error ? err.message : 'Teslim alma başarısız.' });
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <div className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400">
          KURUMSAL CMMS · NÖBET DEFTERİ
        </div>
        <h1 className="mt-0.5 text-2xl font-extrabold text-navy">
          Dijital Vardiya Devir Teslim Defteri
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Vardiya geçişlerinde açık acil/öncelikli işler ve son 24 saat enerji alarmları otomatik kaydedilir; gelen vardiya dijital imzayla teslim alır.
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

      {/* Yeni Devir Formu */}
      <form onSubmit={handleCreateHandover} className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-navy">
          <BookOpen className="h-4 w-4" />
          Vardiya Devir Kaydı Aç
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <input
            type="date"
            required
            value={shiftDate}
            onChange={(e) => setShiftDate(e.target.value)}
            className="rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm"
          />
          <select
            value={shiftType}
            onChange={(e) => setShiftType(e.target.value as ShiftRow['shift_type'])}
            className="rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm"
          >
            <option value="morning">Sabah Vardiyası (08:00 - 16:00)</option>
            <option value="evening">Akşam Vardiyası (16:00 - 00:00)</option>
            <option value="night">Gece Vardiyası (00:00 - 08:00)</option>
          </select>
        </div>
        <textarea
          required
          rows={3}
          placeholder="Vardiya özeti, takip edilmesi gereken sistemler, devam eden çalışmalar ve özel notlar..."
          value={summaryNotes}
          onChange={(e) => setSummaryNotes(e.target.value)}
          className="w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm"
        />
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center gap-1.5 rounded-xl bg-navy px-4 py-2 text-xs font-bold text-white hover:bg-navy-hover disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            {submitting ? 'Kaydediliyor...' : 'Vardiyayı Devret'}
          </button>
        </div>
      </form>

      {/* Kayıt Listesi */}
      <div className="space-y-3">
        {loading ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">
            Yükleniyor...
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">
            Henüz vardiya devir kaydı oluşturulmadı.
          </div>
        ) : (
          rows.map((r) => (
            <div key={r.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-extrabold text-navy">
                      {formatDate(r.shift_date)} · {SHIFT_LABELS[r.shift_type]}
                    </span>
                    {r.status === 'accepted' ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-800">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Teslim Alındı
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-bold text-amber-900">
                        <Clock className="h-3.5 w-3.5" />
                        Teslim Onayı Bekliyor
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    Devreden: <strong>{r.outgoing?.full_name ?? '-'}</strong> ({formatDateTime(r.handed_over_at)})
                    {r.incoming?.full_name && (
                      <> · Teslim Alan: <strong>{r.incoming.full_name}</strong> ({r.accepted_at ? formatDateTime(r.accepted_at) : ''})</>
                    )}
                  </div>
                </div>
                {r.status === 'pending_acceptance' && (
                  <button
                    type="button"
                    onClick={() => handleAccept(r.id)}
                    className="rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-emerald-700"
                  >
                    Teslim Al & İmzala
                  </button>
                )}
              </div>

              <p className="mt-3 rounded-xl bg-canvas p-3 text-sm text-slate-700">{r.summary_notes}</p>
              {r.incoming_notes && (
                <p className="mt-2 rounded-xl bg-emerald-50 p-2.5 text-xs text-emerald-900">
                  <strong>Teslim Alan Notu:</strong> {r.incoming_notes}
                </p>
              )}

              <div className="mt-3 grid gap-3 md:grid-cols-2">
                {Array.isArray(r.open_critical_snapshot) && r.open_critical_snapshot.length > 0 && (
                  <div className="rounded-xl border border-rose-200 bg-rose-50/50 p-3 text-xs">
                    <div className="mb-1 flex items-center gap-1 font-extrabold text-rose-800">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      Devir Anındaki Açık Kritik İşler ({r.open_critical_snapshot.length})
                    </div>
                    <ul className="space-y-1 text-slate-700">
                      {r.open_critical_snapshot.slice(0, 5).map((t, i) => (
                        <li key={i}>
                          <strong>{t.ticket_number ?? 'Kayıt'}</strong>: {t.description}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {Array.isArray(r.energy_alerts_snapshot) && r.energy_alerts_snapshot.length > 0 && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-3 text-xs">
                    <div className="mb-1 flex items-center gap-1 font-extrabold text-amber-900">
                      <Zap className="h-3.5 w-3.5" />
                      Son 24 Saat Reaktif Enerji Alarmları ({r.energy_alerts_snapshot.length})
                    </div>
                    <ul className="space-y-1 text-slate-700">
                      {r.energy_alerts_snapshot.map((a, i) => (
                        <li key={i}>
                          <strong>{a.meter_name}</strong> – End: %{a.inductive_percent ?? 0} / Kap: %{a.capacitive_percent ?? 0}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

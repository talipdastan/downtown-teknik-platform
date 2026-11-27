'use client';

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  Plus,
  Wrench,
  X,
} from 'lucide-react';
import { createClient } from '@/core/supabase/client';
import { formatDate, formatDateTime } from '@/core/constants';
import { useDashboardAuth } from '@/core/DashboardContext';
import { hasModulePermission } from '@/core/permissions';

type PlanRow = {
  id: string;
  equipment_id: string;
  department_id: string | null;
  title: string;
  frequency: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';
  checklist: Array<{ label: string }>;
  next_due_date: string;
  last_performed_at: string | null;
  status: 'scheduled' | 'due' | 'completed' | 'paused';
  equipments?: { code: string; name: string } | null;
  departments?: { name: string } | null;
};

type ExecutionRow = {
  id: string;
  plan_id: string;
  performed_at: string;
  overall_status: 'passed' | 'issues_found';
  notes: string | null;
  created_ticket_id: string | null;
  maintenance_plans?: { title: string } | null;
  equipments?: { code: string; name: string } | null;
  profiles?: { full_name: string } | null;
};

type OptionItem = { id: string; name: string; code?: string };

const FREQ_LABELS: Record<PlanRow['frequency'], string> = {
  daily: 'Günlük',
  weekly: 'Haftalık',
  monthly: 'Aylık',
  quarterly: '3 Aylık',
  yearly: 'Yıllık',
};

export default function MaintenancePage() {
  const { profile } = useDashboardAuth();
  const canManage =
    profile?.role === 'system_admin' ||
    profile?.role === 'technical_manager' ||
    hasModulePermission(profile, 'maintenance', 'manage');

  const queryClient = useQueryClient();
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Yeni plan modalı
  const [showNew, setShowNew] = useState(false);
  const [title, setTitle] = useState('');
  const [equipmentId, setEquipmentId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [frequency, setFrequency] = useState<PlanRow['frequency']>('daily');
  const [nextDueDate, setNextDueDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [checklistText, setChecklistText] = useState(
    'Genel görsel ve ses/titreşim kontrolü\nBasınç / sıcaklık değerleri normal aralıkta\nKaçak, sızıntı veya anormal ısınma yok\nPano ve emniyet elemanları aktif'
  );
  const [saving, setSaving] = useState(false);

  // Checklist icra modalı
  const [execPlan, setExecPlan] = useState<PlanRow | null>(null);
  const [execItems, setExecItems] = useState<Array<{ label: string; ok: boolean; note: string }>>([]);
  const [execNotes, setExecNotes] = useState('');
  const [autoTicket, setAutoTicket] = useState(true);
  const [submittingExec, setSubmittingExec] = useState(false);

  const { data: pageData, isLoading: loading } = useQuery({
    queryKey: ['cmms', 'maintenance'],
    queryFn: async () => {
      const supabase = createClient();
      const [pRes, eRes, eqRes, dRes] = await Promise.all([
        supabase
          .from('maintenance_plans')
          .select('id, equipment_id, department_id, title, frequency, checklist, next_due_date, last_performed_at, status, equipments(code, name), departments(name)')
          .order('next_due_date', { ascending: true }),
        supabase
          .from('maintenance_executions')
          .select('id, plan_id, performed_at, overall_status, notes, created_ticket_id, maintenance_plans(title), equipments(code, name), profiles(full_name)')
          .order('performed_at', { ascending: false })
          .limit(50),
        supabase.from('equipments').select('id, code, name').eq('is_active', true).order('name').limit(300),
        supabase.from('departments').select('id, name').eq('is_active', true).order('name'),
      ]);
      if (pRes.error) throw pRes.error;
      return {
        plans: (pRes.data as unknown as PlanRow[]) ?? [],
        executions: (eRes.data as unknown as ExecutionRow[]) ?? [],
        equipments: (eqRes.data as OptionItem[]) ?? [],
        departments: (dRes.data as OptionItem[]) ?? [],
      };
    },
  });

  const plans = useMemo(() => pageData?.plans ?? [], [pageData]);
  const executions = useMemo(() => pageData?.executions ?? [], [pageData]);
  const equipments = useMemo(() => pageData?.equipments ?? [], [pageData]);
  const departments = useMemo(() => pageData?.departments ?? [], [pageData]);

  const loadAll = async () => {
    await queryClient.invalidateQueries({ queryKey: ['cmms', 'maintenance'] });
  };

  const todayIso = new Date().toISOString().slice(0, 10);
  const stats = useMemo(() => {
    const overdue = plans.filter((p) => p.status !== 'paused' && p.next_due_date <= todayIso).length;
    const daily = plans.filter((p) => p.frequency === 'daily').length;
    const issues = executions.filter((e) => e.overall_status === 'issues_found').length;
    return { total: plans.length, overdue, daily, issues };
  }, [plans, executions, todayIso]);

  async function handleCreatePlan(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !equipmentId) return;
    setSaving(true);
    setMsg(null);
    try {
      const supabase = createClient();
      const checklist = checklistText
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .map((label) => ({ label }));
      const { error } = await supabase.from('maintenance_plans').insert({
        title: title.trim(),
        equipment_id: equipmentId,
        department_id: departmentId || null,
        frequency,
        next_due_date: nextDueDate,
        checklist,
        status: nextDueDate <= todayIso ? 'due' : 'scheduled',
        created_by: profile?.id ?? null,
      });
      if (error) throw error;
      setMsg({ type: 'ok', text: 'Planlı bakım & kontrol listesi oluşturuldu.' });
      setShowNew(false);
      setTitle('');
      await loadAll();
    } catch (err) {
      setMsg({ type: 'err', text: err instanceof Error ? err.message : 'Plan oluşturulamadı.' });
    } finally {
      setSaving(false);
    }
  }

  function openExecuteModal(plan: PlanRow) {
    const base = Array.isArray(plan.checklist) && plan.checklist.length > 0
      ? plan.checklist.map((c) => ({ label: c.label || 'Kontrol maddesi', ok: true, note: '' }))
      : [{ label: 'Genel teknik çalışma kontrolü', ok: true, note: '' }];
    setExecPlan(plan);
    setExecItems(base);
    setExecNotes('');
    setAutoTicket(true);
  }

  async function handleSubmitExecution(e: React.FormEvent) {
    e.preventDefault();
    if (!execPlan) return;
    setSubmittingExec(true);
    setMsg(null);
    try {
      const supabase = createClient();
      const { data, error } = await supabase.rpc('rpc_complete_maintenance_execution', {
        p_plan_id: execPlan.id,
        p_checklist_results: execItems,
        p_notes: execNotes.trim() || null,
        p_create_ticket_on_issue: autoTicket,
      });
      if (error) throw error;
      const createdTicketId = (data as { created_ticket_id?: string | null } | null)?.created_ticket_id;
      setMsg({
        type: 'ok',
        text: createdTicketId
          ? 'Checklist tamamlandı ve uygunsuzluk için otomatik Arıza Kaydı açıldı.'
          : 'Planlı bakım kontrolü başarıyla tamamlandı ve bir sonraki dönem planlandı.',
      });
      setExecPlan(null);
      await loadAll();
    } catch (err) {
      setMsg({ type: 'err', text: err instanceof Error ? err.message : 'Kontrol kaydedilemedi.' });
    } finally {
      setSubmittingExec(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400">
            KURUMSAL CMMS · PERİYODİK BAKIM
          </div>
          <h1 className="mt-0.5 text-2xl font-extrabold text-navy">
            Planlı Bakım & Günlük Saha Checklist
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Kazan dairesi, chiller, jeneratör, yangın pompası ve trafo rutinleri; uygunsuzlukta tek tıkla otomatik arıza kaydı.
          </p>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={() => setShowNew(true)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-navy px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-navy-hover"
          >
            <Plus className="h-4 w-4" />
            Yeni Bakım Planı
          </button>
        )}
      </div>

      {/* KPI Kartları */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-[11px] font-extrabold uppercase text-slate-400">Aktif Bakım Planı</div>
          <div className="mt-1 text-2xl font-extrabold text-navy">{stats.total}</div>
        </div>
        <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4">
          <div className="text-[11px] font-extrabold uppercase text-amber-800">Bugün / Gecikmiş</div>
          <div className="mt-1 text-2xl font-extrabold text-amber-700">{stats.overdue}</div>
        </div>
        <div className="rounded-2xl border border-cyan-200 bg-cyan-50/70 p-4">
          <div className="text-[11px] font-extrabold uppercase text-cyan-900">Günlük Checklist</div>
          <div className="mt-1 text-2xl font-extrabold text-cyan-800">{stats.daily}</div>
        </div>
        <div className="rounded-2xl border border-rose-200 bg-rose-50/70 p-4">
          <div className="text-[11px] font-extrabold uppercase text-rose-800">Son Uygunsuzluklar</div>
          <div className="mt-1 text-2xl font-extrabold text-rose-700">{stats.issues}</div>
        </div>
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

      {/* Aktif Planlar */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-3.5 text-sm font-extrabold text-navy">
          Periyodik Bakım Takvimi ({plans.length})
        </div>
        {loading ? (
          <div className="p-8 text-center text-sm text-slate-400">Yükleniyor...</div>
        ) : plans.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-400">
            Henüz bakım planı eklenmedi. Yukarıdaki &ldquo;Yeni Bakım Planı&rdquo; butonuyla ilk günlük/aylık checklisti tanımlayın.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-canvas text-[11px] font-extrabold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-3">Plan & Ekipman</th>
                  <th className="px-4 py-3">Periyot</th>
                  <th className="px-4 py-3">Sıradaki Tarih</th>
                  <th className="px-4 py-3">Son Uygulama</th>
                  <th className="px-4 py-3 text-right">İşlem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {plans.map((p) => {
                  const isDue = p.next_due_date <= todayIso;
                  return (
                    <tr key={p.id} className="hover:bg-canvas/50">
                      <td className="px-4 py-3">
                        <div className="font-bold text-slate-900">{p.title}</div>
                        <div className="text-xs text-slate-500">
                          {p.equipments ? `${p.equipments.code} – ${p.equipments.name}` : '-'}
                          {p.departments?.name ? ` · ${p.departments.name}` : ''}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="rounded-full bg-navy-soft px-2.5 py-0.5 text-xs font-bold text-navy">
                          {FREQ_LABELS[p.frequency] ?? p.frequency}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold ${
                            isDue ? 'bg-amber-100 text-amber-900' : 'bg-emerald-50 text-emerald-700'
                          }`}
                        >
                          <CalendarClock className="h-3.5 w-3.5" />
                          {formatDate(p.next_due_date)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">
                        {p.last_performed_at ? formatDateTime(p.last_performed_at) : 'Henüz yapılmadı'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => openExecuteModal(p)}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700"
                        >
                          <ClipboardCheck className="h-3.5 w-3.5" />
                          Kontrolü Uygula
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Son İcra Geçmişi */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-3.5 text-sm font-extrabold text-navy">
          Son Tamamlanan Bakım & Checklist Kayıtları ({executions.length})
        </div>
        <div className="divide-y divide-slate-100">
          {executions.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-400">Henüz icra kaydı bulunmuyor.</div>
          ) : (
            executions.map((ex) => (
              <div key={ex.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-xs">
                <div>
                  <div className="font-bold text-slate-900">
                    {ex.maintenance_plans?.title ?? 'Bakım Kontrolü'}{' '}
                    <span className="font-normal text-slate-500">
                      ({ex.equipments ? `${ex.equipments.code} - ${ex.equipments.name}` : '-'})
                    </span>
                  </div>
                  <div className="mt-0.5 text-slate-500">
                    {ex.profiles?.full_name ?? 'Teknik Ekip'} · {formatDateTime(ex.performed_at)}
                    {ex.notes ? ` · ${ex.notes}` : ''}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {ex.overall_status === 'passed' ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 font-bold text-emerald-800">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Uygun
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2.5 py-0.5 font-bold text-rose-800">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      Uygunsuzluk {ex.created_ticket_id ? '· Arıza Açıldı' : ''}
                    </span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Yeni Plan Modalı */}
      {showNew && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <form
            onSubmit={handleCreatePlan}
            className="w-full max-w-lg space-y-4 rounded-2xl bg-white p-6 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-extrabold text-navy">Yeni Planlı Bakım / Checklist</h2>
              <button type="button" onClick={() => setShowNew(false)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100">
                <X className="h-4 w-4" />
              </button>
            </div>
            <input
              required
              placeholder="Bakım başlığı (örn. Kazan Dairesi Günlük Basınç & Sıcaklık Kontrolü)"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <select
                required
                value={equipmentId}
                onChange={(e) => setEquipmentId(e.target.value)}
                className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
              >
                <option value="">Ekipman Seçiniz *</option>
                {equipments.map((eq) => (
                  <option key={eq.id} value={eq.id}>
                    {eq.code ? `${eq.code} – ` : ''}{eq.name}
                  </option>
                ))}
              </select>
              <select
                value={departmentId}
                onChange={(e) => setDepartmentId(e.target.value)}
                className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
              >
                <option value="">Departman (Opsiyonel)</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <select
                value={frequency}
                onChange={(e) => setFrequency(e.target.value as PlanRow['frequency'])}
                className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
              >
                <option value="daily">Günlük</option>
                <option value="weekly">Haftalık</option>
                <option value="monthly">Aylık</option>
                <option value="quarterly">3 Aylık</option>
                <option value="yearly">Yıllık</option>
              </select>
              <input
                type="date"
                required
                value={nextDueDate}
                onChange={(e) => setNextDueDate(e.target.value)}
                className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-600">
                Checklist Maddeleri (Her satır bir kontrol maddesi)
              </label>
              <textarea
                rows={4}
                value={checklistText}
                onChange={(e) => setChecklistText(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowNew(false)} className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-600">
                Vazgeç
              </button>
              <button type="submit" disabled={saving} className="rounded-xl bg-navy px-4 py-2 text-xs font-bold text-white hover:bg-navy-hover disabled:opacity-50">
                {saving ? 'Kaydediliyor...' : 'Planı Kaydet'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Checklist İcra Modalı */}
      {execPlan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <form
            onSubmit={handleSubmitExecution}
            className="max-h-[90vh] w-full max-w-xl space-y-4 overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-extrabold text-navy">{execPlan.title}</h2>
                <p className="text-xs text-slate-500">
                  {execPlan.equipments ? `${execPlan.equipments.code} – ${execPlan.equipments.name}` : ''}
                </p>
              </div>
              <button type="button" onClick={() => setExecPlan(null)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-2.5">
              {execItems.map((it, idx) => (
                <div key={idx} className="rounded-xl border border-slate-200 bg-canvas p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-slate-800">{idx + 1}. {it.label}</span>
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          setExecItems((prev) => prev.map((x, i) => (i === idx ? { ...x, ok: true } : x)))
                        }
                        className={`rounded-lg px-2.5 py-1 text-[11px] font-bold ${
                          it.ok ? 'bg-emerald-600 text-white' : 'bg-white text-slate-600 border border-slate-200'
                        }`}
                      >
                        Uygun
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setExecItems((prev) => prev.map((x, i) => (i === idx ? { ...x, ok: false } : x)))
                        }
                        className={`rounded-lg px-2.5 py-1 text-[11px] font-bold ${
                          !it.ok ? 'bg-rose-600 text-white' : 'bg-white text-slate-600 border border-slate-200'
                        }`}
                      >
                        Uygun Değil
                      </button>
                    </div>
                  </div>
                  {!it.ok && (
                    <input
                      type="text"
                      placeholder="Tespit edilen uygunsuzluk detayı..."
                      value={it.note}
                      onChange={(e) =>
                        setExecItems((prev) =>
                          prev.map((x, i) => (i === idx ? { ...x, note: e.target.value } : x))
                        )
                      }
                      className="mt-2 w-full rounded-lg border border-rose-200 bg-white px-2.5 py-1.5 text-xs"
                    />
                  )}
                </div>
              ))}
            </div>

            <label className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
              <input
                type="checkbox"
                checked={autoTicket}
                onChange={(e) => setAutoTicket(e.target.checked)}
              />
              <Wrench className="h-3.5 w-3.5 text-amber-700" />
              &ldquo;Uygun Değil&rdquo; işaretlenen madde varsa İş Takip modülünde otomatik Arıza Kaydı aç
            </label>

            <textarea
              rows={2}
              placeholder="Genel bakım notu (opsiyonel)..."
              value={execNotes}
              onChange={(e) => setExecNotes(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs"
            />

            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setExecPlan(null)} className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-600">
                Vazgeç
              </button>
              <button type="submit" disabled={submittingExec} className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
                {submittingExec ? 'Kaydediliyor...' : 'Kontrolü Tamamla'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

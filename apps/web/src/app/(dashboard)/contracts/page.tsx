'use client';

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Building2,
  FileSignature,
  Plus,
  ShieldCheck,
  X,
} from 'lucide-react';
import { createClient } from '@/core/supabase/client';
import { formatDate } from '@/core/constants';
import { useDashboardAuth } from '@/core/DashboardContext';
import { hasModulePermission } from '@/core/permissions';

type VendorRow = {
  id: string;
  name: string;
  service_category: string;
  contact_name: string | null;
  contact_phone: string | null;
  rating: number;
};

type ContractRow = {
  id: string;
  vendor_id: string;
  title: string;
  contract_number: string | null;
  start_date: string;
  end_date: string;
  monthly_cost: number;
  currency: string;
  sla_response_hours: number;
  equipment_scope: string | null;
  status: string;
  vendors?: { name: string; service_category: string; contact_phone: string | null } | null;
};

type ServiceReportRow = {
  id: string;
  service_date: string;
  service_type: 'periodic' | 'breakdown' | 'inspection';
  label_status: 'green' | 'blue' | 'yellow' | 'red' | 'none';
  summary: string;
  technician_name: string | null;
  vendors?: { name: string } | null;
  maintenance_contracts?: { title: string } | null;
};

const CAT_LABELS: Record<string, string> = {
  asansor: 'Asansör',
  yuruyen_merdiven: 'Yürüyen Merdiven',
  jenerator: 'Jeneratör',
  chiller: 'Chiller / HVAC',
  yangin: 'Yangın Algılama / Söndürme',
  trafo: 'Trafo / YG İşletme',
  diger: 'Diğer',
};

const LABEL_BADGE: Record<ServiceReportRow['label_status'], { text: string; cls: string }> = {
  green: { text: 'Yeşil Etiket', cls: 'bg-emerald-100 text-emerald-800' },
  blue: { text: 'Mavi Etiket', cls: 'bg-sky-100 text-sky-800' },
  yellow: { text: 'Sarı Etiket', cls: 'bg-amber-100 text-amber-900' },
  red: { text: 'Kırmızı Etiket', cls: 'bg-rose-100 text-rose-800' },
  none: { text: 'Standart Form', cls: 'bg-slate-100 text-slate-600' },
};

export default function ContractsPage() {
  const { profile } = useDashboardAuth();
  const canManage =
    profile?.role === 'system_admin' ||
    profile?.role === 'technical_manager' ||
    hasModulePermission(profile, 'contracts', 'manage');

  const queryClient = useQueryClient();
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const [modal, setModal] = useState<'vendor' | 'contract' | 'report' | null>(null);
  const [saving, setSaving] = useState(false);

  // Firma form
  const [vName, setVName] = useState('');
  const [vCat, setVCat] = useState('asansor');
  const [vContact, setVContact] = useState('');
  const [vPhone, setVPhone] = useState('');

  // Sözleşme form
  const [cVendorId, setCVendorId] = useState('');
  const [cTitle, setCTitle] = useState('');
  const [cStart, setCStart] = useState(() => new Date().toISOString().slice(0, 10));
  const [cEnd, setCEnd] = useState('');
  const [cCost, setCCost] = useState('0');
  const [cScope, setCScope] = useState('');

  // Servis Raporu form
  const [rVendorId, setRVendorId] = useState('');
  const [rContractId, setRContractId] = useState('');
  const [rDate, setRDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [rType, setRType] = useState<ServiceReportRow['service_type']>('periodic');
  const [rLabel, setRLabel] = useState<ServiceReportRow['label_status']>('none');
  const [rTech, setRTech] = useState('');
  const [rSummary, setRSummary] = useState('');

  const { data: pageData, isLoading: loading } = useQuery({
    queryKey: ['cmms', 'contracts'],
    queryFn: async () => {
      const supabase = createClient();
      const [vRes, cRes, rRes] = await Promise.all([
        supabase.from('vendors').select('id, name, service_category, contact_name, contact_phone, rating').eq('is_active', true).order('name'),
        supabase
          .from('maintenance_contracts')
          .select('id, vendor_id, title, contract_number, start_date, end_date, monthly_cost, currency, sla_response_hours, equipment_scope, status, vendors(name, service_category, contact_phone)')
          .order('end_date', { ascending: true }),
        supabase
          .from('service_reports')
          .select('id, service_date, service_type, label_status, summary, technician_name, vendors(name), maintenance_contracts(title)')
          .order('service_date', { ascending: false })
          .limit(40),
      ]);
      if (vRes.error) throw vRes.error;
      return {
        vendors: (vRes.data as VendorRow[]) ?? [],
        contracts: (cRes.data as unknown as ContractRow[]) ?? [],
        reports: (rRes.data as unknown as ServiceReportRow[]) ?? [],
      };
    },
  });

  const vendors = useMemo(() => pageData?.vendors ?? [], [pageData]);
  const contracts = useMemo(() => pageData?.contracts ?? [], [pageData]);
  const reports = useMemo(() => pageData?.reports ?? [], [pageData]);

  const loadAll = async () => {
    await queryClient.invalidateQueries({ queryKey: ['cmms', 'contracts'] });
  };

  const stats = useMemo(() => {
    const nowMs = Date.now();
    const soon = contracts.filter((c) => {
      const diffDays = (new Date(c.end_date).getTime() - nowMs) / 86400000;
      return diffDays <= 45;
    }).length;
    const monthlySum = contracts.reduce((s, c) => s + Number(c.monthly_cost || 0), 0);
    return { vendors: vendors.length, contracts: contracts.length, soon, monthlySum };
  }, [vendors, contracts]);

  async function saveVendor(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.from('vendors').insert({
        name: vName.trim(),
        service_category: vCat,
        contact_name: vContact.trim() || null,
        contact_phone: vPhone.trim() || null,
      });
      if (error) throw error;
      setMsg({ type: 'ok', text: 'Dış servis / taşeron firma kaydedildi.' });
      setModal(null);
      setVName('');
      setVContact('');
      setVPhone('');
      await loadAll();
    } catch (err) {
      setMsg({ type: 'err', text: err instanceof Error ? err.message : 'Firma kaydedilemedi.' });
    } finally {
      setSaving(false);
    }
  }

  async function saveContract(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.from('maintenance_contracts').insert({
        vendor_id: cVendorId,
        title: cTitle.trim(),
        start_date: cStart,
        end_date: cEnd,
        monthly_cost: Number(cCost) || 0,
        equipment_scope: cScope.trim() || null,
        created_by: profile?.id ?? null,
      });
      if (error) throw error;
      setMsg({ type: 'ok', text: 'Bakım sözleşmesi kaydedildi.' });
      setModal(null);
      setCTitle('');
      setCScope('');
      await loadAll();
    } catch (err) {
      setMsg({ type: 'err', text: err instanceof Error ? err.message : 'Sözleşme kaydedilemedi.' });
    } finally {
      setSaving(false);
    }
  }

  async function saveReport(e: React.FormEvent) {
    e.preventDefault();
    if (!profile?.id) return;
    setSaving(true);
    setMsg(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.from('service_reports').insert({
        vendor_id: rVendorId,
        contract_id: rContractId || null,
        service_date: rDate,
        service_type: rType,
        label_status: rLabel,
        technician_name: rTech.trim() || null,
        summary: rSummary.trim(),
        recorded_by: profile.id,
      });
      if (error) throw error;
      setMsg({ type: 'ok', text: 'Dış servis / yasal denetim raporu kaydedildi.' });
      setModal(null);
      setRSummary('');
      setRTech('');
      await loadAll();
    } catch (err) {
      setMsg({ type: 'err', text: err instanceof Error ? err.message : 'Servis raporu kaydedilemedi.' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400">
            KURUMSAL CMMS · TAŞERON & YASAL DENETİM
          </div>
          <h1 className="mt-0.5 text-2xl font-extrabold text-navy">
            Dış Servis, Bakım Sözleşmeleri & Etiket Takibi
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Asansör, yürüyen merdiven, jeneratör, chiller ve yangın sistemleri sözleşme bitiş alarmları ve yasal servis formları.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canManage && (
            <>
              <button type="button" onClick={() => setModal('vendor')} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">
                <Building2 className="h-3.5 w-3.5 text-navy" />
                Firma Ekle
              </button>
              <button type="button" onClick={() => setModal('contract')} className="inline-flex items-center gap-1.5 rounded-xl bg-navy px-3.5 py-2 text-xs font-bold text-white hover:bg-navy-hover">
                <Plus className="h-3.5 w-3.5" />
                Sözleşme Ekle
              </button>
            </>
          )}
          <button type="button" onClick={() => setModal('report')} className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-emerald-700">
            <ShieldCheck className="h-3.5 w-3.5" />
            Servis Formu İşle
          </button>
        </div>
      </div>

      {/* KPI Kartları */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-[11px] font-extrabold uppercase text-slate-400">Kayıtlı Firma</div>
          <div className="mt-1 text-2xl font-extrabold text-navy">{stats.vendors}</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-[11px] font-extrabold uppercase text-slate-400">Aktif Sözleşme</div>
          <div className="mt-1 text-2xl font-extrabold text-navy">{stats.contracts}</div>
        </div>
        <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4">
          <div className="text-[11px] font-extrabold uppercase text-amber-800">45 Gün İçinde Biten</div>
          <div className="mt-1 text-2xl font-extrabold text-amber-700">{stats.soon}</div>
        </div>
        <div className="rounded-2xl border border-cyan-200 bg-cyan-50/70 p-4">
          <div className="text-[11px] font-extrabold uppercase text-cyan-900">Aylık Bakım Bütçesi</div>
          <div className="mt-1 text-2xl font-extrabold text-cyan-800">
            ₺{stats.monthlySum.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}
          </div>
        </div>
      </div>

      {msg && (
        <div className={`rounded-xl border p-3 text-sm font-medium ${msg.type === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-700'}`}>
          {msg.text}
        </div>
      )}

      {/* Sözleşmeler */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3.5 text-sm font-extrabold text-navy">
          <FileSignature className="h-4 w-4" />
          Bakım Sözleşmeleri ({contracts.length})
        </div>
        {loading ? (
          <div className="p-8 text-center text-sm text-slate-400">Yükleniyor...</div>
        ) : contracts.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-400">Henüz bakım sözleşmesi girilmedi.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-canvas text-[11px] font-extrabold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-3">Sözleşme & Firma</th>
                  <th className="px-4 py-3">Kategori</th>
                  <th className="px-4 py-3">Bitiş Tarihi</th>
                  <th className="px-4 py-3">Aylık Bedel</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {contracts.map((c) => {
                  const daysLeft = Math.ceil((new Date(c.end_date).getTime() - Date.now()) / 86400000);
                  return (
                    <tr key={c.id} className="hover:bg-canvas/50">
                      <td className="px-4 py-3">
                        <div className="font-bold text-slate-900">{c.title}</div>
                        <div className="text-xs text-slate-500">
                          {c.vendors?.name ?? '-'} {c.equipment_scope ? `· ${c.equipment_scope}` : ''}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs font-semibold text-slate-600">
                        {CAT_LABELS[c.vendors?.service_category ?? 'diger'] ?? 'Diğer'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${daysLeft <= 0 ? 'bg-rose-100 text-rose-800' : daysLeft <= 45 ? 'bg-amber-100 text-amber-900' : 'bg-emerald-50 text-emerald-700'}`}>
                          {formatDate(c.end_date)} ({daysLeft <= 0 ? 'Süresi Doldu' : `${daysLeft} gün`})
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs font-extrabold text-navy">
                        ₺{Number(c.monthly_cost || 0).toLocaleString('tr-TR')} / ay
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Servis Raporları */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-3.5 text-sm font-extrabold text-navy">
          Aylık Dış Servis & Yasal Kontrol Formları ({reports.length})
        </div>
        <div className="divide-y divide-slate-100">
          {reports.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-400">Henüz servis formu girilmedi.</div>
          ) : (
            reports.map((r) => {
              const badge = LABEL_BADGE[r.label_status] ?? LABEL_BADGE.none;
              return (
                <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-xs">
                  <div>
                    <div className="font-bold text-slate-900">
                      {r.vendors?.name ?? 'Firma'} {r.maintenance_contracts?.title ? `– ${r.maintenance_contracts.title}` : ''}
                    </div>
                    <div className="mt-0.5 text-slate-600">{r.summary}</div>
                    <div className="mt-0.5 text-[11px] text-slate-400">
                      {formatDate(r.service_date)} {r.technician_name ? `· Servis Teknisyeni: ${r.technician_name}` : ''}
                    </div>
                  </div>
                  <span className={`rounded-full px-2.5 py-0.5 font-bold ${badge.cls}`}>{badge.text}</span>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Modallar */}
      {modal === 'vendor' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <form onSubmit={saveVendor} className="w-full max-w-md space-y-3 rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-extrabold text-navy">Yeni Taşeron / Dış Servis Firması</h2>
              <button type="button" onClick={() => setModal(null)}><X className="h-4 w-4 text-slate-400" /></button>
            </div>
            <input required placeholder="Firma Adı (örn. Otis Asansör A.Ş.)" value={vName} onChange={(e) => setVName(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />
            <select value={vCat} onChange={(e) => setVCat(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm">
              {Object.entries(CAT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <input placeholder="Yetkili Kişi" value={vContact} onChange={(e) => setVContact(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />
            <input placeholder="Telefon" value={vPhone} onChange={(e) => setVPhone(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setModal(null)} className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-600">Vazgeç</button>
              <button type="submit" disabled={saving} className="rounded-xl bg-navy px-4 py-2 text-xs font-bold text-white">{saving ? 'Kaydediliyor...' : 'Kaydet'}</button>
            </div>
          </form>
        </div>
      )}

      {modal === 'contract' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <form onSubmit={saveContract} className="w-full max-w-md space-y-3 rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-extrabold text-navy">Yeni Bakım Sözleşmesi</h2>
              <button type="button" onClick={() => setModal(null)}><X className="h-4 w-4 text-slate-400" /></button>
            </div>
            <select required value={cVendorId} onChange={(e) => setCVendorId(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm">
              <option value="">Firma Seçiniz *</option>
              {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
            <input required placeholder="Sözleşme Adı (örn. 2026 Asansör & Yürüyen Merdiven Bakımı)" value={cTitle} onChange={(e) => setCTitle(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />
            <div className="grid gap-3 sm:grid-cols-2">
              <input type="date" required value={cStart} onChange={(e) => setCStart(e.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm" />
              <input type="date" required value={cEnd} onChange={(e) => setCEnd(e.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm" />
            </div>
            <input type="number" step="0.01" placeholder="Aylık Bedel (TRY)" value={cCost} onChange={(e) => setCCost(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />
            <input placeholder="Kapsam (örn. 12 Asansör, 18 Yürüyen Merdiven)" value={cScope} onChange={(e) => setCScope(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setModal(null)} className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-600">Vazgeç</button>
              <button type="submit" disabled={saving} className="rounded-xl bg-navy px-4 py-2 text-xs font-bold text-white">{saving ? 'Kaydediliyor...' : 'Kaydet'}</button>
            </div>
          </form>
        </div>
      )}

      {modal === 'report' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <form onSubmit={saveReport} className="w-full max-w-md space-y-3 rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-extrabold text-navy">Dış Servis / Etiket Formu İşle</h2>
              <button type="button" onClick={() => setModal(null)}><X className="h-4 w-4 text-slate-400" /></button>
            </div>
            <select required value={rVendorId} onChange={(e) => setRVendorId(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm">
              <option value="">Firma Seçiniz *</option>
              {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
            <select value={rContractId} onChange={(e) => setRContractId(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm">
              <option value="">Bağlı Sözleşme (Opsiyonel)</option>
              {contracts.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
            <div className="grid gap-3 sm:grid-cols-2">
              <input type="date" required value={rDate} onChange={(e) => setRDate(e.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm" />
              <select value={rLabel} onChange={(e) => setRLabel(e.target.value as ServiceReportRow['label_status'])} className="rounded-xl border border-slate-200 px-3 py-2 text-sm">
                <option value="none">Standart Bakım Formu</option>
                <option value="green">Yeşil Etiket (Kusursuz)</option>
                <option value="blue">Mavi Etiket (Hafif Kusur)</option>
                <option value="yellow">Sarı Etiket (Kusurlu)</option>
                <option value="red">Kırmızı Etiket (Güvensiz)</option>
              </select>
            </div>
            <input placeholder="Gelen Servis Teknisyeni" value={rTech} onChange={(e) => setRTech(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />
            <textarea required rows={3} placeholder="Yapılan bakım / denetim özeti..." value={rSummary} onChange={(e) => setRSummary(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setModal(null)} className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-600">Vazgeç</button>
              <button type="submit" disabled={saving} className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white">{saving ? 'Kaydediliyor...' : 'Formu Kaydet'}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Cpu,
  Eye,
  FileDown,
  FileSpreadsheet,
  Pencil,
  Plus,
  Search,
  Trash2,
  Wrench,
  X,
  Zap,
} from 'lucide-react';
import { createClient } from '@/core/supabase/client';
import { formatDate, formatDateTime, TICKET_STATUS_LABELS, WORK_ORDER_STATUS_LABELS } from '@/core/constants';
import { hasCoreAction } from '@/core/permissions';
import {
  exportExcelXml,
  exportPrintablePdf,
  ReportCell,
} from '@/core/utils/report-export';
import {
  Department,
  Equipment,
  Meter,
  Profile,
  TicketPriority,
  TicketStatus,
  WorkOrderStatus,
} from '@/types/database';

type EquipmentRow = Equipment & {
  departments?: { name: string } | null;
  locations?: { name: string; floors?: { name: string } | null } | null;
};

type LocationOpt = {
  id: string;
  name: string;
  floors?: { name: string } | null;
};

type Equipment360Summary = {
  equipment_id: string;
  equipment_code: string;
  equipment_name: string;
  equipment_type: string;
  equipment_status: string;
  linked_meters_count: number;
  total_energy_consumption: number;
  latest_reading_date: string | null;
  total_tickets_count: number;
  open_tickets_count: number;
  active_work_orders_count: number;
  maintenance_plans_count: number;
  due_maintenance_count: number;
};

type EquipmentFormState = {
  id: string | null;
  code: string;
  name: string;
  equipment_type: string;
  department_id: string;
  location_id: string;
  brand: string;
  model: string;
  serial_number: string;
  warranty_end_date: string;
  status: Equipment['status'];
  is_active: boolean;
};

const EQUIPMENT_TYPES: { value: string; label: string }[] = [
  { value: 'chiller', label: 'Chiller / Soğutma Grubu' },
  { value: 'hvac', label: 'Klima Santrali / AHU' },
  { value: 'transformer', label: 'Trafo / Orta Gerilim' },
  { value: 'generator', label: 'Jeneratör' },
  { value: 'panel', label: 'Elektrik Panosu (ADP/TDP)' },
  { value: 'elevator', label: 'Asansör' },
  { value: 'escalator', label: 'Yürüyen Merdiven' },
  { value: 'boiler', label: 'Kazan / Isıtma' },
  { value: 'pump', label: 'Hidrofor / Pompa' },
  { value: 'cooling_tower', label: 'Soğutma Kulesi' },
  { value: 'other', label: 'Diğer Ekipman' },
];

const STATUS_LABELS: Record<Equipment['status'], string> = {
  active: 'Aktif',
  maintenance: 'Bakımda',
  out_of_service: 'Arızalı / Devre Dışı',
  retired: 'Hurda / Emekli',
};

function statusBadgeClass(status: Equipment['status'], isActive: boolean): string {
  if (!isActive) return 'bg-slate-200 text-slate-600';
  switch (status) {
    case 'active':
      return 'bg-emerald-100 text-emerald-700';
    case 'maintenance':
      return 'bg-amber-100 text-amber-800';
    case 'out_of_service':
      return 'bg-red-100 text-red-700';
    case 'retired':
      return 'bg-slate-200 text-slate-700';
  }
}

function typeLabel(t: string): string {
  return EQUIPMENT_TYPES.find((x) => x.value === t)?.label ?? t;
}

export default function AdminEquipmentsPage() {
  const [currentProfile, setCurrentProfile] = useState<Profile | null>(null);
  const [rows, setRows] = useState<EquipmentRow[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [locations, setLocations] = useState<LocationOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Filtreler
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | Equipment['status']>('all');
  const [deptFilter, setDeptFilter] = useState('');

  // Ekle / Düzenle Modalı
  const [formModal, setFormModal] = useState<EquipmentFormState | null>(null);

  // Ekipman 360° Modalı
  const [detailEq, setDetailEq] = useState<EquipmentRow | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [summary360, setSummary360] = useState<Equipment360Summary | null>(null);
  const [linkedMeters, setLinkedMeters] = useState<Meter[]>([]);
  const [linkedTickets, setLinkedTickets] = useState<
    Array<{
      id: string;
      ticket_number: string | null;
      description: string;
      status: TicketStatus;
      priority: TicketPriority;
      created_at: string;
    }>
  >([]);
  const [linkedWOs, setLinkedWOs] = useState<
    Array<{
      id: string;
      status: WorkOrderStatus;
      work_description: string | null;
      created_at: string;
      departments?: { name: string } | null;
    }>
  >([]);

  const canManage =
    currentProfile?.role === 'system_admin' ||
    hasCoreAction(currentProfile, 'manage_equipments');

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        const { data: prof } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', user.id)
          .single();
        if (prof) setCurrentProfile(prof as Profile);
      }

      const [eqRes, dRes, lRes] = await Promise.all([
        supabase
          .from('equipments')
          .select('*, departments(name), locations(name, floors(name))')
          .order('code'),
        supabase.from('departments').select('*').eq('is_active', true).order('name'),
        supabase
          .from('locations')
          .select('id, name, floors(name)')
          .eq('is_active', true)
          .order('name'),
      ]);

      if (eqRes.error) throw eqRes.error;
      setRows((eqRes.data as unknown as EquipmentRow[]) ?? []);
      setDepartments((dRes.data as Department[]) ?? []);
      setLocations((lRes.data as unknown as LocationOpt[]) ?? []);
    } catch (err) {
      setMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Ekipman listesi alınamadı.',
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const counts = useMemo(() => {
    let active = 0;
    let maintenance = 0;
    let disabledOrFault = 0;
    for (const r of rows) {
      if (!r.is_active || r.status === 'out_of_service' || r.status === 'retired') {
        disabledOrFault++;
      } else if (r.status === 'maintenance') {
        maintenance++;
      } else {
        active++;
      }
    }
    return { total: rows.length, active, maintenance, disabledOrFault };
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (deptFilter && r.department_id !== deptFilter) return false;
      if (!q) return true;
      return (
        r.code.toLowerCase().includes(q) ||
        r.name.toLowerCase().includes(q) ||
        (r.brand ?? '').toLowerCase().includes(q) ||
        (r.model ?? '').toLowerCase().includes(q) ||
        (r.serial_number ?? '').toLowerCase().includes(q) ||
        (r.departments?.name ?? '').toLowerCase().includes(q)
      );
    });
  }, [rows, statusFilter, deptFilter, search]);

  function openNewModal() {
    setFormModal({
      id: null,
      code: '',
      name: '',
      equipment_type: 'hvac',
      department_id: '',
      location_id: '',
      brand: '',
      model: '',
      serial_number: '',
      warranty_end_date: '',
      status: 'active',
      is_active: true,
    });
  }

  function openEditModal(eq: EquipmentRow) {
    setFormModal({
      id: eq.id,
      code: eq.code,
      name: eq.name,
      equipment_type: eq.equipment_type || 'other',
      department_id: eq.department_id ?? '',
      location_id: eq.location_id ?? '',
      brand: eq.brand ?? '',
      model: eq.model ?? '',
      serial_number: eq.serial_number ?? '',
      warranty_end_date: eq.warranty_end_date ? eq.warranty_end_date.slice(0, 10) : '',
      status: eq.status,
      is_active: eq.is_active,
    });
  }

  async function handleSaveModal(e: React.FormEvent) {
    e.preventDefault();
    if (!formModal || !formModal.code.trim() || !formModal.name.trim()) return;
    setSaving(true);
    setMsg(null);
    try {
      const supabase = createClient();
      const payload = {
        code: formModal.code.trim().toUpperCase(),
        name: formModal.name.trim(),
        equipment_type: formModal.equipment_type || 'other',
        department_id: formModal.department_id || null,
        location_id: formModal.location_id || null,
        brand: formModal.brand.trim() || null,
        model: formModal.model.trim() || null,
        serial_number: formModal.serial_number.trim() || null,
        warranty_end_date: formModal.warranty_end_date || null,
        status: formModal.status,
        is_active: formModal.is_active,
      };

      if (formModal.id) {
        const { error } = await supabase
          .from('equipments')
          .update(payload)
          .eq('id', formModal.id);
        if (error) throw error;
        setMsg({ type: 'ok', text: `${payload.code} - ${payload.name} güncellendi.` });
      } else {
        const { data: uRes } = await supabase.auth.getUser();
        const { error } = await supabase.from('equipments').insert({
          ...payload,
          created_by: uRes.user?.id ?? null,
        });
        if (error) throw error;
        setMsg({ type: 'ok', text: `${payload.code} - ${payload.name} eklendi.` });
      }

      setFormModal(null);
      await loadAll();
    } catch (err) {
      setMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Ekipman kaydedilemedi.',
      });
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(eq: EquipmentRow) {
    setMsg(null);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from('equipments')
        .update({ is_active: !eq.is_active })
        .eq('id', eq.id);
      if (error) throw error;
      setMsg({
        type: 'ok',
        text: `${eq.code} ${!eq.is_active ? 'aktifleştirildi' : 'pasife alındı'}.`,
      });
      await loadAll();
    } catch (err) {
      setMsg({ type: 'err', text: err instanceof Error ? err.message : 'Güncellenemedi.' });
    }
  }

  async function handleDelete(eq: EquipmentRow) {
    if (!window.confirm(`"${eq.code} - ${eq.name}" ekipmanını silmek istiyor musunuz?`)) {
      return;
    }
    setMsg(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.from('equipments').delete().eq('id', eq.id);
      if (error) throw error;
      setMsg({ type: 'ok', text: `${eq.code} silindi.` });
      await loadAll();
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      setMsg({
        type: 'err',
        text: raw.toLowerCase().includes('foreign key') || raw.includes('23503')
          ? `"${eq.code}" sayaç veya arıza kayıtlarına bağlı olduğu için silinemiyor; bunun yerine "Pasife Al" butonunu kullanabilirsiniz.`
          : `Silinemedi: ${raw}`,
      });
    }
  }

  async function open360Modal(eq: EquipmentRow) {
    setDetailEq(eq);
    setDetailLoading(true);
    setSummary360(null);
    setLinkedMeters([]);
    setLinkedTickets([]);
    setLinkedWOs([]);
    try {
      const supabase = createClient();
      const [sRes, mRes, tRes, woRes] = await Promise.all([
        supabase.rpc('rpc_get_equipment_360_summary', { p_equipment_id: eq.id }),
        supabase
          .from('meters')
          .select('*')
          .eq('equipment_id', eq.id)
          .eq('is_active', true)
          .order('name'),
        supabase
          .from('tickets')
          .select('id, ticket_number, description, status, priority, created_at')
          .eq('equipment_id', eq.id)
          .order('created_at', { ascending: false })
          .limit(10),
        supabase
          .from('work_orders')
          .select('id, status, work_description, created_at, departments(name)')
          .eq('equipment_id', eq.id)
          .order('created_at', { ascending: false })
          .limit(10),
      ]);

      const sumRow = Array.isArray(sRes.data) ? sRes.data[0] : sRes.data;
      setSummary360((sumRow as Equipment360Summary) ?? null);
      setLinkedMeters((mRes.data as Meter[]) ?? []);
      setLinkedTickets(
        (tRes.data as Array<{
          id: string;
          ticket_number: string | null;
          description: string;
          status: TicketStatus;
          priority: TicketPriority;
          created_at: string;
        }>) ?? []
      );
      setLinkedWOs(
        (woRes.data as unknown as Array<{
          id: string;
          status: WorkOrderStatus;
          work_description: string | null;
          created_at: string;
          departments?: { name: string } | null;
        }>) ?? []
      );
    } catch (err) {
      setMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Ekipman 360° özeti yüklenemedi.',
      });
    } finally {
      setDetailLoading(false);
    }
  }

  function buildReportData() {
    const headers = [
      'Kod',
      'Ekipman Adı',
      'Tip',
      'Departman',
      'Konum',
      'Marka / Model',
      'Seri No',
      'Garanti Bitiş',
      'Durum',
      'Aktif',
    ];
    const reportRows: ReportCell[][] = filtered.map((eq) => {
      const loc = eq.locations
        ? `${eq.locations.floors?.name ? `${eq.locations.floors.name} - ` : ''}${eq.locations.name}`
        : '-';
      return [
        eq.code,
        eq.name,
        typeLabel(eq.equipment_type),
        eq.departments?.name ?? '-',
        loc,
        [eq.brand, eq.model].filter(Boolean).join(' / ') || '-',
        eq.serial_number ?? '-',
        eq.warranty_end_date ? formatDate(eq.warranty_end_date) : '-',
        STATUS_LABELS[eq.status] ?? eq.status,
        eq.is_active ? 'Evet' : 'Pasif',
      ];
    });
    return { headers, reportRows };
  }

  function handleExportExcel() {
    const { headers, reportRows } = buildReportData();
    exportExcelXml({
      fileName: `avm_tech_ekipman_envanteri_${new Date().toISOString().slice(0, 10)}.xls`,
      sheetName: 'Ekipmanlar',
      title: 'DOWNTOWN TEKNİK · Ortak Teknik Ekipman Envanteri',
      subtitle: `${filtered.length} ekipman listeleniyor`,
      headers,
      rows: reportRows,
    });
  }

  function handleExportPdf() {
    const { headers, reportRows } = buildReportData();
    exportPrintablePdf({
      title: 'Ortak Ekipman Kayıt Sistemi Envanter Raporu',
      subtitle: `${filtered.length} teknik ekipman`,
      kpis: [
        { label: 'Toplam Ekipman', value: String(counts.total), tone: 'navy' },
        { label: 'Aktif Ekipman', value: String(counts.active), tone: 'green' },
        { label: 'Bakımda', value: String(counts.maintenance), tone: 'slate' },
        { label: 'Arızalı / Devre Dışı', value: String(counts.disabledOrFault), tone: 'red' },
      ],
      headers,
      rows: reportRows,
    });
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400">
            ÇEKİRDEK YÖNETİM
          </div>
          <h1 className="mt-0.5 text-2xl font-extrabold text-slate-900">
            Ortak Ekipman Kayıt Sistemi & 360° Geçmiş
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Enerji sayaçları, arıza kayıtları ve bakım geçmişinin ortak bağlandığı teknik envanter.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canManage && (
            <button
              type="button"
              onClick={openNewModal}
              className="inline-flex items-center gap-1.5 rounded-xl bg-navy px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-navy-hover"
            >
              <Plus className="h-3.5 w-3.5" />
              Yeni Ekipman Ekle
            </button>
          )}
          <button
            type="button"
            onClick={handleExportExcel}
            disabled={filtered.length === 0}
            className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2 text-xs font-bold text-emerald-800 hover:bg-emerald-100 disabled:opacity-40"
          >
            <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-700" />
            Excel İndir (.xls)
          </button>
          <button
            type="button"
            onClick={handleExportPdf}
            disabled={filtered.length === 0}
            className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2 text-xs font-bold text-rose-800 hover:bg-rose-100 disabled:opacity-40"
          >
            <FileDown className="h-3.5 w-3.5 text-rose-700" />
            PDF Rapor İndir
          </button>
        </div>
      </div>

      {/* KPI Kartları */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400">
            Toplam Ekipman
          </div>
          <div className="mt-1 text-2xl font-extrabold text-navy">{counts.total}</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400">
            Aktif Çalışan
          </div>
          <div className="mt-1 text-2xl font-extrabold text-emerald-600">{counts.active}</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400">
            Bakımda
          </div>
          <div className="mt-1 text-2xl font-extrabold text-amber-600">
            {counts.maintenance}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400">
            Arızalı / Devre Dışı
          </div>
          <div className="mt-1 text-2xl font-extrabold text-red-600">
            {counts.disabledOrFault}
          </div>
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

      {/* Filtre & Arama Barı */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-3">
        <div className="flex flex-wrap items-center gap-2">
          {(
            [
              ['all', 'Tümü'],
              ['active', 'Aktif'],
              ['maintenance', 'Bakımda'],
              ['out_of_service', 'Arızalı'],
              ['retired', 'Hurda'],
            ] as const
          ).map(([k, lbl]) => (
            <button
              key={k}
              type="button"
              onClick={() => setStatusFilter(k)}
              className={`rounded-full px-3.5 py-1.5 text-xs font-bold transition ${
                statusFilter === k
                  ? 'bg-navy text-white shadow-sm'
                  : 'border border-slate-200 bg-canvas text-slate-700 hover:bg-slate-100'
              }`}
            >
              {lbl}
            </button>
          ))}

          <select
            value={deptFilter}
            onChange={(e) => setDeptFilter(e.target.value)}
            className="rounded-xl border border-slate-200 bg-canvas px-3 py-1.5 text-xs font-bold text-slate-700"
          >
            <option value="">Tüm Departmanlar</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>

        <div className="relative min-w-[240px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Kod, ad, marka, model veya seri no ara..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-canvas py-1.5 pl-9 pr-3 text-sm focus:border-navy focus:outline-none"
          />
        </div>
      </div>

      {/* Ekipman Tablosu */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-canvas text-[11px] font-extrabold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">Kod & Ekipman</th>
                <th className="px-4 py-3">Tip</th>
                <th className="px-4 py-3">Departman / Konum</th>
                <th className="px-4 py-3">Marka / Model</th>
                <th className="px-4 py-3">Garanti</th>
                <th className="px-4 py-3">Durum</th>
                <th className="px-4 py-3 text-right">İşlem</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((eq) => {
                const loc = eq.locations
                  ? `${eq.locations.floors?.name ? `${eq.locations.floors.name} - ` : ''}${eq.locations.name}`
                  : '-';
                return (
                  <tr key={eq.id} className="hover:bg-canvas/60">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-navy-soft text-navy">
                          <Cpu className="h-4 w-4" />
                        </span>
                        <div>
                          <div className="font-extrabold text-navy">{eq.code}</div>
                          <div className="text-xs font-semibold text-slate-800">{eq.name}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs font-medium text-slate-700">
                      {typeLabel(eq.equipment_type)}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <div className="font-bold text-slate-800">
                        {eq.departments?.name ?? '-'}
                      </div>
                      <div className="text-slate-500">{loc}</div>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      <div>{[eq.brand, eq.model].filter(Boolean).join(' / ') || '-'}</div>
                      {eq.serial_number && (
                        <div className="font-mono text-[11px] text-slate-400">
                          SN: {eq.serial_number}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      {eq.warranty_end_date ? formatDate(eq.warranty_end_date) : '-'}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-extrabold ${statusBadgeClass(
                          eq.status,
                          eq.is_active
                        )}`}
                      >
                        {eq.is_active ? STATUS_LABELS[eq.status] : 'Pasif'}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => open360Modal(eq)}
                          className="inline-flex items-center gap-1 rounded-lg border border-turquoise/30 bg-turquoise-soft/60 px-2.5 py-1 text-xs font-bold text-turquoise hover:bg-turquoise-soft"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          360° İncele
                        </button>
                        {canManage && (
                          <>
                            <button
                              type="button"
                              onClick={() => openEditModal(eq)}
                              title="Düzenle"
                              className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:border-navy hover:bg-navy-soft hover:text-navy"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => toggleActive(eq)}
                              className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-bold text-slate-600 hover:bg-slate-50"
                            >
                              {eq.is_active ? 'Pasif' : 'Aktif'}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(eq)}
                              title="Sil"
                              className="rounded-lg border border-slate-200 p-1.5 text-red-600 hover:border-red-300 hover:bg-red-50"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}

              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-slate-500">
                    {loading
                      ? 'Ekipman envanteri yükleniyor...'
                      : 'Kayıtlı ekipman bulunamadı.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Ekipman Ekle / Düzenle Modalı */}
      {formModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
          <form
            onSubmit={handleSaveModal}
            className="max-h-[90vh] w-full max-w-2xl space-y-4 overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h2 className="text-lg font-extrabold text-navy">
                {formModal.id ? 'Ekipman Bilgilerini Düzenle' : 'Yeni Ekipman Ekle'}
              </h2>
              <button
                type="button"
                onClick={() => setFormModal(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-600">
                  Ekipman Kodu *
                </label>
                <input
                  required
                  placeholder="Örn. CHL-01"
                  value={formModal.code}
                  onChange={(e) => setFormModal({ ...formModal, code: e.target.value })}
                  className="w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm font-bold uppercase focus:border-navy focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-600">
                  Ekipman Adı *
                </label>
                <input
                  required
                  placeholder="Örn. Ana Chiller Ünitesi 1"
                  value={formModal.name}
                  onChange={(e) => setFormModal({ ...formModal, name: e.target.value })}
                  className="w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm focus:border-navy focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-600">Ekipman Tipi</label>
                <select
                  value={formModal.equipment_type}
                  onChange={(e) =>
                    setFormModal({ ...formModal, equipment_type: e.target.value })
                  }
                  className="w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm"
                >
                  {EQUIPMENT_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-600">Durum</label>
                <select
                  value={formModal.status}
                  onChange={(e) =>
                    setFormModal({
                      ...formModal,
                      status: e.target.value as Equipment['status'],
                    })
                  }
                  className="w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm"
                >
                  {Object.entries(STATUS_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-600">
                  Sorumlu Departman
                </label>
                <select
                  value={formModal.department_id}
                  onChange={(e) =>
                    setFormModal({ ...formModal, department_id: e.target.value })
                  }
                  className="w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm"
                >
                  <option value="">Seçilmedi</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-600">Konum / Mahal</label>
                <select
                  value={formModal.location_id}
                  onChange={(e) =>
                    setFormModal({ ...formModal, location_id: e.target.value })
                  }
                  className="w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm"
                >
                  <option value="">Seçilmedi</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.floors?.name ? `${l.floors.name} - ` : ''}
                      {l.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-600">Marka</label>
                <input
                  value={formModal.brand}
                  onChange={(e) => setFormModal({ ...formModal, brand: e.target.value })}
                  className="w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-600">Model</label>
                <input
                  value={formModal.model}
                  onChange={(e) => setFormModal({ ...formModal, model: e.target.value })}
                  className="w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-600">Seri No</label>
                <input
                  value={formModal.serial_number}
                  onChange={(e) =>
                    setFormModal({ ...formModal, serial_number: e.target.value })
                  }
                  className="w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-600">
                  Garanti Bitiş Tarihi
                </label>
                <input
                  type="date"
                  value={formModal.warranty_end_date}
                  onChange={(e) =>
                    setFormModal({ ...formModal, warranty_end_date: e.target.value })
                  }
                  className="w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
              <button
                type="button"
                onClick={() => setFormModal(null)}
                className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-700"
              >
                İptal
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-xl bg-navy px-5 py-2 text-xs font-bold text-white hover:bg-navy-hover disabled:opacity-50"
              >
                {saving ? 'Kaydediliyor...' : 'Kaydet'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Ekipman 360° İncele Modalı */}
      {detailEq && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
          <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-2xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <div>
                <div className="text-xs font-extrabold uppercase tracking-wider text-turquoise">
                  EKİPMAN 360° ÇAPRAZ MODÜL GEÇMİŞİ
                </div>
                <h2 className="text-lg font-extrabold text-navy">
                  {detailEq.code} – {detailEq.name}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setDetailEq(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-5 overflow-y-auto p-6">
              {detailLoading ? (
                <div className="py-10 text-center text-sm text-slate-500">
                  360° ekipman verileri yükleniyor...
                </div>
              ) : (
                <>
                  {/* 360 Özet Kutuları */}
                  <div className="grid gap-3 sm:grid-cols-4">
                    <div className="rounded-xl border border-slate-200 bg-canvas p-3">
                      <div className="text-[10px] font-extrabold uppercase text-slate-400">
                        Bağlı Sayaç
                      </div>
                      <div className="mt-1 text-xl font-extrabold text-navy">
                        {summary360?.linked_meters_count ?? linkedMeters.length}
                      </div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-canvas p-3">
                      <div className="text-[10px] font-extrabold uppercase text-slate-400">
                        Kümülatif Tüketim
                      </div>
                      <div className="mt-1 text-xl font-extrabold text-turquoise">
                        {new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 }).format(
                          Number(summary360?.total_energy_consumption ?? 0)
                        )}
                      </div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-canvas p-3">
                      <div className="text-[10px] font-extrabold uppercase text-slate-400">
                        Arıza (Açık / Toplam)
                      </div>
                      <div className="mt-1 text-xl font-extrabold text-slate-900">
                        {summary360?.open_tickets_count ?? 0} /{' '}
                        {summary360?.total_tickets_count ?? linkedTickets.length}
                      </div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-canvas p-3">
                      <div className="text-[10px] font-extrabold uppercase text-slate-400">
                        Aktif İş Emri / Bakım
                      </div>
                      <div className="mt-1 text-xl font-extrabold text-amber-600">
                        {summary360?.active_work_orders_count ?? 0} /{' '}
                        {summary360?.maintenance_plans_count ?? 0}
                      </div>
                    </div>
                  </div>

                  {/* Bağlı Enerji Sayaçları */}
                  <div>
                    <div className="mb-2 flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider text-navy">
                      <Zap className="h-4 w-4 text-amber-500" />
                      Bağlı Enerji Sayaçları ({linkedMeters.length})
                    </div>
                    {linkedMeters.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-slate-200 bg-canvas p-3 text-xs text-slate-400">
                        Bu ekipmana bağlı aktif sayaç yok.
                      </div>
                    ) : (
                      <div className="grid gap-2 sm:grid-cols-2">
                        {linkedMeters.map((m) => (
                          <div
                            key={m.id}
                            className="flex items-center justify-between rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-xs"
                          >
                            <div>
                              <div className="font-bold text-navy">{m.name}</div>
                              <div className="text-slate-500">
                                {m.meter_type === 'electric' ? 'Elektrik' : m.category} · Çarpan x
                                {m.multiplier}
                              </div>
                            </div>
                            <span className="font-mono text-[11px] text-slate-500">
                              {m.meter_no ?? m.eic_code ?? ''}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Son Arızalar */}
                  <div>
                    <div className="mb-2 flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider text-navy">
                      <Activity className="h-4 w-4 text-rose-600" />
                      İlgili Arıza Kayıtları ({linkedTickets.length})
                    </div>
                    {linkedTickets.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-slate-200 bg-canvas p-3 text-xs text-slate-400">
                        Bu ekipman için arıza kaydı açılmamış.
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        {linkedTickets.map((t) => (
                          <div
                            key={t.id}
                            className="flex items-center justify-between rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-xs"
                          >
                            <div className="min-w-0 pr-2">
                              <span className="font-extrabold text-navy">
                                {t.ticket_number ?? '-'}
                              </span>{' '}
                              <span className="text-slate-700">{t.description}</span>
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                              <span className="rounded-full bg-white px-2 py-0.5 font-bold text-slate-700">
                                {TICKET_STATUS_LABELS[t.status] ?? t.status}
                              </span>
                              <span className="text-[11px] text-slate-400">
                                {formatDate(t.created_at)}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Son İş Emirleri */}
                  <div>
                    <div className="mb-2 flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider text-navy">
                      <Wrench className="h-4 w-4 text-turquoise" />
                      Yapılan İş Emirleri ({linkedWOs.length})
                    </div>
                    {linkedWOs.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-slate-200 bg-canvas p-3 text-xs text-slate-400">
                        Bu ekipman için iş emri geçmişi yok.
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        {linkedWOs.map((w) => (
                          <div
                            key={w.id}
                            className="flex items-center justify-between rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-xs"
                          >
                            <div className="min-w-0 pr-2">
                              <span className="font-bold text-navy">
                                {w.departments?.name ?? '-'}
                              </span>{' '}
                              <span className="text-slate-600">
                                {w.work_description ?? 'İş emri'}
                              </span>
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                              <span className="rounded-full bg-white px-2 py-0.5 font-bold text-slate-700">
                                {WORK_ORDER_STATUS_LABELS[w.status] ?? w.status}
                              </span>
                              <span className="text-[11px] text-slate-400">
                                {formatDateTime(w.created_at)}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

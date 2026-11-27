'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Droplets,
  FileDown,
  FileSpreadsheet,
  Flame,
  Gauge,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import { createClient } from '@/core/supabase/client';
import { EQUIPMENT_SELECT } from '@/core/supabase/selects';
import { formatDateTime } from '@/core/constants';
import { useDashboardAuth } from '@/core/DashboardContext';
import { hasModulePermission } from '@/core/permissions';
import {
  exportExcelXml,
  exportPrintablePdf,
  ReportCell,
} from '@/core/utils/report-export';
import { Equipment, Meter, MeterCategory, MeterType, TrashedMeter } from '@/types/database';

type MeterWithEq = Meter & {
  equipments?: { code: string; name: string } | null;
};

function categoryLabel(m: Pick<Meter, 'meter_type' | 'category'>) {
  if (m.meter_type === 'electric' || m.category === 'electric') return 'Elektrik';
  if (m.category === 'water') return 'Şebeke Suyu';
  if (m.category === 'cooling') return 'Soğutma / Kule';
  if (m.category === 'gas') return 'Doğalgaz';
  return 'Diğer Mekanik';
}

interface MeterFormState {
  id: string | null;
  name: string;
  meter_type: MeterType;
  category: MeterCategory;
  multiplier: string;
  eic_code: string;
  tekil_code: string;
  meter_no: string;
  contract_no: string;
  subscriber_no: string;
  region: string;
  equipment_id: string;
}

export default function EnergyMetersPage() {
  const { profile } = useDashboardAuth();
  const isAdmin = profile?.role === 'system_admin';
  const canManage = hasModulePermission(profile, 'energy', 'manage');
  const canReports = hasModulePermission(profile, 'energy', 'reports');

  const [meters, setMeters] = useState<MeterWithEq[]>([]);
  const [trashedMeters, setTrashedMeters] = useState<TrashedMeter[]>([]);
  const [equipments, setEquipments] = useState<Equipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Filters
  const [typeFilter, setTypeFilter] = useState<'all' | 'electric' | 'mechanical'>('all');
  const [showTrash, setShowTrash] = useState(false);
  const [search, setSearch] = useState('');

  // Modal state (Add / Edit)
  const [formModal, setFormModal] = useState<MeterFormState | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const supabase = createClient();
      const [mRes, eqRes, trashRes] = await Promise.all([
        supabase
          .from('meters')
          .select('*, equipments(code, name)')
          .eq('is_active', true)
          .is('deleted_at', null)
          .order('meter_type')
          .order('sort_order')
          .order('name'),
        supabase.from('equipments').select(EQUIPMENT_SELECT).eq('is_active', true).order('name').limit(300),
        isAdmin ? supabase.rpc('rpc_list_trashed_meters') : Promise.resolve({ data: [], error: null }),
      ]);
      if (mRes.error) throw mRes.error;
      setMeters((mRes.data as unknown as MeterWithEq[]) ?? []);
      if (eqRes.data) setEquipments(eqRes.data as Equipment[]);
      if (trashRes.error) throw trashRes.error;
      setTrashedMeters((trashRes.data as unknown as TrashedMeter[]) ?? []);
    } catch (err) {
      setMsg({ type: 'err', text: err instanceof Error ? err.message : 'Sayaçlar yüklenemedi.' });
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const filteredMeters = useMemo(() => {
    const q = search.trim().toLowerCase();
    return meters.filter((m) => {
      if (typeFilter !== 'all' && m.meter_type !== typeFilter) return false;
      if (!q) return true;
      return (
        m.name.toLowerCase().includes(q) ||
        (m.eic_code ?? '').toLowerCase().includes(q) ||
        (m.tekil_code ?? '').toLowerCase().includes(q) ||
        (m.meter_no ?? '').toLowerCase().includes(q) ||
        (m.contract_no ?? '').toLowerCase().includes(q) ||
        (m.region ?? '').toLowerCase().includes(q)
      );
    });
  }, [meters, typeFilter, search]);

  function openNewModal() {
    setFormModal({
      id: null,
      name: '',
      meter_type: 'electric',
      category: 'electric',
      multiplier: '1',
      eic_code: '',
      tekil_code: '',
      meter_no: '',
      contract_no: '',
      subscriber_no: '',
      region: '',
      equipment_id: '',
    });
  }

  function openEditModal(m: MeterWithEq) {
    setFormModal({
      id: m.id,
      name: m.name,
      meter_type: m.meter_type,
      category: m.category,
      multiplier: String(m.multiplier ?? 1),
      eic_code: m.eic_code ?? '',
      tekil_code: m.tekil_code ?? '',
      meter_no: m.meter_no ?? '',
      contract_no: m.contract_no ?? '',
      subscriber_no: m.subscriber_no ?? '',
      region: m.region ?? '',
      equipment_id: m.equipment_id ?? '',
    });
  }

  async function handleSaveModal(e: React.FormEvent) {
    e.preventDefault();
    if (!formModal || !formModal.name.trim()) return;
    setSaving(true);
    setMsg(null);
    try {
      const supabase = createClient();
      const payload = {
        name: formModal.name.trim(),
        meter_type: formModal.meter_type,
        category:
          formModal.meter_type === 'electric'
            ? 'electric'
            : formModal.category === 'electric'
            ? 'water'
            : formModal.category,
        multiplier: Number(formModal.multiplier) || 1,
        eic_code: formModal.eic_code.trim() ? formModal.eic_code.trim().toUpperCase() : null,
        tekil_code: formModal.tekil_code.trim() || null,
        meter_no: formModal.meter_no.trim() || null,
        contract_no: formModal.contract_no.trim() || null,
        subscriber_no: formModal.subscriber_no.trim() || null,
        region: formModal.region.trim() || null,
        equipment_id: formModal.equipment_id || null,
      };

      if (formModal.id) {
        const { error } = await supabase.from('meters').update(payload).eq('id', formModal.id);
        if (error) throw error;
        setMsg({ type: 'ok', text: `${payload.name} sayacı güncellendi.` });
      } else {
        const { error } = await supabase.from('meters').insert({
          ...payload,
          sort_order: meters.filter((m) => m.meter_type === formModal.meter_type).length,
        });
        if (error) throw error;
        setMsg({ type: 'ok', text: `${payload.name} sayacı eklendi.` });
      }
      setFormModal(null);
      await loadAll();
    } catch (err) {
      setMsg({ type: 'err', text: err instanceof Error ? err.message : 'Sayaç kaydedilemedi.' });
    } finally {
      setSaving(false);
    }
  }

  async function handleMoveToTrash(m: MeterWithEq) {
    if (!isAdmin) return;
    if (
      !window.confirm(
        `"${m.name}" sayacını çöp kutusuna taşımak istediğinize emin misiniz?\nSayaç ve tüm okuma kayıtları 1 ay boyunca Çöp Kutusu'nda saklanır ve istenirse geri getirilebilir.`
      )
    ) {
      return;
    }
    setMsg(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.rpc('rpc_soft_delete_meter', { p_meter_id: m.id });
      if (error) throw error;
      setMsg({
        type: 'ok',
        text: `"${m.name}" sayacı çöp kutusuna taşındı. 1 ay içinde Çöp Kutusu'ndan geri getirebilirsiniz.`,
      });
      await loadAll();
    } catch (err) {
      setMsg({ type: 'err', text: err instanceof Error ? err.message : 'Sayaç çöp kutusuna taşınamadı.' });
    }
  }

  async function handleRestoreFromTrash(m: TrashedMeter) {
    if (!isAdmin) return;
    setMsg(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.rpc('rpc_restore_meter', { p_meter_id: m.id });
      if (error) throw error;
      setMsg({
        type: 'ok',
        text: `"${m.name}" sayacı ve ${m.readings_count} okuma kaydı başarıyla geri getirildi.`,
      });
      await loadAll();
    } catch (err) {
      setMsg({ type: 'err', text: err instanceof Error ? err.message : 'Sayaç geri yüklenemedi.' });
    }
  }

  async function handlePermanentDelete(m: TrashedMeter) {
    if (!isAdmin) return;
    if (
      !window.confirm(
        `"${m.name}" sayacı ve ${m.readings_count} okuma kaydı KALICI OLARAK SİLİNECEK.\nBu işlem geri alınamaz! Devam edilsin mi?`
      )
    ) {
      return;
    }
    setMsg(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.rpc('rpc_permanently_delete_meter', {
        p_meter_id: m.id,
      });
      if (error) throw error;
      setMsg({ type: 'ok', text: `"${m.name}" sayacı kalıcı olarak silindi.` });
      await loadAll();
    } catch (err) {
      setMsg({ type: 'err', text: err instanceof Error ? err.message : 'Kalıcı silme başarısız.' });
    }
  }

  function daysLeftLabel(purgeAt: string): string {
    const ms = new Date(purgeAt).getTime() - Date.now();
    const days = Math.max(0, Math.ceil(ms / 86_400_000));
    return days === 0 ? 'Bugün silinecek' : `${days} gün kaldı`;
  }

  function buildReportData() {
    const headers = [
      'Sayaç Adı',
      'Tür',
      'Kategori',
      'Çarpan',
      'EIC Kodu',
      'Tekil Kod',
      'Sayaç No',
      'Sözleşme No',
      'Abone No',
      'Bölge',
      'Bağlı Ekipman',
    ];
    const reportRows: ReportCell[][] = filteredMeters.map((m) => [
      m.name,
      m.meter_type === 'electric' ? 'Elektrik' : 'Mekanik',
      categoryLabel(m),
      m.multiplier,
      m.eic_code ?? '-',
      m.tekil_code ?? '-',
      m.meter_no ?? '-',
      m.contract_no ?? '-',
      m.subscriber_no ?? '-',
      m.region ?? '-',
      m.equipments ? `${m.equipments.code} - ${m.equipments.name}` : '-',
    ]);
    return { headers, reportRows };
  }

  function handleExportExcel() {
    const { headers, reportRows } = buildReportData();
    exportExcelXml({
      fileName: `avm_tech_sayac_listesi_${new Date().toISOString().slice(0, 10)}.xls`,
      sheetName: 'Sayaclar',
      title: 'DOWNTOWN TEKNİK · Sayaç Envanteri Listesi',
      subtitle: `${filteredMeters.length} aktif sayaç`,
      headers,
      rows: reportRows,
    });
  }

  function handleExportPdf() {
    const { headers, reportRows } = buildReportData();
    exportPrintablePdf({
      title: 'Sayaç Envanteri & Abonelik Kodları Raporu',
      subtitle: `${filteredMeters.length} aktif sayaç listeleniyor`,
      kpis: [
        { label: 'Toplam Sayaç', value: String(filteredMeters.length), tone: 'navy' },
        {
          label: 'Elektrik Sayaç',
          value: String(filteredMeters.filter((m) => m.meter_type === 'electric').length),
          tone: 'slate',
        },
        {
          label: 'Mekanik Sayaç',
          value: String(filteredMeters.filter((m) => m.meter_type === 'mechanical').length),
          tone: 'slate',
        },
        {
          label: 'Ekipmana Bağlı',
          value: String(filteredMeters.filter((m) => Boolean(m.equipment_id)).length),
          tone: 'green',
        },
      ],
      headers,
      rows: reportRows,
    });
  }

  return (
    <div className="space-y-5">
      {/* Başlık ve Aksiyonlar */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400">
            SAYAÇ ENVANTERİ
          </div>
          <h1 className="mt-0.5 text-2xl font-extrabold text-slate-900">Sayaç Yönetimi</h1>
          <p className="mt-1 text-sm text-slate-500">
            Elektrik ve mekanik sayaç tanımları, çarpanlar, EIC/Tekil kodları ve ekipman
            bağlantıları.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canManage && (
            <button
              type="button"
              onClick={openNewModal}
              className="inline-flex items-center gap-1.5 rounded-xl bg-navy px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-navy-hover"
            >
              <Plus className="h-3.5 w-3.5" />
              Yeni Sayaç Ekle
            </button>
          )}
          {canReports && (
            <>
              <button
                type="button"
                onClick={handleExportExcel}
                disabled={filteredMeters.length === 0}
                className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2 text-xs font-bold text-emerald-800 transition hover:bg-emerald-100 disabled:opacity-40"
              >
                <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-700" />
                Excel İndir (.xls)
              </button>
              <button
                type="button"
                onClick={handleExportPdf}
                disabled={filteredMeters.length === 0}
                className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2 text-xs font-bold text-rose-800 transition hover:bg-rose-100 disabled:opacity-40"
              >
                <FileDown className="h-3.5 w-3.5 text-rose-700" />
                PDF Rapor İndir
              </button>
            </>
          )}
        </div>
      </div>

      {/* Filtre ve Arama Çubuğu */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-3">
        <div className="flex flex-wrap gap-2">
          {(
            [
              ['all', `Tümü (${meters.length})`],
              [
                'electric',
                `Elektrik (${meters.filter((m) => m.meter_type === 'electric').length})`,
              ],
              [
                'mechanical',
                `Mekanik (${meters.filter((m) => m.meter_type === 'mechanical').length})`,
              ],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                setShowTrash(false);
                setTypeFilter(key);
              }}
              className={`rounded-full px-4 py-1.5 text-xs font-bold transition ${
                !showTrash && typeFilter === key
                  ? 'bg-navy text-white shadow-sm'
                  : 'border border-slate-200 bg-canvas text-slate-700 hover:bg-slate-100'
              }`}
            >
              {label}
            </button>
          ))}
          {isAdmin && (
            <button
              type="button"
              onClick={() => setShowTrash((v) => !v)}
              className={`inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-bold transition ${
                showTrash
                  ? 'bg-red-600 text-white shadow-sm'
                  : 'border border-red-200 bg-red-50 text-red-700 hover:bg-red-100'
              }`}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Çöp Kutusu ({trashedMeters.length})
            </button>
          )}
        </div>

        {!showTrash && (
          <div className="relative min-w-[240px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Sayaç adı, EIC, tekil veya sözleşme ara..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-canvas py-1.5 pl-9 pr-3 text-sm text-slate-800 focus:border-navy focus:outline-none"
            />
          </div>
        )}
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

      {/* Çöp Kutusu (Yalnızca Admin) veya Aktif Sayaç Tablosu */}
      {showTrash && isAdmin ? (
        <div className="space-y-3">
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-medium text-amber-900">
            Silinen sayaçlar ve tüm okuma verileri <strong>1 ay</strong> boyunca burada saklanır.
            1 ay sonunda otomatik olarak kalıcı silinir. Bu alan yalnızca Sistem Yöneticisi (Admin)
            tarafından yönetilebilir.
          </div>
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-canvas text-[11px] font-extrabold uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Sayaç</th>
                    <th className="px-4 py-3">Tür / Kategori</th>
                    <th className="px-4 py-3">Korunan Okuma</th>
                    <th className="px-4 py-3">Silen & Tarih</th>
                    <th className="px-4 py-3">Kalan Süre</th>
                    <th className="px-4 py-3 text-right">İşlem</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {trashedMeters.map((tm) => (
                    <tr key={tm.id} className="hover:bg-canvas/60">
                      <td className="px-4 py-3 font-bold text-slate-900">{tm.name}</td>
                      <td className="px-4 py-3 font-medium text-slate-700">{categoryLabel(tm)}</td>
                      <td className="px-4 py-3 font-semibold text-navy">
                        {tm.readings_count} okuma
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">
                        <div>{tm.deleted_by_name}</div>
                        <div className="text-slate-400">{formatDateTime(tm.deleted_at)}</div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-800">
                          {daysLeftLabel(tm.purge_at)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => handleRestoreFromTrash(tm)}
                            className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-800 transition hover:bg-emerald-100"
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                            Geri Yükle
                          </button>
                          <button
                            type="button"
                            onClick={() => handlePermanentDelete(tm)}
                            className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-bold text-red-700 transition hover:bg-red-100"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Kalıcı Sil
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {trashedMeters.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-10 text-center text-slate-500">
                        Çöp kutusu boş.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-canvas text-[11px] font-extrabold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-3">Sayaç</th>
                  <th className="px-4 py-3">Tür / Kategori</th>
                  <th className="px-4 py-3">Çarpan</th>
                  <th className="px-4 py-3">EIC / Tekil</th>
                  <th className="px-4 py-3">Sayaç / Sözleşme</th>
                  <th className="px-4 py-3">Ekipman</th>
                  <th className="px-4 py-3 text-right">İşlem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredMeters.map((m) => (
                  <tr key={m.id} className="hover:bg-canvas/60">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <span
                          className={`flex h-7 w-7 items-center justify-center rounded-lg ${
                            m.meter_type === 'electric'
                              ? 'bg-amber-100 text-amber-600'
                              : m.category === 'gas'
                              ? 'bg-red-100 text-red-600'
                              : m.category === 'water' || m.category === 'cooling'
                              ? 'bg-sky-100 text-sky-600'
                              : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {m.meter_type === 'electric' ? (
                            <Zap className="h-3.5 w-3.5" />
                          ) : m.category === 'gas' ? (
                            <Flame className="h-3.5 w-3.5" />
                          ) : m.category === 'water' || m.category === 'cooling' ? (
                            <Droplets className="h-3.5 w-3.5" />
                          ) : (
                            <Gauge className="h-3.5 w-3.5" />
                          )}
                        </span>
                        <div>
                          <div className="font-bold text-slate-900">{m.name}</div>
                          {m.region && <div className="text-xs text-slate-400">{m.region}</div>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-700">{categoryLabel(m)}</td>
                    <td className="px-4 py-3 font-semibold text-slate-800">x{m.multiplier}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-600">
                      {[m.eic_code, m.tekil_code].filter(Boolean).join(' / ') || '-'}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-600">
                      {[m.meter_no, m.contract_no].filter(Boolean).join(' / ') || '-'}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {m.equipments ? `${m.equipments.code} - ${m.equipments.name}` : '-'}
                    </td>
                    <td className="px-4 py-3">
                      {canManage || isAdmin ? (
                        <div className="flex items-center justify-end gap-1.5">
                          {canManage && (
                            <button
                              type="button"
                              onClick={() => openEditModal(m)}
                              title="Düzenle"
                              className="rounded-lg border border-slate-200 p-1.5 text-slate-600 transition hover:border-navy hover:bg-navy/5 hover:text-navy"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                          )}
                          {isAdmin && (
                            <button
                              type="button"
                              onClick={() => handleMoveToTrash(m)}
                              title="Çöp Kutusuna Taşı"
                              className="rounded-lg border border-slate-200 p-1.5 text-slate-600 transition hover:border-red-300 hover:bg-red-50 hover:text-red-600"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      ) : (
                        <div className="text-right text-xs text-slate-400">Salt Okunur</div>
                      )}
                    </td>
                  </tr>
                ))}
                {filteredMeters.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-slate-500">
                      {loading ? 'Sayaçlar yükleniyor...' : 'Filtreye uygun sayaç bulunamadı.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Sayaç Ekle / Düzenle Modal */}
      {formModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h2 className="text-lg font-extrabold text-slate-900">
                {formModal.id ? 'Sayaç Bilgilerini Düzenle' : 'Yeni Sayaç Ekle'}
              </h2>
              <button
                type="button"
                onClick={() => setFormModal(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSaveModal} className="mt-4 space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-600">Sayaç Adı *</label>
                  <input
                    required
                    placeholder="örn. GT.ADP.1"
                    value={formModal.name}
                    onChange={(e) => setFormModal({ ...formModal, name: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm focus:border-navy focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-600">Çarpan</label>
                  <input
                    type="number"
                    step="0.01"
                    value={formModal.multiplier}
                    onChange={(e) => setFormModal({ ...formModal, multiplier: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm focus:border-navy focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-600">Sayaç Türü</label>
                  <select
                    value={formModal.meter_type}
                    onChange={(e) => {
                      const t = e.target.value as MeterType;
                      setFormModal({
                        ...formModal,
                        meter_type: t,
                        category: t === 'electric' ? 'electric' : 'water',
                      });
                    }}
                    className="w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm focus:border-navy focus:outline-none"
                  >
                    <option value="electric">Elektrik</option>
                    <option value="mechanical">Mekanik</option>
                  </select>
                </div>

                {formModal.meter_type === 'mechanical' && (
                  <div>
                    <label className="mb-1 block text-xs font-bold text-slate-600">Kategori</label>
                    <select
                      value={formModal.category}
                      onChange={(e) =>
                        setFormModal({
                          ...formModal,
                          category: e.target.value as MeterCategory,
                        })
                      }
                      className="w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm focus:border-navy focus:outline-none"
                    >
                      <option value="water">Şebeke Suyu</option>
                      <option value="cooling">Soğutma / Kule</option>
                      <option value="gas">Doğalgaz</option>
                      <option value="other">Diğer</option>
                    </select>
                  </div>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-600">EIC Kodu</label>
                  <input
                    value={formModal.eic_code}
                    onChange={(e) => setFormModal({ ...formModal, eic_code: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm focus:border-navy focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-600">Tekil Kod</label>
                  <input
                    value={formModal.tekil_code}
                    onChange={(e) => setFormModal({ ...formModal, tekil_code: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm focus:border-navy focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-600">Sayaç No</label>
                  <input
                    value={formModal.meter_no}
                    onChange={(e) => setFormModal({ ...formModal, meter_no: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm focus:border-navy focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-600">Sözleşme No</label>
                  <input
                    value={formModal.contract_no}
                    onChange={(e) => setFormModal({ ...formModal, contract_no: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm focus:border-navy focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-600">Abone No</label>
                  <input
                    value={formModal.subscriber_no}
                    onChange={(e) => setFormModal({ ...formModal, subscriber_no: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm focus:border-navy focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-600">Bölge / Konum</label>
                  <input
                    value={formModal.region}
                    onChange={(e) => setFormModal({ ...formModal, region: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm focus:border-navy focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-bold text-slate-600">
                  Bağlı Ortak Ekipman (Opsiyonel)
                </label>
                <select
                  value={formModal.equipment_id}
                  onChange={(e) => setFormModal({ ...formModal, equipment_id: e.target.value })}
                  className="w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm focus:border-navy focus:outline-none"
                >
                  <option value="">Seçilmedi</option>
                  {equipments.map((eq) => (
                    <option key={eq.id} value={eq.id}>
                      {eq.code} - {eq.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setFormModal(null)}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
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
        </div>
      )}
    </div>
  );
}

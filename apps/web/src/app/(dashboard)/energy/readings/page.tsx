'use client';

import { useCallback, useEffect, useState } from 'react';
import { FileDown, FileSpreadsheet, Pencil, Plus, Trash2, X } from 'lucide-react';
import { createClient } from '@/core/supabase/client';
import { formatDate } from '@/core/constants';
import { useDashboardAuth } from '@/core/DashboardContext';
import { hasModulePermission } from '@/core/permissions';
import {
  exportExcelXml,
  exportPrintablePdf,
} from '@/core/utils/report-export';
import {
  buildReadingsExportData,
  meterCategoryLabel,
  ReadingsViewMode,
  resolveReadingsViewMode,
} from '@/core/utils/energy-readings';
import { Meter, MeterReading } from '@/types/database';

type ReadingWithMeter = MeterReading & {
  meters?: {
    name: string;
    meter_type: 'electric' | 'mechanical';
    category?: string;
    multiplier?: number;
  } | null;
};

const PAGE_SIZE = 40;

export default function EnergyReadingsPage() {
  const { profile } = useDashboardAuth();
  const canCreate = hasModulePermission(profile, 'energy', 'create');
  const canEdit = hasModulePermission(profile, 'energy', 'edit');
  const canDelete = hasModulePermission(profile, 'energy', 'delete');
  const canReports = hasModulePermission(profile, 'energy', 'reports');

  const [meters, setMeters] = useState<Meter[]>([]);
  const [rows, setRows] = useState<ReadingWithMeter[]>([]);
  const [typeFilter, setTypeFilter] = useState<ReadingsViewMode>('all');
  const [meterFilter, setMeterFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Yeni okuma girişi
  const [meterId, setMeterId] = useState('');
  const [readingDate, setReadingDate] = useState(new Date().toISOString().slice(0, 10));
  const [activeVal, setActiveVal] = useState('');
  const [indVal, setIndVal] = useState('');
  const [capVal, setCapVal] = useState('');
  const [indexVal, setIndexVal] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Düzenleme modalı
  const [editing, setEditing] = useState<ReadingWithMeter | null>(null);
  const [editDate, setEditDate] = useState('');
  const [editActive, setEditActive] = useState('');
  const [editInd, setEditInd] = useState('');
  const [editCap, setEditCap] = useState('');
  const [editIndex, setEditIndex] = useState('');
  const [editConsumption, setEditConsumption] = useState('');
  const [editIndPct, setEditIndPct] = useState('');
  const [editCapPct, setEditCapPct] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const supabase = createClient();
      let q = supabase
        .from('meter_readings')
        .select('*, meters!inner(name, meter_type, category, multiplier, deleted_at)')
        .is('meters.deleted_at', null)
        .order('reading_date', { ascending: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

      if (typeFilter !== 'all') q = q.eq('meters.meter_type', typeFilter);
      if (meterFilter) q = q.eq('meter_id', meterFilter);
      if (dateFrom) q = q.gte('reading_date', `${dateFrom}T00:00:00+03:00`);
      if (dateTo) q = q.lte('reading_date', `${dateTo}T23:59:59+03:00`);

      const [mRes, rRes] = await Promise.all([
        supabase
          .from('meters')
          .select('*')
          .eq('is_active', true)
          .is('deleted_at', null)
          .order('name'),
        q,
      ]);

      if (mRes.data) setMeters(mRes.data as Meter[]);
      if (rRes.error) throw rRes.error;
      setRows((rRes.data as unknown as ReadingWithMeter[]) ?? []);
    } catch (err) {
      setMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Okumalar alınamadı.',
      });
    } finally {
      setLoading(false);
    }
  }, [meterFilter, typeFilter, dateFrom, dateTo, page]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const electricMeters = meters.filter((m) => m.meter_type === 'electric');
  const mechanicalMeters = meters.filter((m) => m.meter_type === 'mechanical');
  const selectedMeter = meters.find((m) => m.id === meterId);
  const selectedFilterMeter = meters.find((m) => m.id === meterFilter) ?? null;
  const effectiveViewMode = resolveReadingsViewMode(
    typeFilter,
    selectedFilterMeter,
    loading ? [] : rows
  );
  const colCount =
    effectiveViewMode === 'mechanical' ? 6 : effectiveViewMode === 'electric' ? 9 : 7;

  async function handleRecord(e: React.FormEvent, overwrite = false) {
    e.preventDefault();
    if (!selectedMeter) return;
    setSubmitting(true);
    setMsg(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.rpc('rpc_record_meter_reading', {
        p_meter_id: selectedMeter.id,
        p_reading_date: `${readingDate}T12:00:00+03:00`,
        p_active_value: selectedMeter.meter_type === 'electric' ? Number(activeVal) : null,
        p_inductive_value: selectedMeter.meter_type === 'electric' ? Number(indVal) : null,
        p_capacitive_value: selectedMeter.meter_type === 'electric' ? Number(capVal) : null,
        p_index_value: selectedMeter.meter_type === 'mechanical' ? Number(indexVal) : null,
        p_overwrite: overwrite,
      });
      if (error) {
        if (!overwrite && error.message.includes('SAME_DAY_EXISTS')) {
          if (window.confirm('Seçilen gün için zaten kayıt var. Üzerine yazılsın mı?')) {
            await handleRecord(e, true);
            return;
          }
        }
        throw error;
      }
      setMsg({ type: 'ok', text: 'Okuma kaydedildi.' });
      setActiveVal('');
      setIndVal('');
      setCapVal('');
      setIndexVal('');
      await loadData();
    } catch (err) {
      setMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Kayıt başarısız.',
      });
    } finally {
      setSubmitting(false);
    }
  }

  function openEdit(r: ReadingWithMeter) {
    setEditing(r);
    setEditDate(r.reading_date.slice(0, 10));
    setEditActive(r.active_value != null ? String(r.active_value) : '');
    setEditInd(r.inductive_value != null ? String(r.inductive_value) : '');
    setEditCap(r.capacitive_value != null ? String(r.capacitive_value) : '');
    setEditIndex(r.index_value != null ? String(r.index_value) : '');
    setEditConsumption(String(r.consumption ?? 0));
    setEditIndPct(r.inductive_percent != null ? String(r.inductive_percent) : '');
    setEditCapPct(r.capacitive_percent != null ? String(r.capacitive_percent) : '');
    setEditNotes(r.notes ?? '');
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setSavingEdit(true);
    setMsg(null);
    try {
      const supabase = createClient();
      const isElec = editing.meters?.meter_type === 'electric';
      const { error } = await supabase
        .from('meter_readings')
        .update({
          reading_date: `${editDate}T12:00:00+03:00`,
          active_value: isElec && editActive !== '' ? Number(editActive) : null,
          inductive_value: isElec && editInd !== '' ? Number(editInd) : null,
          capacitive_value: isElec && editCap !== '' ? Number(editCap) : null,
          inductive_percent: isElec && editIndPct !== '' ? Number(editIndPct) : null,
          capacitive_percent: isElec && editCapPct !== '' ? Number(editCapPct) : null,
          index_value: !isElec && editIndex !== '' ? Number(editIndex) : null,
          consumption: Number(editConsumption) || 0,
          notes: editNotes.trim() || null,
        })
        .eq('id', editing.id);
      if (error) throw error;
      setEditing(null);
      setMsg({ type: 'ok', text: 'Okuma kaydı güncellendi.' });
      await loadData();
    } catch (err) {
      setMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Güncelleme başarısız.',
      });
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleDelete(r: ReadingWithMeter) {
    if (
      !window.confirm(
        `${r.meters?.name ?? 'Sayaç'} (${formatDate(r.reading_date)}) okuma kaydını silmek istediğinize emin misiniz?`
      )
    ) {
      return;
    }
    setMsg(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.from('meter_readings').delete().eq('id', r.id);
      if (error) throw error;
      setMsg({ type: 'ok', text: 'Okuma kaydı silindi.' });
      await loadData();
    } catch (err) {
      setMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Silme işlemi başarısız.',
      });
    }
  }

  function toIsoDate(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function applyPreset(preset: 'this_month' | 'last_month' | 'last_30') {
    const now = new Date();
    setPage(0);
    if (preset === 'this_month') {
      setDateFrom(toIsoDate(new Date(now.getFullYear(), now.getMonth(), 1)));
      setDateTo(toIsoDate(now));
    } else if (preset === 'last_month') {
      setDateFrom(toIsoDate(new Date(now.getFullYear(), now.getMonth() - 1, 1)));
      setDateTo(toIsoDate(new Date(now.getFullYear(), now.getMonth(), 0)));
    } else {
      const prev = new Date(now);
      prev.setDate(prev.getDate() - 30);
      setDateFrom(toIsoDate(prev));
      setDateTo(toIsoDate(now));
    }
  }

  function handleExportExcel() {
    const { headers, reportRows } = buildReadingsExportData(
      effectiveViewMode,
      rows,
      formatDate
    );
    exportExcelXml({
      fileName: `sayac_okumalari_${dateFrom || 'tum'}_${dateTo || new Date().toISOString().slice(0, 10)}.xls`,
      sheetName: 'Okumalar',
      title: 'DOWNTOWN TEKNİK · Sayaç Okuma Geçmişi',
      subtitle: `Tarih Aralığı: ${dateFrom || 'Başlangıç'} – ${dateTo || 'Bugün'} · ${rows.length} kayıt`,
      headers,
      rows: reportRows,
    });
  }

  function handleExportPdf() {
    const { headers, reportRows } = buildReadingsExportData(
      effectiveViewMode,
      rows,
      formatDate
    );
    if (effectiveViewMode === 'mechanical') {
      const totalMechConsumption = rows.reduce(
        (s, r) => s + Number(r.consumption || 0),
        0
      );
      const uniqueMeterCount = new Set(rows.map((r) => r.meter_id)).size;
      exportPrintablePdf({
        title: 'Mekanik Sayaç Okuma Geçmişi Raporu',
        subtitle: `Tarih Aralığı: ${dateFrom || 'Tümü'} – ${dateTo || 'Bugün'} · Sayfa ${page + 1}`,
        kpis: [
          { label: 'Listelenen Okuma', value: String(rows.length), tone: 'navy' },
          {
            label: 'Toplam Tüketim',
            value: `${fmtNum(totalMechConsumption)} m³`,
            tone: 'slate',
          },
          { label: 'Sayaç Sayısı', value: String(uniqueMeterCount), tone: 'slate' },
        ],
        headers,
        rows: reportRows,
      });
      return;
    }

    const penaltyCount = rows.filter(
      (r) =>
        r.meters?.meter_type === 'electric' &&
        ((r.inductive_percent ?? 0) > 20 || (r.capacitive_percent ?? 0) > 15)
    ).length;
    exportPrintablePdf({
      title: 'Sayaç Okuma Geçmişi Raporu',
      subtitle: `Tarih Aralığı: ${dateFrom || 'Tümü'} – ${dateTo || 'Bugün'} · Sayfa ${page + 1}`,
      kpis: [
        { label: 'Listelenen Okuma', value: String(rows.length), tone: 'navy' },
        {
          label: 'Elektrik Okuma',
          value: String(rows.filter((r) => r.meters?.meter_type === 'electric').length),
          tone: 'slate',
        },
        ...(effectiveViewMode === 'all'
          ? [
              {
                label: 'Mekanik Okuma',
                value: String(
                  rows.filter((r) => r.meters?.meter_type === 'mechanical').length
                ),
                tone: 'slate' as const,
              },
            ]
          : []),
        {
          label: 'Reaktif Sınır Aşımı',
          value: String(penaltyCount),
          tone: penaltyCount > 0 ? 'red' : 'green',
        },
      ],
      headers,
      rows: reportRows,
    });
  }

  const fmtNum = (v: number | null | undefined) =>
    v == null
      ? '-'
      : new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 3 }).format(v);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400">
            ENERJİ OKUMALARI
          </div>
          <h1 className="mt-0.5 text-2xl font-extrabold text-slate-900">
            Okuma Geçmişi & Veri Girişi
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {effectiveViewMode === 'mechanical'
              ? 'Su, doğalgaz ve soğutma gibi mekanik sayaçlarda yalnızca endeks ve tüketim (m³) kayıtları.'
              : effectiveViewMode === 'electric'
              ? 'Elektrik sayaçları için aktif, indüktif, kapasitif endeksler ve reaktif güç takibi.'
              : 'Elektrik sayaçları (aktif/indüktif/kapasitif) ve mekanik sayaçlar (yalnızca endeks) için okuma geçmişi ve veri girişi.'}
          </p>
        </div>
        {canReports && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleExportExcel}
              disabled={rows.length === 0}
              className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2 text-xs font-bold text-emerald-800 hover:bg-emerald-100 disabled:opacity-40"
            >
              <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-700" />
              <span>Excel İndir (.xls)</span>
            </button>
            <button
              type="button"
              onClick={handleExportPdf}
              disabled={rows.length === 0}
              className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2 text-xs font-bold text-rose-800 hover:bg-rose-100 disabled:opacity-40"
            >
              <FileDown className="h-3.5 w-3.5 text-rose-700" />
              <span>PDF Rapor İndir</span>
            </button>
          </div>
        )}
      </div>

      {msg && (
        <div
          className={`rounded-xl border p-3 text-sm ${
            msg.type === 'ok'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-red-200 bg-red-50 text-red-700'
          }`}
        >
          {msg.text}
        </div>
      )}

      {/* Yeni Okuma Giriş Formu */}
      {canCreate && (
        <form
          onSubmit={(e) => handleRecord(e, false)}
          className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-6"
        >
          <select
            required
            value={meterId}
            onChange={(e) => {
              setMeterId(e.target.value);
              setActiveVal('');
              setIndVal('');
              setCapVal('');
              setIndexVal('');
            }}
            className="rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm font-medium lg:col-span-2"
          >
            <option value="">Sayaç Seçiniz...</option>
            {electricMeters.length > 0 && (
              <optgroup label="Elektrik Sayaçları">
                {electricMeters.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} (Elektrik)
                  </option>
                ))}
              </optgroup>
            )}
            {mechanicalMeters.length > 0 && (
              <optgroup label="Mekanik Sayaçlar (Su / Doğalgaz / Soğutma)">
                {mechanicalMeters.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({meterCategoryLabel(m.category, 'mechanical')})
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          <input
            type="date"
            required
            value={readingDate}
            onChange={(e) => setReadingDate(e.target.value)}
            className="rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm"
          />
          {selectedMeter?.meter_type === 'electric' ? (
            <>
              <input
                type="number"
                step="0.001"
                required
                placeholder="Aktif Endeks (kWh)"
                value={activeVal}
                onChange={(e) => setActiveVal(e.target.value)}
                className="rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm"
              />
              <input
                type="number"
                step="0.001"
                required
                placeholder="İndüktif Endeks"
                value={indVal}
                onChange={(e) => setIndVal(e.target.value)}
                className="rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm"
              />
              <input
                type="number"
                step="0.001"
                required
                placeholder="Kapasitif Endeks"
                value={capVal}
                onChange={(e) => setCapVal(e.target.value)}
                className="rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm"
              />
            </>
          ) : selectedMeter?.meter_type === 'mechanical' ? (
            <input
              type="number"
              step="0.001"
              required
              placeholder="Endeks (m³)"
              value={indexVal}
              onChange={(e) => setIndexVal(e.target.value)}
              className="rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm"
            />
          ) : (
            <input
              type="text"
              disabled
              placeholder="Önce sayaç seçiniz"
              value=""
              className="rounded-xl border border-slate-200 bg-slate-100 px-3 py-2 text-sm text-slate-400"
            />
          )}
          <button
            type="submit"
            disabled={submitting || !selectedMeter}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-navy px-4 py-2 text-sm font-bold text-white hover:bg-navy-hover disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            <span>{submitting ? 'Kaydediliyor...' : 'Okuma Kaydet'}</span>
          </button>
        </form>
      )}

      {/* Filtre Çubuğu: Tür + Sayaç + Tarih Aralığı */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white p-3">
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ['all', 'Tümü'],
              ['electric', 'Elektrik'],
              ['mechanical', 'Mekanik (Su / Doğalgaz)'],
            ] as const
          ).map(([val, lbl]) => (
            <button
              key={val}
              type="button"
              onClick={() => {
                setPage(0);
                setTypeFilter(val);
                if (
                  val !== 'all' &&
                  selectedFilterMeter &&
                  selectedFilterMeter.meter_type !== val
                ) {
                  setMeterFilter('');
                }
              }}
              className={`rounded-full px-3 py-1 text-xs font-bold transition ${
                typeFilter === val
                  ? 'bg-navy text-white shadow-sm'
                  : 'border border-slate-200 bg-canvas text-slate-700 hover:bg-slate-100'
              }`}
            >
              {lbl}
            </button>
          ))}
        </div>
        <select
          value={meterFilter}
          onChange={(e) => {
            setPage(0);
            setMeterFilter(e.target.value);
          }}
          className="rounded-xl border border-slate-200 bg-canvas px-3 py-1.5 text-sm font-semibold text-slate-800"
        >
          <option value="">Tüm Sayaçlar</option>
          {typeFilter === 'electric' &&
            electricMeters.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          {typeFilter === 'mechanical' &&
            mechanicalMeters.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} ({meterCategoryLabel(m.category, 'mechanical')})
              </option>
            ))}
          {typeFilter === 'all' && (
            <>
              {electricMeters.length > 0 && (
                <optgroup label="Elektrik Sayaçları">
                  {electricMeters.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </optgroup>
              )}
              {mechanicalMeters.length > 0 && (
                <optgroup label="Mekanik Sayaçlar (Su / Doğalgaz / Soğutma)">
                  {mechanicalMeters.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({meterCategoryLabel(m.category, 'mechanical')})
                    </option>
                  ))}
                </optgroup>
              )}
            </>
          )}
        </select>
        <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
          <span>Başlangıç:</span>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => {
              setPage(0);
              setDateFrom(e.target.value);
            }}
            className="rounded-xl border border-slate-200 bg-canvas px-2.5 py-1.5 text-xs text-slate-800"
          />
        </div>
        <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
          <span>Bitiş:</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => {
              setPage(0);
              setDateTo(e.target.value);
            }}
            className="rounded-xl border border-slate-200 bg-canvas px-2.5 py-1.5 text-xs text-slate-800"
          />
        </div>
        {(typeFilter !== 'all' || meterFilter || dateFrom || dateTo) && (
          <button
            type="button"
            onClick={() => {
              setPage(0);
              setTypeFilter('all');
              setMeterFilter('');
              setDateFrom('');
              setDateTo('');
            }}
            className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50"
          >
            Filtreleri Temizle
          </button>
        )}
        <div className="ml-auto flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => applyPreset('this_month')}
            className="rounded-full border border-slate-200 bg-canvas px-3 py-1 text-xs font-bold text-slate-700 hover:bg-navy-soft hover:text-navy"
          >
            Bu Ay
          </button>
          <button
            type="button"
            onClick={() => applyPreset('last_month')}
            className="rounded-full border border-slate-200 bg-canvas px-3 py-1 text-xs font-bold text-slate-700 hover:bg-navy-soft hover:text-navy"
          >
            Geçen Ay
          </button>
          <button
            type="button"
            onClick={() => applyPreset('last_30')}
            className="rounded-full border border-slate-200 bg-canvas px-3 py-1 text-xs font-bold text-slate-700 hover:bg-navy-soft hover:text-navy"
          >
            Son 30 Gün
          </button>
        </div>
      </div>

      {/* Okuma Tablosu (Moda göre: Mekanikte yalnızca Endeks & Tüketim; Elektrikte Aktif/İndüktif/Kapasitif/Reaktif) */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-canvas text-[11px] font-extrabold uppercase tracking-wider text-slate-500">
              {effectiveViewMode === 'mechanical' ? (
                <tr>
                  <th className="px-3.5 py-3">Tarih</th>
                  <th className="px-3.5 py-3">Sayaç</th>
                  <th className="px-3.5 py-3">Endeks</th>
                  <th className="px-3.5 py-3">Tüketim (m³)</th>
                  <th className="px-3.5 py-3">Giren</th>
                  <th className="px-3.5 py-3 text-right">İşlem</th>
                </tr>
              ) : effectiveViewMode === 'electric' ? (
                <tr>
                  <th className="px-3.5 py-3">Tarih</th>
                  <th className="px-3.5 py-3">Sayaç</th>
                  <th className="px-3.5 py-3">Aktif Endeks</th>
                  <th className="px-3.5 py-3">İndüktif</th>
                  <th className="px-3.5 py-3">Kapasitif</th>
                  <th className="px-3.5 py-3">Tüketim (kWh)</th>
                  <th className="px-3.5 py-3">Reaktif (%)</th>
                  <th className="px-3.5 py-3">Giren</th>
                  <th className="px-3.5 py-3 text-right">İşlem</th>
                </tr>
              ) : (
                <tr>
                  <th className="px-3.5 py-3">Tarih</th>
                  <th className="px-3.5 py-3">Sayaç</th>
                  <th className="px-3.5 py-3">Tür</th>
                  <th className="px-3.5 py-3">Okuma Değeri</th>
                  <th className="px-3.5 py-3">Tüketim</th>
                  <th className="px-3.5 py-3">Giren</th>
                  <th className="px-3.5 py-3 text-right">İşlem</th>
                </tr>
              )}
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && (
                <tr>
                  <td colSpan={colCount} className="px-4 py-8 text-center text-slate-500">
                    Yükleniyor...
                  </td>
                </tr>
              )}
              {!loading &&
                rows.map((r) => {
                  const isElec = r.meters?.meter_type === 'electric';
                  const indHigh = (r.inductive_percent ?? 0) > 20;
                  const capHigh = (r.capacitive_percent ?? 0) > 15;
                  const actionsCell = (
                    <td className="whitespace-nowrap px-3.5 py-2.5 text-right">
                      {canEdit || canDelete ? (
                        <div className="inline-flex items-center gap-1">
                          {canEdit && (
                            <button
                              type="button"
                              onClick={() => openEdit(r)}
                              title="Düzenle"
                              className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-navy-soft hover:text-navy"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                          )}
                          {canDelete && (
                            <button
                              type="button"
                              onClick={() => handleDelete(r)}
                              title="Sil"
                              className="rounded-lg border border-slate-200 p-1.5 text-red-600 hover:bg-red-50"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400">Salt Okunur</span>
                      )}
                    </td>
                  );

                  if (effectiveViewMode === 'mechanical') {
                    return (
                      <tr key={r.id} className="hover:bg-canvas/60">
                        <td className="whitespace-nowrap px-3.5 py-2.5 text-xs font-medium text-slate-700">
                          {formatDate(r.reading_date)}
                        </td>
                        <td className="whitespace-nowrap px-3.5 py-2.5">
                          <div className="font-bold text-navy">{r.meters?.name ?? '-'}</div>
                          <div className="text-[11px] font-medium text-slate-400">
                            {meterCategoryLabel(r.meters?.category, 'mechanical')}
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-3.5 py-2.5 font-mono text-xs font-semibold text-slate-800">
                          {fmtNum(r.index_value)}
                        </td>
                        <td className="whitespace-nowrap px-3.5 py-2.5 font-bold text-slate-900">
                          {fmtNum(r.consumption)} m³
                        </td>
                        <td className="whitespace-nowrap px-3.5 py-2.5 text-xs text-slate-600">
                          {r.entered_by_name}
                        </td>
                        {actionsCell}
                      </tr>
                    );
                  }

                  if (effectiveViewMode === 'electric') {
                    return (
                      <tr key={r.id} className="hover:bg-canvas/60">
                        <td className="whitespace-nowrap px-3.5 py-2.5 text-xs font-medium text-slate-700">
                          {formatDate(r.reading_date)}
                        </td>
                        <td className="whitespace-nowrap px-3.5 py-2.5 font-bold text-navy">
                          {r.meters?.name ?? '-'}
                        </td>
                        <td className="whitespace-nowrap px-3.5 py-2.5 font-mono text-xs text-slate-800">
                          {fmtNum(r.active_value)}
                        </td>
                        <td className="whitespace-nowrap px-3.5 py-2.5 font-mono text-xs text-amber-700">
                          {fmtNum(r.inductive_value)}
                        </td>
                        <td className="whitespace-nowrap px-3.5 py-2.5 font-mono text-xs text-turquoise">
                          {fmtNum(r.capacitive_value)}
                        </td>
                        <td className="whitespace-nowrap px-3.5 py-2.5 font-bold text-slate-900">
                          {fmtNum(r.consumption)} kWh
                        </td>
                        <td className="whitespace-nowrap px-3.5 py-2.5 text-xs">
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`rounded-md px-1.5 py-0.5 font-bold ${
                                indHigh
                                  ? 'bg-red-100 text-red-700'
                                  : 'bg-slate-100 text-slate-700'
                              }`}
                            >
                              İnd %{r.inductive_percent ?? 0}
                            </span>
                            <span
                              className={`rounded-md px-1.5 py-0.5 font-bold ${
                                capHigh
                                  ? 'bg-red-100 text-red-700'
                                  : 'bg-slate-100 text-slate-700'
                              }`}
                            >
                              Kap %{r.capacitive_percent ?? 0}
                            </span>
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-3.5 py-2.5 text-xs text-slate-600">
                          {r.entered_by_name}
                        </td>
                        {actionsCell}
                      </tr>
                    );
                  }

                  return (
                    <tr key={r.id} className="hover:bg-canvas/60">
                      <td className="whitespace-nowrap px-3.5 py-2.5 text-xs font-medium text-slate-700">
                        {formatDate(r.reading_date)}
                      </td>
                      <td className="whitespace-nowrap px-3.5 py-2.5 font-bold text-navy">
                        {r.meters?.name ?? '-'}
                      </td>
                      <td className="whitespace-nowrap px-3.5 py-2.5 text-xs font-semibold text-slate-600">
                        {isElec ? 'Elektrik' : meterCategoryLabel(r.meters?.category, 'mechanical')}
                      </td>
                      <td className="px-3.5 py-2.5 text-xs">
                        {isElec ? (
                          <div className="flex flex-wrap items-center gap-1.5 font-mono">
                            <span className="text-slate-800">Aktif: {fmtNum(r.active_value)}</span>
                            <span
                              className={`rounded px-1.5 py-0.5 font-bold ${
                                indHigh
                                  ? 'bg-red-100 text-red-700'
                                  : 'bg-amber-50 text-amber-800'
                              }`}
                            >
                              İnd: {fmtNum(r.inductive_value)} (%{r.inductive_percent ?? 0})
                            </span>
                            <span
                              className={`rounded px-1.5 py-0.5 font-bold ${
                                capHigh
                                  ? 'bg-red-100 text-red-700'
                                  : 'bg-cyan-50 text-cyan-800'
                              }`}
                            >
                              Kap: {fmtNum(r.capacitive_value)} (%{r.capacitive_percent ?? 0})
                            </span>
                          </div>
                        ) : (
                          <span className="font-mono font-semibold text-slate-800">
                            Endeks: {fmtNum(r.index_value)}
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3.5 py-2.5 font-bold text-slate-900">
                        {fmtNum(r.consumption)} {isElec ? 'kWh' : 'm³'}
                      </td>
                      <td className="whitespace-nowrap px-3.5 py-2.5 text-xs text-slate-600">
                        {r.entered_by_name}
                      </td>
                      {actionsCell}
                    </tr>
                  );
                })}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={colCount} className="px-4 py-8 text-center text-slate-500">
                    Seçili filtrede okuma kaydı bulunamadı.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-xs text-slate-600">
          <span>
            Sayfa {page + 1} · {rows.length} kayıt gösteriliyor
          </span>
          <div className="flex gap-2">
            <button
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="rounded-lg border border-slate-200 px-3 py-1 font-semibold hover:bg-slate-50 disabled:opacity-40"
            >
              Önceki
            </button>
            <button
              disabled={rows.length < PAGE_SIZE}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-lg border border-slate-200 px-3 py-1 font-semibold hover:bg-slate-50 disabled:opacity-40"
            >
              Sonraki
            </button>
          </div>
        </div>
      </div>

      {/* Düzenleme Modalı */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <form
            onSubmit={handleSaveEdit}
            className="w-full max-w-lg space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-xl"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-base font-extrabold text-navy">
                Okuma Düzenle · {editing.meters?.name}
              </h2>
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs font-bold text-slate-600">
                Tarih
                <input
                  type="date"
                  required
                  value={editDate}
                  onChange={(e) => setEditDate(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm font-normal"
                />
              </label>
              <label className="text-xs font-bold text-slate-600">
                {editing.meters?.meter_type === 'electric' ? 'Tüketim (kWh)' : 'Tüketim (m³)'}
                <input
                  type="number"
                  step="0.001"
                  required
                  value={editConsumption}
                  onChange={(e) => setEditConsumption(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm font-normal"
                />
              </label>
              {editing.meters?.meter_type === 'electric' ? (
                <>
                  <label className="text-xs font-bold text-slate-600">
                    Aktif Endeks
                    <input
                      type="number"
                      step="0.001"
                      value={editActive}
                      onChange={(e) => setEditActive(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm font-normal"
                    />
                  </label>
                  <label className="text-xs font-bold text-slate-600">
                    İndüktif Endeks
                    <input
                      type="number"
                      step="0.001"
                      value={editInd}
                      onChange={(e) => setEditInd(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm font-normal"
                    />
                  </label>
                  <label className="text-xs font-bold text-slate-600">
                    Kapasitif Endeks
                    <input
                      type="number"
                      step="0.001"
                      value={editCap}
                      onChange={(e) => setEditCap(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm font-normal"
                    />
                  </label>
                  <label className="text-xs font-bold text-slate-600">
                    İndüktif %
                    <input
                      type="number"
                      step="0.01"
                      value={editIndPct}
                      onChange={(e) => setEditIndPct(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm font-normal"
                    />
                  </label>
                  <label className="text-xs font-bold text-slate-600">
                    Kapasitif %
                    <input
                      type="number"
                      step="0.01"
                      value={editCapPct}
                      onChange={(e) => setEditCapPct(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm font-normal"
                    />
                  </label>
                </>
              ) : (
                <label className="text-xs font-bold text-slate-600">
                  Endeks (m³)
                  <input
                    type="number"
                    step="0.001"
                    required
                    value={editIndex}
                    onChange={(e) => setEditIndex(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm font-normal"
                  />
                </label>
              )}
              <label className="text-xs font-bold text-slate-600 sm:col-span-2">
                Not
                <input
                  type="text"
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm font-normal"
                />
              </label>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50"
              >
                Vazgeç
              </button>
              <button
                type="submit"
                disabled={savingEdit}
                className="rounded-xl bg-navy px-4 py-2 text-xs font-bold text-white hover:bg-navy-hover disabled:opacity-50"
              >
                {savingEdit ? 'Kaydediliyor...' : 'Değişiklikleri Kaydet'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

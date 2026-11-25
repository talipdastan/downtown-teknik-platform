'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Building2,
  Layers,
  MapPin,
  Pencil,
  Plus,
  Search,
  Tag,
  Trash2,
  X,
} from 'lucide-react';
import { createClient } from '@/core/supabase/client';
import { hasCoreAction } from '@/core/permissions';
import { Category, Department, Floor, Location, Profile } from '@/types/database';

type Tab = 'departments' | 'floors' | 'locations' | 'categories';

interface EditModalState {
  tab: Tab;
  id: string;
  name: string;
  description: string;
  sort_order: string;
  parent_id: string;
  icon: string;
  is_active: boolean;
}

const TAB_META: Record<Tab, { label: string; singular: string }> = {
  departments: { label: 'Departmanlar', singular: 'Departman' },
  floors: { label: 'Katlar', singular: 'Kat' },
  locations: { label: 'Mahaller', singular: 'Mahal' },
  categories: { label: 'Arıza Kategorileri', singular: 'Kategori' },
};

export default function AdminDefinitionsPage() {
  const [tab, setTab] = useState<Tab>('departments');
  const [currentProfile, setCurrentProfile] = useState<Profile | null>(null);

  const [departments, setDepartments] = useState<Department[]>([]);
  const [floors, setFloors] = useState<Floor[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Hızlı Ekleme Formu Alanları
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [parentId, setParentId] = useState('');
  const [sortOrder, setSortOrder] = useState('0');
  const [icon, setIcon] = useState('');

  // Filtreler
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'passive'>('all');
  const [relFilter, setRelFilter] = useState('');

  // Düzenle Modalı
  const [editModal, setEditModal] = useState<EditModalState | null>(null);

  const canManage =
    currentProfile?.role === 'system_admin' ||
    hasCoreAction(currentProfile, 'manage_definitions');

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

      const [dRes, fRes, lRes, cRes] = await Promise.all([
        supabase.from('departments').select('*').order('name'),
        supabase.from('floors').select('*').order('sort_order').order('name'),
        supabase.from('locations').select('*').order('name'),
        supabase.from('categories').select('*').order('name'),
      ]);

      if (dRes.error) throw dRes.error;
      if (fRes.error) throw fRes.error;
      if (lRes.error) throw lRes.error;
      if (cRes.error) throw cRes.error;

      setDepartments((dRes.data as Department[]) ?? []);
      setFloors((fRes.data as Floor[]) ?? []);
      setLocations((lRes.data as Location[]) ?? []);
      setCategories((cRes.data as Category[]) ?? []);
    } catch (err) {
      setMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Veriler alınamadı.',
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const floorNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const f of floors) map.set(f.id, f.name);
    return map;
  }, [floors]);

  const deptNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of departments) map.set(d.id, d.name);
    return map;
  }, [departments]);

  const categoryCountByDept = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of categories) {
      if (c.department_id) {
        map.set(c.department_id, (map.get(c.department_id) ?? 0) + 1);
      }
    }
    return map;
  }, [categories]);

  const locationCountByFloor = useMemo(() => {
    const map = new Map<string, number>();
    for (const l of locations) {
      map.set(l.floor_id, (map.get(l.floor_id) ?? 0) + 1);
    }
    return map;
  }, [locations]);

  function switchTab(nextTab: Tab) {
    setTab(nextTab);
    setName('');
    setDescription('');
    setParentId('');
    setSortOrder(nextTab === 'floors' ? String(floors.length + 1) : '0');
    setIcon('');
    setSearch('');
    setStatusFilter('all');
    setRelFilter('');
    setMsg(null);
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setMsg(null);
    try {
      const supabase = createClient();
      if (tab === 'departments') {
        const { error } = await supabase.from('departments').insert({
          name: name.trim(),
          description: description.trim() || null,
        });
        if (error) throw error;
      } else if (tab === 'floors') {
        const { error } = await supabase.from('floors').insert({
          name: name.trim(),
          sort_order: Number(sortOrder) || 0,
        });
        if (error) throw error;
      } else if (tab === 'locations') {
        if (!parentId) throw new Error('Lütfen kat seçiniz.');
        const { error } = await supabase.from('locations').insert({
          floor_id: parentId,
          name: name.trim(),
          description: description.trim() || null,
        });
        if (error) throw error;
      } else {
        const { error } = await supabase.from('categories').insert({
          name: name.trim(),
          department_id: parentId || null,
          icon: icon.trim() || null,
        });
        if (error) throw error;
      }

      const addedName = name.trim();
      setName('');
      setDescription('');
      setIcon('');
      if (tab === 'floors') {
        setSortOrder(String(floors.length + 2));
      }
      setMsg({ type: 'ok', text: `"${addedName}" ${TAB_META[tab].singular.toLowerCase()} olarak eklendi.` });
      await loadAll();
    } catch (err) {
      setMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Ekleme başarısız oldu.',
      });
    } finally {
      setSaving(false);
    }
  }

  function openEdit(item: Department | Floor | Location | Category) {
    if (tab === 'departments') {
      const d = item as Department;
      setEditModal({
        tab,
        id: d.id,
        name: d.name,
        description: d.description ?? '',
        sort_order: '0',
        parent_id: '',
        icon: '',
        is_active: d.is_active,
      });
    } else if (tab === 'floors') {
      const f = item as Floor;
      setEditModal({
        tab,
        id: f.id,
        name: f.name,
        description: '',
        sort_order: String(f.sort_order ?? 0),
        parent_id: '',
        icon: '',
        is_active: f.is_active,
      });
    } else if (tab === 'locations') {
      const l = item as Location;
      setEditModal({
        tab,
        id: l.id,
        name: l.name,
        description: l.description ?? '',
        sort_order: '0',
        parent_id: l.floor_id,
        icon: '',
        is_active: l.is_active,
      });
    } else {
      const c = item as Category;
      setEditModal({
        tab,
        id: c.id,
        name: c.name,
        description: '',
        sort_order: '0',
        parent_id: c.department_id ?? '',
        icon: c.icon ?? '',
        is_active: c.is_active,
      });
    }
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editModal || !editModal.name.trim()) return;
    setSaving(true);
    setMsg(null);
    try {
      const supabase = createClient();
      if (editModal.tab === 'departments') {
        const { error } = await supabase
          .from('departments')
          .update({
            name: editModal.name.trim(),
            description: editModal.description.trim() || null,
            is_active: editModal.is_active,
          })
          .eq('id', editModal.id);
        if (error) throw error;
      } else if (editModal.tab === 'floors') {
        const { error } = await supabase
          .from('floors')
          .update({
            name: editModal.name.trim(),
            sort_order: Number(editModal.sort_order) || 0,
            is_active: editModal.is_active,
          })
          .eq('id', editModal.id);
        if (error) throw error;
      } else if (editModal.tab === 'locations') {
        if (!editModal.parent_id) throw new Error('Lütfen kat seçiniz.');
        const { error } = await supabase
          .from('locations')
          .update({
            floor_id: editModal.parent_id,
            name: editModal.name.trim(),
            description: editModal.description.trim() || null,
            is_active: editModal.is_active,
          })
          .eq('id', editModal.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('categories')
          .update({
            name: editModal.name.trim(),
            department_id: editModal.parent_id || null,
            icon: editModal.icon.trim() || null,
            is_active: editModal.is_active,
          })
          .eq('id', editModal.id);
        if (error) throw error;
      }

      setMsg({
        type: 'ok',
        text: `"${editModal.name.trim()}" kaydı güncellendi.`,
      });
      setEditModal(null);
      await loadAll();
    } catch (err) {
      setMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Kayıt güncellenemedi.',
      });
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(id: string, itemName: string, current: boolean) {
    setBusyId(id);
    setMsg(null);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from(tab)
        .update({ is_active: !current })
        .eq('id', id);
      if (error) throw error;
      setMsg({
        type: 'ok',
        text: `"${itemName}" ${!current ? 'aktif' : 'pasif'} durumuna alındı.`,
      });
      await loadAll();
    } catch (err) {
      setMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Durum güncellenemedi.',
      });
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(id: string, itemName: string) {
    let confirmText = `"${itemName}" kaydını silmek istediğinize emin misiniz?`;
    if (tab === 'floors') {
      const locCount = locationCountByFloor.get(id) ?? 0;
      if (locCount > 0) {
        confirmText = `"${itemName}" katında ${locCount} adet mahal tanımlı. Katı silerseniz bağlı mahaller de silinecektir.\nDevam etmek istiyor musunuz?`;
      }
    }

    if (!window.confirm(confirmText)) return;

    setBusyId(id);
    setMsg(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.from(tab).delete().eq('id', id);
      if (error) throw error;
      setMsg({ type: 'ok', text: `"${itemName}" silindi.` });
      await loadAll();
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      const isFk =
        raw.toLowerCase().includes('foreign key') ||
        raw.toLowerCase().includes('violates') ||
        raw.includes('23503');
      setMsg({
        type: 'err',
        text: isFk
          ? `"${itemName}" mevcut arıza, iş emri veya personel kayıtlarıyla ilişkili olduğu için silinemiyor; bunun yerine "Pasife Al" butonunu kullanabilirsiniz.`
          : `Silme işlemi başarısız: ${raw}`,
      });
    } finally {
      setBusyId(null);
    }
  }

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();

    if (tab === 'departments') {
      return departments.filter((d) => {
        if (statusFilter === 'active' && !d.is_active) return false;
        if (statusFilter === 'passive' && d.is_active) return false;
        if (!q) return true;
        return (
          d.name.toLowerCase().includes(q) ||
          (d.description ?? '').toLowerCase().includes(q)
        );
      });
    }

    if (tab === 'floors') {
      return floors.filter((f) => {
        if (statusFilter === 'active' && !f.is_active) return false;
        if (statusFilter === 'passive' && f.is_active) return false;
        if (!q) return true;
        return f.name.toLowerCase().includes(q);
      });
    }

    if (tab === 'locations') {
      return locations.filter((l) => {
        if (statusFilter === 'active' && !l.is_active) return false;
        if (statusFilter === 'passive' && l.is_active) return false;
        if (relFilter && l.floor_id !== relFilter) return false;
        if (!q) return true;
        const floorName = (floorNameMap.get(l.floor_id) ?? '').toLowerCase();
        return (
          l.name.toLowerCase().includes(q) ||
          (l.description ?? '').toLowerCase().includes(q) ||
          floorName.includes(q)
        );
      });
    }

    return categories.filter((c) => {
      if (statusFilter === 'active' && !c.is_active) return false;
      if (statusFilter === 'passive' && c.is_active) return false;
      if (relFilter && c.department_id !== relFilter) return false;
      if (!q) return true;
      const dName = c.department_id
        ? (deptNameMap.get(c.department_id) ?? '').toLowerCase()
        : '';
      return (
        c.name.toLowerCase().includes(q) ||
        (c.icon ?? '').toLowerCase().includes(q) ||
        dName.includes(q)
      );
    });
  }, [
    tab,
    departments,
    floors,
    locations,
    categories,
    search,
    statusFilter,
    relFilter,
    floorNameMap,
    deptNameMap,
  ]);

  const tabCards: {
    key: Tab;
    label: string;
    total: number;
    active: number;
    icon: typeof Building2;
    tone: string;
  }[] = [
    {
      key: 'departments',
      label: 'Departmanlar',
      total: departments.length,
      active: departments.filter((d) => d.is_active).length,
      icon: Building2,
      tone: 'bg-amber-100 text-amber-700',
    },
    {
      key: 'floors',
      label: 'Katlar',
      total: floors.length,
      active: floors.filter((f) => f.is_active).length,
      icon: Layers,
      tone: 'bg-sky-100 text-sky-700',
    },
    {
      key: 'locations',
      label: 'Mahaller',
      total: locations.length,
      active: locations.filter((l) => l.is_active).length,
      icon: MapPin,
      tone: 'bg-emerald-100 text-emerald-700',
    },
    {
      key: 'categories',
      label: 'Arıza Kategorileri',
      total: categories.length,
      active: categories.filter((c) => c.is_active).length,
      icon: Tag,
      tone: 'bg-rose-100 text-rose-700',
    },
  ];

  const colCount =
    tab === 'departments' || tab === 'floors' || tab === 'locations' || tab === 'categories'
      ? 5
      : 4;

  return (
    <div className="space-y-5">
      {/* Üst Başlık */}
      <div>
        <div className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400">
          ÇEKİRDEK YÖNETİM
        </div>
        <h1 className="mt-0.5 text-2xl font-extrabold text-slate-900">
          Çekirdek Tanımlar (Kat / Mahal / Kategori)
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Tüm modüllerin ortak kullandığı departman, kat, mahal ve arıza kategorisi ekleme,
          düzenleme ve silme yönetimi.
        </p>
      </div>

      {/* 4 Özet Sekme Kartı */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {tabCards.map((card) => {
          const Icon = card.icon;
          const isSelected = tab === card.key;
          return (
            <button
              key={card.key}
              type="button"
              onClick={() => switchTab(card.key)}
              className={`flex items-center justify-between rounded-2xl border p-4 text-left transition ${
                isSelected
                  ? 'border-navy bg-white shadow-sm ring-2 ring-navy/10'
                  : 'border-slate-200 bg-white/80 hover:border-slate-300 hover:bg-white'
              }`}
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-extrabold uppercase tracking-wider text-slate-500">
                    {card.label}
                  </span>
                  {isSelected && (
                    <span className="rounded-full bg-navy px-2 py-0.5 text-[10px] font-bold text-white">
                      Seçili
                    </span>
                  )}
                </div>
                <div className="mt-1 text-2xl font-extrabold text-navy">{card.total}</div>
                <div className="mt-0.5 text-xs text-slate-500">
                  {card.active} aktif · {card.total - card.active} pasif
                </div>
              </div>
              <span
                className={`flex h-10 w-10 items-center justify-center rounded-xl ${card.tone}`}
              >
                <Icon className="h-5 w-5" />
              </span>
            </button>
          );
        })}
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

      {/* Hızlı Yeni Kayıt Ekleme Formu */}
      {canManage && (
        <form
          onSubmit={handleAdd}
          className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
        >
          <div className="mb-2.5 text-xs font-extrabold uppercase tracking-wider text-navy">
            Yeni {TAB_META[tab].singular} Ekle
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {tab === 'locations' && (
              <select
                required
                value={parentId}
                onChange={(e) => setParentId(e.target.value)}
                className="min-w-[190px] rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm font-medium text-slate-800 focus:border-navy focus:outline-none"
              >
                <option value="">Kat Seçiniz *</option>
                {floors.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            )}

            <input
              type="text"
              required
              placeholder={
                tab === 'departments'
                  ? 'Departman adı (örn. Elektrik, Mekanik) *'
                  : tab === 'floors'
                  ? 'Kat adı (örn. 1. Kat, Otopark P1) *'
                  : tab === 'locations'
                  ? 'Mahal adı (örn. Kuzey Koridor, WC-3) *'
                  : 'Kategori adı (örn. Aydınlatma Arızası) *'
              }
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="min-w-[220px] flex-1 rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm text-slate-800 focus:border-navy focus:outline-none"
            />

            {tab === 'departments' && (
              <input
                type="text"
                placeholder="Açıklama (Opsiyonel)"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="min-w-[200px] flex-1 rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm text-slate-800 focus:border-navy focus:outline-none"
              />
            )}

            {tab === 'floors' && (
              <input
                type="number"
                placeholder="Sıra No"
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value)}
                className="w-28 rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm text-slate-800 focus:border-navy focus:outline-none"
              />
            )}

            {tab === 'locations' && (
              <input
                type="text"
                placeholder="Açıklama / Konum Notu (Opsiyonel)"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="min-w-[190px] flex-1 rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm text-slate-800 focus:border-navy focus:outline-none"
              />
            )}

            {tab === 'categories' && (
              <>
                <select
                  value={parentId}
                  onChange={(e) => setParentId(e.target.value)}
                  className="min-w-[200px] rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm font-medium text-slate-800 focus:border-navy focus:outline-none"
                >
                  <option value="">İlgili Departman (Opsiyonel)</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  placeholder="İkon / Kod (Opsiyonel)"
                  value={icon}
                  onChange={(e) => setIcon(e.target.value)}
                  className="w-44 rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm text-slate-800 focus:border-navy focus:outline-none"
                />
              </>
            )}

            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-xl bg-navy px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-navy-hover disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" />
              {saving ? 'Ekleniyor...' : `${TAB_META[tab].singular} Ekle`}
            </button>
          </div>
        </form>
      )}

      {/* Arama ve Durum / İlişki Filtre Barı */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-3">
        <div className="flex flex-wrap items-center gap-2">
          {(
            [
              ['all', 'Tümü'],
              ['active', 'Aktif'],
              ['passive', 'Pasif'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setStatusFilter(key)}
              className={`rounded-full px-4 py-1.5 text-xs font-bold transition ${
                statusFilter === key
                  ? 'bg-navy text-white shadow-sm'
                  : 'border border-slate-200 bg-canvas text-slate-700 hover:bg-slate-100'
              }`}
            >
              {label}
            </button>
          ))}

          {tab === 'locations' && (
            <select
              value={relFilter}
              onChange={(e) => setRelFilter(e.target.value)}
              className="rounded-xl border border-slate-200 bg-canvas px-3 py-1.5 text-xs font-bold text-slate-700 focus:border-navy focus:outline-none"
            >
              <option value="">Tüm Katlar</option>
              {floors.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          )}

          {tab === 'categories' && (
            <select
              value={relFilter}
              onChange={(e) => setRelFilter(e.target.value)}
              className="rounded-xl border border-slate-200 bg-canvas px-3 py-1.5 text-xs font-bold text-slate-700 focus:border-navy focus:outline-none"
            >
              <option value="">Tüm Departmanlar</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="relative min-w-[240px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Ad veya açıklama ara..."
            className="w-full rounded-xl border border-slate-200 bg-canvas py-1.5 pl-9 pr-3 text-sm text-slate-800 focus:border-navy focus:outline-none"
          />
        </div>
      </div>

      {/* Veri Tablosu */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-canvas text-[11px] font-extrabold uppercase tracking-wider text-slate-500">
              {tab === 'departments' && (
                <tr>
                  <th className="px-4 py-3">Departman Adı</th>
                  <th className="px-4 py-3">Açıklama</th>
                  <th className="px-4 py-3">Bağlı Kategori</th>
                  <th className="px-4 py-3">Durum</th>
                  <th className="px-4 py-3 text-right">İşlemler</th>
                </tr>
              )}
              {tab === 'floors' && (
                <tr>
                  <th className="px-4 py-3">Sıra No</th>
                  <th className="px-4 py-3">Kat Adı</th>
                  <th className="px-4 py-3">Bağlı Mahal</th>
                  <th className="px-4 py-3">Durum</th>
                  <th className="px-4 py-3 text-right">İşlemler</th>
                </tr>
              )}
              {tab === 'locations' && (
                <tr>
                  <th className="px-4 py-3">Mahal Adı</th>
                  <th className="px-4 py-3">Bulunduğu Kat</th>
                  <th className="px-4 py-3">Açıklama</th>
                  <th className="px-4 py-3">Durum</th>
                  <th className="px-4 py-3 text-right">İşlemler</th>
                </tr>
              )}
              {tab === 'categories' && (
                <tr>
                  <th className="px-4 py-3">Kategori Adı</th>
                  <th className="px-4 py-3">İlgili Departman</th>
                  <th className="px-4 py-3">İkon / Kod</th>
                  <th className="px-4 py-3">Durum</th>
                  <th className="px-4 py-3 text-right">İşlemler</th>
                </tr>
              )}
            </thead>

            <tbody className="divide-y divide-slate-100">
              {filteredItems.map((rawItem) => {
                const isBusy = busyId === rawItem.id;
                const activeBadge = (
                  <span
                    className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-extrabold ${
                      rawItem.is_active
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {rawItem.is_active ? 'Aktif' : 'Pasif'}
                  </span>
                );

                const actionButtons = canManage ? (
                  <div className="flex flex-wrap items-center justify-end gap-1.5">
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => openEdit(rawItem)}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-navy-soft/60 px-2.5 py-1 text-xs font-bold text-navy transition hover:bg-navy-soft disabled:opacity-50"
                    >
                      <Pencil className="h-3 w-3" />
                      Düzenle
                    </button>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() =>
                        toggleActive(rawItem.id, rawItem.name, rawItem.is_active)
                      }
                      className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                    >
                      {rawItem.is_active ? 'Pasife Al' : 'Aktif Yap'}
                    </button>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => handleDelete(rawItem.id, rawItem.name)}
                      className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-bold text-red-700 transition hover:bg-red-100 disabled:opacity-50"
                    >
                      <Trash2 className="h-3 w-3" />
                      Sil
                    </button>
                  </div>
                ) : (
                  <div className="text-right text-xs text-slate-400">Salt Okunur</div>
                );

                if (tab === 'departments') {
                  const d = rawItem as Department;
                  const catCount = categoryCountByDept.get(d.id) ?? 0;
                  return (
                    <tr key={d.id} className="hover:bg-canvas/60">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5 font-bold text-slate-900">
                          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
                            <Building2 className="h-3.5 w-3.5" />
                          </span>
                          <span>{d.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{d.description || '-'}</td>
                      <td className="px-4 py-3">
                        <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-bold text-slate-700">
                          {catCount} Kategori
                        </span>
                      </td>
                      <td className="px-4 py-3">{activeBadge}</td>
                      <td className="px-4 py-3">{actionButtons}</td>
                    </tr>
                  );
                }

                if (tab === 'floors') {
                  const f = rawItem as Floor;
                  const locCount = locationCountByFloor.get(f.id) ?? 0;
                  return (
                    <tr key={f.id} className="hover:bg-canvas/60">
                      <td className="px-4 py-3 font-mono text-xs font-bold text-slate-500">
                        #{f.sort_order}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5 font-bold text-slate-900">
                          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-sky-100 text-sky-700">
                            <Layers className="h-3.5 w-3.5" />
                          </span>
                          <span>{f.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-bold text-slate-700">
                          {locCount} Mahal
                        </span>
                      </td>
                      <td className="px-4 py-3">{activeBadge}</td>
                      <td className="px-4 py-3">{actionButtons}</td>
                    </tr>
                  );
                }

                if (tab === 'locations') {
                  const l = rawItem as Location;
                  const floorName = floorNameMap.get(l.floor_id) ?? '-';
                  return (
                    <tr key={l.id} className="hover:bg-canvas/60">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5 font-bold text-slate-900">
                          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
                            <MapPin className="h-3.5 w-3.5" />
                          </span>
                          <span>{l.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="rounded-lg bg-navy-soft px-2.5 py-1 text-xs font-bold text-navy">
                          {floorName}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{l.description || '-'}</td>
                      <td className="px-4 py-3">{activeBadge}</td>
                      <td className="px-4 py-3">{actionButtons}</td>
                    </tr>
                  );
                }

                const c = rawItem as Category;
                const deptName = c.department_id
                  ? deptNameMap.get(c.department_id) ?? '-'
                  : '-';
                return (
                  <tr key={c.id} className="hover:bg-canvas/60">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5 font-bold text-slate-900">
                        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-rose-100 text-rose-700">
                          <Tag className="h-3.5 w-3.5" />
                        </span>
                        <span>{c.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {c.department_id ? (
                        <span className="rounded-lg bg-navy-soft px-2.5 py-1 text-xs font-bold text-navy">
                          {deptName}
                        </span>
                      ) : (
                        <span className="text-slate-400">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">
                      {c.icon || '-'}
                    </td>
                    <td className="px-4 py-3">{activeBadge}</td>
                    <td className="px-4 py-3">{actionButtons}</td>
                  </tr>
                );
              })}

              {filteredItems.length === 0 && (
                <tr>
                  <td colSpan={colCount} className="px-4 py-10 text-center text-slate-500">
                    {loading
                      ? 'Tanımlar yükleniyor...'
                      : 'Bu filtreye uygun tanım kaydı bulunamadı.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Kayıt Düzenleme Modalı */}
      {editModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
          <form
            onSubmit={handleSaveEdit}
            className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h2 className="flex items-center gap-2 text-lg font-extrabold text-navy">
                <Pencil className="h-4 w-4 text-turquoise" />
                {TAB_META[editModal.tab].singular} Kaydını Düzenle
              </h2>
              <button
                type="button"
                onClick={() => setEditModal(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-4 space-y-4">
              {editModal.tab === 'locations' && (
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-600">
                    Bulunduğu Kat *
                  </label>
                  <select
                    required
                    value={editModal.parent_id}
                    onChange={(e) =>
                      setEditModal({ ...editModal, parent_id: e.target.value })
                    }
                    className="w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm font-semibold text-slate-800 focus:border-navy focus:outline-none"
                  >
                    <option value="">Kat Seçiniz</option>
                    {floors.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="mb-1 block text-xs font-bold text-slate-600">
                  {TAB_META[editModal.tab].singular} Adı *
                </label>
                <input
                  type="text"
                  required
                  value={editModal.name}
                  onChange={(e) => setEditModal({ ...editModal, name: e.target.value })}
                  className="w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm focus:border-navy focus:outline-none"
                />
              </div>

              {(editModal.tab === 'departments' || editModal.tab === 'locations') && (
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-600">
                    Açıklama
                  </label>
                  <input
                    type="text"
                    value={editModal.description}
                    onChange={(e) =>
                      setEditModal({ ...editModal, description: e.target.value })
                    }
                    className="w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm focus:border-navy focus:outline-none"
                  />
                </div>
              )}

              {editModal.tab === 'floors' && (
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-600">Sıra No</label>
                  <input
                    type="number"
                    value={editModal.sort_order}
                    onChange={(e) =>
                      setEditModal({ ...editModal, sort_order: e.target.value })
                    }
                    className="w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm focus:border-navy focus:outline-none"
                  />
                </div>
              )}

              {editModal.tab === 'categories' && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-bold text-slate-600">
                      İlgili Departman
                    </label>
                    <select
                      value={editModal.parent_id}
                      onChange={(e) =>
                        setEditModal({ ...editModal, parent_id: e.target.value })
                      }
                      className="w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm font-medium text-slate-800 focus:border-navy focus:outline-none"
                    >
                      <option value="">Departman Yok</option>
                      {departments.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-bold text-slate-600">
                      İkon / Kod
                    </label>
                    <input
                      type="text"
                      value={editModal.icon}
                      onChange={(e) => setEditModal({ ...editModal, icon: e.target.value })}
                      className="w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm focus:border-navy focus:outline-none"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="mb-1 block text-xs font-bold text-slate-600">Durum</label>
                <select
                  value={editModal.is_active ? 'active' : 'passive'}
                  onChange={(e) =>
                    setEditModal({ ...editModal, is_active: e.target.value === 'active' })
                  }
                  className="w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm font-semibold text-slate-800 focus:border-navy focus:outline-none"
                >
                  <option value="active">Aktif</option>
                  <option value="passive">Pasif</option>
                </select>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2 border-t border-slate-100 pt-4">
              <button
                type="button"
                onClick={() => setEditModal(null)}
                className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
              >
                Vazgeç
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-xl bg-navy px-5 py-2 text-xs font-bold text-white hover:bg-navy-hover disabled:opacity-50"
              >
                {saving ? 'Kaydediliyor...' : 'Değişiklikleri Kaydet'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

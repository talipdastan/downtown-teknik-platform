'use client';

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowDownCircle,
  ArrowUpCircle,
  Package,
  Plus,
  Search,
  X,
} from 'lucide-react';
import { createClient } from '@/core/supabase/client';
import { formatDateTime } from '@/core/constants';
import { useDashboardAuth } from '@/core/DashboardContext';
import { hasModulePermission } from '@/core/permissions';

type InventoryItem = {
  id: string;
  code: string;
  name: string;
  category: 'elektrik' | 'mekanik' | 'hvac' | 'aydinlatma' | 'sarf' | 'diger';
  unit: string;
  current_stock: number;
  min_stock: number;
  unit_cost: number;
  shelf_location: string | null;
};

type MovementRow = {
  id: string;
  movement_type: 'in' | 'out' | 'adjustment';
  quantity: number;
  note: string | null;
  created_at: string;
  inventory_items?: { code: string; name: string; unit: string } | null;
  profiles?: { full_name: string } | null;
};

const CAT_LABELS: Record<InventoryItem['category'], string> = {
  elektrik: 'Elektrik',
  mekanik: 'Mekanik',
  hvac: 'HVAC / İklimlendirme',
  aydinlatma: 'Aydınlatma',
  sarf: 'Sarf Malzeme',
  diger: 'Diğer',
};

export default function InventoryPage() {
  const { profile } = useDashboardAuth();
  const canManage =
    profile?.role === 'system_admin' ||
    profile?.role === 'technical_manager' ||
    hasModulePermission(profile, 'inventory', 'manage');

  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [onlyCritical, setOnlyCritical] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Yeni malzeme modalı
  const [showNew, setShowNew] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState<InventoryItem['category']>('elektrik');
  const [unit, setUnit] = useState('Adet');
  const [currentStock, setCurrentStock] = useState('0');
  const [minStock, setMinStock] = useState('5');
  const [unitCost, setUnitCost] = useState('0');
  const [shelf, setShelf] = useState('');
  const [saving, setSaving] = useState(false);

  // Stok hareketi modalı
  const [moveTarget, setMoveTarget] = useState<InventoryItem | null>(null);
  const [moveType, setMoveType] = useState<'in' | 'out' | 'adjustment'>('out');
  const [moveQty, setMoveQty] = useState('1');
  const [moveNote, setMoveNote] = useState('');
  const [moving, setMoving] = useState(false);

  const { data: pageData, isLoading: loading } = useQuery({
    queryKey: ['cmms', 'inventory'],
    queryFn: async () => {
      const supabase = createClient();
      const [iRes, mRes] = await Promise.all([
        supabase
          .from('inventory_items')
          .select('id, code, name, category, unit, current_stock, min_stock, unit_cost, shelf_location')
          .eq('is_active', true)
          .order('name'),
        supabase
          .from('stock_movements')
          .select('id, movement_type, quantity, note, created_at, inventory_items(code, name, unit), profiles(full_name)')
          .order('created_at', { ascending: false })
          .limit(40),
      ]);
      if (iRes.error) throw iRes.error;
      return {
        items: (iRes.data as InventoryItem[]) ?? [],
        movements: (mRes.data as unknown as MovementRow[]) ?? [],
      };
    },
  });

  const items = useMemo(() => pageData?.items ?? [], [pageData]);
  const movements = useMemo(() => pageData?.movements ?? [], [pageData]);

  const loadAll = async () => {
    await queryClient.invalidateQueries({ queryKey: ['cmms', 'inventory'] });
  };

  const criticalCount = useMemo(
    () => items.filter((i) => Number(i.current_stock) <= Number(i.min_stock)).length,
    [items]
  );

  const totalValue = useMemo(
    () => items.reduce((s, i) => s + Number(i.current_stock || 0) * Number(i.unit_cost || 0), 0),
    [items]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((i) => {
      if (onlyCritical && Number(i.current_stock) > Number(i.min_stock)) return false;
      if (!q) return true;
      return (
        i.code.toLowerCase().includes(q) ||
        i.name.toLowerCase().includes(q) ||
        (i.shelf_location ?? '').toLowerCase().includes(q)
      );
    });
  }, [items, search, onlyCritical]);

  async function handleAddItem(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim() || !name.trim()) return;
    setSaving(true);
    setMsg(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.from('inventory_items').insert({
        code: code.trim().toUpperCase(),
        name: name.trim(),
        category,
        unit: unit.trim() || 'Adet',
        current_stock: Number(currentStock) || 0,
        min_stock: Number(minStock) || 5,
        unit_cost: Number(unitCost) || 0,
        shelf_location: shelf.trim() || null,
        created_by: profile?.id ?? null,
      });
      if (error) throw error;
      setMsg({ type: 'ok', text: 'Yeni yedek parça / sarf malzeme stoğa eklendi.' });
      setShowNew(false);
      setCode('');
      setName('');
      setShelf('');
      await loadAll();
    } catch (err) {
      setMsg({ type: 'err', text: err instanceof Error ? err.message : 'Malzeme eklenemedi.' });
    } finally {
      setSaving(false);
    }
  }

  async function handleStockMovement(e: React.FormEvent) {
    e.preventDefault();
    if (!moveTarget) return;
    setMoving(true);
    setMsg(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.rpc('rpc_record_stock_movement', {
        p_item_id: moveTarget.id,
        p_movement_type: moveType,
        p_quantity: Number(moveQty),
        p_note: moveNote.trim() || null,
      });
      if (error) throw error;
      setMsg({ type: 'ok', text: `${moveTarget.name} için stok hareketi kaydedildi.` });
      setMoveTarget(null);
      setMoveNote('');
      await loadAll();
    } catch (err) {
      setMsg({ type: 'err', text: err instanceof Error ? err.message : 'Stok hareketi kaydedilemedi.' });
    } finally {
      setMoving(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400">
            KURUMSAL CMMS · TEKNİK DEPO
          </div>
          <h1 className="mt-0.5 text-2xl font-extrabold text-navy">
            Yedek Parça & Sarf Malzeme Stok Yönetimi
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            İş emirlerinden otomatik düşen sarf malzeme deposu, kritik stok seviye alarmları ve giriş/çıkış hareketleri.
          </p>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={() => setShowNew(true)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-navy px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-navy-hover"
          >
            <Plus className="h-4 w-4" />
            Yeni Malzeme Tanımla
          </button>
        )}
      </div>

      {/* KPI Kartları */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-[11px] font-extrabold uppercase text-slate-400">Toplam Stok Kalemi</div>
          <div className="mt-1 text-2xl font-extrabold text-navy">{items.length}</div>
        </div>
        <button
          type="button"
          onClick={() => setOnlyCritical((v) => !v)}
          className={`rounded-2xl border p-4 text-left transition ${
            onlyCritical ? 'border-rose-400 bg-rose-50' : 'border-rose-200 bg-rose-50/50 hover:bg-rose-50'
          }`}
        >
          <div className="flex items-center gap-1.5 text-[11px] font-extrabold uppercase text-rose-800">
            <AlertTriangle className="h-3.5 w-3.5" />
            Kritik Stok Altı {onlyCritical ? '(Filtrelendi)' : ''}
          </div>
          <div className="mt-1 text-2xl font-extrabold text-rose-700">{criticalCount}</div>
        </button>
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4">
          <div className="text-[11px] font-extrabold uppercase text-emerald-800">Tahmini Depo Değeri</div>
          <div className="mt-1 text-2xl font-extrabold text-emerald-700">
            ₺{totalValue.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}
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

      {/* Arama ve Malzeme Listesi */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-3.5">
          <div className="flex items-center gap-2 text-sm font-extrabold text-navy">
            <Package className="h-4 w-4" />
            Stok Kalemleri ({filtered.length})
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              placeholder="Kod, malzeme veya raf ara..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="rounded-xl border border-slate-200 bg-canvas py-1.5 pl-8 pr-3 text-xs"
            />
          </div>
        </div>
        {loading ? (
          <div className="p-8 text-center text-sm text-slate-400">Yükleniyor...</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-400">Kayıtlı stok kalemi bulunamadı.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-canvas text-[11px] font-extrabold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-3">Kod & Malzeme</th>
                  <th className="px-4 py-3">Kategori</th>
                  <th className="px-4 py-3">Raf</th>
                  <th className="px-4 py-3">Mevcut / Min</th>
                  <th className="px-4 py-3 text-right">Hareket</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((item) => {
                  const isCrit = Number(item.current_stock) <= Number(item.min_stock);
                  return (
                    <tr key={item.id} className="hover:bg-canvas/50">
                      <td className="px-4 py-3">
                        <div className="font-bold text-slate-900">{item.name}</div>
                        <div className="text-xs font-semibold text-navy">{item.code}</div>
                      </td>
                      <td className="px-4 py-3 text-xs font-semibold text-slate-600">
                        {CAT_LABELS[item.category] ?? item.category}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">{item.shelf_location ?? '-'}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-xs font-extrabold ${
                            isCrit ? 'bg-rose-100 text-rose-800' : 'bg-emerald-100 text-emerald-800'
                          }`}
                        >
                          {item.current_stock} {item.unit}
                        </span>
                        <span className="ml-1.5 text-[11px] text-slate-400">Min: {item.min_stock}</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex gap-1.5">
                          {canManage && (
                            <button
                              type="button"
                              onClick={() => {
                                setMoveTarget(item);
                                setMoveType('in');
                                setMoveQty('10');
                              }}
                              className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-800 hover:bg-emerald-100"
                            >
                              <ArrowDownCircle className="h-3.5 w-3.5" />
                              Giriş
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              setMoveTarget(item);
                              setMoveType('out');
                              setMoveQty('1');
                            }}
                            className="inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-900 hover:bg-amber-100"
                          >
                            <ArrowUpCircle className="h-3.5 w-3.5" />
                            Çıkış
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Son Stok Hareketleri */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-3.5 text-sm font-extrabold text-navy">
          Son Stok Hareketleri ({movements.length})
        </div>
        <div className="divide-y divide-slate-100">
          {movements.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-400">Henüz stok hareketi yok.</div>
          ) : (
            movements.map((m) => (
              <div key={m.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5 text-xs">
                <div>
                  <span className="font-bold text-slate-900">
                    {m.inventory_items?.code} – {m.inventory_items?.name}
                  </span>
                  <span className="ml-2 text-slate-500">
                    {m.profiles?.full_name ?? 'Personel'} · {formatDateTime(m.created_at)}
                  </span>
                  {m.note && <div className="text-slate-500">{m.note}</div>}
                </div>
                <span
                  className={`rounded-full px-2.5 py-0.5 font-extrabold ${
                    m.movement_type === 'in'
                      ? 'bg-emerald-100 text-emerald-800'
                      : m.movement_type === 'out'
                      ? 'bg-amber-100 text-amber-900'
                      : 'bg-sky-100 text-sky-800'
                  }`}
                >
                  {m.movement_type === 'in' ? '+' : m.movement_type === 'out' ? '-' : '='}{' '}
                  {m.quantity} {m.inventory_items?.unit ?? ''}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Yeni Malzeme Modalı */}
      {showNew && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <form onSubmit={handleAddItem} className="w-full max-w-lg space-y-3.5 rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-extrabold text-navy">Yeni Stok Kalemi</h2>
              <button type="button" onClick={() => setShowNew(false)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <input required placeholder="Stok Kodu (örn. ELK-001)" value={code} onChange={(e) => setCode(e.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm" />
              <select value={category} onChange={(e) => setCategory(e.target.value as InventoryItem['category'])} className="rounded-xl border border-slate-200 px-3 py-2 text-sm">
                {Object.entries(CAT_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
            <input required placeholder="Malzeme Adı (örn. 60x60 LED Panel 40W 4000K)" value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />
            <div className="grid gap-3 sm:grid-cols-4">
              <input placeholder="Birim" value={unit} onChange={(e) => setUnit(e.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm" />
              <input type="number" step="0.01" placeholder="Mevcut" value={currentStock} onChange={(e) => setCurrentStock(e.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm" />
              <input type="number" step="0.01" placeholder="Min Stok" value={minStock} onChange={(e) => setMinStock(e.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm" />
              <input type="number" step="0.01" placeholder="Birim ₺" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm" />
            </div>
            <input placeholder="Raf / Depo Konumu (örn. A-03 Elektrik Deposu)" value={shelf} onChange={(e) => setShelf(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowNew(false)} className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-600">Vazgeç</button>
              <button type="submit" disabled={saving} className="rounded-xl bg-navy px-4 py-2 text-xs font-bold text-white hover:bg-navy-hover disabled:opacity-50">
                {saving ? 'Kaydediliyor...' : 'Stoka Ekle'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Stok Hareketi Modalı */}
      {moveTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <form onSubmit={handleStockMovement} className="w-full max-w-md space-y-3.5 rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-extrabold text-navy">
                {moveType === 'in' ? 'Stok Girişi' : moveType === 'out' ? 'Sarf / Stok Çıkışı' : 'Sayım Düzeltme'}: {moveTarget.name}
              </h2>
              <button type="button" onClick={() => setMoveTarget(null)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="text-xs text-slate-500">
              Mevcut Stok: <strong>{moveTarget.current_stock} {moveTarget.unit}</strong>
            </div>
            <input
              type="number"
              required
              min="0.01"
              step="0.01"
              value={moveQty}
              onChange={(e) => setMoveQty(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            />
            <input
              placeholder="Açıklama (örn. Fatura no / kullanıldığı mahal)"
              value={moveNote}
              onChange={(e) => setMoveNote(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setMoveTarget(null)} className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-600">Vazgeç</button>
              <button type="submit" disabled={moving} className="rounded-xl bg-navy px-4 py-2 text-xs font-bold text-white hover:bg-navy-hover disabled:opacity-50">
                {moving ? 'İşleniyor...' : 'Hareketi Kaydet'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

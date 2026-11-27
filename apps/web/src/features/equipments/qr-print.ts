import { Equipment } from '@/types/database';

export type EquipmentLabelRow = Pick<Equipment, 'code' | 'name'> & {
  departments?: { name: string } | null;
  locations?: { name: string; floors?: { name: string } | null } | null;
};

export const EQUIPMENT_TYPES: { value: string; label: string }[] = [
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

export const EQUIPMENT_STATUS_LABELS: Record<Equipment['status'], string> = {
  active: 'Aktif',
  maintenance: 'Bakımda',
  out_of_service: 'Arızalı / Devre Dışı',
  retired: 'Hurda / Emekli',
};

export function printEquipmentQrLabels(items: EquipmentLabelRow[]): void {
  if (items.length === 0 || typeof window === 'undefined') return;
  const esc = (s: string) =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  const cards = items
    .map((eq) => {
      const qrPayload = `DT-EQ:${eq.code}`;
      const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&margin=6&data=${encodeURIComponent(qrPayload)}`;
      const loc = eq.locations
        ? `${eq.locations.floors?.name ? `${eq.locations.floors.name} · ` : ''}${eq.locations.name}`
        : '-';
      return `<div class="card">
        <img src="${qrUrl}" alt="${esc(eq.code)}" />
        <div class="meta">
          <div class="brand">DOWNTOWN TEKNİK</div>
          <div class="code">${esc(eq.code)}</div>
          <div class="name">${esc(eq.name)}</div>
          <div class="loc">${esc(loc)}</div>
          <div class="dept">${esc(eq.departments?.name ?? 'Teknik Birim')}</div>
        </div>
      </div>`;
    })
    .join('');

  const html = `<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>Ekipman QR Etiketleri</title>
    <style>
      body{font-family:Arial,sans-serif;margin:12mm;color:#0f172a}
      .hdr{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;border-bottom:2px solid #17365d;padding-bottom:6px}
      .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
      .card{border:1px solid #cbd5e1;border-radius:10px;padding:8px;display:flex;gap:8px;align-items:center;break-inside:avoid}
      .card img{width:68px;height:68px;border:1px solid #e2e8f0;border-radius:6px;flex-shrink:0}
      .brand{font-size:8px;font-weight:800;color:#0e7490;letter-spacing:.6px}
      .code{font-size:13px;font-weight:900;color:#17365d;margin-top:1px}
      .name{font-size:10px;font-weight:700;color:#1e293b;margin-top:2px}
      .loc,.dept{font-size:9px;color:#64748b;margin-top:2px}
      @media print{.no-print{display:none}}
    </style></head><body>
    <div class="hdr">
      <strong>Downtown Teknik – Toplu Ekipman QR Etiket Baskısı (${items.length} Adet)</strong>
      <button class="no-print" onclick="window.print()" style="padding:6px 12px;background:#17365d;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:700">Yazdır / PDF Kaydet</button>
    </div>
    <div class="grid">${cards}</div>
    <script>window.onload=function(){setTimeout(function(){window.print()},500)}</script>
    </body></html>`;

  const win = window.open('', '_blank', 'width=1024,height=768');
  if (win) {
    win.document.open();
    win.document.write(html);
    win.document.close();
  }
}

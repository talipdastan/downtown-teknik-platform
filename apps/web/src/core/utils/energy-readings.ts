export type ReadingsViewMode = 'all' | 'electric' | 'mechanical';
export type ReadingExportCell = string | number | null | undefined;

export interface ReadingRowLike {
  reading_date: string;
  active_value: number | null;
  inductive_value: number | null;
  capacitive_value: number | null;
  inductive_percent: number | null;
  capacitive_percent: number | null;
  index_value: number | null;
  consumption: number;
  entered_by_name: string;
  meters?: {
    name: string;
    meter_type: 'electric' | 'mechanical';
    category?: string;
    multiplier?: number;
  } | null;
}

export function resolveReadingsViewMode(
  typeFilter: ReadingsViewMode,
  selectedFilterMeter?: { meter_type: 'electric' | 'mechanical' } | null,
  rows?: Array<{ meters?: { meter_type: 'electric' | 'mechanical' } | null }>
): ReadingsViewMode {
  if (selectedFilterMeter) {
    return selectedFilterMeter.meter_type;
  }
  if (typeFilter !== 'all') {
    return typeFilter;
  }
  if (rows && rows.length > 0) {
    const types = rows
      .map((r) => r.meters?.meter_type)
      .filter((t): t is 'electric' | 'mechanical' => t === 'electric' || t === 'mechanical');
    if (types.length === rows.length) {
      if (types.every((t) => t === 'mechanical')) return 'mechanical';
      if (types.every((t) => t === 'electric')) return 'electric';
    }
  }
  return 'all';
}

export function meterCategoryLabel(
  category?: string,
  meterType?: 'electric' | 'mechanical'
): string {
  if (meterType === 'electric' || category === 'electric') return 'Elektrik';
  if (category === 'water') return 'Şebeke Suyu';
  if (category === 'gas') return 'Doğalgaz';
  if (category === 'cooling') return 'Soğutma / Kule';
  return 'Mekanik';
}

export function buildReadingsExportData(
  viewMode: ReadingsViewMode,
  rows: ReadingRowLike[],
  formatDateFn: (iso: string) => string
): { headers: string[]; reportRows: ReadingExportCell[][] } {
  if (viewMode === 'mechanical') {
    const headers = ['Tarih', 'Sayaç', 'Kategori', 'Endeks', 'Tüketim (m³)', 'Giren'];
    const reportRows: ReadingExportCell[][] = rows.map((r) => [
      formatDateFn(r.reading_date),
      r.meters?.name ?? '-',
      meterCategoryLabel(r.meters?.category, 'mechanical'),
      r.index_value ?? '-',
      Number(Number(r.consumption ?? 0).toFixed(2)),
      r.entered_by_name,
    ]);
    return { headers, reportRows };
  }

  if (viewMode === 'electric') {
    const headers = [
      'Tarih',
      'Sayaç',
      'Aktif Endeks',
      'İndüktif Endeks',
      'Kapasitif Endeks',
      'Tüketim (kWh)',
      'İndüktif %',
      'Kapasitif %',
      'Giren',
    ];
    const reportRows: ReadingExportCell[][] = rows.map((r) => [
      formatDateFn(r.reading_date),
      r.meters?.name ?? '-',
      r.active_value ?? '-',
      r.inductive_value ?? '-',
      r.capacitive_value ?? '-',
      Number(Number(r.consumption ?? 0).toFixed(2)),
      r.inductive_percent ?? 0,
      r.capacitive_percent ?? 0,
      r.entered_by_name,
    ]);
    return { headers, reportRows };
  }

  const headers = [
    'Tarih',
    'Sayaç',
    'Tür',
    'Okuma / Endeks',
    'Tüketim',
    'Birim',
    'Reaktif Durum',
    'Giren',
  ];
  const reportRows: ReadingExportCell[][] = rows.map((r) => {
    const isElec = r.meters?.meter_type === 'electric';
    return [
      formatDateFn(r.reading_date),
      r.meters?.name ?? '-',
      isElec ? 'Elektrik' : meterCategoryLabel(r.meters?.category, 'mechanical'),
      isElec
        ? `Aktif: ${r.active_value ?? '-'} | İnd: ${r.inductive_value ?? '-'} | Kap: ${r.capacitive_value ?? '-'}`
        : `Endeks: ${r.index_value ?? '-'}`,
      Number(Number(r.consumption ?? 0).toFixed(2)),
      isElec ? 'kWh' : 'm³',
      isElec
        ? `İnd %${r.inductive_percent ?? 0} / Kap %${r.capacitive_percent ?? 0}`
        : '-',
      r.entered_by_name,
    ];
  });
  return { headers, reportRows };
}

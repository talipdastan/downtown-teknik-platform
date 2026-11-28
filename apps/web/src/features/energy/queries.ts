import { createClient } from '@/core/supabase/client';
import {
  ENERGY_BUDGET_SELECT,
  ENERGY_INVOICE_SELECT,
  EQUIPMENT_SELECT,
  METER_READING_SELECT,
  METER_SELECT,
} from '@/core/supabase/selects';
import {
  EnergyBudget,
  EnergyInvoice,
  Equipment,
  Meter,
  MeterCategory,
  MeterReading,
  MeterType,
  TrashedMeter,
  UtilityType,
} from '@/types/database';
import { ReadingsViewMode } from '@/core/utils/energy-readings';

export type EnergyDashboardItem = {
  meter_id: string;
  meter_name: string;
  meter_type: 'electric' | 'mechanical';
  category: string;
  multiplier: number;
  equipment_code: string | null;
  equipment_name: string | null;
  latest_reading_date: string | null;
  latest_consumption: number | null;
  latest_inductive_percent: number | null;
  latest_capacitive_percent: number | null;
  monthly_total_consumption: number;
};

export type RecentReadingRow = {
  reading_date: string;
  meter_id: string;
  consumption: number;
  meters?: {
    name: string;
    meter_type: 'electric' | 'mechanical';
    category: string;
  } | null;
};

export type ReadingHealthItem = {
  meter_id: string;
  meter_name: string;
  category: string;
  has_reading_this_month: boolean;
};

export type EnergyAnomalyItem = {
  meter_id: string;
  meter_name: string;
  meter_type: string;
  latest_date: string;
  latest_consumption: number;
  avg_consumption: number;
  deviation_pct: number;
};

export type MeterWithEq = Meter & {
  equipments?: { code: string; name: string } | null;
};

export type ReadingWithMeter = MeterReading & {
  meters?: {
    name: string;
    meter_type: 'electric' | 'mechanical';
    category?: string;
    multiplier?: number;
  } | null;
};

export async function fetchEnergyOverview(year: number, month: number) {
  const supabase = createClient();
  const since = new Date();
  since.setDate(since.getDate() - 30);

  const [sumRes, recRes, healthRes, anomRes] = await Promise.all([
    supabase.rpc('rpc_energy_dashboard_summary', {
      p_year: year,
      p_month: month,
    }),
    supabase
      .from('meter_readings')
      .select(
        'reading_date, meter_id, consumption, meters!inner(name, meter_type, category, deleted_at)'
      )
      .is('meters.deleted_at', null)
      .gte('reading_date', since.toISOString())
      .order('reading_date', { ascending: true })
      .limit(1000),
    supabase.rpc('rpc_get_energy_reading_health', {
      p_year: year,
      p_month: month,
    }),
    supabase.rpc('rpc_get_energy_anomalies', { p_threshold_pct: 35 }),
  ]);
  if (sumRes.error) throw sumRes.error;

  const healthAll: ReadingHealthItem[] =
    !healthRes.error && Array.isArray(healthRes.data)
      ? (healthRes.data as ReadingHealthItem[])
      : [];
  const anomalies: EnergyAnomalyItem[] =
    !anomRes.error && Array.isArray(anomRes.data)
      ? (anomRes.data as EnergyAnomalyItem[])
      : [];

  return {
    items: (sumRes.data as EnergyDashboardItem[]) ?? [],
    recentReadings: (recRes.data as unknown as RecentReadingRow[]) ?? [],
    totalHealthMeters: healthAll.length,
    unreadMeters: healthAll.filter((x) => !x.has_reading_this_month),
    anomalies,
  };
}

export async function setupDefaultMeters(): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc('rpc_setup_default_meters');
  if (error) throw error;
}

export async function fetchMetersData(isAdmin: boolean) {
  const supabase = createClient();
  const [mRes, eqRes, trashRes] = await Promise.all([
    supabase
      .from('meters')
      .select(`${METER_SELECT}, equipments(code, name)`)
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('meter_type')
      .order('sort_order')
      .order('name'),
    supabase
      .from('equipments')
      .select(EQUIPMENT_SELECT)
      .eq('is_active', true)
      .order('name')
      .limit(300),
    isAdmin
      ? supabase.rpc('rpc_list_trashed_meters')
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (mRes.error) throw mRes.error;
  if (trashRes.error) throw trashRes.error;
  return {
    meters: (mRes.data as unknown as MeterWithEq[]) ?? [],
    equipments: (eqRes.data as Equipment[]) ?? [],
    trashedMeters: (trashRes.data as unknown as TrashedMeter[]) ?? [],
  };
}

export interface SaveMeterPayload {
  name: string;
  meter_type: MeterType;
  category: MeterCategory;
  multiplier: number;
  eic_code: string | null;
  tekil_code: string | null;
  meter_no: string | null;
  contract_no: string | null;
  subscriber_no: string | null;
  region: string | null;
  equipment_id: string | null;
}

export async function saveMeter(
  id: string | null,
  payload: SaveMeterPayload,
  sortOrder?: number
): Promise<void> {
  const supabase = createClient();
  if (id) {
    const { error } = await supabase.from('meters').update(payload).eq('id', id);
    if (error) throw error;
  } else {
    const { error } = await supabase.from('meters').insert({
      ...payload,
      sort_order: sortOrder ?? 0,
    });
    if (error) throw error;
  }
}

export async function softDeleteMeter(meterId: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc('rpc_soft_delete_meter', { p_meter_id: meterId });
  if (error) throw error;
}

export async function restoreMeter(meterId: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc('rpc_restore_meter', { p_meter_id: meterId });
  if (error) throw error;
}

export async function permanentlyDeleteMeter(meterId: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc('rpc_permanently_delete_meter', {
    p_meter_id: meterId,
  });
  if (error) throw error;
}

export async function fetchActiveMeters(): Promise<Meter[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('meters')
    .select(METER_SELECT)
    .eq('is_active', true)
    .is('deleted_at', null)
    .order('name');
  if (error) throw error;
  return (data as Meter[]) ?? [];
}

export interface FetchReadingsParams {
  typeFilter: ReadingsViewMode;
  meterFilter: string;
  dateFrom: string;
  dateTo: string;
  page: number;
  pageSize: number;
}

export async function fetchMeterReadings(
  params: FetchReadingsParams
): Promise<ReadingWithMeter[]> {
  const supabase = createClient();
  let q = supabase
    .from('meter_readings')
    .select(
      `${METER_READING_SELECT}, meters!inner(name, meter_type, category, multiplier, deleted_at)`
    )
    .is('meters.deleted_at', null)
    .order('reading_date', { ascending: false })
    .range(
      params.page * params.pageSize,
      params.page * params.pageSize + params.pageSize - 1
    );

  if (params.typeFilter !== 'all') q = q.eq('meters.meter_type', params.typeFilter);
  if (params.meterFilter) q = q.eq('meter_id', params.meterFilter);
  if (params.dateFrom) q = q.gte('reading_date', `${params.dateFrom}T00:00:00+03:00`);
  if (params.dateTo) q = q.lte('reading_date', `${params.dateTo}T23:59:59+03:00`);

  const { data, error } = await q;
  if (error) throw error;
  return (data as unknown as ReadingWithMeter[]) ?? [];
}

export async function recordMeterReading(params: {
  meterId: string;
  readingDate: string;
  activeValue: number | null;
  inductiveValue: number | null;
  capacitiveValue: number | null;
  indexValue: number | null;
  overwrite: boolean;
}): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc('rpc_record_meter_reading', {
    p_meter_id: params.meterId,
    p_reading_date: `${params.readingDate}T12:00:00+03:00`,
    p_active_value: params.activeValue,
    p_inductive_value: params.inductiveValue,
    p_capacitive_value: params.capacitiveValue,
    p_index_value: params.indexValue,
    p_overwrite: params.overwrite,
  });
  if (error) throw error;
}

export async function updateMeterReading(
  id: string,
  payload: {
    reading_date: string;
    active_value: number | null;
    inductive_value: number | null;
    capacitive_value: number | null;
    inductive_percent: number | null;
    capacitive_percent: number | null;
    index_value: number | null;
    consumption: number;
    notes: string | null;
  }
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from('meter_readings').update(payload).eq('id', id);
  if (error) throw error;
}

export async function deleteMeterReading(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from('meter_readings').delete().eq('id', id);
  if (error) throw error;
}

export async function fetchEnergyInvoicesData(year: number) {
  const supabase = createClient();
  const [invRes, mRes, bRes] = await Promise.all([
    supabase
      .from('energy_invoices')
      .select(ENERGY_INVOICE_SELECT)
      .eq('period_year', year)
      .order('period_month', { ascending: false })
      .order('meter_name'),
    supabase
      .from('meters')
      .select(METER_SELECT)
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('name'),
    supabase
      .from('energy_budgets')
      .select(ENERGY_BUDGET_SELECT)
      .eq('period_year', year),
  ]);
  if (invRes.error) throw invRes.error;
  return {
    invoices: (invRes.data as EnergyInvoice[]) ?? [],
    meters: (mRes.data as Meter[]) ?? [],
    budgets: (bRes.data as EnergyBudget[]) ?? [],
  };
}

export async function insertEnergyInvoicesBatch(
  rows: Array<{
    period_year: number;
    period_month: number;
    utility_type: UtilityType;
    provider: string;
    invoice_no: string | null;
    invoice_date: string | null;
    invoice_type: 'normal' | 'late_fee';
    meter_id: string | null;
    meter_name: string;
    meter_no: string | null;
    contract_no: string | null;
    eic_code: string | null;
    tekil_code: string | null;
    subscriber_no: string | null;
    consumption: number;
    amount_tl: number;
    inductive_penalty_tl: number;
    capacitive_penalty_tl: number;
    notes: string | null;
  }>
): Promise<void> {
  const supabase = createClient();
  const { data: uRes } = await supabase.auth.getUser();
  const uid = uRes.user?.id ?? null;
  let userName = 'Yönetici';
  if (uid) {
    const { data: prof } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', uid)
      .single();
    if (prof?.full_name) userName = prof.full_name;
  }

  const { error } = await supabase.from('energy_invoices').insert(
    rows.map((r) => ({
      ...r,
      entered_by_id: uid,
      entered_by_name: userName,
    }))
  );
  if (error) throw error;
}

export async function saveEnergyInvoice(
  id: string | undefined,
  payload: {
    period_year: number;
    period_month: number;
    utility_type: UtilityType;
    provider: string;
    invoice_no: string | null;
    invoice_date: string | null;
    meter_id: string | null;
    meter_name: string;
    consumption: number;
    amount_tl: number;
    inductive_penalty_tl: number;
    capacitive_penalty_tl: number;
    tenant_amount_tl: number | null;
  }
): Promise<void> {
  const supabase = createClient();
  if (id) {
    const { error } = await supabase
      .from('energy_invoices')
      .update(payload)
      .eq('id', id);
    if (error) throw error;
  } else {
    const { data: uRes } = await supabase.auth.getUser();
    const uid = uRes.user?.id ?? null;
    const { error } = await supabase.from('energy_invoices').insert({
      ...payload,
      invoice_type: 'normal',
      entered_by_id: uid,
      entered_by_name: 'Yönetici',
    });
    if (error) throw error;
  }
}

export async function deleteEnergyInvoice(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from('energy_invoices').delete().eq('id', id);
  if (error) throw error;
}

export async function deleteEnergyInvoices(ids: string[]): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from('energy_invoices').delete().in('id', ids);
  if (error) throw error;
}

export async function fetchEnergyBudgetsData(year: number) {
  const supabase = createClient();
  const [bRes, iRes] = await Promise.all([
    supabase
      .from('energy_budgets')
      .select(ENERGY_BUDGET_SELECT)
      .eq('period_year', year)
      .order('period_month')
      .order('utility_type'),
    supabase
      .from('energy_invoices')
      .select(ENERGY_INVOICE_SELECT)
      .eq('period_year', year),
  ]);
  if (bRes.error) throw bRes.error;
  return {
    budgets: (bRes.data as EnergyBudget[]) ?? [],
    invoices: (iRes.data as EnergyInvoice[]) ?? [],
  };
}

export interface EnergyBudgetUpsertRow {
  period_year: number;
  period_month: number;
  utility_type: UtilityType;
  budget_consumption: number;
  budget_tl: number;
  prev_year_consumption: number;
  prev_year_tl: number;
}

export async function saveEnergyBudget(
  id: string | null,
  payload: EnergyBudgetUpsertRow
): Promise<void> {
  const supabase = createClient();
  if (id) {
    const { error } = await supabase
      .from('energy_budgets')
      .update(payload)
      .eq('id', id);
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from('energy_budgets')
      .upsert(payload, { onConflict: 'period_year,period_month,utility_type' });
    if (error) throw error;
  }
}

export async function upsertEnergyBudgetsBatch(
  rows: EnergyBudgetUpsertRow[]
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from('energy_budgets')
    .upsert(rows, { onConflict: 'period_year,period_month,utility_type' });
  if (error) throw error;
}

export async function deleteEnergyBudget(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from('energy_budgets').delete().eq('id', id);
  if (error) throw error;
}

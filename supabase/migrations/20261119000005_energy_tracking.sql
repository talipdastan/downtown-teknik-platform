-- =====================================================================
-- MIGRATION: 20261119000005_energy_tracking.sql
-- PROJECT: AVM TECH – Modüler Platform / Enerji Takip Modülü (energy)
-- DESCRIPTION: sayac_takip_app (Firebase) modüllerinin PostgreSQL şeması:
--   meters, meter_readings, energy_invoices, energy_budgets,
--   ortak equipments bağlantısı, RLS politikaları, RPC'ler ve Storage.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. TABLOLAR
-- ---------------------------------------------------------------------

create table if not exists public.meters (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  name text not null,
  meter_type text not null check (meter_type in ('electric', 'mechanical')),
  category text not null check (category in ('electric', 'water', 'cooling', 'gas', 'other')),
  multiplier numeric(12,4) not null default 1.0 check (multiplier > 0),
  sort_order integer not null default 0,
  meter_no text,
  contract_no text,
  eic_code text,
  tekil_code text,
  subscriber_no text,
  region text,
  equipment_id uuid references public.equipments(id) on delete set null,
  location_id uuid references public.locations(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.meter_readings (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  meter_id uuid not null references public.meters(id) on delete cascade,
  reading_date timestamptz not null,
  active_value numeric(14,3),
  inductive_value numeric(14,3),
  capacitive_value numeric(14,3),
  inductive_percent numeric(6,2),
  capacitive_percent numeric(6,2),
  index_value numeric(14,3),
  consumption numeric(14,3) not null default 0,
  entered_by_id uuid references public.profiles(id) on delete set null,
  entered_by_name text not null,
  notes text,
  client_mutation_id uuid unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.energy_invoices (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  period_year smallint not null,
  period_month smallint not null check (period_month between 1 and 12),
  utility_type text not null check (utility_type in ('electric', 'gas', 'water')),
  provider text not null,
  invoice_no text,
  invoice_date date,
  invoice_type text not null default 'normal' check (invoice_type in ('normal', 'late_fee')),
  meter_id uuid references public.meters(id) on delete set null,
  meter_name text not null,
  meter_no text,
  contract_no text,
  eic_code text,
  tekil_code text,
  subscriber_no text,
  consumption numeric(14,3) not null default 0,
  amount_tl numeric(14,2) not null default 0,
  inductive_penalty_tl numeric(12,2) not null default 0,
  capacitive_penalty_tl numeric(12,2) not null default 0,
  tenant_consumption numeric(14,3),
  tenant_amount_tl numeric(14,2),
  pdf_storage_path text,
  notes text,
  entered_by_id uuid references public.profiles(id) on delete set null,
  entered_by_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.energy_budgets (
  id uuid primary key default gen_random_uuid(),
  period_year smallint not null,
  period_month smallint not null check (period_month between 1 and 12),
  utility_type text not null check (utility_type in ('electric', 'gas', 'water')),
  budget_consumption numeric(14,3) not null default 0,
  budget_tl numeric(14,2) not null default 0,
  prev_year_consumption numeric(14,3) not null default 0,
  prev_year_tl numeric(14,2) not null default 0,
  updated_by_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint energy_budgets_period_utility_unique unique (period_year, period_month, utility_type)
);

-- ---------------------------------------------------------------------
-- 2. PERFORMANS İNDEKSLERİ VE UPDATED_AT TETİKLEYİCİLERİ
-- ---------------------------------------------------------------------
create index if not exists idx_meters_type_order
  on public.meters (meter_type, sort_order, name);
create index if not exists idx_meters_equipment
  on public.meters (equipment_id);
create index if not exists idx_meter_readings_meter_date
  on public.meter_readings (meter_id, reading_date desc);
create index if not exists idx_meter_readings_date
  on public.meter_readings (reading_date desc);
create index if not exists idx_energy_invoices_period
  on public.energy_invoices (period_year, period_month, utility_type);
create index if not exists idx_energy_invoices_meter
  on public.energy_invoices (meter_id);

drop trigger if exists trg_meters_updated_at on public.meters;
create trigger trg_meters_updated_at before update on public.meters
for each row execute function public.set_updated_at();

drop trigger if exists trg_meter_readings_updated_at on public.meter_readings;
create trigger trg_meter_readings_updated_at before update on public.meter_readings
for each row execute function public.set_updated_at();

drop trigger if exists trg_energy_invoices_updated_at on public.energy_invoices;
create trigger trg_energy_invoices_updated_at before update on public.energy_invoices
for each row execute function public.set_updated_at();

drop trigger if exists trg_energy_budgets_updated_at on public.energy_budgets;
create trigger trg_energy_budgets_updated_at before update on public.energy_budgets
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- 3. ROW LEVEL SECURITY (merkezi 8 bağımsız yetki: energy)
-- ---------------------------------------------------------------------
alter table public.meters enable row level security;
alter table public.meter_readings enable row level security;
alter table public.energy_invoices enable row level security;
alter table public.energy_budgets enable row level security;

-- meters
drop policy if exists "Energy viewers read meters" on public.meters;
create policy "Energy viewers read meters" on public.meters
for select to authenticated
using (public.has_module_permission('energy', 'view'));

drop policy if exists "Energy managers insert meters" on public.meters;
create policy "Energy managers insert meters" on public.meters
for insert to authenticated
with check (public.has_module_permission('energy', 'manage'));

drop policy if exists "Energy managers update meters" on public.meters;
create policy "Energy managers update meters" on public.meters
for update to authenticated
using (public.has_module_permission('energy', 'manage'))
with check (public.has_module_permission('energy', 'manage'));

drop policy if exists "Energy managers delete meters" on public.meters;
create policy "Energy managers delete meters" on public.meters
for delete to authenticated
using (
  public.has_module_permission('energy', 'delete')
  or public.has_module_permission('energy', 'manage')
);

-- meter_readings
drop policy if exists "Energy viewers read readings" on public.meter_readings;
create policy "Energy viewers read readings" on public.meter_readings
for select to authenticated
using (public.has_module_permission('energy', 'view'));

drop policy if exists "Energy creators insert readings" on public.meter_readings;
create policy "Energy creators insert readings" on public.meter_readings
for insert to authenticated
with check (public.has_module_permission('energy', 'create'));

drop policy if exists "Energy editors update readings" on public.meter_readings;
create policy "Energy editors update readings" on public.meter_readings
for update to authenticated
using (public.has_module_permission('energy', 'edit'))
with check (public.has_module_permission('energy', 'edit'));

drop policy if exists "Energy deleters delete readings" on public.meter_readings;
create policy "Energy deleters delete readings" on public.meter_readings
for delete to authenticated
using (public.has_module_permission('energy', 'delete'));

-- energy_invoices
drop policy if exists "Energy viewers read invoices" on public.energy_invoices;
create policy "Energy viewers read invoices" on public.energy_invoices
for select to authenticated
using (
  public.has_module_permission('energy', 'reports')
  or public.has_module_permission('energy', 'view')
);

drop policy if exists "Energy managers insert invoices" on public.energy_invoices;
create policy "Energy managers insert invoices" on public.energy_invoices
for insert to authenticated
with check (public.has_module_permission('energy', 'manage'));

drop policy if exists "Energy managers update invoices" on public.energy_invoices;
create policy "Energy managers update invoices" on public.energy_invoices
for update to authenticated
using (public.has_module_permission('energy', 'manage'))
with check (public.has_module_permission('energy', 'manage'));

drop policy if exists "Energy managers delete invoices" on public.energy_invoices;
create policy "Energy managers delete invoices" on public.energy_invoices
for delete to authenticated
using (
  public.has_module_permission('energy', 'delete')
  or public.has_module_permission('energy', 'manage')
);

-- energy_budgets
drop policy if exists "Energy viewers read budgets" on public.energy_budgets;
create policy "Energy viewers read budgets" on public.energy_budgets
for select to authenticated
using (
  public.has_module_permission('energy', 'reports')
  or public.has_module_permission('energy', 'view')
);

drop policy if exists "Energy managers manage budgets" on public.energy_budgets;
create policy "Energy managers manage budgets" on public.energy_budgets
for all to authenticated
using (public.has_module_permission('energy', 'manage'))
with check (public.has_module_permission('energy', 'manage'));

-- ---------------------------------------------------------------------
-- 4. GÜVENLİ RPC FONKSİYONLARI
-- ---------------------------------------------------------------------

-- 4.1 Ön tanımlı AVM sayaçlarını bilinen EIC / Tekil / Sayaç No ile kur (idempotent)
create or replace function public.rpc_setup_default_meters()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted integer := 0;
  v_row_count integer := 0;
begin
  if not public.has_module_permission('energy', 'manage') then
    raise exception 'Erişim engellendi: Varsayılan sayaçları kurma yetkiniz yok.';
  end if;

  if exists (select 1 from public.meters limit 1) then
    return 0;
  end if;

  insert into public.meters (
    legacy_id, name, meter_type, category, multiplier, sort_order,
    meter_no, contract_no, eic_code, tekil_code
  ) values
    ('gt_adp_1', 'GT.ADP.1', 'electric', 'electric', 1.0, 0, '600036275', '21577637', '40Z000193592876I', '3736885'),
    ('gt_adp_2', 'GT.ADP.2', 'electric', 'electric', 1.0, 1, '600036273', '21577064', '40Z000193592829R', '3734844'),
    ('gt_adp_3', 'GT.ADP.3', 'electric', 'electric', 1.0, 2, '600036192', '21577432', null, null),
    ('gt_adp_4', 'GT.ADP.4', 'electric', 'electric', 1.0, 3, '600036274', '21577345', '40Z000193880309B', '3734928'),
    ('kazan-adp', 'KAZAN-ADP', 'electric', 'electric', 1.0, 4, '600007720', '21568388', '40Z0001779045278', '3688374'),
    ('havuz-adp', 'HAVUZ-ADP', 'electric', 'electric', 1.0, 5, '600007718', '21576867', '40Z000177904526A', '3688372'),
    ('mcc-adp', 'MCC-ADP', 'electric', 'electric', 1.0, 6, '600036196', '21577179', '40Z0001935927325', '3734793'),
    ('şebeke_suyu', 'Şebeke Suyu', 'mechanical', 'water', 1.0, 0, '18911845', '100103076', null, null),
    ('1_su_yumuşatma', '1. Su Yumuşatma', 'mechanical', 'other', 1.0, 1, null, null, null, null),
    ('2_su_yumuşatma', '2. Su yumuşatma', 'mechanical', 'other', 1.0, 2, null, null, null, null),
    ('kule_sayaç', 'Kule Sayaç', 'mechanical', 'cooling', 1.0, 3, null, null, null, null),
    ('kazan_doğalgaz', 'Kazan Doğalgaz', 'mechanical', 'gas', 1.0, 4, null, null, null, null),
    ('radyant_doğalgaz', 'Radyant Doğalgaz', 'mechanical', 'gas', 1.0, 5, null, null, null, null)
  on conflict (legacy_id) do nothing;

  get diagnostics v_row_count = row_count;
  v_inserted := v_row_count;
  return v_inserted;
end;
$$;

-- 4.2 Sayaç okuma kaydı (önceki okuma doğrulama, çarpan hesabı, aynı gün kontrolü, reaktif ceza bildirimi)
create or replace function public.rpc_record_meter_reading(
  p_meter_id uuid,
  p_reading_date timestamptz,
  p_active_value numeric default null,
  p_inductive_value numeric default null,
  p_capacitive_value numeric default null,
  p_index_value numeric default null,
  p_notes text default null,
  p_overwrite boolean default false,
  p_client_mutation_id uuid default null
)
returns public.meter_readings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_meter public.meters;
  v_profile public.profiles;
  v_existing public.meter_readings;
  v_prev public.meter_readings;
  v_day_start timestamptz;
  v_day_end timestamptz;
  v_diff_active numeric := 0;
  v_diff_ind numeric := 0;
  v_diff_cap numeric := 0;
  v_consumption numeric := 0;
  v_ind_pct numeric := null;
  v_cap_pct numeric := null;
  v_result public.meter_readings;
  v_mgr_id uuid;
  v_alert_parts text[];
begin
  if not public.has_module_permission('energy', 'create') then
    raise exception 'Erişim engellendi: Sayaç okuması girme yetkiniz yok.';
  end if;

  if p_client_mutation_id is not null then
    select * into v_existing
    from public.meter_readings
    where client_mutation_id = p_client_mutation_id;
    if found then
      return v_existing;
    end if;
  end if;

  select * into v_profile from public.profiles where id = auth.uid();
  select * into v_meter from public.meters where id = p_meter_id and is_active = true;
  if not found then
    raise exception 'Sayaç bulunamadı veya pasif.';
  end if;

  -- Türkiye saatine (UTC+3 / Europe/Istanbul) göre gün sınırları
  v_day_start := (date_trunc('day', p_reading_date at time zone 'Europe/Istanbul')) at time zone 'Europe/Istanbul';
  v_day_end := v_day_start + interval '1 day';

  select * into v_existing
  from public.meter_readings
  where meter_id = p_meter_id
    and reading_date >= v_day_start
    and reading_date < v_day_end
  order by reading_date desc
  limit 1;

  if found and not p_overwrite then
    raise exception 'SAME_DAY_EXISTS: Bu sayaç için seçilen güne ait kayıt zaten mevcut.';
  end if;

  if found and p_overwrite and not public.has_module_permission('energy', 'edit') then
    raise exception 'Erişim engellendi: Mevcut okuma kaydını güncelleme yetkiniz yok.';
  end if;

  select * into v_prev
  from public.meter_readings
  where meter_id = p_meter_id
    and reading_date < v_day_start
  order by reading_date desc
  limit 1;

  if v_meter.meter_type = 'electric' then
    if p_active_value is null or p_inductive_value is null or p_capacitive_value is null then
      raise exception 'Elektrik sayacı için Aktif, İndüktif ve Kapasitif değerleri zorunludur.';
    end if;

    if v_prev.id is not null and v_prev.active_value is not null then
      if p_active_value < v_prev.active_value
         or p_inductive_value < coalesce(v_prev.inductive_value, 0)
         or p_capacitive_value < coalesce(v_prev.capacitive_value, 0) then
        raise exception 'Girilen endeks önceki okumadan küçük olamaz.';
      end if;

      v_diff_active := p_active_value - v_prev.active_value;
      v_diff_ind := p_inductive_value - coalesce(v_prev.inductive_value, 0);
      v_diff_cap := p_capacitive_value - coalesce(v_prev.capacitive_value, 0);
    end if;

    v_consumption := round(v_diff_active * v_meter.multiplier, 3);
    if v_diff_active > 0 then
      v_ind_pct := round((v_diff_ind / v_diff_active) * 100.0, 1);
      v_cap_pct := round((v_diff_cap / v_diff_active) * 100.0, 1);
    else
      v_ind_pct := 0.0;
      v_cap_pct := 0.0;
    end if;
  else
    if p_index_value is null then
      raise exception 'Mekanik sayaç için Endeks değeri zorunludur.';
    end if;

    if v_prev.id is not null and v_prev.index_value is not null then
      if p_index_value < v_prev.index_value then
        raise exception 'Girilen endeks önceki okumadan küçük olamaz.';
      end if;
      v_consumption := round((p_index_value - v_prev.index_value) * v_meter.multiplier, 3);
    else
      v_consumption := 0;
    end if;
  end if;

  if v_existing.id is not null and p_overwrite then
    update public.meter_readings
    set
      reading_date = p_reading_date,
      active_value = p_active_value,
      inductive_value = p_inductive_value,
      capacitive_value = p_capacitive_value,
      inductive_percent = v_ind_pct,
      capacitive_percent = v_cap_pct,
      index_value = p_index_value,
      consumption = v_consumption,
      entered_by_id = auth.uid(),
      entered_by_name = v_profile.full_name,
      notes = nullif(trim(coalesce(p_notes, '')), ''),
      updated_at = now()
    where id = v_existing.id
    returning * into v_result;
  else
    insert into public.meter_readings (
      meter_id, reading_date, active_value, inductive_value, capacitive_value,
      inductive_percent, capacitive_percent, index_value, consumption,
      entered_by_id, entered_by_name, notes, client_mutation_id
    ) values (
      p_meter_id, p_reading_date, p_active_value, p_inductive_value, p_capacitive_value,
      v_ind_pct, v_cap_pct, p_index_value, v_consumption,
      auth.uid(), v_profile.full_name, nullif(trim(coalesce(p_notes, '')), ''), p_client_mutation_id
    )
    returning * into v_result;
  end if;

  -- Reaktif güç ceza uyarısı (İndüktif > %20 veya Kapasitif > %15)
  if v_meter.meter_type = 'electric' and (coalesce(v_ind_pct, 0) > 20.0 or coalesce(v_cap_pct, 0) > 15.0) then
    v_alert_parts := array[]::text[];
    if coalesce(v_ind_pct, 0) > 20.0 then
      v_alert_parts := array_append(v_alert_parts, 'İndüktif: %' || v_ind_pct::text);
    end if;
    if coalesce(v_cap_pct, 0) > 15.0 then
      v_alert_parts := array_append(v_alert_parts, 'Kapasitif: %' || v_cap_pct::text);
    end if;

    for v_mgr_id in
      select p.id from public.profiles p
      where p.approval_status = 'approved'
        and p.role in ('team_lead', 'technical_manager', 'system_admin')
    loop
      insert into public.notifications (user_id, module_key, entity_type, entity_id, title, message)
      values (
        v_mgr_id,
        'energy',
        'meter',
        v_meter.id,
        'Reaktif Güç Ceza Uyarısı: ' || v_meter.name,
        v_meter.name || ' sayacında reaktif sınır aşıldı (' || array_to_string(v_alert_parts, ', ') || ').'
      );
    end loop;
  end if;

  return v_result;
end;
$$;

-- 4.3 Tek sorguda enerji dashboard özeti (N+1 yok, RLS security invoker)
create or replace function public.rpc_energy_dashboard_summary(
  p_year integer default extract(year from now())::integer,
  p_month integer default extract(month from now())::integer
)
returns table (
  meter_id uuid,
  meter_name text,
  meter_type text,
  category text,
  multiplier numeric,
  sort_order integer,
  equipment_id uuid,
  equipment_code text,
  equipment_name text,
  latest_reading_date timestamptz,
  latest_consumption numeric,
  latest_inductive_percent numeric,
  latest_capacitive_percent numeric,
  monthly_total_consumption numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  with period_bounds as (
    select
      make_timestamptz(p_year, p_month, 1, 0, 0, 0, 'Europe/Istanbul') as p_start,
      (make_timestamptz(p_year, p_month, 1, 0, 0, 0, 'Europe/Istanbul') + interval '1 month') as p_end
  )
  select
    m.id as meter_id,
    m.name as meter_name,
    m.meter_type,
    m.category,
    m.multiplier,
    m.sort_order,
    m.equipment_id,
    eq.code as equipment_code,
    eq.name as equipment_name,
    lr.reading_date as latest_reading_date,
    lr.consumption as latest_consumption,
    lr.inductive_percent as latest_inductive_percent,
    lr.capacitive_percent as latest_capacitive_percent,
    coalesce(mt.total_cons, 0) as monthly_total_consumption
  from public.meters m
  left join public.equipments eq on eq.id = m.equipment_id
  left join lateral (
    select r.reading_date, r.consumption, r.inductive_percent, r.capacitive_percent
    from public.meter_readings r
    where r.meter_id = m.id
    order by r.reading_date desc
    limit 1
  ) lr on true
  left join lateral (
    select sum(r.consumption) as total_cons
    from public.meter_readings r, period_bounds pb
    where r.meter_id = m.id
      and r.reading_date >= pb.p_start
      and r.reading_date < pb.p_end
  ) mt on true
  where m.is_active = true
  order by m.meter_type asc, m.sort_order asc, m.name asc;
$$;

revoke all on function public.rpc_setup_default_meters() from public, anon;
revoke all on function public.rpc_record_meter_reading(uuid, timestamptz, numeric, numeric, numeric, numeric, text, boolean, uuid) from public, anon;
revoke all on function public.rpc_energy_dashboard_summary(integer, integer) from public, anon;

grant execute on function public.rpc_setup_default_meters() to authenticated;
grant execute on function public.rpc_record_meter_reading(uuid, timestamptz, numeric, numeric, numeric, numeric, text, boolean, uuid) to authenticated;
grant execute on function public.rpc_energy_dashboard_summary(integer, integer) to authenticated;

-- ---------------------------------------------------------------------
-- 5. STORAGE: energy-documents (private)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'energy-documents',
  'energy-documents',
  false,
  52428800,
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'text/csv'
  ]
)
on conflict (id) do update
set public = false,
    file_size_limit = 52428800,
    allowed_mime_types = array[
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/csv'
    ];

drop policy if exists "energy read documents storage" on storage.objects;
create policy "energy read documents storage" on storage.objects
for select to authenticated
using (
  bucket_id = 'energy-documents'
  and (public.has_module_permission('energy', 'view') or public.has_module_permission('energy', 'reports'))
);

drop policy if exists "energy upload documents storage" on storage.objects;
create policy "energy upload documents storage" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'energy-documents'
  and public.has_module_permission('energy', 'manage')
);

drop policy if exists "energy delete documents storage" on storage.objects;
create policy "energy delete documents storage" on storage.objects
for delete to authenticated
using (
  bucket_id = 'energy-documents'
  and (
    public.has_module_permission('energy', 'delete')
    or public.has_module_permission('energy', 'manage')
  )
);

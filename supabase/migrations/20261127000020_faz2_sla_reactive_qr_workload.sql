-- =====================================================================
-- MIGRATION: 20261127000020_faz2_sla_reactive_qr_workload.sql
-- PROJECT: Downtown Teknik – Faz 2 (SLA, Reaktif Otomasyon, QR, İş Yükü, Anomali)
-- DESCRIPTION:
--   1. SLA Politikaları (`sla_policies`) + `tickets` üzerine hedef müdahale/çözüm
--      süreleri (`sla_response_due_at`, `sla_resolve_due_at`, `sla_escalated_at`)
--      ve otomatik hesaplama tetikleyicisi + eskalasyon RPC'si.
--   2. Teknisyen canlı iş yükü özeti (`rpc_get_technician_workloads`).
--   3. Son 24 saat mükerrer açık arıza uyarı RPC'si (`rpc_find_duplicate_open_tickets`).
--   4. Reaktif Ceza Aşımı (%20 Endüktif / %15 Kapasitif) -> Otomatik `Acil`
--      iş isteği açan idempotent AFTER INSERT tetikleyicisi.
--   5. Enerji okuma sağlığı (Bu ay okunmayan sayaçlar + son 3 okuma ortalaması
--      anomali kıyası için `rpc_get_energy_reading_health`).
--   6. Ekipman QR kodu tek sorguda 360° çözümleme (`rpc_lookup_qr_target`).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. SLA POLİTİKALARI VE TICKETS HEDEF SÜRELERİ
-- ---------------------------------------------------------------------
create table if not exists public.sla_policies (
  priority public.ticket_priority primary key,
  response_minutes int not null check (response_minutes > 0),
  resolution_minutes int not null check (resolution_minutes > 0),
  warning_percent int not null default 80 check (warning_percent between 50 and 99),
  updated_at timestamptz not null default now()
);

insert into public.sla_policies (priority, response_minutes, resolution_minutes, warning_percent)
values
  ('urgent', 15, 120, 80),
  ('priority', 60, 480, 80),
  ('normal', 240, 1440, 80)
on conflict (priority) do nothing;

alter table public.sla_policies enable row level security;

drop policy if exists "Authenticated read sla_policies" on public.sla_policies;
create policy "Authenticated read sla_policies" on public.sla_policies
for select to authenticated
using (true);

drop policy if exists "Managers update sla_policies" on public.sla_policies;
create policy "Managers update sla_policies" on public.sla_policies
for all to authenticated
using (public.wt_can_manage())
with check (public.wt_can_manage());

alter table public.tickets
  add column if not exists sla_response_due_at timestamptz,
  add column if not exists sla_resolve_due_at timestamptz,
  add column if not exists sla_escalated_at timestamptz;

create index if not exists idx_tickets_sla_open
  on public.tickets (sla_resolve_due_at asc)
  where status not in ('closed', 'cancelled');

create or replace function public.fn_tickets_assign_sla()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_resp_min int;
  v_res_min int;
begin
  select response_minutes, resolution_minutes
  into v_resp_min, v_res_min
  from public.sla_policies
  where priority = new.priority;

  v_resp_min := coalesce(v_resp_min, case new.priority when 'urgent' then 15 when 'priority' then 60 else 240 end);
  v_res_min  := coalesce(v_res_min,  case new.priority when 'urgent' then 120 when 'priority' then 480 else 1440 end);

  if new.sla_response_due_at is null then
    new.sla_response_due_at := coalesce(new.created_at, now()) + make_interval(mins => v_resp_min);
  end if;
  if new.sla_resolve_due_at is null then
    new.sla_resolve_due_at := coalesce(new.created_at, now()) + make_interval(mins => v_res_min);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_tickets_assign_sla on public.tickets;
create trigger trg_tickets_assign_sla
before insert on public.tickets
for each row execute function public.fn_tickets_assign_sla();

-- Mevcut SLA tarihi boş olan kayıtlara geriye dönük doldurma
update public.tickets t
set
  sla_response_due_at = coalesce(
    t.sla_response_due_at,
    t.created_at + make_interval(mins => coalesce(sp.response_minutes, 240))
  ),
  sla_resolve_due_at = coalesce(
    t.sla_resolve_due_at,
    t.created_at + make_interval(mins => coalesce(sp.resolution_minutes, 1440))
  )
from public.sla_policies sp
where sp.priority = t.priority
  and (t.sla_response_due_at is null or t.sla_resolve_due_at is null);

create or replace function public.rpc_check_sla_escalations()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ticket record;
  v_mgr record;
  v_count int := 0;
begin
  if auth.uid() is not null and not public.wt_can_manage() then
    raise exception 'Erişim engellendi: SLA eskalasyon kontrolü yalnızca yöneticiler içindir.';
  end if;

  for v_ticket in
    select id, ticket_number, priority, description, sla_resolve_due_at
    from public.tickets
    where status not in ('closed', 'cancelled', 'resolved')
      and sla_resolve_due_at is not null
      and sla_resolve_due_at < now()
      and sla_escalated_at is null
    order by sla_resolve_due_at asc
    limit 50
  loop
    update public.tickets
    set sla_escalated_at = now(), updated_at = now()
    where id = v_ticket.id;

    for v_mgr in
      select id from public.profiles
      where approval_status = 'approved'
        and role in ('system_admin', 'technical_manager')
    loop
      perform public.wt_notify(
        v_mgr.id,
        v_ticket.id,
        'SLA Süre Aşımı: ' || coalesce(v_ticket.ticket_number, 'Arıza'),
        coalesce(v_ticket.ticket_number, 'Kayıt') || ' numaralı iş hedef SLA süresini aştı: ' || left(v_ticket.description, 100)
      );
    end loop;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.rpc_check_sla_escalations() from public, anon;
grant execute on function public.rpc_check_sla_escalations() to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2. TEKNİSYEN CANLI İŞ YÜKÜ ÖZETİ
-- ---------------------------------------------------------------------
create or replace function public.rpc_get_technician_workloads()
returns table (
  user_id uuid,
  active_count bigint,
  in_progress_count bigint,
  waiting_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    wa.user_id,
    count(*) filter (where wo.status in ('assigned', 'in_progress', 'waiting'))::bigint as active_count,
    count(*) filter (where wo.status = 'in_progress')::bigint as in_progress_count,
    count(*) filter (where wo.status = 'waiting')::bigint as waiting_count
  from public.work_order_assignments wa
  join public.work_orders wo on wo.id = wa.work_order_id
  where wo.status in ('assigned', 'in_progress', 'waiting')
  group by wa.user_id;
$$;

revoke all on function public.rpc_get_technician_workloads() from public, anon;
grant execute on function public.rpc_get_technician_workloads() to authenticated;

-- ---------------------------------------------------------------------
-- 3. SON 24 SAAT MÜKERRER AÇIK ARIZA KONTROLÜ
-- ---------------------------------------------------------------------
create or replace function public.rpc_find_duplicate_open_tickets(
  p_equipment_id uuid default null,
  p_location_id uuid default null
)
returns table (
  id uuid,
  ticket_number text,
  status public.ticket_status,
  priority public.ticket_priority,
  description text,
  created_at timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    t.id,
    t.ticket_number,
    t.status,
    t.priority,
    t.description,
    t.created_at
  from public.tickets t
  where t.status not in ('closed', 'cancelled')
    and t.created_at >= now() - interval '24 hours'
    and (
      (p_equipment_id is not null and t.equipment_id = p_equipment_id)
      or (p_location_id is not null and t.location_id = p_location_id)
    )
  order by t.created_at desc
  limit 5;
$$;

revoke all on function public.rpc_find_duplicate_open_tickets(uuid, uuid) from public, anon;
grant execute on function public.rpc_find_duplicate_open_tickets(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 4. REAKTİF CEZA SINIR AŞIMI -> OTOMATİK ACİL ARIZA KAYDI (MODÜLLER ARASI)
-- ---------------------------------------------------------------------
alter table public.meters
  add column if not exists reactive_auto_ticket_enabled boolean not null default true;

create or replace function public.fn_energy_reactive_auto_ticket()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_meter record;
  v_eq_location uuid;
  v_reporter uuid;
  v_ticket_id uuid;
  v_desc text;
  v_mgr record;
begin
  if coalesce(new.inductive_percent, 0) < 20 and coalesce(new.capacitive_percent, 0) < 15 then
    return new;
  end if;

  select id, name, meter_type, equipment_id, reactive_auto_ticket_enabled
  into v_meter
  from public.meters
  where id = new.meter_id;

  if not found or v_meter.meter_type <> 'electric' or not coalesce(v_meter.reactive_auto_ticket_enabled, true) then
    return new;
  end if;

  -- Son 24 saatte aynı sayaç için açık reaktif alarm kaydı varsa tekrar açma (idempotent)
  if exists (
    select 1 from public.tickets t
    where t.status not in ('closed', 'cancelled')
      and t.custom_category = 'Reaktif Ceza Alarmı'
      and t.description ilike ('%' || v_meter.name || '%')
      and t.created_at >= now() - interval '24 hours'
  ) then
    return new;
  end if;

  v_reporter := coalesce(new.entered_by_id, auth.uid());
  if v_reporter is null then
    select id into v_reporter from public.profiles
    where approval_status = 'approved' and role in ('system_admin', 'technical_manager')
    order by created_at asc limit 1;
  end if;
  if v_reporter is null then
    return new;
  end if;

  if v_meter.equipment_id is not null then
    select location_id into v_eq_location from public.equipments where id = v_meter.equipment_id;
  end if;

  v_desc := format(
    'OTOMATİK ENERJİ ALARMI: "%s" sayacında reaktif ceza sınırı aşıldı (Endüktif: %%%s [sınır %%20], Kapasitif: %%%s [sınır %%15]). Kompanzasyon panosu, kondansatör grupları ve reaktif röle acil kontrol edilmelidir.',
    v_meter.name,
    to_char(coalesce(new.inductive_percent, 0), 'FM990.0'),
    to_char(coalesce(new.capacitive_percent, 0), 'FM990.0')
  );

  insert into public.tickets (
    reporter_id,
    location_id,
    custom_location,
    custom_category,
    equipment_id,
    priority,
    description
  )
  values (
    v_reporter,
    v_eq_location,
    case when v_eq_location is null then 'Enerji Odası / ' || v_meter.name else null end,
    'Reaktif Ceza Alarmı',
    v_meter.equipment_id,
    'urgent',
    v_desc
  )
  returning id into v_ticket_id;

  for v_mgr in
    select id from public.profiles
    where approval_status = 'approved'
      and role in ('system_admin', 'technical_manager', 'team_lead')
  loop
    perform public.wt_notify(
      v_mgr.id,
      v_ticket_id,
      'Reaktif Ceza Alarmı – Otomatik Acil İş',
      v_meter.name || ' sayacında reaktif sınır aşıldı (End: %' ||
      to_char(coalesce(new.inductive_percent, 0), 'FM990.0') ||
      ' / Kap: %' || to_char(coalesce(new.capacitive_percent, 0), 'FM990.0') || ').'
    );
  end loop;

  return new;
exception
  when others then
    -- Otomatik alarm arızası sayaç okuma kaydını asla engellememelidir
    return new;
end;
$$;

drop trigger if exists trg_energy_reactive_auto_ticket on public.meter_readings;
create trigger trg_energy_reactive_auto_ticket
after insert on public.meter_readings
for each row execute function public.fn_energy_reactive_auto_ticket();

-- ---------------------------------------------------------------------
-- 5. ENERJİ OKUMA SAĞLIĞI (BU AY EKSİK SAYAÇLAR + 3 DÖNEM ORTALAMASI)
-- ---------------------------------------------------------------------
create or replace function public.rpc_get_energy_reading_health(
  p_year int default extract(year from now())::int,
  p_month int default extract(month from now())::int
)
returns table (
  meter_id uuid,
  meter_name text,
  meter_type text,
  category text,
  has_reading_this_month boolean,
  last_reading_date timestamptz,
  last_consumption numeric,
  avg_recent_consumption numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  with period_bounds as (
    select
      make_timestamptz(p_year, p_month, 1, 0, 0, 0, 'Europe/Istanbul') as month_start,
      (make_timestamptz(p_year, p_month, 1, 0, 0, 0, 'Europe/Istanbul') + interval '1 month') as month_end
  )
  select
    m.id as meter_id,
    m.name as meter_name,
    m.meter_type::text as meter_type,
    coalesce(m.category::text, 'other') as category,
    exists (
      select 1 from public.meter_readings r, period_bounds pb
      where r.meter_id = m.id
        and r.reading_date >= pb.month_start
        and r.reading_date < pb.month_end
    ) as has_reading_this_month,
    (
      select r.reading_date from public.meter_readings r
      where r.meter_id = m.id
      order by r.reading_date desc limit 1
    ) as last_reading_date,
    (
      select r.consumption from public.meter_readings r
      where r.meter_id = m.id
      order by r.reading_date desc limit 1
    ) as last_consumption,
    (
      select avg(sub.consumption)
      from (
        select r.consumption from public.meter_readings r
        where r.meter_id = m.id and r.consumption is not null and r.consumption > 0
        order by r.reading_date desc limit 3
      ) sub
    ) as avg_recent_consumption
  from public.meters m
  where m.is_active = true
    and m.deleted_at is null
  order by m.sort_order asc, m.name asc;
$$;

revoke all on function public.rpc_get_energy_reading_health(int, int) from public, anon;
grant execute on function public.rpc_get_energy_reading_health(int, int) to authenticated;

-- ---------------------------------------------------------------------
-- 6. QR KOD EKİPMAN / KARNE ÇÖZÜMLEME
-- ---------------------------------------------------------------------
create or replace function public.rpc_lookup_qr_target(
  p_code text
)
returns table (
  equipment_id uuid,
  code text,
  name text,
  equipment_type text,
  status text,
  brand text,
  model text,
  serial_number text,
  warranty_end_date date,
  location_id uuid,
  location_name text,
  floor_id uuid,
  floor_name text,
  department_id uuid,
  department_name text,
  open_tickets_count bigint,
  total_tickets_count bigint,
  due_maintenance_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with normalized as (
    select upper(trim(regexp_replace(coalesce(p_code, ''), '^DT-EQ:', '', 'i'))) as clean_code
  )
  select
    e.id as equipment_id,
    e.code,
    e.name,
    e.equipment_type,
    e.status::text as status,
    e.brand,
    e.model,
    e.serial_number,
    e.warranty_end_date,
    e.location_id,
    l.name as location_name,
    l.floor_id,
    f.name as floor_name,
    e.department_id,
    d.name as department_name,
    (select count(*)::bigint from public.tickets t where t.equipment_id = e.id and t.status not in ('closed', 'cancelled')) as open_tickets_count,
    (select count(*)::bigint from public.tickets t where t.equipment_id = e.id) as total_tickets_count,
    (select count(*)::bigint from public.maintenance_plans mp where mp.equipment_id = e.id and mp.status in ('scheduled', 'due')) as due_maintenance_count
  from public.equipments e
  left join public.locations l on l.id = e.location_id
  left join public.floors f on f.id = l.floor_id
  left join public.departments d on d.id = e.department_id,
  normalized n
  where e.is_active = true
    and (upper(e.code) = n.clean_code or e.id::text = lower(n.clean_code))
  limit 1;
$$;

revoke all on function public.rpc_lookup_qr_target(text) from public, anon;
grant execute on function public.rpc_lookup_qr_target(text) to authenticated;

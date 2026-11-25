-- =====================================================================
-- MIGRATION: 20261119000007_extensibility_and_equipment_360.sql
-- PROJECT: AVM TECH – Modüler Platform (Aşama 7)
-- DESCRIPTION:
--   1. Gelecek Planlı Bakım (maintenance) örnek iskelet tablosu ve RLS
--      (çekirdek veya mevcut modülleri değiştirmeden doğrudan eklenir)
--   2. Ortak equipments tablosu üzerinden Sayaç + Arıza/İş Emri + Bakım
--      ilişkilerini tek sorguda birleştiren SECURITY INVOKER 360° özet RPC'si
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. PLANLI BAKIM İSKELET TABLOSU (maintenance modülü)
-- ---------------------------------------------------------------------
create table if not exists public.maintenance_plans (
  id uuid primary key default gen_random_uuid(),
  equipment_id uuid not null references public.equipments(id) on delete cascade,
  department_id uuid references public.departments(id) on delete set null,
  title text not null,
  frequency text not null check (frequency in ('weekly', 'monthly', 'quarterly', 'yearly')),
  checklist jsonb not null default '[]'::jsonb,
  next_due_date date not null,
  last_performed_at timestamptz,
  assigned_to uuid references public.profiles(id) on delete set null,
  status text not null default 'scheduled' check (status in ('scheduled', 'due', 'completed', 'paused')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_maintenance_plans_equipment
  on public.maintenance_plans (equipment_id);
create index if not exists idx_maintenance_plans_due_status
  on public.maintenance_plans (status, next_due_date asc);

drop trigger if exists trg_maintenance_plans_updated_at on public.maintenance_plans;
create trigger trg_maintenance_plans_updated_at before update on public.maintenance_plans
for each row execute function public.set_updated_at();

alter table public.maintenance_plans enable row level security;

drop policy if exists "Maintenance viewers read plans" on public.maintenance_plans;
create policy "Maintenance viewers read plans" on public.maintenance_plans
for select to authenticated
using (public.has_module_permission('maintenance', 'view'));

drop policy if exists "Maintenance creators insert plans" on public.maintenance_plans;
create policy "Maintenance creators insert plans" on public.maintenance_plans
for insert to authenticated
with check (
  public.has_module_permission('maintenance', 'create')
  or public.has_module_permission('maintenance', 'manage')
);

drop policy if exists "Maintenance editors update plans" on public.maintenance_plans;
create policy "Maintenance editors update plans" on public.maintenance_plans
for update to authenticated
using (
  public.has_module_permission('maintenance', 'edit')
  or public.has_module_permission('maintenance', 'manage')
)
with check (
  public.has_module_permission('maintenance', 'edit')
  or public.has_module_permission('maintenance', 'manage')
);

drop policy if exists "Maintenance deleters delete plans" on public.maintenance_plans;
create policy "Maintenance deleters delete plans" on public.maintenance_plans
for delete to authenticated
using (
  public.has_module_permission('maintenance', 'delete')
  or public.has_module_permission('maintenance', 'manage')
);

-- ---------------------------------------------------------------------
-- 2. ORTAK EKİPMAN 360° ÖZET RPC'Sİ (SECURITY INVOKER - RLS UYUMLU)
-- ---------------------------------------------------------------------
create or replace function public.rpc_get_equipment_360_summary(
  p_equipment_id uuid
)
returns table (
  equipment_id uuid,
  equipment_code text,
  equipment_name text,
  equipment_type text,
  equipment_status text,
  linked_meters_count bigint,
  total_energy_consumption numeric,
  latest_reading_date timestamptz,
  total_tickets_count bigint,
  open_tickets_count bigint,
  active_work_orders_count bigint,
  maintenance_plans_count bigint,
  due_maintenance_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    e.id as equipment_id,
    e.code as equipment_code,
    e.name as equipment_name,
    e.equipment_type,
    e.status as equipment_status,
    (
      select count(*)::bigint
      from public.meters m
      where m.equipment_id = e.id and m.is_active = true
    ) as linked_meters_count,
    (
      select coalesce(sum(r.consumption), 0)
      from public.meter_readings r
      join public.meters m on m.id = r.meter_id
      where m.equipment_id = e.id
    ) as total_energy_consumption,
    (
      select max(r.reading_date)
      from public.meter_readings r
      join public.meters m on m.id = r.meter_id
      where m.equipment_id = e.id
    ) as latest_reading_date,
    (
      select count(*)::bigint
      from public.tickets t
      where t.equipment_id = e.id
    ) as total_tickets_count,
    (
      select count(*)::bigint
      from public.tickets t
      where t.equipment_id = e.id and t.status not in ('closed', 'cancelled')
    ) as open_tickets_count,
    (
      select count(*)::bigint
      from public.work_orders wo
      where wo.equipment_id = e.id and wo.status in ('assigned', 'in_progress', 'waiting')
    ) as active_work_orders_count,
    (
      select count(*)::bigint
      from public.maintenance_plans mp
      where mp.equipment_id = e.id
    ) as maintenance_plans_count,
    (
      select count(*)::bigint
      from public.maintenance_plans mp
      where mp.equipment_id = e.id and mp.status in ('scheduled', 'due')
    ) as due_maintenance_count
  from public.equipments e
  where e.id = p_equipment_id;
$$;

revoke all on function public.rpc_get_equipment_360_summary(uuid) from public, anon;
grant execute on function public.rpc_get_equipment_360_summary(uuid) to authenticated;

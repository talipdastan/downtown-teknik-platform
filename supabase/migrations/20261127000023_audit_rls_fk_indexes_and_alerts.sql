-- =====================================================================
-- MIGRATION: 20261127000023_audit_rls_fk_indexes_and_alerts.sql
-- PROJECT: Downtown Teknik – Kurumsal Denetim, RLS/FK Performans & Proaktif Analitik
-- DESCRIPTION:
--   1. Kurumsal denetim günlüğü (`public.audit_logs`) + otomatik trigger'lar
--      (profiles rol/yetki/onay değişimi, meter_readings & energy_invoices güncelleme/silme).
--   2. Büyüyecek tablolardaki eksik yabancı anahtar (FK) indeksleri.
--   3. 15 RLS politikasında `auth.uid()` -> `(select auth.uid())` initPlan optimizasyonu.
--   4. Proaktif analitik ve uyarı RPC'leri:
--      - `rpc_get_work_tracking_mttr_stats()` (MTTR, SLA ihlal oranı, sık arızalanan ekipmanlar)
--      - `rpc_get_energy_anomalies()` (tüketim sapma tespiti)
--      - `rpc_run_daily_operational_alerts()` (45 gün sözleşme, kritik stok, okunmamış sayaç bildirimi)
-- =====================================================================

-- 1. KURUMSAL DENETİM GÜNLÜĞÜ (AUDIT LOGS)
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  table_name text not null,
  record_id uuid,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  actor_id uuid references public.profiles(id) on delete set null,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_logs_table_created
  on public.audit_logs (table_name, created_at desc);

create index if not exists idx_audit_logs_actor_created
  on public.audit_logs (actor_id, created_at desc);

alter table public.audit_logs enable row level security;

drop policy if exists "Managers read audit_logs" on public.audit_logs;
create policy "Managers read audit_logs" on public.audit_logs
for select to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.approval_status = 'approved'
      and p.role in ('system_admin', 'technical_manager')
  )
);

-- Audit trigger fonksiyonu
create or replace function public.fn_record_audit_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
begin
  v_actor := auth.uid();
  if (tg_op = 'DELETE') then
    insert into public.audit_logs (table_name, record_id, action, actor_id, old_data)
    values (tg_table_name, old.id, 'DELETE', v_actor, to_jsonb(old));
    return old;
  elsif (tg_op = 'UPDATE') then
    -- profiles tablosunda yalnızca güvenlik/yetki alanları değiştiğinde logla
    if tg_table_name = 'profiles' then
      if old.role is not distinct from new.role
         and old.approval_status is not distinct from new.approval_status
         and old.permissions is not distinct from new.permissions
         and old.department_id is not distinct from new.department_id then
        return new;
      end if;
    end if;
    insert into public.audit_logs (table_name, record_id, action, actor_id, old_data, new_data)
    values (tg_table_name, new.id, 'UPDATE', v_actor, to_jsonb(old), to_jsonb(new));
    return new;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_audit_profiles on public.profiles;
create trigger trg_audit_profiles
after update on public.profiles
for each row execute function public.fn_record_audit_log();

drop trigger if exists trg_audit_meter_readings on public.meter_readings;
create trigger trg_audit_meter_readings
after update or delete on public.meter_readings
for each row execute function public.fn_record_audit_log();

drop trigger if exists trg_audit_energy_invoices on public.energy_invoices;
create trigger trg_audit_energy_invoices
after update or delete on public.energy_invoices
for each row execute function public.fn_record_audit_log();

-- 2. EKSİK YABANCI ANAHTAR (FK) İNDEKSLERİ (Büyüyecek operasyonel tablolar)
create index if not exists idx_comments_work_order_id on public.comments (work_order_id);
create index if not exists idx_work_orders_department_id on public.work_orders (department_id);
create index if not exists idx_tickets_category_id on public.tickets (category_id);
create index if not exists idx_maintenance_contracts_vendor_id on public.maintenance_contracts (vendor_id);
create index if not exists idx_service_reports_vendor_id on public.service_reports (vendor_id);
create index if not exists idx_service_reports_contract_id on public.service_reports (contract_id);
create index if not exists idx_status_history_changed_by on public.status_history (changed_by);
create index if not exists idx_work_order_materials_inventory_item_id on public.work_order_materials (inventory_item_id);
create index if not exists idx_stock_movements_equipment_id on public.stock_movements (equipment_id);
create index if not exists idx_meter_readings_entered_by_id on public.meter_readings (entered_by_id);
create index if not exists idx_maintenance_plans_department_id on public.maintenance_plans (department_id);

-- 3. RLS INITPLAN OPTİMİZASYONU (`auth.uid()` -> `(select auth.uid())`)
-- PostgreSQL'in her satır yerine sorgu başına 1 kez `auth.uid()` değerlendirmesini sağlar.
drop policy if exists "Users read own profile" on public.profiles;
create policy "Users read own profile" on public.profiles
for select to authenticated
using (id = (select auth.uid()));

drop policy if exists "Users read own notifications" on public.notifications;
create policy "Users read own notifications" on public.notifications
for select to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "Users mark own notifications read" on public.notifications;
create policy "Users mark own notifications read" on public.notifications
for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

drop policy if exists "Approved users read maintenance_plans" on public.maintenance_plans;
create policy "Approved users read maintenance_plans" on public.maintenance_plans
for select to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.approval_status = 'approved'
  )
);

drop policy if exists "Approved users read maintenance_executions" on public.maintenance_executions;
create policy "Approved users read maintenance_executions" on public.maintenance_executions
for select to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.approval_status = 'approved'
  )
);

drop policy if exists "Approved users read inventory_items" on public.inventory_items;
create policy "Approved users read inventory_items" on public.inventory_items
for select to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.approval_status = 'approved'
  )
);

drop policy if exists "Approved users read stock_movements" on public.stock_movements;
create policy "Approved users read stock_movements" on public.stock_movements
for select to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.approval_status = 'approved'
  )
);

drop policy if exists "Approved technical read shift_handovers" on public.shift_handovers;
create policy "Approved technical read shift_handovers" on public.shift_handovers
for select to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.approval_status = 'approved'
      and p.role in ('system_admin', 'technical_manager', 'team_lead', 'technician')
  )
);

drop policy if exists "Technical staff accept shift_handovers" on public.shift_handovers;
create policy "Technical staff accept shift_handovers" on public.shift_handovers
for update to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.approval_status = 'approved'
      and p.role in ('system_admin', 'technical_manager', 'team_lead', 'technician')
  )
);

drop policy if exists "Approved users read vendors" on public.vendors;
create policy "Approved users read vendors" on public.vendors
for select to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.approval_status = 'approved'
  )
);

drop policy if exists "Approved users read maintenance_contracts" on public.maintenance_contracts;
create policy "Approved users read maintenance_contracts" on public.maintenance_contracts
for select to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.approval_status = 'approved'
  )
);

drop policy if exists "Approved users read service_reports" on public.service_reports;
create policy "Approved users read service_reports" on public.service_reports
for select to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.approval_status = 'approved'
  )
);

-- 4. İŞ TAKİP MTTR, SLA İHLAL ORANI VE TEKRARLAYAN EKİPMAN ANALİTİĞİ RPC
create or replace function public.rpc_get_work_tracking_mttr_stats(
  p_days int default 90
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_since timestamptz := now() - make_interval(days => greatest(7, coalesce(p_days, 90)));
  v_mttr_minutes numeric := 0;
  v_total_closed int := 0;
  v_sla_total int := 0;
  v_sla_breached int := 0;
  v_top_equipments jsonb := '[]'::jsonb;
begin
  if auth.uid() is null or not public.has_module_permission('work_tracking', 'view') then
    raise exception 'Erişim engellendi.';
  end if;

  select
    count(*)::int,
    coalesce(round(avg(extract(epoch from (coalesce(resolved_at, closed_at) - created_at)) / 60.0)::numeric, 1), 0)
  into v_total_closed, v_mttr_minutes
  from public.tickets
  where created_at >= v_since
    and status in ('resolved', 'closed')
    and coalesce(resolved_at, closed_at) >= created_at;

  select
    count(*)::int,
    count(*) filter (
      where sla_breached = true
         or (sla_due_at is not null and status not in ('resolved', 'closed', 'cancelled') and now() > sla_due_at)
         or (sla_due_at is not null and coalesce(resolved_at, closed_at) > sla_due_at)
    )::int
  into v_sla_total, v_sla_breached
  from public.tickets
  where created_at >= v_since
    and status <> 'cancelled';

  select coalesce(jsonb_agg(row_to_json(sub)), '[]'::jsonb)
  into v_top_equipments
  from (
    select
      e.id as equipment_id,
      e.code as equipment_code,
      e.name as equipment_name,
      count(t.id)::int as ticket_count
    from public.tickets t
    join public.equipments e on e.id = t.equipment_id
    where t.created_at >= v_since
      and t.status <> 'cancelled'
    group by e.id, e.code, e.name
    order by count(t.id) desc
    limit 5
  ) sub;

  return jsonb_build_object(
    'period_days', greatest(7, coalesce(p_days, 90)),
    'closed_count', v_total_closed,
    'mttr_minutes', v_mttr_minutes,
    'sla_total', v_sla_total,
    'sla_breached', v_sla_breached,
    'sla_compliance_pct', case when v_sla_total > 0 then round(((v_sla_total - v_sla_breached)::numeric / v_sla_total) * 100, 1) else 100 end,
    'top_equipments', v_top_equipments
  );
end;
$$;

revoke all on function public.rpc_get_work_tracking_mttr_stats(int) from public, anon;
grant execute on function public.rpc_get_work_tracking_mttr_stats(int) to authenticated;

-- 5. ENERJİ TÜKETİM ANOMALİ TESPİT RPC'Sİ
create or replace function public.rpc_get_energy_anomalies(
  p_threshold_pct numeric default 35
)
returns table (
  meter_id uuid,
  meter_name text,
  meter_type text,
  latest_date timestamptz,
  latest_consumption numeric,
  avg_consumption numeric,
  deviation_pct numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.has_module_permission('energy', 'view') then
    raise exception 'Erişim engellendi.';
  end if;

  return query
  with ranked as (
    select
      r.meter_id,
      m.name as meter_name,
      m.meter_type::text as meter_type,
      r.reading_date,
      coalesce(r.consumption, 0)::numeric as consumption,
      row_number() over (partition by r.meter_id order by r.reading_date desc) as rn
    from public.meter_readings r
    join public.meters m on m.id = r.meter_id
    where m.is_active = true
      and m.deleted_at is null
      and coalesce(r.consumption, 0) > 0
      and r.reading_date >= now() - interval '120 days'
  ),
  latest_row as (
    select * from ranked where rn = 1
  ),
  baseline as (
    select
      meter_id,
      avg(consumption)::numeric as avg_cons,
      count(*)::int as sample_cnt
    from ranked
    where rn between 2 and 15
    group by meter_id
    having count(*) >= 3 and avg(consumption) > 0
  )
  select
    l.meter_id,
    l.meter_name,
    l.meter_type,
    l.reading_date as latest_date,
    round(l.consumption, 2) as latest_consumption,
    round(b.avg_cons, 2) as avg_consumption,
    round(((l.consumption - b.avg_cons) / b.avg_cons) * 100.0, 1) as deviation_pct
  from latest_row l
  join baseline b on b.meter_id = l.meter_id
  where abs(((l.consumption - b.avg_cons) / b.avg_cons) * 100.0) >= greatest(15, coalesce(p_threshold_pct, 35))
  order by abs(((l.consumption - b.avg_cons) / b.avg_cons) * 100.0) desc
  limit 10;
end;
$$;

revoke all on function public.rpc_get_energy_anomalies(numeric) from public, anon;
grant execute on function public.rpc_get_energy_anomalies(numeric) to authenticated;

-- 6. PROAKTİF GÜNLÜK OPERASYONEL UYARI RPC'Sİ (Sözleşme Bitiş + Kritik Stok + Okunmamış Sayaç)
create or replace function public.rpc_run_daily_operational_alerts()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mgr uuid;
  v_contracts_expiring int := 0;
  v_critical_stock int := 0;
  v_unread_meters int := 0;
  v_sent int := 0;
begin
  select count(*)::int into v_contracts_expiring
  from public.maintenance_contracts
  where status = 'active'
    and end_date <= (current_date + 45);

  select count(*)::int into v_critical_stock
  from public.inventory_items
  where is_active = true
    and current_stock <= min_stock;

  select count(*)::int into v_unread_meters
  from public.meters m
  where m.is_active = true
    and m.deleted_at is null
    and not exists (
      select 1 from public.meter_readings r
      where r.meter_id = m.id
        and r.reading_date >= now() - interval '3 days'
    );

  if v_contracts_expiring = 0 and v_critical_stock = 0 and v_unread_meters = 0 then
    return jsonb_build_object('sent', 0, 'contracts', 0, 'stock', 0, 'unread_meters', 0);
  end if;

  for v_mgr in
    select id from public.profiles
    where approval_status = 'approved'
      and role in ('system_admin', 'technical_manager')
  loop
    if v_contracts_expiring > 0 and not exists (
      select 1 from public.notifications
      where user_id = v_mgr
        and module_key = 'contracts'
        and title = 'Sözleşme Bitiş Uyarısı'
        and created_at >= date_trunc('day', now())
    ) then
      insert into public.notifications (user_id, module_key, entity_type, title, message)
      values (
        v_mgr,
        'contracts',
        'maintenance_contract',
        'Sözleşme Bitiş Uyarısı',
        v_contracts_expiring || ' adet bakım sözleşmesinin bitişine 45 günden az kaldı.'
      );
      v_sent := v_sent + 1;
    end if;

    if v_critical_stock > 0 and not exists (
      select 1 from public.notifications
      where user_id = v_mgr
        and module_key = 'inventory'
        and title = 'Kritik Stok Uyarısı'
        and created_at >= date_trunc('day', now())
    ) then
      insert into public.notifications (user_id, module_key, entity_type, title, message)
      values (
        v_mgr,
        'inventory',
        'inventory_item',
        'Kritik Stok Uyarısı',
        v_critical_stock || ' adet yedek parça / sarf malzeme kritik stok seviyesinin altında.'
      );
      v_sent := v_sent + 1;
    end if;

    if v_unread_meters > 0 and not exists (
      select 1 from public.notifications
      where user_id = v_mgr
        and module_key = 'energy'
        and title = 'Okunmamış Sayaç Hatırlatması'
        and created_at >= date_trunc('day', now())
    ) then
      insert into public.notifications (user_id, module_key, entity_type, title, message)
      values (
        v_mgr,
        'energy',
        'meter',
        'Okunmamış Sayaç Hatırlatması',
        v_unread_meters || ' adet aktif sayaç son 3 gündür okunmadı.'
      );
      v_sent := v_sent + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'sent', v_sent,
    'contracts', v_contracts_expiring,
    'stock', v_critical_stock,
    'unread_meters', v_unread_meters
  );
end;
$$;

revoke all on function public.rpc_run_daily_operational_alerts() from public, anon;
grant execute on function public.rpc_run_daily_operational_alerts() to service_role;

-- Her sabah 09:00 (TR / 06:00 UTC) pg_cron üzerinden proaktif uyarıları otomatik çalıştır
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid)
    from cron.job
    where jobname = 'downtown-daily-operational-alerts';

    perform cron.schedule(
      'downtown-daily-operational-alerts',
      '0 6 * * *',
      'select public.rpc_run_daily_operational_alerts();'
    );
  end if;
exception
  when others then
    null;
end $$;

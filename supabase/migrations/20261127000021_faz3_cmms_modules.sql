-- =====================================================================
-- MIGRATION: 20261127000021_faz3_cmms_modules.sql
-- PROJECT: Downtown Teknik – Faz 3 Kurumsal CMMS Modülleri
-- DESCRIPTION:
--   1. Planlı Bakım & Günlük Saha Checklist (`maintenance_plans` daily desteği +
--      `maintenance_executions` + uygunsuzluktan otomatik Arıza Kaydı açan
--      `rpc_complete_maintenance_execution`).
--   2. Yedek Parça & Sarf Malzeme Stok Yönetimi (`inventory_items`, `stock_movements`,
--      `work_order_materials.inventory_item_id`, `rpc_record_stock_movement` +
--      iş emrinde kullanılan parçayı stoktan otomatik düşen tetikleyici).
--   3. Dijital Vardiya Devir Teslim Defteri (`shift_handovers`,
--      `rpc_create_shift_handover`, `rpc_accept_shift_handover`).
--   4. Dış Servis / Taşeron & Bakım Sözleşmeleri (`vendors`,
--      `maintenance_contracts`, `service_reports` + asansör etiket takibi).
--   5. `system_modules` kurumsal modül kayıtları ve tam RLS politikaları.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. SİSTEM MODÜLLERİ KAYIT / AKTİVASYON
-- ---------------------------------------------------------------------
insert into public.system_modules (key, name, description, icon, route_prefix, is_enabled, is_coming_soon, sort_order)
values
  ('maintenance', 'Planlı Bakım & Checklist', 'Periyodik bakım takvimi ve günlük saha kontrol listeleri', 'clipboard-check', '/maintenance', true, false, 30),
  ('inventory', 'Yedek Parça & Stok', 'Teknik depo, sarf malzeme ve kritik stok seviye takibi', 'package', '/inventory', true, false, 40),
  ('shifts', 'Vardiya Devir Defteri', 'Dijital nöbet devir teslim ve vardiya onay defteri', 'book-open', '/shifts', true, false, 50),
  ('contracts', 'Dış Servis & Sözleşmeler', 'Taşeron bakım sözleşmeleri ve yasal servis raporları', 'file-signature', '/contracts', true, false, 60)
on conflict (key) do update
set name = excluded.name,
    description = excluded.description,
    route_prefix = excluded.route_prefix,
    is_enabled = true,
    is_coming_soon = false,
    sort_order = excluded.sort_order,
    updated_at = now();

-- ---------------------------------------------------------------------
-- 1. PLANLI BAKIM & GÜNLÜK SAHA CHECKLIST
-- ---------------------------------------------------------------------
-- Mevcut maintenance_plans.frequency kısıtına 'daily' ekle
do $$
declare
  v_conname text;
begin
  select conname into v_conname
  from pg_constraint
  where conrelid = 'public.maintenance_plans'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%frequency%';
  if v_conname is not null then
    execute format('alter table public.maintenance_plans drop constraint %I', v_conname);
  end if;
  alter table public.maintenance_plans
    add constraint maintenance_plans_frequency_check
    check (frequency in ('daily', 'weekly', 'monthly', 'quarterly', 'yearly'));
end $$;

create table if not exists public.maintenance_executions (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.maintenance_plans(id) on delete cascade,
  equipment_id uuid references public.equipments(id) on delete set null,
  performed_by uuid not null references public.profiles(id) on delete restrict,
  performed_at timestamptz not null default now(),
  checklist_results jsonb not null default '[]'::jsonb,
  overall_status text not null default 'passed' check (overall_status in ('passed', 'issues_found')),
  notes text,
  created_ticket_id uuid references public.tickets(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_maintenance_executions_plan_date
  on public.maintenance_executions (plan_id, performed_at desc);
create index if not exists idx_maintenance_executions_equipment
  on public.maintenance_executions (equipment_id, performed_at desc);

alter table public.maintenance_executions enable row level security;

-- Onaylı tüm teknik personel bakım planı & icra geçmişini okuyabilir; yönetim + ekip lideri oluşturabilir
drop policy if exists "Approved users read maintenance_plans" on public.maintenance_plans;
create policy "Approved users read maintenance_plans" on public.maintenance_plans
for select to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.approval_status = 'approved'
  )
);

drop policy if exists "Technical managers manage maintenance_plans" on public.maintenance_plans;
create policy "Technical managers manage maintenance_plans" on public.maintenance_plans
for all to authenticated
using (public.wt_can_manage() or public.has_module_permission('maintenance', 'manage'))
with check (public.wt_can_manage() or public.has_module_permission('maintenance', 'manage'));

drop policy if exists "Approved users read maintenance_executions" on public.maintenance_executions;
create policy "Approved users read maintenance_executions" on public.maintenance_executions
for select to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.approval_status = 'approved'
  )
);

drop policy if exists "Approved technical staff insert maintenance_executions" on public.maintenance_executions;
create policy "Approved technical staff insert maintenance_executions" on public.maintenance_executions
for insert to authenticated
with check (
  performed_by = auth.uid()
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.approval_status = 'approved'
      and p.role in ('system_admin', 'technical_manager', 'team_lead', 'technician')
  )
);

create or replace function public.rpc_complete_maintenance_execution(
  p_plan_id uuid,
  p_checklist_results jsonb default '[]'::jsonb,
  p_notes text default null,
  p_create_ticket_on_issue boolean default true
)
returns public.maintenance_executions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_plan public.maintenance_plans;
  v_eq record;
  v_exec public.maintenance_executions;
  v_failed_items text := '';
  v_item jsonb;
  v_has_issue boolean := false;
  v_ticket_id uuid := null;
  v_next_due date;
begin
  if v_uid is null then
    raise exception 'Oturum açmanız gerekiyor.';
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.id = v_uid
      and p.approval_status = 'approved'
      and p.role in ('system_admin', 'technical_manager', 'team_lead', 'technician')
  ) then
    raise exception 'Erişim engellendi: Planlı bakım icra yetkiniz yok.';
  end if;

  select * into v_plan from public.maintenance_plans where id = p_plan_id for update;
  if not found then
    raise exception 'Bakım planı bulunamadı.';
  end if;

  if p_checklist_results is not null and jsonb_typeof(p_checklist_results) = 'array' then
    for v_item in select * from jsonb_array_elements(p_checklist_results)
    loop
      if coalesce((v_item->>'ok')::boolean, true) = false then
        v_has_issue := true;
        v_failed_items := v_failed_items || E'\n- ' ||
          coalesce(v_item->>'label', 'Kontrol maddesi') ||
          case when nullif(trim(coalesce(v_item->>'note', '')), '') is not null
               then ' (' || trim(v_item->>'note') || ')' else '' end;
      end if;
    end loop;
  end if;

  -- Uygunsuzluk tespit edildiyse tek tıkla otomatik Arıza Kaydı aç
  if v_has_issue and coalesce(p_create_ticket_on_issue, true) then
    select id, code, name, location_id into v_eq
    from public.equipments where id = v_plan.equipment_id;

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
      v_uid,
      v_eq.location_id,
      case when v_eq.location_id is null then coalesce(v_eq.code || ' - ' || v_eq.name, 'Planlı Bakım Sahası') else null end,
      'Planlı Bakım Uygunsuzluğu',
      v_plan.equipment_id,
      'priority',
      'PLANLI BAKIM UYGUNSUZLUĞU (' || v_plan.title || '):' || v_failed_items ||
      case when nullif(trim(coalesce(p_notes, '')), '') is not null
           then E'\nNot: ' || trim(p_notes) else '' end
    )
    returning id into v_ticket_id;
  end if;

  insert into public.maintenance_executions (
    plan_id,
    equipment_id,
    performed_by,
    performed_at,
    checklist_results,
    overall_status,
    notes,
    created_ticket_id
  )
  values (
    v_plan.id,
    v_plan.equipment_id,
    v_uid,
    now(),
    coalesce(p_checklist_results, '[]'::jsonb),
    case when v_has_issue then 'issues_found' else 'passed' end,
    nullif(trim(coalesce(p_notes, '')), ''),
    v_ticket_id
  )
  returning * into v_exec;

  v_next_due := case v_plan.frequency
    when 'daily'     then (current_date + interval '1 day')::date
    when 'weekly'    then (current_date + interval '7 days')::date
    when 'monthly'   then (current_date + interval '1 month')::date
    when 'quarterly' then (current_date + interval '3 months')::date
    when 'yearly'    then (current_date + interval '1 year')::date
    else (current_date + interval '1 month')::date
  end;

  update public.maintenance_plans
  set last_performed_at = now(),
      next_due_date = v_next_due,
      status = 'scheduled',
      updated_at = now()
  where id = v_plan.id;

  return v_exec;
end;
$$;

revoke all on function public.rpc_complete_maintenance_execution(uuid, jsonb, text, boolean) from public, anon;
grant execute on function public.rpc_complete_maintenance_execution(uuid, jsonb, text, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- 2. YEDEK PARÇA & SARF MALZEME STOK YÖNETİMİ
-- ---------------------------------------------------------------------
create table if not exists public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  category text not null default 'sarf' check (category in ('elektrik', 'mekanik', 'hvac', 'aydinlatma', 'sarf', 'diger')),
  unit text not null default 'Adet',
  current_stock numeric(12,2) not null default 0,
  min_stock numeric(12,2) not null default 5,
  unit_cost numeric(12,2) not null default 0,
  shelf_location text,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_inventory_items_active_cat
  on public.inventory_items (is_active, category, name);

drop trigger if exists trg_inventory_items_updated_at on public.inventory_items;
create trigger trg_inventory_items_updated_at before update on public.inventory_items
for each row execute function public.set_updated_at();

create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.inventory_items(id) on delete cascade,
  movement_type text not null check (movement_type in ('in', 'out', 'adjustment')),
  quantity numeric(12,2) not null check (quantity > 0),
  unit_cost numeric(12,2),
  work_order_id uuid references public.work_orders(id) on delete set null,
  equipment_id uuid references public.equipments(id) on delete set null,
  note text,
  performed_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists idx_stock_movements_item_date
  on public.stock_movements (item_id, created_at desc);
create index if not exists idx_stock_movements_wo
  on public.stock_movements (work_order_id);

-- Mevcut work_order_materials tablosuna geriye uyumlu stok bağlantısı
alter table public.work_order_materials
  add column if not exists inventory_item_id uuid references public.inventory_items(id) on delete set null;

alter table public.inventory_items enable row level security;
alter table public.stock_movements enable row level security;

drop policy if exists "Approved users read inventory_items" on public.inventory_items;
create policy "Approved users read inventory_items" on public.inventory_items
for select to authenticated
using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.approval_status = 'approved'));

drop policy if exists "Managers manage inventory_items" on public.inventory_items;
create policy "Managers manage inventory_items" on public.inventory_items
for all to authenticated
using (public.wt_can_manage())
with check (public.wt_can_manage());

drop policy if exists "Approved users read stock_movements" on public.stock_movements;
create policy "Approved users read stock_movements" on public.stock_movements
for select to authenticated
using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.approval_status = 'approved'));

drop policy if exists "Technical staff insert stock_movements" on public.stock_movements;
create policy "Technical staff insert stock_movements" on public.stock_movements
for insert to authenticated
with check (
  performed_by = auth.uid()
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.approval_status = 'approved'
      and p.role in ('system_admin', 'technical_manager', 'team_lead', 'technician')
  )
);

create or replace function public.rpc_record_stock_movement(
  p_item_id uuid,
  p_movement_type text,
  p_quantity numeric,
  p_work_order_id uuid default null,
  p_equipment_id uuid default null,
  p_note text default null
)
returns public.inventory_items
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_item public.inventory_items;
  v_new_stock numeric(12,2);
  v_mgr record;
begin
  if v_uid is null then
    raise exception 'Oturum açmanız gerekiyor.';
  end if;

  if p_movement_type not in ('in', 'out', 'adjustment') then
    raise exception 'Geçersiz stok hareketi türü: %', p_movement_type;
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Miktar sıfırdan büyük olmalıdır.';
  end if;

  if p_movement_type in ('in', 'adjustment') and not public.wt_can_manage() then
    raise exception 'Erişim engellendi: Stok girişi/sayım düzeltme yalnızca yöneticiler içindir.';
  end if;

  select * into v_item from public.inventory_items where id = p_item_id for update;
  if not found then
    raise exception 'Stok kalemi bulunamadı.';
  end if;

  if p_movement_type = 'in' then
    v_new_stock := v_item.current_stock + p_quantity;
  elsif p_movement_type = 'out' then
    if v_item.current_stock < p_quantity then
      raise exception 'Yetersiz stok: % (Mevcut: % %)', v_item.name, v_item.current_stock, v_item.unit;
    end if;
    v_new_stock := v_item.current_stock - p_quantity;
  else
    v_new_stock := p_quantity;
  end if;

  update public.inventory_items
  set current_stock = v_new_stock, updated_at = now()
  where id = v_item.id
  returning * into v_item;

  insert into public.stock_movements (
    item_id, movement_type, quantity, unit_cost, work_order_id, equipment_id, note, performed_by
  )
  values (
    v_item.id, p_movement_type, p_quantity, v_item.unit_cost, p_work_order_id, p_equipment_id,
    nullif(trim(coalesce(p_note, '')), ''), v_uid
  );

  -- Kritik stok seviyesi uyarısı
  if p_movement_type = 'out' and v_item.current_stock <= v_item.min_stock then
    for v_mgr in
      select id from public.profiles
      where approval_status = 'approved' and role in ('system_admin', 'technical_manager')
    loop
      insert into public.notifications (user_id, module_key, entity_type, entity_id, title, message)
      values (
        v_mgr.id, 'inventory', 'inventory_item', v_item.id,
        'Kritik Stok Uyarısı: ' || v_item.name,
        v_item.code || ' - ' || v_item.name || ' kritik seviyenin altında (Kalan: ' ||
        v_item.current_stock || ' ' || v_item.unit || ', Minimum: ' || v_item.min_stock || ').'
      );
    end loop;
  end if;

  return v_item;
end;
$$;

revoke all on function public.rpc_record_stock_movement(uuid, text, numeric, uuid, uuid, text) from public, anon;
grant execute on function public.rpc_record_stock_movement(uuid, text, numeric, uuid, uuid, text) to authenticated;

-- İş emrinde stoktan malzeme seçildiğinde otomatik stok düşümü
create or replace function public.fn_wo_material_auto_stock_out()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_eq_id uuid;
begin
  if new.inventory_item_id is null then
    return new;
  end if;

  select equipment_id into v_eq_id from public.work_orders where id = new.work_order_id;
  perform public.rpc_record_stock_movement(
    new.inventory_item_id,
    'out',
    new.quantity,
    new.work_order_id,
    v_eq_id,
    'İş emri sarf çıkışı: ' || coalesce(new.note, new.material_name)
  );
  return new;
end;
$$;

drop trigger if exists trg_wo_material_auto_stock_out on public.work_order_materials;
create trigger trg_wo_material_auto_stock_out
after insert on public.work_order_materials
for each row execute function public.fn_wo_material_auto_stock_out();

-- ---------------------------------------------------------------------
-- 3. DİJİTAL VARDİYA DEVİR TESLİM DEFTERİ
-- ---------------------------------------------------------------------
create table if not exists public.shift_handovers (
  id uuid primary key default gen_random_uuid(),
  shift_date date not null default current_date,
  shift_type text not null check (shift_type in ('morning', 'evening', 'night')),
  department_id uuid references public.departments(id) on delete set null,
  outgoing_user_id uuid not null references public.profiles(id) on delete restrict,
  incoming_user_id uuid references public.profiles(id) on delete set null,
  summary_notes text not null,
  incoming_notes text,
  open_critical_snapshot jsonb not null default '[]'::jsonb,
  energy_alerts_snapshot jsonb not null default '[]'::jsonb,
  status text not null default 'pending_acceptance' check (status in ('pending_acceptance', 'accepted')),
  handed_over_at timestamptz not null default now(),
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_shift_handovers_date
  on public.shift_handovers (shift_date desc, handed_over_at desc);

alter table public.shift_handovers enable row level security;

drop policy if exists "Approved technical read shift_handovers" on public.shift_handovers;
create policy "Approved technical read shift_handovers" on public.shift_handovers
for select to authenticated
using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.approval_status = 'approved'));

drop policy if exists "Technical staff create shift_handovers" on public.shift_handovers;
create policy "Technical staff create shift_handovers" on public.shift_handovers
for insert to authenticated
with check (
  outgoing_user_id = auth.uid()
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
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
    where p.id = auth.uid()
      and p.approval_status = 'approved'
      and p.role in ('system_admin', 'technical_manager', 'team_lead', 'technician')
  )
);

create or replace function public.rpc_create_shift_handover(
  p_shift_date date,
  p_shift_type text,
  p_department_id uuid default null,
  p_summary_notes text default ''
)
returns public.shift_handovers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_open_critical jsonb;
  v_energy_alerts jsonb;
  v_row public.shift_handovers;
begin
  if v_uid is null then
    raise exception 'Oturum açmanız gerekiyor.';
  end if;
  if nullif(trim(coalesce(p_summary_notes, '')), '') is null then
    raise exception 'Vardiya devir notu zorunludur.';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'ticket_number', t.ticket_number,
        'priority', t.priority,
        'status', t.status,
        'description', left(t.description, 120)
      )
    ),
    '[]'::jsonb
  )
  into v_open_critical
  from (
    select ticket_number, priority, status, description
    from public.tickets
    where status not in ('closed', 'cancelled')
      and priority in ('urgent', 'priority')
    order by created_at desc
    limit 15
  ) t;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'meter_name', m.name,
        'inductive_percent', r.inductive_percent,
        'capacitive_percent', r.capacitive_percent,
        'reading_date', r.reading_date
      )
    ),
    '[]'::jsonb
  )
  into v_energy_alerts
  from (
    select r.meter_id, r.inductive_percent, r.capacitive_percent, r.reading_date
    from public.meter_readings r
    where r.reading_date >= now() - interval '24 hours'
      and (coalesce(r.inductive_percent, 0) >= 20 or coalesce(r.capacitive_percent, 0) >= 15)
    order by r.reading_date desc
    limit 10
  ) r
  join public.meters m on m.id = r.meter_id;

  insert into public.shift_handovers (
    shift_date, shift_type, department_id, outgoing_user_id,
    summary_notes, open_critical_snapshot, energy_alerts_snapshot
  )
  values (
    coalesce(p_shift_date, current_date),
    p_shift_type,
    p_department_id,
    v_uid,
    trim(p_summary_notes),
    v_open_critical,
    v_energy_alerts
  )
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.rpc_create_shift_handover(date, text, uuid, text) from public, anon;
grant execute on function public.rpc_create_shift_handover(date, text, uuid, text) to authenticated;

create or replace function public.rpc_accept_shift_handover(
  p_handover_id uuid,
  p_incoming_notes text default null
)
returns public.shift_handovers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.shift_handovers;
begin
  if v_uid is null then
    raise exception 'Oturum açmanız gerekiyor.';
  end if;

  select * into v_row from public.shift_handovers where id = p_handover_id for update;
  if not found then
    raise exception 'Vardiya devir kaydı bulunamadı.';
  end if;
  if v_row.status = 'accepted' then
    raise exception 'Bu vardiya devri zaten teslim alınmış.';
  end if;
  if v_row.outgoing_user_id = v_uid and not public.wt_can_manage() then
    raise exception 'Kendi açtığınız vardiyayı farklı bir personel teslim almalıdır.';
  end if;

  update public.shift_handovers
  set incoming_user_id = v_uid,
      incoming_notes = nullif(trim(coalesce(p_incoming_notes, '')), ''),
      status = 'accepted',
      accepted_at = now()
  where id = p_handover_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.rpc_accept_shift_handover(uuid, text) from public, anon;
grant execute on function public.rpc_accept_shift_handover(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 4. DIŞ SERVİS / TAŞERON VE BAKIM SÖZLEŞMELERİ
-- ---------------------------------------------------------------------
create table if not exists public.vendors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  service_category text not null default 'diger' check (service_category in ('asansor', 'yuruyen_merdiven', 'jenerator', 'chiller', 'yangin', 'trafo', 'diger')),
  contact_name text,
  contact_phone text,
  contact_email text,
  rating numeric(3,1) not null default 5.0 check (rating between 1.0 and 5.0),
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_vendors_updated_at on public.vendors;
create trigger trg_vendors_updated_at before update on public.vendors
for each row execute function public.set_updated_at();

create table if not exists public.maintenance_contracts (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  title text not null,
  contract_number text,
  start_date date not null,
  end_date date not null,
  monthly_cost numeric(12,2) not null default 0,
  currency text not null default 'TRY',
  sla_response_hours int not null default 4,
  equipment_scope text,
  status text not null default 'active' check (status in ('active', 'expiring_soon', 'expired', 'cancelled')),
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_contracts_end_date
  on public.maintenance_contracts (status, end_date asc);

drop trigger if exists trg_contracts_updated_at on public.maintenance_contracts;
create trigger trg_contracts_updated_at before update on public.maintenance_contracts
for each row execute function public.set_updated_at();

create table if not exists public.service_reports (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid references public.maintenance_contracts(id) on delete set null,
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  service_date date not null default current_date,
  service_type text not null default 'periodic' check (service_type in ('periodic', 'breakdown', 'inspection')),
  label_status text not null default 'none' check (label_status in ('green', 'blue', 'yellow', 'red', 'none')),
  summary text not null,
  technician_name text,
  recorded_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists idx_service_reports_date
  on public.service_reports (service_date desc);

alter table public.vendors enable row level security;
alter table public.maintenance_contracts enable row level security;
alter table public.service_reports enable row level security;

drop policy if exists "Approved users read vendors" on public.vendors;
create policy "Approved users read vendors" on public.vendors
for select to authenticated
using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.approval_status = 'approved'));

drop policy if exists "Managers manage vendors" on public.vendors;
create policy "Managers manage vendors" on public.vendors
for all to authenticated
using (public.wt_can_manage())
with check (public.wt_can_manage());

drop policy if exists "Approved users read maintenance_contracts" on public.maintenance_contracts;
create policy "Approved users read maintenance_contracts" on public.maintenance_contracts
for select to authenticated
using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.approval_status = 'approved'));

drop policy if exists "Managers manage maintenance_contracts" on public.maintenance_contracts;
create policy "Managers manage maintenance_contracts" on public.maintenance_contracts
for all to authenticated
using (public.wt_can_manage())
with check (public.wt_can_manage());

drop policy if exists "Approved users read service_reports" on public.service_reports;
create policy "Approved users read service_reports" on public.service_reports
for select to authenticated
using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.approval_status = 'approved'));

drop policy if exists "Technical staff insert service_reports" on public.service_reports;
create policy "Technical staff insert service_reports" on public.service_reports
for insert to authenticated
with check (
  recorded_by = auth.uid()
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.approval_status = 'approved'
      and p.role in ('system_admin', 'technical_manager', 'team_lead', 'technician')
  )
);

drop policy if exists "Managers delete service_reports" on public.service_reports;
create policy "Managers delete service_reports" on public.service_reports
for delete to authenticated
using (public.wt_can_manage());

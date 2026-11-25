-- =====================================================================
-- MIGRATION: 20261119000004_work_tracking.sql
-- PROJECT: AVM TECH – Modüler Platform / İş Takip Modülü (work_tracking)
-- DESCRIPTION: Mevcut "TEKNİK İŞ İSTEK" şemasının (17 migration) yeni
--   platforma taşınmış hali. Tüm iş kuralları korunur; yetkiler merkezi
--   has_module_permission('work_tracking', ...) üzerinden uygulanır.
--   Yeni: tickets/work_orders.equipment_id (ortak ekipman kaydı).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. ENUM TİPLERİ
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'ticket_priority') then
    create type public.ticket_priority as enum ('normal', 'priority', 'urgent');
  end if;
  if not exists (select 1 from pg_type where typname = 'ticket_status') then
    create type public.ticket_status as enum (
      'new', 'under_review', 'assigned', 'in_progress',
      'waiting', 'resolved', 'closed', 'cancelled'
    );
  end if;
  if not exists (select 1 from pg_type where typname = 'work_order_status') then
    create type public.work_order_status as enum (
      'assigned', 'in_progress', 'waiting', 'completed', 'cancelled'
    );
  end if;
  if not exists (select 1 from pg_type where typname = 'attachment_type') then
    create type public.attachment_type as enum ('before', 'after', 'general');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2. TABLOLAR
-- ---------------------------------------------------------------------
create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  department_id uuid references public.departments(id) on delete set null,
  icon text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create sequence if not exists public.ticket_number_seq start 1;

create table if not exists public.tickets (
  id uuid primary key default gen_random_uuid(),
  ticket_number text unique,
  reporter_id uuid not null references public.profiles(id),
  location_id uuid references public.locations(id) on delete set null,
  custom_location text,
  category_id uuid references public.categories(id) on delete set null,
  custom_category text,
  equipment_id uuid references public.equipments(id) on delete set null,
  priority public.ticket_priority not null default 'normal',
  status public.ticket_status not null default 'new',
  description text not null,
  cancellation_reason text,
  resolved_at timestamptz,
  closed_at timestamptz,
  client_mutation_id uuid unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tickets_location_or_custom_check
    check (location_id is not null or nullif(trim(custom_location), '') is not null),
  constraint tickets_category_or_custom_check
    check (category_id is not null or nullif(trim(custom_category), '') is not null)
);

create table if not exists public.work_orders (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  department_id uuid not null references public.departments(id),
  equipment_id uuid references public.equipments(id) on delete set null,
  status public.work_order_status not null default 'assigned',
  created_by uuid not null references public.profiles(id),
  work_description text,
  waiting_reason text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.work_order_assignments (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references public.work_orders(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  assigned_by uuid not null references public.profiles(id),
  assigned_at timestamptz not null default now(),
  unique (work_order_id, user_id)
);

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  work_order_id uuid references public.work_orders(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  comment text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.attachments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid references public.tickets(id) on delete cascade,
  work_order_id uuid references public.work_orders(id) on delete cascade,
  uploaded_by uuid not null references public.profiles(id),
  file_path text not null,
  file_name text,
  mime_type text,
  attachment_type public.attachment_type not null default 'general',
  created_at timestamptz not null default now(),
  constraint attachment_parent_check
    check (
      (ticket_id is not null and work_order_id is null)
      or (ticket_id is null and work_order_id is not null)
    )
);

create table if not exists public.status_history (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  old_status public.ticket_status,
  new_status public.ticket_status not null,
  changed_by uuid references public.profiles(id),
  change_note text,
  created_at timestamptz not null default now()
);

create table if not exists public.work_order_materials (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references public.work_orders(id) on delete cascade,
  material_name text not null,
  quantity numeric(12,2) not null check (quantity > 0),
  unit text not null,
  note text,
  recorded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 3. İNDEKSLER (sayfalama / filtreleme)
-- ---------------------------------------------------------------------
create index if not exists idx_categories_department on public.categories (department_id);
create index if not exists idx_tickets_status_priority_created on public.tickets (status, priority, created_at desc);
create index if not exists idx_tickets_reporter_status on public.tickets (reporter_id, status);
create index if not exists idx_tickets_equipment on public.tickets (equipment_id);
create index if not exists idx_tickets_location on public.tickets (location_id);
create index if not exists idx_tickets_created on public.tickets (created_at desc);
create index if not exists idx_work_orders_ticket on public.work_orders (ticket_id);
create index if not exists idx_work_orders_status_dept on public.work_orders (status, department_id);
create index if not exists idx_work_orders_equipment on public.work_orders (equipment_id);
create index if not exists idx_assignments_work_order on public.work_order_assignments (work_order_id);
create index if not exists idx_assignments_user on public.work_order_assignments (user_id);
create index if not exists idx_comments_ticket on public.comments (ticket_id, created_at);
create index if not exists idx_attachments_ticket on public.attachments (ticket_id);
create index if not exists idx_attachments_work_order on public.attachments (work_order_id);
create index if not exists idx_status_history_ticket on public.status_history (ticket_id, created_at);
create index if not exists idx_materials_work_order on public.work_order_materials (work_order_id);

-- ---------------------------------------------------------------------
-- 4. TETİKLEYİCİLER
-- ---------------------------------------------------------------------
drop trigger if exists tickets_updated_at on public.tickets;
create trigger tickets_updated_at before update on public.tickets
for each row execute function public.set_updated_at();

drop trigger if exists work_orders_updated_at on public.work_orders;
create trigger work_orders_updated_at before update on public.work_orders
for each row execute function public.set_updated_at();

create or replace function public.generate_ticket_number()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.ticket_number is null then
    new.ticket_number := 'AVM-' || to_char(current_timestamp, 'YYYY') || '-' ||
      lpad(nextval('public.ticket_number_seq')::text, 6, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists ticket_number_trigger on public.tickets;
create trigger ticket_number_trigger before insert on public.tickets
for each row execute function public.generate_ticket_number();

create or replace function public.record_ticket_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status is distinct from new.status then
    insert into public.status_history (ticket_id, old_status, new_status, changed_by)
    values (new.id, old.status, new.status, auth.uid());
  end if;
  return new;
end;
$$;

drop trigger if exists ticket_status_history_trigger on public.tickets;
create trigger ticket_status_history_trigger after update of status on public.tickets
for each row execute function public.record_ticket_status_change();

-- Onayda bekleyen (resolved) 3 iş isteği varsa yeni kayıt açmayı engelle
create or replace function public.check_pending_approval_ticket_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pending_count int;
begin
  select count(*) into v_pending_count
  from public.tickets
  where reporter_id = new.reporter_id and status = 'resolved';

  if v_pending_count >= 3 then
    raise exception 'Onayınızda bekleyen % adet tamamlanmış iş isteği bulunmaktadır. Yeni iş isteği açabilmek için lütfen önce onay bekleyen kayıtlarınızı onaylayınız.', v_pending_count;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_check_pending_approval_limit on public.tickets;
create trigger trg_check_pending_approval_limit before insert on public.tickets
for each row execute function public.check_pending_approval_ticket_limit();

-- Mahal / Kategori silinirse geçmiş arıza etiketi korunur
create or replace function public.preserve_ticket_labels_before_location_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_floor_name text;
begin
  select f.name into v_floor_name from public.floors f where f.id = old.floor_id;
  update public.tickets
  set custom_location = coalesce(custom_location, coalesce(v_floor_name || ' - ', '') || old.name),
      location_id = null
  where location_id = old.id;
  return old;
end;
$$;

drop trigger if exists trg_preserve_ticket_location on public.locations;
create trigger trg_preserve_ticket_location before delete on public.locations
for each row execute function public.preserve_ticket_labels_before_location_delete();

create or replace function public.preserve_ticket_labels_before_category_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.tickets
  set custom_category = coalesce(custom_category, old.name), category_id = null
  where category_id = old.id;
  return old;
end;
$$;

drop trigger if exists trg_preserve_ticket_category on public.categories;
create trigger trg_preserve_ticket_category before delete on public.categories
for each row execute function public.preserve_ticket_labels_before_category_delete();

-- ---------------------------------------------------------------------
-- 5. BİLDİRİM YARDIMCISI VE TETİKLEYİCİLERİ (merkezi notifications)
-- ---------------------------------------------------------------------
create or replace function public.wt_notify(
  p_user_id uuid, p_ticket_id uuid, p_title text, p_message text
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.notifications (user_id, module_key, entity_type, entity_id, title, message)
  values (p_user_id, 'work_tracking', 'ticket', p_ticket_id, p_title, p_message);
$$;
revoke all on function public.wt_notify(uuid, uuid, text, text) from public, anon, authenticated;

create or replace function public.notify_on_new_ticket()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mgr_id uuid;
  v_title text;
  v_msg text;
begin
  if new.priority = 'urgent' then
    v_title := 'ACİL Arıza Bildirimi (' || coalesce(new.ticket_number, '') || ')';
    v_msg := coalesce(new.ticket_number, '') || ' numaralı ACİL öncelikli arıza açıldı: ' || left(new.description, 120);
  else
    v_title := 'Yeni Arıza Kaydı (' || coalesce(new.ticket_number, '') || ')';
    v_msg := coalesce(new.ticket_number, '') || ' numaralı yeni arıza bildirimi oluşturuldu.';
  end if;

  for v_mgr_id in
    select p.id from public.profiles p
    where p.approval_status = 'approved'
      and p.role in ('team_lead', 'technical_manager', 'system_admin')
      and p.id <> new.reporter_id
  loop
    perform public.wt_notify(v_mgr_id, new.id, v_title, v_msg);
  end loop;
  return new;
end;
$$;

drop trigger if exists ticket_created_notification_trigger on public.tickets;
create trigger ticket_created_notification_trigger after insert on public.tickets
for each row execute function public.notify_on_new_ticket();

create or replace function public.notify_managers_on_work_order_completed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mgr_id uuid;
  v_ticket_number text;
begin
  if old.status is distinct from new.status and new.status = 'completed' then
    select t.ticket_number into v_ticket_number from public.tickets t where t.id = new.ticket_id;
    for v_mgr_id in
      select p.id from public.profiles p
      where p.approval_status = 'approved'
        and p.role in ('team_lead', 'technical_manager', 'system_admin')
    loop
      perform public.wt_notify(
        v_mgr_id, new.ticket_id,
        'İş Emri Tamamlandı – Onay Bekliyor',
        coalesce(v_ticket_number, '') || ' numaralı arızaya ait iş emri teknisyen tarafından tamamlandı. Kontrol ve kapatma onayınız bekleniyor.'
      );
    end loop;
  end if;
  return new;
end;
$$;

drop trigger if exists work_order_completed_notification_trigger on public.work_orders;
create trigger work_order_completed_notification_trigger after update of status on public.work_orders
for each row execute function public.notify_managers_on_work_order_completed();

-- ---------------------------------------------------------------------
-- 6. YETKİ YARDIMCI FONKSİYONLARI (merkezi 8 yetkiye bağlı)
-- ---------------------------------------------------------------------
-- Yönetim: iş emri atama / tüm kayıtları görme (work_tracking.manage)
create or replace function public.wt_can_manage()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_module_permission('work_tracking', 'manage');
$$;

create or replace function public.can_view_ticket(p_ticket_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_module_permission('work_tracking', 'view')
    and exists (
      select 1
      from public.tickets t
      where t.id = p_ticket_id
        and (
          t.reporter_id = auth.uid()
          or public.wt_can_manage()
          or exists (
            select 1
            from public.work_orders wo
            join public.work_order_assignments wa on wa.work_order_id = wo.id
            where wo.ticket_id = t.id and wa.user_id = auth.uid()
          )
        )
    );
$$;

-- ---------------------------------------------------------------------
-- 7. ROW LEVEL SECURITY
-- ---------------------------------------------------------------------
alter table public.categories enable row level security;
alter table public.tickets enable row level security;
alter table public.work_orders enable row level security;
alter table public.work_order_assignments enable row level security;
alter table public.comments enable row level security;
alter table public.attachments enable row level security;
alter table public.status_history enable row level security;
alter table public.work_order_materials enable row level security;

-- categories (tanım yönetimi çekirdek yetkisi)
drop policy if exists "Approved users read categories" on public.categories;
create policy "Approved users read categories" on public.categories
for select to authenticated using (public.is_approved_user());

drop policy if exists "Definition managers manage categories" on public.categories;
create policy "Definition managers manage categories" on public.categories
for all to authenticated
using (public.has_core_action('manage_definitions'))
with check (public.has_core_action('manage_definitions'));

-- tickets
drop policy if exists "Read authorized tickets" on public.tickets;
-- Not: bildiren kontrolü satır içi yapılır; böylece INSERT ... RETURNING sırasında
-- (fonksiyon henüz eklenen satırı göremediğinden) politika yanlış reddetmez.
create policy "Read authorized tickets" on public.tickets
for select to authenticated
using (
  (reporter_id = auth.uid() and public.has_module_permission('work_tracking', 'view'))
  or public.can_view_ticket(id)
);

drop policy if exists "Authorized users create own tickets" on public.tickets;
create policy "Authorized users create own tickets" on public.tickets
for insert to authenticated
with check (
  reporter_id = auth.uid()
  and public.has_module_permission('work_tracking', 'create')
);

drop policy if exists "Managers update tickets" on public.tickets;
create policy "Managers update tickets" on public.tickets
for update to authenticated
using (public.wt_can_manage() and public.has_module_permission('work_tracking', 'edit'))
with check (public.wt_can_manage() and public.has_module_permission('work_tracking', 'edit'));

drop policy if exists "Managers delete tickets" on public.tickets;
create policy "Managers delete tickets" on public.tickets
for delete to authenticated
using (public.has_module_permission('work_tracking', 'delete'));

-- work_orders
drop policy if exists "Read authorized work orders" on public.work_orders;
create policy "Read authorized work orders" on public.work_orders
for select to authenticated
using (
  public.has_module_permission('work_tracking', 'view')
  and (
    public.wt_can_manage()
    or exists (
      select 1 from public.work_order_assignments wa
      where wa.work_order_id = work_orders.id and wa.user_id = auth.uid()
    )
  )
);

drop policy if exists "Managers create work orders" on public.work_orders;
create policy "Managers create work orders" on public.work_orders
for insert to authenticated
with check (public.wt_can_manage() and created_by = auth.uid());

drop policy if exists "Managers update work orders" on public.work_orders;
create policy "Managers update work orders" on public.work_orders
for update to authenticated
using (public.wt_can_manage() and public.has_module_permission('work_tracking', 'edit'))
with check (public.wt_can_manage() and public.has_module_permission('work_tracking', 'edit'));

-- work_order_assignments
drop policy if exists "Read relevant assignments" on public.work_order_assignments;
create policy "Read relevant assignments" on public.work_order_assignments
for select to authenticated
using (
  public.has_module_permission('work_tracking', 'view')
  and (user_id = auth.uid() or public.wt_can_manage())
);

drop policy if exists "Managers create assignments" on public.work_order_assignments;
create policy "Managers create assignments" on public.work_order_assignments
for insert to authenticated
with check (public.wt_can_manage() and assigned_by = auth.uid());

drop policy if exists "Managers delete assignments" on public.work_order_assignments;
create policy "Managers delete assignments" on public.work_order_assignments
for delete to authenticated using (public.wt_can_manage());

-- comments
drop policy if exists "Read ticket comments" on public.comments;
create policy "Read ticket comments" on public.comments
for select to authenticated using (public.can_view_ticket(ticket_id));

drop policy if exists "Authorized users add comments" on public.comments;
create policy "Authorized users add comments" on public.comments
for insert to authenticated
with check (user_id = auth.uid() and public.can_view_ticket(ticket_id));

-- attachments
drop policy if exists "Read authorized attachments" on public.attachments;
create policy "Read authorized attachments" on public.attachments
for select to authenticated
using (
  (ticket_id is not null and public.can_view_ticket(ticket_id))
  or (work_order_id is not null and exists (
    select 1 from public.work_orders wo
    where wo.id = attachments.work_order_id and public.can_view_ticket(wo.ticket_id)
  ))
);

drop policy if exists "Upload authorized attachments" on public.attachments;
create policy "Upload authorized attachments" on public.attachments
for insert to authenticated
with check (
  uploaded_by = auth.uid()
  and (
    (ticket_id is not null and public.can_view_ticket(ticket_id))
    or (work_order_id is not null and exists (
      select 1 from public.work_orders wo
      where wo.id = attachments.work_order_id and public.can_view_ticket(wo.ticket_id)
    ))
  )
);

-- status_history (yalnızca trigger yazar)
drop policy if exists "Read authorized status history" on public.status_history;
create policy "Read authorized status history" on public.status_history
for select to authenticated using (public.can_view_ticket(ticket_id));

-- work_order_materials
drop policy if exists "Read authorized materials" on public.work_order_materials;
create policy "Read authorized materials" on public.work_order_materials
for select to authenticated
using (exists (
  select 1 from public.work_orders wo
  where wo.id = work_order_materials.work_order_id and public.can_view_ticket(wo.ticket_id)
));

drop policy if exists "Assigned technicians add materials" on public.work_order_materials;
create policy "Assigned technicians add materials" on public.work_order_materials
for insert to authenticated
with check (
  recorded_by = auth.uid()
  and public.has_module_permission('work_tracking', 'edit')
  and exists (
    select 1
    from public.work_order_assignments wa
    join public.work_orders wo on wo.id = wa.work_order_id
    where wa.work_order_id = work_order_materials.work_order_id
      and wa.user_id = auth.uid()
      and wo.status in ('assigned', 'in_progress', 'waiting')
  )
);

-- ---------------------------------------------------------------------
-- 8. GÜVENLİ RPC FONKSİYONLARI
-- ---------------------------------------------------------------------
create or replace function public.rpc_create_work_order(
  p_ticket_id uuid,
  p_department_id uuid,
  p_assigned_user_ids uuid[],
  p_work_description text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_work_order_id uuid;
  v_assignee_id uuid;
  v_ticket public.tickets;
begin
  if not (public.wt_can_manage() and public.has_module_permission('work_tracking', 'create')) then
    raise exception 'Erişim engellendi: İş emri oluşturma yetkiniz yok.';
  end if;

  select * into v_ticket from public.tickets where id = p_ticket_id;
  if not found then
    raise exception 'Arıza kaydı bulunamadı.';
  end if;
  if v_ticket.status in ('closed', 'cancelled') then
    raise exception 'Kapatılmış veya iptal edilmiş arıza için iş emri oluşturulamaz.';
  end if;
  if not exists (select 1 from public.departments d where d.id = p_department_id and d.is_active) then
    raise exception 'Geçersiz veya pasif departman.';
  end if;

  if p_assigned_user_ids is not null then
    foreach v_assignee_id in array p_assigned_user_ids loop
      if not exists (
        select 1 from public.profiles p
        where p.id = v_assignee_id
          and p.approval_status = 'approved'
          and p.role in ('technician', 'team_lead')
      ) then
        raise exception 'Atanan kullanıcı onaylı bir teknik personel olmalıdır.';
      end if;
    end loop;
  end if;

  insert into public.work_orders (ticket_id, department_id, equipment_id, created_by, work_description, status)
  values (p_ticket_id, p_department_id, v_ticket.equipment_id, auth.uid(), p_work_description, 'assigned')
  returning id into v_work_order_id;

  if p_assigned_user_ids is not null then
    foreach v_assignee_id in array p_assigned_user_ids loop
      insert into public.work_order_assignments (work_order_id, user_id, assigned_by)
      values (v_work_order_id, v_assignee_id, auth.uid())
      on conflict (work_order_id, user_id) do nothing;

      perform public.wt_notify(
        v_assignee_id, p_ticket_id, 'Yeni İş Emri Atandı',
        v_ticket.ticket_number || ' numaralı arıza için yeni bir iş emrine atandınız.'
      );
    end loop;
  end if;

  update public.tickets
  set status = 'assigned', resolved_at = null, updated_at = now()
  where id = p_ticket_id and status in ('new', 'under_review', 'resolved');

  return v_work_order_id;
end;
$$;

-- Teknisyen yürütme yetkisi: work_tracking.edit + (atanmış veya yönetici)
create or replace function public.wt_assert_can_execute(p_work_order_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_module_permission('work_tracking', 'edit') then
    raise exception 'Erişim engellendi: İş emri yürütme yetkiniz yok.';
  end if;
  if not public.wt_can_manage() and not exists (
    select 1 from public.work_order_assignments
    where work_order_id = p_work_order_id and user_id = auth.uid()
  ) then
    raise exception 'Erişim engellendi: Bu iş emrine atanmış olmalısınız.';
  end if;
end;
$$;
revoke all on function public.wt_assert_can_execute(uuid) from public, anon;

create or replace function public.rpc_technician_start_work(p_work_order_id uuid)
returns public.work_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wo public.work_orders;
begin
  perform public.wt_assert_can_execute(p_work_order_id);

  update public.work_orders
  set status = 'in_progress', started_at = coalesce(started_at, now()),
      waiting_reason = null, updated_at = now()
  where id = p_work_order_id and status in ('assigned', 'waiting')
  returning * into v_wo;

  if not found then
    raise exception 'İş emri bulunamadı veya bu durumda işe başlanamaz.';
  end if;

  update public.tickets
  set status = 'in_progress', updated_at = now()
  where id = v_wo.ticket_id and status in ('assigned', 'waiting');

  return v_wo;
end;
$$;

create or replace function public.rpc_technician_pause_work(
  p_work_order_id uuid,
  p_waiting_reason text
)
returns public.work_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wo public.work_orders;
begin
  if p_waiting_reason is null or trim(p_waiting_reason) = '' then
    raise exception 'Beklemeye alma işleminde bekleme nedeni belirtilmesi zorunludur.';
  end if;
  perform public.wt_assert_can_execute(p_work_order_id);

  update public.work_orders
  set status = 'waiting', waiting_reason = trim(p_waiting_reason), updated_at = now()
  where id = p_work_order_id and status = 'in_progress'
  returning * into v_wo;

  if not found then
    raise exception 'İş emri bulunamadı veya yalnızca devam eden iş beklemeye alınabilir.';
  end if;

  if not exists (
    select 1 from public.work_orders
    where ticket_id = v_wo.ticket_id and id <> p_work_order_id and status = 'in_progress'
  ) then
    update public.tickets
    set status = 'waiting', updated_at = now()
    where id = v_wo.ticket_id and status in ('assigned', 'in_progress');
  end if;

  return v_wo;
end;
$$;

create or replace function public.rpc_technician_complete_work(
  p_work_order_id uuid,
  p_note text default null
)
returns public.work_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wo public.work_orders;
begin
  perform public.wt_assert_can_execute(p_work_order_id);

  update public.work_orders
  set status = 'completed', completed_at = now(), waiting_reason = null, updated_at = now()
  where id = p_work_order_id and status = 'in_progress'
  returning * into v_wo;

  if not found then
    raise exception 'İş emri bulunamadı veya yalnızca devam eden iş tamamlanabilir.';
  end if;

  if p_note is not null and trim(p_note) <> '' then
    insert into public.comments (ticket_id, work_order_id, user_id, comment)
    values (v_wo.ticket_id, v_wo.id, auth.uid(), 'Tamamlanma Notu: ' || trim(p_note));
  end if;

  if not exists (
    select 1 from public.work_orders
    where ticket_id = v_wo.ticket_id and status not in ('completed', 'cancelled')
  ) then
    update public.tickets
    set status = 'resolved', resolved_at = now(), updated_at = now()
    where id = v_wo.ticket_id and status in ('assigned', 'in_progress', 'waiting');
  end if;

  return v_wo;
end;
$$;

-- Onay / iade: work_tracking.approve + (yönetici veya iş isteğini açan kullanıcı)
create or replace function public.rpc_manager_close_ticket(
  p_ticket_id uuid,
  p_resolution_note text,
  p_reopen boolean default false
)
returns public.tickets
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ticket public.tickets;
  v_assignee uuid;
begin
  if not public.has_module_permission('work_tracking', 'approve') then
    raise exception 'Erişim engellendi: Onay / iade yetkiniz yok.';
  end if;

  select * into v_ticket from public.tickets where id = p_ticket_id for update;
  if not found then
    raise exception 'Arıza kaydı bulunamadı.';
  end if;

  if not public.wt_can_manage() and v_ticket.reporter_id <> auth.uid() then
    raise exception 'Erişim engellendi: Yalnızca iş isteğini açan kullanıcı veya yöneticiler onay/iade işlemi yapabilir.';
  end if;

  if v_ticket.status <> 'resolved' then
    raise exception 'Yalnızca teknisyen tarafından tamamlanmış (onay bekleyen) iş istekleri onaylanabilir veya iade edilebilir.';
  end if;

  if p_reopen then
    if p_resolution_note is null or trim(p_resolution_note) = '' then
      raise exception 'İade işleminde gerekçe zorunludur.';
    end if;

    update public.work_orders
    set status = 'assigned', completed_at = null, updated_at = now()
    where ticket_id = p_ticket_id and status = 'completed';

    update public.tickets
    set status = 'assigned', resolved_at = null, updated_at = now()
    where id = p_ticket_id
    returning * into v_ticket;

    insert into public.comments (ticket_id, user_id, comment)
    values (p_ticket_id, auth.uid(), 'Onay İade Gerekçesi: ' || trim(p_resolution_note));

    for v_assignee in
      select distinct wa.user_id
      from public.work_order_assignments wa
      join public.work_orders wo on wo.id = wa.work_order_id
      where wo.ticket_id = p_ticket_id
    loop
      perform public.wt_notify(
        v_assignee, p_ticket_id, 'İş Emri İade Edildi',
        v_ticket.ticket_number || ' numaralı iş isteği onaylanmayıp yeniden işleme iade edildi: ' || trim(p_resolution_note)
      );
    end loop;
  else
    update public.tickets
    set status = 'closed', closed_at = now(), updated_at = now()
    where id = p_ticket_id
    returning * into v_ticket;

    if p_resolution_note is not null and trim(p_resolution_note) <> '' then
      insert into public.comments (ticket_id, user_id, comment)
      values (p_ticket_id, auth.uid(), 'Onay / Kapatma Notu: ' || trim(p_resolution_note));
    end if;

    if v_ticket.reporter_id <> auth.uid() then
      perform public.wt_notify(
        v_ticket.reporter_id, v_ticket.id, 'İş İsteğiniz Kapatıldı',
        v_ticket.ticket_number || ' numaralı iş isteğiniz onaylanarak kapatılmıştır.'
      );
    end if;
  end if;

  return v_ticket;
end;
$$;

-- Özet (dashboard) – SECURITY INVOKER: RLS çağıran kullanıcıya göre uygulanır
create or replace function public.rpc_work_tracking_summary()
returns table (
  total_open bigint,
  new_count bigint,
  in_progress_count bigint,
  waiting_count bigint,
  awaiting_approval_count bigint,
  urgent_open_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    count(*) filter (where status not in ('closed', 'cancelled')),
    count(*) filter (where status = 'new'),
    count(*) filter (where status = 'in_progress'),
    count(*) filter (where status = 'waiting'),
    count(*) filter (where status = 'resolved'),
    count(*) filter (where priority = 'urgent' and status not in ('closed', 'cancelled'))
  from public.tickets;
$$;

revoke all on function public.rpc_create_work_order(uuid, uuid, uuid[], text) from public, anon;
revoke all on function public.rpc_technician_start_work(uuid) from public, anon;
revoke all on function public.rpc_technician_pause_work(uuid, text) from public, anon;
revoke all on function public.rpc_technician_complete_work(uuid, text) from public, anon;
revoke all on function public.rpc_manager_close_ticket(uuid, text, boolean) from public, anon;
revoke all on function public.rpc_work_tracking_summary() from public, anon;
grant execute on function public.rpc_create_work_order(uuid, uuid, uuid[], text) to authenticated;
grant execute on function public.rpc_technician_start_work(uuid) to authenticated;
grant execute on function public.rpc_technician_pause_work(uuid, text) to authenticated;
grant execute on function public.rpc_technician_complete_work(uuid, text) to authenticated;
grant execute on function public.rpc_manager_close_ticket(uuid, text, boolean) to authenticated;
grant execute on function public.rpc_work_tracking_summary() to authenticated;

-- ---------------------------------------------------------------------
-- 9. STORAGE: work-attachments (private)
-- Yol düzeni: {auth_uid}/{ticket_or_work_order_id}/{dosya}
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'work-attachments', 'work-attachments', false, 26214400,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update
set public = false, file_size_limit = 26214400,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

create or replace function public.can_read_work_attachment_path(p_path text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_module_permission('work_tracking', 'view')
    and (
      public.wt_can_manage()
      or auth.uid()::text = split_part(p_path, '/', 1)
      or exists (
        select 1 from public.attachments a
        where a.file_path = p_path
          and (
            (a.ticket_id is not null and public.can_view_ticket(a.ticket_id))
            or (a.work_order_id is not null and exists (
              select 1 from public.work_orders wo
              where wo.id = a.work_order_id and public.can_view_ticket(wo.ticket_id)
            ))
          )
      )
    );
$$;
revoke all on function public.can_read_work_attachment_path(text) from public, anon;
grant execute on function public.can_read_work_attachment_path(text) to authenticated;

drop policy if exists "wt read attachments storage" on storage.objects;
create policy "wt read attachments storage" on storage.objects
for select to authenticated
using (bucket_id = 'work-attachments' and public.can_read_work_attachment_path(name));

drop policy if exists "wt upload attachments storage" on storage.objects;
create policy "wt upload attachments storage" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'work-attachments'
  and public.has_module_permission('work_tracking', 'create')
  and auth.uid()::text = (storage.foldername(name))[1]
);

drop policy if exists "wt delete attachments storage" on storage.objects;
create policy "wt delete attachments storage" on storage.objects
for delete to authenticated
using (
  bucket_id = 'work-attachments'
  and (
    public.has_module_permission('work_tracking', 'delete')
    or auth.uid()::text = (storage.foldername(name))[1]
  )
);

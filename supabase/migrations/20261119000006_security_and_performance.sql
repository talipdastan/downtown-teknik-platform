-- =====================================================================
-- MIGRATION: 20261119000006_security_and_performance.sql
-- PROJECT: AVM TECH – Modüler Platform (Aşama 6)
-- DESCRIPTION:
--   1. DATABASE.md Bölüm 7 bileşik performans indekslerinin garanti altına alınması
--   2. Offline idempotent arıza + fotoğraf bağlama RPC'si (rpc_sync_offline_ticket)
--   3. Offline iş emri durum senkronizasyonu & çakışma çözümü RPC'si (rpc_sync_offline_work_order_status)
--   4. Sunucu taraflı sayfalamalı & RLS korumalı (SECURITY INVOKER) liste RPC'leri
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. BİLEŞİK PERFORMANS İNDEKSLERİ
-- ---------------------------------------------------------------------
create index if not exists idx_profiles_approval_role
  on public.profiles (approval_status, role);
create index if not exists idx_profiles_department
  on public.profiles (department_id);
create index if not exists idx_notifications_user_unread
  on public.notifications (user_id, is_read, created_at desc);
create index if not exists idx_notifications_module_date
  on public.notifications (module_key, created_at desc);
create index if not exists idx_equipments_type_status
  on public.equipments (equipment_type, status);
create index if not exists idx_equipments_location
  on public.equipments (location_id);
create index if not exists idx_equipments_department
  on public.equipments (department_id);
create index if not exists idx_tickets_status_priority_created
  on public.tickets (status, priority, created_at desc);
create index if not exists idx_tickets_reporter_status
  on public.tickets (reporter_id, status);
create index if not exists idx_tickets_equipment
  on public.tickets (equipment_id);
create index if not exists idx_work_orders_created
  on public.work_orders (created_at desc);
create index if not exists idx_meter_readings_meter_date
  on public.meter_readings (meter_id, reading_date desc);
create index if not exists idx_meter_readings_date_id
  on public.meter_readings (reading_date desc, id desc);
create index if not exists idx_energy_invoices_period
  on public.energy_invoices (period_year, period_month, utility_type);
create index if not exists idx_energy_invoices_meter
  on public.energy_invoices (meter_id);

-- ---------------------------------------------------------------------
-- 2. OFFLINE IDEMPOTENT ARIZA + MEDYA SENKRONİZASYONU
-- ---------------------------------------------------------------------
create or replace function public.rpc_sync_offline_ticket(
  p_client_mutation_id uuid,
  p_location_id uuid default null,
  p_custom_location text default null,
  p_category_id uuid default null,
  p_custom_category text default null,
  p_equipment_id uuid default null,
  p_priority public.ticket_priority default 'normal',
  p_description text default '',
  p_attachments jsonb default '[]'::jsonb
)
returns public.tickets
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_ticket public.tickets;
  v_item jsonb;
  v_path text;
  v_name text;
  v_mime text;
  v_att_type_raw text;
  v_att_type public.attachment_type;
begin
  if v_uid is null or not public.has_module_permission('work_tracking', 'create') then
    raise exception 'Erişim engellendi: Arıza bildirimi oluşturma yetkiniz yok.';
  end if;

  if p_client_mutation_id is null then
    raise exception 'client_mutation_id zorunludur.';
  end if;

  if p_description is null or trim(p_description) = '' then
    raise exception 'Arıza açıklaması zorunludur.';
  end if;

  -- Idempotency kontrolü: aynı client_mutation_id daha önce işlenmişse mevcut kaydı döndür
  select * into v_ticket
  from public.tickets
  where client_mutation_id = p_client_mutation_id;

  if not found then
    insert into public.tickets (
      reporter_id,
      location_id,
      custom_location,
      category_id,
      custom_category,
      equipment_id,
      priority,
      description,
      client_mutation_id
    )
    values (
      v_uid,
      p_location_id,
      nullif(trim(coalesce(p_custom_location, '')), ''),
      p_category_id,
      nullif(trim(coalesce(p_custom_category, '')), ''),
      p_equipment_id,
      coalesce(p_priority, 'normal'),
      trim(p_description),
      p_client_mutation_id
    )
    returning * into v_ticket;
  elsif v_ticket.reporter_id <> v_uid and not public.wt_can_manage() then
    raise exception 'Erişim engellendi: Başka kullanıcıya ait mutasyon anahtarı kullanılamaz.';
  end if;

  -- Önceden Storage'a yüklenmiş fotoğrafları idempotent biçimde bağla
  if p_attachments is not null and jsonb_typeof(p_attachments) = 'array' then
    for v_item in select * from jsonb_array_elements(p_attachments)
    loop
      v_path := nullif(trim(coalesce(v_item->>'file_path', '')), '');
      if v_path is null then
        continue;
      end if;

      v_name := nullif(trim(coalesce(v_item->>'file_name', '')), '');
      v_mime := coalesce(nullif(trim(coalesce(v_item->>'mime_type', '')), ''), 'image/jpeg');
      v_att_type_raw := lower(coalesce(v_item->>'attachment_type', 'before'));
      v_att_type := case
        when v_att_type_raw = 'after' then 'after'::public.attachment_type
        when v_att_type_raw = 'general' then 'general'::public.attachment_type
        else 'before'::public.attachment_type
      end;

      if not exists (
        select 1 from public.attachments a
        where a.ticket_id = v_ticket.id and a.file_path = v_path
      ) then
        insert into public.attachments (
          ticket_id, uploaded_by, file_path, file_name, mime_type, attachment_type
        ) values (
          v_ticket.id, v_uid, v_path, v_name, v_mime, v_att_type
        );
      end if;
    end loop;
  end if;

  return v_ticket;
end;
$$;

-- ---------------------------------------------------------------------
-- 3. OFFLINE İŞ EMRİ DURUM GÜNCELLEME & ÇAKIŞMA ÇÖZÜMÜ
-- ---------------------------------------------------------------------
create or replace function public.rpc_sync_offline_work_order_status(
  p_work_order_id uuid,
  p_target_status public.work_order_status,
  p_base_updated_at timestamptz,
  p_waiting_reason text default null,
  p_note text default null,
  p_force_overwrite boolean default false
)
returns table (
  sync_result text,
  server_status public.work_order_status,
  server_updated_at timestamptz,
  work_order_id uuid,
  conflict_reason text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wo public.work_orders;
  v_clean_reason text := nullif(trim(coalesce(p_waiting_reason, '')), '');
  v_clean_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  perform public.wt_assert_can_execute(p_work_order_id);

  if p_target_status not in ('in_progress', 'waiting', 'completed') then
    raise exception 'Geçersiz hedef iş emri durumu: %', p_target_status;
  end if;

  if p_target_status = 'waiting' and v_clean_reason is null then
    raise exception 'Beklemeye alma işleminde bekleme nedeni belirtilmesi zorunludur.';
  end if;

  select * into v_wo
  from public.work_orders
  where id = p_work_order_id
  for update;

  if not found then
    raise exception 'İş emri bulunamadı.';
  end if;

  if v_wo.status = 'cancelled' then
    raise exception 'İptal edilmiş iş emri offline senkronizasyon ile güncellenemez.';
  end if;

  -- Çakışma tespiti: sunucuda kayıt offline işlemden sonra güncellenmişse
  if not coalesce(p_force_overwrite, false)
     and p_base_updated_at is not null
     and v_wo.updated_at > p_base_updated_at
     and v_wo.status is distinct from p_target_status then
    return query
    select
      'conflict'::text,
      v_wo.status,
      v_wo.updated_at,
      v_wo.id,
      ('Sunucu kaydı daha güncel (' || v_wo.status::text || ').')::text;
    return;
  end if;

  if p_target_status = 'in_progress' then
    update public.work_orders
    set status = 'in_progress',
        started_at = coalesce(started_at, now()),
        waiting_reason = null,
        updated_at = now()
    where id = p_work_order_id
    returning * into v_wo;

    update public.tickets
    set status = 'in_progress', updated_at = now()
    where id = v_wo.ticket_id and status in ('assigned', 'waiting');

  elsif p_target_status = 'waiting' then
    update public.work_orders
    set status = 'waiting',
        waiting_reason = v_clean_reason,
        updated_at = now()
    where id = p_work_order_id
    returning * into v_wo;

    if not exists (
      select 1 from public.work_orders
      where ticket_id = v_wo.ticket_id and id <> p_work_order_id and status = 'in_progress'
    ) then
      update public.tickets
      set status = 'waiting', updated_at = now()
      where id = v_wo.ticket_id and status in ('assigned', 'in_progress');
    end if;

  elsif p_target_status = 'completed' then
    update public.work_orders
    set status = 'completed',
        completed_at = coalesce(completed_at, now()),
        waiting_reason = null,
        updated_at = now()
    where id = p_work_order_id
    returning * into v_wo;

    if v_clean_note is not null then
      insert into public.comments (ticket_id, work_order_id, user_id, comment)
      values (v_wo.ticket_id, v_wo.id, auth.uid(), 'Tamamlanma Notu: ' || v_clean_note);
    end if;

    if not exists (
      select 1 from public.work_orders
      where ticket_id = v_wo.ticket_id and status not in ('completed', 'cancelled')
    ) then
      update public.tickets
      set status = 'resolved', resolved_at = coalesce(resolved_at, now()), updated_at = now()
      where id = v_wo.ticket_id and status in ('assigned', 'in_progress', 'waiting');
    end if;
  end if;

  return query
  select
    'synced'::text,
    v_wo.status,
    v_wo.updated_at,
    v_wo.id,
    null::text;
end;
$$;

-- ---------------------------------------------------------------------
-- 4. SUNUCU TARAFLI SAYFALAMALI & RLS KORUMALI LİSTE RPC'LERİ
-- ---------------------------------------------------------------------
create or replace function public.rpc_list_tickets_paginated(
  p_status public.ticket_status default null,
  p_priority public.ticket_priority default null,
  p_equipment_id uuid default null,
  p_search text default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  id uuid,
  ticket_number text,
  reporter_id uuid,
  reporter_name text,
  location_label text,
  category_name text,
  equipment_id uuid,
  equipment_code text,
  equipment_name text,
  priority public.ticket_priority,
  status public.ticket_status,
  description text,
  created_at timestamptz,
  updated_at timestamptz,
  total_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with filtered as (
    select
      t.id,
      t.ticket_number,
      t.reporter_id,
      coalesce(p.full_name, 'Kullanıcı') as reporter_name,
      coalesce(
        nullif(trim(coalesce(f.name || ' - ', '') || coalesce(l.name, '')), ''),
        t.custom_location,
        'Belirtilmedi'
      ) as location_label,
      coalesce(c.name, t.custom_category, 'Genel') as category_name,
      t.equipment_id,
      eq.code as equipment_code,
      eq.name as equipment_name,
      t.priority,
      t.status,
      t.description,
      t.created_at,
      t.updated_at
    from public.tickets t
    left join public.profiles p on p.id = t.reporter_id
    left join public.locations l on l.id = t.location_id
    left join public.floors f on f.id = l.floor_id
    left join public.categories c on c.id = t.category_id
    left join public.equipments eq on eq.id = t.equipment_id
    where (p_status is null or t.status = p_status)
      and (p_priority is null or t.priority = p_priority)
      and (p_equipment_id is null or t.equipment_id = p_equipment_id)
      and (
        p_search is null
        or trim(p_search) = ''
        or t.description ilike ('%' || trim(p_search) || '%')
        or coalesce(t.ticket_number, '') ilike ('%' || trim(p_search) || '%')
        or coalesce(eq.code, '') ilike ('%' || trim(p_search) || '%')
      )
  )
  select
    fl.*,
    count(*) over() as total_count
  from filtered fl
  order by fl.created_at desc, fl.id desc
  limit least(greatest(coalesce(p_limit, 25), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

create or replace function public.rpc_list_meter_readings_paginated(
  p_meter_id uuid default null,
  p_from_date timestamptz default null,
  p_to_date timestamptz default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id uuid,
  meter_id uuid,
  meter_name text,
  meter_type text,
  reading_date timestamptz,
  active_value numeric,
  inductive_value numeric,
  capacitive_value numeric,
  inductive_percent numeric,
  capacitive_percent numeric,
  index_value numeric,
  consumption numeric,
  entered_by_name text,
  notes text,
  total_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with filtered as (
    select
      r.id,
      r.meter_id,
      m.name as meter_name,
      m.meter_type,
      r.reading_date,
      r.active_value,
      r.inductive_value,
      r.capacitive_value,
      r.inductive_percent,
      r.capacitive_percent,
      r.index_value,
      r.consumption,
      r.entered_by_name,
      r.notes
    from public.meter_readings r
    join public.meters m on m.id = r.meter_id
    where (p_meter_id is null or r.meter_id = p_meter_id)
      and (p_from_date is null or r.reading_date >= p_from_date)
      and (p_to_date is null or r.reading_date <= p_to_date)
  )
  select
    fl.*,
    count(*) over() as total_count
  from filtered fl
  order by fl.reading_date desc, fl.id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

create or replace function public.rpc_list_energy_invoices_paginated(
  p_year integer default null,
  p_utility_type text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id uuid,
  period_year smallint,
  period_month smallint,
  utility_type text,
  provider text,
  invoice_no text,
  invoice_date date,
  invoice_type text,
  meter_id uuid,
  meter_name text,
  consumption numeric,
  amount_tl numeric,
  inductive_penalty_tl numeric,
  capacitive_penalty_tl numeric,
  tenant_consumption numeric,
  tenant_amount_tl numeric,
  entered_by_name text,
  created_at timestamptz,
  total_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with filtered as (
    select
      i.id,
      i.period_year,
      i.period_month,
      i.utility_type,
      i.provider,
      i.invoice_no,
      i.invoice_date,
      i.invoice_type,
      i.meter_id,
      i.meter_name,
      i.consumption,
      i.amount_tl,
      i.inductive_penalty_tl,
      i.capacitive_penalty_tl,
      i.tenant_consumption,
      i.tenant_amount_tl,
      i.entered_by_name,
      i.created_at
    from public.energy_invoices i
    where (p_year is null or i.period_year = p_year)
      and (p_utility_type is null or i.utility_type = p_utility_type)
  )
  select
    fl.*,
    count(*) over() as total_count
  from filtered fl
  order by fl.period_year desc, fl.period_month desc, fl.meter_name asc, fl.id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.rpc_sync_offline_ticket(
  uuid, uuid, text, uuid, text, uuid, public.ticket_priority, text, jsonb
) from public, anon;
revoke all on function public.rpc_sync_offline_work_order_status(
  uuid, public.work_order_status, timestamptz, text, text, boolean
) from public, anon;
revoke all on function public.rpc_list_tickets_paginated(
  public.ticket_status, public.ticket_priority, uuid, text, integer, integer
) from public, anon;
revoke all on function public.rpc_list_meter_readings_paginated(
  uuid, timestamptz, timestamptz, integer, integer
) from public, anon;
revoke all on function public.rpc_list_energy_invoices_paginated(
  integer, text, integer, integer
) from public, anon;

grant execute on function public.rpc_sync_offline_ticket(
  uuid, uuid, text, uuid, text, uuid, public.ticket_priority, text, jsonb
) to authenticated;
grant execute on function public.rpc_sync_offline_work_order_status(
  uuid, public.work_order_status, timestamptz, text, text, boolean
) to authenticated;
grant execute on function public.rpc_list_tickets_paginated(
  public.ticket_status, public.ticket_priority, uuid, text, integer, integer
) to authenticated;
grant execute on function public.rpc_list_meter_readings_paginated(
  uuid, timestamptz, timestamptz, integer, integer
) to authenticated;
grant execute on function public.rpc_list_energy_invoices_paginated(
  integer, text, integer, integer
) to authenticated;

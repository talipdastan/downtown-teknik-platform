-- =====================================================================
-- MIGRATION: 20261121000011_meter_trash_bin.sql
-- PROJECT: AVM TECH – Enerji Takip Modülü
-- DESCRIPTION:
--   1) Yanlışlıkla pasife alınan/silinen 3 mekanik sayacı
--      (Kule Sayaç, 1. Su Yumuşatma, 2. Su yumuşatma) tüm geçmiş okuma
--      verileriyle birlikte yeniden aktifleştirir.
--   2) Sayaçlar için 1 ay saklama süreli Çöp Kutusu (soft delete +
--      otomatik 1 ay sonrası kalıcı temizlik + pg_cron) ekler.
--   3) Sayaç silme, çöp kutusunu görüntüleme, geri getirme ve kalıcı
--      silme işlemlerini yalnızca Sistem Yöneticisine (system_admin) sınırlar.
-- =====================================================================

-- 1) Çöp kutusu kolonları ve indeks
alter table public.meters
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.profiles(id) on delete set null;

create index if not exists idx_meters_deleted_at
  on public.meters (deleted_at)
  where deleted_at is not null;

-- 2) Madde 1: Yanlışlıkla kaldırılan 3 mekanik sayacı verileriyle geri getir
update public.meters
set
  is_active = true,
  deleted_at = null,
  deleted_by = null,
  updated_at = now()
where legacy_id in ('kule_sayaç', '1_su_yumuşatma', '2_su_yumuşatma');

-- 3) RLS Politikaları: yalnızca sistem yöneticisi (system_admin) silebilir;
--    çöpteki sayaçlar aktif kullanıcılara görünmez ve güncellenemez.
drop policy if exists "Energy viewers read meters" on public.meters;
create policy "Energy viewers read meters" on public.meters
for select to authenticated
using (
  (public.has_module_permission('energy', 'view') and deleted_at is null)
  or public.is_system_admin()
);

drop policy if exists "Energy managers update meters" on public.meters;
create policy "Energy managers update meters" on public.meters
for update to authenticated
using (public.has_module_permission('energy', 'manage') and deleted_at is null)
with check (public.has_module_permission('energy', 'manage') and deleted_at is null);

drop policy if exists "Energy managers delete meters" on public.meters;
create policy "Energy managers delete meters" on public.meters
for delete to authenticated
using (public.is_system_admin());

-- 4) Mevcut okuma & dashboard RPC'lerinde çöpteki sayaçları hariç tut
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
  select * into v_meter
  from public.meters
  where id = p_meter_id
    and is_active = true
    and deleted_at is null;
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
    and m.deleted_at is null
  order by m.meter_type asc, m.sort_order asc, m.name asc;
$$;

-- 5) Admin'e Özel Çöp Kutusu & 1 Aylık Otomatik Kalıcı Temizlik RPC'leri

-- 5.1 1 ayı dolan çöpteki sayaçları ve okumalarını (cascade) kalıcı sil
create or replace function public.rpc_purge_expired_deleted_meters()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer := 0;
begin
  -- pg_cron / sistem çağrılarında auth.uid() null olabilir; istemci çağrısında Admin zorunludur.
  if auth.uid() is not null and not public.is_system_admin() then
    raise exception 'Erişim engellendi: Süresi dolan sayaçları yalnızca Sistem Yöneticisi (Admin) temizleyebilir.';
  end if;

  delete from public.meters
  where deleted_at is not null
    and deleted_at <= now() - interval '1 month';

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

-- 5.2 Sayacı çöp kutusuna taşı (yalnızca Admin)
create or replace function public.rpc_soft_delete_meter(p_meter_id uuid)
returns public.meters
language plpgsql
security definer
set search_path = public
as $$
declare
  v_meter public.meters;
begin
  if not public.is_system_admin() then
    raise exception 'Erişim engellendi: Sayaç silme ve çöp kutusu işlemleri yalnızca Sistem Yöneticisi (Admin) tarafından yapılabilir.';
  end if;

  perform public.rpc_purge_expired_deleted_meters();

  update public.meters
  set
    is_active = false,
    deleted_at = now(),
    deleted_by = auth.uid(),
    updated_at = now()
  where id = p_meter_id
    and deleted_at is null
  returning * into v_meter;

  if not found then
    raise exception 'Sayaç bulunamadı veya zaten çöp kutusunda.';
  end if;

  return v_meter;
end;
$$;

-- 5.3 Çöp kutusundaki sayaçları listele (yalnızca Admin)
create or replace function public.rpc_list_trashed_meters()
returns table (
  id uuid,
  name text,
  meter_type text,
  category text,
  multiplier numeric,
  deleted_at timestamptz,
  deleted_by uuid,
  deleted_by_name text,
  readings_count bigint,
  purge_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_system_admin() then
    raise exception 'Erişim engellendi: Sayaç çöp kutusunu yalnızca Sistem Yöneticisi (Admin) görüntüleyebilir.';
  end if;

  perform public.rpc_purge_expired_deleted_meters();

  return query
  select
    m.id,
    m.name,
    m.meter_type,
    m.category,
    m.multiplier,
    m.deleted_at,
    m.deleted_by,
    coalesce(p.full_name, 'Sistem') as deleted_by_name,
    (
      select count(*)::bigint
      from public.meter_readings r
      where r.meter_id = m.id
    ) as readings_count,
    m.deleted_at + interval '1 month' as purge_at
  from public.meters m
  left join public.profiles p on p.id = m.deleted_by
  where m.deleted_at is not null
  order by m.deleted_at desc, m.name asc;
end;
$$;

-- 5.4 Çöp kutusundaki sayacı eski verileriyle geri yükle (yalnızca Admin)
create or replace function public.rpc_restore_meter(p_meter_id uuid)
returns public.meters
language plpgsql
security definer
set search_path = public
as $$
declare
  v_meter public.meters;
begin
  if not public.is_system_admin() then
    raise exception 'Erişim engellendi: Çöpten sayaç geri yükleme yetkisi yalnızca Sistem Yöneticisine (Admin) aittir.';
  end if;

  perform public.rpc_purge_expired_deleted_meters();

  update public.meters
  set
    is_active = true,
    deleted_at = null,
    deleted_by = null,
    updated_at = now()
  where id = p_meter_id
    and deleted_at is not null
  returning * into v_meter;

  if not found then
    raise exception 'Sayaç çöp kutusunda bulunamadı veya 1 aylık saklama süresi dolduğu için kalıcı silinmiş.';
  end if;

  return v_meter;
end;
$$;

-- 5.5 Çöp kutusundaki sayacı hemen kalıcı sil (yalnızca Admin)
create or replace function public.rpc_permanently_delete_meter(p_meter_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
begin
  if not public.is_system_admin() then
    raise exception 'Erişim engellendi: Kalıcı silme işlemi yalnızca Sistem Yöneticisine (Admin) aittir.';
  end if;

  delete from public.meters
  where id = p_meter_id
    and deleted_at is not null;

  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'Kalıcı silinecek sayaç çöp kutusunda bulunamadı.';
  end if;

  return true;
end;
$$;

revoke all on function public.rpc_record_meter_reading(uuid, timestamptz, numeric, numeric, numeric, numeric, text, boolean, uuid) from public, anon;
revoke all on function public.rpc_energy_dashboard_summary(integer, integer) from public, anon;
revoke all on function public.rpc_purge_expired_deleted_meters() from public, anon;
revoke all on function public.rpc_soft_delete_meter(uuid) from public, anon;
revoke all on function public.rpc_list_trashed_meters() from public, anon;
revoke all on function public.rpc_restore_meter(uuid) from public, anon;
revoke all on function public.rpc_permanently_delete_meter(uuid) from public, anon;

grant execute on function public.rpc_record_meter_reading(uuid, timestamptz, numeric, numeric, numeric, numeric, text, boolean, uuid) to authenticated;
grant execute on function public.rpc_energy_dashboard_summary(integer, integer) to authenticated;
grant execute on function public.rpc_purge_expired_deleted_meters() to authenticated;
grant execute on function public.rpc_soft_delete_meter(uuid) to authenticated;
grant execute on function public.rpc_list_trashed_meters() to authenticated;
grant execute on function public.rpc_restore_meter(uuid) to authenticated;
grant execute on function public.rpc_permanently_delete_meter(uuid) to authenticated;

-- 6) Günlük otomatik 1 ay temizliği (pg_cron mevcutsa)
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.unschedule(jobid)
    from cron.job
    where jobname = 'purge-expired-deleted-meters';
    perform cron.schedule(
      'purge-expired-deleted-meters',
      '0 3 * * *',
      'select public.rpc_purge_expired_deleted_meters();'
    );
  end if;
exception
  when others then
    -- PGlite veya pg_cron yetkisi olmayan yerel ortamlarda sessizce atla;
    -- çöp kutusu RPC'leri yine 1 aylık temizliği otomatik uygular.
    null;
end $$;

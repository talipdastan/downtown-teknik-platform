-- =====================================================================
-- 013: Mekanik Sayaçlarda Yalnızca Endeks Zorunluluğu ve Elektrik/Reaktif Ayrımı
-- - Mekanik sayaçlarda (su, doğalgaz, soğutma/kule vb.) yalnızca `index_value` ve `consumption`
-- - Aktif, İndüktif, Kapasitif ve Reaktif oran/ceza alanları yalnızca elektrik sayaçlarına aittir
-- =====================================================================

-- 1) `meters` tablosunda tür-kategori tutarlılığı
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'meters_type_category_consistency_chk'
      and conrelid = 'public.meters'::regclass
  ) then
    alter table public.meters
      add constraint meters_type_category_consistency_chk
      check (
        (meter_type = 'electric' and category = 'electric')
        or (meter_type = 'mechanical' and category <> 'electric')
      );
  end if;
end $$;

-- 2) `energy_invoices` tablosunda reaktif cezaların yalnızca elektrik faturalarına yazılabilmesi
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'energy_invoices_reactive_electric_only_chk'
      and conrelid = 'public.energy_invoices'::regclass
  ) then
    alter table public.energy_invoices
      add constraint energy_invoices_reactive_electric_only_chk
      check (
        utility_type = 'electric'
        or (coalesce(inductive_penalty_tl, 0) = 0 and coalesce(capacitive_penalty_tl, 0) = 0)
      );
  end if;
end $$;

-- 3) `meter_readings` doğrudan INSERT/UPDATE işlemlerinde de sayaç türüne göre alan koruması
create or replace function public.trg_enforce_meter_reading_type_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_meter_type text;
begin
  select meter_type into v_meter_type
  from public.meters
  where id = new.meter_id;

  if not found then
    raise exception 'Geçersiz sayaç referansı.';
  end if;

  if v_meter_type = 'mechanical' then
    if new.active_value is not null
       or new.inductive_value is not null
       or new.capacitive_value is not null
       or new.inductive_percent is not null
       or new.capacitive_percent is not null then
      raise exception 'Mekanik sayaçlarda (su, doğalgaz, soğutma vb.) yalnızca endeks okunabilir; aktif, indüktif veya kapasitif değer girilemez.';
    end if;
    if new.index_value is null then
      raise exception 'Mekanik sayaç için Endeks değeri zorunludur.';
    end if;
  else
    if new.index_value is not null then
      raise exception 'Elektrik sayacında mekanik endeks alanı kullanılamaz.';
    end if;
    if new.active_value is null then
      raise exception 'Elektrik sayacı için Aktif endeks değeri zorunludur.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_meter_readings_enforce_type_fields on public.meter_readings;
create trigger trg_meter_readings_enforce_type_fields
before insert or update on public.meter_readings
for each row execute function public.trg_enforce_meter_reading_type_fields();

-- 4) `rpc_record_meter_reading`: tür bazlı giriş kısıtı + temiz değişken yazımı
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
  v_active numeric := null;
  v_ind numeric := null;
  v_cap numeric := null;
  v_ind_pct numeric := null;
  v_cap_pct numeric := null;
  v_index numeric := null;
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
    if p_index_value is not null then
      raise exception 'Elektrik sayacında mekanik endeks alanı kullanılamaz.';
    end if;
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

    v_active := p_active_value;
    v_ind := p_inductive_value;
    v_cap := p_capacitive_value;
    v_index := null;
    v_consumption := round(v_diff_active * v_meter.multiplier, 3);
    if v_diff_active > 0 then
      v_ind_pct := round((v_diff_ind / v_diff_active) * 100.0, 1);
      v_cap_pct := round((v_diff_cap / v_diff_active) * 100.0, 1);
    else
      v_ind_pct := 0.0;
      v_cap_pct := 0.0;
    end if;
  else
    if p_active_value is not null
       or p_inductive_value is not null
       or p_capacitive_value is not null then
      raise exception 'Mekanik sayaçlarda (su, doğalgaz, soğutma vb.) yalnızca endeks girilebilir; aktif, indüktif veya kapasitif değer girilemez.';
    end if;
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

    v_active := null;
    v_ind := null;
    v_cap := null;
    v_ind_pct := null;
    v_cap_pct := null;
    v_index := p_index_value;
  end if;

  if v_existing.id is not null and p_overwrite then
    update public.meter_readings
    set
      reading_date = p_reading_date,
      active_value = v_active,
      inductive_value = v_ind,
      capacitive_value = v_cap,
      inductive_percent = v_ind_pct,
      capacitive_percent = v_cap_pct,
      index_value = v_index,
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
      p_meter_id, p_reading_date, v_active, v_ind, v_cap,
      v_ind_pct, v_cap_pct, v_index, v_consumption,
      auth.uid(), v_profile.full_name, nullif(trim(coalesce(p_notes, '')), ''), p_client_mutation_id
    )
    returning * into v_result;
  end if;

  -- Reaktif güç ceza uyarısı (yalnızca elektrik sayaçları: İndüktif > %20 veya Kapasitif > %15)
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

-- 5) `rpc_energy_dashboard_summary`: mekanik sayaçlar için reaktif yüzdeler daima NULL
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
    case when m.meter_type = 'electric' then lr.inductive_percent else null end as latest_inductive_percent,
    case when m.meter_type = 'electric' then lr.capacitive_percent else null end as latest_capacitive_percent,
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

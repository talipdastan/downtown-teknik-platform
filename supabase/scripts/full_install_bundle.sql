-- =====================================================================
-- AVM TECH - TEK PARCA SUPABASE KURULUM DOSYASI (full_install_bundle.sql)
-- NOT: Yalnizca YENI ve BOS Supabase projesinin SQL Editor ekraninda
--      tek seferde calistirilmak uzere 7 migration + seed.sql birlestirilmistir.
--      Mevcut canli TEKNIK IS ISTEK veya Firebase projelerinde CALISTIRMAYIN.
-- =====================================================================

-- >>>>> SOURCE: supabase/migrations/20261119000001_core_schema.sql <<<<<
-- =====================================================================
-- MIGRATION: 20261119000001_core_schema.sql
-- PROJECT: AVM TECH – Modüler Teknik Operasyon Platformu
-- DESCRIPTION: Çekirdek tablolar (departments, floors, locations,
--              custom_roles, profiles, system_modules, equipments,
--              notifications), indeksler ve otomatik tetikleyiciler.
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- 1. ENUM TİPLERİ
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'user_role') then
    create type public.user_role as enum (
      'employee',
      'technician',
      'team_lead',
      'technical_manager',
      'system_admin'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'approval_status') then
    create type public.approval_status as enum (
      'pending',
      'approved',
      'rejected',
      'disabled'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'equipment_status') then
    create type public.equipment_status as enum (
      'active',
      'maintenance',
      'out_of_service',
      'retired'
    );
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2. ORTAK TETİKLEYİCİ FONKSİYONU (updated_at)
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- 3. DEPARTMENTS (Departmanlar)
-- ---------------------------------------------------------------------
create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 4. FLOORS & LOCATIONS (Katlar ve Mahaller)
-- ---------------------------------------------------------------------
create table if not exists public.floors (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.locations (
  id uuid primary key default gen_random_uuid(),
  floor_id uuid not null references public.floors(id) on delete restrict,
  name text not null,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint locations_floor_name_unique unique (floor_id, name)
);

create index if not exists idx_locations_floor_active
  on public.locations (floor_id, is_active);

-- ---------------------------------------------------------------------
-- 5. CUSTOM_ROLES (Özel Unvanlar / Roller)
-- ---------------------------------------------------------------------
create table if not exists public.custom_roles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  base_role public.user_role not null default 'technician',
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 6. PROFILES (Tekil Kullanıcı Profili & Merkezi İzinler)
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  phone text,
  role public.user_role not null default 'employee',
  custom_role text,
  approval_status public.approval_status not null default 'pending',
  department_id uuid references public.departments(id) on delete set null,
  permissions jsonb not null default '{}'::jsonb,
  legacy_firebase_uid text unique,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_profiles_approval_role
  on public.profiles (approval_status, role);
create index if not exists idx_profiles_department
  on public.profiles (department_id);

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- 7. SYSTEM_MODULES (Merkezi Modül Kayıt Tablosu)
-- ---------------------------------------------------------------------
create table if not exists public.system_modules (
  key text primary key,
  name text not null,
  description text not null default '',
  icon text not null default 'apps',
  route_prefix text not null unique,
  is_enabled boolean not null default true,
  is_coming_soon boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_system_modules_order
  on public.system_modules (sort_order, key);

drop trigger if exists trg_system_modules_updated_at on public.system_modules;
create trigger trg_system_modules_updated_at
before update on public.system_modules
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- 8. EQUIPMENTS (Ortak Teknik Ekipman Kayıt Sistemi)
-- Tüm modüller (Enerji, İş Takip, Planlı Bakım, Doküman) equipment_id
-- üzerinden bu tabloya bağlanır.
-- ---------------------------------------------------------------------
create table if not exists public.equipments (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  equipment_type text not null default 'other',
  department_id uuid references public.departments(id) on delete set null,
  location_id uuid references public.locations(id) on delete set null,
  brand text,
  model text,
  serial_number text,
  warranty_end_date date,
  status public.equipment_status not null default 'active',
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_equipments_type_status
  on public.equipments (equipment_type, status);
create index if not exists idx_equipments_location
  on public.equipments (location_id);
create index if not exists idx_equipments_department
  on public.equipments (department_id);
create index if not exists idx_equipments_active_name
  on public.equipments (is_active, name);

drop trigger if exists trg_equipments_updated_at on public.equipments;
create trigger trg_equipments_updated_at
before update on public.equipments
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- 9. NOTIFICATIONS (Modül-Bağımsız Merkezi Bildirim Tablosu)
-- ---------------------------------------------------------------------
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  module_key text not null default 'system',
  entity_type text,
  entity_id uuid,
  title text not null,
  message text not null,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_notifications_user_unread
  on public.notifications (user_id, is_read, created_at desc);
create index if not exists idx_notifications_module_date
  on public.notifications (module_key, created_at desc);

-- ---------------------------------------------------------------------
-- 10. AUTH -> PROFILES OTOMATİK KAYIT TETİKLEYİCİSİ (GATEKEEPER)
-- Yeni kayıt olan herkes 'employee' ve 'pending' olarak başlar.
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, phone, role, approval_status)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''), split_part(coalesce(new.email, 'Kullanıcı'), '@', 1)),
    nullif(trim(new.raw_user_meta_data->>'phone'), ''),
    'employee',
    'pending'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();


-- >>>>> SOURCE: supabase/migrations/20261119000002_core_auth_and_permissions.sql <<<<<
-- =====================================================================
-- MIGRATION: 20261119000002_core_auth_and_permissions.sql
-- PROJECT: AVM TECH – Modüler Teknik Operasyon Platformu
-- DESCRIPTION: Merkezi RBAC + 8 bağımsız modül izni, RLS politikaları
--              ve güvenli SECURITY DEFINER RPC fonksiyonları.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. MERKEZİ YETKİ YARDIMCI FONKSİYONLARI
-- ---------------------------------------------------------------------

create or replace function public.is_approved_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.approval_status = 'approved'
  );
$$;

create or replace function public.is_system_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.approval_status = 'approved'
      and p.role = 'system_admin'
  );
$$;

create or replace function public.has_management_role()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.approval_status = 'approved'
      and p.role in ('team_lead', 'technical_manager', 'system_admin')
  );
$$;

-- Rol bazlı varsayılan 8 bağımsız modül izni:
-- enabled | view | create | edit | delete | approve | reports | manage
create or replace function public.default_module_permission(
  p_role public.user_role,
  p_module text,
  p_permission text
)
returns boolean
language plpgsql
immutable
as $$
begin
  if p_role = 'system_admin' then
    return true;
  end if;

  if p_module = 'work_tracking' then
    case p_role
      when 'technical_manager' then
        return p_permission in ('enabled', 'view', 'create', 'edit', 'approve', 'reports', 'manage');
      when 'team_lead' then
        return p_permission in ('enabled', 'view', 'create', 'edit', 'approve', 'reports', 'manage');
      when 'technician' then
        return p_permission in ('enabled', 'view', 'create', 'edit');
      when 'employee' then
        return p_permission in ('enabled', 'view', 'create', 'approve');
      else
        return false;
    end case;
  end if;

  if p_module = 'energy' then
    case p_role
      when 'technical_manager' then
        return p_permission in ('enabled', 'view', 'create', 'edit', 'delete', 'approve', 'reports', 'manage');
      when 'team_lead' then
        return p_permission in ('enabled', 'view', 'create', 'edit', 'reports');
      when 'technician' then
        return p_permission in ('enabled', 'view', 'create');
      when 'employee' then
        return false;
      else
        return false;
    end case;
  end if;

  -- Gelecek modüller (maintenance, assets, documents vb.): varsayılan olarak sadece yöneticiler görebilir
  if p_role = 'technical_manager' then
    return p_permission in ('enabled', 'view', 'reports');
  end if;

  return false;
end;
$$;

-- Merkezi Modül İzin Kontrolü (RLS ve RPC'lerde kullanılır)
create or replace function public.has_module_permission(
  p_module text,
  p_permission text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_profile public.profiles;
  v_module_enabled boolean;
  v_custom_mod jsonb;
  v_custom_val jsonb;
begin
  select * into v_profile
  from public.profiles
  where id = auth.uid();

  if not found or v_profile.approval_status <> 'approved' then
    return false;
  end if;

  -- Sistem genelinde modül kapalıysa admin dahil operasyonel erişimi kontrol et
  select sm.is_enabled into v_module_enabled
  from public.system_modules sm
  where sm.key = p_module;

  if v_module_enabled is false and v_profile.role <> 'system_admin' then
    return false;
  end if;

  if v_profile.role = 'system_admin' then
    return true;
  end if;

  -- Kullanıcıya özel izin override varsa onu kullan
  v_custom_mod := v_profile.permissions -> 'modules' -> p_module;
  if v_custom_mod is not null then
    -- Modül kullanıcı için açıkça kapalıysa diğer tüm izinler false döner
    if (v_custom_mod -> 'enabled') = 'false'::jsonb then
      return false;
    end if;

    v_custom_val := v_custom_mod -> p_permission;
    if v_custom_val is not null and jsonb_typeof(v_custom_val) = 'boolean' then
      return (v_custom_val)::boolean;
    end if;
  end if;

  return public.default_module_permission(v_profile.role, p_module, p_permission);
end;
$$;

-- Merkezi Çekirdek Aksiyon Kontrolü
create or replace function public.has_core_action(p_action text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_profile public.profiles;
  v_actions jsonb;
begin
  select * into v_profile
  from public.profiles
  where id = auth.uid();

  if not found or v_profile.approval_status <> 'approved' then
    return false;
  end if;

  if v_profile.role = 'system_admin' then
    return true;
  end if;

  v_actions := v_profile.permissions -> 'core_actions';
  if v_actions is not null and jsonb_typeof(v_actions) = 'array' then
    return v_actions ? p_action;
  end if;

  -- Varsayılan: technical_manager ekipman ve tanımları görebilir ancak yönetim system_admin yetkisindedir
  return false;
end;
$$;

-- ---------------------------------------------------------------------
-- 2. ROW LEVEL SECURITY (RLS) POLİTİKALARI
-- ---------------------------------------------------------------------

alter table public.departments enable row level security;
alter table public.floors enable row level security;
alter table public.locations enable row level security;
alter table public.custom_roles enable row level security;
alter table public.profiles enable row level security;
alter table public.system_modules enable row level security;
alter table public.equipments enable row level security;
alter table public.notifications enable row level security;

-- departments
drop policy if exists "Approved users read departments" on public.departments;
create policy "Approved users read departments"
on public.departments for select to authenticated
using (public.is_approved_user());

drop policy if exists "Admins manage departments" on public.departments;
create policy "Admins manage departments"
on public.departments for all to authenticated
using (public.has_core_action('manage_definitions'))
with check (public.has_core_action('manage_definitions'));

-- floors
drop policy if exists "Approved users read floors" on public.floors;
create policy "Approved users read floors"
on public.floors for select to authenticated
using (public.is_approved_user());

drop policy if exists "Admins manage floors" on public.floors;
create policy "Admins manage floors"
on public.floors for all to authenticated
using (public.has_core_action('manage_definitions'))
with check (public.has_core_action('manage_definitions'));

-- locations
drop policy if exists "Approved users read locations" on public.locations;
create policy "Approved users read locations"
on public.locations for select to authenticated
using (public.is_approved_user());

drop policy if exists "Admins manage locations" on public.locations;
create policy "Admins manage locations"
on public.locations for all to authenticated
using (public.has_core_action('manage_definitions'))
with check (public.has_core_action('manage_definitions'));

-- custom_roles
drop policy if exists "Approved users read custom roles" on public.custom_roles;
create policy "Approved users read custom roles"
on public.custom_roles for select to authenticated
using (public.is_approved_user());

drop policy if exists "Admins manage custom roles" on public.custom_roles;
create policy "Admins manage custom roles"
on public.custom_roles for all to authenticated
using (public.is_system_admin())
with check (public.is_system_admin());

-- profiles (Kullanıcı yalnızca kendi profilini okuyabilir; yönetici tüm profilleri okur; doğrudan UPDATE kapalı)
drop policy if exists "Users read own profile" on public.profiles;
create policy "Users read own profile"
on public.profiles for select to authenticated
using (id = auth.uid());

drop policy if exists "Managers read all profiles" on public.profiles;
create policy "Managers read all profiles"
on public.profiles for select to authenticated
using (public.has_management_role() or public.has_core_action('manage_users'));

-- system_modules
drop policy if exists "Approved users read system modules" on public.system_modules;
create policy "Approved users read system modules"
on public.system_modules for select to authenticated
using (public.is_approved_user());

drop policy if exists "Admins manage system modules" on public.system_modules;
create policy "Admins manage system modules"
on public.system_modules for all to authenticated
using (public.has_core_action('manage_modules'))
with check (public.has_core_action('manage_modules'));

-- equipments (Ortak ekipman kayıt sistemi)
drop policy if exists "Approved users read equipments" on public.equipments;
create policy "Approved users read equipments"
on public.equipments for select to authenticated
using (public.is_approved_user());

drop policy if exists "Authorized users manage equipments" on public.equipments;
create policy "Authorized users manage equipments"
on public.equipments for all to authenticated
using (public.has_core_action('manage_equipments'))
with check (public.has_core_action('manage_equipments'));

-- notifications
drop policy if exists "Users read own notifications" on public.notifications;
create policy "Users read own notifications"
on public.notifications for select to authenticated
using (user_id = auth.uid() and public.is_approved_user());

drop policy if exists "Users mark own notifications read" on public.notifications;
create policy "Users mark own notifications read"
on public.notifications for update to authenticated
using (user_id = auth.uid() and public.is_approved_user())
with check (user_id = auth.uid() and public.is_approved_user());

-- ---------------------------------------------------------------------
-- 3. GÜVENLİ RPC FONKSİYONLARI (SECURITY DEFINER)
-- ---------------------------------------------------------------------

-- 3.1 E-posta / Ad Soyad / Telefon ile giriş çözümleme
create or replace function public.rpc_resolve_login_email(p_identifier text)
returns text
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_clean text := trim(coalesce(p_identifier, ''));
  v_digits text;
  v_count int;
  v_email text;
begin
  if v_clean = '' then
    return null;
  end if;

  if position('@' in v_clean) > 0 then
    return lower(v_clean);
  end if;

  v_digits := regexp_replace(v_clean, '[^0-9]', '', 'g');

  select count(*), min(u.email)
  into v_count, v_email
  from public.profiles p
  join auth.users u on u.id = p.id
  where lower(trim(p.full_name)) = lower(v_clean)
     or (
       v_digits <> ''
       and length(v_digits) >= 7
       and regexp_replace(coalesce(p.phone, ''), '[^0-9]', '', 'g') = v_digits
     );

  if v_count > 1 then
    raise exception 'Bu ad soyad ile birden fazla personel kayıtlı. Lütfen telefon numaranız veya e-postanız ile giriş yapın.';
  end if;

  return v_email;
end;
$$;

-- 3.2 Kendi profilini güvenli güncelleme (yalnızca ad soyad ve telefon)
create or replace function public.rpc_update_own_profile(
  p_full_name text,
  p_phone text default null
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated public.profiles;
begin
  if auth.uid() is null then
    raise exception 'Oturum bulunamadı.';
  end if;

  if nullif(trim(p_full_name), '') is null then
    raise exception 'Ad Soyad boş olamaz.';
  end if;

  update public.profiles
  set
    full_name = trim(p_full_name),
    phone = nullif(trim(coalesce(p_phone, '')), ''),
    updated_at = now()
  where id = auth.uid()
  returning * into v_updated;

  return v_updated;
end;
$$;

-- 3.3 Kullanıcı onaylama ve rol/departman atama
create or replace function public.rpc_approve_user(
  p_user_id uuid,
  p_role public.user_role,
  p_department_id uuid default null,
  p_custom_role text default null
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated public.profiles;
begin
  if not (public.is_system_admin() or public.has_core_action('manage_users')) then
    raise exception 'Erişim engellendi: Kullanıcı onaylama yetkiniz yok.';
  end if;

  if p_role = 'system_admin' and not public.is_system_admin() then
    raise exception 'Erişim engellendi: Yalnızca Sistem Yöneticisi başka birine system_admin rolü verebilir.';
  end if;

  update public.profiles
  set
    role = p_role,
    department_id = p_department_id,
    custom_role = nullif(trim(coalesce(p_custom_role, '')), ''),
    approval_status = 'approved',
    approved_by = auth.uid(),
    approved_at = now(),
    updated_at = now()
  where id = p_user_id
  returning * into v_updated;

  if not found then
    raise exception 'Kullanıcı profili bulunamadı.';
  end if;

  insert into public.notifications (user_id, module_key, entity_type, entity_id, title, message)
  values (
    p_user_id,
    'system',
    'profile',
    p_user_id,
    'Hesabınız Onaylandı',
    'AVM TECH hesabınız yönetici tarafından onaylandı. Yetkili olduğunuz modüllere giriş yapabilirsiniz.'
  );

  return v_updated;
end;
$$;

-- 3.4 Kullanıcı reddetme veya pasife alma
create or replace function public.rpc_set_user_approval_status(
  p_user_id uuid,
  p_status public.approval_status
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated public.profiles;
begin
  if not (public.is_system_admin() or public.has_core_action('manage_users')) then
    raise exception 'Erişim engellendi.';
  end if;

  if p_user_id = auth.uid() then
    raise exception 'Kendi hesabınızın onay durumunu değiştiremezsiniz.';
  end if;

  update public.profiles
  set
    approval_status = p_status,
    updated_at = now()
  where id = p_user_id
  returning * into v_updated;

  if not found then
    raise exception 'Kullanıcı profili bulunamadı.';
  end if;

  return v_updated;
end;
$$;

-- 3.5 Kullanıcı bazlı merkezi yetki güncelleme (yalnızca system_admin)
create or replace function public.rpc_update_user_permissions(
  p_user_id uuid,
  p_permissions jsonb
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated public.profiles;
begin
  if not public.is_system_admin() then
    raise exception 'Erişim engellendi: Yalnızca Sistem Yöneticisi (system_admin) kullanıcı yetkilerini düzenleyebilir.';
  end if;

  if p_user_id = auth.uid() then
    raise exception 'Kendi hesabınızın yetkilerini kısıtlayamazsınız.';
  end if;

  update public.profiles
  set
    permissions = coalesce(p_permissions, '{}'::jsonb),
    updated_at = now()
  where id = p_user_id
  returning * into v_updated;

  if not found then
    raise exception 'Kullanıcı profili bulunamadı.';
  end if;

  return v_updated;
end;
$$;

-- 3.6 Kullanıcının erişebileceği modülleri tek sorguda döndürme
create or replace function public.rpc_get_my_modules()
returns setof public.system_modules
language sql
stable
security definer
set search_path = public
as $$
  select sm.*
  from public.system_modules sm
  where public.is_approved_user()
    and (
      (sm.is_enabled and public.has_module_permission(sm.key, 'enabled'))
      or (sm.is_coming_soon and public.is_system_admin())
    )
  order by sm.sort_order asc, sm.key asc;
$$;

-- 3.7 Sistem modülü açma/kapama (yalnızca system_admin)
create or replace function public.rpc_toggle_system_module(
  p_key text,
  p_is_enabled boolean,
  p_is_coming_soon boolean default null
)
returns public.system_modules
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated public.system_modules;
begin
  if not public.is_system_admin() then
    raise exception 'Erişim engellendi: Modül durumunu yalnızca Sistem Yöneticisi değiştirebilir.';
  end if;

  update public.system_modules
  set
    is_enabled = p_is_enabled,
    is_coming_soon = coalesce(p_is_coming_soon, is_coming_soon),
    updated_at = now()
  where key = p_key
  returning * into v_updated;

  if not found then
    raise exception 'Modül bulunamadı: %', p_key;
  end if;

  return v_updated;
end;
$$;

-- İzin atamaları (GRANT / REVOKE)
revoke all on function public.rpc_resolve_login_email(text) from public;
grant execute on function public.rpc_resolve_login_email(text) to anon, authenticated;

revoke all on function public.rpc_update_own_profile(text, text) from public, anon;
grant execute on function public.rpc_update_own_profile(text, text) to authenticated;

revoke all on function public.rpc_approve_user(uuid, public.user_role, uuid, text) from public, anon;
grant execute on function public.rpc_approve_user(uuid, public.user_role, uuid, text) to authenticated;

revoke all on function public.rpc_set_user_approval_status(uuid, public.approval_status) from public, anon;
grant execute on function public.rpc_set_user_approval_status(uuid, public.approval_status) to authenticated;

revoke all on function public.rpc_update_user_permissions(uuid, jsonb) from public, anon;
grant execute on function public.rpc_update_user_permissions(uuid, jsonb) to authenticated;

revoke all on function public.rpc_get_my_modules() from public, anon;
grant execute on function public.rpc_get_my_modules() to authenticated;

revoke all on function public.rpc_toggle_system_module(text, boolean, boolean) from public, anon;
grant execute on function public.rpc_toggle_system_module(text, boolean, boolean) to authenticated;


-- >>>>> SOURCE: supabase/migrations/20261119000003_core_hardening.sql <<<<<
-- =====================================================================
-- MIGRATION: 20261119000003_core_hardening.sql
-- DESCRIPTION: Çekirdek sertleştirmeleri
--   1) Kat silinince mahallerin silinmesi (mevcut AVM TECH davranışı)
--   2) notifications: kullanıcı yalnızca is_read alanını güncelleyebilir
--   3) Realtime yayını (notifications)
--   4) Yeni kayıt olan personel için yönetici bildirimi
-- =====================================================================

-- 1) Kat -> Mahal silme davranışı (legacy: ON DELETE CASCADE)
alter table public.locations
  drop constraint if exists locations_floor_id_fkey,
  add constraint locations_floor_id_fkey
    foreign key (floor_id) references public.floors(id) on delete cascade;

-- 2) Bildirim güncelleme sınırı
revoke update on public.notifications from authenticated;
grant update (is_read) on public.notifications to authenticated;

-- 3) Realtime
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'notifications'
     ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

-- 4) Yeni kayıt -> yöneticilere bildirim
create or replace function public.notify_managers_on_new_signup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid;
begin
  if new.approval_status = 'pending' then
    for v_admin_id in
      select p.id
      from public.profiles p
      where p.approval_status = 'approved'
        and p.role in ('technical_manager', 'system_admin')
        and p.id <> new.id
    loop
      insert into public.notifications (user_id, module_key, entity_type, entity_id, title, message)
      values (
        v_admin_id, 'system', 'profile', new.id,
        'Onay Bekleyen Yeni Personel',
        new.full_name || ' sisteme kayıt oldu ve yönetici onayı bekliyor.'
      );
    end loop;
  end if;
  return new;
end;
$$;

drop trigger if exists profile_created_notification_trigger on public.profiles;
create trigger profile_created_notification_trigger
after insert on public.profiles
for each row execute function public.notify_managers_on_new_signup();


-- >>>>> SOURCE: supabase/migrations/20261119000004_work_tracking.sql <<<<<
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


-- >>>>> SOURCE: supabase/migrations/20261119000005_energy_tracking.sql <<<<<
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


-- >>>>> SOURCE: supabase/migrations/20261119000006_security_and_performance.sql <<<<<
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


-- >>>>> SOURCE: supabase/migrations/20261119000007_extensibility_and_equipment_360.sql <<<<<
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


-- >>>>> SOURCE: supabase/seed.sql <<<<<
-- =====================================================================
-- SEED: supabase/seed.sql
-- PROJECT: AVM TECH – Modüler Teknik Operasyon Platformu
-- DESCRIPTION: Merkezi modül kayıtları, başlangıç departmanları ve katlar.
-- =====================================================================

-- 1. Sistem Modülleri (İlk sürümde Enerji Takip & İş Takip aktif)
insert into public.system_modules (key, name, description, icon, route_prefix, is_enabled, is_coming_soon, sort_order)
values
  ('energy', 'Enerji Takip', 'Sayaçlar, okumalar, faturalar, bütçe ve enerji raporları', 'bolt', '/energy', true, false, 1),
  ('work_tracking', 'İş Takip', 'Arıza, iş emirleri, teknisyenler, fotoğraflar ve onaylar', 'build', '/work-tracking', true, false, 2),
  ('maintenance', 'Planlı Bakım', 'Periyodik bakım, bakım takvimi ve kontrol listeleri', 'event_repeat', '/maintenance', false, true, 3),
  ('assets', 'Demirbaş & Ekipman', 'Ekipman envanteri, garanti ve teknik geçmiş', 'inventory_2', '/assets', false, true, 4),
  ('documents', 'Teknik Dokümanlar', 'Projeler, tek hat şemaları, kılavuzlar ve muayene raporları', 'description', '/documents', false, true, 5),
  ('bms', 'Otomasyon & BMS', 'Bina yönetim sistemi alarmları ve eşik takibi', 'sensors', '/bms', false, true, 6)
on conflict (key) do update set
  name = excluded.name,
  description = excluded.description,
  icon = excluded.icon,
  route_prefix = excluded.route_prefix,
  sort_order = excluded.sort_order;

-- 2. Temel Departmanlar
insert into public.departments (name, description)
values
  ('Elektrik', 'Alçak/Orta gerilim, aydınlatma, jeneratör ve panolar'),
  ('Mekanik & HVAC', 'Soğutma grupları, kazan, havalandırma ve sıhhi tesisat'),
  ('İnşaat & Yapı', 'Zemin, tavan, boya, kapı ve genel yapı bakım'),
  ('Asansör & Yürüyen Merdiven', 'Dikey ulaşım sistemleri'),
  ('Yangın & Güvenlik Sistemleri', 'Sprinkler, algılama ve acil anons sistemleri'),
  ('Teknik Yönetim', 'AVM teknik müdürlük ve operasyon koordinasyonu'),
  ('Güvenlik', 'AVM saha güvenlik birimi'),
  ('Temizlik', 'AVM ortak alan temizlik birimi'),
  ('Danışma & İdari', 'Danışma ve AVM yönetim ofisi')
on conflict (name) do nothing;

-- 3. Temel Katlar
insert into public.floors (name, sort_order)
values
  ('Kat -2 (Otopark / Teknik)', -2),
  ('Kat -1 (Otopark / Teknik)', -1),
  ('Zemin Kat', 0),
  ('1. Kat', 1),
  ('2. Kat', 2),
  ('Çatı / Teras (Teknik)', 3)
on conflict (name) do nothing;

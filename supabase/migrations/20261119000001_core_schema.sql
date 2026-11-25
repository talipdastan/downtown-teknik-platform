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

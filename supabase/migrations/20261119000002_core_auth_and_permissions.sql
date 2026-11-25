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

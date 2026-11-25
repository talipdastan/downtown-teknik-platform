-- =====================================================================
-- MIGRATION: 20261120000010_authorization_fixes.sql
-- PROJECT: AVM TECH – Modüler Teknik Operasyon Platformu
-- DESCRIPTION: Personel Yetkilendirme düzeltmeleri:
--   1) rpc_update_user_permissions: manage_users çekirdek yetkili yöneticilere açılır
--      (system_admin hedefi ve manage_modules yetki devri yalnızca system_admin için korunur).
--   2) rpc_toggle_system_module: manage_modules çekirdek yetkisi de kabul edilir.
--   3) rpc_admin_update_user: temel rol değiştiğinde eski modül override'ları temizlenir
--      (core_actions korunur), böylece yeni rolün varsayılanları ezilmez.
--   4) can_view_ticket & work_orders SELECT RLS: work_tracking.reports izniyle
--      salt okunur tam liste görünürlüğü desteklenir.
-- =====================================================================

-- 1) Merkezi kullanıcı yetkisi güncelleme (system_admin veya manage_users)
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
  v_target_role public.user_role;
  v_core_actions jsonb;
  v_updated public.profiles;
begin
  if not (public.is_system_admin() or public.has_core_action('manage_users')) then
    raise exception 'Erişim engellendi: Kullanıcı yetkilerini düzenleme yetkiniz yok.';
  end if;

  if p_user_id = auth.uid() then
    raise exception 'Kendi hesabınızın yetkilerini kısıtlayamazsınız.';
  end if;

  select role into v_target_role
  from public.profiles
  where id = p_user_id;

  if not found then
    raise exception 'Kullanıcı profili bulunamadı.';
  end if;

  if v_target_role = 'system_admin' and not public.is_system_admin() then
    raise exception 'Erişim engellendi: Sistem Yöneticisi yetkilerini yalnızca Sistem Yöneticisi düzenleyebilir.';
  end if;

  v_core_actions := coalesce(p_permissions -> 'core_actions', '[]'::jsonb);
  if not public.is_system_admin()
     and jsonb_typeof(v_core_actions) = 'array'
     and (v_core_actions ? 'manage_modules') then
    raise exception 'Erişim engellendi: Sistem Modül Yönetimi yetkisini yalnızca Sistem Yöneticisi verebilir.';
  end if;

  update public.profiles
  set
    permissions = coalesce(p_permissions, '{}'::jsonb),
    updated_at = now()
  where id = p_user_id
  returning * into v_updated;

  return v_updated;
end;
$$;

-- 2) Sistem modülü açma/kapama (system_admin veya manage_modules)
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
  if not (public.is_system_admin() or public.has_core_action('manage_modules')) then
    raise exception 'Erişim engellendi: Modül durumunu değiştirme yetkiniz yok.';
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

-- 3) Personel güncelleme: temel rol değişirse eski modül override'larını temizle
create or replace function public.rpc_admin_update_user(
  p_user_id uuid,
  p_full_name text,
  p_phone text default null,
  p_email text default null,
  p_new_password text default null,
  p_role public.user_role default 'employee',
  p_custom_role text default null,
  p_department_id uuid default null,
  p_approval_status public.approval_status default 'approved'
)
returns public.profiles
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_clean_email text := lower(nullif(trim(coalesce(p_email, '')), ''));
  v_clean_pass text := nullif(p_new_password, '');
  v_existing_role public.user_role;
  v_profile public.profiles;
begin
  if not (public.is_system_admin() or public.has_core_action('manage_users')) then
    raise exception 'Erişim engellendi: Personel bilgilerini düzenleme yetkiniz yok.';
  end if;

  select role into v_existing_role
  from public.profiles
  where id = p_user_id;

  if not found then
    raise exception 'Kullanıcı profili bulunamadı.';
  end if;

  if (p_role = 'system_admin' or v_existing_role = 'system_admin') and not public.is_system_admin() then
    raise exception 'Erişim engellendi: Sistem Yöneticisi rolünü yalnızca Sistem Yöneticisi değiştirebilir.';
  end if;

  if p_full_name is null or trim(p_full_name) = '' then
    raise exception 'Ad Soyad alanı boş bırakılamaz.';
  end if;

  if p_user_id = auth.uid() and (p_role <> v_existing_role or p_approval_status <> 'approved') then
    raise exception 'Kendi yönetici yetkinizi veya onay durumunuzu kısıtlayamazsınız.';
  end if;

  if p_department_id is not null
     and not exists (select 1 from public.departments d where d.id = p_department_id and d.is_active) then
    raise exception 'Geçersiz veya pasif departman.';
  end if;

  if v_clean_pass is not null and length(v_clean_pass) < 6 then
    raise exception 'Yeni şifre en az 6 karakter olmalıdır.';
  end if;

  if v_clean_email is not null then
    if exists (select 1 from auth.users where email = v_clean_email and id <> p_user_id) then
      raise exception 'Bu e-posta adresi başka bir kullanıcı tarafından kullanılıyor.';
    end if;

    update auth.users
    set
      email = v_clean_email,
      email_confirmed_at = coalesce(email_confirmed_at, now()),
      updated_at = now()
    where id = p_user_id;

    update auth.identities
    set
      identity_data = jsonb_set(coalesce(identity_data, '{}'::jsonb), '{email}', to_jsonb(v_clean_email)),
      updated_at = now()
    where user_id = p_user_id and provider = 'email';
  end if;

  if v_clean_pass is not null then
    update auth.users
    set
      encrypted_password = crypt(v_clean_pass, gen_salt('bf')),
      updated_at = now()
    where id = p_user_id;
  end if;

  update auth.users
  set
    raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
      || jsonb_build_object('full_name', trim(p_full_name), 'phone', nullif(trim(coalesce(p_phone, '')), '')),
    updated_at = now()
  where id = p_user_id;

  update public.profiles
  set
    full_name = trim(p_full_name),
    phone = nullif(trim(coalesce(p_phone, '')), ''),
    role = p_role,
    custom_role = nullif(trim(coalesce(p_custom_role, '')), ''),
    department_id = p_department_id,
    approval_status = p_approval_status,
    permissions = case
      when p_role <> v_existing_role then coalesce(permissions, '{}'::jsonb) - 'modules'
      else permissions
    end,
    updated_at = now()
  where id = p_user_id
  returning * into v_profile;

  return v_profile;
end;
$$;

-- 4) İş Takip salt-okunur rapor / izleme desteği (work_tracking.reports)
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
          or public.has_module_permission('work_tracking', 'reports')
          or exists (
            select 1
            from public.work_orders wo
            join public.work_order_assignments wa on wa.work_order_id = wo.id
            where wo.ticket_id = t.id and wa.user_id = auth.uid()
          )
        )
    );
$$;

drop policy if exists "Read authorized work orders" on public.work_orders;
create policy "Read authorized work orders" on public.work_orders
for select to authenticated
using (
  public.has_module_permission('work_tracking', 'view')
  and (
    public.wt_can_manage()
    or public.has_module_permission('work_tracking', 'reports')
    or exists (
      select 1 from public.work_order_assignments wa
      where wa.work_order_id = work_orders.id and wa.user_id = auth.uid()
    )
  )
);

revoke all on function public.rpc_update_user_permissions(uuid, jsonb) from public, anon;
grant execute on function public.rpc_update_user_permissions(uuid, jsonb) to authenticated;

revoke all on function public.rpc_toggle_system_module(text, boolean, boolean) from public, anon;
grant execute on function public.rpc_toggle_system_module(text, boolean, boolean) to authenticated;

revoke all on function public.rpc_admin_update_user(uuid, text, text, text, text, public.user_role, text, uuid, public.approval_status) from public, anon;
grant execute on function public.rpc_admin_update_user(uuid, text, text, text, text, public.user_role, text, uuid, public.approval_status) to authenticated;

-- =====================================================================
-- MIGRATION: 20261120000008_admin_user_management_rpcs.sql
-- PROJECT: AVM TECH – Modüler Teknik Operasyon Platformu
-- DESCRIPTION: Admin Personel Yönetimi için güvenli RPC fonksiyonları:
--   1) rpc_admin_get_user_emails: auth.users e-posta eşleştirmeleri
--   2) rpc_admin_create_user: doğrulamasız doğrudan personel ekleme
--   3) rpc_admin_update_user: personel bilgileri + şifre sıfırlama/güncelleme
-- =====================================================================

-- 1) Personel e-posta listesini döndürme
create or replace function public.rpc_admin_get_user_emails()
returns table (id uuid, email text)
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not (public.is_system_admin() or public.has_core_action('manage_users')) then
    raise exception 'Erişim engellendi: Yalnızca yetkili yöneticiler e-posta bilgilerini görebilir.';
  end if;

  return query
  select u.id, u.email::text
  from auth.users u;
end;
$$;

-- 2) Yönetici tarafından doğrudan onaylı personel oluşturma
create or replace function public.rpc_admin_create_user(
  p_full_name text,
  p_phone text default null,
  p_email text default null,
  p_password text default null,
  p_role public.user_role default 'technician',
  p_department_id uuid default null,
  p_custom_role text default null
)
returns public.profiles
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_user_id uuid := gen_random_uuid();
  v_email text;
  v_password text;
  v_profile public.profiles;
begin
  if not (public.is_system_admin() or public.has_core_action('manage_users')) then
    raise exception 'Erişim engellendi: Personel ekleme yetkiniz yok.';
  end if;

  if p_role = 'system_admin' and not public.is_system_admin() then
    raise exception 'Erişim engellendi: Yalnızca Sistem Yöneticisi (system_admin) rolü verebilir.';
  end if;

  if p_full_name is null or trim(p_full_name) = '' then
    raise exception 'Ad Soyad alanı zorunludur.';
  end if;

  if p_department_id is not null
     and not exists (select 1 from public.departments d where d.id = p_department_id and d.is_active) then
    raise exception 'Geçersiz veya pasif departman.';
  end if;

  v_email := lower(nullif(trim(p_email), ''));
  if v_email is null then
    v_email := 'p' || extract(epoch from clock_timestamp())::bigint::text || floor(random() * 1000)::int::text || '@avmtech.com';
  end if;

  if exists (select 1 from auth.users where email = v_email) then
    raise exception 'Bu e-posta adresi ile kayıtlı bir kullanıcı zaten mevcut.';
  end if;

  v_password := coalesce(nullif(p_password, ''), '123456');
  if length(v_password) < 6 then
    raise exception 'Şifre en az 6 karakter olmalıdır.';
  end if;

  insert into auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at,
    confirmation_token,
    email_change,
    email_change_token_new,
    recovery_token
  )
  values (
    '00000000-0000-0000-0000-000000000000',
    v_user_id,
    'authenticated',
    'authenticated',
    v_email,
    crypt(v_password, gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('full_name', trim(p_full_name), 'phone', nullif(trim(coalesce(p_phone, '')), '')),
    now(),
    now(),
    '',
    '',
    '',
    ''
  );

  insert into auth.identities (
    id,
    user_id,
    identity_data,
    provider,
    provider_id,
    last_sign_in_at,
    created_at,
    updated_at
  )
  values (
    gen_random_uuid(),
    v_user_id,
    jsonb_build_object('sub', v_user_id::text, 'email', v_email, 'email_verified', true),
    'email',
    v_user_id::text,
    now(),
    now(),
    now()
  );

  -- on_auth_user_created tetikleyicisi profili oluşturmuştur; yoksa ekle, varsa güncelle
  insert into public.profiles (
    id,
    full_name,
    phone,
    role,
    custom_role,
    approval_status,
    department_id,
    approved_by,
    approved_at
  )
  values (
    v_user_id,
    trim(p_full_name),
    nullif(trim(coalesce(p_phone, '')), ''),
    p_role,
    nullif(trim(coalesce(p_custom_role, '')), ''),
    'approved',
    p_department_id,
    auth.uid(),
    now()
  )
  on conflict (id) do update
  set
    full_name = excluded.full_name,
    phone = excluded.phone,
    role = excluded.role,
    custom_role = excluded.custom_role,
    approval_status = 'approved',
    department_id = excluded.department_id,
    approved_by = auth.uid(),
    approved_at = now(),
    updated_at = now()
  returning * into v_profile;

  return v_profile;
end;
$$;

-- 3) Personel bilgileri ve şifre güncelleme / sıfırlama
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
    updated_at = now()
  where id = p_user_id
  returning * into v_profile;

  return v_profile;
end;
$$;

revoke all on function public.rpc_admin_get_user_emails() from public, anon;
grant execute on function public.rpc_admin_get_user_emails() to authenticated;

revoke all on function public.rpc_admin_create_user(text, text, text, text, public.user_role, uuid, text) from public, anon;
grant execute on function public.rpc_admin_create_user(text, text, text, text, public.user_role, uuid, text) to authenticated;

revoke all on function public.rpc_admin_update_user(uuid, text, text, text, text, public.user_role, text, uuid, public.approval_status) from public, anon;
grant execute on function public.rpc_admin_update_user(uuid, text, text, text, text, public.user_role, text, uuid, public.approval_status) to authenticated;

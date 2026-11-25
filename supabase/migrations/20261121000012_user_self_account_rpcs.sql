-- =====================================================================
-- MIGRATION: 20261121000012_user_self_account_rpcs.sql
-- PROJECT: AVM TECH – Modüler Teknik Operasyon Platformu
-- DESCRIPTION: Oturum açmış kullanıcının kendi bilgilerini (ad soyad,
--   telefon, e-posta, şifre) görüntülemesi ve güvenle güncellemesi:
--   1) rpc_get_own_account
--   2) rpc_update_own_account
-- =====================================================================

-- 1) Kullanıcının kendi profil + auth e-posta bilgisini tek sorguda getir
create or replace function public.rpc_get_own_account()
returns table (
  id uuid,
  full_name text,
  phone text,
  email text,
  role public.user_role,
  custom_role text,
  department_name text,
  approval_status public.approval_status,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, auth
as $$
begin
  if auth.uid() is null then
    raise exception 'Oturum bulunamadı.';
  end if;

  return query
  select
    p.id,
    p.full_name,
    p.phone,
    u.email::text,
    p.role,
    p.custom_role,
    d.name as department_name,
    p.approval_status,
    p.created_at
  from public.profiles p
  join auth.users u on u.id = p.id
  left join public.departments d on d.id = p.department_id
  where p.id = auth.uid();
end;
$$;

-- 2) Kullanıcının kendi ad soyad, telefon, e-posta ve şifresini güvenle güncellemesi
--    (rol, yetki veya onay durumu kesinlikle değiştirilmez)
create or replace function public.rpc_update_own_account(
  p_full_name text,
  p_phone text default null,
  p_email text default null,
  p_current_password text default null,
  p_new_password text default null
)
returns table (
  id uuid,
  full_name text,
  phone text,
  email text
)
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_uid uuid := auth.uid();
  v_clean_name text := trim(coalesce(p_full_name, ''));
  v_clean_phone text := nullif(trim(coalesce(p_phone, '')), '');
  v_clean_email text := lower(nullif(trim(coalesce(p_email, '')), ''));
  v_new_pass text := nullif(p_new_password, '');
  v_current_email text;
  v_current_hash text;
  v_at_pos integer;
begin
  if v_uid is null then
    raise exception 'Oturum bulunamadı.';
  end if;

  if v_clean_name = '' then
    raise exception 'Ad Soyad alanı boş bırakılamaz.';
  end if;

  select u.email::text, u.encrypted_password
  into v_current_email, v_current_hash
  from auth.users u
  where u.id = v_uid;

  if not found then
    raise exception 'Kullanıcı hesabı bulunamadı.';
  end if;

  -- E-posta değişikliği talep edildiyse doğrula ve güncelle
  if v_clean_email is not null and v_clean_email <> lower(coalesce(v_current_email, '')) then
    v_at_pos := position('@' in v_clean_email);
    if v_at_pos <= 1 or position('.' in substring(v_clean_email from v_at_pos + 1)) <= 1 then
      raise exception 'Geçerli bir e-posta adresi giriniz.';
    end if;

    if exists (select 1 from auth.users u2 where lower(u2.email) = v_clean_email and u2.id <> v_uid) then
      raise exception 'Bu e-posta adresi başka bir kullanıcı tarafından kullanılıyor.';
    end if;

    update auth.users u
    set
      email = v_clean_email,
      email_confirmed_at = coalesce(u.email_confirmed_at, now()),
      email_change = '',
      email_change_token_new = '',
      updated_at = now()
    where u.id = v_uid;

    update auth.identities i
    set
      identity_data = jsonb_set(coalesce(i.identity_data, '{}'::jsonb), '{email}', to_jsonb(v_clean_email)),
      updated_at = now()
    where i.user_id = v_uid and i.provider = 'email';

    v_current_email := v_clean_email;
  end if;

  -- Şifre değişikliği talep edildiyse mevcut şifreyi doğrula ve yenile
  if v_new_pass is not null then
    if length(v_new_pass) < 6 then
      raise exception 'Yeni şifre en az 6 karakter olmalıdır.';
    end if;

    if v_current_hash is null
       or coalesce(p_current_password, '') = ''
       or crypt(p_current_password, v_current_hash) <> v_current_hash then
      raise exception 'Mevcut şifreniz hatalı.';
    end if;

    update auth.users u
    set
      encrypted_password = crypt(v_new_pass, gen_salt('bf')),
      updated_at = now()
    where u.id = v_uid;
  end if;

  update auth.users u
  set
    raw_user_meta_data = coalesce(u.raw_user_meta_data, '{}'::jsonb)
      || jsonb_build_object('full_name', v_clean_name, 'phone', v_clean_phone),
    updated_at = now()
  where u.id = v_uid;

  update public.profiles p
  set
    full_name = v_clean_name,
    phone = v_clean_phone,
    updated_at = now()
  where p.id = v_uid;

  return query
  select
    p.id,
    p.full_name,
    p.phone,
    v_current_email
  from public.profiles p
  where p.id = v_uid;
end;
$$;

revoke all on function public.rpc_get_own_account() from public, anon;
grant execute on function public.rpc_get_own_account() to authenticated;

revoke all on function public.rpc_update_own_account(text, text, text, text, text) from public, anon;
grant execute on function public.rpc_update_own_account(text, text, text, text, text) to authenticated;

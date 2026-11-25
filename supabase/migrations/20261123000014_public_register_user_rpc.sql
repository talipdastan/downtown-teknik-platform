-- =====================================================================
-- MIGRATION: 20261123000014_public_register_user_rpc.sql
-- PROJECT: Downtown Teknik – Teknik Operasyon Yönetim Platformu
-- DESCRIPTION:
--   Supabase Auth ücretsiz SMTP e-posta gönderim limiti (429 over_email_send_rate_limit)
--   ve e-posta doğrulama beklemesi nedeniyle mobil/web kayıt ekranında yaşanan hatayı
--   kalıcı olarak çözer.
--   1) public.rpc_register_user: Yeni personeli e-posta gönderimi tetiklemeden
--      `email_confirmed_at = now()` ve `approval_status = 'pending'` (yönetici onayı
--      bekliyor) olarak oluşturur.
--   2) Mevcut `auth.users` tablosunda e-postası doğrulanmamış (`email_confirmed_at is null`)
--      kullanıcıları onaylı hale getirir ki yönetici onayladığında giriş yapabilsinler.
-- =====================================================================

-- 1) Mevcut e-posta onayı bekleyen kullanıcıların email_confirmed_at alanını doldur
update auth.users
set
  email_confirmed_at = coalesce(email_confirmed_at, now()),
  updated_at = now()
where email_confirmed_at is null;

-- 2) Yeni başlayan tüm auth.users kayıtlarında email_confirmed_at boşsa otomatik doldur
create or replace function public.trg_auto_confirm_auth_user_email()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if new.email_confirmed_at is null then
    new.email_confirmed_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_auth_users_auto_confirm_email on auth.users;
create trigger trg_auth_users_auto_confirm_email
before insert on auth.users
for each row execute function public.trg_auto_confirm_auth_user_email();

-- 3) SMTP hız limitine (429) takılmadan güvenli personel kaydı oluşturan RPC
create or replace function public.rpc_register_user(
  p_full_name text,
  p_email text,
  p_password text,
  p_phone text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_user_id uuid := gen_random_uuid();
  v_clean_name text := trim(coalesce(p_full_name, ''));
  v_clean_email text := lower(nullif(trim(coalesce(p_email, '')), ''));
  v_clean_phone text := nullif(trim(coalesce(p_phone, '')), '');
  v_existing_id uuid;
  v_existing_hash text;
  v_at_pos integer;
begin
  if length(v_clean_name) < 2 then
    raise exception 'Lütfen geçerli bir Ad Soyad giriniz.';
  end if;

  if v_clean_email is null then
    raise exception 'E-posta adresi zorunludur.';
  end if;

  v_at_pos := position('@' in v_clean_email);
  if v_at_pos <= 1 or position('.' in substring(v_clean_email from v_at_pos + 1)) <= 1 then
    raise exception 'Geçerli bir e-posta adresi giriniz.';
  end if;

  if p_password is null or length(p_password) < 6 then
    raise exception 'Parola en az 6 karakter olmalıdır.';
  end if;

  -- Eğer bu e-posta ile daha önce kayıt oluşturulmuşsa:
  select u.id, u.encrypted_password
  into v_existing_id, v_existing_hash
  from auth.users u
  where lower(u.email) = v_clean_email
  limit 1;

  if v_existing_id is not null then
    -- E-posta onayı eksik kalmışsa tamamla
    update auth.users
    set
      email_confirmed_at = coalesce(email_confirmed_at, now()),
      updated_at = now()
    where id = v_existing_id
      and email_confirmed_at is null;

    -- Aynı şifreyle tekrar basıldıysa (örn. çift tıklama) hata vermek yerine mevcut ID'yi döndür
    if v_existing_hash is not null and crypt(p_password, v_existing_hash) = v_existing_hash then
      return v_existing_id;
    end if;

    raise exception 'Bu e-posta adresi ile zaten bir kayıt mevcut. Giriş ekranından giriş yapabilirsiniz.';
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
    v_clean_email,
    crypt(p_password, gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('full_name', v_clean_name, 'phone', v_clean_phone),
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
    jsonb_build_object('sub', v_user_id::text, 'email', v_clean_email, 'email_verified', true),
    'email',
    v_user_id::text,
    now(),
    now(),
    now()
  );

  -- on_auth_user_created trigger'ı profili 'employee' ve 'pending' olarak oluşturur;
  -- ad soyad ve telefon bilgisini garanti altına alalım:
  insert into public.profiles (
    id,
    full_name,
    phone,
    role,
    approval_status
  )
  values (
    v_user_id,
    v_clean_name,
    v_clean_phone,
    'employee',
    'pending'
  )
  on conflict (id) do update
  set
    full_name = excluded.full_name,
    phone = coalesce(excluded.phone, public.profiles.phone),
    updated_at = now();

  return v_user_id;
end;
$$;

revoke all on function public.rpc_register_user(text, text, text, text) from public;
grant execute on function public.rpc_register_user(text, text, text, text) to anon, authenticated;

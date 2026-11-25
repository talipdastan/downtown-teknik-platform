-- =====================================================================
-- MIGRATION: 20261123000015_user_self_update_requires_approval.sql
-- PROJECT: Downtown Teknik – Teknik Operasyon Yönetim Platformu
-- DESCRIPTION:
--   Kullanıcıların kendi profil/iletişim bilgilerinde (Ad Soyad, Telefon,
--   E-posta) veya `rpc_update_own_profile` / `rpc_update_own_account`
--   üzerinden değişiklik yaptığında rastgele/uygunsuz değişikliklerin
--   anında canlıya geçmesini engellemek için:
--   1) Sistem Yöneticisi (`system_admin`) dışındaki kullanıcılar kendi
--      ad soyad, telefon veya e-posta bilgilerini değiştirdiğinde
--      hesaplarının `approval_status` durumu otomatik olarak `'pending'`
--      (Yönetici Onayı Bekliyor) durumuna çekilir.
--   2) Sistem yöneticilerine ve `manage_users` yetkili yöneticilere
--      eski ve yeni bilgileri içeren otomatik bildirim düşer.
--   3) Yalnızca şifre yenileme işleminde (ad, telefon ve e-posta değişmemişse)
--      onay durumu korunur; ancak bilgi değişikliği varsa yönetici onayına sunulur.
-- =====================================================================

-- 1) Eski `rpc_update_own_profile` fonksiyonunu da aynı onay kuralına bağla
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
  v_uid uuid := auth.uid();
  v_existing public.profiles;
  v_updated public.profiles;
  v_clean_name text := trim(coalesce(p_full_name, ''));
  v_clean_phone text := nullif(trim(coalesce(p_phone, '')), '');
  v_info_changed boolean := false;
  v_next_status public.approval_status;
  v_admin_id uuid;
begin
  if v_uid is null then
    raise exception 'Oturum bulunamadı.';
  end if;

  if length(v_clean_name) < 3 then
    raise exception 'Ad Soyad en az 3 karakter olmalıdır.';
  end if;

  select * into v_existing
  from public.profiles
  where id = v_uid;

  if not found then
    raise exception 'Kullanıcı profili bulunamadı.';
  end if;

  v_info_changed :=
    (v_clean_name <> coalesce(v_existing.full_name, ''))
    or (coalesce(v_clean_phone, '') <> coalesce(v_existing.phone, ''));

  if v_info_changed and v_existing.role <> 'system_admin' then
    v_next_status := 'pending';
  else
    v_next_status := v_existing.approval_status;
  end if;

  update public.profiles
  set
    full_name = v_clean_name,
    phone = v_clean_phone,
    approval_status = v_next_status,
    updated_at = now()
  where id = v_uid
  returning * into v_updated;

  if v_info_changed and v_existing.role <> 'system_admin' then
    for v_admin_id in
      select p.id
      from public.profiles p
      where p.approval_status = 'approved'
        and (
          p.role = 'system_admin'
          or (
            jsonb_typeof(p.permissions -> 'core_actions') = 'array'
            and (p.permissions -> 'core_actions') ? 'manage_users'
          )
        )
    loop
      insert into public.notifications (user_id, module_key, entity_type, entity_id, title, message)
      values (
        v_admin_id,
        'system',
        'profile',
        v_uid,
        'Profil Değişikliği Onay Bekliyor: ' || v_clean_name,
        'Personel (' || coalesce(v_existing.full_name, '') || ' -> ' || v_clean_name || ') kendi profil bilgilerini güncelledi ve yönetici onayına sunuldu.'
      );
    end loop;
  end if;

  return v_updated;
end;
$$;

-- 2) `rpc_update_own_account`: Ad Soyad, Telefon veya E-posta değiştiğinde yönetici onayına (`pending`) düşür
drop function if exists public.rpc_update_own_account(text, text, text, text, text);

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
  email text,
  approval_status public.approval_status
)
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_uid uuid := auth.uid();
  v_existing_profile public.profiles;
  v_clean_name text := trim(coalesce(p_full_name, ''));
  v_clean_phone text := nullif(trim(coalesce(p_phone, '')), '');
  v_clean_email text := lower(nullif(trim(coalesce(p_email, '')), ''));
  v_new_pass text := nullif(p_new_password, '');
  v_current_email text;
  v_current_hash text;
  v_at_pos integer;
  v_name_changed boolean := false;
  v_phone_changed boolean := false;
  v_email_changed boolean := false;
  v_info_changed boolean := false;
  v_next_status public.approval_status;
  v_change_parts text[] := array[]::text[];
  v_admin_id uuid;
begin
  if v_uid is null then
    raise exception 'Oturum bulunamadı.';
  end if;

  if length(v_clean_name) < 3 then
    raise exception 'Ad Soyad en az 3 karakter olmalıdır.';
  end if;

  select * into v_existing_profile
  from public.profiles p
  where p.id = v_uid;

  if not found then
    raise exception 'Kullanıcı profili bulunamadı.';
  end if;

  select u.email::text, u.encrypted_password
  into v_current_email, v_current_hash
  from auth.users u
  where u.id = v_uid;

  if not found then
    raise exception 'Kullanıcı hesabı bulunamadı.';
  end if;

  v_name_changed := v_clean_name <> coalesce(v_existing_profile.full_name, '');
  v_phone_changed := coalesce(v_clean_phone, '') <> coalesce(v_existing_profile.phone, '');
  v_email_changed :=
    v_clean_email is not null
    and v_clean_email <> lower(coalesce(v_current_email, ''));

  v_info_changed := v_name_changed or v_phone_changed or v_email_changed;

  if v_name_changed then
    v_change_parts := array_append(
      v_change_parts,
      'Ad: "' || coalesce(v_existing_profile.full_name, '-') || '" -> "' || v_clean_name || '"'
    );
  end if;

  if v_phone_changed then
    v_change_parts := array_append(
      v_change_parts,
      'Tel: "' || coalesce(v_existing_profile.phone, '-') || '" -> "' || coalesce(v_clean_phone, '-') || '"'
    );
  end if;

  -- E-posta değişikliği talep edildiyse doğrula ve güncelle
  if v_email_changed then
    v_at_pos := position('@' in v_clean_email);
    if v_at_pos <= 1 or position('.' in substring(v_clean_email from v_at_pos + 1)) <= 1 then
      raise exception 'Geçerli bir e-posta adresi giriniz.';
    end if;

    if exists (select 1 from auth.users u2 where lower(u2.email) = v_clean_email and u2.id <> v_uid) then
      raise exception 'Bu e-posta adresi başka bir kullanıcı tarafından kullanılıyor.';
    end if;

    v_change_parts := array_append(
      v_change_parts,
      'E-posta: "' || coalesce(v_current_email, '-') || '" -> "' || v_clean_email || '"'
    );

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

  -- system_admin dışındaki bir kullanıcı kendi profil/iletişim bilgisini değiştirdiyse
  -- tekrar yönetici onayına ('pending') düşür
  if v_info_changed and v_existing_profile.role <> 'system_admin' then
    v_next_status := 'pending';
  else
    v_next_status := v_existing_profile.approval_status;
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
    approval_status = v_next_status,
    updated_at = now()
  where p.id = v_uid;

  -- Yöneticilere bildirim gönder
  if v_info_changed and v_existing_profile.role <> 'system_admin' then
    for v_admin_id in
      select p.id
      from public.profiles p
      where p.approval_status = 'approved'
        and (
          p.role = 'system_admin'
          or (
            jsonb_typeof(p.permissions -> 'core_actions') = 'array'
            and (p.permissions -> 'core_actions') ? 'manage_users'
          )
        )
    loop
      insert into public.notifications (user_id, module_key, entity_type, entity_id, title, message)
      values (
        v_admin_id,
        'system',
        'profile',
        v_uid,
        'Profil Güncelleme Onayı Bekliyor: ' || v_clean_name,
        'Personel bilgilerini değiştirdi (' || array_to_string(v_change_parts, ' · ') || '). Yeniden yönetici onayı bekliyor.'
      );
    end loop;
  end if;

  return query
  select
    p.id,
    p.full_name,
    p.phone,
    v_current_email,
    p.approval_status
  from public.profiles p
  where p.id = v_uid;
end;
$$;

revoke all on function public.rpc_update_own_profile(text, text) from public, anon;
grant execute on function public.rpc_update_own_profile(text, text) to authenticated;

revoke all on function public.rpc_update_own_account(text, text, text, text, text) from public, anon;
grant execute on function public.rpc_update_own_account(text, text, text, text, text) to authenticated;

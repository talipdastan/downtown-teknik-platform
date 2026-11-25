-- =====================================================================
-- SCRIPT: supabase/scripts/create_initial_admin.sql
-- DESCRIPTION: İlk Sistem Yöneticisini (system_admin) kontrollü olarak
--              yetkilendirir. Supabase SQL Editor'da tek sefer çalıştırılır.
-- =====================================================================

do $$
declare
  v_admin_email text := 'admin@avmtech.local'; -- <-- İlk yönetici e-postasını buraya yazın
  v_user_id uuid;
begin
  select id into v_user_id
  from auth.users
  where lower(email) = lower(v_admin_email)
  limit 1;

  if v_user_id is null then
    raise exception 'Kullanıcı auth.users tablosunda bulunamadı: %', v_admin_email;
  end if;

  update public.profiles
  set
    role = 'system_admin',
    approval_status = 'approved',
    approved_by = v_user_id,
    approved_at = now(),
    updated_at = now()
  where id = v_user_id;

  raise notice 'İlk Sistem Yöneticisi yetkilendirildi: % (%)', v_admin_email, v_user_id;
end $$;

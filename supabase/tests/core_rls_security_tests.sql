-- =====================================================================
-- TEST: supabase/tests/core_rls_security_tests.sql
-- DESCRIPTION: Çekirdek şema, Gatekeeper, 8 bağımsız modül izni ve
--              yetki yükseltme engellerinin doğrulama testi.
-- =====================================================================

begin;

-- 1. default_module_permission doğrulama testleri
do $$
begin
  -- system_admin tüm modül ve izinlere sahip olmalı
  assert public.default_module_permission('system_admin', 'energy', 'delete') = true, 'system_admin energy.delete true olmalı';
  assert public.default_module_permission('system_admin', 'work_tracking', 'approve') = true, 'system_admin work_tracking.approve true olmalı';

  -- employee varsayılan olarak energy modülüne erişememeli
  assert public.default_module_permission('employee', 'energy', 'enabled') = false, 'employee energy.enabled false olmalı';
  assert public.default_module_permission('employee', 'work_tracking', 'create') = true, 'employee work_tracking.create true olmalı';
  assert public.default_module_permission('employee', 'work_tracking', 'delete') = false, 'employee work_tracking.delete false olmalı';

  -- technician energy'de okuma girebilir (create) ama silemez (delete) veya yönetemez (manage)
  assert public.default_module_permission('technician', 'energy', 'enabled') = true, 'technician energy.enabled true olmalı';
  assert public.default_module_permission('technician', 'energy', 'create') = true, 'technician energy.create true olmalı';
  assert public.default_module_permission('technician', 'energy', 'delete') = false, 'technician energy.delete false olmalı';
  assert public.default_module_permission('technician', 'energy', 'manage') = false, 'technician energy.manage false olmalı';

  raise notice 'OK: default_module_permission testleri geçti.';
end $$;

-- 2. Çekirdek tablolarda RLS aktiflik kontrolü
do $$
declare
  v_table text;
  v_rls boolean;
begin
  foreach v_table in array array[
    'departments', 'floors', 'locations', 'custom_roles',
    'profiles', 'system_modules', 'equipments', 'notifications'
  ]
  loop
    select relrowsecurity into v_rls
    from pg_class
    where relname = v_table and relnamespace = 'public'::regnamespace;

    assert v_rls = true, format('RLS aktif değil: public.%s', v_table);
  end loop;

  raise notice 'OK: Tüm çekirdek tablolarda RLS aktif.';
end $$;

rollback;

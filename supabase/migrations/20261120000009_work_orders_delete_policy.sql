-- =====================================================================
-- MIGRATION: 20261120000009_work_orders_delete_policy.sql
-- PROJECT: AVM TECH – İş Takip Modülü
-- DESCRIPTION: Yetkili yöneticiler (work_tracking.delete) için
--   public.work_orders tablosuna DELETE RLS politikası eklenir.
-- =====================================================================

drop policy if exists "Managers delete work orders" on public.work_orders;
create policy "Managers delete work orders" on public.work_orders
for delete to authenticated
using (public.has_module_permission('work_tracking', 'delete'));

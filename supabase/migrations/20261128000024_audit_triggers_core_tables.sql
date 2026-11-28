-- =====================================================================
-- MIGRATION: 20261128000024_audit_triggers_core_tables.sql
-- PROJECT: Downtown Teknik – Çekirdek Tablo Denetim Trigger'ları
-- DESCRIPTION:
--   Migration 0023'teki `public.fn_record_audit_log()` fonksiyonunu
--   Enerji Takip ve İş Takip çekirdek tablolarına bağlar:
--   - public.tickets (güncelleme/silme)
--   - public.work_orders (güncelleme/silme)
--   - public.energy_budgets (güncelleme/silme)
--   - public.meters (güncelleme/silme/çöp kutusu)
-- =====================================================================

drop trigger if exists trg_audit_tickets on public.tickets;
create trigger trg_audit_tickets
  after update or delete on public.tickets
  for each row execute function public.fn_record_audit_log();

drop trigger if exists trg_audit_work_orders on public.work_orders;
create trigger trg_audit_work_orders
  after update or delete on public.work_orders
  for each row execute function public.fn_record_audit_log();

drop trigger if exists trg_audit_energy_budgets on public.energy_budgets;
create trigger trg_audit_energy_budgets
  after update or delete on public.energy_budgets
  for each row execute function public.fn_record_audit_log();

drop trigger if exists trg_audit_meters on public.meters;
create trigger trg_audit_meters
  after update or delete on public.meters
  for each row execute function public.fn_record_audit_log();

-- =====================================================================
-- MIGRATION: 20261127000018_reporting_pagination_and_indexes.sql
-- PROJECT: Downtown Teknik – Faz 1 Veri Doğruluğu, İndeksler ve N+1 Düzeltmesi
-- DESCRIPTION:
--   1. Personel bazlı tamamlama raporları için kısmi indeks:
--      `idx_work_orders_completed_by_at` (meter_readings(meter_id, reading_date DESC)
--      zaten Migration 0005/0006'da mevcut olduğundan tekrar eklenmez).
--   2. İş Takip özet ekranındaki 5 ayrı HEAD count sorgusunu tek gidiş-dönüşe
--      indiren `SECURITY INVOKER` (RLS uyumlu) `rpc_work_tracking_dashboard_summary`.
--   3. Mobil sayaç sıralamasındaki N+1 ardışık UPDATE döngüsünü tek atomik
--      sorguya çeviren `rpc_reorder_meters(uuid[])`.
-- =====================================================================

-- 1. Kısmi performans indeksi (yalnızca tamamlanmış iş emirleri)
create index if not exists idx_work_orders_completed_by_at
  on public.work_orders (completed_by, completed_at desc)
  where completed_by is not null;

-- 2. İş Takip özet KPI RPC'si (SECURITY INVOKER -> mevcut RLS politikaları geçerlidir)
create or replace function public.rpc_work_tracking_dashboard_summary()
returns table (
  unassigned_count bigint,
  in_field_count bigint,
  awaiting_approval_count bigint,
  closed_count bigint,
  urgent_open_count bigint,
  total_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    count(*) filter (where status in ('new', 'under_review'))::bigint as unassigned_count,
    count(*) filter (where status in ('assigned', 'in_progress', 'waiting'))::bigint as in_field_count,
    count(*) filter (where status = 'resolved')::bigint as awaiting_approval_count,
    count(*) filter (where status = 'closed')::bigint as closed_count,
    count(*) filter (
      where priority = 'urgent' and status not in ('closed', 'cancelled')
    )::bigint as urgent_open_count,
    count(*) filter (where status <> 'cancelled')::bigint as total_count
  from public.tickets;
$$;

revoke all on function public.rpc_work_tracking_dashboard_summary() from public, anon;
grant execute on function public.rpc_work_tracking_dashboard_summary() to authenticated;

-- 3. Sayaç sıralama N+1 çözüm RPC'si (tek atomik toplu güncelleme)
create or replace function public.rpc_reorder_meters(
  p_meter_ids uuid[]
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated int := 0;
begin
  if auth.uid() is null or not (
    public.has_module_permission('energy', 'edit')
    or public.has_module_permission('energy', 'manage')
  ) then
    raise exception 'Erişim engellendi: Sayaç sıralama yetkiniz yok.';
  end if;

  if p_meter_ids is null or array_length(p_meter_ids, 1) is null then
    return 0;
  end if;

  with ordered as (
    select
      meter_id,
      (ord - 1)::int as new_order
    from unnest(p_meter_ids) with ordinality as t(meter_id, ord)
  )
  update public.meters m
  set sort_order = o.new_order,
      updated_at = now()
  from ordered o
  where m.id = o.meter_id
    and m.sort_order is distinct from o.new_order;

  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

revoke all on function public.rpc_reorder_meters(uuid[]) from public, anon;
grant execute on function public.rpc_reorder_meters(uuid[]) to authenticated;

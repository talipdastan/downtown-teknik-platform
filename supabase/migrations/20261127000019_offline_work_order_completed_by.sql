-- =====================================================================
-- MIGRATION: 20261127000019_offline_work_order_completed_by.sql
-- PROJECT: Downtown Teknik – Offline İş Emri Tamamlama Tutarlılığı
-- DESCRIPTION:
--   Migration 0016 ile `work_orders.completed_by` sütunu eklenmiş ancak
--   Migration 0006'daki `rpc_sync_offline_work_order_status` güncellenmemişti.
--   Bu migration offline tamamlama sırasında `completed_by = auth.uid()` yazar
--   ve tekrar denemelerde (retry) aynı "Tamamlanma Notu" yorumunun mükerrer
--   eklenmesini engeller.
-- =====================================================================

create or replace function public.rpc_sync_offline_work_order_status(
  p_work_order_id uuid,
  p_target_status public.work_order_status,
  p_base_updated_at timestamptz,
  p_waiting_reason text default null,
  p_note text default null,
  p_force_overwrite boolean default false
)
returns table (
  sync_result text,
  server_status public.work_order_status,
  server_updated_at timestamptz,
  work_order_id uuid,
  conflict_reason text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wo public.work_orders;
  v_clean_reason text := nullif(trim(coalesce(p_waiting_reason, '')), '');
  v_clean_note text := nullif(trim(coalesce(p_note, '')), '');
  v_formatted_note text;
begin
  perform public.wt_assert_can_execute(p_work_order_id);

  if p_target_status not in ('in_progress', 'waiting', 'completed') then
    raise exception 'Geçersiz hedef iş emri durumu: %', p_target_status;
  end if;

  if p_target_status = 'waiting' and v_clean_reason is null then
    raise exception 'Beklemeye alma işleminde bekleme nedeni belirtilmesi zorunludur.';
  end if;

  select * into v_wo
  from public.work_orders
  where id = p_work_order_id
  for update;

  if not found then
    raise exception 'İş emri bulunamadı.';
  end if;

  if v_wo.status = 'cancelled' then
    raise exception 'İptal edilmiş iş emri offline senkronizasyon ile güncellenemez.';
  end if;

  -- Çakışma tespiti: sunucuda kayıt offline işlemden sonra güncellenmişse
  if not coalesce(p_force_overwrite, false)
     and p_base_updated_at is not null
     and v_wo.updated_at > p_base_updated_at
     and v_wo.status is distinct from p_target_status then
    return query
    select
      'conflict'::text,
      v_wo.status,
      v_wo.updated_at,
      v_wo.id,
      ('Sunucu kaydı daha güncel (' || v_wo.status::text || ').')::text;
    return;
  end if;

  if p_target_status = 'in_progress' then
    update public.work_orders
    set status = 'in_progress',
        started_at = coalesce(started_at, now()),
        waiting_reason = null,
        updated_at = now()
    where id = p_work_order_id
    returning * into v_wo;

    update public.tickets
    set status = 'in_progress', updated_at = now()
    where id = v_wo.ticket_id and status in ('assigned', 'waiting');

  elsif p_target_status = 'waiting' then
    update public.work_orders
    set status = 'waiting',
        waiting_reason = v_clean_reason,
        updated_at = now()
    where id = p_work_order_id
    returning * into v_wo;

    if not exists (
      select 1 from public.work_orders
      where ticket_id = v_wo.ticket_id and id <> p_work_order_id and status = 'in_progress'
    ) then
      update public.tickets
      set status = 'waiting', updated_at = now()
      where id = v_wo.ticket_id and status in ('assigned', 'in_progress');
    end if;

  elsif p_target_status = 'completed' then
    update public.work_orders
    set status = 'completed',
        completed_at = coalesce(completed_at, now()),
        completed_by = coalesce(completed_by, auth.uid()),
        waiting_reason = null,
        updated_at = now()
    where id = p_work_order_id
    returning * into v_wo;

    if v_clean_note is not null then
      v_formatted_note := 'Tamamlanma Notu: ' || v_clean_note;
      if not exists (
        select 1 from public.comments c
        where c.work_order_id = v_wo.id
          and c.user_id = auth.uid()
          and c.comment = v_formatted_note
      ) then
        insert into public.comments (ticket_id, work_order_id, user_id, comment)
        values (v_wo.ticket_id, v_wo.id, auth.uid(), v_formatted_note);
      end if;
    end if;

    if not exists (
      select 1 from public.work_orders
      where ticket_id = v_wo.ticket_id and status not in ('completed', 'cancelled')
    ) then
      update public.tickets
      set status = 'resolved', resolved_at = coalesce(resolved_at, now()), updated_at = now()
      where id = v_wo.ticket_id and status in ('assigned', 'in_progress', 'waiting');
    end if;
  end if;

  return query
  select
    'synced'::text,
    v_wo.status,
    v_wo.updated_at,
    v_wo.id,
    null::text;
end;
$$;

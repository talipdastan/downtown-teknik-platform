-- =====================================================================
-- MIGRATION: 20261126000016_work_order_completion_and_photo_retention.sql
-- PROJECT: Downtown Teknik – İş Takip Geliştirmeleri
-- DESCRIPTION:
--   1. work_orders tablosuna `completed_by` (işi tamamlayan personel) eklenir
--      ve mevcut tamamlanmış iş emirleri için atanan teknisyenden doldurulur.
--   2. `rpc_technician_complete_work` fonksiyonu `completed_by = auth.uid()` yazar.
--   3. Kapanan (`closed` / `cancelled`) işlerde 15 günü geçen fotoğrafları
--      hem `storage.objects` (`work-attachments`) hem `public.attachments`
--      tablosundan otomatik temizleyen `public.rpc_purge_expired_closed_photos`
--      fonksiyonu ve otomatik tetikleyicisi eklenir (iş kaydı ve geçmişi korunur).
-- =====================================================================

-- 1. work_orders.completed_by sütunu
alter table public.work_orders
  add column if not exists completed_by uuid references public.profiles(id) on delete set null;

-- Mevcut tamamlanmış iş emirlerinde completed_by boşsa atanan ilk teknisyeni yaz
update public.work_orders wo
set completed_by = coalesce(
  (
    select wa.user_id
    from public.work_order_assignments wa
    where wa.work_order_id = wo.id
    order by wa.assigned_at asc
    limit 1
  ),
  wo.created_by
)
where wo.status = 'completed' and wo.completed_by is null;

-- 2. rpc_technician_complete_work güncellemesi (completed_by = auth.uid() kaydeder)
create or replace function public.rpc_technician_complete_work(
  p_work_order_id uuid,
  p_note text default null
)
returns public.work_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wo public.work_orders;
begin
  perform public.wt_assert_can_execute(p_work_order_id);

  update public.work_orders
  set status = 'completed',
      completed_at = now(),
      completed_by = auth.uid(),
      waiting_reason = null,
      updated_at = now()
  where id = p_work_order_id and status = 'in_progress'
  returning * into v_wo;

  if not found then
    raise exception 'İş emri bulunamadı veya yalnızca devam eden iş tamamlanabilir.';
  end if;

  if p_note is not null and trim(p_note) <> '' then
    insert into public.comments (ticket_id, work_order_id, user_id, comment)
    values (v_wo.ticket_id, v_wo.id, auth.uid(), 'Tamamlanma Notu: ' || trim(p_note));
  end if;

  if not exists (
    select 1 from public.work_orders
    where ticket_id = v_wo.ticket_id and status not in ('completed', 'cancelled')
  ) then
    update public.tickets
    set status = 'resolved', resolved_at = now(), updated_at = now()
    where id = v_wo.ticket_id and status in ('assigned', 'in_progress', 'waiting');
  end if;

  return v_wo;
end;
$$;

-- 3. Kapanan işlerde 15 günü geçen fotoğrafları Storage + DB'den silen fonksiyon
create or replace function public.rpc_purge_expired_closed_photos(
  p_retention_days int default 15
)
returns int
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_cutoff timestamptz;
  v_paths text[];
  v_deleted_count int := 0;
begin
  v_cutoff := now() - make_interval(days => greatest(1, coalesce(p_retention_days, 15)));

  -- Kapanmış (closed / cancelled) ve kapanış üzerinden 15 gün geçmiş arıza/iş emri fotoğraflarını bul
  with expired_tickets as (
    select t.id as ticket_id
    from public.tickets t
    where t.status in ('closed', 'cancelled')
      and coalesce(t.closed_at, t.resolved_at, t.updated_at, t.created_at) < v_cutoff
  ),
  expired_work_orders as (
    select wo.id as work_order_id
    from public.work_orders wo
    join public.tickets t on t.id = wo.ticket_id
    where t.status in ('closed', 'cancelled')
      and coalesce(t.closed_at, wo.completed_at, t.updated_at, t.created_at) < v_cutoff
  ),
  doomed_attachments as (
    delete from public.attachments a
    where (a.ticket_id in (select ticket_id from expired_tickets))
       or (a.work_order_id in (select work_order_id from expired_work_orders))
    returning a.file_path
  )
  select array_agg(file_path), count(*)::int
  into v_paths, v_deleted_count
  from doomed_attachments;

  -- Storage bucket ('work-attachments') içindeki fiziksel dosya kayıtlarını da temizle
  if v_paths is not null and array_length(v_paths, 1) > 0 then
    delete from storage.objects
    where bucket_id = 'work-attachments'
      and name = any(v_paths);
  end if;

  return coalesce(v_deleted_count, 0);
end;
$$;

revoke all on function public.rpc_purge_expired_closed_photos(int) from public, anon;
grant execute on function public.rpc_purge_expired_closed_photos(int) to authenticated;

-- 4. rpc_manager_close_ticket içinde her iş kapatıldığında 15 günü geçen eski fotoğrafları otomatik temizle
create or replace function public.rpc_manager_close_ticket(
  p_ticket_id uuid,
  p_resolution_note text,
  p_reopen boolean default false
)
returns public.tickets
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ticket public.tickets;
  v_assignee uuid;
begin
  if not public.has_module_permission('work_tracking', 'approve') then
    raise exception 'Erişim engellendi: Onay / iade yetkiniz yok.';
  end if;

  select * into v_ticket from public.tickets where id = p_ticket_id for update;
  if not found then
    raise exception 'Arıza kaydı bulunamadı.';
  end if;

  if not public.wt_can_manage() and v_ticket.reporter_id <> auth.uid() then
    raise exception 'Erişim engellendi: Yalnızca iş isteğini açan kullanıcı veya yöneticiler onay/iade işlemi yapabilir.';
  end if;

  if v_ticket.status <> 'resolved' then
    raise exception 'Yalnızca teknisyen tarafından tamamlanmış (onay bekleyen) iş istekleri onaylanabilir veya iade edilebilir.';
  end if;

  if p_reopen then
    if p_resolution_note is null or trim(p_resolution_note) = '' then
      raise exception 'İade işleminde gerekçe zorunludur.';
    end if;

    update public.work_orders
    set status = 'assigned', completed_at = null, completed_by = null, updated_at = now()
    where ticket_id = p_ticket_id and status = 'completed';

    update public.tickets
    set status = 'assigned', resolved_at = null, updated_at = now()
    where id = p_ticket_id
    returning * into v_ticket;

    insert into public.comments (ticket_id, user_id, comment)
    values (p_ticket_id, auth.uid(), 'Onay İade Gerekçesi: ' || trim(p_resolution_note));

    for v_assignee in
      select distinct wa.user_id
      from public.work_order_assignments wa
      join public.work_orders wo on wo.id = wa.work_order_id
      where wo.ticket_id = p_ticket_id
    loop
      perform public.wt_notify(
        v_assignee, p_ticket_id, 'İş Emri İade Edildi',
        v_ticket.ticket_number || ' numaralı iş isteği onaylanmayıp yeniden işleme iade edildi: ' || trim(p_resolution_note)
      );
    end loop;
  else
    update public.tickets
    set status = 'closed', closed_at = now(), updated_at = now()
    where id = p_ticket_id
    returning * into v_ticket;

    if p_resolution_note is not null and trim(p_resolution_note) <> '' then
      insert into public.comments (ticket_id, user_id, comment)
      values (p_ticket_id, auth.uid(), 'Onay / Kapatma Notu: ' || trim(p_resolution_note));
    end if;

    if v_ticket.reporter_id <> auth.uid() then
      perform public.wt_notify(
        v_ticket.reporter_id, v_ticket.id, 'İş İsteğiniz Kapatıldı',
        v_ticket.ticket_number || ' numaralı iş isteğiniz onaylanarak kapatılmıştır.'
      );
    end if;

    -- Her iş kapatıldığında 15 günü doldurmuş eski kapalı iş fotoğraflarını otomatik temizle
    perform public.rpc_purge_expired_closed_photos(15);
  end if;

  return v_ticket;
end;
$$;

-- 5. Eğer pg_cron eklentisi aktifse her gece 03:30'da otomatik çalıştır
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'purge-closed-ticket-photos-15d',
      '30 3 * * *',
      'select public.rpc_purge_expired_closed_photos(15);'
    );
  end if;
exception
  when others then
    -- pg_cron kurulu değilse rpc_manager_close_ticket ve uygulama içi tetikleyici kullanılır
    null;
end $$;

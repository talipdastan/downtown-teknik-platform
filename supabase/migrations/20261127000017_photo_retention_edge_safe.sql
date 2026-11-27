-- =====================================================================
-- MIGRATION: 20261127000017_photo_retention_edge_safe.sql
-- PROJECT: Downtown Teknik – Faz 1 Güvenlik & Fotoğraf Temizliği Düzeltmesi
-- DESCRIPTION:
--   1. `rpc_manager_close_ticket` içindeki senkron `rpc_purge_expired_closed_photos(15)`
--      çağrısı kaldırılır (15. günden sonra storage.objects koruma tetikleyicisinin
--      iş kapatmayı kilitleme riski tamamen giderilir).
--   2. `rpc_purge_expired_closed_photos` fonksiyonundan `authenticated` yetkisi
--      geri alınır (yalnızca `service_role`), doğrudan `storage.objects` SQL DELETE
--      kaldırılır ve en az 15 gün alt sınırı zorlanır.
--   3. Resmi Storage API (`purge-expired-photos` Edge Function) tarafından kullanılmak
--      üzere yalnızca `service_role` yetkili `rpc_list_expired_closed_attachments` ve
--      `rpc_delete_purged_attachment_rows` fonksiyonları eklenir.
--   4. Kapanan işlerin tarih sorguları ve 15 günlük fotoğraf temizliği için kısmi
--      `idx_tickets_closed_status_at` indeksi eklenir.
--   5. Eski doğrudan-SQL `pg_cron` görevi varsa güvenli şekilde kaldırılır.
-- =====================================================================

-- 1. Kapanan/iptal edilen işler için kısmi performans indeksi
create index if not exists idx_tickets_closed_status_at
  on public.tickets (status, closed_at)
  where status in ('closed', 'cancelled');

-- 2. `rpc_manager_close_ticket`: iş kapatma kritik yolundan fotoğraf temizliği ayrılır
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
  end if;

  return v_ticket;
end;
$$;

-- 3. Eski `rpc_purge_expired_closed_photos` fonksiyonunu kilitle ve doğrudan storage.objects silmesini kaldır
create or replace function public.rpc_purge_expired_closed_photos(
  p_retention_days int default 15
)
returns int
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Doğrudan storage.objects SQL DELETE Supabase Storage mimarisinde yasaktır.
  -- Fiziksel silme işlemi `purge-expired-photos` Edge Function (Storage remove API)
  -- üzerinden yürütülmelidir.
  raise exception 'Doğrudan SQL fotoğraf temizliği devre dışıdır. purge-expired-photos Edge Function kullanın.';
end;
$$;

revoke all on function public.rpc_purge_expired_closed_photos(int) from public, anon, authenticated;
grant execute on function public.rpc_purge_expired_closed_photos(int) to service_role;

-- 4. Edge Function için süresi dolmuş kapalı iş eklerini listeleme RPC'si (yalnızca service_role)
-- Kapsam: YALNIZCA closed/cancelled iş istekleri ve bunlara bağlı iş emirlerinin
-- `public.attachments` (`work-attachments` bucket) fotoğrafları.
-- `energy-documents` bucket'ına, `tickets`, `work_orders`, `comments`, `status_history`
-- ve `work_order_materials` tablolarına kesinlikle dokunulmaz.
create or replace function public.rpc_list_expired_closed_attachments(
  p_retention_days int default 15,
  p_batch_limit int default 100
)
returns table (
  attachment_id uuid,
  file_path text,
  ticket_id uuid,
  work_order_id uuid,
  closed_ref_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with params as (
    select
      now() - make_interval(days => greatest(15, coalesce(p_retention_days, 15))) as cutoff,
      least(greatest(coalesce(p_batch_limit, 100), 1), 200) as max_rows
  ),
  expired_tickets as (
    select
      t.id as ticket_id,
      coalesce(t.closed_at, t.resolved_at, t.updated_at, t.created_at) as closed_ref_at
    from public.tickets t, params p
    where t.status in ('closed', 'cancelled')
      and coalesce(t.closed_at, t.resolved_at, t.updated_at, t.created_at) < p.cutoff
  ),
  expired_work_orders as (
    select
      wo.id as work_order_id,
      coalesce(t.closed_at, wo.completed_at, t.updated_at, t.created_at) as closed_ref_at
    from public.work_orders wo
    join public.tickets t on t.id = wo.ticket_id, params p
    where t.status in ('closed', 'cancelled')
      and coalesce(t.closed_at, wo.completed_at, t.updated_at, t.created_at) < p.cutoff
  ),
  candidates as (
    select
      a.id as attachment_id,
      a.file_path,
      a.ticket_id,
      a.work_order_id,
      et.closed_ref_at
    from public.attachments a
    join expired_tickets et on et.ticket_id = a.ticket_id
    union all
    select
      a.id as attachment_id,
      a.file_path,
      a.ticket_id,
      a.work_order_id,
      ewo.closed_ref_at
    from public.attachments a
    join expired_work_orders ewo on ewo.work_order_id = a.work_order_id
  )
  select
    c.attachment_id,
    c.file_path,
    c.ticket_id,
    c.work_order_id,
    c.closed_ref_at
  from candidates c
  order by c.closed_ref_at asc, c.attachment_id asc
  limit (select max_rows from params);
$$;

revoke all on function public.rpc_list_expired_closed_attachments(int, int) from public, anon, authenticated;
grant execute on function public.rpc_list_expired_closed_attachments(int, int) to service_role;

-- 5. Storage API'den başarıyla silinmiş attachment satırlarını silen RPC (yalnızca service_role)
create or replace function public.rpc_delete_purged_attachment_rows(
  p_attachment_ids uuid[]
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted int := 0;
begin
  if p_attachment_ids is null or array_length(p_attachment_ids, 1) is null then
    return 0;
  end if;

  delete from public.attachments
  where id = any(p_attachment_ids);

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.rpc_delete_purged_attachment_rows(uuid[]) from public, anon, authenticated;
grant execute on function public.rpc_delete_purged_attachment_rows(uuid[]) to service_role;

-- 6. Eski doğrudan-SQL pg_cron görevi varsa temizle
do $$
declare
  v_job_id bigint;
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    select jobid into v_job_id
    from cron.job
    where jobname = 'purge-closed-ticket-photos-15d'
    limit 1;

    if v_job_id is not null then
      perform cron.unschedule(v_job_id);
    end if;
  end if;
exception
  when others then
    null;
end $$;

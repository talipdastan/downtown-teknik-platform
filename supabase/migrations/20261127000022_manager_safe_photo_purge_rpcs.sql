-- =====================================================================
-- MIGRATION: 20261127000022_manager_safe_photo_purge_rpcs.sql
-- PROJECT: Downtown Teknik – Yönetici Güvenli 15 Günlük Fotoğraf Temizliği
-- DESCRIPTION:
--   Web paneldeki "15 Günlük Fotoğraf Temizliği" butonunun:
--   1. Yalnızca `wt_can_manage()` yetkisine sahip yöneticilerce çalışmasını,
--   2. En az 15 gün tabanını korumasını,
--   3. Doğrudan SQL `DELETE FROM storage.objects` yerine RESMİ Supabase Storage
--      API (`storage.from('work-attachments').remove(paths)`) ile fiziksel dosyaları
--      temizleyip ardından yalnızca doğrulanan satırları `public.attachments`'tan
--      silmesini sağlar.
-- =====================================================================

-- 1. Storage DELETE politikasına `wt_can_manage()` ekle (resmi Storage remove API için)
drop policy if exists "wt delete attachments storage" on storage.objects;
create policy "wt delete attachments storage" on storage.objects
for delete to authenticated
using (
  bucket_id = 'work-attachments'
  and (
    public.has_module_permission('work_tracking', 'delete')
    or public.wt_can_manage()
    or auth.uid()::text = (storage.foldername(name))[1]
  )
);

-- 2. Yönetici yetkili: 15+ gün geçmiş kapalı iş fotoğraflarını listele
create or replace function public.rpc_manager_list_expired_closed_attachments(
  p_retention_days int default 15,
  p_batch_limit int default 100
)
returns table (
  attachment_id uuid,
  file_path text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.wt_can_manage() then
    raise exception 'Erişim engellendi: Fotoğraf arşiv temizliği yalnızca yöneticiler içindir.';
  end if;

  return query
  select distinct
    r.attachment_id,
    r.file_path
  from public.rpc_list_expired_closed_attachments(
    greatest(15, coalesce(p_retention_days, 15)),
    least(greatest(coalesce(p_batch_limit, 100), 1), 200)
  ) r;
end;
$$;

revoke all on function public.rpc_manager_list_expired_closed_attachments(int, int) from public, anon;
grant execute on function public.rpc_manager_list_expired_closed_attachments(int, int) to authenticated;

-- 3. Yönetici yetkili: Storage'dan silinmiş 15+ günlük kapalı iş eklerinin DB satırını temizle
create or replace function public.rpc_manager_confirm_purged_attachments(
  p_attachment_ids uuid[]
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted int := 0;
  v_cutoff timestamptz := now() - interval '15 days';
begin
  if auth.uid() is null or not public.wt_can_manage() then
    raise exception 'Erişim engellendi: Fotoğraf arşiv temizliği yalnızca yöneticiler içindir.';
  end if;

  if p_attachment_ids is null or array_length(p_attachment_ids, 1) is null then
    return 0;
  end if;

  with eligible as (
    select a.id
    from public.attachments a
    left join public.tickets t on t.id = a.ticket_id
    left join public.work_orders wo on wo.id = a.work_order_id
    left join public.tickets wt on wt.id = wo.ticket_id
    where a.id = any(p_attachment_ids)
      and (
        (
          t.id is not null
          and t.status in ('closed', 'cancelled')
          and coalesce(t.closed_at, t.resolved_at, t.updated_at, t.created_at) < v_cutoff
        )
        or (
          wt.id is not null
          and wt.status in ('closed', 'cancelled')
          and coalesce(wt.closed_at, wo.completed_at, wt.updated_at, wt.created_at) < v_cutoff
        )
      )
  )
  delete from public.attachments a
  using eligible e
  where a.id = e.id;

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.rpc_manager_confirm_purged_attachments(uuid[]) from public, anon;
grant execute on function public.rpc_manager_confirm_purged_attachments(uuid[]) to authenticated;

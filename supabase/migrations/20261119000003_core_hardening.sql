-- =====================================================================
-- MIGRATION: 20261119000003_core_hardening.sql
-- DESCRIPTION: Çekirdek sertleştirmeleri
--   1) Kat silinince mahallerin silinmesi (mevcut AVM TECH davranışı)
--   2) notifications: kullanıcı yalnızca is_read alanını güncelleyebilir
--   3) Realtime yayını (notifications)
--   4) Yeni kayıt olan personel için yönetici bildirimi
-- =====================================================================

-- 1) Kat -> Mahal silme davranışı (legacy: ON DELETE CASCADE)
alter table public.locations
  drop constraint if exists locations_floor_id_fkey,
  add constraint locations_floor_id_fkey
    foreign key (floor_id) references public.floors(id) on delete cascade;

-- 2) Bildirim güncelleme sınırı
revoke update on public.notifications from authenticated;
grant update (is_read) on public.notifications to authenticated;

-- 3) Realtime
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'notifications'
     ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

-- 4) Yeni kayıt -> yöneticilere bildirim
create or replace function public.notify_managers_on_new_signup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid;
begin
  if new.approval_status = 'pending' then
    for v_admin_id in
      select p.id
      from public.profiles p
      where p.approval_status = 'approved'
        and p.role in ('technical_manager', 'system_admin')
        and p.id <> new.id
    loop
      insert into public.notifications (user_id, module_key, entity_type, entity_id, title, message)
      values (
        v_admin_id, 'system', 'profile', new.id,
        'Onay Bekleyen Yeni Personel',
        new.full_name || ' sisteme kayıt oldu ve yönetici onayı bekliyor.'
      );
    end loop;
  end if;
  return new;
end;
$$;

drop trigger if exists profile_created_notification_trigger on public.profiles;
create trigger profile_created_notification_trigger
after insert on public.profiles
for each row execute function public.notify_managers_on_new_signup();

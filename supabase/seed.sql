-- =====================================================================
-- SEED: supabase/seed.sql
-- PROJECT: AVM TECH – Modüler Teknik Operasyon Platformu
-- DESCRIPTION: Merkezi modül kayıtları, başlangıç departmanları ve katlar.
-- =====================================================================

-- 1. Sistem Modülleri (İlk sürümde Enerji Takip & İş Takip aktif)
insert into public.system_modules (key, name, description, icon, route_prefix, is_enabled, is_coming_soon, sort_order)
values
  ('energy', 'Enerji Takip', 'Sayaçlar, okumalar, faturalar, bütçe ve enerji raporları', 'bolt', '/energy', true, false, 1),
  ('work_tracking', 'İş Takip', 'Arıza, iş emirleri, teknisyenler, fotoğraflar ve onaylar', 'build', '/work-tracking', true, false, 2),
  ('maintenance', 'Planlı Bakım', 'Periyodik bakım, bakım takvimi ve kontrol listeleri', 'event_repeat', '/maintenance', false, true, 3),
  ('assets', 'Demirbaş & Ekipman', 'Ekipman envanteri, garanti ve teknik geçmiş', 'inventory_2', '/assets', false, true, 4),
  ('documents', 'Teknik Dokümanlar', 'Projeler, tek hat şemaları, kılavuzlar ve muayene raporları', 'description', '/documents', false, true, 5),
  ('bms', 'Otomasyon & BMS', 'Bina yönetim sistemi alarmları ve eşik takibi', 'sensors', '/bms', false, true, 6)
on conflict (key) do update set
  name = excluded.name,
  description = excluded.description,
  icon = excluded.icon,
  route_prefix = excluded.route_prefix,
  sort_order = excluded.sort_order;

-- 2. Temel Departmanlar
insert into public.departments (name, description)
values
  ('Elektrik', 'Alçak/Orta gerilim, aydınlatma, jeneratör ve panolar'),
  ('Mekanik & HVAC', 'Soğutma grupları, kazan, havalandırma ve sıhhi tesisat'),
  ('İnşaat & Yapı', 'Zemin, tavan, boya, kapı ve genel yapı bakım'),
  ('Asansör & Yürüyen Merdiven', 'Dikey ulaşım sistemleri'),
  ('Yangın & Güvenlik Sistemleri', 'Sprinkler, algılama ve acil anons sistemleri'),
  ('Teknik Yönetim', 'AVM teknik müdürlük ve operasyon koordinasyonu'),
  ('Güvenlik', 'AVM saha güvenlik birimi'),
  ('Temizlik', 'AVM ortak alan temizlik birimi'),
  ('Danışma & İdari', 'Danışma ve AVM yönetim ofisi')
on conflict (name) do nothing;

-- 3. Temel Katlar
insert into public.floors (name, sort_order)
values
  ('Kat -2 (Otopark / Teknik)', -2),
  ('Kat -1 (Otopark / Teknik)', -1),
  ('Zemin Kat', 0),
  ('1. Kat', 1),
  ('2. Kat', 2),
  ('Çatı / Teras (Teknik)', 3)
on conflict (name) do nothing;

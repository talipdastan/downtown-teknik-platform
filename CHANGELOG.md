# AVM TECH – DEĞİŞİKLİK GÜNLÜĞÜ (`CHANGELOG.md`)

Tüm önemli mimari kararlar, aşama teslimatları ve sürüm değişiklikleri bu dosyada kayıt altına alınır.

---

## [1.0.0-live] – 2026-11-19 (Canlı Supabase Ortam Kurulumu ve Firebase Veri Aktarımı)

### Gerçekleştirilenler
- **Web & Mobil Canlı Ortam Yapılandırması (`scripts/configure_env.mjs`):** `apps/web/.env.local` ve `apps/mobile/dart_defines.json` yeni Supabase projesine (`urahnnrofnkbssxftuyz.supabase.co`) bağlandı.
- **Salt-Okunur Firestore Yedekleme (`export_firestore.mjs`):** `sayac-takip-avm-2026` projesinden **9 kullanıcı, 13 sayaç, 1.617 okuma, 76 fatura, 35 bütçe** kaydı salt-okunur JSON snapshot (`backups/firestore_export_20261119175145..json`) olarak yedeklendi.
- **Canlı Supabase Aktarımı ve 7/7 Doğrulama (`transform_and_import.mjs` & `verify_migration.mjs`):**
  - 13 sayaç, 1.617 okuma (`1.329.866,28` toplam tüketim), 76 fatura (`22.037.201,26 TL`) ve 35 bütçe (`34.381.309 TL`) canlı veritabanına tek transaction içinde `UPSERT` edildi; tüm tarihsel `entered_by_name` sahipleri ve zaman damgaları korundu.
  - Canlı Supabase üzerinde **7 / 7 bütünlük doğrulaması** (`meter_count`, `reading_count_per_meter`, `consumption_sum_per_meter`, `date_range_per_meter`, `invoices_by_year_and_type`, `budgets_by_year_and_type`, `user_mapping_and_ownership`) %100 geçti (`errors: []`).

---

## [1.0.0] – 2026-11-19 (Aşama 7 – Yeni Modüllere Hazırlık Doğrulaması & Teslimat Sürümü)

### Eklenenler
- **Genişletilebilirlik & Ortak Ekipman 360° Migration'ı (`supabase/migrations/20261119000007_extensibility_and_equipment_360.sql`):**
  - Örnek gelecek modül iskeleti `public.maintenance_plans` (`equipments` ve `departments` çekirdek tablolarına bağlı, merkezi `has_module_permission('maintenance', ...)` RLS politikalarıyla korumalı).
  - Tek `equipment_id` üzerinden bağlı sayaç okumaları, arızalar, açık iş emirleri ve planlı bakımları çağıranın RLS yetkisine göre döndüren `public.rpc_get_equipment_360_summary` (`SECURITY INVOKER`).
- **Mobil İskelet Modül ve Çekirdek Kayıt (`apps/mobile` → `1.0.0+1`):**
  - `apps/mobile/lib/features/maintenance/maintenance_module.dart`: `AppModule` sözleşmesini uygulayan, `core/equipment/equipmentOptionsProvider` ortak altyapısını kullanan bağımsız `MaintenanceModule`.
  - `apps/mobile/lib/core/modules/module_registry.dart`: `MaintenanceModule()` kaydı (varsayılan `isComingSoon: true`, çekirdek router veya mevcut modüllere dokunmadan aktif edilebilir).
- **Uçtan Uca Genişletilebilirlik & İzolasyon Testleri:**
  - `supabase/tests/sql/run_sql_tests.mjs`: `maintenance` modülünün dinamik aktifleştirilmesi, RLS matrisi ve `CHL-01` ortak ekipman üzerinde sayaç + arıza + bakım 360° özet doğrulaması.
  - `apps/mobile/test/core_permissions_and_modules_test.dart`: `MaintenanceModule` rota/guard/bildirim testi ve `energy` / `work_tracking` / `maintenance` klasörleri arasında sıfır doğrudan çapraz import taraması.
  - `apps/web/tests/permissions_and_modules.test.mjs`: `maintenance` modülünün web kayıt/yetki akışıyla otomatik aktifleşme testi (`apps/web` → `1.0.0`).

### Doğrulama
- `node --test run_sql_tests.mjs`: **37 / 37** test geçti.
- `flutter analyze`: **No issues found!**
- `flutter test`: **26 / 26** test geçti.
- `npm test` (`apps/web`): **10 / 10** test geçti.
- `npm run build` (`apps/web` `1.0.0`): **21 / 21** statik sayfa hatasız derlendi.

---

## [0.6.0] – 2026-11-19 (Aşama 6 – Test, Güvenlik ve Performans Optimizasyonu)

### Eklenenler
- **Veritabanı Güvenlik, Offline RPC ve Performans Migration'ı (`supabase/migrations/20261119000006_security_and_performance.sql`):**
  - `DATABASE.md` Bölüm 7 ile uyumlu tüm bileşik performans indeksleri (`profiles`, `notifications`, `equipments`, `tickets`, `work_orders`, `meter_readings`, `energy_invoices`).
  - Idempotent arıza ve önceden yüklenmiş fotoğraf eklerini tek transaction içinde bağlayan `public.rpc_sync_offline_ticket`.
  - Güncelleme zaman damgası (`p_base_updated_at`) karşılaştırmalı çakışma tespiti ve `p_force_overwrite` destekli `public.rpc_sync_offline_work_order_status`.
  - Sunucu taraflı sayfalamalı ve `SECURITY INVOKER` (RLS korumalı) `rpc_list_tickets_paginated`, `rpc_list_meter_readings_paginated` ve `rpc_list_energy_invoices_paginated` RPC'leri.
- **Mobil Offline Senkronizasyon Motoru, Sıkıştırma ve Sayfalama (`apps/mobile` → `0.6.0+1`):**
  - `OfflineSyncEngine`, `OfflineQueueStorage` (`InMemoryOfflineQueueStorage`, `JsonFileOfflineQueueStorage`) ve `offlineSyncEngineProvider` (`lib/core/database/`): 2 aşamalı medya + kayıt senkronizasyonu, üstel geri çekilme (`10sn → 30dk`), kalıcı 400/403 hatada otomatik deneme durdurma, manuel `retryManual` ve çakışma çözümü (`keepServer`, `reapplyLocal`).
  - `PhotoCompressionPolicy` (`1600x1600px`, `%80` JPEG kalitesi) ve paylaşılan `PaginatedResult<T>` (`clampPageLimit(1..100)`) ile `paginatedTicketsProvider`, `paginatedMeterReadingsProvider`, `paginatedInvoicesProvider`.
- **Kapsamlı Güvenlik, Offline ve Performans Testleri:**
  - `supabase/tests/sql/run_sql_tests.mjs`: `disabled`/`rejected` hesaplar, bağımsız özel yetki override matrisi, `energy-documents` Storage RLS, offline ticket/çakışma RPC'leri ve `pg_indexes` + sayfalama testleri.
  - `apps/mobile/test/core_permissions_and_modules_test.dart` ve `apps/web/tests/permissions_and_modules.test.mjs`: 2 aşamalı medya kurtarma, çakışma stratejileri, kalıcı kuyruk ve 5 rol × 8 izin matrisi + `core_actions` testleri.

### Doğrulama
- `node --test run_sql_tests.mjs`: **35 / 35** test geçti.
- `flutter analyze`: **No issues found!**
- `flutter test`: **24 / 24** test geçti.
- `npm test` (`apps/web`): **9 / 9** test geçti.
- `npm run build` (`apps/web` `0.6.0`): **21 / 21** statik sayfa hatasız derlendi.

---

## [0.5.0] – 2026-11-19 (Aşama 5 – Firebase → Supabase Veri Aktarımı ve Doğrulama Altyapısı)

### Eklenenler
- **Salt-Okunur Firestore Yedekleme (`scripts/migration/export_firestore.mjs`):** `sayac-takip-avm-2026` projesinden `datastore.readonly` + yalnızca HTTP `GET` ile `users`, `meters`, `meters/{id}/readings`, `invoices` ve `budgets` koleksiyonlarını zaman damgalı JSON snapshot + özet metrik dosyası + `user_mapping.generated.json` taslağına döken araç (`--inspect` yerel özet modu dahil).
- **Kullanıcı Eşleştirme Şablonu (`scripts/migration/user_mapping.template.json`):** `legacy_firebase_uid`, `@sayacavm.com` suffix'li e-postalar ve tarihsel `enteredBy` takma adlarını `profiles.id` ile eşleyen şablon.
- **İdempotent Aktarım Motoru (`scripts/migration/transform_and_import.mjs`):** `mapLegacyUserPermissions`, `inferLegacyCategory`, `prepareMigrationPlan` ve tek transaction içinde FK sırasıyla (`profiles` → `meters` → `meter_readings` → `energy_invoices` → `energy_budgets`) `UPSERT` yapan `runMigrationWithDb`. Mevcut `work_tracking` ve `core_actions` izinlerini ezmeden `permissions.modules.energy` altında birleştirir; silinmiş kullanıcıların `entered_by_name` sahipliğini ve orijinal zaman damgalarını korur.
- **7 Adımlı Veri Bütünlüğü ve RLS Doğrulama (`scripts/migration/verify_migration.mjs`):** Sayaç sayısı, sayaç bazlı okuma sayısı, `< 0.001` tüketim toplamı, MIN/MAX okuma tarihleri, yıl ve tür bazlı fatura/ceza/kiracı ve bütçe toplamları (`< 0.01 TL`), kullanıcı sahipliği ve Supabase RLS erişim kontrollerini otomatik denetler.
- **Staging Uçtan Uca Testleri (`supabase/tests/sql/run_sql_tests.mjs`):** Aşama 5 için çift çalıştırma (idempotency) ve 7/7 doğrulama testleri eklendi.

### Doğrulama
- `node --test run_sql_tests.mjs`: 31 / 31 test geçti (Aşama 2 + Aşama 3 + Aşama 4 + Aşama 5 staging aktarım & doğrulama).
- `flutter analyze`: 0 sorun; `flutter test`: 19 / 19 test geçti.
- `npm test` (web): 8 / 8 test geçti; `npm run build` (web): 21 / 21 sayfa hatasız derlendi.
- CLI dry-run (`export_firestore.mjs --inspect` & `transform_and_import.mjs --dry-run`): başarıyla doğrulandı.

---

## [0.4.0] – 2026-11-19 (Aşama 4 – Enerji Takip Modülü `energy` Entegrasyonu)

### Supabase Veritabanı ve Edge Function (`supabase/`)
- `20261119000005_energy_tracking.sql`: `meters`, `meter_readings`, `energy_invoices`, `energy_budgets` tabloları, ortak `equipments(id)` bağlantısı, performans indeksleri, `has_module_permission('energy', ...)` RLS politikaları, `rpc_setup_default_meters`, `rpc_record_meter_reading` (önceki okuma kontrolü, çarpan hesabı, aynı gün doğrulaması, `client_mutation_id` idempotency, reaktif ceza bildirimi), `rpc_energy_dashboard_summary` ve `energy-documents` private Storage bucket'ı eklendi.
- `supabase/functions/parse-energy-document/index.ts`: `GEMINI_API_KEY` sunucu tarafında tutulan ve `energy.manage` yetkisi doğrulayan PDF fatura ve PDF bütçe analiz Edge Function'ı oluşturuldu.
- `supabase/tests/sql/run_sql_tests.mjs`: PGlite üzerinde 29/29 SQL/RLS/RPC testi geçti.

### Flutter Mobil (`apps/mobile/`)
- `features/energy/` modülü `EnergyModule` (`ModuleRegistry`) üzerinden bağlandı: Enerji Özeti (`rpc_energy_dashboard_summary` + reaktif ceza uyarıları), Elektrik & Mekanik Sayaç Listeleri (arama, sürükle-bırak sıralama, ortak ekipman seçimi, çarpan düzenleme), Okuma Girişi (`rpc_record_meter_reading` + aynı gün onay penceresi), Sayaç Detayı (okuma geçmişi, silme, Excel indirme) ve 4 sekmeli Faturalar & Bütçe ekranı (Tablo, PDF Analiz + Çakışma Çözümü, Sayaç Kimlik/Ekipman Eşleştirme, Excel/CSV/PDF Bütçe Aktarımı).
- `features/energy/` içinde `features/work_tracking/` importu yok.
- Doğrulama: `flutter analyze` (0 sorun), `flutter test` (19/19 geçti).

### Next.js Web Yönetim Paneli (`apps/web/`)
- `/energy` (Özet & Reaktif Monitör + Varsayılan Kurulum), `/energy/meters` (Sayaç & EIC/Tekil/Ekipman Yönetimi), `/energy/readings` (Sayfalanmış Okuma Geçmişi, Veri Girişi & CSV/Excel), `/energy/invoices` (Faturalar & Gemini Edge Function PDF Analizi) ve `/energy/budgets` (Bütçe & Geçmiş Yıl Karşılaştırma) sayfaları eklendi.
- Doğrulama: `npm test` (8/8 geçti), `npm run build` (21/21 sayfa derlendi).

---

## [0.3.0] – 2026-11-19 (Aşama 3 – İş Takip Modülü `work_tracking` Entegrasyonu)

### Supabase Veritabanı ve Edge Function (`supabase/`)
- `20261119000003_core_hardening.sql`: `locations.floor_id` cascade silme davranışı, `notifications` yalnızca `is_read` güncelleme kısıtı, Realtime yayını ve yeni kayıt yönetici bildirimi eklendi.
- `20261119000004_work_tracking.sql`: `categories`, `tickets`, `work_orders`, `work_order_assignments`, `comments`, `attachments`, `status_history`, `work_order_materials` tabloları, `equipment_id` ortak ekipman bağlantısı, `AVM-YYYY-XXXXXX` otomatik numara, 3 onay bekleyen kayıt limiti, mahal/kategori silinince etiket koruma tetikleyicileri, merkezi `has_module_permission('work_tracking', ...)` RLS politikaları, tüm iş emri/onay RPC'leri ve `work-attachments` Storage bucket politikaları eklendi.
- `supabase/functions/send-push-notification/index.ts`: Yeni merkezi `notifications` şemasına (`module_key`, `entity_type`, `entity_id`) uyumlu FCM HTTP v1 Edge Function eklendi.
- `supabase/tests/sql/run_sql_tests.mjs`: PGlite üzerinde 23/23 gerçek PostgreSQL/RLS/RPC testi geçti.

### Flutter Mobil (`apps/mobile/`)
- `features/work_tracking/` modülü `WorkTrackingModule` (`ModuleRegistry`) üzerinden bağlandı: Arıza Listesi, Yeni Arıza Bildirimi (opsiyonel `equipments` seçici + "Diğer" giriş + 5 fotoğrafa kadar ekleme), Arıza Detayı (ekipman bilgisi, durum geçmişi, notlar, onay/iade), Bana Atanan İşler, Teknisyen İş Emri Detayı (başlat/beklet/malzeme/önce-sonra fotoğraf/tamamla) ve Yönetici İş Emirleri (atama/onay).
- `WorkTrackingAccess` ile eski menü/aksiyon kontrolleri merkezi 8 bağımsız modül iznine eşlendi; `/notifications` ekranı ve `AppModule.notificationRoute` bildirim yönlendirmesi eklendi.
- Doğrulama: `flutter analyze` (0 sorun), `flutter test` (14/14 test geçti), `features/work_tracking` içinde `features/energy` importu yok.

### Next.js Web Yönetim Paneli (`apps/web/`)
- `/work-tracking` (Genel Bakış), `/work-tracking/tickets` (Sayfalanmış Arıza Kayıtları + Yeni Arıza + Ekipman + Onay/İade), `/work-tracking/work-orders` (İş Emri Oluşturma & Teknisyen Atama), `/work-tracking/review` (Çözüm Onay & İade), `/work-tracking/reports` (Departman performans özeti, CSV/Excel dışa aktarma, PDF yazdırma) ve `/admin/definitions` (Departman/Kat/Mahal/Kategori yönetimi) sayfaları eklendi.
- Doğrulama: `npm test` (6/6 test geçti), `npm run build` (17/17 sayfa başarıyla derlendi).

---

## [0.2.0] – 2026-11-19 (Aşama 1 Revizyonları + Aşama 2 – Çekirdek Platform İskeleti)

### Dokümantasyon Revizyonları (7 Madde)
- Sade ve genişletilebilir `ModuleRegistry` prensibi, merkezi `equipments` kayıt sistemi, Drift offline senkronizasyon durum makinesi (kuyruk, retry, çakışma, fotoğraf), 8 bağımsız yetki (`approve` dahil), performans indeksleme/sayfalama, ortak altyapı yeniden kullanımı ve veri güvenliği kuralları `p.md`, `ARCHITECTURE.md`, `DATABASE.md`, `MODULES.md`, `PERMISSIONS.md` ve `DEVELOPMENT.md` dosyalarına işlendi.

### Supabase Çekirdek Altyapısı (`supabase/`)
- `20261119000001_core_schema.sql`: `departments`, `floors`, `locations`, `custom_roles`, `profiles`, `system_modules`, `equipments`, `notifications` tabloları, bileşik indeksler ve `on_auth_user_created` Gatekeeper tetikleyicisi.
- `20261119000002_core_auth_and_permissions.sql`: 8 bağımsız modül izni (`has_module_permission`), çekirdek aksiyonlar (`has_core_action`), tüm çekirdek tablolarda RLS ve güvenli RPC'ler (`rpc_resolve_login_email`, `rpc_approve_user`, `rpc_update_user_permissions`, `rpc_get_my_modules`, `rpc_toggle_system_module`).
- `seed.sql`, `create_initial_admin.sql` ve `core_rls_security_tests.sql` oluşturuldu.

### Flutter Mobil Çekirdek (`apps/mobile/`)
- Riverpod, GoRouter, kurumsal Material 3 teması, 8 bağımsız yetki modeli (`ProfileModel`), `EquipmentModel`, `OfflineRetryPolicy` & kuyruk modelleri, sade `ModuleRegistry`, Auth/Gatekeeper ekranları (`Login`, `Register`, `PendingApproval`), `ModuleLauncherScreen` (Modül Seçim Ekranı) ve `EnergyModule` / `WorkTrackingModule` kayıt iskeletleri eklendi.
- Doğrulama: `flutter analyze` (0 sorun), `flutter test` (9/9 test geçti).

### Next.js Web Yönetim Paneli (`apps/web/`)
- App Router, Tailwind kurumsal tema, `permissions.ts`, `moduleRegistry.ts`, Login/Pending sayfaları, dinamik Sidebar, Modül Seçim Ekranı (`/home`) ve Çekirdek Yönetim sayfaları (`/admin/users`, `/admin/modules`, `/admin/equipments`) oluşturuldu.
- Doğrulama: `npm run build` (hatasız üretim derlemesi), `npm test` (4/4 test geçti).

---

## [0.1.0-docs] – 2026-11-19 (Aşama 1 – Analiz ve Dokümantasyon)

### İncelenen Mevcut Projeler (Salt-Okunur)
- `sayac_takip_app`: Flutter mobil sayaç, okuma, reaktif ceza bildirimi, Gemini PDF fatura analizi, bütçe karşılaştırma ve Excel servisleri analiz edildi.
- `TEKNİK İŞ İSTEK (AVM TECH)`: Flutter mobil + Next.js web paneli + Supabase 17 SQL migration, RLS, RPC, FCM Edge Function ve `permissions` JSONB altyapısı analiz edildi.

### Oluşturulan Mimari ve Planlama Dokümanları
- `p.md`: 7 aşamalı ana proje planı ve ilerleme takip listesi oluşturuldu.
- `ARCHITECTURE.md`: Modüler monorepo, Core/Feature izolasyonu, offline Drift kuyruğu, Edge Function güvenliği ve navigasyon mimarisi tanımlandı.
- `DATABASE.md`: Çekirdek (`system_modules`, `equipments`, `profiles`), İş Takip ve Enerji Takip PostgreSQL şemaları, Storage bucket'ları, RLS ve performans RPC'leri tasarlandı.
- `MODULES.md`: Merkezi `ModuleRegistry` sözleşmesi, aktif modüller (`energy`, `work_tracking`) ve gelecek modüller (`maintenance`, `assets`, `documents`, `bms`, `energy_analytics`, `procurement`) tanımlandı.
- `PERMISSIONS.md`: 5 temel rol + modül bazlı 7 granüler izin + özel aksiyon matrisi ve eski `sayac_takip_app` izin eşleştirmesi belgelendi.
- `MIGRATION.md`: Firebase/Firestore → Supabase 5 fazlı yedekleme, kullanıcı eşleştirme, idempotent aktarım, doğrulama ve geri dönüş planı hazırlandı.
- `DEVELOPMENT.md`: Monorepo klasör yapısı, paket uyumluluk politikası, yeni modül ekleme rehberi ve aşama geçiş test kuralları belirlendi.
- `CHANGELOG.md`: Sürüm takip dosyası başlatıldı.

### Not
- Mevcut iki projede hiçbir dosya değiştirilmedi.
- Uygulama kodlamasına henüz başlanmadı; Aşama 2 için kullanıcı onayı bekleniyor.

# AVM TECH – MODÜLER TEKNİK OPERASYON PLATFORMU
## Ana Proje Planı (`p.md`)

> **Durum:** Aşama 7 – Yeni Modüllere Hazırlık Doğrulaması ve Teslimat *(Tamamlandı — Canlı Supabase / Firebase Kurulum ve Geçiş Adımları İçin Hazır)*  
> **Sürüm:** `v1.0.0`  
> **Mimari Tercih:** Seçenek A – Tek Kullanıcı, Tek Giriş, Tek Veritabanı (Supabase + PostgreSQL)  
> **Kapsam:** Mevcut `sayac_takip_app` ve `TEKNİK İŞ İSTEK (AVM TECH)` projelerinin tüm işlevlerini koruyarak, gelecekte yeni modüller eklenebilecek bağımsız ve modüler tek bir kurumsal platformda birleştirmek.

---

## 1. Proje Vizyonu ve Hedefleri

**AVM TECH**, bir alışveriş merkezindeki tüm teknik operasyonların tek merkezden yönetilmesini sağlayan modüler bir platformdur. İlk sürümde iki aktif modül ile yayına alınır ve çekirdek mimarisi gelecekteki teknik modülleri ana uygulamayı değiştirmeden barındıracak şekilde tasarlanır:

1. **Enerji Takip Modülü (`energy`):** Mevcut `sayac_takip_app` uygulamasının tüm işlevleri (elektrik/mekanik sayaçlar, günlük/aylık okumalar, reaktif ceza uyarıları, Gemini destekli PDF fatura analizi, bütçe karşılaştırma, Excel içe/dışa aktarma, enerji raporları).
2. **İş Takip Modülü (`work_tracking`):** Mevcut `TEKNİK İŞ İSTEK (AVM TECH)` uygulamasının tüm işlevleri (arıza bildirimleri, iş emirleri, teknisyen atama, fotoğraf, malzeme kaydı, yönetici/bildirici onay akışı, bildirimler, raporlama, web yönetim paneli).
3. **Gelecek Modüllere Hazır Çekirdek:** Planlı Bakım (`maintenance`), Demirbaş & Ekipman Yönetimi (`assets`), Teknik Doküman Yönetimi (`documents`), Otomasyon/BMS (`bms`), Enerji Analiz (`energy_analytics`), Satın Alma & Malzeme (`procurement`).

### Temel İlkeler
- **Sıfır Müdahale Kuralı:** Mevcut iki projenin (`sayac_takip_app` ve `TEKNİK İŞ İSTEK`) dosyalarına, canlı veritabanlarına ve kullanıcı kayıtlarına kesinlikle dokunulmaz.
- **Sıfır Özellik Kaybı:** Her iki mevcut uygulamada çalışan hiçbir işlev yeni platforma taşınırken kaybedilmez.
- **Sade ve Genişletilebilir Modülerlik:** Enerji Takip modülünde yapılan bir değişiklik İş Takip modülünü etkilemez. `ModuleRegistry` gereksiz karmaşık dinamik eklenti/reflection sistemleri yerine sade, açık ve genişletilebilir bir kayıt listesi olarak tasarlanır.
- **Ortak Ekipman ve Çekirdek Yeniden Kullanımı:** Ekipman yönetimi (`equipments`), kullanıcılar, bildirimler ve raporlama altyapısı merkezidir. Gelecekte Planlı Bakım modülü eklendiğinde bu ortak altyapılar tekrar yazılmaz; enerji, arıza, bakım ve teknik dokümanlar aynı `equipment_id` üzerinden bağlanır.
- **Bağımsız Yetkilendirme & RLS:** Modül görüntüleme, kayıt görüntüleme, ekleme, düzenleme, silme, onaylama, raporlama ve yönetim yetkileri birbirinden bağımsızdır; hem arayüzde hem Supabase RLS hem de güvenli RPC katmanında uygulanır.
- **Offline Dayanıklılık:** Drift/SQLite üzerinde yerel kayıt kuyruğu, senkronizasyon durumu, tekrar deneme, çakışma çözümü ve fotoğraf senkronizasyonu standartlaştırılır.
- **Güvenlik ve Veri Koruması:** Gemini API anahtarı istemci koduna gömülmez (Supabase Edge Function kullanılır). Eski Firebase verileri aktarılmadan önce yedeklenir, kullanıcı eşleştirmeleri doğrulanır ve geçiş doğrulanana kadar eski canlı sistemler çalışmaya devam eder.

---

## 2. Teknoloji Yığını

| Katman | Teknoloji |
|---|---|
| **Mobil Uygulama** | Flutter 3.x (Dart 3.x, Material 3 Kurumsal Tema) |
| **Web Yönetim Paneli** | Next.js 14+ (App Router, TypeScript, Tailwind CSS) |
| **Backend & Veritabanı** | Supabase (PostgreSQL 15, Auth, Storage, Realtime, Edge Functions) |
| **Mobil Durum Yönetimi** | Riverpod (`flutter_riverpod`) |
| **Mobil Yönlendirme** | GoRouter (`go_router`) |
| **Offline Veri Katmanı** | Drift / SQLite |
| **Dosya & Fotoğraf** | Supabase Storage (Private Buckets + Signed URL) |
| **Bildirim Altyapısı** | Firebase Cloud Messaging (FCM) + Yerel Bildirimler |
| **Yetkilendirme** | Merkezi RBAC + Modül & İşlem İzinleri (`permissions` JSONB + PostgreSQL RLS) |

---

## 3. Geliştirme Aşamaları ve İlerleme Takibi

Her aşama tamamlandığında kod incelemesi, statik analiz, testler, veritabanı doğrulaması ve dokümantasyon güncellemesi yapılır. Bir aşamanın testleri geçmeden sonraki aşamaya geçilmez.

### Aşama 1 – Analiz ve Dokümantasyon
- [x] `sayac_takip_app` projesinin tam analizi (modeller, servisler, ekranlar, Firestore şeması, Gemini PDF/Excel akışları)
- [x] `TEKNİK İŞ İSTEK` projesinin tam analizi (Flutter, Next.js, 17 SQL migration, RLS, RPC, Edge Functions, yetki matrisi)
- [x] `p.md` (Ana Proje Planı) oluşturulması
- [x] `ARCHITECTURE.md` (Sistem Mimarisi) oluşturulması
- [x] `DATABASE.md` (Veritabanı & RLS Tasarımı) oluşturulması
- [x] `MODULES.md` (Modül Sistemi & Kayıt Mekanizması) oluşturulması
- [x] `PERMISSIONS.md` (Merkezi RBAC & Modül Yetkileri) oluşturulması
- [x] `MIGRATION.md` (Firebase → Supabase Veri Aktarım Planı) oluşturulması
- [x] `DEVELOPMENT.md` (Geliştirme, Klasör & Test Standartları) oluşturulması
- [x] `CHANGELOG.md` (Değişiklik Takibi) oluşturulması
- [x] **Kullanıcı onayı ve 7 revizyon maddesinin dokümanlara işlenmesi**

### Aşama 2 – Yeni Uygulamanın İskeleti (Çekirdek Platform)
Aşama 2 aşağıdaki 7 kontrollü adımda, her adım doğrulanarak tamamlandı:
- [x] **2.1 – Supabase çekirdek tabloları ve migration:** `departments`, `floors`, `locations`, `profiles`, `custom_roles`, `system_modules`, `equipments`, `notifications`, indeksler ve RLS/RPC güvenlik testleri
- [x] **2.2 – Kullanıcı girişi ve onay mekanizması:** Supabase Auth, `rpc_resolve_login_email` (e-posta / ad soyad / telefon), Gatekeeper (`pending` / `approved` / `rejected` / `disabled`), ilk admin scripti
- [x] **2.3 – Merkezi yetkilendirme:** 8 bağımsız yetki (`enabled`, `view`, `create`, `edit`, `delete`, `approve`, `reports`, `manage`), `has_module_permission` SQL fonksiyonu + RLS + Flutter & Next.js yetki yardımcıları
- [x] **2.4 – Modül kayıt sistemi:** Sade ve genişletilebilir `ModuleRegistry` + `system_modules` entegrasyonu (mobil & web)
- [x] **2.5 – Flutter ana ekranı:** `apps/mobile` iskeleti (Riverpod, GoRouter, Drift offline kuyruk şeması, kurumsal tema, Auth ekranları ve Modül Seçim Ekranı)
- [x] **2.6 – Next.js yönetim paneli:** `apps/web` iskeleti (Supabase SSR, Auth/Pending, Modül Seçim, Personel/Yetki/Modül/Ekipman/Tanım yönetim ekranları)
- [x] **2.7 – Mobil ve web testleri:** `flutter analyze` (0 sorun), `flutter test` (9/9 geçti), `npm run build` (başarılı), `npm test` (4/4 geçti) ve SQL/RLS test scripti hazırlandı

### Aşama 3 – İş Takip Modülü (`work_tracking`) Entegrasyonu
- [x] Supabase `work_tracking` tabloları (`categories`, `tickets`, `work_orders`, `work_order_assignments`, `work_order_materials`, `comments`, `attachments`, `status_history`) ve tetikleyiciler
- [x] `tickets` ve `work_orders` tablolarına opsiyonel `equipment_id` bağlantısı eklenmesi
- [x] Mevcut tüm RPC'lerin (`rpc_manager_close_ticket`, 3 onay bekleyen limit kuralı, özel mahal/kategori vb.) eksiksiz taşınması
- [x] Flutter `features/work_tracking/` modülünün `ModuleRegistry` üzerinden bağlanması (tüm ekranlar, fotoğraf yükleme, merkezi bildirim yönlendirmesi, FCM altyapısı, `client_mutation_id` & offline taslak hazırlığı)
- [x] Next.js Web Paneli İş Takip sayfalarının (`/work-tracking/*` ve `/admin/definitions`) entegrasyonu ve CSV/Excel/PDF raporlama
- [x] İş Takip uçtan uca ve RLS testlerinin doğrulanması (`PGlite` 23/23, `flutter test` 14/14, `flutter analyze` 0 sorun, `npm test` 6/6, `npm run build` 17 sayfa)

### Aşama 4 – Enerji Takip Modülü (`energy`) Entegrasyonu
- [x] Supabase `energy` tabloları (`meters`, `meter_readings`, `energy_invoices`, `energy_budgets`, `energy-documents` private bucket) ve RLS politikaları
- [x] `meters` tablosuna opsiyonel `equipment_id` bağlantısı eklenmesi
- [x] Supabase Edge Function: `parse-energy-document` (Gemini API anahtarı sunucu tarafında, PDF fatura ve PDF bütçe çıkarımı)
- [x] Flutter `features/energy/` modülünün `ModuleRegistry` üzerinden bağlanması:
  - Elektrik & Mekanik sayaç listesi, sıralama (`sort_order`), sayaç kimlik alanları (EIC, Tekil Kod, Sayaç No, Sözleşme No, Abone No)
  - Günlük/aylık okuma girişi, çarpan hesabı, reaktif güç ceza uyarıları (İndüktif >%20, Kapasitif >%15) ve yerel bildirimler
  - PDF fatura analizi, çakışma yönetimi (`merge`, `separate`, `overwrite`, `skip`), kiracı/ortak alan ayrımı
  - Bütçe içe aktarma (`.xlsx`, `.csv`, `.pdf`) ve geçmiş yıl karşılaştırmaları
  - Excel dışa aktarma (Elektrik, Mekanik, Tekil Sayaç, Fatura, Bütçe raporları)
  - Offline sayaç okuma kuyruğu hazırlığı (`client_mutation_id` idempotency + offline kuyruk modelleri; tam Drift SQLite senkronizasyon motoru Aşama 6'da test edilir)
- [x] Next.js Web Paneli Enerji Takip sayfaları (`/energy`, `/energy/meters`, `/energy/readings`, `/energy/invoices`, `/energy/budgets`)
- [x] Enerji Takip birim, servis, Edge Function ve RLS testlerinin doğrulanması (`PGlite` 29/29, `flutter test` 19/19, `flutter analyze` 0 sorun, `npm test` 8/8, `npm run build` 21/21 sayfa)

### Aşama 5 – Veri Aktarımı ve Doğrulama (Firebase → Supabase)
- [x] Salt-okunur Firestore yedekleme scripti (`scripts/migration/export_firestore.mjs` — `users`, `meters`, `readings`, `invoices`, `budgets` koleksiyonlarını yalnızca HTTP `GET` ve `datastore.readonly` ile JSON snapshot + metrik özeti olarak alır)
- [x] İdempotent aktarım motoru (`scripts/migration/transform_and_import.mjs`) geliştirilmesi ve izole PostgreSQL (`PGlite`) staging ortamında çift çalıştırma (double-run) testiyle doğrulanması
- [x] Kullanıcı eşleştirme şablonu (`scripts/migration/user_mapping.template.json`), `legacy_firebase_uid` → `profiles.id` eşleme, kardeş modül yetkilerini ezmeden `permissions.modules.energy` birleştirme ve silinmiş/eski kullanıcı `entered_by_name` korumasının doğrulanması
- [x] 7 adımlı veri bütünlüğü ve RLS doğrulama scripti (`scripts/migration/verify_migration.mjs`: sayaç/okuma sayıları, tüketim farkı `< 0.001`, MIN/MAX tarih, yıl/tür bazlı fatura ve bütçe toplamları, sahiplik/yetki kontrolleri — `PGlite` 31/31 test geçildi)
- [x] Canlı ortam aktarımı (`sayac-takip-avm-2026` → `urahnnrofnkbssxftuyz.supabase.co`): **13 sayaç, 1.617 okuma, 76 fatura ve 35 bütçe** idempotent olarak aktarıldı; canlı veritabanı üzerinde `verify_migration.mjs` **7/7** tam doğrulama geçti *(eski Firebase ve TEKNİK İŞ İSTEK sistemleri doğrulanıp paralel dönem tamamlanana kadar dokunulmadan korunmaktadır; kalan personel hesapları kayıt oldukça `user_mapping.generated.json` ile bağlanabilir)*.

### Aşama 6 – Test, Güvenlik ve Performans Optimizasyonu
- [x] Tüm roller (`employee`, `technician`, `team_lead`, `technical_manager`, `system_admin`), durumlar (`pending`/`disabled`/`rejected`), `core_actions` ve özel izin kombinasyonları için RLS, Storage ve Web yetki matrisi test paketi (`PGlite` 35/35, Web 9/9)
- [x] Mobil offline senaryo motoru (`OfflineSyncEngine`, `JsonFileOfflineQueueStorage`, `rpc_sync_offline_ticket`, `rpc_sync_offline_work_order_status`) ve 2 aşamalı fotoğraf + çakışma çözümü testleri (`flutter test` 24/24)
- [x] Sayfalama, lazy-loading, görsel sıkıştırma (`PhotoCompressionPolicy` `1600px`/`%80`) ve sorgu indeksi performans denetimi (`pg_indexes` + `rpc_list_tickets_paginated`, `rpc_list_meter_readings_paginated`, `rpc_list_energy_invoices_paginated`)
- [x] Android / iOS / Web üretim derleme ve dağıtım hazırlığı (`apps/web` `0.6.0` `next build` 21/21 sayfa & `apps/mobile` `0.6.0+1` `flutter analyze`/`test` doğrulandı; native `android/` ve `ios/` runner klasörleri dağıtım öncesi `flutter create --platforms=android,ios .` ile oluşturulacaktır)

### Aşama 7 – Yeni Modüllere Hazırlık Doğrulaması
- [x] Örnek iskelet modül (`MaintenanceModule` + `supabase/migrations/20261119000007_extensibility_and_equipment_360.sql`) ile ana uygulama çekirdeğine, `app_router.dart` dosyasına veya `energy` / `work_tracking` modüllerine dokunmadan yeni modül eklenebildiğinin ve özellikler arası sıfır çapraz import izolasyonunun kanıtlanması
- [x] Ortak `equipments` tablosu üzerinden sayaç + arıza/iş emri + planlı bakım ilişkilerinin `rpc_get_equipment_360_summary` (`SECURITY INVOKER`) ile uçtan uca doğrulanması
- [x] Son sürüm dokümantasyon ve teslimat raporu (`v1.0.0` — `PGlite` 37/37, `flutter analyze` 0 sorun, `flutter test` 26/26, Web `npm test` 10/10, `next build` 21/21 sayfa geçti)

---

## 4. Dokümantasyon Haritası

| Dosya | Açıklama |
|---|---|
| `p.md` | Ana proje planı, vizyon, teknoloji yığını ve aşama takip listesi |
| `ARCHITECTURE.md` | Sistem mimarisi, katmanlar, offline strateji, güvenlik ve teknik kararlar |
| `DATABASE.md` | PostgreSQL şeması, çekirdek + modül tabloları, ortak ekipman yapısı, RLS ve RPC'ler |
| `MODULES.md` | Modül kayıt sistemi (`ModuleRegistry`), aktif/gelecek modüller ve sınır kuralları |
| `PERMISSIONS.md` | Merkezi RBAC, modül & işlem izinleri ve mevcut iki projenin yetki eşleştirmesi |
| `MIGRATION.md` | Firebase/Firestore → Supabase güvenli veri aktarım, yedekleme ve doğrulama planı |
| `DEVELOPMENT.md` | Monorepo klasör yapısı, kodlama standartları, yeni modül ekleme ve test kuralları |
| `CHANGELOG.md` | Sürüm geçmişi ve değişiklik kayıtları |

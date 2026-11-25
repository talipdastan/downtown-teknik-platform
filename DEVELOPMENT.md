# AVM TECH – GELİŞTİRME, KLASÖR YAPISI VE TEST STANDARTLARI (`DEVELOPMENT.md`)

> **Sürüm:** `v0.1.0-docs`  
> **Amaç:** Yeni platformun tutarlı, bakımı kolay, modüler ve test edilebilir biçimde geliştirilmesini sağlayan mühendislik kurallarını belirlemek.

---

## 1. Önerilen Monorepo Klasör Yapısı

Yeni proje mevcut iki projeden tamamen bağımsız bir kök klasörde (`avm-tech-platform/`) oluşturulacaktır:

```text
avm-tech-platform/
├── p.md                              # Ana proje planı ve aşama takibi
├── ARCHITECTURE.md                   # Sistem mimarisi
├── DATABASE.md                       # Veritabanı şeması ve RLS
├── MODULES.md                        # Modül kayıt sistemi ve modül sınırları
├── PERMISSIONS.md                    # Merkezi RBAC ve modül izinleri
├── MIGRATION.md                      # Firebase -> Supabase aktarım planı
├── DEVELOPMENT.md                    # Bu doküman
├── CHANGELOG.md                      # Sürüm ve değişiklik geçmişi
├── .env.example                      # Ortam değişkenleri şablonu
│
├── supabase/                         # Tekil Backend & Veritabanı
│   ├── config.toml
│   ├── migrations/                   # Sıralı SQL migration dosyaları
│   │   ├── 0001_core_schema.sql      # departments, floors, locations, profiles, system_modules, equipments
│   │   ├── 0002_core_rls_rpc.sql     # Gatekeeper, merkezi yetki fonksiyonları, RPC'ler
│   │   ├── 0003_work_tracking.sql    # Arıza & İş Emri tabloları, RLS, tetikleyiciler
│   │   ├── 0004_energy_tracking.sql  # Sayaç, Okuma, Fatura, Bütçe tabloları, RLS, özet RPC
│   │   └── 0005_storage_buckets.sql  # Private bucket'lar ve Storage RLS
│   ├── functions/                    # Supabase Edge Functions (Deno)
│   │   ├── send-push-notification/   # FCM bildirim gönderimi
│   │   └── parse-energy-document/    # Gemini destekli PDF fatura & bütçe analizi
│   ├── scripts/
│   │   └── create_initial_admin.sql
│   └── tests/
│       └── rls_security_tests.sql
│
├── apps/
│   ├── mobile/                       # Flutter Mobil Uygulaması (Android / iOS)
│   │   ├── pubspec.yaml
│   │   ├── lib/
│   │   │   ├── main.dart
│   │   │   ├── core/                 # Merkezi altyapı (tüm modüller kullanır)
│   │   │   │   ├── auth/             # AuthProvider, Login, Register, PendingApproval
│   │   │   │   ├── config/           # SupabaseConfig, Env
│   │   │   │   ├── database/         # Drift SQLite offline veritabanı & sync_queue
│   │   │   │   ├── equipment/        # Ortak ekipman modeli & seçici widget
│   │   │   │   ├── modules/          # AppModule sözleşmesi & ModuleRegistry
│   │   │   │   ├── notifications/    # FCM + Local + Realtime bildirim servisi
│   │   │   │   ├── permissions/      # Merkezi RBAC & modül yetki yardımcıları
│   │   │   │   ├── router/           # GoRouter (modül rotalarını otomatik bağlar)
│   │   │   │   ├── theme/            # Kurumsal AVM TECH Material 3 teması
│   │   │   │   ├── widgets/          # Ortak bileşenler (kartlar, hata, boş durum)
│   │   │   │   └── screens/          # ModuleLauncherScreen (Ana Ekran), Profile, Notifications
│   │   │   └── features/             # Bağımsız İş Modülleri
│   │   │       ├── work_tracking/    # İş Takip Modülü
│   │   │       │   ├── work_tracking_module.dart
│   │   │       │   ├── data/         # Modeller & Repository
│   │   │       │   ├── providers/    # Riverpod provider'ları
│   │   │       │   └── presentation/ # Ekranlar & Widget'lar
│   │   │       └── energy/           # Enerji Takip Modülü
│   │   │           ├── energy_module.dart
│   │   │           ├── data/         # Meter, Reading, Invoice, Budget modelleri & Repository
│   │   │           ├── services/     # ExcelService, BudgetImportService, PenaltyAlertService
│   │   │           ├── providers/    # Riverpod provider'ları
│   │   │           └── presentation/ # Özet, Elektrik, Mekanik, Detay, Fatura, Bütçe ekranları
│   │   └── test/                     # Birim ve widget testleri
│   │
│   └── web/                          # Next.js 14+ Web Yönetim Paneli
│       ├── package.json
│       └── src/
│           ├── app/
│           │   ├── (auth)/           # Login, Pending
│           │   └── (dashboard)/
│           │       ├── home/         # Modül Seçim & Platform Özeti
│           │       ├── work-tracking/# İş Takip sayfaları
│           │       ├── energy/       # Enerji Takip sayfaları (Sayaç, Okuma, Fatura, Bütçe, Rapor)
│           │       └── admin/        # Personel, Yetkiler, Modüller, Departman, Kat/Mahal, Ekipman
│           ├── core/                 # Supabase SSR, permissions, moduleRegistry
│           └── modules/              # Modül bazlı bileşen ve servisler
│
└── scripts/
    └── migration/                    # Firebase -> Supabase aktarım & doğrulama scriptleri
        ├── export_firestore.ts
        ├── import_to_supabase.ts
        └── verify_migration.ts
```

---

## 2. Paket ve SDK Uyumluluk Politikası (Flutter)

İki eski proje arasındaki sürüm farkları yeni `apps/mobile/pubspec.yaml` dosyasında tek bir kararlı sette hizalanacaktır:

- **Dart SDK:** `>=3.4.0 <4.0.0` (mevcut Flutter SDK ile uyumlu tek hedef)
- **State & Routing:** `flutter_riverpod`, `go_router`
- **Backend:** `supabase_flutter`
- **Offline:** `drift`, `sqlite3_flutter_libs`, `path_provider`, `path`
- **Bildirim:** `firebase_core` + `firebase_messaging` (uyumlu tek sürüm çifti) + `flutter_local_notifications`
- **Enerji Modülü Araçları:** `excel`, `file_picker`, `share_plus`
- **Medya & Yardımcılar:** `image_picker`, `cached_network_image`, `intl`, `uuid`, `flutter_secure_storage`
- **Kaldırılan Eski Bağımlılıklar:** `cloud_firestore`, `firebase_auth`, `provider`, `flutter_speed_dial` (yerine Material 3 standart bileşenleri)

---

## 3. Yeni Modül Ekleme Rehberi (Sade Kayıt Prensibi)

İleride yeni bir modül (örneğin **Planlı Bakım** – `maintenance`) eklenirken gereksiz karmaşık eklenti yükleyicileri yerine aşağıdaki 6 sade adım izlenir; mevcut modüllerin koduna dokunulmaz ve ortak altyapılar (`core/`) tekrar yazılmaz:

1. **Veritabanı:** `supabase/migrations/` altına yeni migration ekle (`maintenance_*` tabloları, merkezi `equipments(id)` FK ve `has_module_permission('maintenance', ...)` RLS kuralları).
2. **Modül Kaydı:** `system_modules` tablosunda `'maintenance'` satırını `is_enabled = true`, `is_coming_soon = false` yap.
3. **Yetki Tanımı:** `PERMISSIONS.md` ve merkezi izin tanımlarına 8 standart yetki + modül özel aksiyonlarını ekle.
4. **Mobil:** `apps/mobile/lib/features/maintenance/` klasörünü oluştur, `AppModule` arayüzünü implemente et ve `core/modules/module_registry.dart` listesine tek satırla ekle. Ekipman, bildirim, yetki ve offline kuyruk servislerini `core/` katmanından kullan.
5. **Web:** `apps/web/src/app/(dashboard)/maintenance/` sayfalarını oluştur ve `apps/web/src/core/moduleRegistry.ts` dosyasına tek satırla kaydet.
6. **Kural:** Mevcut `energy` ve `work_tracking` modüllerinin koduna, ana ekrana veya Auth katmanına dokunulmaz.

---

## 4. Kodlama ve Kalite Kuralları

- **Dil & Format:** Kullanıcı arayüzü Türkçe (`tr-TR`), tarih `DD.MM.YYYY`, saat 24 saat `HH:mm`, zaman dilimi `Europe/Istanbul`. Kod içi tanımlayıcılar (sınıf, değişken, tablo, sütun) İngilizce, açıklamalar ve dokümantasyon Türkçe.
- **Modül İzolasyonu:** Bir `features/<modul_a>/` dosyası başka bir `features/<modul_b>/` dosyasını asla import edemez.
- **Taşma Koruması:** Mobil ekranlarda küçük ekran boyutlarında (`360px` genişlik) yatay taşma (`RenderFlex overflow`) kesinlikle bulunmaz.
- **Güvenlik:** Hiçbir API anahtarı veya servis hesabı kaynak koda yazılmaz (`.env` ve Supabase Secrets kullanılır).

---

## 5. Aşama Geçiş (Definition of Done) ve Test Kuralları

Bir geliştirme aşaması şu kontrollerin tamamı geçmeden tamamlanmış sayılmaz:

1. **Flutter Statik Analiz & Test:**
   - `flutter analyze` → 0 hata, 0 kritik uyarı
   - `flutter test` → Tüm birim ve widget testleri başarılı
2. **Next.js Kontrol & Derleme:**
   - `npm run lint` ve `npm run build` → Hatasız derleme
   - `npm test` → Tüm tip/yetki testleri başarılı
3. **Veritabanı & RLS Doğrulaması:**
   - `supabase/tests/rls_security_tests.sql` → Yetkisiz erişim senaryoları dahil tüm testler başarılı
4. **Dokümantasyon Güncellemesi:**
   - `p.md` üzerindeki ilgili maddeler `[x]` olarak işaretlenir.
   - `CHANGELOG.md` dosyasına aşama özeti işlenir.

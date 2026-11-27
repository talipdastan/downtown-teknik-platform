# DOWNTOWN TEKNİK – FAZ 1 KAPSAMLI TEKNİK DENETİM RAPORU

**Tarih:** 2026-11-27  
**Kapsam:** Web (`apps/web`), Mobil (`apps/mobile`), Veritabanı & Edge Functions (`supabase/`), Dağıtım & Otomasyon (`scripts/`, `.github/`), Güvenlik, Performans, Offline Altyapı ve Faz 2/3 Hazırlık Denetimi.  
**Yöntem:** Salt-okunur kod, migration, APK arşiv içeriği, Git takibi ve çağrı zinciri analizi. Bu aşamada hiçbir kaynak kod, veritabanı kaydı, migration veya canlı sunucu yapılandırması değiştirilmemiştir. Gizli anahtarlar, parolalar ve kişisel veriler rapora alınmamıştır.

---

## BÖLÜM 1 – Genel Proje Sağlık Durumu

| Alan | Puan (100) | Değerlendirme ve Gerekçe |
| :--- | :---: | :--- |
| **Web Uygulaması** | **74 / 100** | Next.js 14 + TypeScript + Tailwind ile zengin iş akışları (İş Takip, Enerji, Bütçe, Fatura, Ekipman 360°, Admin) çalışır durumda. Ancak 10+ ekran 1.000–1.932 satır arası monolitik yapıda, istemci önbelleği (TanStack Query/SWR) yok, Realtime dinleyicileri debounce olmadan çalışıyor ve `work-orders` ile `reports` ekranlarında `.limit(300/500)` kırpılma riski bulunuyor. |
| **Mobil Uygulama** | **71 / 100** | Flutter + Riverpod + GoRouter ile saha akışları, HEIC/JPEG fotoğraf sıkıştırma, yerel/FCM bildirim altyapısı ve uygulama içi güncelleyici (`AppUpdateService`) kurulmuş. Ancak release APK hâlâ debug keystore ile imzalanıyor, 61.27 MB fat APK (ABI split yok), Shorebird yapılandırması (`shorebird.yaml`) eksik ve 432 satırlık `OfflineSyncEngine` hiçbir ekrana bağlı değil. |
| **Supabase (DB, RLS, RPC, Storage)** | **80 / 100** | 16 migration, 21 RLS korumalı tablo, 50 indeks, `SECURITY INVOKER` sayfalamalı RPC'ler ve `client_mutation_id` idempotency kolonları ile çok güçlü temel kurulmuş. Ancak Migration 0016'daki `rpc_purge_expired_closed_photos` fonksiyonunda doğrudan `storage.objects` SQL `DELETE` (15 gün sonra iş kapatmayı kilitleme riski) ve yetki kontrolsüz `authenticated` erişim açığı mevcut. |
| **Sunucu ve Dağıtım** | **48 / 100** | Tek komutla deploy (`scripts/deploy_server.mjs`) pratik ancak SSH parolası kodda sabit tanımlı, SSH key tabanlı erişim yok, Web yalnızca HTTP (`http://10.16.19.19`), CI/CD (`.github/workflows`) yok ve 4.5G/dış ağ OTA APK yükleme adımı (GitHub Releases) otomasyona bağlanmamış. |
| **Güvenlik** | **55 / 100** | Veritabanı RLS/RPC katmanı olgun ve güçlü; buna karşın operasyonel güvenlikte 4 kritik açık var: Git geçmişinde/kodda SSH parolası, Git takibindeki kişisel veri içeren migration eşleme dosyası (`user_mapping.generated.json`), debug keystore ile imzalanan release APK ve `rpc_purge_expired_closed_photos` RPC yetkilendirme eksikliği. |
| **Offline Çalışma** | **35 / 100** | Veritabanı tarafında `rpc_sync_offline_ticket`, `rpc_sync_offline_work_order_status` ve `meter_readings.client_mutation_id` hazır; istemci tarafında `OfflineSyncEngine` yazılmış ve birim testleri mevcut. Ancak **üretim ekranlarına sıfır bağlantı (0 import)** olduğu için bodrum/otopark/makine dairesinde internet kesildiğinde saha kayıtları canlıda doğrudan hata verir. |
| **Test ve CI/CD Altyapısı** | **40 / 100** | Web'de 2 test dosyası (`permissions_and_modules.test.mjs`, `energy_readings.test.mjs`), Mobilde 2 kapsamlı test dosyası (`apk_fixes_test.dart` – 1.271 satır, `core_permissions_and_modules_test.dart`) bulunuyor. Ancak yerel Windows ortamında Device Guard `flutter_tester.exe`'yi engelliyor ve `.github/workflows` altında otomatik CI çalıştıran hiçbir pipeline yok. |

**Genel Ağırlıklı Olgunluk Ortalaması:** **57.6 / 100** *(Çekirdek ürün ve DB tasarımı güçlü; güvenlik, dağıtım, veri kırpılma koruması ve offline bağlama ile hızla 80+ bandına çıkabilir.)*

---

## DETAYLI DENETİM BULGULARI (BAŞLIK A–G)

### A. Mobil Güvenlik ve APK Dağıtımı

1. **Release İmzalama (Debug Keystore Riski):**
   - `apps/mobile/android/app/build.gradle.kts:29-35` satırlarında `buildTypes.release` içinde `signingConfig = signingConfigs.getByName("debug")` tanımlı.
   - `apps/mobile/android/key.properties` veya kurumsal `.jks` keystore yapılandırması bulunmuyor.
   - **Etki:** Farklı bir bilgisayardan veya GitHub Actions runner'ından alınan APK'nın SHA-256 sertifika parmak izi değişeceği için Android `PackageInstaller` mevcut kurulumun üzerine güncellemeyi reddeder.
2. **R8 Minification, Resource Shrinking ve ABI Split (APK Boyutu Matematiksel Doğrulaması):**
   - `apps/mobile/android/app/build.gradle.kts:29-35` içinde `isMinifyEnabled`, `isShrinkResources` ve `splits { abi { ... } }` tanımlı değil; `proguard-rules.pro` dosyası yok.
   - Mevcut derlenmiş `apps/mobile/build/app/outputs/flutter-apk/app-release.apk` (**61.27 MB**) ZIP arşivi doğrudan analiz edildiğinde içerik dağılımı şöyledir:

| APK İçerik Grubu | Dosya Sayısı | Sıkıştırılmış Boyut | Toplam Payı |
| :--- | :---: | :---: | :---: |
| `lib/x86_64` *(emülatör / x86)* | 4 | **21.44 MB** | %35.0 |
| `lib/arm64-v8a` *(modern 64-bit Android)* | 4 | **19.99 MB** | %32.6 |
| `lib/armeabi-v7a` *(eski 32-bit Android)* | 4 | **17.99 MB** | %29.4 |
| `dex` *(Derlenmiş Java/Kotlin)* | 2 | 0.73 MB | %1.2 |
| `assets` *(Logo, font, ikon)* | 11 | 0.52 MB | %0.8 |
| `other` *(META-INF, manifest vb.)* | 95 | 0.26 MB | %0.4 |
| `res` *(Android kaynakları)* | 282 | 0.17 MB | %0.3 |

   - **Doğrulama Sonucu:**
     - **R8 / shrinkResources tek başına** boyutu 20–24 MB'a **düşüremez**; çünkü `dex + res` toplamı zaten yalnızca **0.90 MB**'dır (R8 en fazla ~0.2–0.4 MB tasarruf ve kod gizleme sağlar).
     - **`--split-per-abi` ile** (gereksiz `x86_64` ve çapraz ARM kütüphaneleri ayrıldığında) `arm64-v8a` APK boyutu `19.99 + 1.68` ≈ **21.7 MB**, `armeabi-v7a` APK boyutu `17.99 + 1.68` ≈ **19.7 MB** seviyesine düşer.
     - Dolayısıyla **20–24 MB hedefi teknik olarak mümkündür ve doğrulanmıştır**, ancak bunun ön koşulu ABI bazlı APK üretmek ve `version.json` / `AppUpdateService` tarafında cihaz mimarisine (`arm64-v8a` / `armeabi-v7a`) uygun indirme URL'sini (veya fallback olarak universal APK) yönetmektir.
3. **`AppUpdateService` ve `version.json` Uyumsuzluğu:**
   - `apps/mobile/lib/core/update/app_update_service.dart:67-76` sürüm bilgisini önce GitHub `raw.githubusercontent.com/.../apps/web/public/download/version.json`, erişemezse `http://10.16.19.19/download/version.json` adresinden okuyor.
   - `apps/web/public/download/version.json:4` içinde `"apkUrl": "http://10.16.19.19/download/downtown-teknik.apk"` yazılı (yalnızca yerel AVM LAN adresi, `http://`).
   - `app_update_service.dart:346-353` içindeki `candidateUrls` listesi `apkUrl` `https://` olmadığı için ilk adımı atlayıp `githubReleaseApkUrl` (`.../releases/latest/download/downtown-teknik.apk`) adresini deniyor; ancak `scripts/deploy_server.mjs` APK'yı GitHub Releases'a yüklemiyor.
   - **Doğrulanmamış Notu:** GitHub üzerinde manuel açılmış mevcut bir Release asset'i olup olmadığı dış ağ sorgusu yapılmadığı için **Doğrulanmamış** olarak işaretlenmiştir; ancak mevcut deploy script'inde GitHub Release otomasyonu kesin olarak yoktur.
   - **Android Manifest Notu:** `apps/mobile/android/app/src/main/AndroidManifest.xml` içinde `REQUEST_INSTALL_PACKAGES` ve `FileProvider` doğru tanımlı. `usesCleartextTraffic` tanımlı değil; Dart `dart:io` `HttpClient` bunu bypass etse de, olası Android ağ güvenlik politikaları için yerel HTTP yerine HTTPS veya `network_security_config` netleştirilmelidir.
4. **Shorebird Durumu:**
   - `apps/mobile/pubspec.yaml:37` (`shorebird_code_push: ^2.0.3`), `app_update_service.dart:8,81-129` ve `scripts/patch_mobile.mjs` kodda mevcut.
   - Ancak `apps/mobile/shorebird.yaml` dosyası **mevcut değil**. Dolayısıyla mevcut release APK içinde `_shorebird.isAvailable` çalışma zamanında `false` döner ve Katman-1 sessiz Dart OTA güncellemesi **aktif değildir**.
   - Ayrıca `scripts/patch_mobile.mjs:18` yerel Windows `.shorebird\bin\shorebird.bat` yoluna bağlıdır (Windows Device Guard tarafından engellenmektedir) ve 23. satırda Supabase publishable anahtarı sabit yazılmıştır.

---

### B. Sunucu ve Güvenlik

1. **Dağıtım Script'i ve SSH Erişimi (`scripts/deploy_server.mjs`):**
   - `scripts/deploy_server.mjs:13-15,49,53,59`: Sunucuya PuTTY `plink.exe` / `pscp.exe` üzerinden parola parametresiyle (`-pw`) bağlanılıyor.
   - 15. satırda ortam değişkeni yoksa devreye giren **sabit tanımlı SSH parolası** doğrudan kaynak kodda ve Git geçmişinde yer alıyor (**P0 Güvenlik Açığı**).
   - SSH anahtar (key-based) kimlik doğrulama uygulanmamış.
2. **Git Takibi ve `.gitignore` Eksiklikleri:**
   - `scripts/migration/user_mapping.generated.json` (4.730 byte) Git tarafından takip ediliyor (`git ls-files` ile doğrulandı). Yapısal kontrolde dosyanın **e-posta adresi kalıbı içeren 8 personel eşlemesi ve 1 takma ad** barındırdığı doğrulandı (kişisel veri / PII maruziyeti).
   - `.gitignore` (36 satır) `apps/web/.env*.local`, `backups/`, `*.apk`, `*.aab` dosyalarını hariç tutuyor; ancak şu kritik desenler eksik: `*.jks`, `*.keystore`, `key.properties`, `*.pem`, `*.p12`, `.env`, `.env.*`, `*.generated.json`.
   - `git log --all --name-only` taramasında `scripts/deploy_server.mjs` ve `scripts/migration/user_mapping.generated.json` geçmiş commit'lerde kayıtlıdır. Bu nedenle SSH parolasının mutlaka değiştirilmesi, dosyanın Git takibinden çıkarılması ve mümkünse Git geçmişinin temizlenmesi gerekir.
3. **Nginx, HTTP/HTTPS ve İç/Dış Ağ Erişimi:**
   - Kod tabanındaki tüm web/güncelleme URL'leri (`deploy_server.mjs:64-67`, `version.json:4`, `app_update_service.dart:75`, `patch_mobile.mjs:24`) plain HTTP (`http://10.16.19.19`) kullanıyor.
   - Canlı Ubuntu sunucusundaki `/etc/nginx/` konfigürasyonu ve `/usr/local/bin/downtown-deploy` içeriği bu fazın salt-okunur yerel kuralı gereği **Doğrulanmamış** olarak işaretlenmiştir.
   - **İç Ağ (AVM Wi-Fi / LAN):** HTTP üzerinden Web panel açılabiliyor ancak PWA kurulumu, Service Worker cache, Web Push, `navigator.mediaDevices` (QR kamera) ve `crypto.randomUUID()` tarayıcı güvenlik politikaları gereği kısıtlanıyor.
   - **Dış Ağ (4.5G/5G):** Mobil uygulama doğrudan HTTPS üzerinden Supabase Cloud'a bağlı olduğu için dış ağda tam çalışıyor; ancak Web uygulaması LAN IP'sinde (`10.16.19.19`) olduğu için dış ağdan erişilemiyor ve Mobil OTA APK indirmesi GitHub Releases yüklenmediği sürece dış ağda başarısız oluyor.

---

### C. CI/CD ve Otomatik Dağıtım

- `.github/workflows/` klasörü **mevcut değil**.
- Aşağıdaki adımların tamamı eksiktir ve manuel yerel makineye bağımlıdır:
  1. PR / `main` push anında Web `npm ci && npm run lint && npm test && npm run build` kalite kapısı.
  2. PR / `main` push anında Mobil `flutter analyze && flutter test` (Linux runner üzerinde çalışacağı için yerel Windows Device Guard engelini tamamen aşar).
  3. Git etiketi (`v*`) ile GitHub Secrets üzerinden kalıcı release keystore kullanarak imzalı APK (`arm64-v8a` + `armeabi-v7a` + opsiyonel universal) üretme.
  4. Üretilen APK'ların ve güncel `version.json` dosyasının otomatik olarak GitHub Releases'a yüklenmesi.
  5. Linux runner üzerinde `shorebird release` / `shorebird patch` otomasyonu (Windows Device Guard engeli olmadan gerçek sıfır-tıklama OTA yama).

---

### D. Mobil Mimari ve Offline Senkronizasyon

1. **Gerçek Çağrı Zinciri Tespiti:**
   - `apps/mobile/lib/core/database/offline_sync_engine.dart` (432 satır) ve `offline_sync_models.dart` (236 satır) yalnızca birim testinde (`apps/mobile/test/core_permissions_and_modules_test.dart:6-7,387-561`) kullanılmaktadır. **`apps/mobile/lib/` altında 0 import ve 0 çağrı vardır.**
   - **CreateTicket akışı:** `apps/mobile/lib/features/work_tracking/presentation/screens/create_ticket_screen.dart:111` doğrudan `Api.client.from('tickets').insert(...)` çağırıyor; ne `OfflineSyncEngine` ne de hazır olan `rpc_sync_offline_ticket` kullanılıyor.
   - **CompleteWorkOrder akışı:** `apps/mobile/lib/features/work_tracking/presentation/screens/technician_work_order_detail_screen.dart:62,73,88,138` doğrudan `rpc_technician_start_work`, `rpc_technician_pause_work`, `work_order_materials.insert` ve `rpc_technician_complete_work` çağırıyor; hazır olan `rpc_sync_offline_work_order_status` kullanılmıyor.
   - **ReadingEntry akışı:** `apps/mobile/lib/features/energy/presentation/screens/reading_entry_sheet.dart:94-104` doğrudan `Api.client.rpc('rpc_record_meter_reading', ...)` çağırıyor. Her tıklamada yeni `Uuid().v4()` ürettiği için ağ kesintisinde lokalde kuyruğa almaz ve kayıt kaybolur.
2. **Motorun Kendi İçindeki 4 Teknik Kusur (Bağlanmadan Önce Düzeltilmeli):**
   - **Çökme Sonrası Kilitlenme (Stuck `syncing` Bug):** `offline_sync_engine.dart:234-243` senkronizasyon başlarken kaydı diske `SyncStatus.syncing` olarak yazar. Uygulama yükleme sırasında çöker veya kapatılırsa yeniden açılışta `eligible` koşulu yalnızca `pending` ve `failed(retry)` kayıtlarını seçtiği için `syncing` durumundaki kayıt **sonsuza kadar kuyrukta kilitli kalır**.
   - **Atomik Olmayan Dosya Yazımı:** `JsonFileOfflineQueueStorage._writeRoot` (`offline_sync_engine.dart:106-111`) doğrudan hedef JSON dosyasının üzerine yazar; yazma ortasında cihaz kapanırsa tüm kuyruk dosyası bozulabilir (`tmp` dosyaya yaz + atomik `rename` gerekir).
   - **Backend `completed_by` Eksikliği:** `supabase/migrations/20261119000006_security_and_performance.sql:249-256` içindeki `rpc_sync_offline_work_order_status` fonksiyonu Migration 0016'da eklenen `completed_by = auth.uid()` sütununu güncellemiyor. Ayrıca ağ yanıtı koptuğunda `completed` durumu tekrar gönderilirse 258–261. satırlardaki `Tamamlanma Notu` yorumunun mükerrer eklenme riski vardır.
   - **Ağ Dinleyici Eksikliği:** `apps/mobile/pubspec.yaml` içinde bağlantı değişimini otomatik izleyecek bir paket (örn. `connectivity_plus`) bulunmuyor.
3. **Çift Gönderimi Önleme (Idempotency) Durumu:**
   - `tickets` (`client_mutation_id uuid unique` + `rpc_sync_offline_ticket`) ve `meter_readings` (`client_mutation_id uuid unique` + `rpc_record_meter_reading`) için veritabanı tarafında sağlam idempotency **hazır**.
   - `work_orders` durum geçişleri `base_updated_at` iyimser kilidi ile çakışma tespitine sahip, ancak `work_order_materials` ve `comments` için idempotency anahtarı henüz yok.

---

### E. Web Performansı ve Kod Mimarisi

1. **1.000 Satır Üzerindeki Üretim Dosyaları (12 Dosya):**

| Satır | Dosya |
| :---: | :--- |
| 1.932 | `apps/web/src/app/(dashboard)/energy/budgets/page.tsx` |
| 1.891 | `apps/web/src/app/(dashboard)/admin/users/page.tsx` |
| 1.776 | `apps/web/src/app/(dashboard)/work-tracking/tickets/page.tsx` |
| 1.433 | `apps/web/src/core/utils/energy-report-builder.ts` |
| 1.382 | `apps/mobile/lib/features/energy/services/energy_excel_service.dart` |
| 1.330 | `apps/mobile/lib/features/energy/presentation/screens/energy_invoices_screen.dart` |
| 1.285 | `apps/web/src/app/(dashboard)/work-tracking/work-orders/page.tsx` |
| 1.132 | `apps/web/src/app/(dashboard)/admin/definitions/page.tsx` |
| 1.125 | `apps/web/src/app/(dashboard)/energy/invoices/page.tsx` |
| 1.118 | `apps/web/src/app/(dashboard)/admin/equipments/page.tsx` |
| 1.117 | `apps/mobile/lib/core/screens/users_management_screen.dart` |
| 1.032 | `apps/web/src/app/(dashboard)/energy/readings/page.tsx` |

2. **Ham `useEffect` ve İstemci Önbelleği Eksikliği:**
   - Dashboard altındaki 15 sayfanın 14'ü `'use client'` + ham `useEffect` ile doğrudan Supabase sorgusu yapıyor (`apps/web/package.json` içinde `@tanstack/react-query` veya `swr` yok). Sayfalar arası her geçişte tüm listeler sıfırdan yükleniyor.
3. **Debounce Olmayan Realtime + Focus Sorgu Fırtınası:**
   - Web: `work-tracking/page.tsx:76-158` (her tetiklemede **6 paralel sorgu**), `work-orders/page.tsx:192-248` (**4 paralel sorgu**), `tickets/page.tsx:244-266`, `review/page.tsx:146-162` — tamamı hem `tickets` hem `work_orders` tablosunu dinliyor ve `window.focus` olayıyla da tam yenileme yapıyor; **hiçbirinde debounce yok**. Bir iş emri atandığında `tickets` + `work_orders` aynı milisaniyede tetiklenerek **çift tam yenileme (8–12 sorgu)** üretir.
   - Mobil: `work_tracking_home_screen.dart:53-79` 3 tabloyu (`tickets`, `work_orders`, `work_order_assignments`) debounce olmadan dinleyip her olayda `invalidateAllWorkTrackingProviders(ref)` (5 provider) çağırıyor.
4. **N+1 Sorgu Problemi:**
   - `apps/mobile/lib/features/energy/presentation/screens/meter_list_screen.dart:189-200` içindeki `_saveReorder` fonksiyonu sayaç sırasını kaydederken `for` döngüsü içinde her sayaç için ayrı ayrı `await Api.client.from('meters').update({'sort_order': i}).eq('id', list[i].id)` çalıştırıyor (30 sayaçta 30 ardışık ağ isteği).
5. **`select('*')` Kullanımları (34 Adet):**
   - Toplam 15 dosyada 34 kullanım tespit edildi. En yoğun dosyalar: `apps/web/src/app/(dashboard)/layout.tsx` (5x), `admin/definitions/page.tsx` (5x), `energy/invoices/page.tsx` (3x), `admin/equipments/page.tsx` (3x), `admin/users/page.tsx` (3x), `apps/mobile/.../data_providers.dart` (3x), `apps/mobile/.../energy_providers.dart` (3x). Özellikle `tickets` ve `work_orders` liste sorgularında (`_ticketSelect` / `_workOrderSelect`) tüm sütunların çekilmesi bant genişliğini artırıyor.

---

### F. Supabase ve Veri Doğruluğu

1. **300 / 500 Kayıt Kırpılma ve Yanlış KPI / Rapor Riski:**
   - **Web `work-orders/page.tsx:212` (`.limit(300)`):** Tarih filtreleri (`startDate`/`endDate`) veritabanında değil **istemcide `useMemo` içinde** (`satır 283-302`) uygulanıyor. Toplam iş emri 300'ü geçtiğinde eski bir tarih aralığı seçildiğinde **kayıtlar veritabanında olmasına rağmen 0 veya eksik sonuç döner**.
   - **Web `reports/page.tsx:155` (`.limit(500)`):** Tarih filtreleri `gte/lte` ile veritabanında uygulanıyor (`satır 157-158`), **ancak** `.limit(500)` sabit olduğu için geniş tarih aralıklarında ("Bu Yıl", "Tümü" veya yoğun dönemlerde) KPI kartları, departman grafiği ve Excel/PDF çıktısı **sessizce 500 kayıtla kırpılır** ve kullanıcıya hiçbir uyarı gösterilmez.
   - **Mobil `ticketsProvider` (`data_providers.dart:57`, `.limit(300)`):** Ana ekran KPI'ları ve listeler bu 300 kayıtlık kesit üzerinden hesaplanır.
   - **Kullanılmayan Sunucu Sayfalaması:** `rpc_list_tickets_paginated` (`20261119000006:286-360`, `SECURITY INVOKER` – RLS tam uyumlu) ve `paginatedTicketsProvider` (`data_providers.dart:265`) yazılmış durumda; ancak **hiçbir mobil veya web ekranında kullanılmıyor**.
2. **Önerilen İndekslerin Mevcut Şema ile Çakışma Analizi:**
   - **`meter_readings(meter_id, reading_date DESC)`:** **ZATEN MEVCUT** (`idx_meter_readings_meter_date` – `20261119000005:107` ve `20261119000006:36`). Tekrar eklenmemelidir.
   - **`work_orders(completed_by, completed_at DESC)`:** **EKSİK** (mevcut `work_orders` indeksleri yalnızca `ticket_id`, `(status, department_id)`, `equipment_id`, `created_at desc`). Personel bazlı tamamlama raporları için **kısmi indeks (`WHERE completed_by IS NOT NULL`)** olarak eklenmesi çakışma yaratmaz ve yazma maliyetini minimumda tutar.
   - **`tickets(status, closed_at)`:** **EKSİK** (mevcut `idx_tickets_status_priority_created` ikinci sütunu `priority` olduğundan `closed_at` aralık sorgusunu verimli tarayamaz). 15 günlük fotoğraf temizliği ve kapanış tarih raporları için **kısmi indeks (`WHERE status IN ('closed', 'cancelled')`)** olarak eklenmesi en doğru yaklaşımdır.

---

### G. Fotoğraf Saklama ve Temizleme (`20261126000016`)

1. **Kapsam Netleştirmesi (Hangi Dosyalar Etkilenir?):**
   - Sistemde iki ayrı private Storage bucket vardır:
     - `work-attachments` (`20261119000004:890-892`, 25 MB limit): Arıza açılış (`before`), iş emri kapanış (`after`) ve genel (`general`) iş takip fotoğrafları.
     - `energy-documents` (`20261119000005:536`): Enerji faturaları ve sayaç belgeleri.
   - **15 günlük temizlik kuralı YALNIZCA** `status IN ('closed', 'cancelled')` durumundaki iş istekleri ve bunlara bağlı iş emirlerinin `work-attachments` fotoğraflarını (`public.attachments`) kapsar. `energy-documents`, `tickets`, `work_orders`, `comments`, `status_history` ve `work_order_materials` kayıtlarına **kesinlikle dokunulmaz**.
2. **Mevcut Uygulamadaki 3 Kritik Risk (`20261126000016`):**
   - **Kritik Risk 1 – Doğrudan `DELETE FROM storage.objects` ve İş Kapatmayı Kilitleme Tehlikesi (`satır 120-123` ve `satır 211`):**
     - Barındırılan Supabase ortamında `storage.objects` üzerinde doğrudan SQL `DELETE` çalıştırmak Supabase'in `storage.protect_delete()` koruma tetikleyicisi tarafından engellenir (veya engellenmese bile S3'teki fiziksel nesneyi silmeden yalnızca metadata satırını silerek yetim/orphan dosya bırakır).
     - `rpc_manager_close_ticket` (satır 211) her iş kapatıldığında `perform public.rpc_purge_expired_closed_photos(15);` çağrısını **aynı transaction içinde ve exception yakalamadan** çalıştırır. İlk kapalı işin üzerinden 15 gün geçtiği anda `storage.protect_delete()` hata fırlatırsa **hiçbir yönetici yeni iş kapatamaz hale gelir!** *(Canlı Supabase'deki `storage.protect_delete` tetikleyici varlığı DB'ye yazma yapılmadığı için yerel koddan tespit edilmiş, canlı tetiklenme davranışı **Doğrulanmamış** olarak not edilmiştir; ancak Supabase resmi dokümantasyonunda doğrudan `DELETE` desteklenmemektedir.)*
   - **Kritik Risk 2 – RPC Yetkilendirme Açığı (`satır 92, 129-130`):**
     - `rpc_purge_expired_closed_photos(p_retention_days int)` fonksiyonuna `grant execute ... to authenticated;` verilmiş ve içinde hiçbir rol kontrolü yok. Herhangi bir standart kullanıcı API üzerinden `p_retention_days: 1` parametresiyle tüm 1 günlük kapalı iş fotoğraflarını silebilir.
   - **Kritik Risk 3 – Zamanlayıcı ve Edge Function Durumu:**
     - `supabase/functions/purge-expired-photos` Edge Function henüz **mevcut değil** (yalnızca `parse-energy-document` ve `send-push-notification` var).
     - Migration 0016 satır 219–232'de `pg_cron` bloğu `exception when others then null` ile sarıldığı için canlı Supabase'de `pg_cron` aktifliği ve job'ın kaydolup kaydolmadığı **Doğrulanmamış** durumdadır.
3. **Önerilen Güvenli Mimari:**
   - `rpc_manager_close_ticket` içindeki senkron `rpc_purge_expired_closed_photos(15)` çağrısı kaldırılmalı (iş kapatma kritik yolu temizlik işinden ayrılmalı).
   - `rpc_purge_expired_closed_photos` `authenticated` yetkisinden çıkarılıp yalnızca `service_role` yetkisine alınmalı ve `storage.objects` doğrudan SQL `DELETE` kaldırılmalı.
   - Yeni Edge Function `supabase/functions/purge-expired-photos/index.ts` (yalnızca gizli cron anahtarı / `service_role` ile tetiklenen):
     1. 15 günü aşmış `closed`/`cancelled` kayıtların `attachments` yollarını `batch` (örn. 100'lü) çeker.
     2. Resmi Storage API (`supabase.storage.from('work-attachments').remove(paths)`) ile fiziksel dosyaları siler.
     3. **Yalnızca Storage API'den başarıyla silinen** yolların `public.attachments` satırlarını siler (veya opsiyonel `purged_at` damgasıyla "Fotoğraf 15 günlük saklama süresi sonunda arşiv temizliği ile kaldırıldı" izi bırakır — böylece kayıt ilişkisi ve denetim izi bozulmaz).
   - Günlük `03:00` tetikleme: `pg_cron` + `pg_net` aktifse doğrudan DB'den, değilse GitHub Actions zamanlanmış `schedule` iş akışıyla Edge Function çağrılır.

---

## BÖLÜM 2 – Tespit Edilen Sorunlar

| No | Sorun | Dosya / Konum | Risk | Öncelik | Mevcut Durum |
| :---: | :--- | :--- | :--- | :---: | :--- |
| 1 | Dağıtım script'inde sabit tanımlı SSH parolası ve Git geçmişi maruziyeti | `scripts/deploy_server.mjs:15,49,53,59` | Sunucu tam yetkili erişiminin ifşası | **P0** | Açık |
| 2 | `rpc_purge_expired_closed_photos` içinde rol kontrolsüz `authenticated` erişim + doğrudan `storage.objects` SQL `DELETE` ve `rpc_manager_close_ticket` senkron çağrısı | `supabase/migrations/20261126000016_work_order_completion_and_photo_retention.sql:79-130,211` | Yetkisiz fotoğraf silme; 15 gün sonra iş kapatmanın kilitlenmesi; S3 yetim dosya | **P0** | Açık |
| 3 | Release APK'nın `debug` keystore ile imzalanması | `apps/mobile/android/app/build.gradle.kts:29-35` | Farklı makine/CI derlemesinde OTA güncelleme bozulması, kurulum yenileme zorunluluğu | **P0** | Açık |
| 4 | Kişisel veri (e-posta kalıbı) içeren migration kullanıcı eşleme dosyasının Git'te takip edilmesi ve eksik `.gitignore` | `scripts/migration/user_mapping.generated.json`, `.gitignore:1-36` | Personel PII sızıntısı ve gelecekte keystore/env sızma riski | **P0** | Açık |
| 5 | 4.5G/dış ağ OTA APK dağıtım kopukluğu (`version.json` LAN HTTP URL + GitHub Releases yüklemesi yok) | `apps/web/public/download/version.json:4`, `app_update_service.dart:67-76,346-353`, `scripts/deploy_server.mjs:46-56` | AVM Wi-Fi dışındaki kullanıcıların güncellemeyi indirememesi | **P1** | Açık |
| 6 | `work-orders/page.tsx` istemci taraflı tarih filtresi + `.limit(300)` ve `reports/page.tsx` sessiz `.limit(500)` kırpılması | `apps/web/src/app/(dashboard)/work-tracking/work-orders/page.tsx:212,283-302`, `reports/page.tsx:155`, `apps/mobile/.../data_providers.dart:57` | 300/500 kayıt aşıldığında eksik KPI, yanlış tarih raporu ve eksik Excel/PDF | **P1** | Açık |
| 7 | `OfflineSyncEngine` motorunun hiçbir ekrana bağlı olmaması + motor içi `syncing` kilitlenme / atomik olmayan yazım / `rpc_sync_offline_work_order_status` `completed_by` eksikliği | `apps/mobile/lib/core/database/offline_sync_engine.dart:106-111,234-243`, `create_ticket_screen.dart:111`, `technician_work_order_detail_screen.dart:138`, `reading_entry_sheet.dart:94`, `20261119000006:249-256` | Bodrum/otopark/makine dairesinde çekmeyen alanda kayıt kaybı | **P1** | Açık |
| 8 | CI/CD (`.github/workflows`) yokluğu ve yerel Windows Device Guard engeli nedeniyle testlerin/Shorebird'ün çalışmaması | `.github/workflows/` *(yok)*, `apps/mobile/shorebird.yaml` *(yok)*, `scripts/patch_mobile.mjs:18,23` | Regresyon riski, manuel hata riski, Shorebird OTA'nın atıl kalması | **P1** | Açık |
| 9 | Web sunucusunun yalnızca plain HTTP (`http://10.16.19.19`) kullanması | `scripts/deploy_server.mjs:64-67`, `apps/web/next.config.mjs` *(Nginx canlısı Doğrulanmamış)* | PWA kurulumu, Web Push, QR kamera erişimi ve güvenli Web API kısıtı | **P1** | Açık |
| 10 | `send-push-notification` Edge Function'ında webhook gizli doğrulama kontrolü eksikliği | `supabase/functions/send-push-notification/index.ts:82-98` | `--no-verify-jwt` ile dağıtıldıysa yetkisiz push tetikleme riski *(canlı JWT ayarı Doğrulanmamış)* | **P1** | Açık |
| 11 | 61.27 MB fat APK (ABI split ve R8/ProGuard eksik) | `apps/mobile/android/app/build.gradle.kts:29-35` | 4.5G'de 3 kat yavaş indirme ve yüksek mobil veri tüketimi | **P2** | Açık |
| 12 | Realtime + `window.focus` dinleyicilerinde debounce eksikliği ve `work-tracking/page.tsx` 6 paralel sorgu | `apps/web/.../work-tracking/page.tsx:76-158`, `tickets/page.tsx:244-266`, `work-orders/page.tsx:226-248`, `apps/mobile/.../work_tracking_home_screen.dart:53-79` | Her değişiklikte çift tam yükleme, veritabanı yükü ve arayüz titremesi | **P2** | Açık |
| 13 | Sayaç sıralama kaydında N+1 ardışık `update` döngüsü | `apps/mobile/lib/features/energy/presentation/screens/meter_list_screen.dart:189-200` | Yüksek gecikme ve yarıda kesilirse tutarsız sıralama | **P2** | Açık |
| 14 | Eksik 2 bileşik/kısmi indeks (`work_orders(completed_by, completed_at DESC)`, `tickets(status, closed_at)`) | `supabase/migrations/` | Rapor ve 15 günlük fotoğraf temizliği büyüdükçe yavaşlama | **P2** | Açık |
| 15 | 34 yerde `select('*')` kullanımı ve Web'de istemci önbellek (TanStack Query) eksikliği | `apps/web/package.json`, `layout.tsx` (5x), `definitions/page.tsx` (5x), `data_providers.dart` (3x) vb. | Gereksiz ağ yükü ve sayfa geçişlerinde sürekli spinner | **P2** | Açık |
| 16 | 12 üretim dosyasının 1.000–1.932 satır arası monolitik yapıda olması | `energy/budgets/page.tsx`, `admin/users/page.tsx`, `tickets/page.tsx`, `energy_invoices_screen.dart` vb. | Yüksek bakım maliyeti, gereksiz re-render ve zor test edilebilirlik | **P3** | Açık |
| 17 | `paginatedTicketsProvider` ve `rpc_list_tickets_paginated` tanımlı ama UI'da kullanılmıyor | `apps/mobile/lib/features/work_tracking/providers/data_providers.dart:265-275`, `ticket_list_screen.dart` | Hazır sunucu sayfalamasının değerlendirilmemesi | **P2** | Açık |

---

## BÖLÜM 3 – Daha Önce Çözülmüş Konular

Kod tabanı incelemesinde **hâlihazırda çözülmüş / uygulanmış** olduğu doğrulanan ve yeniden geliştirilmemesi gereken maddeler:

1. **Veritabanı `meter_readings(meter_id, reading_date DESC)` İndeksi:** `idx_meter_readings_meter_date` olarak Migration 0005 (`satır 107`) ve Migration 0006 (`satır 36`) içinde zaten oluşturulmuş durumda.
2. **Offline Idempotency & Sayfalamalı RPC Altyapısı (DB Katmanı):** `tickets.client_mutation_id`, `meter_readings.client_mutation_id`, `rpc_sync_offline_ticket`, `rpc_sync_offline_work_order_status` ve `SECURITY INVOKER` `rpc_list_tickets_paginated` / `rpc_list_meter_readings_paginated` Migration 0004/0005/0006/0013 içinde zaten uygulanmış.
3. **4 Aşamalı KPI Tutarlılığı ve İş Emri Atama Mantığı:** `resolved` kayıtların `Kapandı` sayılmaması, atanan kayıtların arıza bekleme listesinden düşmesi, mükerrer Bento kartlarının temizlenmesi ve `completed_by` sütunu (`20261126000016`) tamamlanmış.
4. **Fotoğraf Sıkıştırma (Web & Mobil):** Mobil (`photo_picker.dart`, `app_utils.dart` – 1200px, %70 JPEG, HEIC desteği) ve Web (`image-compress.ts` – 1200px, %72 WebP) uygulanmış.
5. **İş Emirleri & Raporlar Genişletilmiş Sütunlar:** İstek Açan, Açılış Tarihi, İsteği Tamamlayan, Tamamlanma Tarihi, Çözüm Süresi, tarih seçici ve Excel/PDF dışa aktarım sütunları eklenmiş.
6. **HTTP Ortamında `crypto.randomUUID` Düşüş Koruması:** `tickets/page.tsx` içinde `generateUUID()` yedeği uygulanmış.
7. **Ortak Ekipman 360° ve Planlı Bakım DB İskeleti:** `equipments`, `maintenance_plans` tabloları, RLS politikaları ve `rpc_get_equipment_360_summary` (`20261119000007`) veritabanında zaten mevcut.
8. **Web Birim Test Altyapısı:** `apps/web/tests/permissions_and_modules.test.mjs` ve `energy_readings.test.mjs` (`npm test`) mevcut; sıfır test değil.

---

## BÖLÜM 4 – Faz 1 Uygulama Planı

Ayrıntılı adım-adım yürütme rehberi [FAZ1_UYGULAMA_PLANI.md](file:///C:/Users/talipdastan/.gemini/antigravity/scratch/avm-tech-platform/docs/FAZ1_UYGULAMA_PLANI.md) dosyasında da yer almaktadır. Aşağıda Faz 1 kapsamındaki her iş kaleminin özeti verilmiştir:

### İş 1 – Acil Güvenlik Temizliği (SSH Key, `.gitignore`, PII Dosyası)
- **Yapılacak işlem:** Ubuntu sunucusunda SSH key (`id_ed25519`) yetkilendirilmesi, SSH parolasının değiştirilmesi, `scripts/deploy_server.mjs` içinden sabit şifrenin kaldırılması, `scripts/migration/user_mapping.generated.json` dosyasının `git rm --cached` ile takipten çıkarılması, `.gitignore` güçlendirilmesi ve `scripts/patch_mobile.mjs` içindeki sabit anahtarın env/argüman tabanlı hale getirilmesi.
- **Etkilenecek dosyalar:** `scripts/deploy_server.mjs`, `.gitignore`, `scripts/migration/user_mapping.generated.json` (Git indeksinden çıkarılır), `scripts/patch_mobile.mjs`.
- **Veritabanı değişikliği:** Hayır.
- **Güvenlik etkisi:** Çok Yüksek (P0 SSH parola ve PII sızıntısını kapatır).
- **Test yöntemi:** `git status`, `git ls-files`, SSH key ile `ssh teknik@10.16.19.19 "echo ok"` doğrulaması.
- **Geri alma yöntemi:** `git revert <commit>` (parola değişikliği hariç — parola eski değerine geri alınmamalıdır).
- **Sıra:** 1.

### İş 2 – Fotoğraf 15 Günlük Temizlik Mimarisinin Güvenli Hale Getirilmesi
- **Yapılacak işlem:** Yeni migration (`20261127000017_photo_retention_edge_safe.sql`) ile: (a) `rpc_manager_close_ticket` içindeki senkron `rpc_purge_expired_closed_photos(15)` çağrısını kaldır, (b) `rpc_purge_expired_closed_photos` yetkisini `authenticated`'dan alıp `service_role`'a kısıtla ve doğrudan `storage.objects` SQL `DELETE` ifadesini kaldır, (c) `rpc_list_expired_closed_attachments(p_retention_days, p_batch_limit)` ve `rpc_confirm_purged_attachments(p_attachment_ids)` yardımcı RPC'lerini ekle, (d) `supabase/functions/purge-expired-photos/index.ts` Edge Function'ı ile resmi Storage `remove()` API üzerinden silme + günlük `03:00` otomatik zamanlama (`pg_cron`/`pg_net` veya GitHub Actions cron) kur.
- **Etkilenecek dosyalar:** Yeni `supabase/migrations/20261127000017_...sql`, yeni `supabase/functions/purge-expired-photos/index.ts`, isteğe bağlı `.github/workflows/purge-photos-cron.yml`.
- **Veritabanı değişikliği:** Evet (RPC güncelleme + 2 yardımcı RPC + `tickets(status, closed_at)` kısmi indeksi).
- **Güvenlik etkisi:** Çok Yüksek (P0 yetkisiz silme açığını ve 15. gün iş kapatma kilitlenmesini önler).
- **Test yöntemi:** Test kaydında `dry_run=true` çağrısı → ardından izole test kaydında gerçek Storage silme + `attachments` silinme doğrulaması + standart kullanıcı token'ı ile RPC'nin `403/permission denied` döndüğünün doğrulanması.
- **Geri alma yöntemi:** Önceki RPC tanımına geri dönüş migration'ı + Edge Function cron durdurma.
- **Sıra:** 2.

### İş 3 – Kalıcı Android Release Keystore ve ABI-Split APK Yapılandırması
- **Yapılacak işlem:** Tek seferlik kurumsal `upload-keystore.jks` üretimi (yerel şifreli yedek + GitHub Secrets), `apps/mobile/android/app/build.gradle.kts` içinde `key.properties` tabanlı release signing + R8 (`isMinifyEnabled = true`, `isShrinkResources = true`, `proguard-rules.pro`) + `--split-per-abi` derleme profili yapılandırması. `version.json` şemasına geriye uyumlu `apkUrls: { arm64, armeabi, universal }` eklenmesi ve `AppUpdateService`'in cihaz ABI'sini seçebilmesi.
- **Etkilenecek dosyalar:** `apps/mobile/android/app/build.gradle.kts`, `apps/mobile/android/app/proguard-rules.pro` (yeni), `apps/mobile/lib/core/update/app_update_service.dart`, `apps/web/public/download/version.json`, `apps/web/src/app/download/page.tsx`.
- **Veritabanı değişikliği:** Hayır.
- **Güvenlik etkisi:** Çok Yüksek (İmza bütünlüğü ve kurumsal güncelleme sürekliliği).
- **Test yöntemi:** `flutter build apk --release --split-per-abi`, `apksigner verify --print-certs`, fiziksel telefonda temiz kurulum → sürüm artışı ile uygulama içi güncelleme testi. *(Not: Debug imzadan release imzaya geçişte mevcut telefonlarda 1 kerelik kaldır-kur gerekir.)*
- **Geri alma yöntemi:** `git revert` (yeni imzaya geçilmeden önce planlı duyuru ile uygulanmalı).
- **Sıra:** 3.

### İş 4 – GitHub Actions CI/CD, Otomatik GitHub Releases ve Shorebird Linux Hattı
- **Yapılacak işlem:** `.github/workflows/ci.yml` (Web lint/test/build + Mobil analyze/test) ve `.github/workflows/release-mobile.yml` (tag `v*` ile imzalı APK derleme → GitHub Releases yükleme → `version.json` HTTPS link eşleştirme + opsiyonel Shorebird Linux `release`/`patch` iş akışı). `send-push-notification` Edge Function'ına paylaşılan webhook gizli başlık kontrolü eklenmesi.
- **Etkilenecek dosyalar:** `.github/workflows/ci.yml` (yeni), `.github/workflows/release-mobile.yml` (yeni), `apps/mobile/shorebird.yaml` (Shorebird hesabı bağlandığında), `supabase/functions/send-push-notification/index.ts`.
- **Veritabanı değişikliği:** Hayır.
- **Güvenlik etkisi:** Yüksek (Otomatik test kapısı + 4.5G HTTPS OTA + webhook koruması).
- **Test yöntemi:** Test branch'inde PR açıp CI yeşil geçişini doğrulama; pre-release tag ile GitHub Releases APK indirme testi (4.5G üzerinden).
- **Geri alma yöntemi:** Workflow dosyalarını devre dışı bırakma / revert.
- **Sıra:** 4.

### İş 5 – Veri Doğruluğu: `.limit(300/500)` Kaldırma, Sunucu Agregasyon RPC ve 2 Kısmi İndeks
- **Yapılacak işlem:**
  - Yeni migration: `idx_work_orders_completed_by_at` (`work_orders(completed_by, completed_at DESC) WHERE completed_by IS NOT NULL`), `idx_tickets_closed_status_at` (`tickets(status, closed_at) WHERE status IN ('closed', 'cancelled')`), `rpc_work_tracking_dashboard_summary()` (6 sorguyu tek RPC'ye indirme), `rpc_work_tracking_report_summary(p_start, p_end)` (sınırsız tarih KPI/departman özeti), `rpc_reorder_meters(p_meter_ids uuid[])` (N+1 çözümü).
  - Web `work-orders/page.tsx`: Tarih ve durum filtrelerini sunucu taraflı (`.gte`/`.lte` + sayfalama) hale getirme.
  - Web `reports/page.tsx`: KPI ve grafikleri sunucu RPC'sinden çekme, tablo için sayfalı/tam dışa aktarım + kırpılma uyarısı.
  - Mobil `TicketListScreen`: Hazır olan `paginatedTicketsProvider` (`rpc_list_tickets_paginated`) bağlantısı.
  - Mobil `meter_list_screen.dart`: `_saveReorder` döngüsünü `rpc_reorder_meters` tek çağrısına çevirme.
- **Etkilenecek dosyalar:** Yeni migration SQL, `apps/web/src/app/(dashboard)/work-tracking/page.tsx`, `work-orders/page.tsx`, `reports/page.tsx`, `apps/mobile/lib/features/work_tracking/presentation/screens/ticket_list_screen.dart`, `apps/mobile/lib/features/energy/presentation/screens/meter_list_screen.dart`.
- **Veritabanı değişikliği:** Evet (2 kısmi indeks + 3 `SECURITY INVOKER` RPC).
- **Güvenlik etkisi:** Nötr/Pozitif (Tüm yeni RPC'ler `SECURITY INVOKER` ile RLS uyumlu).
- **Test yöntemi:** 500+ sentetik test verisi veya tarih filtresi testi, `EXPLAIN ANALYZE` indeks doğrulaması, `npm test` + CI `flutter test`.
- **Geri alma yöntemi:** Frontend revert + eklenen RPC/indeksleri `DROP` eden geri alma SQL'i.
- **Sıra:** 5.

### İş 6 – Realtime Debounce, `select('*')` Daraltma ve Web TanStack Query
- **Yapılacak işlem:** Web'de ortak `useDebouncedRealtime` hook'u (500ms debounce) ve `@tanstack/react-query` `QueryClientProvider` entegrasyonu (mevcut sayfaları bozmadan kademeli geçiş); Mobilde `work_tracking_home_screen.dart` Realtime dinleyicisine `Timer` debounce (500ms); kritik liste sorgularında `select('*')` yerine yalnızca kullanılan sütunların seçilmesi.
- **Etkilenecek dosyalar:** `apps/web/package.json`, `apps/web/src/app/providers.tsx` (yeni), `apps/web/src/core/hooks/useDebouncedRealtime.ts` (yeni), `work-tracking/*.tsx`, `apps/mobile/lib/features/work_tracking/presentation/screens/work_tracking_home_screen.dart`, `data_providers.dart`.
- **Veritabanı değişikliği:** Hayır.
- **Güvenlik etkisi:** Nötr (daha az sütun transferi ile veri minimizasyonu).
- **Test yöntemi:** Tarayıcı Network sekmesinde tek iş emri atamasında sorgu sayısının 8–12'den 1–2'ye düştüğünün doğrulanması.
- **Geri alma yöntemi:** `git revert`.
- **Sıra:** 6.

### İş 7 – Offline Motor Hata Düzeltmeleri ve Saha Ekranlarına Bağlama
- **Yapılacak işlem:**
  - `offline_sync_engine.dart`: Başlangıçta `SyncStatus.syncing` kalan kayıtları `pending`'e döndüren `recoverInterruptedSyncs()` eklenmesi + geçici dosya ile atomik JSON yazımı.
  - DB Migration: `rpc_sync_offline_work_order_status` içine `completed_by = auth.uid()` ve mükerrer yorum koruması eklenmesi.
  - Mobil: `connectivity_plus` eklenip `OfflineSyncProvider` üzerinden `create_ticket_screen.dart` (`rpc_sync_offline_ticket`), `technician_work_order_detail_screen.dart` (`rpc_sync_offline_work_order_status`) ve `reading_entry_sheet.dart` (`rpc_record_meter_reading`) çevrimdışı düşüşte kuyruğa bağlanır; üst çubukta "Bekleyen X kayıt" göstergesi eklenir.
- **Etkilenecek dosyalar:** `apps/mobile/pubspec.yaml`, `offline_sync_engine.dart`, yeni `offline_sync_provider.dart`, `create_ticket_screen.dart`, `technician_work_order_detail_screen.dart`, `reading_entry_sheet.dart`, yeni migration SQL.
- **Veritabanı değişikliği:** Evet (`rpc_sync_offline_work_order_status` güncellemesi).
- **Güvenlik etkisi:** Pozitif (Aynı RLS/RPC yetki denetimi korunur).
- **Test yöntemi:** Uçak modunda arıza + fotoğraf + sayaç okuma kaydı → internet açıldığında tekil (çift kayıt oluşturmadan) senkronizasyon doğrulaması + birim testler.
- **Geri alma yöntemi:** Feature flag ile offline kuyruğu devre dışı bırakma / `git revert`.
- **Sıra:** 7.

### İş 8 – Web HTTPS Geçişi ve Monolitik Dosyaların Kademeli Ayrıştırılması
- **Yapılacak işlem:** İç ağda yerel CA/HTTPS (veya kurumsal alan adı + Nginx SSL) geçiş planı; `next.config.mjs` güvenlik başlıkları; 1.000+ satırlık dosyalardan en sık değiştirilenlerin (`tickets/page.tsx`, `work-orders/page.tsx`, `energy/budgets/page.tsx`) davranışı değiştirmeden alt bileşenlere (`components/`) bölünmesi.
- **Etkilenecek dosyalar:** `apps/web/next.config.mjs`, Nginx yapılandırması (sunucuda onay sonrası), ilgili modül alt bileşen klasörleri.
- **Veritabanı değişikliği:** Hayır.
- **Güvenlik etkisi:** Yüksek (HTTPS ile tarayıcı içi taşıma şifrelemesi ve PWA/QR desteği).
- **Test yöntemi:** `next build` + tarayıcıda PWA yüklenebilirlik & kamera/bildirim izni kontrolü.
- **Geri alma yöntemi:** Nginx konfigürasyon yedeğine dönüş / `git revert`.
- **Sıra:** 8.

---

## BÖLÜM 5 – Bağımlılıklar ve Riskler

1. **Keystore (İş 3) → CI/CD & Shorebird (İş 4) Bağımlılığı:** Shorebird ve GitHub Actions otomatik APK derlemesi **kesinlikle** kalıcı release keystore oluşturulduktan sonra kurulmalıdır. Aksi halde Shorebird ana sürümü debug imzaya bağlanır ve sonradan değiştirilemez.
2. **Debug → Release İmza Geçiş Riski:** Mevcut sahadaki Android telefonlar `debug` imzalı v1.2.4 APK kullanıyor. Kalıcı release keystore ile ilk sürüm (örn. v1.3.0) yayınlandığında teknisyenlerin uygulamayı **bir defaya mahsus kaldırıp yeniden kurması** gerekecektir. Bu tek seferlik geçişten sonra tüm gelecek güncellemeler sorunsuz üstüne kurulacaktır.
3. **ABI-Split → `AppUpdateService` & `/download` Uyumluluğu:** `arm64-v8a` ve `armeabi-v7a` APK'ları ayrıldığında `AppUpdateService` cihaz mimarisini (`Platform` / native `Build.SUPPORTED_ABIS`) okuyup doğru URL'yi çekmelidir; eski sürüm kullanan kullanıcıların bozulmaması için `version.json` içindeki mevcut `apkUrl` alanı korunup yeni `apkUrls` alanı geriye uyumlu eklenmelidir.
4. **Fotoğraf Temizliği (İş 2) Zaman Riski:** Migration 0016 canlı veritabanında 2026-11-26'da uygulandı. İlk kapalı işin üzerinden 15 gün geçmeden (yani **~2026-12-11 öncesinde**) İş 2 tamamlanmazsa `rpc_manager_close_ticket` içindeki `storage.objects` doğrudan SQL `DELETE` çağrısı canlı iş kapatmayı kesintiye uğratabilir.
5. **Offline Bağlama (İş 7) → DB RPC Güncellemesi:** `OfflineSyncEngine` iş emri tamamlamaya bağlanmadan önce `rpc_sync_offline_work_order_status` içine `completed_by = auth.uid()` eklenmelidir; yoksa offline tamamlanan işlerde "İsteği Tamamlayan" boş düşer.
6. **HTTP → HTTPS Geçişi (İş 8):** Web yalnızca yerel IP (`10.16.19.19`) ile kalacaksa Let's Encrypt kullanılamaz; dahili alan adı + yerel CA veya ters proxy/tünel mimarisi seçimi önceden kararlaştırılmalıdır.

---

## BÖLÜM 6 – Faz 2 ve Faz 3 Hazırlık Durumu

| Gelecek Özellik / Modül | Hazırlık | Mevcut Altyapı Durumu | Faz 1'den Beklenen / Eksik Ön Koşullar |
| :--- | :---: | :--- | :--- |
| **Offline Saha Kayıt Altyapısı** | **%65** | DB'de `client_mutation_id` + 2 offline RPC hazır; Mobilde 432 satırlık motor + testler var. | Motor içi `syncing` bug + atomik yazım + `completed_by` RPC düzeltmesi + `connectivity_plus` + ekran bağlantısı. |
| **Ekipman & Mahal İlişkileri** | **%85** | `equipments` tablosu `location_id`, `department_id`, `warranty_end_date`, `metadata jsonb`, `code unique` ile güçlü; `rpc_get_equipment_360_summary` hazır. | Mobilde ekipman ekranı yok (yalnızca Web `admin/equipments/page.tsx` var). |
| **QR Kod ile Ekipman/Mahal Erişimi** | **%50** | `equipments.code` benzersiz (unique) alan olarak mevcut; `locations` ID ile bağlanabilir. | Mobilde QR tarama paketi (`mobile_scanner`), Web'de toplu QR PDF şablonu ve HTTPS (Web kamera için) eksik; `locations` tablosuna isteğe bağlı benzersiz `code` kolonu önerilir. |
| **SLA ve Bildirim Altyapısı** | **%55** | `notifications` tablosu, Realtime dinleyici, `send-push-notification` FCM v1 Edge Function ve `tickets.priority` mevcut. | `sla_policies` (öncelik bazlı müdahale/çözüm hedef dakikaları), `tickets.sla_due_at`, eskalasyon cron job'ı ve Edge Function webhook güvenliği eksik. |
| **Reaktif Enerji Otomasyonu** | **%75** | `meter_readings` içinde `inductive_percent`, `capacitive_percent` hesaplanıyor; `meters.equipment_id` bağlantısı var; `tickets` oluşturma RPC'leri hazır. | `meters` tablosuna reaktif eşik/alarm bayrağı (veya sistem ayarları) + `rpc_record_meter_reading` sonunda eşik aşımında idempotent otomatik `Acil` ticket tetikleyicisi eklenmesi yeterli. |
| **Planlı Bakım (`maintenance_plans`)** | **%70** | `maintenance_plans` tablosu (`frequency`, `checklist jsonb`, `next_due_date`, `assigned_to`, `status`), 2 indeks ve 4 RLS politikası Migration 0007'de hazır; `moduleRegistry.ts`'de `maintenance` kayıtlı. | Web/Mobil UI ekranları, `maintenance_executions` (gerçekleşen bakım/checklist kayıt geçmişi) tablosu ve "Uygun Değil → Otomatik Arıza Aç" RPC'si eksik. |
| **İş Emri Malzeme (`work_order_materials`)** | **%60** | `work_order_materials` (`material_name`, `quantity`, `unit`, `note`, `recorded_by`) aktif; mobilde giriş mevcut. | Web iş emri detay çekmecesinde gösterim eksik; stok modülüne bağlamak için opsiyonel `inventory_item_id` FK gerekecek (serbest metin geriye uyumlu korunarak). |
| **Stok Hareketleri Veri Modeli** | **%15** | Yalnızca `work_order_materials` serbest metin tablosu var. | `inventory_items`, `inventory_warehouses`, `stock_movements` (giriş/çıkış/kritik seviye) tabloları ve `work_order_materials` ile otomatik stok düşüm tetikleyicisi tasarlanmalı. |
| **Vardiya Devir Teslimi** | **%20** | `profiles`, `departments`, `tickets`, `equipments` ilişkileri mevcut; vardiya tablosu yok. | `shift_handovers` + `shift_handover_items` (otomatik açık kritik işler + devreden/teslim alan imzası) tablosu gerekli. |
| **Dış Servis & Sözleşme Yönetimi** | **%25** | `equipments` (`warranty_end_date`, `metadata`) ve `energy-documents` benzeri private Storage deseni hazır. | `vendors`, `maintenance_contracts`, `service_reports` tabloları, belge bucket'ı ve sözleşme bitiş hatırlatma cron'u gerekli. |

---

## BÖLÜM 7 – Önerilen İlk 10 İş (En Yüksek Fayda / En Düşük Risk Sırasıyla)

1. **SSH Parolasını Koddan Kaldır, SSH Key'e Geç ve `user_mapping.generated.json` Dosyasını Git'ten Çıkar + `.gitignore` Güçlendir** *(P0 · 30 dk · Sıfır uygulama riski)*
2. **Migration 0016 Fotoğraf Temizliği Açığını ve 15. Gün İş Kapatma Kilidini Kapat (`rpc_manager_close_ticket`'tan ayır + `service_role` kısıtı + `purge-expired-photos` Edge Function)** *(P0 · Yarım gün · Canlı kesintiyi önler)*
3. **Kalıcı Android Release Keystore Oluştur ve `build.gradle.kts` Signing + ProGuard/R8 Yapılandır** *(P0 · 1 saat · Gelecek tüm OTA'ların temeli)*
4. **`--split-per-abi` (20–22 MB APK) + `version.json` / `AppUpdateService` Çoklu ABI ve 4.5G HTTPS İndirme Uyumu** *(P1/P2 · Yarım gün · 3x hızlı 4.5G güncelleme)*
5. **GitHub Actions CI/CD Kur (`ci.yml` + `release-mobile.yml` → Otomatik Test, İmzalı APK, GitHub Releases Yükleme)** *(P1 · Yarım gün · Windows Device Guard engelini aşar, 4.5G OTA'yı tamamlar)*
6. **2 Eksik Kısmi İndeksi (`work_orders(completed_by, completed_at DESC)`, `tickets(status, closed_at)`) ve Sunucu Özet/Rapor RPC'lerini Ekle; `work-orders` & `reports` `.limit(300/500)` Kırpılmasını Düzelt** *(P1 · 1 gün · Veri ve rapor doğruluğu)*
7. **Web ve Mobil Realtime Dinleyicilerine 500ms Debounce + `work-tracking/page.tsx` 6 Sorguyu Tek RPC'ye İndirme + `meter_list_screen` N+1 Sıralamayı Tek RPC'ye Çevirme** *(P2 · Yarım gün · Anında hissedilen hız artışı)*
8. **`send-push-notification` Edge Function Webhook Gizli Başlık Doğrulaması** *(P1 · 30 dk · Push suistimalini önler)*
9. **`OfflineSyncEngine` İçindeki `syncing` Kilitlenme & Atomik Yazım Bug'larını + `rpc_sync_offline_work_order_status` `completed_by` Eksikliğini Düzelt ve Saha Ekranlarına Bağla** *(P1 · 1.5 gün · Bodrum/otopark veri güvenliği)*
10. **Web'de TanStack Query Altyapısı + `select('*')` Temizliği + Shorebird Linux OTA Aktivasyonu** *(P2 · 1–2 gün · Akıcı gezinme ve APK'sız Dart yaması)*

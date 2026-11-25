# AVM TECH – VERİ AKTARIM PLANI (`MIGRATION.md`)

> **Sürüm:** `v0.1.0-docs`  
> **Kapsam:** Mevcut Firebase/Firestore (`sayac_takip_app`) verilerinin ve mevcut `TEKNİK İŞ İSTEK` verilerinin yeni birleşik Supabase veritabanına güvenli, doğrulanabilir ve sıfır veri kayıplı aktarımı.

---

## 1. Temel Güvenlik ve Koruma İlkeleri

1. **Eski Sistemlere Sıfır Müdahale:** Aktarım süresince ve doğrulama tamamlanana kadar eski `sayac_takip_app` (Firebase) ve `TEKNİK İŞ İSTEK` sistemleri çalışmaya devam eder; eski veritabanlarından hiçbir kayıt silinmez veya değiştirilmez.
2. **Önce Yedekleme (Snapshot):** Herhangi bir aktarım scripti çalıştırılmadan önce tüm Firestore koleksiyonlarının zaman damgalı tam JSON yedeği alınır ve salt-okunur arşivlenir.
3. **İdempotent Aktarım:** Aktarım scripti `legacy_id` ve `legacy_firebase_uid` alanları üzerinden `UPSERT` mantığıyla çalışır; tekrar çalıştırıldığında mükerrer (duplicate) kayıt üretmez.
4. **Tam Tarihçe ve Sahiplik Korunumu:** Eski okumaların orijinal `date` / `createdAt` zaman damgaları, `enteredBy` kullanıcı bilgileri ve varsa dosya/PDF/fotoğraf bağlantıları eksiksiz korunur.

---

## 2. Kaynak Veri Envanteri (`sayac_takip_app` – Firebase)

Proje ID: `sayac-takip-avm-2026`

| Firestore Koleksiyonu | Kayıt Yapısı | Hedef Supabase Tablosu |
|---|---|---|
| `users` | `uid`, `name`, `role`, `canEnterData`, `canAddMeter`, `canAccessInvoices` | `auth.users` + `public.profiles` (`legacy_firebase_uid`, `permissions`) |
| `meters` | `id`, `name`, `multiplier`, `type`, `orderIndex`, `category`, `meterNo`, `contractNo`, `eicCode`, `tekilCode`, `subscriberNo`, `region` | `public.meters` (`legacy_id` = Firestore doc ID) |
| `meters/{meterId}/readings` | `id`, `meterId`, `date`, `active`, `inductive`, `capacitive`, `indPercent`, `capPercent`, `index`, `consumption`, `enteredBy` | `public.meter_readings` (`legacy_id`, `meter_id` FK) |
| `invoices` | `id`, `year`, `month`, `utilityType`, `provider`, `invoiceNo`, `invoiceDate`, `invoiceType`, `meterId`, `meterName`, `meterNo`, `contractNo`, `eicCode`, `tekilCode`, `consumption`, `amountTL`, `inductivePenaltyTL`, `capacitivePenaltyTL`, `tenantConsumption`, `tenantAmountTL`, `notes`, `enteredBy`, `createdAt` | `public.energy_invoices` (`legacy_id`, `meter_id` FK) |
| `budgets` | `id` (`YYYY_MM_type`), `year`, `month`, `utilityType`, `budgetConsumption`, `budgetTL`, `prevYearConsumption`, `prevYearTL` | `public.energy_budgets` |

---

## 3. Kullanıcı ve Kimlik Eşleştirme Stratejisi

`sayac_takip_app` kullanıcıları arka planda `username@sayacavm.com` (ve silinip yeniden açılanlarda `username1@sayacavm.com` gibi suffix'li) e-postalarla Firebase Auth'ta tutulmaktadır.

### Eşleştirme Adımları
1. **Eşleştirme Tablosu Hazırlığı (`user_mapping.json`):**
   - Firestore `users` koleksiyonu dışa aktarılır.
   - Her kullanıcı için mevcut AVM TECH Supabase `profiles` tablosunda karşılığı olup olmadığı (ad/soyad bazlı) yönetici ile birlikte eşleştirilir.
2. **Durum 1 – Kullanıcı zaten AVM TECH'te varsa:**
   - Mevcut Supabase `profiles.id` korunur.
   - `profiles.legacy_firebase_uid` alanına Firebase UID yazılır.
   - Kullanıcının `profiles.permissions.modules.energy` izinleri Firestore'daki `canEnterData`, `canAddMeter`, `canAccessInvoices` değerlerine göre açılır.
3. **Durum 2 – Kullanıcı yalnızca Sayaç Takip'te varsa:**
   - Supabase Admin API ile yeni kullanıcı oluşturulur (`approval_status = 'approved'`), `legacy_firebase_uid` kaydedilir ve geçici ilk giriş şifresi/sıfırlama bağlantısı verilir.
4. **Silinmiş / Tarihsel Kullanıcılar:**
   - Eski okumaların `enteredBy` alanında adı geçen ancak artık aktif olmayan kullanıcılar için `entered_by_id = NULL`, `entered_by_name = '<eski_isim>'` olarak saklanır; hiçbir geçmiş okuma kaybı yaşanmaz.

---

## 4. Adım Adım Aktarım Süreci (5 Faz)

### Faz 1: Yedekleme ve İnceleme (Read-Only)
- Firebase Admin SDK ile salt-okunur export scripti çalıştırılır → `backups/firestore_export_YYYYMMDD.json`.
- Tüm koleksiyon sayıları ve toplam metrikler (toplam elektrik/su/gaz tüketimi, toplam fatura tutarı TL) bir özet rapora yazılır.

### Faz 2: Staging (Test) Ortamına Aktarım
- Yeni Supabase test/staging projesinde şema migration'ları çalıştırılır.
- Aktarım sırası (FK bağımlılık sırasına göre):
  1. `profiles` (kullanıcı eşleştirme & `legacy_firebase_uid`)
  2. `meters` (`legacy_id` → yeni UUID haritası üretilir)
  3. `meter_readings` (`meter_id` ve `entered_by_id` eşleştirilerek, orijinal `Timestamp` korunarak `timestamptz` aktarılır)
  4. `energy_invoices` (orijinal `invoiceDate`, `createdAt`, `meter_id`, kiracı/ortak alan ve ceza tutarları korunarak)
  5. `energy_budgets` (`period_year`, `period_month`, `utility_type` benzersiz anahtarıyla)

### Faz 3: Dosya / PDF / Fotoğraf Korunumu
- Mevcut `TEKNİK İŞ İSTEK` Supabase Storage (`attachments`) dosyaları yeni ortama aynı klasör yolu ve metadata ile taşınır (eğer aynı Supabase projesi yerine yeni proje açılırsa Storage bucket senkronizasyonu scripti çalıştırılır).
- Mevcut `sayac_takip_app` cihaz içi geçici PDF'ler dışında Storage kullanmamaktadır; ancak arşivlenmiş PDF faturalar varsa yeni `energy-documents` bucket'ına yüklenip `energy_invoices.pdf_storage_path` ile bağlanabilir.

### Faz 4: Otomatik Doğrulama (Verification Checklist)
Aktarım sonrası doğrulama scripti aşağıdaki kontrolleri otomatik yapar ve %100 eşleşme arar:

- [ ] **Sayaç Sayısı:** `Firestore meters.count == PostgreSQL meters.count`
- [ ] **Okuma Sayısı (Sayaç Bazlı):** Her `meter` için `Firestore readings.count == PostgreSQL meter_readings.count`
- [ ] **Tüketim Toplamı:** Her sayaç için `SUM(consumption)` farkı `< 0.001`
- [ ] **Tarih Aralığı:** Her sayaç için `MIN(date)` ve `MAX(date)` birebir eşit
- [ ] **Fatura Sayısı ve Toplam Tutar:** Yıl ve tür bazlı `COUNT(*)` ve `SUM(amount_tl)` birebir eşit
- [ ] **Bütçe Kayıtları:** Yıl bazlı `COUNT(*)` ve `SUM(budget_tl)` birebir eşit
- [ ] **Yetki Doğrulaması:** Örnek admin ve personel hesaplarıyla giriş yapılıp RLS erişimleri test edilir.

### Faz 5: Paralel Çalışma ve Geçiş (Cutover)
1. Yeni birleşik uygulama sahada pilot kullanıcılarla 1–2 hafta paralel çalıştırılır.
2. Geçiş günü (cutover) son 1–2 haftalık delta okumalar tekrar idempotent scriptle senkronize edilir.
3. Yönetici onayı sonrası eski uygulamalar salt-okunur (arşiv) moda alınır; **Firebase projesi en az 3 ay silinmeden arşiv olarak saklanır.**

---

## 5. Geri Dönüş (Rollback) Planı

- Eski Firebase (`sayac_takip_app`) ve mevcut `TEKNİK İŞ İSTEK` sistemlerine hiç dokunulmadığı için, geçiş sırasında beklenmedik bir sorun yaşanırsa kullanıcılar anında eski uygulamalara dönebilir.
- Yeni Supabase ortamında aktarım kaynaklı bir hata oluşursa yalnızca `energy` tabloları temizlenip (`TRUNCATE ... CASCADE`) düzeltilmiş script ile aktarım baştan tekrarlanabilir; `work_tracking` verileri etkilenmez.

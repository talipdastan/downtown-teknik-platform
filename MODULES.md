# AVM TECH – MODÜL SİSTEMİ VE KAYIT MİMARİSİ (`MODULES.md`)

> **Sürüm:** `v0.1.0-docs`  
> **Amaç:** Mevcut ve gelecek tüm teknik modüllerin ana uygulamayı değiştirmeden sisteme takılıp çıkarılabilmesini sağlayan modül sözleşmesini tanımlamak.

---

## 1. Sade ve Genişletilebilir Modül Kayıt Sistemi (`ModuleRegistry`)

Ana ekrana yeni bir modül eklemek veya mevcut bir modülü pasife almak için diğer modüllerin veya ana ekranın iş mantığını değiştirmek gerekmez. Ancak **gereksiz karmaşık bir dinamik eklenti yükleyici (runtime plugin loader / reflection) kurulmaz**; bunun yerine derleme zamanında açıkça tanımlı, tip güvenli ve bakımı kolay bir `ModuleRegistry` listesi kullanılır.

### Modül Sözleşmesi (`AppModule` / `WebModuleDefinition`)
Her modül sisteme aşağıdaki standart arayüzle kayıt olur:

```dart
// Mobil (Flutter) Modül Sözleşmesi
abstract class AppModule {
  String get key;                  // Örn: 'energy', 'work_tracking'
  String get title;                // Örn: 'Enerji Takip'
  String get subtitle;             // Örn: 'Sayaçlar, okumalar, faturalar ve bütçe'
  IconData get icon;               // Modül ikonu
  Color get accentColor;           // Modül vurgu rengi
  String get entryRoute;           // Örn: '/energy'
  int get sortOrder;               // Sıralama
  bool get isComingSoon;           // Geliştirme aşamasındaki gelecek modüller için

  /// Kullanıcının bu modülü görüp girebileceğini kontrol eder
  bool canAccess(ProfileModel profile);

  /// Modüle ait GoRouter rotalarını döndürür (ana router otomatik ekler)
  List<RouteBase> buildRoutes();

  /// Modül içi alt menü / sekmeleri tanımlar
  List<ModuleNavItem> get navItems;
}
```

### Nasıl Çalışır?
1. **Veritabanı Katmanı (`system_modules`):** Hangi modüllerin sistem genelinde açık (`is_enabled`), hangilerinin "Yakında" (`is_coming_soon`) olduğu Supabase'de yönetilir.
2. **İstemci Kayıt Defteri (`ModuleRegistry`):** Uygulama başlarken aktif modüller tek bir sabit listeden kaydedilir. `GoRouter` (mobil) ve Sidebar (web) rotaları bu kayıt defterinden otomatik üretilir.
3. **Ana Ekran (Modül Seçim Ekranı):** `system_modules` + `ModuleRegistry` + kullanıcının `permissions` bilgisi birleştirilerek yalnızca kullanıcının yetkili olduğu aktif modüller kart olarak gösterilir.
4. **İhtiyaç Anında Yükleme:** Modüllerin veri sağlayıcıları yalnızca ilgili modül rotasına girildiğinde tetiklenir.
5. **Ortak Altyapı Yeniden Kullanımı:** Gelecekte Planlı Bakım gibi bir modül eklendiğinde ekipman yönetimi, bildirimler, kullanıcı/yetki ve raporlama katmanları tekrar yazılmaz; doğrudan `core/` üzerinden kullanılır.

---

## 2. İlk Sürüm Aktif Modülleri

### 2.1 Enerji Takip Modülü (`energy`)
Mevcut `sayac_takip_app` uygulamasının tamamını kapsar ve web paneline genişletir.

- **Sorumluluk Alanı:**
  - Elektrik sayaçları (`GT.ADP.1..4`, `KAZAN-ADP`, `HAVUZ-ADP`, `MCC-ADP` ve yeni eklenenler)
  - Mekanik sayaçlar (`water`, `cooling`, `gas`, `other`)
  - Sayaç ekleme, düzenleme, silme, sürükle-bırak sıralama (`sort_order`), çarpan (`multiplier`) yönetimi
  - Sayaç kimlik eşleştirme (Sayaç No, Sözleşme No, EIC Kodu, Tekil Kod, Abone No, Bölge)
  - Günlük ve aylık okuma girişi, okuma geçmişi, düzenleme ve silme
  - Reaktif güç ceza kontrolü (İndüktif > %20, Kapasitif > %15) ve bildirim uyarısı
  - **PDF Fatura Okuma & Analiz:** Supabase Edge Function üzerinden Gemini destekli otomatik fatura çıkarımı, sayaç eşleştirme, çakışma yönetimi (`merge`, `separate`, `overwrite`, `skip`), kiracı/ortak alan payı ayrımı
  - **Bütçe & Geçmiş Yıl Karşılaştırma:** `.xlsx`, `.csv`, `.pdf` dosyalarından bütçe içe aktarma ve aylık sapma analizi
  - **Excel Raporlama:** Elektrik, mekanik, fatura ve bütçe raporlarının `.xlsx` dışa aktarımı
  - **Offline Okuma:** İnternet yokken girilen okumaların yerel kuyruğa alınması
- **Sahip Olduğu Tablolar:** `meters`, `meter_readings`, `energy_invoices`, `energy_budgets`
- **Çekirdek İlişkileri:** `profiles` (okuyan/giren), `equipments` (opsiyonel bağlı ekipman), `locations` (opsiyonel sayaç yeri), `notifications` (reaktif ceza bildirimi)

### 2.2 İş Takip Modülü (`work_tracking`)
Mevcut `TEKNİK İŞ İSTEK (AVM TECH)` uygulamasının tüm işlevlerini eksiksiz korur.

- **Sorumluluk Alanı:**
  - Hızlı arıza bildirimi (Kat/Mahal/Kategori + "Diğer" serbest metin desteği + Fotoğraf)
  - Arıza durum yaşam döngüsü (`new` → `under_review` → `assigned` → `in_progress` → `waiting` → `resolved` → `closed` / `cancelled`)
  - İş emri oluşturma, departman/teknisyen atama, ekip iş havuzu
  - Saha müdahalesi: İşe başlama, gerekçeli beklemeye alma, malzeme kullanımı kaydetme, çözüm fotoğrafı ekleme, tamamlandı bildirme
  - Yönetici ve bildirici çözüm onay/iade akışı (3 onay bekleyen kayıt limiti korunur)
  - Yorumlar, öncesi/sonrası fotoğraf karşılaştırma, durum geçmişi (`status_history`)
  - Push bildirimler (FCM) + Realtime canlı güncelleme
  - Web yönetim paneli (Genel Bakış, Arızalar, İş Emirleri, İnceleme/Onay, Raporlar - Excel/PDF)
  - Offline arıza taslakları (Drift/SQLite)
- **Sahip Olduğu Tablolar:** `categories`, `tickets`, `work_orders`, `work_order_assignments`, `work_order_materials`, `comments`, `attachments`, `status_history`
- **Çekirdek İlişkileri:** `profiles`, `departments`, `floors`, `locations`, `equipments` (opsiyonel arızalı ekipman), `notifications`

---

## 3. Gelecek Modüller (Mimari Hazırlık)

Bu modüller ilk sürümde geliştirilmeyecek, ancak `system_modules` ve `equipments` altyapısı sayesinde ileride bağımsız klasör ve tablolarla sisteme takılabilecektir:

| Modül Anahtarı | Modül Adı | Kapsam | Çekirdek / Diğer Modül İlişkisi |
|---|---|---|---|
| `maintenance` | **Planlı Bakım** | Periyodik bakım planları, bakım takvimi, kontrol listeleri (checklist), bakım formları | `equipments` üzerinden ekipmana bağlanır; uygunsuzluk durumunda `work_tracking` için arıza tetikleyebilir. |
| `assets` | **Demirbaş & Ekipman Yönetimi** | Detaylı ekipman kartları, garanti, demirbaş numarası, teknik ömür ve tarihçe | Çekirdek `equipments` tablosunu ana kaynak olarak kullanır; o ekipmana ait sayaç, arıza ve bakım geçmişini tek ekranda birleştirir. |
| `documents` | **Teknik Doküman Yönetimi** | Projeler, tek hat şemaları, kullanım kılavuzları, periyodik muayene raporları | `equipments` ve `locations` kayıtlarına bağlı `equipment-docs` bucket'ı kullanır. |
| `bms` | **Otomasyon ve BMS Takibi** | Bina yönetim sistemi alarm kayıtları, sıcaklık/basınç/nem eşikleri | `equipments` ve `notifications` altyapısını kullanır. |
| `energy_analytics` | **Enerji Analiz & Performans** | KPI, kWh/m² yoğunluk, anomali tespiti, karbon ayak izi | `energy` modülünün read-only özet view'larını okur. |
| `procurement` | **Satın Alma & Malzeme Yönetimi** | Stok takibi, kritik stok uyarısı, tedarik talepleri | `work_order_materials` tüketimleri ile entegre çalışır. |

---

## 4. Modüller Arası İletişim Kuralları

- **Doğrudan Tablo Yazma Yasağı:** Hiçbir modül başka bir modülün tablosuna doğrudan `INSERT / UPDATE / DELETE` yapamaz.
- **Ortak Bağlantı Noktası (`equipments`):** Bir soğutma grubunun (`CHL-01`) enerji tüketimi (`meters.equipment_id`), arıza geçmişi (`tickets.equipment_id`) ve gelecekteki bakım geçmişi (`maintenance_plans.equipment_id`) aynı UUID üzerinden ilişkilendirilir.
- **Olay/Bildirim Paylaşımı:** Bir modül kullanıcıya bildirim göndermek istediğinde merkezi `notifications` tablosunu (`module_key` belirterek) kullanır.

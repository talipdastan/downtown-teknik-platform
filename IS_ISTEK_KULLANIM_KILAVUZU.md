# DOWNTOWN TEKNİK — İŞ İSTEK VE İŞ EMRİ SÜREÇLERİ KULLANIM KILAVUZU (WEB & ANDROID)

Bu kılavuz, **Downtown Teknik Operasyon Platformu** üzerinde **Arıza Bildirimi (İş İsteği)** açılmasından **İş Emri** atanmasına, saha teknisyeni müdahalesinden **Çözüm Onayı ve Kapatma** aşamasına kadar tüm sürecin hem **Web Yönetim Paneli (`http://10.16.19.19`)** hem de **Android Mobil Uygulama (APK)** üzerinden nasıl yürütüldüğünü adım adım açıklar.

---

## 1. Genel İş Akışı ve Roller

Sistemde bir iş isteği (arıza kaydı) açıldığı andan arşivlenene kadar **5 temel aşamadan** geçer:

```
[1. YENİ ARIZA BİLDİRİMİ]
   (AVM Personeli / İlgili Birim tarafından açılır)
          │
          ▼
[2. İNCELEME & İŞ EMRİ ATAMA]
   (Ekip Sorumlusu / Teknik Yönetici tarafından departman ve teknisyene atanır)
          │
          ▼
[3. SAHA MÜDAHALESİ: İŞLEMDE / BEKLEMEDE]
   (Teknik Personel işe başlar, malzeme/not ve zorunlu Çözüm Fotoğrafı ekler)
          │
          ▼
[4. ÇÖZÜM ONAYI BEKLİYOR (RESOLVED)]
   (Teknik Yönetici veya İşi Açan Personel yapılan işi ve fotoğrafı kontrol eder)
          ├─── Eksik / Sorun Devam Ediyor ──► [TEKNİSYENE İADE EDİLİR (İŞLEMDE)]
          │
          ▼ Onaylandı
[5. KAPATILDI (CLOSED)]
   (Süreler ve kullanılan malzemeler raporlara ve ekipman geçmişine işlenir)
```

### Sistemdeki Roller ve Görevleri

| Rol | Yetki ve Sorumluluk Özeti | Kullandığı Platform |
| :--- | :--- | :--- |
| **AVM Personeli** (`employee`) | Sahada gördüğü arızaları/iş isteklerini fotoğraflı olarak açar, kendi açtığı işlerin durumunu takip eder ve tamamlanan işleri kontrol edip onaylar veya eksik varsa iade eder. | **Android APK** veya **Web** |
| **Teknik Personel** (`technician`) | Kendisine atanan iş emirlerini görüntüler, işe başlar, parça bekleniyorsa gerekçesiyle beklemeye alır, kullanılan malzemeyi yazar ve **çözüm fotoğrafı** çekerek işi tamamlar. | **Android APK** (Sahada) / **Web** |
| **Ekip Sorumlusu** (`team_lead`) | Gelen yeni arıza bildirimlerini inceler, kendi departmanındaki uygun teknisyenlere iş emri olarak atar, tamamlanan işlerin teknik kontrolünü yapar. | **Web** ve **Android APK** |
| **Teknik Yönetici** (`technical_manager`) | Tüm departmanların arıza ve iş emirlerini yönetir, iş atar, çözümleri onaylar/kapatır, SLA (müdahale ve çözüm süresi) ile personel performans raporlarını alır. | **Web** ve **Android APK** |
| **Sistem Yöneticisi** (`system_admin`) | Tüm sistem ayarları, personel onayları, modül/aksiyon yetkileri, kat-mahal-kategori tanımları ve tüm iş takip süreçleri üzerinde tam yetkilidir. | **Web** ve **Android APK** |

---

## 2. Sisteme Giriş ve İlk Kayıt Onayı

1. **Erişim Kanalları:**
   - **Web Ortamı:** Şirket içi ağdan tarayıcı ile `http://10.16.19.19` adresine girilir.
   - **Android (APK):** Telefona kurulan **Downtown Teknik** uygulaması açılır.
2. **Yeni Personel Kaydı:**
   - Giriş ekranındaki **"Kayıt Olun"** bağlantısına tıklanır.
   - **Ad Soyad**, **Telefon**, **E-posta** ve **Parola (en az 6 karakter)** girilerek kayıt oluşturulur.
   - Güvenlik gereği yeni kayıtlar **"Yönetici Onayı Bekliyor"** durumunda açılır. Sistem Yöneticisi veya Teknik Yönetici `Personel Yönetimi` ekranından kullanıcıyı onaylayıp rolünü ve departmanını seçtiğinde hesap aktif olur.
3. **Giriş Yapma:**
   - Kullanıcılar sisteme yalnızca e-posta ile değil; **E-posta**, **Ad Soyad** veya **Telefon Numarası** ve şifreleriyle giriş yapabilirler.
   - *Güvenlik Notu:* Kullanıcı kendi profilinden Ad Soyad, Telefon veya E-posta bilgisini değiştirirse hesap güvenlik gereği tekrar yönetici onayına düşer.

---

## 3. Adım Adım İş İsteği (Arıza) Süreçleri

### ADIM 1: Yeni Arıza / İş İsteği Oluşturma
*(AVM Personeli, Ekip Sorumlusu, Teknik Yönetici)*

> **Önemli Kural (3 Onay Bekleyen İş Kuralı):** Bir personelin onayında bekleyen (`Çözüldü / Onay Bekliyor` durumunda) **3 veya daha fazla** tamamlanmış iş isteği varsa, sistem yeni arıza açmadan önce mevcut tamamlanmış işlerini kontrol edip onaylamasını ister.

#### A) Android Mobil Uygulamada (APK):
1. Alt menüden **İş Takip** sekmesine geçin ve **"Yeni Arıza Bildirimi"** kartına (veya sağ alttaki `+ Yeni Arıza` butonuna) dokunun.
2. **Kat ve Mahal Seçimi:**
   - Önce **Kat** seçin (Örn: *Zemin Kat*, *1. Kat*).
   - Seçilen kata ait **Mahal** listesi açılır. Listede yoksa **"Diğer (Elle Giriş)"** seçeneğini seçip mahal adını yazabilirsiniz.
3. **Arıza Türü ve Ekipman:**
   - **Arıza Türü** seçin (Örn: *İklimlendirme / HVAC*, *Aydınlatma*, *Sıhhi Tesisat*). Listede yoksa *"Diğer (Elle Giriş)"* ile yazabilirsiniz.
   - Arıza belirli bir cihaza aitse **İlgili Ekipman (Opsiyonel)** listesinden cihazı seçin.
4. **Öncelik Seviyesi:**
   - **Normal:** Rutin bakım ve standart arızalar.
   - **Öncelikli:** Günlük operasyonu etkileyen arızalar.
   - **Acil:** İnsan güvenliğini, mağaza/AVM işleyişini durduran kritik arızalar.
5. **Açıklama ve Fotoğraf:**
   - Arızayı kısaca açıklayın.
   - **"Fotoğraf Ekle"** kutusuna dokunarak **Kamera** ile anlık fotoğraf çekin veya **Galeri**'den en fazla 5 adet fotoğraf ekleyin.
6. Ekranın en altında sabit duran **"Arıza Kaydı Oluştur"** butonuna basın. Sistem otomatik bir takip numarası (Örn: `ARZ-2026-00042`) üretir ve yöneticilere bildirim gönderir.

#### B) Web Ortamında (`http://10.16.19.19`):
1. Sol menüden **İş Takip -> Arıza Kayıtları** (`/work-tracking/tickets`) sayfasına gidin ve sağ üstteki **"+ Yeni Arıza Bildirimi"** butonuna tıklayın.
2. Açılan pencerede **Kat**, **Mahal**, **Arıza Kategorisi**, **Ekipman**, **Öncelik** ve **Açıklama** alanlarını doldurun.
3. Bilgisayarınızdan arıza fotoğrafı seçip **"Kaydı Oluştur"** butonuna tıklayın.

---

### ADIM 2: Arızanın İncelenmesi ve İş Emri Atama
*(Ekip Sorumlusu, Teknik Yönetici, Sistem Yöneticisi)*

Yeni açılan bir arıza `Yeni (new)` durumundadır. Teknik ekip sorumlusu veya yönetici bu kaydı inceleyip ilgili departman ve teknisyene **İş Emri** olarak atar.

#### A) Android Mobil Uygulamada (APK):
1. **İş Takip** ana ekranından **"İş Emirleri (Ata & Onayla)"** kartına dokunun.
2. Üstteki **`İş Ata`** sekmesinde henüz iş emrine dönüştürülmemiş açık arızalar listelenir.
3. İlgili arıza kartındaki **"İş Emri Ata"** butonuna dokunun.
4. Açılan alt pencerede:
   - **Departman** seçin (Örn: *Elektrik*, *Mekanik*, *İnşaat/Boyahane*).
   - Seçilen departmandaki **Teknisyen(ler)i** kutucukları işaretleyerek seçin (birden fazla teknisyen atanabilir).
   - Varsa **Teknik Talimat / Not** yazın ve **"İş Emrini Oluştur ve Ata"** butonuna basın.
5. Atanan teknisyenlerin telefonuna anında bildirim düşer ve arıza durumu **`Atandı (assigned)`** olur.

#### B) Web Ortamında (`http://10.16.19.19`):
1. Sol menüden **İş Takip -> Arıza Kayıtları** (`/work-tracking/tickets`) veya **İş Emirleri** (`/work-tracking/work-orders`) sayfasına gidin.
2. Arıza satırındaki **"İş Emri Oluştur / Ata"** butonuna tıklayın.
3. **Departman**, **Sorumlu Teknisyen(ler)** ve **Yönetici Talimatı** bilgilerini girip kaydedin.
4. Gerekirse geçersiz veya mükerrer açılmış bir arıza kaydını gerekçe yazarak **İptal** edebilirsiniz.

---

### ADIM 3: Teknik Personelin (Teknisyenin) Saha Müdahalesi
*(Teknik Personel / Teknisyen)*

Teknisyen kendisine atanan işleri sahada mobil uygulama üzerinden veya web panelinden yönetir.

#### A) Android Mobil Uygulamada (APK):
1. **İş Takip** ekranından **"Bana Atanan İşler"** kartına dokunun.
2. **`Aktif`** sekmesinde size atanmış iş emirlerini öncelik ve mahal bilgisiyle görürsünüz. İlgili iş emrine dokunarak detayını açın.
3. **İşe Başlama:**
   - Mahale ulaştığınızda **"İşe Başla"** butonuna basın. (Sistem bu anı *Müdahale Başlangıç Saati* olarak kaydeder ve durum **`İşlemde (in_progress)`** olur).
   - İsterseniz müdahale öncesi **"Öncesi Fotoğrafı Ekle"** butonuyla arızanın ilk halini fotoğraflayabilirsiniz.
4. **Beklemeye Alma (Gerekirse):**
   - Eğer yedek parça bekleniyorsa, dış servis çağrıldıysa veya mahal müsait değilse **"Beklemeye Al"** butonuna basın.
   - **Bekleme Nedenini** yazıp kaydedin (Örn: *"Kontaktör siparişi verildi, parça bekleniyor"*). Durum **`Beklemede (waiting)`** olur. Parça geldiğinde **"İşleme Tekrar Başla"** butonuyla devam edebilirsiniz.
5. **Kullanılan Malzeme Girişi (Varsa):**
   - **"Malzeme Ekle"** butonuna dokunun; malzeme adı (Örn: *25A Sigorta*), miktar ve birimini (*adet*, *metre*) girip ekleyin.
6. **İşi Tamamlama (Zorunlu Çözüm Fotoğrafı):**
   - **"Yapılan İşlem Açıklaması"** alanına yapılan teknik müdahaleyi yazın.
   - **"Çözüm Fotoğrafı Ekle"** butonuna basarak yapılan işin son halinin fotoğrafını çekin (**Çözüm fotoğrafı olmadan sistem işi tamamlamaya izin vermez**).
   - Yeşil renkli **"İşi Tamamlandı Olarak Gönder"** butonuna basın.
   - İş emri **`Tamamlandı (completed)`**, arıza kaydı ise yönetici/bildiren onayı için **`Çözüldü (resolved)`** durumuna geçer.

#### B) Web Ortamında (`http://10.16.19.19`):
1. Sol menüden **İş Takip -> İş Emirleri** (`/work-tracking/work-orders`) sayfasına gidin.
2. Size atanan iş emrinde sırasıyla **İşe Başla**, **Beklemeye Al**, **Malzeme / Fotoğraf Ekle** ve **Tamamla** aksiyonlarını kullanabilirsiniz.

---

### ADIM 4: Çözüm Kontrolü, Onay ve Kapatma (veya İade)
*(Teknik Yönetici, Ekip Sorumlusu veya Arızayı Bildiren Personel)*

Teknisyen işi tamamladığında kayıt doğrudan kapanmaz; kalite kontrolü için **`Çözüldü / Onay Bekliyor (resolved)`** aşamasına gelir.

#### A) Android Mobil Uygulamada (APK):
- **Yöneticiler İçin:**
  1. **İş Takip -> İş Emirleri (Ata & Onayla)** ekranına girip ortadaki **`Onayla`** sekmesine dokunun.
  2. **"Fotoğrafları ve Geçmişi Gör"** bağlantısıyla teknisyenin yüklediği çözüm fotoğrafını ve kullanılan malzemeleri inceleyin.
  3. İşlem uygunsa **"Onayla ve Kapat"** butonuna basın -> Kayıt kalıcı olarak **`Kapatıldı (closed)`** olur.
  4. Eksiklik varsa **"İade Et"** butonuna basın ve iade gerekçesini yazın -> İş emri tekrar açılarak teknisyenin **`Aktif`** listesine geri döner.
- **Arızayı Açan Personel İçin:**
  1. **İş Takip -> Arızalarım** listesinden `Çözüldü` durumundaki kaydınıza dokunun.
  2. Detay ekranındaki **"Çözüm Onayınız Bekleniyor"** kutusunda yer alan **"Onayla ve Kapat"** veya sorun devam ediyorsa **"İade Et"** butonunu kullanın.

#### B) Web Ortamında (`http://10.16.19.19`):
1. Sol menüden **İş Takip -> Çözüm Onay** (`/work-tracking/review`) sayfasına gidin.
2. Onay bekleyen işlerin öncesi/sonrası fotoğraflarını, teknisyen notunu ve malzeme listesini inceleyin.
3. **"Onayla ve Kapat"** ile işi kapatın veya **"Teknisyene İade Et"** ile gerekçe yazarak revizyona gönderin.

---

### ADIM 5: Raporlama, SLA ve Performans Takibi
*(Teknik Yönetici ve Sistem Yöneticisi — Web Paneli)*

1. Web panelinde sol menüden **İş Takip -> Raporlar** (`/work-tracking/reports`) sayfasına gidin.
2. **Tarih Aralığı**, **Departman**, **Kategori** veya **Öncelik** filtresi seçin.
3. Bu ekrandan:
   - Toplam açılan, çözülen, bekleyen ve kapatılan iş sayılarını,
   - Ortalama müdahale ve çözüm sürelerini (SLA),
   - Departman ve teknisyen bazlı iş yükü dağılımını,
   - Kullanılan toplam yedek parça ve malzeme dökümünü
   görüntüleyebilir, tek tıkla **Kurumsal Excel** veya **PDF Yönetici Raporu** olarak dışa aktarabilirsiniz.

---

## 4. Sık Sorulan Sorular ve Pratik İpuçları

- **İnternet çekmeyen (kazan dairesi, bodrum kat vb.) mahallerde ne yapılır?**
  Android uygulama çevrimdışı (offline) kuyruk desteğine sahiptir. Bağlantı koptuğunda yapılan işlemler cihazda güvenli kuyruğa alınır, internet bağlantısı sağlandığında otomatik olarak sunucuyla eşitlenir.
- **Aradığım mahal veya arıza türü listede yoksa ne yapmalıyım?**
  Mahal ve Arıza Türü seçim kutularının en altındaki **"Diğer (Elle Giriş)"** seçeneğini seçerek mahal veya kategori adını serbest metin olarak yazabilirsiniz. Sistem Yöneticisi daha sonra `Tanımlar` ekranından yeni mahalleri kalıcı olarak ekleyebilir.
- **Yanlışlıkla geri tuşuna basarsam uygulamadan çıkar mı?**
  Hayır. Alt ekranlarda telefonun geri tuşuna basıldığında bir üst ekrana veya Modül Ana Ekranına döner. Ana ekranda ise uygulamadan çıkmak için geri tuşuna 2 saniye içinde arka arkaya iki kez basılması gerekir.

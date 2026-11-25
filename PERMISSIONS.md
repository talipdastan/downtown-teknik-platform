# AVM TECH – YETKİLENDİRME VE MODÜL ERİŞİM SİSTEMİ (`PERMISSIONS.md`)

> **Sürüm:** `v0.1.0-docs`  
> **Mimari:** Merkezi RBAC (5 Temel Rol + Özel Roller) + Modül Bazlı Granüler İzinler (`profiles.permissions` JSONB) + PostgreSQL RLS

---

## 1. Yetkilendirme Katmanları

Platformda güvenlik ve erişim kontrolü 3 katmanlı olarak çalışır:

1. **Gatekeeper (Hesap Onayı):** Yeni kayıt olan her kullanıcı `approval_status = 'pending'` durumundadır. `system_admin` veya yetkili yönetici onaylayana kadar hiçbir modüle veya veriye erişemez.
2. **Temel Rol (RBAC):** Her kullanıcının 5 sistem rolünden biri vardır (`employee`, `technician`, `team_lead`, `technical_manager`, `system_admin`) ve isteğe bağlı özel unvanı (`custom_role`) olabilir. Her rolün varsayılan modül ve işlem izinleri tanımlıdır.
3. **Kullanıcı Bazlı Granüler İzinler (`profiles.permissions`):** Yönetici (`system_admin`), herhangi bir kullanıcı için rol varsayılanlarını ezerek (override) modül bazlı izinleri tek tek açıp kapatabilir.

---

## 2. `profiles.permissions` JSONB Yapısı

Mevcut `TEKNİK İŞ İSTEK` projesindeki düz `menus` / `actions` yapısı, modüler platforma uygun ve geriye dönük genişletilebilir hale getirilir:

```json
{
  "modules": {
    "work_tracking": {
      "enabled": true,
      "view": true,
      "create": true,
      "edit": false,
      "delete": false,
      "approve": false,
      "reports": false,
      "manage": false,
      "actions": ["ticket_create", "work_order_execute"]
    },
    "energy": {
      "enabled": true,
      "view": true,
      "create": true,
      "edit": true,
      "delete": false,
      "approve": false,
      "reports": true,
      "manage": false,
      "actions": ["reading_create", "meter_manage", "invoice_access", "budget_manage"]
    }
  },
  "core_actions": ["manage_definitions", "manage_users", "manage_modules", "manage_equipments"]
}
```

### Her Modül İçin Standart 8 Bağımsız Yetki Anahtarı
Kullanıcı bazında her modül için birbirinden tamamen bağımsız olarak tanımlanabilir ve hem arayüzde hem de Supabase RLS / güvenli RPC katmanında uygulanır:
1. `enabled` – **Modül Görüntüleme:** Ana ekranda modül kartını görme ve modüle giriş yapabilme
2. `view` – **Kayıt Görüntüleme:** Modül kayıtlarını listeleme ve detay inceleme
3. `create` – **Kayıt Ekleme:** Yeni kayıt oluşturma (arıza açma, sayaç okuması girme vb.)
4. `edit` – **Kayıt Düzenleme:** Mevcut kayıtları güncelleme
5. `delete` – **Kayıt Silme:** Kayıt silme (varsayılan olarak yalnızca yöneticilerde açık)
6. `approve` – **Onaylama:** Tamamlanan iş emri/arıza onayı, iade işlemi veya kritik veri onayları
7. `reports` – **Raporlama:** Excel/PDF rapor görüntüleme ve dışa aktarma
8. `manage` – **Yönetim İşlemleri:** Modül içi tanım, sayaç/fatura/bütçe yönetimi ve atama işlemleri

---

## 3. Modül Özel Aksiyon Anahtarları

### 3.1 İş Takip (`work_tracking`) Aksiyonları
| Aksiyon Anahtarı | Açıklama |
|---|---|
| `ticket_create` | Yeni arıza bildirimi oluşturma |
| `ticket_view_all` | Yalnızca kendi/atanan kayıtlar yerine tüm AVM arızalarını görme |
| `work_order_assign` | İş emri oluşturma ve departman/teknisyen atama |
| `work_order_execute` | İşe başlama, beklemeye alma, malzeme/fotoğraf ekleme, tamamlama |
| `work_order_review` | Tamamlanan işleri onaylayıp kapatma veya gerekçeyle iade etme |
| `work_export_reports` | Arıza/iş emri Excel ve PDF raporlarını indirme |

### 3.2 Enerji Takip (`energy`) Aksiyonları
| Aksiyon Anahtarı | Açıklama | `sayac_takip_app` Karşılığı |
|---|---|---|
| `reading_create` | Günlük/aylık sayaç okuması girme | `canEnterData` |
| `reading_edit_delete` | Geçmiş okuma kaydını düzenleme / silme | `isAdmin` |
| `meter_manage` | Sayaç ekleme, düzenleme, silme, sıralama, çarpan & EIC/Sayaç No düzenleme | `canAddMeter` |
| `invoice_access` | Fatura ekranını görme, PDF fatura analizi, fatura ekleme/düzenleme | `canAccessInvoices` |
| `budget_manage` | Bütçe Excel/CSV/PDF içe aktarma ve düzenleme | `canAccessInvoices` / `isAdmin` |
| `energy_export_reports` | Elektrik, mekanik, fatura ve bütçe Excel raporlarını indirme | `canEnterData` / `canAccessInvoices` |

### 3.3 Çekirdek Platform Aksiyonları (`core_actions`)
| Aksiyon Anahtarı | Açıklama |
|---|---|
| `manage_users` | Personel onaylama, reddetme, rol ve yetki atama |
| `manage_definitions` | Departman, kat, mahal, arıza kategorisi yönetimi |
| `manage_equipments` | Ortak teknik ekipman (`equipments`) ekleme/düzenleme |
| `manage_modules` | Sistem genelinde modül açma/kapama (`system_modules`) |

---

## 4. Rol Bazlı Varsayılan Yetki Matrisi

| Rol | İş Takip (`work_tracking`) | Enerji Takip (`energy`) | Çekirdek Yönetim |
|---|---|---|---|
| `employee` | Açık: Arıza açma, kendi arızalarını görme & onaylama | **Kapalı** *(Yönetici isterse kullanıcı bazlı açabilir)* | Yok |
| `technician` | Açık: Arıza açma, atanan iş emirlerini yürütme | Açık *(Varsayılan)*: Görüntüleme + Okuma girişi (`reading_create`) | Yok |
| `team_lead` | Açık: Tüm arızalar, iş emri atama, yürütme, inceleme, raporlar | Açık: Görüntüleme + Okuma girişi/düzenleme + Raporlar | Yok |
| `technical_manager` | Açık: Tam operasyonel yetki + onay/kapatma + raporlar | Açık: Sayaç, okuma, fatura, bütçe ve raporlar | Personel görüntüleme, ekipman görüntüleme |
| `system_admin` | **Tam Yetki** | **Tam Yetki** | **Tam Yetki** (Kullanıcı, Rol, Modül, Tanım, Ekipman) |

> **Kural:** `system_admin` rolü tüm modül ve aksiyonlarda her zaman tam yetkilidir ve kendi yetkisini kısıtlayamaz.

---

## 5. Mevcut İki Projenin Yetki Eşleştirme Tablosu

Aktarım sırasında eski `sayac_takip_app` kullanıcı izinleri şu şekilde eşleştirilir:

| Eski `sayac_takip_app` Alanı | Yeni AVM TECH Karşılığı |
|---|---|
| `role == 'admin'` | `role = 'technical_manager'` (veya mevcut AVM TECH hesabı eşleşirse mevcut rolü korunur) + `energy` tam yetki |
| `role == 'personel'` | `role = 'technician'` (veya mevcut AVM TECH hesabı) + `energy.enabled = true` |
| `canEnterData == true` | `energy.create = true`, `energy.actions += 'reading_create'` |
| `canAddMeter == true` | `energy.manage = true`, `energy.actions += 'meter_manage'` |
| `canAccessInvoices == true` | `energy.reports = true`, `energy.actions += ['invoice_access', 'budget_manage', 'energy_export_reports']` |

---

## 6. Güvenlik Garantileri (Privilege Escalation Önleme)

1. İstemci tarafındaki UI gizlemeleri yalnızca kullanıcı deneyimi içindir; tüm yetki kontrolleri PostgreSQL **RLS** ve **`SECURITY DEFINER` RPC** fonksiyonlarında tekrar doğrulanır.
2. Kullanıcılar `profiles.role`, `profiles.approval_status` ve `profiles.permissions` sütunlarını doğrudan güncelleyemez.
3. Yalnızca `system_admin` rolündeki kullanıcı `rpc_update_user_permissions` ile yetki değiştirebilir ve başka bir kullanıcıya `system_admin` rolü verebilir.

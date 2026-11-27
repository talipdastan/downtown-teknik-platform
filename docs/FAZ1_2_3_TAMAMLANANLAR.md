# DOWNTOWN TEKNİK – FAZ 1, FAZ 2 VE FAZ 3 TAMAMLAMA & CANLI OPERASYON REHBERİ

**Tarih:** 2026-11-27  
**Sürüm:** `v1.3.0+8` (Web + Mobil + Supabase + CI/CD)

---

## 1. Canlı Veritabanına Uygulanan Migration'lar

| Migration | Kapsam | Durum |
| :--- | :--- | :---: |
| `20261127000017_photo_retention_edge_safe.sql` | `rpc_manager_close_ticket` senkron silme ayrımı, `rpc_purge_expired_closed_photos` `authenticated` yetki iptali, `service_role` Storage API yardımcı RPC'leri, `idx_tickets_closed_status_at` kısmi indeksi | Uygulandı |
| `20261127000018_reporting_pagination_and_indexes.sql` | `idx_work_orders_completed_by_at` kısmi indeksi, `rpc_work_tracking_dashboard_summary`, `rpc_reorder_meters` (N+1 çözümü) | Uygulandı |
| `20261127000019_offline_work_order_completed_by.sql` | `rpc_sync_offline_work_order_status` içine `completed_by = auth.uid()` ve mükerrer yorum koruması | Uygulandı |
| `20261127000020_faz2_sla_reactive_qr_workload.sql` | `sla_policies` + `tickets` SLA tetikleyicisi/eskalasyon, `rpc_get_technician_workloads`, `rpc_find_duplicate_open_tickets`, Reaktif Ceza (%20/%15) → Otomatik `Acil` iş tetikleyicisi, `rpc_get_energy_reading_health`, `rpc_lookup_qr_target` | Uygulandı |
| `20261127000021_faz3_cmms_modules.sql` | Planlı Bakım & Checklist (`maintenance_executions` + otomatik arıza RPC), Yedek Parça & Stok (`inventory_items`, `stock_movements`, otomatik stok düşüm), Dijital Vardiya Devir Defteri (`shift_handovers`), Dış Servis & Sözleşmeler (`vendors`, `maintenance_contracts`, `service_reports`) | Uygulandı |

---

## 2. Güvenlik ve İmza Yapılandırması

- **SSH Anahtar Erişimi:** `~/.ssh/id_ed25519` anahtarı oluşturuldu ve `10.16.19.19` sunucusunda yetkilendirildi. `scripts/deploy_server.mjs` artık parola olmadan yalnızca SSH key ile dağıtım yapar.
  - **Öneri:** Sunucudaki mevcut `teknik` kullanıcı şifresini SSH üzerinden `passwd` komutuyla değiştirmeniz önerilir.
- **Kalıcı Android Release Keystore:** 2048-bit RSA `upload-keystore.jks` üretildi, `.gitignore` ile Git dışına alındı ve `~/.downtown-teknik-secrets/` klasörüne yedeklendi.
  - **Önemli Tek Seferlik Geçiş Notu:** Önceki v1.2.4 APK'ları `debug` anahtarıyla imzalıydı. `v1.3.0` kalıcı kurumsal release anahtarıyla imzalandığı için sahadaki cihazlarda **yalnızca bir defaya mahsus** eski uygulama kaldırılıp `v1.3.0` kurulmalıdır. Sonraki tüm güncellemeler uygulama içinden kesintisiz üstüne kurulacaktır.

---

## 3. GitHub Actions CI/CD Secrets Kurulumu (Opsiyonel 4.5G Otomasyonu İçin)

GitHub deposunda **Settings → Secrets and variables → Actions** altına aşağıdaki gizli değişkenleri eklerseniz, her `v*` etiketi attığınızda imzalı ~21 MB APK'lar otomatik olarak GitHub Releases'a yüklenir ve gece 03:00 fotoğraf arşiv temizliği otomatik çalışır:

| Secret Adı | Açıklama |
| :--- | :--- |
| `ANDROID_KEYSTORE_BASE64` | `~/.downtown-teknik-secrets/upload-keystore.jks` dosyasının Base64 metni |
| `ANDROID_KEY_ALIAS` | `downtown-teknik-upload` |
| `ANDROID_KEY_PASSWORD` | `~/.downtown-teknik-secrets/key.properties` içindeki `keyPassword` |
| `ANDROID_STORE_PASSWORD` | `~/.downtown-teknik-secrets/key.properties` içindeki `storePassword` |
| `SUPABASE_URL` | Supabase proje URL'si |
| `SUPABASE_ANON_KEY` | Supabase anon/publishable anahtarı |
| `PHOTO_PURGE_CRON_SECRET` | `purge-expired-photos` Edge Function için tanımladığınız cron gizli anahtarı |
| `SHOREBIRD_TOKEN` | *(Opsiyonel)* Linux runner üzerinden APK'sız Dart OTA yaması için |

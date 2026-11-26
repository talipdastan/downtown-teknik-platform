import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'package:avm_tech_platform/core/theme/app_theme.dart';
import 'package:avm_tech_platform/core/widgets/common_widgets.dart';

/// Sunucudaki (`http://10.16.19.19/download/version.json`) sürüm bilgisi modeli.
class AppUpdateInfo {
  final String version;
  final int buildNumber;
  final String apkUrl;
  final bool mandatory;
  final List<String> releaseNotes;

  const AppUpdateInfo({
    required this.version,
    required this.buildNumber,
    required this.apkUrl,
    this.mandatory = false,
    this.releaseNotes = const [],
  });

  factory AppUpdateInfo.fromJson(Map<String, dynamic> json) {
    final rawNotes = json['releaseNotes'];
    return AppUpdateInfo(
      version: (json['version'] ?? '1.0.0').toString().trim(),
      buildNumber: (json['buildNumber'] is num)
          ? (json['buildNumber'] as num).toInt()
          : int.tryParse(json['buildNumber']?.toString() ?? '1') ?? 1,
      apkUrl: (json['apkUrl'] ??
              'http://10.16.19.19/download/downtown-teknik.apk')
          .toString()
          .trim(),
      mandatory: json['mandatory'] == true,
      releaseNotes: rawNotes is List
          ? rawNotes.map((e) => e.toString()).toList()
          : const [],
    );
  }
}

/// Uygulama İçi Otomatik Güncelleme (Self-Hosted OTA) Servisi.
class AppUpdateService {
  AppUpdateService._();

  /// Mevcut derlenmiş APK sürümü (`pubspec.yaml` ile senkron: `1.2.1+4`).
  static const String currentVersion = String.fromEnvironment(
    'APP_VERSION',
    defaultValue: '1.2.1',
  );
  static const int currentBuildNumber = int.fromEnvironment(
    'APP_BUILD_NUMBER',
    defaultValue: 4,
  );

  /// Canlı Ubuntu Web Sunucusu güncelleme adresi.
  static const String serverBaseUrl = String.fromEnvironment(
    'UPDATE_SERVER_URL',
    defaultValue: 'http://10.16.19.19',
  );

  static String get versionJsonUrl => '$serverBaseUrl/download/version.json';
  static String get defaultApkUrl =>
      '$serverBaseUrl/download/downtown-teknik.apk';
  static String get downloadPortalUrl => '$serverBaseUrl/download';

  static const MethodChannel _channel =
      MethodChannel('downtown_teknik/updater');

  static bool _checkedThisSession = false;

  /// Sunucu sürümünün mevcut APK sürümünden daha yeni olup olmadığını hesaplar.
  static bool isNewerVersion({
    required String remoteVersion,
    required int remoteBuild,
    String localVersion = currentVersion,
    int localBuild = currentBuildNumber,
  }) {
    if (remoteBuild > localBuild) return true;
    final rParts = remoteVersion
        .split('.')
        .map((p) => int.tryParse(p.trim()) ?? 0)
        .toList();
    final lParts = localVersion
        .split('.')
        .map((p) => int.tryParse(p.trim()) ?? 0)
        .toList();
    final len = rParts.length > lParts.length ? rParts.length : lParts.length;
    for (var i = 0; i < len; i++) {
      final rv = i < rParts.length ? rParts[i] : 0;
      final lv = i < lParts.length ? lParts[i] : 0;
      if (rv > lv) return true;
      if (rv < lv) return false;
    }
    return false;
  }

  /// Sunucudan `version.json` bilgisini çeker.
  static Future<AppUpdateInfo?> fetchRemoteInfo() async {
    if (kIsWeb) return null;
    final client = HttpClient()
      ..connectionTimeout = const Duration(seconds: 4);
    try {
      final uri = Uri.parse(
        '$versionJsonUrl?t=${DateTime.now().millisecondsSinceEpoch}',
      );
      final req = await client.getUrl(uri);
      req.headers.set(HttpHeaders.cacheControlHeader, 'no-cache');
      final res = await req.close().timeout(const Duration(seconds: 5));
      if (res.statusCode != 200) return null;
      final body = await res.transform(utf8.decoder).join();
      final decoded = jsonDecode(body);
      if (decoded is Map<String, dynamic>) {
        return AppUpdateInfo.fromJson(decoded);
      }
      return null;
    } catch (_) {
      return null;
    } finally {
      client.close();
    }
  }

  /// Sistem tarayıcısı üzerinden doğrudan yeni APK indirmesini başlatır.
  static Future<bool> launchApkDownload(String url) async {
    try {
      final ok = await _channel.invokeMethod<bool>(
        'openExternalUrl',
        {'url': url},
      );
      return ok ?? false;
    } catch (_) {
      return false;
    }
  }

  /// Uygulama açılışında (veya kullanıcı istediğinde) yeni sürüm kontrolü yapar.
  static Future<void> checkAndPrompt(
    BuildContext context, {
    bool manual = false,
  }) async {
    if (kIsWeb) return;
    if (!manual && _checkedThisSession) return;
    _checkedThisSession = true;

    final info = await fetchRemoteInfo();
    if (!context.mounted) return;

    if (info == null) {
      if (manual) {
        showAppSnack(
          context,
          'Güncelleme sunucusuna ($serverBaseUrl) ulaşılamadı. Şirket ağı bağlantınızı kontrol edin.',
          error: true,
        );
      }
      return;
    }

    final hasUpdate = isNewerVersion(
      remoteVersion: info.version,
      remoteBuild: info.buildNumber,
    );

    if (!hasUpdate) {
      if (manual) {
        showAppSnack(
          context,
          'Uygulamanız güncel (v$currentVersion · Yapı #$currentBuildNumber).',
        );
      }
      return;
    }

    await showDialog<void>(
      context: context,
      barrierDismissible: !info.mandatory,
      builder: (ctx) => AlertDialog(
        title: Row(
          children: [
            Container(
              width: 34,
              height: 34,
              decoration: BoxDecoration(
                color: AppColors.turquoiseSoft,
                borderRadius: BorderRadius.circular(10),
              ),
              child: const Icon(
                Icons.system_update_rounded,
                color: AppColors.accentTurquoise,
                size: 20,
              ),
            ),
            const SizedBox(width: 10),
            const Expanded(
              child: Text(
                'Yeni Güncelleme Hazır',
                style: TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w800,
                  color: AppColors.primaryNavy,
                ),
              ),
            ),
          ],
        ),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Downtown Teknik v${info.version} (Yapı #${info.buildNumber}) sürümü yayınlandı.\n'
                'Mevcut sürümünüz: v$currentVersion (#$currentBuildNumber)',
                style: const TextStyle(
                  fontSize: 12.5,
                  fontWeight: FontWeight.w600,
                  color: AppColors.textPrimary,
                ),
              ),
              if (info.releaseNotes.isNotEmpty) ...[
                const SizedBox(height: 10),
                const Text(
                  'Bu Sürümdeki Yenilikler:',
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w800,
                    color: AppColors.primaryNavy,
                  ),
                ),
                const SizedBox(height: 4),
                for (final note in info.releaseNotes)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 3),
                    child: Text(
                      '• $note',
                      style: const TextStyle(
                        fontSize: 11.5,
                        color: AppColors.textSecondary,
                      ),
                    ),
                  ),
              ],
            ],
          ),
        ),
        actions: [
          if (!info.mandatory)
            TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: const Text('Daha Sonra'),
            ),
          FilledButton.icon(
            style: FilledButton.styleFrom(
              backgroundColor: AppColors.accentTurquoise,
            ),
            onPressed: () async {
              Navigator.pop(ctx);
              final targetUrl =
                  info.apkUrl.isNotEmpty ? info.apkUrl : defaultApkUrl;
              final launched = await launchApkDownload(targetUrl);
              if (!launched && context.mounted) {
                await Clipboard.setData(ClipboardData(text: targetUrl));
                if (context.mounted) {
                  showAppSnack(
                    context,
                    'İndirme bağlantısı panoya kopyalandı: $targetUrl',
                  );
                }
              }
            },
            icon: const Icon(Icons.download_rounded, size: 18),
            label: const Text('Şimdi İndir & Güncelle'),
          ),
        ],
      ),
    );
  }
}

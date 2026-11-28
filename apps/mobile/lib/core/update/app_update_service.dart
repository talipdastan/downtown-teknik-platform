import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:path_provider/path_provider.dart';
import 'package:shorebird_code_push/shorebird_code_push.dart';

import 'package:avm_tech_platform/core/theme/app_theme.dart';
import 'package:avm_tech_platform/core/widgets/common_widgets.dart';

/// Uzak sürüm bilgisi (GitHub Bulut + Yerel AVM Sunucusu çift kanallı).
class AppUpdateInfo {
  final String version;
  final int buildNumber;
  final String apkUrl;
  final Map<String, String> apkUrls;
  final bool mandatory;
  final List<String> releaseNotes;

  const AppUpdateInfo({
    required this.version,
    required this.buildNumber,
    required this.apkUrl,
    this.apkUrls = const {},
    this.mandatory = false,
    this.releaseNotes = const [],
  });

  factory AppUpdateInfo.fromJson(Map<String, dynamic> json) {
    final rawNotes = json['releaseNotes'];
    final rawUrls = json['apkUrls'];
    final parsedUrls = <String, String>{};
    if (rawUrls is Map) {
      for (final entry in rawUrls.entries) {
        final k = entry.key.toString().trim();
        final v = entry.value?.toString().trim() ?? '';
        if (k.isNotEmpty && v.isNotEmpty) {
          parsedUrls[k] = v;
        }
      }
    }
    return AppUpdateInfo(
      version: (json['version'] ?? '1.0.0').toString().trim(),
      buildNumber: (json['buildNumber'] is num)
          ? (json['buildNumber'] as num).toInt()
          : int.tryParse(json['buildNumber']?.toString() ?? '1') ?? 1,
      apkUrl: (json['apkUrl'] ?? '').toString().trim(),
      apkUrls: parsedUrls,
      mandatory: json['mandatory'] == true,
      releaseNotes: rawNotes is List
          ? rawNotes.map((e) => e.toString()).toList()
          : const [],
    );
  }
}

/// Çift Katmanlı Otomatik Güncelleme Sistemi:
/// 1. KATMAN (Shorebird OTA Code Push):
///    - APK indirmeden, kurulum ekranı çıkarmadan, AVM Wi-Fi'ına gerek kalmadan
///      (4.5G/5G/Ev interneti dahil her yerden) arka planda sessizce Dart yamasını
///      indirir ve uygular.
/// 2. KATMAN (Uygulama İçi Sessiz Paket Güncelleyici - FileProvider):
///    - Eğer yeni bir native izin/sürüm çıkarsa tarayıcıyı HİÇ AÇMADAN uygulama
///      içinde %0-%100 ilerleme çubuğuyla paketi önbelleğe çeker ve doğrudan
///      Android Paket Yükleyiciyi tetikler.
class AppUpdateService {
  AppUpdateService._();

  static const String currentVersion = String.fromEnvironment(
    'APP_VERSION',
    defaultValue: '1.3.6',
  );
  static const int currentBuildNumber = int.fromEnvironment(
    'APP_BUILD_NUMBER',
    defaultValue: 14,
  );

  static ({String version, int buildNumber})? _cachedInstalledVersion;

  /// Cihazda gerçekten kurulu olan Android sürüm bilgisini (`PackageInfo`) okur.
  /// Böylece `--dart-define` unutulsa bile sonsuz güncelleme döngüsü yaşanmaz.
  static Future<({String version, int buildNumber})> getInstalledVersion() async {
    if (_cachedInstalledVersion != null) return _cachedInstalledVersion!;
    if (!kIsWeb) {
      try {
        final raw = await _channel
            .invokeMapMethod<String, dynamic>('getInstalledVersion');
        if (raw != null) {
          final v = (raw['version'] ?? '').toString().trim();
          final b = (raw['buildNumber'] as num?)?.toInt() ?? 0;
          if (v.isNotEmpty && b > 0) {
            _cachedInstalledVersion = (version: v, buildNumber: b);
            return _cachedInstalledVersion!;
          }
        }
      } catch (_) {
        // Test ortamı veya desteklenmeyen platformda compile-time sabitine düş
      }
    }
    _cachedInstalledVersion = (
      version: currentVersion,
      buildNumber: currentBuildNumber,
    );
    return _cachedInstalledVersion!;
  }

  /// 1) Bulut Güncelleme Kanalı (4.5G / Mobil Veri / Her Yerden Erişilebilir)
  static const String githubVersionJsonUrl =
      'https://raw.githubusercontent.com/talipdastan/downtown-teknik-platform/main/apps/web/public/download/version.json';
  static const String githubReleaseApkUrl =
      'https://github.com/talipdastan/downtown-teknik-platform/releases/latest/download/downtown-teknik.apk';

  /// 2) Yerel AVM Sunucusu Kanalı (AVM Wi-Fi içindeyken yüksek hızlı yerel indirme)
  static const String lanServerBaseUrl = String.fromEnvironment(
    'UPDATE_SERVER_URL',
    defaultValue: 'http://10.16.19.19',
  );

  static const MethodChannel _channel =
      MethodChannel('downtown_teknik/updater');

  static final ShorebirdUpdater _shorebird = ShorebirdUpdater();
  static bool _checkedThisSession = false;

  /// Cihazın Shorebird OTA motoruyla çalışıp çalışmadığını döner.
  static bool get isShorebirdAvailable => _shorebird.isAvailable;

  /// Aktif yama numarasını döner (yama yoksa null).
  static Future<int?> currentPatchNumber() async {
    try {
      if (!_shorebird.isAvailable) return null;
      final patch = await _shorebird.readCurrentPatch();
      return patch?.number;
    } catch (_) {
      return null;
    }
  }

  /// 1. KATMAN: Shorebird üzerinden APK indirmeden sessiz yama kontrolü ve kurulumu.
  /// Yeni yama varsa indirir ve `true` döner.
  static Future<bool> _checkAndApplyShorebirdPatch(
    BuildContext context, {
    required bool manual,
  }) async {
    if (kIsWeb || !_shorebird.isAvailable) return false;
    try {
      final status = await _shorebird.checkForUpdate();
      if (status == UpdateStatus.outdated) {
        if (context.mounted) {
          showAppSnack(
            context,
            'Yeni güncelleme paketi arka planda uygulanıyor...',
          );
        }
        await _shorebird.update();
        if (context.mounted) {
          await _showRestartReadyDialog(context);
        }
        return true;
      } else if (status == UpdateStatus.restartRequired) {
        if (context.mounted) {
          await _showRestartReadyDialog(context);
        }
        return true;
      }
    } catch (_) {
      // Shorebird sunucusuna ulaşılamazsa 2. katmana geç
    }
    return false;
  }

  static Future<void> _showRestartReadyDialog(BuildContext context) async {
    final patchNo = await currentPatchNumber();
    if (!context.mounted) return;
    await showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Row(
          children: [
            Container(
              width: 34,
              height: 34,
              decoration: BoxDecoration(
                color: AppColors.successSoft,
                borderRadius: BorderRadius.circular(10),
              ),
              child: const Icon(
                Icons.check_circle_rounded,
                color: AppColors.statusSuccess,
                size: 20,
              ),
            ),
            const SizedBox(width: 10),
            const Expanded(
              child: Text(
                'Güncelleme Tamamlandı',
                style: TextStyle(
                  fontSize: 15.5,
                  fontWeight: FontWeight.w800,
                  color: AppColors.primaryNavy,
                ),
              ),
            ),
          ],
        ),
        content: Text(
          'Yeni sürüm yaması${patchNo != null ? ' (Yama #$patchNo)' : ''} APK indirmeye gerek kalmadan otomatik yüklendi.\n\n'
          'Değişikliklerin aktif olması için uygulamayı kapatıp tekrar açmanız yeterlidir.',
          style: const TextStyle(fontSize: 12.5, height: 1.4),
        ),
        actions: [
          FilledButton(
            onPressed: () {
              Navigator.pop(ctx);
              SystemNavigator.pop();
            },
            child: const Text('Tamam (Uygulamayı Yeniden Başlat)'),
          ),
        ],
      ),
    );
  }

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

  /// Önce GitHub Bulut'tan (4.5G/5G ile her yerden çalışır),
  /// ulaşılamazsa AVM yerel sunucusundan (`10.16.19.19`) sürüm bilgisini çeker.
  static Future<AppUpdateInfo?> fetchRemoteInfo() async {
    if (kIsWeb) return null;
    final urls = [
      '$githubVersionJsonUrl?t=${DateTime.now().millisecondsSinceEpoch}',
      '$lanServerBaseUrl/download/version.json?t=${DateTime.now().millisecondsSinceEpoch}',
    ];
    for (final rawUrl in urls) {
      final client = HttpClient()
        ..connectionTimeout = const Duration(seconds: 4);
      try {
        final req = await client.getUrl(Uri.parse(rawUrl));
        req.headers.set(HttpHeaders.cacheControlHeader, 'no-cache');
        final res = await req.close().timeout(const Duration(seconds: 5));
        if (res.statusCode == 200) {
          final body = await res.transform(utf8.decoder).join();
          final decoded = jsonDecode(body);
          if (decoded is Map<String, dynamic>) {
            return AppUpdateInfo.fromJson(decoded);
          }
        }
      } catch (_) {
        // Sonraki kanalı dene
      } finally {
        client.close();
      }
    }
    return null;
  }

  /// Uygulama açılışında veya "Denetle" butonuna basıldığında çalışır.
  static Future<void> checkAndPrompt(
    BuildContext context, {
    bool manual = false,
  }) async {
    if (kIsWeb) return;
    if (!manual && _checkedThisSession) return;
    _checkedThisSession = true;

    // 1) Önce Shorebird sessiz OTA yama kontrolü yap (APK indirmeden günceller)
    final patchedViaShorebird = await _checkAndApplyShorebirdPatch(
      context,
      manual: manual,
    );
    if (patchedViaShorebird) return;

    // 2) Tam sürüm (buildNumber) kontrolü yap (Bulut GitHub + Yerel Sunucu)
    final installed = await getInstalledVersion();
    final info = await fetchRemoteInfo();
    if (!context.mounted) return;

    if (info == null) {
      if (manual) {
        final patchNo = await currentPatchNumber();
        if (context.mounted) {
          showAppSnack(
            context,
            'Uygulamanız güncel (v${installed.version} #${installed.buildNumber}${patchNo != null ? ' · OTA Yama #$patchNo' : ''}).',
          );
        }
      }
      return;
    }

    final hasNewBuild = isNewerVersion(
      remoteVersion: info.version,
      remoteBuild: info.buildNumber,
      localVersion: installed.version,
      localBuild: installed.buildNumber,
    );

    if (!hasNewBuild) {
      if (manual) {
        final patchNo = await currentPatchNumber();
        if (context.mounted) {
          showAppSnack(
            context,
            'Uygulamanız en güncel sürümde (v${installed.version} #${installed.buildNumber}${patchNo != null ? ' · OTA Yama #$patchNo' : ''}).',
          );
        }
      }
      return;
    }

    // Yeni ana yapı varsa TARAYICI AÇMADAN uygulama içi %0-%100 yükleyici modalını göster
    await showDialog<void>(
      context: context,
      barrierDismissible: !info.mandatory,
      builder: (_) => _InAppUpdateDialog(info: info),
    );
  }

  /// Cihazın desteklediği birincil Android ABI mimarisini (`arm64-v8a`, `armeabi-v7a` vb.) döner.
  static Future<String?> detectPreferredAbi() async {
    if (kIsWeb) return null;
    try {
      final abis = await _channel.invokeMethod<List<dynamic>>('getSupportedAbis');
      if (abis == null || abis.isEmpty) return null;
      final normalized = abis.map((e) => e.toString().trim()).toList();
      if (normalized.contains('arm64-v8a')) return 'arm64-v8a';
      if (normalized.contains('armeabi-v7a')) return 'armeabi-v7a';
      return normalized.first;
    } catch (_) {
      return null;
    }
  }

  /// Verilen güncelleme bilgisi ve cihaz ABI'sine göre en hafif ve en güvenilir
  /// indirme URL listesini sırayla üretir (4.5G HTTPS ABI-split -> Universal -> LAN).
  static List<String> buildCandidateApkUrls(
    AppUpdateInfo info, {
    String? preferredAbi,
  }) {
    final urls = <String>[];
    void addUnique(String? url) {
      final clean = url?.trim() ?? '';
      if (clean.isNotEmpty && !urls.contains(clean)) {
        urls.add(clean);
      }
    }

    final abiUrl = preferredAbi != null ? info.apkUrls[preferredAbi] : null;
    if (abiUrl != null && abiUrl.startsWith('https://')) {
      addUnique(abiUrl);
    }
    if (preferredAbi == 'arm64-v8a' || preferredAbi == 'armeabi-v7a') {
      addUnique(
        'https://github.com/talipdastan/downtown-teknik-platform/releases/latest/download/downtown-teknik-$preferredAbi.apk',
      );
    }

    final universalUrl = info.apkUrls['universal'];
    if (universalUrl != null && universalUrl.startsWith('https://')) {
      addUnique(universalUrl);
    }
    if (info.apkUrl.startsWith('https://')) {
      addUnique(info.apkUrl);
    }
    addUnique(githubReleaseApkUrl);

    if (preferredAbi == 'arm64-v8a' || preferredAbi == 'armeabi-v7a') {
      addUnique('$lanServerBaseUrl/download/downtown-teknik-$preferredAbi.apk');
    }
    if (abiUrl != null && !abiUrl.startsWith('https://')) {
      addUnique(abiUrl);
    }
    if (info.apkUrl.isNotEmpty && !info.apkUrl.startsWith('https://')) {
      addUnique(info.apkUrl);
    }
    addUnique('$lanServerBaseUrl/download/downtown-teknik.apk');
    return urls;
  }

  /// Tarayıcı açmadan indirilen paketi Android PackageInstaller ile kurar.
  static Future<bool> installDownloadedApk(String filePath) async {
    try {
      final ok = await _channel.invokeMethod<bool>(
        'installApkFile',
        {'filePath': filePath},
      );
      return ok ?? false;
    } catch (_) {
      return false;
    }
  }
}

class _InAppUpdateDialog extends StatefulWidget {
  final AppUpdateInfo info;
  const _InAppUpdateDialog({required this.info});

  @override
  State<_InAppUpdateDialog> createState() => _InAppUpdateDialogState();
}

class _InAppUpdateDialogState extends State<_InAppUpdateDialog> {
  bool _downloading = false;
  double _progress = 0.0;
  String? _statusText;
  String? _errorText;

  @override
  void initState() {
    super.initState();
    // Play Store gibi kullanıcı açtığı anda indirmeyi otomatik başlatır (tarayıcı açılmaz)
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) {
        _startInAppUpdate();
      }
    });
  }

  Future<void> _startInAppUpdate() async {
    setState(() {
      _downloading = true;
      _progress = 0.02;
      _errorText = null;
      _statusText = 'Güncelleme paketi hazırlanıyor...';
    });

    // Önce cihaz ABI'sine uygun ~21 MB HTTPS (4.5G/GitHub Release), yoksa universal ve LAN dene
    final preferredAbi = await AppUpdateService.detectPreferredAbi();
    final candidateUrls = AppUpdateService.buildCandidateApkUrls(
      widget.info,
      preferredAbi: preferredAbi,
    );

    File? downloadedFile;
    for (final url in candidateUrls) {
      final file = await _tryDownloadFrom(url);
      if (file != null) {
        downloadedFile = file;
        break;
      }
    }

    if (!mounted) return;

    if (downloadedFile == null) {
      setState(() {
        _downloading = false;
        _errorText =
            'Güncelleme paketi indirilemedi. İnternet bağlantınızı kontrol edip tekrar deneyin.';
      });
      return;
    }

    setState(() {
      _progress = 1.0;
      _statusText = 'Kurulum başlatılıyor...';
    });

    final ok = await AppUpdateService.installDownloadedApk(downloadedFile.path);
    if (!mounted) return;
    if (ok) {
      Navigator.pop(context);
    } else {
      setState(() {
        _downloading = false;
        _errorText =
            'Android kurulum izni reddedildi. Lütfen "Bilinmeyen uygulamaları yükle" iznini onaylayın.';
      });
    }
  }

  Future<File?> _tryDownloadFrom(String url) async {
    final client = HttpClient()
      ..connectionTimeout = const Duration(seconds: 6);
    try {
      final req = await client.getUrl(Uri.parse(url));
      final res = await req.close();
      if (res.statusCode != 200) return null;

      final total = res.contentLength;
      final dir = await getTemporaryDirectory();
      final outFile = File(
        '${dir.path}/downtown_teknik_update_${widget.info.buildNumber}.apk',
      );
      final sink = outFile.openWrite();
      int received = 0;

      await for (final chunk in res) {
        sink.add(chunk);
        received += chunk.length;
        if (mounted && total > 0) {
          final pct = (received / total).clamp(0.0, 1.0);
          setState(() {
            _progress = pct;
            _statusText =
                'Uygulama güncelleniyor... %${(pct * 100).toStringAsFixed(0)}';
          });
        }
      }
      await sink.flush();
      await sink.close();
      if (received < 1024 * 100) return null; // 100 KB altıysa geçersiz yanıt
      return outFile;
    } catch (_) {
      return null;
    } finally {
      client.close();
    }
  }

  @override
  Widget build(BuildContext context) {
    final info = widget.info;
    return AlertDialog(
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
              'Yeni Sürüm Hazır',
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
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              'Downtown Teknik v${info.version} (Yapı #${info.buildNumber}) mevcut.',
              style: const TextStyle(
                fontSize: 12.5,
                fontWeight: FontWeight.w700,
                color: AppColors.textPrimary,
              ),
            ),
            if (info.releaseNotes.isNotEmpty) ...[
              const SizedBox(height: 8),
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
            if (_downloading) ...[
              const SizedBox(height: 14),
              ClipRRect(
                borderRadius: BorderRadius.circular(8),
                child: LinearProgressIndicator(
                  value: _progress,
                  minHeight: 8,
                  backgroundColor: AppColors.primarySoft,
                  valueColor: const AlwaysStoppedAnimation<Color>(
                    AppColors.accentTurquoise,
                  ),
                ),
              ),
              const SizedBox(height: 6),
              Text(
                _statusText ?? 'Yükleniyor...',
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontSize: 11.5,
                  fontWeight: FontWeight.w700,
                  color: AppColors.primaryNavy,
                ),
              ),
            ],
            if (_errorText != null) ...[
              const SizedBox(height: 10),
              Text(
                _errorText!,
                style: const TextStyle(
                  fontSize: 11.5,
                  color: AppColors.priorityUrgent,
                ),
              ),
            ],
          ],
        ),
      ),
      actions: [
        if (!info.mandatory && !_downloading)
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Daha Sonra'),
          ),
        FilledButton.icon(
          style: FilledButton.styleFrom(
            backgroundColor: AppColors.accentTurquoise,
          ),
          onPressed: _downloading ? null : _startInAppUpdate,
          icon: const Icon(Icons.system_update_alt_rounded, size: 17),
          label: Text(_downloading ? 'Güncelleniyor...' : 'Uygulama İçinde Güncelle'),
        ),
      ],
    );
  }
}

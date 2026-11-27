import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:path_provider/path_provider.dart';

/// Bodrum, otopark ve makine daireleri gibi ağ bağlantısının koptuğu alanlarda
/// kat, mahal, kategori, ekipman ve sayaç referans listelerinin boş gelmesini
/// önleyen yerel read-through JSON önbelleği.
class LocalLookupCache {
  LocalLookupCache._();

  static final LocalLookupCache instance = LocalLookupCache._();

  Future<File?> _fileFor(String key) async {
    if (kIsWeb) return null;
    try {
      final dir = await getApplicationDocumentsDirectory();
      final cacheDir = Directory('${dir.path}/lookup_cache');
      if (!await cacheDir.exists()) {
        await cacheDir.create(recursive: true);
      }
      final safeKey = key.replaceAll(RegExp(r'[^a-zA-Z0-9._-]'), '_');
      return File('${cacheDir.path}/$safeKey.json');
    } catch (_) {
      // Headless widget test veya desteklenmeyen ortamda sessiz geç
      return null;
    }
  }

  Future<void> writeList(String key, List<Map<String, dynamic>> rows) async {
    try {
      final file = await _fileFor(key);
      if (file == null) return;
      final tmp = File('${file.path}.tmp');
      await tmp.writeAsString(jsonEncode(rows), flush: true);
      if (await file.exists()) {
        await file.delete();
      }
      await tmp.rename(file.path);
    } catch (_) {
      // Önbellek yazma hatası ana akışı bloklamaz
    }
  }

  Future<List<Map<String, dynamic>>?> readList(String key) async {
    try {
      final file = await _fileFor(key);
      if (file == null || !await file.exists()) return null;
      final raw = await file.readAsString();
      if (raw.trim().isEmpty) return null;
      final decoded = jsonDecode(raw);
      if (decoded is! List) return null;
      return decoded
          .whereType<Map>()
          .map((e) => Map<String, dynamic>.from(e))
          .toList();
    } catch (_) {
      return null;
    }
  }

  /// Çevrimiçiyken sunucudan çekip yerel önbelleği günceller; ağ hatası olursa
  /// yerel önbellekteki son geçerli listeyi döndürür.
  Future<List<Map<String, dynamic>>> readThrough({
    required String key,
    required Future<List<Map<String, dynamic>>> Function() fetchRemote,
  }) async {
    try {
      final remote = await fetchRemote();
      await writeList(key, remote);
      return remote;
    } catch (_) {
      final cached = await readList(key);
      if (cached != null) return cached;
      rethrow;
    }
  }
}

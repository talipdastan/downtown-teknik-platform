/// Saf Dart yardımcıları (Flutter / Supabase bağımlılığı yok → birim test edilebilir).
class AppUtils {
  AppUtils._();

  static const Map<String, String> _mimeByExtension = {
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'webp': 'image/webp',
    'pdf': 'application/pdf',
  };

  /// Storage bucket'ında izin verilen mime türleri.
  static const Set<String> allowedMimeTypes = {
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/pdf',
  };

  /// Dosya adının uzantısından mime türünü döndürür; desteklenmiyorsa null.
  static String? mimeFromFileName(String fileName) {
    final dot = fileName.lastIndexOf('.');
    if (dot < 0 || dot == fileName.length - 1) return null;
    return _mimeByExtension[fileName.substring(dot + 1).toLowerCase()];
  }

  static bool isAllowedMime(String? mime) =>
      mime != null && allowedMimeTypes.contains(mime);

  /// Yol ayırıcıları ve özel karakterleri temizler.
  static String sanitizeFileName(String name) {
    final base = name.split('/').last.split('\\').last;
    final cleaned = base.replaceAll(RegExp(r'[^A-Za-z0-9._-]'), '_');
    return cleaned.isEmpty ? 'dosya' : cleaned;
  }

  /// Storage yolu kuralı: `<auth.uid()>/<ticket_id veya work_order_id>/<dosyaadı>`.
  static String buildStoragePath({
    required String userId,
    required String parentId,
    required String fileName,
    required int timestampMs,
  }) {
    return '$userId/$parentId/${timestampMs}_${sanitizeFileName(fileName)}';
  }

  static bool isValidEmail(String value) {
    return RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch(value.trim());
  }

  /// En az 10, en çok 13 rakam (boşluk, tire, parantez ve + yok sayılır).
  static bool isValidPhone(String value) {
    final digits = value.replaceAll(RegExp(r'[\s\-\+\(\)]'), '');
    return RegExp(r'^\d{10,13}$').hasMatch(digits);
  }

  static String _two(int n) => n.toString().padLeft(2, '0');

  /// dd.MM.yyyy
  static String formatDate(DateTime date) {
    final d = date.toLocal();
    return '${_two(d.day)}.${_two(d.month)}.${d.year}';
  }

  /// dd.MM.yyyy HH:mm
  static String formatDateTime(DateTime date) {
    final d = date.toLocal();
    return '${formatDate(d)} ${_two(d.hour)}:${_two(d.minute)}';
  }
}

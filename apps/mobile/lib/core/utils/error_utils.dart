import 'dart:async';
import 'dart:io';

import 'package:supabase_flutter/supabase_flutter.dart';

/// Kullanıcıya olduğu gibi gösterilebilecek uygulama hatası.
class AppException implements Exception {
  final String message;
  const AppException(this.message);

  @override
  String toString() => message;
}

const String notConfiguredMessage =
    'Supabase bağlantısı yapılandırılmamış. Uygulamayı '
    '--dart-define=SUPABASE_URL=... ve --dart-define=SUPABASE_ANON_KEY=... '
    'ile başlatın.';

const String offlineMessage =
    'İnternet bağlantısı yok. Bu işlem çevrimdışıyken yapılamaz; '
    'bağlantınızı kontrol edip tekrar deneyin.';

const String noSessionMessage = 'Oturum bulunamadı. Lütfen tekrar giriş yapın.';

bool _looksOffline(String text) {
  return text.contains('SocketException') ||
      text.contains('Failed host lookup') ||
      text.contains('ClientException') ||
      text.contains('Network is unreachable') ||
      text.contains('Connection refused');
}

/// Herhangi bir hatayı Türkçe, kullanıcı dostu mesaja çevirir.
String friendlyError(Object error) {
  if (error is AppException) return error.message;
  if (error is SocketException || error is TimeoutException) {
    return offlineMessage;
  }

  if (error is AuthException) {
    if (_looksOffline(error.message)) return offlineMessage;
    final m = error.message.toLowerCase();
    if (m.contains('invalid login credentials')) {
      return 'E-posta veya şifre hatalı.';
    }
    if (m.contains('email not confirmed')) {
      return 'E-posta adresiniz henüz doğrulanmamış. Gelen kutunuzdaki doğrulama bağlantısını kullanın.';
    }
    if (m.contains('already registered') || m.contains('already been registered')) {
      return 'Bu e-posta adresi ile zaten bir hesap var.';
    }
    if (m.contains('rate limit') ||
        m.contains('only request this after') ||
        (error.code?.toLowerCase().contains('rate_limit') ?? false)) {
      return 'Kısa sürede birden fazla istek gönderildi. Kaydınız oluşturulduysa Giriş ekranından giriş yapabilirsiniz.';
    }
    return error.message;
  }

  if (error is PostgrestException) {
    if (_looksOffline(error.message)) return offlineMessage;
    if (error.code == '42501') return 'Bu işlem için yetkiniz yok.';
    return error.message;
  }

  if (error is StorageException) {
    if (_looksOffline(error.message)) return offlineMessage;
    return 'Dosya işlemi başarısız: ${error.message}';
  }

  final text = error.toString();
  if (_looksOffline(text)) return offlineMessage;
  return 'Beklenmeyen hata: $text';
}

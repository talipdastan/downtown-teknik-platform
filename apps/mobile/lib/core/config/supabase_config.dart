import 'package:supabase_flutter/supabase_flutter.dart';

class SupabaseConfig {
  static const String url = String.fromEnvironment(
    'SUPABASE_URL',
    defaultValue: 'https://urahnnrofnkbssxftuyz.supabase.co',
  );
  static const String anonKey = String.fromEnvironment(
    'SUPABASE_ANON_KEY',
    defaultValue: 'sb_publishable_yo4TE_SHiSPB5vAQxc_2mQ_FNNggljo',
  );

  static bool get isConfigured => url.isNotEmpty && anonKey.isNotEmpty;

  static Future<void> initialize() async {
    if (!isConfigured) return;
    await Supabase.initialize(
      url: url,
      publishableKey: anonKey,
    );
  }

  static SupabaseClient? get clientOrNull {
    if (!isConfigured) return null;
    try {
      return Supabase.instance.client;
    } catch (_) {
      return null;
    }
  }

  /// Yapılandırma varsa istemciyi döndürür (çağıran önce [isConfigured] kontrol etmelidir).
  static SupabaseClient get client => Supabase.instance.client;
}

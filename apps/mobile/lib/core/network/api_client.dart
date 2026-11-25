import 'package:supabase_flutter/supabase_flutter.dart';

import 'package:avm_tech_platform/core/utils/error_utils.dart';
import 'package:avm_tech_platform/core/config/supabase_config.dart';

/// Supabase erişimi için güvenli kapı: yapılandırılmamışsa sahte sonuç
/// döndürmek yerine açık hata fırlatır.
class Api {
  Api._();

  static SupabaseClient get client {
    if (!SupabaseConfig.isConfigured) {
      throw const AppException(notConfiguredMessage);
    }
    return SupabaseConfig.client;
  }

  static String get userId {
    final id = client.auth.currentUser?.id;
    if (id == null) throw const AppException(noSessionMessage);
    return id;
  }
}

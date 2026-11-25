import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../config/supabase_config.dart';
import '../modules/app_module.dart';
import '../modules/module_registry.dart';
import '../permissions/permission_models.dart';
import '../utils/error_utils.dart';

enum AuthStatus {
  initial,
  loading,
  unauthenticated,
  pendingApproval,
  authenticated,
  error,
}

class AuthState {
  final AuthStatus status;
  final ProfileModel? profile;
  final String? errorMessage;

  const AuthState({
    required this.status,
    this.profile,
    this.errorMessage,
  });

  const AuthState.initial() : this(status: AuthStatus.initial);
}

final moduleRegistryProvider = Provider<ModuleRegistry>((ref) {
  return ModuleRegistry();
});

final systemModulesProvider =
    FutureProvider<Map<String, SystemModuleState>>((ref) async {
  final client = SupabaseConfig.clientOrNull;
  if (client == null) return const {};

  final response = await client.rpc('rpc_get_my_modules');
  if (response is! List) return const {};

  final map = <String, SystemModuleState>{};
  for (final item in response) {
    if (item is Map<String, dynamic>) {
      final state = SystemModuleState.fromJson(item);
      map[state.key] = state;
    }
  }
  return map;
});

class AuthNotifier extends StateNotifier<AuthState> {
  AuthNotifier() : super(const AuthState.initial()) {
    _bootstrap();
  }

  /// Widget testlerinde Supabase bağımlılığı olmadan başlangıç durumu enjekte eder.
  AuthNotifier.withInitialState(super.initialState);

  Future<void> _bootstrap() async {
    final client = SupabaseConfig.clientOrNull;
    if (client == null) {
      state = const AuthState(status: AuthStatus.unauthenticated);
      return;
    }

    final session = client.auth.currentSession;
    if (session == null) {
      state = const AuthState(status: AuthStatus.unauthenticated);
      return;
    }
    await loadProfile(session.user.id);
  }

  /// Oturumu kapatmadan profil / yetki bilgisini yeniler.
  Future<void> refreshProfile() async {
    final client = SupabaseConfig.clientOrNull;
    final uid = client?.auth.currentUser?.id;
    if (uid == null) return;
    await loadProfile(uid);
  }

  Future<void> loadProfile(String userId) async {
    final client = SupabaseConfig.clientOrNull;
    if (client == null) return;

    state = const AuthState(status: AuthStatus.loading);
    try {
      final row = await client
          .from('profiles')
          .select('*, departments(name)')
          .eq('id', userId)
          .single();

      final profile = ProfileModel.fromJson(row);
      if (profile.isApproved) {
        state = AuthState(status: AuthStatus.authenticated, profile: profile);
      } else {
        state = AuthState(status: AuthStatus.pendingApproval, profile: profile);
      }
    } catch (e) {
      state = AuthState(
        status: AuthStatus.error,
        errorMessage: 'Profil bilgisi alınamadı: $e',
      );
    }
  }

  /// E-posta, Ad Soyad veya Telefon ile giriş (`rpc_resolve_login_email`).
  Future<bool> signIn(String identifier, String password) async {
    final client = SupabaseConfig.clientOrNull;
    if (client == null) {
      state = const AuthState(
        status: AuthStatus.error,
        errorMessage: 'Supabase bağlantısı yapılandırılmamış.',
      );
      return false;
    }

    state = const AuthState(status: AuthStatus.loading);
    try {
      String? resolvedEmail = identifier.trim();
      if (!resolvedEmail.contains('@')) {
        final res = await client.rpc(
          'rpc_resolve_login_email',
          params: {'p_identifier': resolvedEmail},
        );
        resolvedEmail = res?.toString();
      }

      if (resolvedEmail == null || resolvedEmail.isEmpty) {
        state = const AuthState(
          status: AuthStatus.unauthenticated,
          errorMessage: 'Kullanıcı bulunamadı.',
        );
        return false;
      }

      final authRes = await client.auth.signInWithPassword(
        email: resolvedEmail,
        password: password,
      );

      if (authRes.user == null) {
        state = const AuthState(
          status: AuthStatus.unauthenticated,
          errorMessage: 'Giriş başarısız.',
        );
        return false;
      }

      await loadProfile(authRes.user!.id);
      return state.status == AuthStatus.authenticated ||
          state.status == AuthStatus.pendingApproval;
    } on AuthException catch (e) {
      state = AuthState(
        status: AuthStatus.unauthenticated,
        errorMessage: friendlyError(e),
      );
      return false;
    } catch (e) {
      state = AuthState(
        status: AuthStatus.unauthenticated,
        errorMessage: friendlyError(e),
      );
      return false;
    }
  }

  /// SMTP doğrulama e-postası hız limitine (429 over_email_send_rate_limit)
  /// takılmadan `rpc_register_user` ile personel kaydı oluşturur ve
  /// hemen oturum açıp onay bekleme (`/pending`) veya ana ekrana yönlendirir.
  Future<bool> signUp({
    required String fullName,
    required String email,
    required String password,
    String? phone,
  }) async {
    final client = SupabaseConfig.clientOrNull;
    if (client == null) {
      state = const AuthState(
        status: AuthStatus.error,
        errorMessage: 'Supabase bağlantısı yapılandırılmamış.',
      );
      return false;
    }

    final cleanEmail = email.trim().toLowerCase();
    final cleanName = fullName.trim();
    final cleanPhone = phone?.trim();

    state = const AuthState(status: AuthStatus.loading);
    try {
      await client.rpc(
        'rpc_register_user',
        params: {
          'p_full_name': cleanName,
          'p_email': cleanEmail,
          'p_password': password,
          'p_phone': (cleanPhone != null && cleanPhone.isNotEmpty) ? cleanPhone : null,
        },
      );

      final authRes = await client.auth.signInWithPassword(
        email: cleanEmail,
        password: password,
      );

      if (authRes.user != null) {
        await loadProfile(authRes.user!.id);
        return true;
      }

      state = const AuthState(status: AuthStatus.unauthenticated);
      return true;
    } catch (e) {
      state = AuthState(
        status: AuthStatus.unauthenticated,
        errorMessage: friendlyError(e),
      );
      return false;
    }
  }

  Future<void> signOut() async {
    final client = SupabaseConfig.clientOrNull;
    if (client != null) {
      await client.auth.signOut();
    }
    state = const AuthState(status: AuthStatus.unauthenticated);
  }
}

final authProvider = StateNotifierProvider<AuthNotifier, AuthState>((ref) {
  return AuthNotifier();
});

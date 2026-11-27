import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../auth/auth_provider.dart';
import '../modules/module_registry.dart';
import '../permissions/permission_models.dart';
import '../screens/cmms_hub_screen.dart';
import '../screens/equipment_passport_screen.dart';
import '../screens/login_screen.dart';
import '../screens/module_launcher_screen.dart';
import '../screens/notifications_screen.dart';
import '../screens/pending_approval_screen.dart';
import '../screens/profile_screen.dart';
import '../screens/register_screen.dart';
import '../screens/users_management_screen.dart';

/// Saf yönlendirme karar fonksiyonu (birim testlerle doğrudan doğrulanır).
String? resolvePlatformRedirect({
  required AuthStatus status,
  required String location,
  required ModuleRegistry registry,
  ProfileModel? profile,
}) {
  final isAuthRoute = location == '/login' || location == '/register';

  switch (status) {
    case AuthStatus.initial:
    case AuthStatus.loading:
      return null;
    case AuthStatus.unauthenticated:
    case AuthStatus.error:
      return isAuthRoute ? null : '/login';
    case AuthStatus.pendingApproval:
      return location == '/pending-approval' ? null : '/pending-approval';
    case AuthStatus.authenticated:
      if (isAuthRoute ||
          location == '/pending-approval' ||
          location == '/splash') {
        return '/home';
      }
      // Modül bazlı rota güvenlik kontrolü
      if (profile != null) {
        if (location == '/admin/users' &&
            !profile.isSystemAdmin &&
            !profile.hasCoreAction(CoreAction.manageUsers)) {
          return '/home';
        }
        final matchedModule = registry.findByRoute(location);
        if (matchedModule != null && !matchedModule.canAccess(profile)) {
          return '/home';
        }
        if (location == '/work-tracking/tickets/new' &&
            !profile.hasModulePermission('work_tracking', ModulePermission.create)) {
          return '/work-tracking';
        }
        if (location == '/work-tracking/manager-work-orders' &&
            !profile.hasModulePermission('work_tracking', ModulePermission.manage) &&
            !profile.hasModulePermission('work_tracking', ModulePermission.approve)) {
          return '/work-tracking';
        }
        if (location == '/energy/invoices' &&
            !profile.hasModulePermission('energy', ModulePermission.reports) &&
            !profile.hasModulePermission('energy', ModulePermission.manage)) {
          return '/energy';
        }
      }
      return null;
  }
}

class _RouterRefresh extends ChangeNotifier {
  void notify() => notifyListeners();
}

final routerProvider = Provider<GoRouter>((ref) {
  final registry = ref.watch(moduleRegistryProvider);
  final refresh = _RouterRefresh();
  ref.listen<AuthState>(authProvider, (_, __) => refresh.notify());
  ref.onDispose(refresh.dispose);

  return GoRouter(
    initialLocation: '/splash',
    refreshListenable: refresh,
    redirect: (context, state) {
      final auth = ref.read(authProvider);
      return resolvePlatformRedirect(
        status: auth.status,
        location: state.matchedLocation,
        registry: registry,
        profile: auth.profile,
      );
    },
    routes: [
      GoRoute(
        path: '/splash',
        builder: (context, state) => const Scaffold(
          body: Center(child: CircularProgressIndicator()),
        ),
      ),
      GoRoute(
        path: '/login',
        builder: (context, state) => const LoginScreen(),
      ),
      GoRoute(
        path: '/register',
        builder: (context, state) => const RegisterScreen(),
      ),
      GoRoute(
        path: '/pending-approval',
        builder: (context, state) => const PendingApprovalScreen(),
      ),
      GoRoute(
        path: '/home',
        builder: (context, state) => const ModuleLauncherScreen(),
      ),
      GoRoute(
        path: '/admin/users',
        builder: (context, state) => const UsersManagementScreen(),
      ),
      GoRoute(
        path: '/notifications',
        builder: (context, state) => const NotificationsScreen(),
      ),
      GoRoute(
        path: '/profile',
        builder: (context, state) => const ProfileScreen(),
      ),
      GoRoute(
        path: '/equipment-passport',
        builder: (context, state) => const EquipmentPassportScreen(),
      ),
      GoRoute(
        path: '/cmms',
        builder: (context, state) {
          final tab = int.tryParse(state.uri.queryParameters['tab'] ?? '0') ?? 0;
          return CmmsHubScreen(initialTab: tab);
        },
      ),
      // Tüm kayıtlı modüllerin rotaları otomatik olarak eklenir
      ...registry.buildAllRoutes(),
    ],
  );
});

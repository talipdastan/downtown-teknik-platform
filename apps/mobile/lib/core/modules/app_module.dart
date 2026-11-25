import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../permissions/permission_models.dart';

class ModuleNavItem {
  final String label;
  final IconData icon;
  final String route;

  const ModuleNavItem({
    required this.label,
    required this.icon,
    required this.route,
  });
}

/// Veritabanındaki `system_modules` tablosundan gelen modül durum bilgisi.
class SystemModuleState {
  final String key;
  final bool isEnabled;
  final bool isComingSoon;
  final int sortOrder;

  const SystemModuleState({
    required this.key,
    required this.isEnabled,
    required this.isComingSoon,
    required this.sortOrder,
  });

  factory SystemModuleState.fromJson(Map<String, dynamic> json) {
    return SystemModuleState(
      key: json['key'] as String,
      isEnabled: json['is_enabled'] as bool? ?? false,
      isComingSoon: json['is_coming_soon'] as bool? ?? false,
      sortOrder: json['sort_order'] as int? ?? 0,
    );
  }
}

/// Sade ve genişletilebilir modül sözleşmesi.
/// Yeni bir modül eklemek için bu sınıfı implemente edip ModuleRegistry
/// listesine tek satırla eklemek yeterlidir.
abstract class AppModule {
  String get key;
  String get title;
  String get subtitle;
  IconData get icon;
  Color get accentColor;
  String get entryRoute;
  int get sortOrder;
  bool get isComingSoon => false;

  bool canAccess(ProfileModel profile) {
    return profile.hasModulePermission(key, ModulePermission.enabled);
  }

  List<RouteBase> buildRoutes();

  /// Modüle ait bir bildirim tıklandığında gidilecek rotayı döndürür.
  String? notificationRoute(String? entityType, String? entityId) => null;

  List<ModuleNavItem> get navItems => const [];
}

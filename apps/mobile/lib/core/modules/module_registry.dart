import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../features/energy/energy_module.dart';
import '../../features/maintenance/maintenance_module.dart';
import '../../features/work_tracking/work_tracking_module.dart';
import '../permissions/permission_models.dart';
import '../theme/app_theme.dart';
import 'app_module.dart';

/// Gelecek modüller için sade placeholder tanımı (ana ekranda yalnızca
/// sistem yöneticisine "Yakında" etiketiyle gösterilebilir).
class ComingSoonModule extends AppModule {
  @override
  final String key;
  @override
  final String title;
  @override
  final String subtitle;
  @override
  final IconData icon;
  @override
  final Color accentColor;
  @override
  final String entryRoute;
  @override
  final int sortOrder;

  ComingSoonModule({
    required this.key,
    required this.title,
    required this.subtitle,
    required this.icon,
    required this.accentColor,
    required this.entryRoute,
    required this.sortOrder,
  });

  @override
  bool get isComingSoon => true;

  @override
  bool canAccess(ProfileModel profile) => false;

  @override
  List<RouteBase> buildRoutes() => const [];
}

/// Merkezi ve sade Modül Kayıt Defteri.
/// Gereksiz karmaşık dinamik eklenti yükleyicileri yerine açık kayıt listesi kullanır.
class ModuleRegistry {
  final List<AppModule> _modules;

  ModuleRegistry({List<AppModule>? modules})
      : _modules = modules ??
            [
              EnergyModule(),
              WorkTrackingModule(),
              MaintenanceModule(),
              ComingSoonModule(
                key: 'assets',
                title: 'Demirbaş & Ekipman',
                subtitle: 'Ekipman envanteri, garanti ve teknik geçmiş',
                icon: Icons.inventory_2_outlined,
                accentColor: AppColors.assetsAccent,
                entryRoute: '/assets',
                sortOrder: 4,
              ),
            ];

  List<AppModule> get allModules {
    final sorted = List<AppModule>.from(_modules);
    sorted.sort((a, b) => a.sortOrder.compareTo(b.sortOrder));
    return List.unmodifiable(sorted);
  }

  /// Kullanıcının yetkili olduğu aktif modülleri (ve admin için yakında modüllerini) döndürür.
  List<AppModule> visibleModulesFor(
    ProfileModel profile, {
    Map<String, SystemModuleState>? serverStates,
  }) {
    final result = <AppModule>[];
    for (final mod in allModules) {
      final server = serverStates?[mod.key];
      final isComingSoon = server?.isComingSoon ?? mod.isComingSoon;
      final isEnabled = server?.isEnabled ?? !mod.isComingSoon;

      if (isComingSoon) {
        if (profile.isSystemAdmin) {
          result.add(mod);
        }
        continue;
      }

      if (!isEnabled && !profile.isSystemAdmin) continue;
      if (mod.canAccess(profile)) {
        result.add(mod);
      }
    }
    return result;
  }

  AppModule? findByRoute(String location) {
    for (final mod in _modules) {
      if (!mod.isComingSoon &&
          (location == mod.entryRoute ||
              location.startsWith('${mod.entryRoute}/'))) {
        return mod;
      }
    }
    return null;
  }

  List<RouteBase> buildAllRoutes() {
    return _modules.expand((m) => m.buildRoutes()).toList();
  }

  /// Bildirimdeki moduleKey + entityType + entityId bilgisine göre modül içi rotayı çözer.
  String? resolveNotificationRoute(
    String moduleKey,
    String? entityType,
    String? entityId,
  ) {
    for (final mod in _modules) {
      if (mod.key == moduleKey && !mod.isComingSoon) {
        return mod.notificationRoute(entityType, entityId);
      }
    }
    return null;
  }
}

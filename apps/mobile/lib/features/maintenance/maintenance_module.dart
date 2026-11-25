import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'package:avm_tech_platform/core/equipment/equipment_providers.dart';
import 'package:avm_tech_platform/core/modules/app_module.dart';
import 'package:avm_tech_platform/core/permissions/permission_models.dart';
import 'package:avm_tech_platform/core/theme/app_theme.dart';
import 'package:avm_tech_platform/core/widgets/common_widgets.dart';

/// Gelecek Planlı Bakım (maintenance) modülü iskeleti.
/// Mevcut `energy` ve `work_tracking` modüllerine veya çekirdek router'a
/// dokunulmadan yalnizca `AppModule` sözleşmesiyle sisteme takılır.
class MaintenanceModule extends AppModule {
  @override
  final bool isComingSoon;

  MaintenanceModule({this.isComingSoon = true});

  @override
  String get key => 'maintenance';

  @override
  String get title => 'Planlı Bakım';

  @override
  String get subtitle => 'Periyodik bakım, bakım takvimi ve kontrol listeleri';

  @override
  IconData get icon => Icons.event_repeat_rounded;

  @override
  Color get accentColor => AppColors.maintenanceAccent;

  @override
  String get entryRoute => '/maintenance';

  @override
  int get sortOrder => 3;

  @override
  bool canAccess(ProfileModel profile) {
    if (isComingSoon) return false;
    return profile.hasModulePermission(key, ModulePermission.enabled);
  }

  @override
  String? notificationRoute(String? entityType, String? entityId) {
    if (isComingSoon) return null;
    return entityId != null ? '/maintenance/plans/$entityId' : entryRoute;
  }

  @override
  List<ModuleNavItem> get navItems => const [
        ModuleNavItem(
          label: 'Bakım Özeti',
          icon: Icons.event_repeat_rounded,
          route: '/maintenance',
        ),
      ];

  @override
  List<RouteBase> buildRoutes() {
    if (isComingSoon) return const [];
    return [
      GoRoute(
        path: entryRoute,
        builder: (context, state) => const _MaintenanceHomeScreen(),
        routes: [
          GoRoute(
            path: 'plans/:id',
            builder: (context, state) => _MaintenanceHomeScreen(
              highlightedPlanId: state.pathParameters['id'],
            ),
          ),
        ],
      ),
    ];
  }
}

/// Ortak `equipmentOptionsProvider` (core/equipment) altyapısını doğrudan
/// yeniden kullanan bağımsız Planlı Bakım önizleme ekranı.
class _MaintenanceHomeScreen extends ConsumerWidget {
  final String? highlightedPlanId;

  const _MaintenanceHomeScreen({this.highlightedPlanId});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final equipmentsAsync = ref.watch(equipmentOptionsProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Planlı Bakım')),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (highlightedPlanId != null)
              Card(
                child: ListTile(
                  leading: const Icon(Icons.event_note_outlined),
                  title: Text('Bakım Planı: $highlightedPlanId'),
                ),
              ),
            Expanded(
              child: AsyncValueView(
                value: equipmentsAsync,
                onRetry: () => ref.invalidate(equipmentOptionsProvider),
                data: (items) {
                  if (items.isEmpty) {
                    return const Center(
                      child: Text('Kayıtlı ekipman bulunmuyor'),
                    );
                  }
                  return ListView.separated(
                    itemCount: items.length,
                    separatorBuilder: (_, __) => const SizedBox(height: 8),
                    itemBuilder: (_, i) {
                      final eq = items[i];
                      return Card(
                        child: ListTile(
                          leading: const Icon(Icons.build_circle_outlined),
                          title: Text('${eq.code} • ${eq.name}'),
                          subtitle: Text('Durum: ${eq.status}'),
                        ),
                      );
                    },
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import 'package:avm_tech_platform/core/modules/app_module.dart';
import 'package:avm_tech_platform/core/theme/app_theme.dart';
import 'package:avm_tech_platform/features/energy/presentation/screens/energy_home_screen.dart';
import 'package:avm_tech_platform/features/energy/presentation/screens/energy_invoices_screen.dart';
import 'package:avm_tech_platform/features/energy/presentation/screens/meter_detail_screen.dart';
import 'package:avm_tech_platform/features/energy/presentation/screens/meter_list_screen.dart';

/// Enerji Takip Modülü kayıt sınıfı.
class EnergyModule extends AppModule {
  @override
  String get key => 'energy';

  @override
  String get title => 'Enerji Takip';

  @override
  String get subtitle => 'Sayaçlar, okumalar, faturalar, bütçe ve raporlar';

  @override
  IconData get icon => Icons.bolt_rounded;

  @override
  Color get accentColor => AppColors.energyAccent;

  @override
  String get entryRoute => '/energy';

  @override
  int get sortOrder => 1;

  @override
  String? notificationRoute(String? entityType, String? entityId) {
    return entityId != null ? '/energy/meters/$entityId' : '/energy';
  }

  @override
  List<ModuleNavItem> get navItems => const [
        ModuleNavItem(
          label: 'Özet',
          icon: Icons.dashboard_outlined,
          route: '/energy',
        ),
        ModuleNavItem(
          label: 'Elektrik',
          icon: Icons.electric_meter_outlined,
          route: '/energy/electric',
        ),
        ModuleNavItem(
          label: 'Mekanik',
          icon: Icons.water_drop_outlined,
          route: '/energy/mechanical',
        ),
        ModuleNavItem(
          label: 'Faturalar',
          icon: Icons.receipt_long_outlined,
          route: '/energy/invoices',
        ),
      ];

  @override
  List<RouteBase> buildRoutes() => [
        GoRoute(
          path: entryRoute,
          builder: (context, state) => const EnergyHomeScreen(),
          routes: [
            GoRoute(
              path: 'electric',
              builder: (context, state) =>
                  const MeterListScreen(meterType: 'electric'),
            ),
            GoRoute(
              path: 'mechanical',
              builder: (context, state) =>
                  const MeterListScreen(meterType: 'mechanical'),
            ),
            GoRoute(
              path: 'meters/:id',
              builder: (context, state) =>
                  MeterDetailScreen(meterId: state.pathParameters['id']!),
            ),
            GoRoute(
              path: 'invoices',
              builder: (context, state) {
                final tab = int.tryParse(state.uri.queryParameters['tab'] ?? '') ?? 0;
                return EnergyInvoicesScreen(initialTab: tab);
              },
            ),
          ],
        ),
      ];
}

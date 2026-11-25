import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../core/modules/app_module.dart';
import '../../core/theme/app_theme.dart';
import 'presentation/screens/create_ticket_screen.dart';
import 'presentation/screens/manager_work_orders_screen.dart';
import 'presentation/screens/technician_work_order_detail_screen.dart';
import 'presentation/screens/ticket_detail_screen.dart';
import 'presentation/screens/ticket_list_screen.dart';
import 'presentation/screens/work_order_list_screen.dart';
import 'presentation/screens/work_tracking_home_screen.dart';

/// İş Takip Modülü kayıt sınıfı.
class WorkTrackingModule extends AppModule {
  @override
  String get key => 'work_tracking';

  @override
  String get title => 'İş Takip';

  @override
  String get subtitle => 'Arıza, iş emirleri, teknisyenler, fotoğraflar ve onaylar';

  @override
  IconData get icon => Icons.build_circle_outlined;

  @override
  Color get accentColor => AppColors.workTrackingAccent;

  @override
  String get entryRoute => '/work-tracking';

  @override
  int get sortOrder => 2;

  @override
  String? notificationRoute(String? entityType, String? entityId) {
    return entityId != null ? '/work-tracking/tickets/$entityId' : '/work-tracking';
  }

  @override
  List<ModuleNavItem> get navItems => const [
        ModuleNavItem(
          label: 'Özet',
          icon: Icons.dashboard_outlined,
          route: '/work-tracking',
        ),
        ModuleNavItem(
          label: 'Arızalar',
          icon: Icons.report_problem_outlined,
          route: '/work-tracking/tickets',
        ),
        ModuleNavItem(
          label: 'İş Emirleri',
          icon: Icons.assignment_outlined,
          route: '/work-tracking/work-orders',
        ),
      ];

  @override
  List<RouteBase> buildRoutes() => [
        GoRoute(
          path: entryRoute,
          builder: (context, state) => const HomeScreen(),
          routes: [
            GoRoute(
              path: 'tickets',
              builder: (context, state) => const TicketListScreen(),
              routes: [
                GoRoute(
                  path: 'new',
                  builder: (context, state) => const CreateTicketScreen(),
                ),
                GoRoute(
                  path: ':id',
                  builder: (context, state) => TicketDetailScreen(
                    ticketId: state.pathParameters['id']!,
                  ),
                ),
              ],
            ),
            GoRoute(
              path: 'work-orders',
              builder: (context, state) => const WorkOrderListScreen(),
              routes: [
                GoRoute(
                  path: ':id',
                  builder: (context, state) => TechnicianWorkOrderDetailScreen(
                    workOrderId: state.pathParameters['id']!,
                  ),
                ),
              ],
            ),
            GoRoute(
              path: 'manager-work-orders',
              builder: (context, state) => const ManagerWorkOrdersScreen(),
            ),
          ],
        ),
      ];
}

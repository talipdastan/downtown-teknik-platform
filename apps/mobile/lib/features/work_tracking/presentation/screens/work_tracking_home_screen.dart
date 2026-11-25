import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'package:avm_tech_platform/core/auth/auth_provider.dart';
import 'package:avm_tech_platform/core/notifications/notification_providers.dart';
import 'package:avm_tech_platform/core/theme/app_theme.dart';
import 'package:avm_tech_platform/core/widgets/modern_shell_widgets.dart';
import 'package:avm_tech_platform/features/work_tracking/work_tracking_access.dart';

/// İş Takip Ana Ekranı (Tasarım B – Tek Sayfaya Sığan Kompakt Yerleşim).
class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final profile = ref.watch(authProvider).profile;
    final unread =
        ref.watch(unreadCountProvider).maybeWhen(data: (n) => n, orElse: () => 0);

    final canCreateTicket = profile?.hasActionAccess('ticket_create') ?? false;
    final canViewTickets = profile?.hasMenuAccess('tickets') ?? false;
    final canManageWorkOrders = (profile?.hasMenuAccess('work_orders') ?? false) &&
        ((profile?.hasActionAccess('work_order_assign') ?? false) ||
            (profile?.hasActionAccess('work_order_review') ?? false));
    final canExecuteWorkOrders = (profile?.hasMenuAccess('work_orders') ?? false) &&
        (profile?.hasActionAccess('work_order_execute') ?? false);
    final canViewNotifications = profile?.hasMenuAccess('notifications') ?? true;

    return AppBackScope(
      child: Scaffold(
        appBar: const ModernUserTopBar(statusPill: 'İş Takip'),
        body: RefreshIndicator(
          onRefresh: () async {
            ref.invalidate(unreadCountProvider);
            await ref.read(authProvider.notifier).refreshProfile();
          },
          child: ListView(
            padding: const EdgeInsets.fromLTRB(10, 10, 10, 10),
            children: [
              const Padding(
                padding: EdgeInsets.only(left: 4, bottom: 6),
                child: Text(
                  'İŞ TAKİP İŞLEMLERİ',
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w800,
                    letterSpacing: 0.7,
                    color: AppColors.textSecondary,
                  ),
                ),
              ),
              if (canCreateTicket)
                _HomeTile(
                  icon: Icons.add_circle_rounded,
                  iconColor: Colors.white,
                  iconBg: AppColors.accentTurquoise,
                  title: 'Yeni Arıza Bildir',
                  subtitle: 'Kat, mahal, ekipman ve fotoğraf ile hızlı kayıt',
                  highlight: true,
                  onTap: () => context.push('/work-tracking/tickets/new'),
                ),
              if (canViewTickets)
                _HomeTile(
                  icon: Icons.report_problem_rounded,
                  iconColor: AppColors.priorityHigh,
                  iconBg: AppColors.electricSoft,
                  title: (profile?.isManagement ?? false)
                      ? 'Tüm Arıza Kayıtları'
                      : 'Arızalarım',
                  subtitle: 'Arıza durumlarını ve işlem geçmişini görüntüleyin',
                  onTap: () => context.push('/work-tracking/tickets'),
                ),
              if (canManageWorkOrders)
                _HomeTile(
                  icon: Icons.manage_accounts_rounded,
                  iconColor: AppColors.primaryNavy,
                  iconBg: AppColors.primarySoft,
                  title: 'İş Emirleri (Ata & Onayla)',
                  subtitle: 'Teknisyen atayın ve tamamlanan işleri onaylayın',
                  onTap: () => context.push('/work-tracking/manager-work-orders'),
                ),
              if (canExecuteWorkOrders)
                _HomeTile(
                  icon: Icons.assignment_turned_in_rounded,
                  iconColor: AppColors.accentTurquoise,
                  iconBg: AppColors.turquoiseSoft,
                  title: 'Bana Atanan İşler',
                  subtitle: 'İşe başlayın, malzeme girin ve tamamlayın',
                  onTap: () => context.push('/work-tracking/work-orders'),
                ),
              if (canViewNotifications)
                _HomeTile(
                  icon: Icons.notifications_active_rounded,
                  iconColor: AppColors.statusNew,
                  iconBg: AppColors.waterSoft,
                  title: 'Bildirimler',
                  subtitle: unread > 0
                      ? '$unread okunmamış bildirim'
                      : 'Yeni bildirim bulunmuyor',
                  onTap: () => context.push('/notifications'),
                ),
            ],
          ),
        ),
        bottomNavigationBar: FloatingPillBottomBar(
          activeKey: 'work_tracking',
          quickActionLabel: canCreateTicket ? 'ARIZA' : null,
          quickActionIcon: Icons.add_rounded,
          onQuickAction: canCreateTicket
              ? () => context.push('/work-tracking/tickets/new')
              : null,
        ),
      ),
    );
  }
}

class _HomeTile extends StatelessWidget {
  final IconData icon;
  final Color iconColor;
  final Color iconBg;
  final String title;
  final String subtitle;
  final VoidCallback onTap;
  final bool highlight;

  const _HomeTile({
    required this.icon,
    required this.iconColor,
    required this.iconBg,
    required this.title,
    required this.subtitle,
    required this.onTap,
    this.highlight = false,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Card(
        color: highlight ? AppColors.primaryNavy : AppColors.surface,
        child: InkWell(
          borderRadius: BorderRadius.circular(16),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 9),
            child: Row(
              children: [
                PastelIconBox(
                  icon: icon,
                  color: iconColor,
                  background: iconBg,
                  size: 36,
                  iconSize: 19,
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        title,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontWeight: FontWeight.w800,
                          fontSize: 14,
                          color: highlight ? Colors.white : AppColors.textPrimary,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        subtitle,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontSize: 11.5,
                          color: highlight
                              ? Colors.white70
                              : AppColors.textSecondary,
                        ),
                      ),
                    ],
                  ),
                ),
                Icon(
                  Icons.chevron_right_rounded,
                  color: highlight ? Colors.white70 : AppColors.textSecondary,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

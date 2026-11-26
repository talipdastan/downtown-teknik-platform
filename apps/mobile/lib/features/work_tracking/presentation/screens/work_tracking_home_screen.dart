import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'package:avm_tech_platform/core/auth/auth_provider.dart';
import 'package:avm_tech_platform/core/notifications/notification_providers.dart';
import 'package:avm_tech_platform/core/theme/app_theme.dart';
import 'package:avm_tech_platform/core/widgets/modern_shell_widgets.dart';
import 'package:avm_tech_platform/features/work_tracking/data/models/extra_models.dart';
import 'package:avm_tech_platform/features/work_tracking/data/models/ticket_model.dart';
import 'package:avm_tech_platform/features/work_tracking/providers/data_providers.dart';
import 'package:avm_tech_platform/features/work_tracking/work_tracking_access.dart';

/// İş Takip Ana Ekranı (Senyonet VAR tarzı Koyu Lacivert Hero KPI Kartı +
/// Haftalık Takvim Şeridi + 2x2 Bento Operasyon Izgarası + Hızlı Menü).
class HomeScreen extends ConsumerStatefulWidget {
  const HomeScreen({super.key});

  @override
  ConsumerState<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends ConsumerState<HomeScreen> {
  DateTime? _selectedDay;

  static const List<String> _weekdayLabels = [
    'Pzt',
    'Salı',
    'Çrş',
    'Prş',
    'Cuma',
    'Cmt',
    'Pzr',
  ];

  bool _isSameDay(DateTime a, DateTime b) =>
      a.year == b.year && a.month == b.month && a.day == b.day;

  List<DateTime> _currentWeekDays(DateTime anchor) {
    final normalized = DateTime(anchor.year, anchor.month, anchor.day);
    final monday =
        normalized.subtract(Duration(days: normalized.weekday - 1));
    return List.generate(7, (i) => monday.add(Duration(days: i)));
  }

  @override
  Widget build(BuildContext context) {
    final profile = ref.watch(authProvider).profile;
    final unread = ref
        .watch(unreadCountProvider)
        .maybeWhen(data: (n) => n, orElse: () => 0);

    final ticketsAsync = ref.watch(ticketsProvider);
    final myOrdersAsync = ref.watch(myWorkOrdersProvider);

    final allTickets = ticketsAsync.valueOrNull ?? const <TicketModel>[];
    final myOrders = myOrdersAsync.valueOrNull ?? const <WorkOrderView>[];

    final filteredTickets = _selectedDay == null
        ? allTickets
        : allTickets
            .where((t) => _isSameDay(t.createdAt.toLocal(), _selectedDay!))
            .toList();

    final newCount = filteredTickets
        .where((t) => t.status == 'new' || t.status == 'under_review')
        .length;
    final inProgressCount = filteredTickets
        .where((t) => t.status == 'assigned' || t.status == 'in_progress')
        .length;
    final waitingCount =
        filteredTickets.where((t) => t.status == 'waiting').length;
    final closedCount = filteredTickets
        .where((t) => t.status == 'resolved' || t.status == 'closed')
        .length;
    final totalCount = filteredTickets.length;

    final pendingReviewCount =
        allTickets.where((t) => t.status == 'resolved').length;
    final activeAssignedCount =
        myOrders.where((w) => w.order.status != 'completed').length;
    final completedOrdersCount =
        myOrders.where((w) => w.order.status == 'completed').length;
    final openTicketsCount = allTickets
        .where((t) => t.status != 'closed' && t.status != 'cancelled')
        .length;

    final canCreateTicket = profile?.hasActionAccess('ticket_create') ?? false;
    final canViewTickets = profile?.hasMenuAccess('tickets') ?? false;
    final canManageWorkOrders =
        (profile?.hasMenuAccess('work_orders') ?? false) &&
            ((profile?.hasActionAccess('work_order_assign') ?? false) ||
                (profile?.hasActionAccess('work_order_review') ?? false));
    final canExecuteWorkOrders =
        (profile?.hasMenuAccess('work_orders') ?? false) &&
            (profile?.hasActionAccess('work_order_execute') ?? false);
    final canViewNotifications =
        profile?.hasMenuAccess('notifications') ?? true;

    final now = DateTime.now();
    final weekDays = _currentWeekDays(now);

    return AppBackScope(
      child: Scaffold(
        appBar: const ModernUserTopBar(statusPill: 'İş Takip'),
        body: RefreshIndicator(
          onRefresh: () async {
            ref.invalidate(ticketsProvider);
            ref.invalidate(myWorkOrdersProvider);
            ref.invalidate(unreadCountProvider);
            await ref.read(authProvider.notifier).refreshProfile();
          },
          child: ListView(
            padding: const EdgeInsets.fromLTRB(10, 8, 10, 12),
            children: [
              // 1) KOYU LACİVERT HERO KPI KARTI ("Üzerimdeki Toplam İşler")
              Container(
                padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
                decoration: BoxDecoration(
                  gradient: const LinearGradient(
                    colors: [Color(0xFF0F2342), AppColors.primaryNavy],
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                  ),
                  borderRadius: BorderRadius.circular(18),
                  boxShadow: [
                    BoxShadow(
                      color: AppColors.primaryNavy.withValues(alpha: 0.22),
                      blurRadius: 14,
                      offset: const Offset(0, 6),
                    ),
                  ],
                ),
                child: Column(
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                (profile?.isManagement ?? false)
                                    ? 'Toplam Saha İşleri'
                                    : 'Üzerimdeki Toplam İşler',
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                  color: Colors.white,
                                  fontSize: 13.5,
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                              if (_selectedDay != null)
                                Padding(
                                  padding: const EdgeInsets.only(top: 2),
                                  child: InkWell(
                                    onTap: () =>
                                        setState(() => _selectedDay = null),
                                    child: Text(
                                      'Seçili gün filtresi aktif · Tümünü göster',
                                      style: TextStyle(
                                        color: Colors.cyanAccent.shade100,
                                        fontSize: 10.5,
                                        fontWeight: FontWeight.w600,
                                      ),
                                    ),
                                  ),
                                ),
                            ],
                          ),
                        ),
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 12,
                            vertical: 4,
                          ),
                          decoration: BoxDecoration(
                            color: Colors.white.withValues(alpha: 0.10),
                            borderRadius: BorderRadius.circular(14),
                          ),
                          child: Text(
                            '$totalCount',
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 24,
                              fontWeight: FontWeight.w900,
                              letterSpacing: -0.5,
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceAround,
                      children: [
                        _HeroCircleMetric(
                          count: newCount,
                          label: 'Yeni',
                          onTap: canViewTickets
                              ? () => context
                                  .push('/work-tracking/tickets?status=new')
                              : null,
                        ),
                        _HeroCircleMetric(
                          count: inProgressCount,
                          label: 'İş Devam Ediyor',
                          onTap: canViewTickets
                              ? () => context.push(
                                    '/work-tracking/tickets?status=in_progress',
                                  )
                              : null,
                        ),
                        _HeroCircleMetric(
                          count: waitingCount,
                          label: 'Beklemede',
                          onTap: canViewTickets
                              ? () => context.push(
                                    '/work-tracking/tickets?status=waiting',
                                  )
                              : null,
                        ),
                        _HeroCircleMetric(
                          count: closedCount,
                          label: 'Kapandı',
                          onTap: canViewTickets
                              ? () => context
                                  .push('/work-tracking/tickets?tab=closed')
                              : null,
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 8),

              // 2) HAFTALIK YATAY TAKVİM ŞERİDİ
              Row(
                children: [
                  for (var i = 0; i < weekDays.length; i++) ...[
                    if (i > 0) const SizedBox(width: 4),
                    Expanded(
                      child: _WeekDayPill(
                        dayNumber: weekDays[i].day,
                        label: _weekdayLabels[i],
                        isToday: _isSameDay(weekDays[i], now),
                        isSelected: _selectedDay != null &&
                            _isSameDay(weekDays[i], _selectedDay!),
                        onTap: () {
                          setState(() {
                            if (_selectedDay != null &&
                                _isSameDay(weekDays[i], _selectedDay!)) {
                              _selectedDay = null;
                            } else {
                              _selectedDay = weekDays[i];
                            }
                          });
                        },
                      ),
                    ),
                  ],
                ],
              ),
              const SizedBox(height: 8),

              // 3) 2x2 BENTO OPERASYON KUTULARI (Senyonet 3. Ekran Tarzı)
              Row(
                children: [
                  Expanded(
                    child: _BentoSummaryCard(
                      title: 'Hizmet / Talep',
                      count: openTicketsCount,
                      icon: Icons.receipt_long_rounded,
                      borderColor: const Color(0xFFF87171),
                      bgColor: const Color(0xFFFEF2F2),
                      accentColor: const Color(0xFFDC2626),
                      onTap: canViewTickets
                          ? () =>
                              context.push('/work-tracking/tickets?tab=active')
                          : null,
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: _BentoSummaryCard(
                      title: 'Atanan İşlerim',
                      count: activeAssignedCount,
                      icon: Icons.work_outline_rounded,
                      borderColor: const Color(0xFF60A5FA),
                      bgColor: const Color(0xFFEFF6FF),
                      accentColor: const Color(0xFF2563EB),
                      onTap: canExecuteWorkOrders
                          ? () => context.push('/work-tracking/work-orders')
                          : (canManageWorkOrders
                              ? () => context
                                  .push('/work-tracking/manager-work-orders')
                              : null),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Row(
                children: [
                  Expanded(
                    child: _BentoSummaryCard(
                      title: 'Onay Bekleyen',
                      count: pendingReviewCount,
                      icon: Icons.fact_check_outlined,
                      borderColor: const Color(0xFF2DD4BF),
                      bgColor: const Color(0xFFF0FDFA),
                      accentColor: const Color(0xFF0D9488),
                      onTap: canManageWorkOrders
                          ? () => context
                              .push('/work-tracking/manager-work-orders')
                          : (canViewTickets
                              ? () => context.push(
                                    '/work-tracking/tickets?status=resolved',
                                  )
                              : null),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: _BentoSummaryCard(
                      title: 'Tamamlanan',
                      count: closedCount > 0 ? closedCount : completedOrdersCount,
                      icon: Icons.task_alt_rounded,
                      borderColor: const Color(0xFFA3E635),
                      bgColor: const Color(0xFFF7FEE7),
                      accentColor: const Color(0xFF4D7C0F),
                      onTap: canViewTickets
                          ? () =>
                              context.push('/work-tracking/tickets?tab=closed')
                          : null,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 10),

              // 4) HIZLI İŞLEM LİSTESİ (Sayaç Rozetli)
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
                  subtitle: 'Aktif ve kapanan hizmet taleplerini görüntüleyin',
                  trailingCount: totalCount,
                  onTap: () => context.push('/work-tracking/tickets'),
                ),
              if (canManageWorkOrders)
                _HomeTile(
                  icon: Icons.manage_accounts_rounded,
                  iconColor: AppColors.primaryNavy,
                  iconBg: AppColors.primarySoft,
                  title: 'İş Emirleri (Ata & Onayla)',
                  subtitle: 'Teknisyen atayın ve tamamlanan işleri onaylayın',
                  trailingCount: newCount + pendingReviewCount,
                  onTap: () =>
                      context.push('/work-tracking/manager-work-orders'),
                ),
              if (canExecuteWorkOrders)
                _HomeTile(
                  icon: Icons.assignment_turned_in_rounded,
                  iconColor: AppColors.accentTurquoise,
                  iconBg: AppColors.turquoiseSoft,
                  title: 'Bana Atanan İşler',
                  subtitle: 'İşe başlayın, malzeme girin ve tamamlayın',
                  trailingCount: activeAssignedCount,
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
                  trailingCount: unread > 0 ? unread : null,
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

class _HeroCircleMetric extends StatelessWidget {
  final int count;
  final String label;
  final VoidCallback? onTap;

  const _HeroCircleMetric({
    required this.count,
    required this.label,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 2, horizontal: 2),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 38,
                height: 38,
                decoration: const BoxDecoration(
                  color: Colors.white,
                  shape: BoxShape.circle,
                ),
                alignment: Alignment.center,
                child: FittedBox(
                  fit: BoxFit.scaleDown,
                  child: Padding(
                    padding: const EdgeInsets.all(4),
                    child: Text(
                      '$count',
                      style: const TextStyle(
                        color: AppColors.primaryNavy,
                        fontSize: 13.5,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 5),
              Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  color: Colors.white70,
                  fontSize: 10.5,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _WeekDayPill extends StatelessWidget {
  final int dayNumber;
  final String label;
  final bool isToday;
  final bool isSelected;
  final VoidCallback onTap;

  const _WeekDayPill({
    required this.dayNumber,
    required this.label,
    required this.isToday,
    required this.isSelected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final active = isSelected || isToday;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 6, horizontal: 2),
        decoration: BoxDecoration(
          color: isSelected ? AppColors.primaryNavy : Colors.white,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: active ? AppColors.accentTurquoise : AppColors.border,
            width: active ? 1.5 : 1.0,
          ),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              '$dayNumber',
              style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w800,
                color: isSelected ? Colors.white : AppColors.textPrimary,
              ),
            ),
            const SizedBox(height: 1),
            Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontSize: 10,
                fontWeight: FontWeight.w600,
                color: isSelected ? Colors.white70 : AppColors.textSecondary,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _BentoSummaryCard extends StatelessWidget {
  final String title;
  final int count;
  final IconData icon;
  final Color borderColor;
  final Color bgColor;
  final Color accentColor;
  final VoidCallback? onTap;

  const _BentoSummaryCard({
    required this.title,
    required this.count,
    required this.icon,
    required this.borderColor,
    required this.bgColor,
    required this.accentColor,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(14),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        decoration: BoxDecoration(
          color: bgColor,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: borderColor, width: 1.2),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              title,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                fontSize: 12.5,
                fontWeight: FontWeight.w800,
                color: AppColors.textPrimary,
              ),
            ),
            const SizedBox(height: 8),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  '$count',
                  style: TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.w900,
                    color: accentColor,
                  ),
                ),
                Icon(icon, color: accentColor, size: 22),
              ],
            ),
          ],
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
  final int? trailingCount;

  const _HomeTile({
    required this.icon,
    required this.iconColor,
    required this.iconBg,
    required this.title,
    required this.subtitle,
    required this.onTap,
    this.highlight = false,
    this.trailingCount,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Card(
        color: highlight ? AppColors.primaryNavy : AppColors.surface,
        child: InkWell(
          borderRadius: BorderRadius.circular(14),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
            child: Row(
              children: [
                PastelIconBox(
                  icon: icon,
                  color: iconColor,
                  background: iconBg,
                  size: 36,
                  iconSize: 19,
                ),
                const SizedBox(width: 10),
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
                          fontSize: 13.5,
                          color:
                              highlight ? Colors.white : AppColors.textPrimary,
                        ),
                      ),
                      const SizedBox(height: 1.5),
                      Text(
                        subtitle,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontSize: 11,
                          color: highlight
                              ? Colors.white70
                              : AppColors.textSecondary,
                        ),
                      ),
                    ],
                  ),
                ),
                if (trailingCount != null) ...[
                  const SizedBox(width: 6),
                  Text(
                    '$trailingCount',
                    style: TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w900,
                      color:
                          highlight ? Colors.white : AppColors.primaryNavy,
                    ),
                  ),
                ],
                const SizedBox(width: 4),
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

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'package:avm_tech_platform/core/auth/auth_provider.dart';
import 'package:avm_tech_platform/core/config/supabase_config.dart';
import 'package:avm_tech_platform/core/notifications/notification_providers.dart';
import 'package:avm_tech_platform/core/theme/app_theme.dart';
import 'package:avm_tech_platform/core/widgets/modern_shell_widgets.dart';
import 'package:avm_tech_platform/features/work_tracking/data/models/extra_models.dart';
import 'package:avm_tech_platform/features/work_tracking/data/models/ticket_model.dart';
import 'package:avm_tech_platform/features/work_tracking/providers/data_providers.dart';
import 'package:avm_tech_platform/features/work_tracking/work_tracking_access.dart';

/// İş Takip Ana Ekranı:
/// 1) Koyu Lacivert Hero Kartı: Yalnızca kullanıcının KENDİ üzerindeki iş yükünü
///    (Teknisyen/Yönetici için Bana Atanan İş Emirleri, Personel için Açtığım Talepler) gösterir.
/// 2) Haftalık Yatay Takvim Şeridi.
/// 3) 2x2 Bento Operasyon Izgarası: Tekrarsız 4 ayrı süreç adımı:
///    - Atama Bekleyen Arıza (henüz iş emri atanmamış new/under_review)
///    - Sahada İş Emirleri (atanmış / işlemde / beklemede iş emirleri)
///    - Çözüm Onay Bekleyen (teknisyenin tamamladığı resolved kayıtlar)
///    - Kapanan İşler (onaylanıp kapatılmış kayıtlar)
/// 4) Supabase Realtime aboneliği ile ekranı kapatıp açmadan anlık otomatik yenileme.
class HomeScreen extends ConsumerStatefulWidget {
  const HomeScreen({super.key});

  @override
  ConsumerState<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends ConsumerState<HomeScreen> {
  DateTime? _selectedDay;
  RealtimeChannel? _realtimeChannel;

  static const List<String> _weekdayLabels = [
    'Pzt',
    'Salı',
    'Çrş',
    'Prş',
    'Cuma',
    'Cmt',
    'Pzr',
  ];

  @override
  void initState() {
    super.initState();
    _setupRealtime();
  }

  void _setupRealtime() {
    final client = SupabaseConfig.clientOrNull;
    if (client == null) return;
    try {
      _realtimeChannel = client
          .channel('mobile-wt-live')
          .onPostgresChanges(
            event: PostgresChangeEvent.all,
            schema: 'public',
            table: 'tickets',
            callback: (_) {
              if (mounted) invalidateAllWorkTrackingProviders(ref);
            },
          )
          .onPostgresChanges(
            event: PostgresChangeEvent.all,
            schema: 'public',
            table: 'work_orders',
            callback: (_) {
              if (mounted) invalidateAllWorkTrackingProviders(ref);
            },
          )
          .onPostgresChanges(
            event: PostgresChangeEvent.all,
            schema: 'public',
            table: 'work_order_assignments',
            callback: (_) {
              if (mounted) invalidateAllWorkTrackingProviders(ref);
            },
          )
          .subscribe();
    } catch (_) {
      // Test veya çevrimdışı ortamda sessiz geç
    }
  }

  @override
  void dispose() {
    final ch = _realtimeChannel;
    if (ch != null) {
      try {
        SupabaseConfig.clientOrNull?.removeChannel(ch);
      } catch (_) {}
    }
    super.dispose();
  }

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
    final uid = profile?.id;
    final unread = ref
        .watch(unreadCountProvider)
        .maybeWhen(data: (n) => n, orElse: () => 0);

    final ticketsAsync = ref.watch(ticketsProvider);
    final myOrdersAsync = ref.watch(myWorkOrdersProvider);
    final activeManagerOrdersAsync = ref.watch(activeManagerWorkOrdersProvider);

    final allTickets = ticketsAsync.valueOrNull ?? const <TicketModel>[];
    final myOrders = myOrdersAsync.valueOrNull ?? const <WorkOrderView>[];
    final activeManagerOrders =
        activeManagerOrdersAsync.valueOrNull ?? const <WorkOrderView>[];

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

    final dayFilteredTickets = _selectedDay == null
        ? allTickets
        : allTickets
            .where((t) => _isSameDay(t.createdAt.toLocal(), _selectedDay!))
            .toList();

    final dayFilteredMyOrders = _selectedDay == null
        ? myOrders
        : myOrders
            .where(
                (w) => _isSameDay(w.order.createdAt.toLocal(), _selectedDay!))
            .toList();

    // 1) ÜST KOYU KART ("Üzerimdeki Toplam İşler"):
    // Teknisyen / Ekip Sorumlusu ise doğrudan KENDİSİNE ATANAN iş emirlerinin kırılımı;
    // AVM Personeli veya Yönetici ise kendi açtığı / takip ettiği kayıtların kırılımı.
    final bool usePersonalOrdersForHero =
        canExecuteWorkOrders && myOrders.isNotEmpty;

    final int heroNewCount;
    final int heroInProgressCount;
    final int heroWaitingCount;
    final int heroCompletedCount;
    final int heroTotalCount;

    if (usePersonalOrdersForHero) {
      heroNewCount = dayFilteredMyOrders
          .where((w) => w.order.status == 'assigned')
          .length;
      heroInProgressCount = dayFilteredMyOrders
          .where((w) => w.order.status == 'in_progress')
          .length;
      heroWaitingCount = dayFilteredMyOrders
          .where((w) => w.order.status == 'waiting')
          .length;
      heroCompletedCount = dayFilteredMyOrders
          .where((w) => w.order.status == 'completed')
          .length;
      heroTotalCount = dayFilteredMyOrders.length;
    } else {
      final personalTickets = (profile?.isManagement ?? false)
          ? dayFilteredTickets
          : dayFilteredTickets.where((t) => t.reporterId == uid).toList();
      heroNewCount = personalTickets
          .where((t) => t.status == 'new' || t.status == 'under_review')
          .length;
      heroInProgressCount = personalTickets
          .where((t) => t.status == 'assigned' || t.status == 'in_progress')
          .length;
      heroWaitingCount =
          personalTickets.where((t) => t.status == 'waiting').length;
      heroCompletedCount = personalTickets
          .where((t) => t.status == 'resolved' || t.status == 'closed')
          .length;
      heroTotalCount = personalTickets.length;
    }

    // 2) 2x2 BENTO OPERASYON KUTULARI (Tekrarsız 4 Ayrı Süreç Aşaması):
    // Kutu 1: Atama Bekleyen Arıza (Henüz iş emrine dönüşmemiş: new / under_review)
    final unassignedTicketsCount = dayFilteredTickets
        .where((t) => t.status == 'new' || t.status == 'under_review')
        .length;

    // Kutu 2: Sahada Aktif İş Emirleri (İş emri atanmış, işlemde veya beklemede)
    final fieldActiveWorkOrdersCount = (profile?.isManagement ?? false)
        ? (activeManagerOrders.isNotEmpty
            ? activeManagerOrders.length
            : dayFilteredTickets
                .where((t) =>
                    t.status == 'assigned' ||
                    t.status == 'in_progress' ||
                    t.status == 'waiting')
                .length)
        : dayFilteredMyOrders
            .where((w) => w.order.status != 'completed')
            .length;

    // Kutu 3: Çözüm Onay Bekleyen (Teknisyen bitirmiş, yönetici/bildiren onayı bekliyor)
    final pendingApprovalCount =
        dayFilteredTickets.where((t) => t.status == 'resolved').length;

    // Kutu 4: Tamamlanan / Kapanan (Kalıcı olarak kapatılmış)
    final closedTicketsCount =
        dayFilteredTickets.where((t) => t.status == 'closed').length;

    final now = DateTime.now();
    final weekDays = _currentWeekDays(now);

    return AppBackScope(
      child: Scaffold(
        appBar: const ModernUserTopBar(statusPill: 'İş Takip'),
        body: RefreshIndicator(
          onRefresh: () async {
            invalidateAllWorkTrackingProviders(ref);
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
                                usePersonalOrdersForHero
                                    ? 'Üzerimdeki Toplam İşler'
                                    : ((profile?.isManagement ?? false)
                                        ? 'Toplam Saha İşleri Özeti'
                                        : 'Açtığım Toplam Talepler'),
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
                            '$heroTotalCount',
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
                          count: heroNewCount,
                          label: usePersonalOrdersForHero ? 'Yeni Atanan' : 'Atama Bekleyen',
                          onTap: usePersonalOrdersForHero
                              ? () => context.push('/work-tracking/work-orders')
                              : (canViewTickets
                                  ? () => context
                                      .push('/work-tracking/tickets?tab=unassigned')
                                  : null),
                        ),
                        _HeroCircleMetric(
                          count: heroInProgressCount,
                          label: 'İş Devam Ediyor',
                          onTap: usePersonalOrdersForHero
                              ? () => context.push('/work-tracking/work-orders')
                              : (canViewTickets
                                  ? () => context
                                      .push('/work-tracking/tickets?tab=in_field')
                                  : null),
                        ),
                        _HeroCircleMetric(
                          count: heroWaitingCount,
                          label: 'Beklemede',
                          onTap: usePersonalOrdersForHero
                              ? () => context.push('/work-tracking/work-orders')
                              : (canViewTickets
                                  ? () => context.push(
                                        '/work-tracking/tickets?status=waiting',
                                      )
                                  : null),
                        ),
                        _HeroCircleMetric(
                          count: heroCompletedCount,
                          label: 'Kapandı',
                          onTap: usePersonalOrdersForHero
                              ? () => context.push('/work-tracking/work-orders')
                              : (canViewTickets
                                  ? () => context
                                      .push('/work-tracking/tickets?tab=closed')
                                  : null),
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

              // 3) 2x2 BENTO OPERASYON KUTULARI (Tekrarsız 4 Farklı Süreç Aşaması)
              Row(
                children: [
                  Expanded(
                    child: _BentoSummaryCard(
                      title: 'Atama Bekleyen Arıza',
                      count: unassignedTicketsCount,
                      icon: Icons.notification_important_outlined,
                      borderColor: const Color(0xFFF87171),
                      bgColor: const Color(0xFFFEF2F2),
                      accentColor: const Color(0xFFDC2626),
                      onTap: canManageWorkOrders
                          ? () => context
                              .push('/work-tracking/manager-work-orders')
                          : (canViewTickets
                              ? () => context.push(
                                    '/work-tracking/tickets?tab=unassigned',
                                  )
                              : null),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: _BentoSummaryCard(
                      title: 'Sahada İş Emirleri',
                      count: fieldActiveWorkOrdersCount,
                      icon: Icons.engineering_outlined,
                      borderColor: const Color(0xFF60A5FA),
                      bgColor: const Color(0xFFEFF6FF),
                      accentColor: const Color(0xFF2563EB),
                      onTap: canExecuteWorkOrders
                          ? () => context.push('/work-tracking/work-orders')
                          : (canManageWorkOrders
                              ? () => context
                                  .push('/work-tracking/manager-work-orders')
                              : (canViewTickets
                                  ? () => context.push(
                                        '/work-tracking/tickets?tab=in_field',
                                      )
                                  : null)),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Row(
                children: [
                  Expanded(
                    child: _BentoSummaryCard(
                      title: 'Çözüm Onay Bekleyen',
                      count: pendingApprovalCount,
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
                      title: 'Kapanan İşler',
                      count: closedTicketsCount,
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

              // 4) HIZLI İŞLEM MENÜSÜ
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
                      ? 'Arıza Kayıtları (Atama Bekleyen)'
                      : 'Arızalarım',
                  subtitle: 'Atama bekleyen, sahada olan ve kapanan kayıtlar',
                  trailingCount: unassignedTicketsCount,
                  onTap: () => context.push('/work-tracking/tickets'),
                ),
              if (canManageWorkOrders)
                _HomeTile(
                  icon: Icons.manage_accounts_rounded,
                  iconColor: AppColors.primaryNavy,
                  iconBg: AppColors.primarySoft,
                  title: 'İş Emirleri Yönetimi (Ata & Onayla)',
                  subtitle: 'Yeni arızaları teknisyene atayın ve çözümleri onaylayın',
                  trailingCount: unassignedTicketsCount + pendingApprovalCount,
                  onTap: () =>
                      context.push('/work-tracking/manager-work-orders'),
                ),
              if (canExecuteWorkOrders)
                _HomeTile(
                  icon: Icons.assignment_turned_in_rounded,
                  iconColor: AppColors.accentTurquoise,
                  iconBg: AppColors.turquoiseSoft,
                  title: 'Bana Atanan İş Emirleri',
                  subtitle: 'İşe başlayın, malzeme girin ve fotoğrafla tamamlayın',
                  trailingCount: dayFilteredMyOrders
                      .where((w) => w.order.status != 'completed')
                      .length,
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
                fontSize: 12,
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

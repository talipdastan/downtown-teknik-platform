import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'package:avm_tech_platform/core/auth/auth_provider.dart';
import 'package:avm_tech_platform/core/config/supabase_config.dart';
import 'package:avm_tech_platform/core/database/offline_sync_service.dart';
import 'package:avm_tech_platform/core/notifications/notification_providers.dart';
import 'package:avm_tech_platform/core/theme/app_theme.dart';
import 'package:avm_tech_platform/core/widgets/modern_shell_widgets.dart';
import 'package:avm_tech_platform/features/work_tracking/data/models/extra_models.dart';
import 'package:avm_tech_platform/features/work_tracking/data/models/ticket_model.dart';
import 'package:avm_tech_platform/features/work_tracking/providers/data_providers.dart';
import 'package:avm_tech_platform/features/work_tracking/work_tracking_access.dart';

/// İş Takip Ana Ekranı (Tek Gerçek Kaynaklı, Tekrarsız ve Tutarlı Durum Mimarisi):
/// - Koyu Lacivert Hero Kartı: 4 net aşama (Atama Bekleyen | Sahada / İşlemde | Onay Bekleyen | Kapandı)
///   * Onay Bekleyen (`resolved`) kesinlikle "Kapandı" içinde sayılmaz!
///   * Kapandı (`closed`) yalnızca onaylanıp kapanmış kayıtları sayar.
/// - Haftalık Yatay Takvim Şeridi.
/// - Tekrarlayan 2x2 kutular kaldırıldı; alt menü kartları gerçek toplam sayıları gösterir.
class HomeScreen extends ConsumerStatefulWidget {
  const HomeScreen({super.key});

  @override
  ConsumerState<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends ConsumerState<HomeScreen> {
  DateTime? _selectedDay;
  RealtimeChannel? _realtimeChannel;
  Timer? _realtimeDebounce;

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
    OfflineSyncService.instance.startAutoSync(
      onSynced: () {
        if (mounted) {
          invalidateAllWorkTrackingProviders(ref);
          ref.invalidate(offlinePendingCountProvider);
        }
      },
    );
  }

  void _scheduleRealtimeRefresh() {
    _realtimeDebounce?.cancel();
    _realtimeDebounce = Timer(const Duration(milliseconds: 500), () {
      if (mounted) invalidateAllWorkTrackingProviders(ref);
    });
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
            callback: (_) => _scheduleRealtimeRefresh(),
          )
          .onPostgresChanges(
            event: PostgresChangeEvent.all,
            schema: 'public',
            table: 'work_orders',
            callback: (_) => _scheduleRealtimeRefresh(),
          )
          .onPostgresChanges(
            event: PostgresChangeEvent.all,
            schema: 'public',
            table: 'work_order_assignments',
            callback: (_) => _scheduleRealtimeRefresh(),
          )
          .subscribe();
    } catch (_) {
      // Test veya çevrimdışı ortamda sessiz geç
    }
  }

  @override
  void dispose() {
    _realtimeDebounce?.cancel();
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
    final unread = ref
        .watch(unreadCountProvider)
        .maybeWhen(data: (n) => n, orElse: () => 0);

    final ticketsAsync = ref.watch(ticketsProvider);
    final myOrdersAsync = ref.watch(myWorkOrdersProvider);

    final allTickets = ticketsAsync.valueOrNull ?? const <TicketModel>[];
    final myOrders = myOrdersAsync.valueOrNull ?? const <WorkOrderView>[];

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

    // Seçili güne göre filtrelenmiş arıza/talep listesi (RLS gereği personel kendi açtığını, yönetici tümünü görür)
    final scopedTickets = _selectedDay == null
        ? allTickets
        : allTickets
            .where((t) => _isSameDay(t.createdAt.toLocal(), _selectedDay!))
            .toList();

    // 4 Net ve Birbiriyle Çakışmayan Süreç Aşaması:
    // 1. Atama Bekleyen: Henüz iş emrine dönüşmemiş (new, under_review)
    final unassignedCount = scopedTickets
        .where((t) => t.status == 'new' || t.status == 'under_review')
        .length;

    // 2. Sahada / İşlemde: Teknisyene atanmış, üzerinde çalışılan veya parça bekleyen (assigned, in_progress, waiting)
    final inFieldCount = scopedTickets
        .where((t) =>
            t.status == 'assigned' ||
            t.status == 'in_progress' ||
            t.status == 'waiting')
        .length;

    // 3. Onay Bekleyen: Teknisyen işi bitirmiş, bildirenin veya yöneticinin onayını bekliyor (resolved)
    final awaitingApprovalCount =
        scopedTickets.where((t) => t.status == 'resolved').length;

    // 4. Kapandı: Onaylanıp tamamen kapatılmış kayıtlar (closed)
    final closedCount =
        scopedTickets.where((t) => t.status == 'closed').length;

    // Toplam (4 aşamanın birebir toplamı)
    final totalCount =
        unassignedCount + inFieldCount + awaitingApprovalCount + closedCount;

    // Aktif açık kayıt sayısı (Atama Bekleyen + Sahada + Onay Bekleyen)
    final activeTicketsCount =
        unassignedCount + inFieldCount + awaitingApprovalCount;

    // Teknisyenin kendisine atanmış aktif iş emri sayısı
    final myActiveWorkOrdersCount =
        myOrders.where((w) => w.order.status != 'completed').length;

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
              ValueListenableBuilder<int>(
                valueListenable: OfflineSyncService.instance.pendingCountNotifier,
                builder: (context, pendingCount, _) {
                  if (pendingCount <= 0) return const SizedBox.shrink();
                  return Container(
                    margin: const EdgeInsets.only(bottom: 8),
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                    decoration: BoxDecoration(
                      color: const Color(0xFFFFFBEB),
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: const Color(0xFFFDE68A)),
                    ),
                    child: Row(
                      children: [
                        const Icon(
                          Icons.cloud_upload_outlined,
                          size: 18,
                          color: Color(0xFFB45309),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            'Çevrimdışı kuyrukta $pendingCount bekleyen kayıt var.',
                            style: const TextStyle(
                              fontSize: 12,
                              fontWeight: FontWeight.w700,
                              color: Color(0xFF92400E),
                            ),
                          ),
                        ),
                        TextButton(
                          style: TextButton.styleFrom(
                            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                            minimumSize: Size.zero,
                            tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                          ),
                          onPressed: () async {
                            final summary = await OfflineSyncService.instance.syncNow();
                            if (mounted && summary != null && summary.syncedCount > 0) {
                              invalidateAllWorkTrackingProviders(ref);
                              ref.invalidate(offlinePendingCountProvider);
                            }
                          },
                          child: const Text(
                            'Gönder',
                            style: TextStyle(
                              fontSize: 12,
                              fontWeight: FontWeight.w800,
                              color: Color(0xFFB45309),
                            ),
                          ),
                        ),
                      ],
                    ),
                  );
                },
              ),
              // 1) KOYU LACİVERT HERO KPI KARTI (4 Tutarlı Aşama: Atama Bekleyen | Sahada | Onay Bekleyen | Kapandı)
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
                                    ? 'Toplam Saha İşleri & Talepler'
                                    : 'Açtığım Toplam Talepler',
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
                          count: unassignedCount,
                          label: 'Atama Bekleyen',
                          countColor: AppColors.statusNew,
                          onTap: canViewTickets
                              ? () => context.push(
                                    '/work-tracking/tickets?tab=active&status=new',
                                  )
                              : null,
                        ),
                        _HeroCircleMetric(
                          count: inFieldCount,
                          label: 'Sahada / İşlemde',
                          countColor: AppColors.priorityHigh,
                          onTap: canViewTickets
                              ? () => context.push(
                                    '/work-tracking/tickets?tab=active',
                                  )
                              : null,
                        ),
                        _HeroCircleMetric(
                          count: awaitingApprovalCount,
                          label: 'Onay Bekleyen',
                          countColor: AppColors.statusResolved,
                          onTap: canViewTickets
                              ? () => context.push(
                                    '/work-tracking/tickets?tab=active&status=resolved',
                                  )
                              : null,
                        ),
                        _HeroCircleMetric(
                          count: closedCount,
                          label: 'Kapandı',
                          countColor: AppColors.primaryNavy,
                          onTap: canViewTickets
                              ? () => context.push(
                                    '/work-tracking/tickets?tab=closed',
                                  )
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
              const SizedBox(height: 10),

              // 3) ONAY BEKLEYEN İŞ UYARI KARTI (Varsa kullanıcıyı doğrudan onaya yönlendirir)
              if (awaitingApprovalCount > 0 && canViewTickets)
                Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: InkWell(
                    borderRadius: BorderRadius.circular(14),
                    onTap: () => context.push(
                      '/work-tracking/tickets?tab=active&status=resolved',
                    ),
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 12,
                        vertical: 10,
                      ),
                      decoration: BoxDecoration(
                        color: const Color(0xFFF0FDF4),
                        borderRadius: BorderRadius.circular(14),
                        border: Border.all(
                          color: const Color(0xFF4ADE80),
                          width: 1.2,
                        ),
                      ),
                      child: Row(
                        children: [
                          const Icon(
                            Icons.fact_check_rounded,
                            color: AppColors.statusResolved,
                            size: 22,
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Text(
                              'Çözüm onayınızı bekleyen $awaitingApprovalCount adet tamamlanmış iş isteği var. İnceleyip kapatmak için dokunun.',
                              style: const TextStyle(
                                fontSize: 12,
                                fontWeight: FontWeight.w700,
                                color: AppColors.textPrimary,
                              ),
                            ),
                          ),
                          const Icon(
                            Icons.chevron_right_rounded,
                            color: AppColors.statusResolved,
                          ),
                        ],
                      ),
                    ),
                  ),
                ),

              // 4) İŞLEM MENÜSÜ (Tutarlı Gerçek Sayaçlarla)
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
                  subtitle: activeTicketsCount > 0
                      ? '$activeTicketsCount aktif ($inFieldCount sahada, $awaitingApprovalCount onayda) · $closedCount kapanan'
                      : 'Toplam $totalCount kayıt ($closedCount kapanan)',
                  trailingCount: totalCount,
                  onTap: () => context.push(
                    activeTicketsCount > 0
                        ? '/work-tracking/tickets?tab=active'
                        : '/work-tracking/tickets?tab=closed',
                  ),
                ),
              if (canManageWorkOrders)
                _HomeTile(
                  icon: Icons.manage_accounts_rounded,
                  iconColor: AppColors.primaryNavy,
                  iconBg: AppColors.primarySoft,
                  title: 'İş Emirleri Yönetimi (Ata & Onayla)',
                  subtitle:
                      '$unassignedCount atama bekleyen · $inFieldCount sahada · $awaitingApprovalCount onay bekleyen',
                  trailingCount: unassignedCount + awaitingApprovalCount,
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
                  trailingCount: myActiveWorkOrdersCount,
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
  final Color countColor;
  final VoidCallback? onTap;

  const _HeroCircleMetric({
    required this.count,
    required this.label,
    this.countColor = AppColors.primaryNavy,
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
                      style: TextStyle(
                        color: countColor,
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
                  fontSize: 10,
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

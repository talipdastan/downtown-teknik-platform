import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import 'package:avm_tech_platform/core/auth/auth_provider.dart';
import 'package:avm_tech_platform/core/network/api_client.dart';
import 'package:avm_tech_platform/core/notifications/notification_service.dart';
import 'package:avm_tech_platform/core/permissions/permission_models.dart';
import 'package:avm_tech_platform/core/theme/app_theme.dart';
import 'package:avm_tech_platform/core/utils/error_utils.dart';
import 'package:avm_tech_platform/core/widgets/common_widgets.dart';
import 'package:avm_tech_platform/core/widgets/modern_shell_widgets.dart';
import 'package:avm_tech_platform/features/energy/data/models/meter_model.dart';
import 'package:avm_tech_platform/features/energy/providers/energy_providers.dart';

/// Tasarım B – Tek Sayfaya Sığan Kompakt Enerji Takip Ana Ekranı.
class EnergyHomeScreen extends ConsumerStatefulWidget {
  const EnergyHomeScreen({super.key});

  @override
  ConsumerState<EnergyHomeScreen> createState() => _EnergyHomeScreenState();
}

class _EnergyHomeScreenState extends ConsumerState<EnergyHomeScreen> {
  bool _alertChecked = false;
  bool _settingUpDefaults = false;

  void _showPenaltyDialog(List<String> indPenalties, List<String> capPenalties) {
    showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Row(
          children: [
            Icon(Icons.warning_amber_rounded, color: AppColors.priorityUrgent),
            SizedBox(width: 8),
            Expanded(child: Text('Reaktif Güç Ceza Uyarısı')),
          ],
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (indPenalties.isNotEmpty) ...[
              const Text(
                'İndüktif (>%20):',
                style: TextStyle(fontWeight: FontWeight.w700),
              ),
              Text(indPenalties.join(', ')),
              const SizedBox(height: 8),
            ],
            if (capPenalties.isNotEmpty) ...[
              const Text(
                'Kapasitif (>%15):',
                style: TextStyle(fontWeight: FontWeight.w700),
              ),
              Text(capPenalties.join(', ')),
            ],
          ],
        ),
        actions: [
          FilledButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Tamam'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final now = DateTime.now();
    final period = (year: now.year, month: now.month);
    final profile = ref.watch(authProvider).profile;
    final dashboardAsync = ref.watch(energyDashboardProvider(period));

    final canCreate =
        profile?.hasModulePermission('energy', ModulePermission.create) ?? false;
    final canManage =
        profile?.hasModulePermission('energy', ModulePermission.manage) ?? false;
    final canReports =
        profile?.hasModulePermission('energy', ModulePermission.reports) ?? false;

    final items = dashboardAsync.valueOrNull ?? const <EnergyDashboardItem>[];
    double totalElec = 0;
    double totalWater = 0;
    double totalCooling = 0;
    double totalGas = 0;
    int elecCount = 0;
    int mechCount = 0;
    DateTime? latestReading;
    final indPenalties = <String>[];
    final capPenalties = <String>[];

    for (final item in items) {
      if (item.meterType == 'electric') {
        elecCount++;
      } else {
        mechCount++;
      }
      if (item.latestReadingDate != null &&
          (latestReading == null ||
              item.latestReadingDate!.isAfter(latestReading))) {
        latestReading = item.latestReadingDate;
      }
      switch (item.category) {
        case 'electric':
          totalElec += item.monthlyTotalConsumption;
          if (item.hasInductivePenalty) indPenalties.add(item.meterName);
          if (item.hasCapacitivePenalty) capPenalties.add(item.meterName);
          break;
        case 'water':
          totalWater += item.monthlyTotalConsumption;
          break;
        case 'cooling':
          totalCooling += item.monthlyTotalConsumption;
          break;
        case 'gas':
          totalGas += item.monthlyTotalConsumption;
          break;
      }
    }

    if (!_alertChecked &&
        dashboardAsync.hasValue &&
        (indPenalties.isNotEmpty || capPenalties.isNotEmpty)) {
      _alertChecked = true;
      final parts = <String>[
        if (indPenalties.isNotEmpty)
          'İndüktif (>%20): ${indPenalties.join(', ')}',
        if (capPenalties.isNotEmpty)
          'Kapasitif (>%15): ${capPenalties.join(', ')}',
      ];
      NotificationService.instance.showLocalNotification(
        idKey: 'energy_penalty_${now.year}_${now.month}',
        title: 'Reaktif Güç Ceza Uyarısı',
        body: parts.join('\n'),
      );
    }

    final numFmt = NumberFormat('#,##0.##', 'tr_TR');
    final periodTitle = DateFormat('MMMM yyyy', 'tr_TR').format(now);
    final totalPenaltyCount = indPenalties.length + capPenalties.length;

    return AppBackScope(
      child: Scaffold(
        appBar: ModernUserTopBar(
          statusPill: '${items.length} Sayaç',
        ),
        body: RefreshIndicator(
          onRefresh: () async {
            _alertChecked = false;
            ref.invalidate(energyDashboardProvider(period));
          },
          child: ListView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.fromLTRB(10, 8, 10, 8),
            children: [
              // Üst Özet Satırı
              Row(
                children: [
                  Expanded(
                    child: Text(
                      'ENERJİ ÖZETİ · ${periodTitle.toUpperCase()}',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 10.5,
                        fontWeight: FontWeight.w800,
                        letterSpacing: 0.5,
                        color: AppColors.textSecondary,
                      ),
                    ),
                  ),
                  InkWell(
                    onTap: () {
                      _alertChecked = false;
                      ref.invalidate(energyDashboardProvider(period));
                    },
                    borderRadius: BorderRadius.circular(8),
                    child: const Padding(
                      padding: EdgeInsets.all(3),
                      child: Icon(
                        Icons.refresh_rounded,
                        size: 17,
                        color: AppColors.primaryNavy,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 5),

              // 2x2 Kompakt KPI Kartları
              if (dashboardAsync.isLoading)
                const Padding(
                  padding: EdgeInsets.symmetric(vertical: 28),
                  child: Center(child: CircularProgressIndicator()),
                )
              else if (dashboardAsync.hasError)
                ErrorRetry(
                  message: friendlyError(dashboardAsync.error!),
                  onRetry: () =>
                      ref.invalidate(energyDashboardProvider(period)),
                )
              else if (items.isEmpty && canManage)
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(14),
                    child: Column(
                      children: [
                        const Text(
                          'Henüz tanımlı sayaç yok.',
                          style: TextStyle(fontWeight: FontWeight.w700),
                        ),
                        const SizedBox(height: 8),
                        FilledButton.icon(
                          onPressed: _settingUpDefaults
                              ? null
                              : () async {
                                  setState(() => _settingUpDefaults = true);
                                  try {
                                    await Api.client.rpc(
                                        'rpc_setup_default_meters');
                                    ref.invalidate(
                                        energyDashboardProvider(period));
                                    if (context.mounted) {
                                      showAppSnack(
                                        context,
                                        'Varsayılan AVM sayaçları kuruldu.',
                                      );
                                    }
                                  } catch (e) {
                                    if (context.mounted) {
                                      showAppSnack(
                                        context,
                                        friendlyError(e),
                                        error: true,
                                      );
                                    }
                                  } finally {
                                    if (mounted) {
                                      setState(() =>
                                          _settingUpDefaults = false);
                                    }
                                  }
                                },
                          icon: const Icon(Icons.auto_fix_high_outlined),
                          label: Text(_settingUpDefaults
                              ? 'Kuruluyor...'
                              : 'Varsayılan Sayaçları Kur'),
                        ),
                      ],
                    ),
                  ),
                )
              else
                Column(
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: _CompactKpiCard(
                            label: 'ELEKTRİK',
                            value: numFmt.format(totalElec),
                            unit: 'kWh',
                            icon: Icons.bolt_rounded,
                            color: AppColors.priorityHigh,
                            bg: AppColors.electricSoft,
                          ),
                        ),
                        const SizedBox(width: 6),
                        Expanded(
                          child: _CompactKpiCard(
                            label: 'ŞEBEKE SUYU',
                            value: numFmt.format(totalWater),
                            unit: 'm³',
                            icon: Icons.water_drop_rounded,
                            color: AppColors.statusNew,
                            bg: AppColors.waterSoft,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 6),
                    Row(
                      children: [
                        Expanded(
                          child: _CompactKpiCard(
                            label: 'SOĞUTMA',
                            value: numFmt.format(totalCooling),
                            unit: 'm³',
                            icon: Icons.ac_unit_rounded,
                            color: AppColors.accentTurquoise,
                            bg: AppColors.coolingSoft,
                          ),
                        ),
                        const SizedBox(width: 6),
                        Expanded(
                          child: _CompactKpiCard(
                            label: 'DOĞALGAZ',
                            value: numFmt.format(totalGas),
                            unit: 'm³',
                            icon: Icons.local_fire_department_rounded,
                            color: AppColors.priorityUrgent,
                            bg: AppColors.gasSoft,
                          ),
                        ),
                      ],
                    ),
                  ],
                ),

              // Kompakt Tek Satır Reaktif Uyarı Şeridi
              if (totalPenaltyCount > 0) ...[
                const SizedBox(height: 6),
                InkWell(
                  onTap: () =>
                      _showPenaltyDialog(indPenalties, capPenalties),
                  borderRadius: BorderRadius.circular(12),
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 10,
                      vertical: 7,
                    ),
                    decoration: BoxDecoration(
                      color: AppColors.gasSoft,
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(
                        color: AppColors.priorityUrgent
                            .withValues(alpha: 0.35),
                      ),
                    ),
                    child: Row(
                      children: [
                        const Icon(
                          Icons.warning_amber_rounded,
                          size: 16,
                          color: AppColors.priorityUrgent,
                        ),
                        const SizedBox(width: 6),
                        Expanded(
                          child: Text(
                            'Reaktif Ceza Uyarısı ($totalPenaltyCount sayaç) · Detay için dokunun',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              fontSize: 11,
                              fontWeight: FontWeight.w700,
                              color: AppColors.priorityUrgent,
                            ),
                          ),
                        ),
                        const Icon(
                          Icons.chevron_right_rounded,
                          size: 17,
                          color: AppColors.priorityUrgent,
                        ),
                      ],
                    ),
                  ),
                ),
              ],

              const SizedBox(height: 8),
              const Padding(
                padding: EdgeInsets.only(left: 2, bottom: 4),
                child: Text(
                  'BÖLÜMLER',
                  style: TextStyle(
                    fontSize: 10.5,
                    fontWeight: FontWeight.w800,
                    letterSpacing: 0.5,
                    color: AppColors.textSecondary,
                  ),
                ),
              ),

              // 2x2 Kompakt Bölüm Kartları (Tek Sayfaya Sığar)
              Row(
                children: [
                  Expanded(
                    child: _CompactSectionCard(
                      icon: Icons.electric_meter_rounded,
                      color: AppColors.priorityHigh,
                      bg: AppColors.electricSoft,
                      title: 'Elektrik Sayaçları',
                      subtitle: '$elecCount sayaç · Okuma',
                      onTap: () => context.push('/energy/electric'),
                    ),
                  ),
                  const SizedBox(width: 6),
                  Expanded(
                    child: _CompactSectionCard(
                      icon: Icons.water_drop_rounded,
                      color: AppColors.statusNew,
                      bg: AppColors.waterSoft,
                      title: 'Mekanik Sayaçlar',
                      subtitle: '$mechCount sayaç · Su/Gaz',
                      onTap: () => context.push('/energy/mechanical'),
                    ),
                  ),
                ],
              ),
              if (canReports || canManage) ...[
                const SizedBox(height: 6),
                Row(
                  children: [
                    Expanded(
                      child: _CompactSectionCard(
                        icon: Icons.receipt_long_rounded,
                        color: AppColors.primaryNavy,
                        bg: AppColors.primarySoft,
                        title: 'Faturalar & PDF',
                        subtitle: 'Fatura listesi ve AI analiz',
                        onTap: () =>
                            context.push('/energy/invoices?tab=0'),
                      ),
                    ),
                    const SizedBox(width: 6),
                    Expanded(
                      child: _CompactSectionCard(
                        icon: Icons.pie_chart_rounded,
                        color: AppColors.accentTurquoise,
                        bg: AppColors.turquoiseSoft,
                        title: 'Bütçe & Sapma',
                        subtitle: 'Dönem karşılaştırma',
                        onTap: () =>
                            context.push('/energy/invoices?tab=3'),
                      ),
                    ),
                  ],
                ),
              ],

              // Alt Durum Satırı (Son Okuma Zamanı)
              const SizedBox(height: 6),
              Card(
                child: Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 10,
                    vertical: 7,
                  ),
                  child: Row(
                    children: [
                      const Icon(
                        Icons.schedule_rounded,
                        size: 15,
                        color: AppColors.accentTurquoise,
                      ),
                      const SizedBox(width: 6),
                      Expanded(
                        child: Text(
                          latestReading != null
                              ? 'Son Okuma: ${DateFormat('dd.MM.yyyy HH:mm', 'tr_TR').format(latestReading.toLocal())}'
                              : 'Henüz okuma kaydı bulunmuyor',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontSize: 11,
                            fontWeight: FontWeight.w600,
                            color: AppColors.textPrimary,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
        bottomNavigationBar: FloatingPillBottomBar(
          activeKey: 'energy',
          quickActionLabel: canCreate ? 'OKUMA' : null,
          quickActionIcon: Icons.add_rounded,
          onQuickAction: canCreate ? () => context.push('/energy/electric') : null,
        ),
      ),
    );
  }
}

class _CompactKpiCard extends StatelessWidget {
  final String label;
  final String value;
  final String unit;
  final IconData icon;
  final Color color;
  final Color bg;

  const _CompactKpiCard({
    required this.label,
    required this.value,
    required this.unit,
    required this.icon,
    required this.color,
    required this.bg,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    label,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 9.5,
                      fontWeight: FontWeight.w800,
                      color: AppColors.textSecondary,
                      letterSpacing: 0.3,
                    ),
                  ),
                ),
                PastelIconBox(
                  icon: icon,
                  color: color,
                  background: bg,
                  size: 24,
                  iconSize: 14,
                ),
              ],
            ),
            const SizedBox(height: 4),
            FittedBox(
              fit: BoxFit.scaleDown,
              alignment: Alignment.centerLeft,
              child: RichText(
                text: TextSpan(
                  children: [
                    TextSpan(
                      text: value,
                      style: const TextStyle(
                        fontSize: 15.5,
                        fontWeight: FontWeight.w800,
                        color: AppColors.textPrimary,
                      ),
                    ),
                    TextSpan(
                      text: ' $unit',
                      style: const TextStyle(
                        fontSize: 10.5,
                        fontWeight: FontWeight.w600,
                        color: AppColors.textSecondary,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _CompactSectionCard extends StatelessWidget {
  final IconData icon;
  final Color color;
  final Color bg;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  const _CompactSectionCard({
    required this.icon,
    required this.color,
    required this.bg,
    required this.title,
    required this.subtitle,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(9),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  PastelIconBox(
                    icon: icon,
                    color: color,
                    background: bg,
                    size: 28,
                    iconSize: 16,
                  ),
                  const Icon(
                    Icons.arrow_forward_ios_rounded,
                    size: 12,
                    color: AppColors.textSecondary,
                  ),
                ],
              ),
              const SizedBox(height: 6),
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
              const SizedBox(height: 1),
              Text(
                subtitle,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  fontSize: 10.5,
                  color: AppColors.textSecondary,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import 'package:avm_tech_platform/core/auth/auth_provider.dart';
import 'package:avm_tech_platform/core/permissions/permission_models.dart';
import 'package:avm_tech_platform/core/theme/app_theme.dart';
import 'package:avm_tech_platform/core/utils/error_utils.dart';
import 'package:avm_tech_platform/core/widgets/common_widgets.dart';
import 'package:avm_tech_platform/features/energy/data/models/meter_model.dart';
import 'package:avm_tech_platform/features/energy/data/models/reading_model.dart';
import 'package:avm_tech_platform/features/energy/presentation/screens/reading_entry_sheet.dart';
import 'package:avm_tech_platform/features/energy/providers/energy_providers.dart';
import 'package:avm_tech_platform/features/energy/services/energy_excel_service.dart';

class MeterDetailScreen extends ConsumerWidget {
  final String meterId;
  const MeterDetailScreen({super.key, required this.meterId});

  Future<void> _deleteReading(
    BuildContext context,
    WidgetRef ref,
    MeterModel meter,
    MeterReadingModel reading,
  ) async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Silme Onayı'),
        content: const Text('Bu okuma kaydını silmek istediğinize emin misiniz?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('İptal'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: AppColors.priorityUrgent),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Sil'),
          ),
        ],
      ),
    );
    if (confirm != true) return;

    try {
      await EnergyRepository.deleteReading(reading.id);
      ref.invalidate(meterReadingsProvider(meter.id));
      final now = DateTime.now();
      ref.invalidate(energyDashboardProvider((year: now.year, month: now.month)));
      if (context.mounted) showAppSnack(context, 'Okuma silindi.');
    } catch (e) {
      if (context.mounted) showAppSnack(context, friendlyError(e), error: true);
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final meterAsync = ref.watch(meterDetailProvider(meterId));
    final readingsAsync = ref.watch(meterReadingsProvider(meterId));
    final profile = ref.watch(authProvider).profile;

    final canCreate =
        profile?.hasModulePermission('energy', ModulePermission.create) ?? false;
    final canDelete =
        profile?.hasModulePermission('energy', ModulePermission.delete) ?? false;
    final canExportExcel = EnergyExcelService.canExportMeters(profile);

    return meterAsync.when(
      loading: () =>
          const Scaffold(body: Center(child: CircularProgressIndicator())),
      error: (e, _) => Scaffold(
        appBar: AppBar(title: const Text('Sayaç Geçmişi')),
        body: ErrorRetry(
          message: friendlyError(e),
          onRetry: () => ref.invalidate(meterDetailProvider(meterId)),
        ),
      ),
      data: (meter) {
        final readings = readingsAsync.valueOrNull ?? const <MeterReadingModel>[];
        return Scaffold(
          appBar: AppBar(
            title: Text(
              '${meter.name} Geçmişi',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
            actions: [
              if (canExportExcel && readings.isNotEmpty)
                IconButton(
                  tooltip: 'Excel İndir',
                  icon: const Icon(Icons.download_outlined),
                  onPressed: () =>
                      EnergyExcelService.exportSingleMeter(context, meter, readings),
                ),
            ],
          ),
          floatingActionButton: canCreate
              ? FloatingActionButton.extended(
                  onPressed: () =>
                      showReadingEntrySheet(context, ref, meter: meter),
                  icon: const Icon(Icons.add),
                  label: const Text('Okuma Gir'),
                )
              : null,
          body: SafeArea(
            top: false,
            child: AsyncValueView<List<MeterReadingModel>>(
              value: readingsAsync,
              onRetry: () => ref.invalidate(meterReadingsProvider(meterId)),
              data: (list) {
                return RefreshIndicator(
                  onRefresh: () async {
                    ref.invalidate(meterDetailProvider(meterId));
                    ref.invalidate(meterReadingsProvider(meterId));
                  },
                  child: ListView(
                    padding: const EdgeInsets.fromLTRB(12, 12, 12, 84),
                  children: [
                    Card(
                      child: Padding(
                        padding: const EdgeInsets.all(14),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              meter.name,
                              style: const TextStyle(
                                fontSize: 16,
                                fontWeight: FontWeight.bold,
                                color: AppColors.primaryNavy,
                              ),
                            ),
                            const SizedBox(height: 6),
                            Text('Çarpan: ${meter.multiplier}'),
                            if (meter.equipmentName != null)
                              Text(
                                'Bağlı Ekipman: ${meter.equipmentCode ?? ''} - ${meter.equipmentName}',
                              ),
                            if (meter.eicCode != null)
                              Text('EIC Kodu: ${meter.eicCode}'),
                            if (meter.meterNo != null)
                              Text('Sayaç No: ${meter.meterNo}'),
                          ],
                        ),
                      ),
                    ),
                    const SizedBox(height: 12),
                    if (list.isEmpty)
                      const Padding(
                        padding: EdgeInsets.all(24),
                        child: Center(
                          child: Text(
                            'Henüz okuma kaydı yok.',
                            style: TextStyle(color: AppColors.textSecondary),
                          ),
                        ),
                      )
                    else
                      ...list.map((r) {
                        final hasPenalty =
                            meter.isElectric &&
                            (r.isInductivePenalty || r.isCapacitivePenalty);
                        return Card(
                          margin: const EdgeInsets.only(bottom: 10),
                          child: ListTile(
                            title: Row(
                              children: [
                                Expanded(
                                  child: Text(
                                    DateFormat('dd.MM.yyyy')
                                        .format(r.readingDate.toLocal()),
                                    style: const TextStyle(
                                        fontWeight: FontWeight.bold),
                                  ),
                                ),
                                StatusChip(
                                  label:
                                      '${r.consumption.toStringAsFixed(1)} ${meter.isElectric ? 'kWh' : 'm³'}',
                                  color: hasPenalty
                                      ? AppColors.priorityUrgent
                                      : AppColors.primaryNavy,
                                ),
                              ],
                            ),
                            subtitle: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                const SizedBox(height: 4),
                                if (meter.isElectric)
                                  Text(
                                    'Aktif: ${r.activeValue ?? '-'} | İnd: ${r.inductiveValue ?? '-'} (%${r.inductivePercent ?? 0}) | Kap: ${r.capacitiveValue ?? '-'} (%${r.capacitivePercent ?? 0})',
                                    style: const TextStyle(fontSize: 12),
                                  )
                                else
                                  Text(
                                    'Endeks: ${r.indexValue ?? '-'}',
                                    style: const TextStyle(fontSize: 12),
                                  ),
                                Text(
                                  'Giren: ${r.enteredByName}',
                                  style: const TextStyle(
                                    fontSize: 11,
                                    color: AppColors.textSecondary,
                                  ),
                                ),
                              ],
                            ),
                            trailing: canDelete
                                ? IconButton(
                                    icon: const Icon(
                                      Icons.delete_outline,
                                      color: AppColors.priorityUrgent,
                                    ),
                                    onPressed: () =>
                                        _deleteReading(context, ref, meter, r),
                                  )
                                : null,
                          ),
                        );
                      }),
                  ],
                ),
              );
            },
            ),
          ),
        );
      },
    );
  }
}

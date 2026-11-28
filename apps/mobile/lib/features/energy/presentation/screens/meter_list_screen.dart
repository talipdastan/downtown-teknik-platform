import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import 'package:avm_tech_platform/core/auth/auth_provider.dart';
import 'package:avm_tech_platform/core/equipment/equipment_model.dart';
import 'package:avm_tech_platform/core/equipment/equipment_providers.dart';
import 'package:avm_tech_platform/core/permissions/permission_models.dart';
import 'package:avm_tech_platform/core/theme/app_theme.dart';
import 'package:avm_tech_platform/core/utils/error_utils.dart';
import 'package:avm_tech_platform/core/widgets/common_widgets.dart';
import 'package:avm_tech_platform/features/energy/data/models/meter_model.dart';
import 'package:avm_tech_platform/features/energy/presentation/screens/reading_entry_sheet.dart';
import 'package:avm_tech_platform/features/energy/providers/energy_providers.dart';
import 'package:avm_tech_platform/features/energy/services/energy_excel_service.dart';

/// Elektrik veya Mekanik sayaç listesi (arama, sürükle-bırak sıralama,
/// ekleme + ortak ekipman seçimi, çarpan düzenleme, okuma girişi ve Excel).
class MeterListScreen extends ConsumerStatefulWidget {
  final String meterType; // 'electric' | 'mechanical'
  const MeterListScreen({super.key, required this.meterType});

  @override
  ConsumerState<MeterListScreen> createState() => _MeterListScreenState();
}

class _MeterListScreenState extends ConsumerState<MeterListScreen> {
  String _search = '';

  bool get _isElectric => widget.meterType == 'electric';

  Future<void> _showAddMeterDialog(List<MeterModel> currentMeters) async {
    final nameCtrl = TextEditingController();
    final multCtrl = TextEditingController(text: '1.0');
    String category = _isElectric ? 'electric' : 'water';
    String? equipmentId;

    final saved = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) {
          final eqs =
              ref.read(equipmentOptionsProvider).valueOrNull ?? const <EquipmentModel>[];
          return AlertDialog(
            title: Text(_isElectric ? 'Yeni Elektrik Sayacı' : 'Yeni Mekanik Sayaç'),
            content: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  TextField(
                    controller: nameCtrl,
                    decoration: const InputDecoration(labelText: 'Sayaç Adı'),
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    controller: multCtrl,
                    keyboardType:
                        const TextInputType.numberWithOptions(decimal: true),
                    decoration: const InputDecoration(labelText: 'Çarpan'),
                  ),
                  if (!_isElectric) ...[
                    const SizedBox(height: 10),
                    DropdownButtonFormField<String>(
                      initialValue: category,
                      decoration: const InputDecoration(labelText: 'Kategori'),
                      items: const [
                        DropdownMenuItem(value: 'water', child: Text('Şebeke Suyu')),
                        DropdownMenuItem(value: 'cooling', child: Text('Soğutma / Kule')),
                        DropdownMenuItem(value: 'gas', child: Text('Doğalgaz')),
                        DropdownMenuItem(value: 'other', child: Text('Diğer Mekanik')),
                      ],
                      onChanged: (v) {
                        if (v != null) setDialogState(() => category = v);
                      },
                    ),
                  ],
                  if (eqs.isNotEmpty) ...[
                    const SizedBox(height: 10),
                    DropdownButtonFormField<String?>(
                      initialValue: equipmentId,
                      isExpanded: true,
                      decoration: const InputDecoration(
                        labelText: 'Bağlı Ekipman (Opsiyonel)',
                      ),
                      items: [
                        const DropdownMenuItem<String?>(
                          value: null,
                          child: Text('Bağlantısız'),
                        ),
                        for (final eq in eqs)
                          DropdownMenuItem<String?>(
                            value: eq.id,
                            child: Text('${eq.code} - ${eq.name}'),
                          ),
                      ],
                      onChanged: (v) => setDialogState(() => equipmentId = v),
                    ),
                  ],
                ],
              ),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(ctx, false),
                child: const Text('Vazgeç'),
              ),
              FilledButton(
                onPressed: () async {
                  final name = nameCtrl.text.trim();
                  final mult =
                      double.tryParse(multCtrl.text.trim().replaceAll(',', '.'));
                  if (name.isEmpty || mult == null || mult <= 0) return;
                  try {
                    await EnergyRepository.insertMeter({
                      'name': name,
                      'meter_type': widget.meterType,
                      'category': category,
                      'multiplier': mult,
                      'sort_order': currentMeters.length,
                      if (equipmentId != null) 'equipment_id': equipmentId,
                    });
                    if (ctx.mounted) Navigator.pop(ctx, true);
                  } catch (e) {
                    if (ctx.mounted) {
                      showAppSnack(ctx, friendlyError(e), error: true);
                    }
                  }
                },
                child: const Text('Ekle'),
              ),
            ],
          );
        },
      ),
    );
    nameCtrl.dispose();
    multCtrl.dispose();

    if (saved == true) {
      ref.invalidate(metersProvider(widget.meterType));
      if (mounted) showAppSnack(context, 'Sayaç eklendi.');
    }
  }

  Future<void> _editMultiplier(MeterModel meter) async {
    final ctrl = TextEditingController(text: meter.multiplier.toString());
    final saved = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('${meter.name} Çarpanı'),
        content: TextField(
          controller: ctrl,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          decoration: const InputDecoration(labelText: 'Yeni Çarpan'),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('İptal'),
          ),
          FilledButton(
            onPressed: () async {
              final val = double.tryParse(ctrl.text.trim().replaceAll(',', '.'));
              if (val == null || val <= 0) return;
              try {
                await EnergyRepository.updateMeterMultiplier(meter.id, val);
                if (ctx.mounted) Navigator.pop(ctx, true);
              } catch (e) {
                if (ctx.mounted) {
                  showAppSnack(ctx, friendlyError(e), error: true);
                }
              }
            },
            child: const Text('Kaydet'),
          ),
        ],
      ),
    );
    ctrl.dispose();
    if (saved == true) {
      ref.invalidate(metersProvider(widget.meterType));
    }
  }

  Future<void> _saveReorder(List<MeterModel> list) async {
    try {
      final meterIds = list.map((m) => m.id).toList();
      await EnergyRepository.reorderMeters(meterIds);
      ref.invalidate(metersProvider(widget.meterType));
    } catch (e) {
      if (mounted) showAppSnack(context, friendlyError(e), error: true);
    }
  }

  void _invalidateMeterViews() {
    ref.invalidate(metersProvider(widget.meterType));
    ref.invalidate(metersProvider(null));
    ref.invalidate(trashedMetersProvider);
    final now = DateTime.now();
    ref.invalidate(energyDashboardProvider((year: now.year, month: now.month)));
  }

  Future<void> _moveToTrash(MeterModel meter) async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Çöp Kutusuna Taşı'),
        content: Text(
          '"${meter.name}" sayacını çöp kutusuna taşımak istiyor musunuz?\n'
          'Okuma verileri 1 ay boyunca Çöp Kutusu\'nda saklanır, 1 ay sonunda kalıcı silinir.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('İptal'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: AppColors.priorityUrgent),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Çöpe Taşı'),
          ),
        ],
      ),
    );
    if (confirm != true) return;

    try {
      await EnergyRepository.softDeleteMeter(meter.id);
      _invalidateMeterViews();
      if (mounted) {
        showAppSnack(
          context,
          '${meter.name} çöp kutusuna taşındı (1 ay saklanır).',
        );
      }
    } catch (e) {
      if (mounted) showAppSnack(context, friendlyError(e), error: true);
    }
  }

  Future<void> _openTrashSheet() async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (_) => _MeterTrashSheet(
        onChanged: _invalidateMeterViews,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final metersAsync = ref.watch(metersProvider(widget.meterType));
    final profile = ref.watch(authProvider).profile;
    final isAdmin = profile?.isSystemAdmin ?? false;
    final canCreateReading =
        profile?.hasModulePermission('energy', ModulePermission.create) ?? false;
    final canManage =
        profile?.hasModulePermission('energy', ModulePermission.manage) ?? false;
    final canExportExcel = EnergyExcelService.canExportMeters(profile);

    return Scaffold(
      appBar: AppBar(
        title: Text(_isElectric ? 'Elektrik Sayaçları' : 'Mekanik Sayaçlar'),
        actions: [
          if (isAdmin)
            IconButton(
              tooltip: 'Çöp Kutusu',
              icon: const Icon(Icons.delete_sweep_outlined),
              onPressed: _openTrashSheet,
            ),
          if (canExportExcel)
            IconButton(
              tooltip: 'Excel İndir',
              icon: const Icon(Icons.download_outlined),
              onPressed: () {
                final list = metersAsync.valueOrNull ?? const <MeterModel>[];
                if (list.isEmpty) {
                  showAppSnack(
                    context,
                    'Dışa aktarılacak sayaç bulunamadı.',
                    error: true,
                  );
                  return;
                }
                if (_isElectric) {
                  EnergyExcelService.exportElectrical(context, list);
                } else {
                  EnergyExcelService.exportMechanical(context, list);
                }
              },
            ),
          if (canManage)
            IconButton(
              tooltip: 'Sayaç Ekle',
              icon: const Icon(Icons.add_circle_outline),
              onPressed: () =>
                  _showAddMeterDialog(metersAsync.valueOrNull ?? const []),
            ),
        ],
      ),
      body: SafeArea(
        top: false,
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 10, 12, 8),
              child: TextField(
                decoration: const InputDecoration(
                  hintText: 'Sayaç ara...',
                  prefixIcon: Icon(Icons.search),
                ),
                onChanged: (v) => setState(() => _search = v.trim().toLowerCase()),
              ),
            ),
            Expanded(
              child: AsyncValueView<List<MeterModel>>(
                value: metersAsync,
                onRetry: () => ref.invalidate(metersProvider(widget.meterType)),
                data: (allMeters) {
                  final filtered = _search.isEmpty
                      ? List<MeterModel>.from(allMeters)
                      : allMeters
                          .where((m) => m.name.toLowerCase().contains(_search))
                          .toList();

                  if (filtered.isEmpty) {
                    return const Center(
                      child: Text(
                        'Sayaç bulunamadı.',
                        style: TextStyle(color: AppColors.textSecondary),
                      ),
                    );
                  }

                  Widget buildTile(MeterModel m) {
                    return Card(
                      key: ValueKey(m.id),
                      margin: const EdgeInsets.only(bottom: 10),
                      child: ListTile(
                        contentPadding: const EdgeInsets.symmetric(
                          horizontal: 12,
                          vertical: 2,
                        ),
                        leading: CircleAvatar(
                          backgroundColor: (_isElectric
                                  ? AppColors.priorityHigh
                                  : AppColors.energyAccent)
                              .withValues(alpha: 0.14),
                          child: Icon(
                            _isElectric
                                ? Icons.electric_meter_outlined
                                : Icons.water_drop_outlined,
                            color: _isElectric
                                ? AppColors.priorityHigh
                                : AppColors.energyAccent,
                          ),
                        ),
                        title: Text(
                          m.name,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(fontWeight: FontWeight.bold),
                        ),
                        subtitle: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                Flexible(
                                  child: Text(
                                    'Çarpan: ${m.multiplier}',
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                ),
                                if (canManage) ...[
                                  const SizedBox(width: 6),
                                  InkWell(
                                    onTap: () => _editMultiplier(m),
                                    child: const Icon(Icons.edit, size: 15),
                                  ),
                                ],
                              ],
                            ),
                            if (m.equipmentName != null)
                              Text(
                                'Ekipman: ${m.equipmentCode ?? ''} ${m.equipmentName}',
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                  fontSize: 11,
                                  color: AppColors.textSecondary,
                                ),
                              ),
                          ],
                        ),
                        trailing: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            IconButton(
                              visualDensity: VisualDensity.compact,
                              constraints: const BoxConstraints(
                                minWidth: 30,
                                minHeight: 30,
                              ),
                              padding: EdgeInsets.zero,
                              tooltip: 'Okuma Geçmişi',
                              icon: const Icon(Icons.history, size: 20),
                              onPressed: () =>
                                  context.push('/energy/meters/${m.id}'),
                            ),
                            if (canCreateReading)
                              IconButton(
                                visualDensity: VisualDensity.compact,
                                constraints: const BoxConstraints(
                                  minWidth: 30,
                                  minHeight: 30,
                                ),
                                padding: EdgeInsets.zero,
                                tooltip: 'Okuma Gir',
                                icon: const Icon(
                                  Icons.add_box_outlined,
                                  color: AppColors.primaryNavy,
                                  size: 20,
                                ),
                                onPressed: () =>
                                    showReadingEntrySheet(context, ref, meter: m),
                              ),
                            if (isAdmin)
                              IconButton(
                                visualDensity: VisualDensity.compact,
                                constraints: const BoxConstraints(
                                  minWidth: 30,
                                  minHeight: 30,
                                ),
                                padding: EdgeInsets.zero,
                                tooltip: 'Çöp Kutusuna Taşı',
                                icon: const Icon(
                                  Icons.delete_outline,
                                  color: AppColors.priorityUrgent,
                                  size: 20,
                                ),
                                onPressed: () => _moveToTrash(m),
                              ),
                          ],
                        ),
                        onTap: canCreateReading
                            ? () => showReadingEntrySheet(context, ref, meter: m)
                            : () => context.push('/energy/meters/${m.id}'),
                      ),
                    );
                  }

                  if (_search.isEmpty && canManage) {
                    return ReorderableListView.builder(
                      padding: const EdgeInsets.symmetric(horizontal: 12),
                      itemCount: filtered.length,
                      onReorderItem: (oldIndex, newIndex) {
                        final item = filtered.removeAt(oldIndex);
                        filtered.insert(newIndex, item);
                        _saveReorder(filtered);
                      },
                      itemBuilder: (_, i) => buildTile(filtered[i]),
                    );
                  }

                  return ListView.builder(
                    padding: const EdgeInsets.symmetric(horizontal: 12),
                    itemCount: filtered.length,
                    itemBuilder: (_, i) => buildTile(filtered[i]),
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

class _MeterTrashSheet extends ConsumerStatefulWidget {
  final VoidCallback onChanged;
  const _MeterTrashSheet({required this.onChanged});

  @override
  ConsumerState<_MeterTrashSheet> createState() => _MeterTrashSheetState();
}

class _MeterTrashSheetState extends ConsumerState<_MeterTrashSheet> {
  bool _busy = false;

  Future<void> _restore(TrashedMeterItem item) async {
    setState(() => _busy = true);
    try {
      await EnergyRepository.restoreMeter(item.id);
      widget.onChanged();
      if (mounted) {
        showAppSnack(
          context,
          '${item.name} ve ${item.readingsCount} okuma kaydı geri yüklendi.',
        );
      }
    } catch (e) {
      if (mounted) showAppSnack(context, friendlyError(e), error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _permanentDelete(TrashedMeterItem item) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Kalıcı Silme Onayı'),
        content: Text(
          '"${item.name}" sayacı ve ${item.readingsCount} okuma kaydı kalıcı olarak silinecek. Bu işlem geri alınamaz!',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Vazgeç'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: AppColors.priorityUrgent),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Kalıcı Sil'),
          ),
        ],
      ),
    );
    if (ok != true) return;

    setState(() => _busy = true);
    try {
      await EnergyRepository.permanentlyDeleteMeter(item.id);
      widget.onChanged();
      if (mounted) {
        showAppSnack(context, '${item.name} kalıcı olarak silindi.');
      }
    } catch (e) {
      if (mounted) showAppSnack(context, friendlyError(e), error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final trashAsync = ref.watch(trashedMetersProvider);
    final dateFmt = DateFormat('dd.MM.yyyy HH:mm', 'tr_TR');

    return SafeArea(
      top: false,
      child: ConstrainedBox(
        constraints: BoxConstraints(
          maxHeight: MediaQuery.of(context).size.height * 0.85,
        ),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  const Expanded(
                    child: Text(
                      'Sayaç Çöp Kutusu (Admin)',
                      style: TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w800,
                        color: AppColors.primaryNavy,
                      ),
                    ),
                  ),
                  IconButton(
                    visualDensity: VisualDensity.compact,
                    onPressed: () => Navigator.pop(context),
                    icon: const Icon(Icons.close_rounded),
                  ),
                ],
              ),
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: AppColors.electricSoft,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(
                    color: AppColors.priorityHigh.withValues(alpha: 0.3),
                  ),
                ),
                child: const Text(
                  'Silinen sayaçlar ve okumaları 1 ay boyunca burada tutulur, 1 ay sonunda kalıcı silinir. Yalnızca Admin yönetebilir.',
                  style: TextStyle(
                    fontSize: 11.5,
                    fontWeight: FontWeight.w600,
                    color: AppColors.textPrimary,
                  ),
                ),
              ),
              const SizedBox(height: 10),
              Flexible(
                child: AsyncValueView<List<TrashedMeterItem>>(
                  value: trashAsync,
                  onRetry: () => ref.invalidate(trashedMetersProvider),
                  data: (items) {
                    if (items.isEmpty) {
                      return const Padding(
                        padding: EdgeInsets.symmetric(vertical: 28),
                        child: Center(
                          child: Text(
                            'Çöp kutusu boş.',
                            style: TextStyle(color: AppColors.textSecondary),
                          ),
                        ),
                      );
                    }
                    return ListView.separated(
                      shrinkWrap: true,
                      itemCount: items.length,
                      separatorBuilder: (_, __) => const SizedBox(height: 8),
                      itemBuilder: (_, i) {
                        final item = items[i];
                        final remainText = item.daysRemaining == 0
                            ? 'Bugün kalıcı silinecek'
                            : '${item.daysRemaining} gün kaldı';
                        return Card(
                          child: Padding(
                            padding: const EdgeInsets.all(12),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(
                                  children: [
                                    Expanded(
                                      child: Text(
                                        item.name,
                                        maxLines: 1,
                                        overflow: TextOverflow.ellipsis,
                                        style: const TextStyle(
                                          fontWeight: FontWeight.w800,
                                          fontSize: 14,
                                        ),
                                      ),
                                    ),
                                    const SizedBox(width: 6),
                                    StatusChip(
                                      label: remainText,
                                      color: AppColors.priorityHigh,
                                    ),
                                  ],
                                ),
                                const SizedBox(height: 4),
                                Text(
                                  '${item.meterType == 'electric' ? 'Elektrik' : 'Mekanik'} · ${item.readingsCount} okuma · Silen: ${item.deletedByName}',
                                  style: const TextStyle(
                                    fontSize: 11.5,
                                    color: AppColors.textSecondary,
                                  ),
                                ),
                                Text(
                                  'Silinme: ${dateFmt.format(item.deletedAt.toLocal())}',
                                  style: const TextStyle(
                                    fontSize: 11,
                                    color: AppColors.textSecondary,
                                  ),
                                ),
                                const SizedBox(height: 8),
                                Row(
                                  children: [
                                    Expanded(
                                      child: OutlinedButton.icon(
                                        onPressed: _busy
                                            ? null
                                            : () => _restore(item),
                                        icon: const Icon(
                                          Icons.restore_from_trash_rounded,
                                          size: 16,
                                        ),
                                        label: const Text('Geri Yükle'),
                                      ),
                                    ),
                                    const SizedBox(width: 8),
                                    Expanded(
                                      child: FilledButton.icon(
                                        style: FilledButton.styleFrom(
                                          backgroundColor:
                                              AppColors.priorityUrgent,
                                        ),
                                        onPressed: _busy
                                            ? null
                                            : () => _permanentDelete(item),
                                        icon: const Icon(
                                          Icons.delete_forever_outlined,
                                          size: 16,
                                        ),
                                        label: const Text('Kalıcı Sil'),
                                      ),
                                    ),
                                  ],
                                ),
                              ],
                            ),
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
      ),
    );
  }
}

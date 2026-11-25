import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:uuid/uuid.dart';

import 'package:avm_tech_platform/core/network/api_client.dart';
import 'package:avm_tech_platform/core/theme/app_theme.dart';
import 'package:avm_tech_platform/core/utils/error_utils.dart';
import 'package:avm_tech_platform/core/widgets/common_widgets.dart';
import 'package:avm_tech_platform/features/energy/data/models/meter_model.dart';
import 'package:avm_tech_platform/features/energy/providers/energy_providers.dart';

/// Elektrik veya Mekanik sayaç okuma girişi alt penceresi.
/// Hesaplama, önceki endeks doğrulama ve reaktif ceza bildirimi sunucu
/// tarafında `rpc_record_meter_reading` ile yürütülür.
Future<bool> showReadingEntrySheet(
  BuildContext context,
  WidgetRef ref, {
  required MeterModel meter,
}) async {
  final saved = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    builder: (_) => _ReadingEntrySheet(meter: meter),
  );
  if (saved == true) {
    final now = DateTime.now();
    ref.invalidate(energyDashboardProvider((year: now.year, month: now.month)));
    ref.invalidate(meterReadingsProvider(meter.id));
  }
  return saved ?? false;
}

class _ReadingEntrySheet extends StatefulWidget {
  final MeterModel meter;
  const _ReadingEntrySheet({required this.meter});

  @override
  State<_ReadingEntrySheet> createState() => _ReadingEntrySheetState();
}

class _ReadingEntrySheetState extends State<_ReadingEntrySheet> {
  DateTime _selectedDate = DateTime.now();
  final _activeCtrl = TextEditingController();
  final _indCtrl = TextEditingController();
  final _capCtrl = TextEditingController();
  final _indexCtrl = TextEditingController();
  final _notesCtrl = TextEditingController();
  bool _saving = false;
  String? _error;

  @override
  void dispose() {
    _activeCtrl.dispose();
    _indCtrl.dispose();
    _capCtrl.dispose();
    _indexCtrl.dispose();
    _notesCtrl.dispose();
    super.dispose();
  }

  double? _parseNum(TextEditingController c) =>
      double.tryParse(c.text.trim().replaceAll(',', '.'));

  Future<void> _submit({bool overwrite = false}) async {
    double? active;
    double? ind;
    double? cap;
    double? index;

    if (widget.meter.isElectric) {
      active = _parseNum(_activeCtrl);
      ind = _parseNum(_indCtrl);
      cap = _parseNum(_capCtrl);
      if (active == null || ind == null || cap == null) {
        setState(() => _error = 'Aktif, İndüktif ve Kapasitif alanlarını sayısal giriniz.');
        return;
      }
    } else {
      index = _parseNum(_indexCtrl);
      if (index == null) {
        setState(() => _error = 'Endeks değerini sayısal giriniz.');
        return;
      }
    }

    setState(() {
      _saving = true;
      _error = null;
    });

    try {
      await Api.client.rpc(
        'rpc_record_meter_reading',
        params: {
          'p_meter_id': widget.meter.id,
          'p_reading_date': _selectedDate.toUtc().toIso8601String(),
          'p_active_value': active,
          'p_inductive_value': ind,
          'p_capacitive_value': cap,
          'p_index_value': index,
          'p_notes': _notesCtrl.text.trim().isEmpty ? null : _notesCtrl.text.trim(),
          'p_overwrite': overwrite,
          'p_client_mutation_id': const Uuid().v4(),
        },
      );

      if (!mounted) return;
      showAppSnack(
        context,
        overwrite ? 'Mevcut okuma güncellendi.' : 'Sayaç okuması kaydedildi.',
      );
      Navigator.pop(context, true);
    } catch (e) {
      final raw = e.toString();
      if (!overwrite && raw.contains('SAME_DAY_EXISTS') && mounted) {
        final confirm = await showDialog<bool>(
          context: context,
          builder: (ctx) => AlertDialog(
            title: const Text('Aynı Güne Kayıt Var'),
            content: const Text(
              'Seçilen gün için zaten bir okuma girilmiş. Eski verinin üzerine yazılsın mı?',
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(ctx, false),
                child: const Text('İptal'),
              ),
              FilledButton(
                onPressed: () => Navigator.pop(ctx, true),
                child: const Text('Güncelle'),
              ),
            ],
          ),
        );
        if (confirm == true && mounted) {
          await _submit(overwrite: true);
          return;
        }
      }
      if (mounted) {
        setState(() => _error = friendlyError(e));
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final bottomInset = MediaQuery.of(context).viewInsets.bottom;
    return SafeArea(
      top: false,
      child: Padding(
        padding: EdgeInsets.only(
          left: 20,
          right: 20,
          top: 16,
          bottom: bottomInset + 20,
        ),
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                '${widget.meter.name} – Okuma Girişi',
                style: const TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.bold,
                  color: AppColors.primaryNavy,
                ),
              ),
              const SizedBox(height: 12),
              OutlinedButton.icon(
                onPressed: _saving
                    ? null
                    : () async {
                        final picked = await showDatePicker(
                          context: context,
                          initialDate: _selectedDate,
                          firstDate: DateTime(2020),
                          lastDate: DateTime.now().add(const Duration(days: 30)),
                        );
                        if (picked != null) {
                          setState(() => _selectedDate = picked);
                        }
                      },
                icon: const Icon(Icons.calendar_today_outlined),
                label: Text(
                  'Tarih: ${DateFormat('dd.MM.yyyy').format(_selectedDate)}',
                ),
              ),
              const SizedBox(height: 12),
              if (widget.meter.isElectric) ...[
                TextField(
                  controller: _activeCtrl,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  decoration: const InputDecoration(labelText: 'AKTİF (1.8.0)'),
                ),
                const SizedBox(height: 10),
                TextField(
                  controller: _indCtrl,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  decoration: const InputDecoration(labelText: 'İNDÜKTİF (5.8.0)'),
                ),
                const SizedBox(height: 10),
                TextField(
                  controller: _capCtrl,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  decoration: const InputDecoration(labelText: 'KAPASİTİF (8.8.0)'),
                ),
              ] else
                TextField(
                  controller: _indexCtrl,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  decoration: const InputDecoration(labelText: 'Güncel Endeks (m³)'),
                ),
              const SizedBox(height: 10),
              TextField(
                controller: _notesCtrl,
                decoration: const InputDecoration(labelText: 'Not (Opsiyonel)'),
              ),
              if (_error != null) ...[
                const SizedBox(height: 10),
                Text(
                  _error!,
                  style: const TextStyle(color: AppColors.priorityUrgent, fontSize: 13),
                ),
              ],
              const SizedBox(height: 16),
              FilledButton(
                onPressed: _saving ? null : () => _submit(),
                child: Text(_saving ? 'Kaydediliyor...' : 'Kaydet'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

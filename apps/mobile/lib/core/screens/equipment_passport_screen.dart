import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../equipment/equipment_providers.dart';
import '../network/api_client.dart';
import '../theme/app_theme.dart';
import '../utils/error_utils.dart';
import '../widgets/common_widgets.dart';

/// Ekipman 360° Karnesi & QR Kod Arama Ekranı.
/// QR etiketindeki kodu (`DT-EQ:CHL-01` veya `CHL-01`) girerek ya da listeden seçerek
/// ekipmanın açık arıza, bakım ve garanti bilgilerini gösterir; tek tıkla arıza kaydına geçer.
class EquipmentPassportScreen extends ConsumerStatefulWidget {
  const EquipmentPassportScreen({super.key});

  @override
  ConsumerState<EquipmentPassportScreen> createState() =>
      _EquipmentPassportScreenState();
}

class _EquipmentPassportScreenState
    extends ConsumerState<EquipmentPassportScreen> {
  final TextEditingController _codeCtrl = TextEditingController();
  bool _searching = false;
  Map<String, dynamic>? _result;
  String? _error;

  @override
  void dispose() {
    _codeCtrl.dispose();
    super.dispose();
  }

  Future<void> _lookup(String rawCode) async {
    final code = rawCode.trim();
    if (code.isEmpty) return;
    setState(() {
      _searching = true;
      _error = null;
    });
    try {
      final res = await Api.client.rpc(
        'rpc_lookup_qr_target',
        params: {'p_code': code},
      );
      final row = res is List && res.isNotEmpty
          ? Map<String, dynamic>.from(res.first as Map)
          : (res is Map ? Map<String, dynamic>.from(res) : null);
      if (!mounted) return;
      if (row == null) {
        setState(() {
          _result = null;
          _error = '"$code" koduna ait aktif ekipman bulunamadı.';
        });
      } else {
        setState(() => _result = row);
      }
    } catch (e) {
      if (mounted) {
        setState(() => _error = friendlyError(e));
      }
    } finally {
      if (mounted) setState(() => _searching = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final eqAsync = ref.watch(equipmentOptionsProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Ekipman Karnesi & QR')),
      body: ListView(
        padding: const EdgeInsets.all(14),
        children: [
          Card(
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Text(
                    'QR / Ekipman Kodu Sorgula',
                    style: TextStyle(
                      fontSize: 13.5,
                      fontWeight: FontWeight.w800,
                      color: AppColors.primaryNavy,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Row(
                    children: [
                      Expanded(
                        child: TextField(
                          controller: _codeCtrl,
                          textCapitalization: TextCapitalization.characters,
                          decoration: const InputDecoration(
                            hintText: 'Örn: DT-EQ:CHL-01 veya CHL-01',
                            prefixIcon: Icon(Icons.qr_code_scanner_rounded),
                            isDense: true,
                          ),
                          onSubmitted: _lookup,
                        ),
                      ),
                      const SizedBox(width: 8),
                      FilledButton(
                        onPressed:
                            _searching ? null : () => _lookup(_codeCtrl.text),
                        child: Text(_searching ? '...' : 'Bul'),
                      ),
                    ],
                  ),
                  if (_error != null) ...[
                    const SizedBox(height: 8),
                    Text(
                      _error!,
                      style: const TextStyle(
                        fontSize: 12,
                        color: AppColors.priorityUrgent,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
          if (_result != null) ...[
            const SizedBox(height: 10),
            _PassportCard(data: _result!),
          ],
          const SizedBox(height: 12),
          const Padding(
            padding: EdgeInsets.only(left: 4, bottom: 6),
            child: Text(
              'HIZLI EKİPMAN SEÇİMİ',
              style: TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w800,
                letterSpacing: 0.7,
                color: AppColors.textSecondary,
              ),
            ),
          ),
          eqAsync.when(
            loading: () => const Padding(
              padding: EdgeInsets.all(20),
              child: Center(child: CircularProgressIndicator()),
            ),
            error: (e, _) => Text(friendlyError(e)),
            data: (items) => Column(
              children: items.take(25).map((eq) {
                return Card(
                  margin: const EdgeInsets.only(bottom: 6),
                  child: ListTile(
                    dense: true,
                    leading: const Icon(
                      Icons.precision_manufacturing_outlined,
                      color: AppColors.primaryNavy,
                    ),
                    title: Text(
                      '${eq.code} · ${eq.name}',
                      style: const TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    trailing: const Icon(Icons.chevron_right_rounded),
                    onTap: () {
                      _codeCtrl.text = eq.code;
                      _lookup(eq.code);
                    },
                  ),
                );
              }).toList(),
            ),
          ),
        ],
      ),
    );
  }
}

class _PassportCard extends StatelessWidget {
  final Map<String, dynamic> data;
  const _PassportCard({required this.data});

  @override
  Widget build(BuildContext context) {
    final code = data['code']?.toString() ?? '-';
    final name = data['name']?.toString() ?? '-';
    final loc = [
      data['floor_name']?.toString(),
      data['location_name']?.toString(),
    ].where((s) => s != null && s.isNotEmpty).join(' · ');
    final warranty = data['warranty_end_date']?.toString();
    final openTickets = data['open_tickets_count'] ?? 0;
    final totalTickets = data['total_tickets_count'] ?? 0;
    final dueMaint = data['due_maintenance_count'] ?? 0;

    return Card(
      color: AppColors.white,
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: AppColors.primarySoft,
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text(
                    code,
                    style: const TextStyle(
                      fontWeight: FontWeight.w900,
                      color: AppColors.primaryNavy,
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    name,
                    style: const TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w800,
                      color: AppColors.textPrimary,
                    ),
                  ),
                ),
              ],
            ),
            if (loc.isNotEmpty) ...[
              const SizedBox(height: 6),
              Text(
                'Konum: $loc',
                style: const TextStyle(
                  fontSize: 12,
                  color: AppColors.textSecondary,
                ),
              ),
            ],
            if (warranty != null && warranty.isNotEmpty) ...[
              const SizedBox(height: 4),
              Text(
                'Garanti Bitiş: $warranty',
                style: const TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                  color: AppColors.accentTurquoise,
                ),
              ),
            ],
            const SizedBox(height: 10),
            Row(
              children: [
                _MiniStat('Açık Arıza', '$openTickets'),
                const SizedBox(width: 8),
                _MiniStat('Toplam Arıza', '$totalTickets'),
                const SizedBox(width: 8),
                _MiniStat('Planlı Bakım', '$dueMaint'),
              ],
            ),
            const SizedBox(height: 12),
            FilledButton.icon(
              onPressed: () {
                showAppSnack(
                  context,
                  '$code seçildi — Arıza formunda ekipmanı seçip kaydı tamamlayabilirsiniz.',
                );
                context.push('/work-tracking/tickets/new');
              },
              icon: const Icon(Icons.add_alert_rounded, size: 18),
              label: const Text('Bu Ekipman İçin Hızlı Arıza Aç'),
            ),
          ],
        ),
      ),
    );
  }
}

class _MiniStat extends StatelessWidget {
  final String label;
  final String value;
  const _MiniStat(this.label, this.value);

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 6),
        decoration: BoxDecoration(
          color: AppColors.background,
          borderRadius: BorderRadius.circular(10),
        ),
        child: Column(
          children: [
            Text(
              value,
              style: const TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w900,
                color: AppColors.primaryNavy,
              ),
            ),
            const SizedBox(height: 2),
            Text(
              label,
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontSize: 10.5,
                color: AppColors.textSecondary,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

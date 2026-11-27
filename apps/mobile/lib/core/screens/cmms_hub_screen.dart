import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../network/api_client.dart';
import '../theme/app_theme.dart';
import '../utils/error_utils.dart';
import '../widgets/common_widgets.dart';

/// Mobil Kurumsal CMMS Merkezi (Faz 3):
/// 1) Planlı Bakım & Günlük Checklist (Uygun Değil -> Otomatik Arıza Kaydı)
/// 2) Dijital Vardiya Devir Teslim Defteri
/// 3) Yedek Parça & Kritik Stok Görünümü
class CmmsHubScreen extends ConsumerStatefulWidget {
  final int initialTab;
  const CmmsHubScreen({super.key, this.initialTab = 0});

  @override
  ConsumerState<CmmsHubScreen> createState() => _CmmsHubScreenState();
}

class _CmmsHubScreenState extends ConsumerState<CmmsHubScreen>
    with SingleTickerProviderStateMixin {
  late final TabController _tabCtrl;

  @override
  void initState() {
    super.initState();
    _tabCtrl = TabController(
      length: 3,
      vsync: this,
      initialIndex: widget.initialTab.clamp(0, 2),
    );
  }

  @override
  void dispose() {
    _tabCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Saha CMMS Merkezi'),
        bottom: TabBar(
          controller: _tabCtrl,
          labelColor: AppColors.primaryNavy,
          indicatorColor: AppColors.accentTurquoise,
          labelStyle: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800),
          tabs: const [
            Tab(icon: Icon(Icons.fact_check_outlined, size: 18), text: 'Checklist'),
            Tab(icon: Icon(Icons.menu_book_outlined, size: 18), text: 'Vardiya'),
            Tab(icon: Icon(Icons.inventory_2_outlined, size: 18), text: 'Stok'),
          ],
        ),
      ),
      body: TabBarView(
        controller: _tabCtrl,
        children: const [
          _MaintenanceChecklistTab(),
          _ShiftHandoverTab(),
          _InventoryQuickTab(),
        ],
      ),
    );
  }
}

class _MaintenanceChecklistTab extends StatefulWidget {
  const _MaintenanceChecklistTab();

  @override
  State<_MaintenanceChecklistTab> createState() =>
      _MaintenanceChecklistTabState();
}

class _MaintenanceChecklistTabState extends State<_MaintenanceChecklistTab> {
  List<Map<String, dynamic>> _plans = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final data = await Api.client
          .from('maintenance_plans')
          .select('id, title, frequency, checklist, next_due_date, status, equipments(code, name)')
          .order('next_due_date', ascending: true);
      if (mounted) {
        setState(() {
          _plans = (data as List)
              .map((e) => Map<String, dynamic>.from(e as Map))
              .toList();
        });
      }
    } catch (e) {
      if (mounted) showAppSnack(context, friendlyError(e), error: true);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _openChecklist(Map<String, dynamic> plan) async {
    final raw = plan['checklist'];
    final items = (raw is List && raw.isNotEmpty)
        ? raw
            .map((e) => {
                  'label': (e is Map ? e['label'] : e)?.toString() ?? 'Kontrol',
                  'ok': true,
                  'note': '',
                })
            .toList()
        : [
            {'label': 'Genel teknik çalışma kontrolü', 'ok': true, 'note': ''},
          ];
    final noteCtrl = TextEditingController();
    var autoTicket = true;

    final confirmed = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setSheetState) => Padding(
          padding: EdgeInsets.fromLTRB(
            16,
            16,
            16,
            MediaQuery.of(ctx).viewInsets.bottom + 16,
          ),
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  plan['title']?.toString() ?? 'Bakım Kontrolü',
                  style: const TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w800,
                    color: AppColors.primaryNavy,
                  ),
                ),
                const SizedBox(height: 10),
                for (var i = 0; i < items.length; i++)
                  SwitchListTile(
                    dense: true,
                    contentPadding: EdgeInsets.zero,
                    title: Text(
                      items[i]['label'].toString(),
                      style: const TextStyle(fontSize: 13),
                    ),
                    subtitle: Text(
                      items[i]['ok'] == true ? 'Uygun' : 'Uygun Değil (Arıza açılır)',
                      style: TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w700,
                        color: items[i]['ok'] == true
                            ? AppColors.statusSuccess
                            : AppColors.priorityUrgent,
                      ),
                    ),
                    value: items[i]['ok'] == true,
                    onChanged: (v) => setSheetState(() => items[i]['ok'] = v),
                  ),
                CheckboxListTile(
                  dense: true,
                  contentPadding: EdgeInsets.zero,
                  title: const Text(
                    'Uygunsuzluk varsa otomatik Arıza Kaydı aç',
                    style: TextStyle(fontSize: 12),
                  ),
                  value: autoTicket,
                  onChanged: (v) => setSheetState(() => autoTicket = v ?? true),
                ),
                TextField(
                  controller: noteCtrl,
                  decoration: const InputDecoration(
                    labelText: 'Bakım Notu (Opsiyonel)',
                    isDense: true,
                  ),
                ),
                const SizedBox(height: 12),
                FilledButton(
                  onPressed: () => Navigator.pop(ctx, true),
                  child: const Text('Kontrolü Tamamla'),
                ),
              ],
            ),
          ),
        ),
      ),
    );

    if (confirmed != true) return;
    try {
      await Api.client.rpc(
        'rpc_complete_maintenance_execution',
        params: {
          'p_plan_id': plan['id'],
          'p_checklist_results': items,
          'p_notes': noteCtrl.text.trim().isEmpty ? null : noteCtrl.text.trim(),
          'p_create_ticket_on_issue': autoTicket,
        },
      );
      if (mounted) {
        showAppSnack(context, 'Planlı bakım kontrolü kaydedildi.');
        await _load();
      }
    } catch (e) {
      if (mounted) showAppSnack(context, friendlyError(e), error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const Center(child: CircularProgressIndicator());
    if (_plans.isEmpty) {
      return RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          children: const [
            Padding(
              padding: EdgeInsets.all(32),
              child: Text(
                'Henüz tanımlı bakım planı bulunmuyor. Web paneldeki "Planlı Bakım" bölümünden günlük/aylık checklist ekleyebilirsiniz.',
                textAlign: TextAlign.center,
                style: TextStyle(color: AppColors.textSecondary),
              ),
            ),
          ],
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: _load,
      child: ListView.builder(
        padding: const EdgeInsets.all(12),
        itemCount: _plans.length,
        itemBuilder: (_, idx) {
          final p = _plans[idx];
          final eq = p['equipments'] as Map?;
          return Card(
            margin: const EdgeInsets.only(bottom: 8),
            child: ListTile(
              title: Text(
                p['title']?.toString() ?? '-',
                style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w800),
              ),
              subtitle: Text(
                '${eq != null ? '${eq['code']} - ${eq['name']} · ' : ''}Tarih: ${p['next_due_date']}',
                style: const TextStyle(fontSize: 11.5),
              ),
              trailing: FilledButton(
                onPressed: () => _openChecklist(p),
                child: const Text('Uygula', style: TextStyle(fontSize: 12)),
              ),
            ),
          );
        },
      ),
    );
  }
}

class _ShiftHandoverTab extends StatefulWidget {
  const _ShiftHandoverTab();

  @override
  State<_ShiftHandoverTab> createState() => _ShiftHandoverTabState();
}

class _ShiftHandoverTabState extends State<_ShiftHandoverTab> {
  List<Map<String, dynamic>> _rows = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final data = await Api.client
          .from('shift_handovers')
          .select('id, shift_date, shift_type, summary_notes, status, outgoing:profiles!shift_handovers_outgoing_user_id_fkey(full_name), incoming:profiles!shift_handovers_incoming_user_id_fkey(full_name)')
          .order('shift_date', ascending: false)
          .order('handed_over_at', ascending: false)
          .limit(30);
      if (mounted) {
        setState(() {
          _rows = (data as List)
              .map((e) => Map<String, dynamic>.from(e as Map))
              .toList();
        });
      }
    } catch (e) {
      if (mounted) showAppSnack(context, friendlyError(e), error: true);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _createNew() async {
    final noteCtrl = TextEditingController();
    var shiftType = 'morning';
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setS) => AlertDialog(
          title: const Text('Vardiya Devri Oluştur'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              DropdownButtonFormField<String>(
                initialValue: shiftType,
                items: const [
                  DropdownMenuItem(value: 'morning', child: Text('Sabah (08:00-16:00)')),
                  DropdownMenuItem(value: 'evening', child: Text('Akşam (16:00-00:00)')),
                  DropdownMenuItem(value: 'night', child: Text('Gece (00:00-08:00)')),
                ],
                onChanged: (v) => setS(() => shiftType = v ?? 'morning'),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: noteCtrl,
                maxLines: 3,
                decoration: const InputDecoration(
                  labelText: 'Vardiya Devir Notu *',
                  hintText: 'Önemli durumlar ve takip edilecek işler...',
                ),
              ),
            ],
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('İptal')),
            FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Devret')),
          ],
        ),
      ),
    );
    if (ok != true || noteCtrl.text.trim().isEmpty) return;
    try {
      await Api.client.rpc(
        'rpc_create_shift_handover',
        params: {
          'p_shift_date': DateTime.now().toIso8601String().substring(0, 10),
          'p_shift_type': shiftType,
          'p_summary_notes': noteCtrl.text.trim(),
        },
      );
      if (mounted) {
        showAppSnack(context, 'Vardiya devir kaydı oluşturuldu.');
        await _load();
      }
    } catch (e) {
      if (mounted) showAppSnack(context, friendlyError(e), error: true);
    }
  }

  Future<void> _accept(String id) async {
    try {
      await Api.client.rpc('rpc_accept_shift_handover', params: {'p_handover_id': id});
      if (mounted) {
        showAppSnack(context, 'Vardiya teslim alındı.');
        await _load();
      }
    } catch (e) {
      if (mounted) showAppSnack(context, friendlyError(e), error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _createNew,
        icon: const Icon(Icons.add),
        label: const Text('Devir Aç'),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView.builder(
                padding: const EdgeInsets.fromLTRB(12, 12, 12, 80),
                itemCount: _rows.length,
                itemBuilder: (_, i) {
                  final r = _rows[i];
                  final accepted = r['status'] == 'accepted';
                  final outName = (r['outgoing'] as Map?)?['full_name'] ?? '-';
                  final inName = (r['incoming'] as Map?)?['full_name'];
                  return Card(
                    margin: const EdgeInsets.only(bottom: 8),
                    child: Padding(
                      padding: const EdgeInsets.all(12),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              Text(
                                '${r['shift_date']} · ${r['shift_type']}',
                                style: const TextStyle(
                                  fontWeight: FontWeight.w800,
                                  color: AppColors.primaryNavy,
                                ),
                              ),
                              Chip(
                                visualDensity: VisualDensity.compact,
                                label: Text(
                                  accepted ? 'Teslim Alındı' : 'Onay Bekliyor',
                                  style: const TextStyle(fontSize: 10.5),
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 4),
                          Text(
                            r['summary_notes']?.toString() ?? '',
                            style: const TextStyle(fontSize: 12.5),
                          ),
                          const SizedBox(height: 6),
                          Text(
                            'Devreden: $outName${inName != null ? ' · Alan: $inName' : ''}',
                            style: const TextStyle(
                              fontSize: 11,
                              color: AppColors.textSecondary,
                            ),
                          ),
                          if (!accepted) ...[
                            const SizedBox(height: 8),
                            Align(
                              alignment: Alignment.centerRight,
                              child: FilledButton(
                                onPressed: () => _accept(r['id'].toString()),
                                child: const Text('Teslim Al'),
                              ),
                            ),
                          ],
                        ],
                      ),
                    ),
                  );
                },
              ),
            ),
    );
  }
}

class _InventoryQuickTab extends StatefulWidget {
  const _InventoryQuickTab();

  @override
  State<_InventoryQuickTab> createState() => _InventoryQuickTabState();
}

class _InventoryQuickTabState extends State<_InventoryQuickTab> {
  List<Map<String, dynamic>> _items = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final data = await Api.client
          .from('inventory_items')
          .select('id, code, name, unit, current_stock, min_stock, shelf_location')
          .eq('is_active', true)
          .order('name');
      if (mounted) {
        setState(() {
          _items = (data as List)
              .map((e) => Map<String, dynamic>.from(e as Map))
              .toList();
        });
      }
    } catch (e) {
      if (mounted) showAppSnack(context, friendlyError(e), error: true);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const Center(child: CircularProgressIndicator());
    if (_items.isEmpty) {
      return const Center(
        child: Text(
          'Depoda henüz tanımlı malzeme yok.',
          style: TextStyle(color: AppColors.textSecondary),
        ),
      );
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView.builder(
        padding: const EdgeInsets.all(12),
        itemCount: _items.length,
        itemBuilder: (_, i) {
          final it = _items[i];
          final cur = (it['current_stock'] as num?)?.toDouble() ?? 0;
          final min = (it['min_stock'] as num?)?.toDouble() ?? 0;
          final isCrit = cur <= min;
          return Card(
            margin: const EdgeInsets.only(bottom: 6),
            child: ListTile(
              dense: true,
              title: Text(
                '${it['code']} · ${it['name']}',
                style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700),
              ),
              subtitle: Text(
                'Raf: ${it['shelf_location'] ?? '-'} · Min: $min ${it['unit']}',
                style: const TextStyle(fontSize: 11),
              ),
              trailing: Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(
                  color: isCrit ? const Color(0xFFFEE2E2) : const Color(0xFFD1FAE5),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Text(
                  '$cur ${it['unit']}',
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w800,
                    color: isCrit ? const Color(0xFFB91C1C) : const Color(0xFF065F46),
                  ),
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}

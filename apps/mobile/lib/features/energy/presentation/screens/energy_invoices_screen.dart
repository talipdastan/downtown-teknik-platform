import 'dart:typed_data';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import 'package:avm_tech_platform/core/auth/auth_provider.dart';
import 'package:avm_tech_platform/core/equipment/equipment_model.dart';
import 'package:avm_tech_platform/core/equipment/equipment_providers.dart';
import 'package:avm_tech_platform/core/network/api_client.dart';
import 'package:avm_tech_platform/core/permissions/permission_models.dart';
import 'package:avm_tech_platform/core/theme/app_theme.dart';
import 'package:avm_tech_platform/core/utils/error_utils.dart';
import 'package:avm_tech_platform/core/widgets/common_widgets.dart';
import 'package:avm_tech_platform/features/energy/data/models/budget_model.dart';
import 'package:avm_tech_platform/features/energy/data/models/invoice_model.dart';
import 'package:avm_tech_platform/features/energy/data/models/meter_model.dart';
import 'package:avm_tech_platform/features/energy/providers/energy_providers.dart';
import 'package:avm_tech_platform/features/energy/presentation/widgets/energy_report_wizard_sheet.dart';
import 'package:avm_tech_platform/features/energy/services/budget_parser_service.dart';
import 'package:avm_tech_platform/features/energy/services/energy_excel_service.dart';
import 'package:avm_tech_platform/features/energy/services/invoice_parser_service.dart';

/// 4 Sekmeli Fatura & Bütçe Ekranı:
/// 1. Fatura Tablosu & Ceza Özeti
/// 2. PDF Fatura Analizi (Gemini Edge Function + Çakışma Yönetimi)
/// 3. Sayaç Kimlik (EIC/Tekil/SayaçNo) & Ortak Ekipman Eşleştirme
/// 4. Bütçe & Geçmiş Yıl Karşılaştırma (Excel/CSV/PDF İçe Aktarma)
class EnergyInvoicesScreen extends ConsumerStatefulWidget {
  final int initialTab;

  const EnergyInvoicesScreen({super.key, this.initialTab = 0});

  @override
  ConsumerState<EnergyInvoicesScreen> createState() =>
      _EnergyInvoicesScreenState();
}

class _EnergyInvoicesScreenState extends ConsumerState<EnergyInvoicesScreen>
    with SingleTickerProviderStateMixin {
  late final TabController _tabController;
  int _selectedYear = DateTime.now().year;
  int _selectedMonth = 0; // 0 = Tüm Yıl
  int _budgetMonth = 0; // 0 = Tüm Yıl, 1..12 = Ocak..Aralık
  String _budgetUtilityFilter = 'all'; // 'all' | 'electric' | 'gas' | 'water'
  bool _fastMode = true;
  bool _onlyRegistered = true;
  bool _parsingPdf = false;
  bool _savingDrafts = false;
  bool _importingBudget = false;
  List<ParsedInvoiceDraft> _drafts = [];
  String? _statusMsg;

  static const _months = [
    'Tüm Yıl', 'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
    'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
  ];

  static String _utilityLabel(String type) {
    switch (type.toLowerCase()) {
      case 'electric':
        return 'Elektrik';
      case 'gas':
        return 'Doğalgaz';
      case 'water':
        return 'Su';
      default:
        return type;
    }
  }

  static IconData _utilityIcon(String type) {
    switch (type.toLowerCase()) {
      case 'electric':
        return Icons.bolt_rounded;
      case 'gas':
        return Icons.local_fire_department_rounded;
      case 'water':
        return Icons.water_drop_rounded;
      default:
        return Icons.analytics_outlined;
    }
  }

  static Color _utilityColor(String type) {
    switch (type.toLowerCase()) {
      case 'electric':
        return AppColors.priorityHigh;
      case 'gas':
        return AppColors.priorityUrgent;
      case 'water':
        return AppColors.statusNew;
      default:
        return AppColors.primaryNavy;
    }
  }

  static Color _utilitySoftBg(String type) {
    switch (type.toLowerCase()) {
      case 'electric':
        return AppColors.electricSoft;
      case 'gas':
        return AppColors.gasSoft;
      case 'water':
        return AppColors.waterSoft;
      default:
        return AppColors.primarySoft;
    }
  }

  final _tlFmt = NumberFormat('#,##0.00', 'tr_TR');
  final _numFmt = NumberFormat('#,##0.##', 'tr_TR');

  @override
  void initState() {
    super.initState();
    _tabController = TabController(
      length: 4,
      initialIndex: widget.initialTab.clamp(0, 3),
      vsync: this,
    );
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  Future<void> _pickAndParseInvoices(
    List<MeterModel> meters,
    List<EnergyInvoiceModel> historical,
  ) async {
    final res = await FilePicker.platform.pickFiles(
      type: FileType.custom,
      allowedExtensions: ['pdf'],
      withData: true,
    );
    if (res == null || res.files.isEmpty) return;
    final bytes = res.files.first.bytes;
    if (bytes == null) return;

    setState(() {
      _parsingPdf = true;
      _statusMsg = 'PDF sunucuya gönderiliyor...';
    });

    try {
      int skipped = 0;
      final parsed = await InvoiceParserService.parsePdfViaEdge(
        pdfBytes: bytes,
        existingMeters: meters,
        historicalInvoices: historical,
        fastMode: _fastMode,
        onlyRegisteredMeters: _onlyRegistered,
        onUnregisteredSkipped: (c) => skipped = c,
      );
      if (!mounted) return;
      setState(() {
        _drafts = parsed;
        _statusMsg = skipped > 0
            ? '${parsed.length} fatura çıkarıldı ($skipped harici fatura atlandı).'
            : '${parsed.length} fatura çıkarıldı.';
      });
    } catch (e) {
      if (mounted) showAppSnack(context, friendlyError(e), error: true);
    } finally {
      if (mounted) setState(() => _parsingPdf = false);
    }
  }

  Future<void> _saveSelectedDrafts(List<EnergyInvoiceModel> existing) async {
    final profile = ref.read(authProvider).profile;
    if (profile == null) return;
    final selected = _drafts.where((d) => d.isSelected).toList();
    if (selected.isEmpty) return;

    final unresolved = selected
        .where((d) => d.hasMeterConflict && d.conflictAction == 'unset')
        .toList();
    if (unresolved.isNotEmpty) {
      showAppSnack(
        context,
        'Çakışan ${unresolved.length} fatura için lütfen aksiyon seçiniz (Birleştir / Ayrı / Üzerine Yaz / Atla).',
        error: true,
      );
      return;
    }

    setState(() => _savingDrafts = true);
    try {
      // 'merge' seçilen aynı grup anahtarlarını birleştir
      final mergedBuckets = <String, ParsedInvoiceDraft>{};
      final directList = <ParsedInvoiceDraft>[];

      for (final d in selected) {
        if (d.conflictAction == 'skip') continue;
        if (d.conflictAction == 'merge') {
          final key = '${d.year}_${d.month}_${d.primaryGroupKey}';
          final cur = mergedBuckets[key];
          if (cur == null) {
            mergedBuckets[key] = d;
          } else {
            cur.consumption += d.consumption;
            cur.amountTL += d.amountTL;
            cur.inductivePenaltyTL += d.inductivePenaltyTL;
            cur.capacitivePenaltyTL += d.capacitivePenaltyTL;
          }
        } else {
          directList.add(d);
        }
      }

      final toSave = [...mergedBuckets.values, ...directList];
      for (final d in toSave) {
        if (d.conflictAction == 'overwrite') {
          final oldIds = existing
              .where((inv) =>
                  inv.periodYear == d.year &&
                  inv.periodMonth == d.month &&
                  inv.primaryIdentifier == d.primaryGroupKey)
              .map((inv) => inv.id)
              .toList();
          if (oldIds.isNotEmpty) {
            await Api.client.from('energy_invoices').delete().inFilter('id', oldIds);
          }
        }
        await Api.client.from('energy_invoices').insert(
              d.toInsertJson(
                enteredById: profile.id,
                enteredByName: profile.fullName,
              ),
            );
      }

      ref.invalidate(energyInvoicesProvider(_selectedYear));
      if (!mounted) return;
      setState(() => _drafts = []);
      showAppSnack(context, '${toSave.length} fatura kaydedildi.');
      _tabController.animateTo(0);
    } catch (e) {
      if (mounted) showAppSnack(context, friendlyError(e), error: true);
    } finally {
      if (mounted) setState(() => _savingDrafts = false);
    }
  }

  Future<void> _importBudgetFile() async {
    final res = await FilePicker.platform.pickFiles(
      type: FileType.custom,
      allowedExtensions: ['xlsx', 'xls', 'csv', 'pdf'],
      withData: true,
    );
    if (res == null || res.files.isEmpty) return;
    final file = res.files.first;
    final bytes = file.bytes;
    if (bytes == null) return;

    setState(() => _importingBudget = true);
    try {
      final parsed = await BudgetParserService.parseBudgetFile(
        bytes: bytes,
        fileName: file.name,
        targetYear: _selectedYear,
      );
      if (parsed.isEmpty) {
        if (mounted) {
          showAppSnack(context, 'Dosyada uygun bütçe verisi bulunamadı.', error: true);
        }
        return;
      }

      final uid = ref.read(authProvider).profile?.id;
      await Api.client.from('energy_budgets').upsert(
            parsed.map((b) => b.toUpsertJson(updatedById: uid)).toList(),
            onConflict: 'period_year,period_month,utility_type',
          );
      ref.invalidate(energyBudgetsProvider(_selectedYear));
        if (mounted) {
        showAppSnack(context, '${parsed.length} aylık bütçe kaydı aktarıldı.');
      }
    } catch (e) {
      if (mounted) showAppSnack(context, friendlyError(e), error: true);
    } finally {
      if (mounted) setState(() => _importingBudget = false);
    }
  }

  Future<void> _deleteInvoice(EnergyInvoiceModel inv) async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Faturayı Sil'),
        content: Text(
          '${inv.meterName} (${_months[inv.periodMonth]} ${inv.periodYear} - ${_tlFmt.format(inv.amountTL)} ₺) faturasını silmek istediğinize emin misiniz?',
        ),
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
      await Api.client.from('energy_invoices').delete().eq('id', inv.id);
      ref.invalidate(energyInvoicesProvider(_selectedYear));
      if (mounted) showAppSnack(context, 'Fatura silindi.');
    } catch (e) {
      if (mounted) showAppSnack(context, friendlyError(e), error: true);
    }
  }

  Future<void> _openBudgetFormDialog({EnergyBudgetModel? existing}) async {
    String uType = existing?.utilityType ??
        (_budgetUtilityFilter == 'all' ? 'electric' : _budgetUtilityFilter);
    final int bYear = existing?.periodYear ?? _selectedYear;
    int bMonth = existing?.periodMonth ?? (_budgetMonth > 0 ? _budgetMonth : DateTime.now().month);
    final qtyCtrl = TextEditingController(
      text: existing != null ? existing.budgetConsumption.toString() : '',
    );
    final tlCtrl = TextEditingController(
      text: existing != null ? existing.budgetTL.toString() : '',
    );
    final prevQtyCtrl = TextEditingController(
      text: existing != null ? existing.prevYearConsumption.toString() : '0',
    );
    final prevTlCtrl = TextEditingController(
      text: existing != null ? existing.prevYearTL.toString() : '0',
    );

    final saved = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialog) => AlertDialog(
          title: Text(existing != null ? 'Bütçe Kaydını Düzenle' : 'Yeni Bütçe Ekle'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                DropdownButtonFormField<String>(
                  initialValue: uType,
                  decoration: const InputDecoration(labelText: 'Enerji Türü'),
                  items: const [
                    DropdownMenuItem(value: 'electric', child: Text('Elektrik')),
                    DropdownMenuItem(value: 'gas', child: Text('Doğalgaz')),
                    DropdownMenuItem(value: 'water', child: Text('Su')),
                  ],
                  onChanged: (v) {
                    if (v != null) setDialog(() => uType = v);
                  },
                ),
                const SizedBox(height: 8),
                DropdownButtonFormField<int>(
                  initialValue: bMonth,
                  decoration: const InputDecoration(labelText: 'Ay'),
                  items: List.generate(
                    12,
                    (i) => DropdownMenuItem(value: i + 1, child: Text(_months[i + 1])),
                  ),
                  onChanged: (v) {
                    if (v != null) setDialog(() => bMonth = v);
                  },
                ),
                const SizedBox(height: 8),
                TextField(
                  controller: qtyCtrl,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  decoration: InputDecoration(
                    labelText: 'Bütçe Miktar (${uType == 'electric' ? 'kWh' : 'm³'})',
                  ),
                ),
                const SizedBox(height: 8),
                TextField(
                  controller: tlCtrl,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  decoration: const InputDecoration(labelText: 'Bütçe (TL)'),
                ),
                const SizedBox(height: 8),
                TextField(
                  controller: prevQtyCtrl,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  decoration: InputDecoration(
                    labelText: 'Önceki Yıl Miktar (${uType == 'electric' ? 'kWh' : 'm³'})',
                  ),
                ),
                const SizedBox(height: 8),
                TextField(
                  controller: prevTlCtrl,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  decoration: const InputDecoration(labelText: 'Önceki Yıl (TL)'),
                ),
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
                final uid = ref.read(authProvider).profile?.id;
                double parseD(TextEditingController c) =>
                    double.tryParse(c.text.trim().replaceAll(',', '.')) ?? 0.0;
                final payload = {
                  'period_year': bYear,
                  'period_month': bMonth,
                  'utility_type': uType,
                  'budget_consumption': parseD(qtyCtrl),
                  'budget_tl': parseD(tlCtrl),
                  'prev_year_consumption': parseD(prevQtyCtrl),
                  'prev_year_tl': parseD(prevTlCtrl),
                  if (uid != null) 'updated_by_id': uid,
                };
                try {
                  if (existing?.id != null) {
                    await Api.client
                        .from('energy_budgets')
                        .update(payload)
                        .eq('id', existing!.id!);
                  } else {
                    await Api.client.from('energy_budgets').upsert(
                          payload,
                          onConflict: 'period_year,period_month,utility_type',
                        );
                  }
                  if (ctx.mounted) Navigator.pop(ctx, true);
                } catch (e) {
                  if (ctx.mounted) showAppSnack(ctx, friendlyError(e), error: true);
                }
              },
              child: const Text('Kaydet'),
            ),
          ],
        ),
      ),
    );
    qtyCtrl.dispose();
    tlCtrl.dispose();
    prevQtyCtrl.dispose();
    prevTlCtrl.dispose();

    if (saved == true) {
      ref.invalidate(energyBudgetsProvider(_selectedYear));
      if (mounted) {
        showAppSnack(
          context,
          existing != null ? 'Bütçe kaydı güncellendi.' : 'Bütçe kaydı eklendi.',
        );
      }
    }
  }

  Future<void> _deleteBudget(EnergyBudgetModel b) async {
    if (b.id == null) return;
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Bütçe Kaydını Sil'),
        content: Text(
          '${_utilityLabel(b.utilityType)} – ${_months[b.periodMonth]} ${b.periodYear} bütçe kaydını silmek istiyor musunuz?',
        ),
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
      await Api.client.from('energy_budgets').delete().eq('id', b.id!);
      ref.invalidate(energyBudgetsProvider(_selectedYear));
      if (mounted) showAppSnack(context, 'Bütçe kaydı silindi.');
    } catch (e) {
      if (mounted) showAppSnack(context, friendlyError(e), error: true);
    }
  }

  Future<void> _editMeterConfig(MeterModel m) async {
    final meterNoCtrl = TextEditingController(text: m.meterNo ?? '');
    final contractCtrl = TextEditingController(text: m.contractNo ?? '');
    final eicCtrl = TextEditingController(text: m.eicCode ?? '');
    final tekilCtrl = TextEditingController(text: m.tekilCode ?? '');
    final subCtrl = TextEditingController(text: m.subscriberNo ?? '');
    String? equipmentId = m.equipmentId;

    final saved = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialog) {
          final eqs =
              ref.read(equipmentOptionsProvider).valueOrNull ?? const <EquipmentModel>[];
          return AlertDialog(
            title: Text('${m.name} Kimlik & Ekipman'),
            content: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  TextField(
                    controller: eicCtrl,
                    decoration: const InputDecoration(labelText: 'EIC Kodu'),
                  ),
                  const SizedBox(height: 8),
                  TextField(
                    controller: tekilCtrl,
                    decoration: const InputDecoration(labelText: 'Tekil Kod'),
                  ),
                  const SizedBox(height: 8),
                  TextField(
                    controller: meterNoCtrl,
                    decoration: const InputDecoration(labelText: 'Sayaç No'),
                  ),
                  const SizedBox(height: 8),
                  TextField(
                    controller: contractCtrl,
                    decoration: const InputDecoration(labelText: 'Sözleşme No'),
                  ),
                  const SizedBox(height: 8),
                  TextField(
                    controller: subCtrl,
                    decoration: const InputDecoration(labelText: 'Abone No'),
                  ),
                  if (eqs.isNotEmpty) ...[
                    const SizedBox(height: 10),
                    DropdownButtonFormField<String?>(
                      initialValue: equipmentId,
                      isExpanded: true,
                      decoration: const InputDecoration(labelText: 'Bağlı Ekipman'),
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
                      onChanged: (v) => setDialog(() => equipmentId = v),
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
                  String? opt(TextEditingController c) =>
                      c.text.trim().isEmpty ? null : c.text.trim();
                  try {
                    await Api.client.from('meters').update({
                      'eic_code': opt(eicCtrl)?.toUpperCase(),
                      'tekil_code': opt(tekilCtrl),
                      'meter_no': opt(meterNoCtrl),
                      'contract_no': opt(contractCtrl),
                      'subscriber_no': opt(subCtrl),
                      'equipment_id': equipmentId,
                    }).eq('id', m.id);
                    if (ctx.mounted) Navigator.pop(ctx, true);
                  } catch (e) {
                    if (ctx.mounted) showAppSnack(ctx, friendlyError(e), error: true);
                  }
                },
                child: const Text('Kaydet'),
              ),
            ],
          );
        },
      ),
    );
    meterNoCtrl.dispose();
    contractCtrl.dispose();
    eicCtrl.dispose();
    tekilCtrl.dispose();
    subCtrl.dispose();

    if (saved == true) {
      ref.invalidate(metersProvider(null));
      if (mounted) showAppSnack(context, 'Sayaç kimliği güncellendi.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final profile = ref.watch(authProvider).profile;
    final canManage =
        profile?.hasModulePermission('energy', ModulePermission.manage) ?? false;
    final metersAsync = ref.watch(metersProvider(null));
    final invoicesAsync = ref.watch(energyInvoicesProvider(_selectedYear));
    final budgetsAsync = ref.watch(energyBudgetsProvider(_selectedYear));

    final meters = metersAsync.valueOrNull ?? const <MeterModel>[];
    final invoices = invoicesAsync.valueOrNull ?? const <EnergyInvoiceModel>[];
    final budgets = budgetsAsync.valueOrNull ?? const <EnergyBudgetModel>[];

    return Scaffold(
      appBar: AppBar(
        title: const Text('Faturalar & Bütçe'),
        bottom: TabBar(
          controller: _tabController,
          labelColor: AppColors.primaryNavy,
          unselectedLabelColor: AppColors.textSecondary,
          indicatorColor: AppColors.accentTurquoise,
          isScrollable: true,
          tabAlignment: TabAlignment.start,
          tabs: const [
            Tab(icon: Icon(Icons.receipt_long_outlined), text: 'Tablo'),
            Tab(icon: Icon(Icons.picture_as_pdf_outlined), text: 'PDF Okut'),
            Tab(icon: Icon(Icons.tune_outlined), text: 'Sayaçlar'),
            Tab(icon: Icon(Icons.analytics_outlined), text: 'Bütçe'),
          ],
        ),
      ),
      body: SafeArea(
        top: false,
        child: TabBarView(
          controller: _tabController,
          children: [
            _buildTableTab(invoices, budgets, meters, canManage),
            _buildPdfTab(meters, invoices, canManage),
            _buildMetersConfigTab(meters, canManage),
            _buildBudgetTab(invoices, budgets, meters, canManage),
          ],
        ),
      ),
    );
  }

  Widget _buildTableTab(
    List<EnergyInvoiceModel> yearInvoices,
    List<EnergyBudgetModel> budgets,
    List<MeterModel> meters,
    bool canManage,
  ) {
    final filtered = _selectedMonth == 0
        ? yearInvoices
        : yearInvoices.where((i) => i.periodMonth == _selectedMonth).toList();

    return ListView(
      padding: const EdgeInsets.all(10),
      children: [
        Card(
          child: Padding(
            padding: const EdgeInsets.all(10),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: DropdownButtonFormField<int>(
                        initialValue: _selectedYear,
                        decoration: const InputDecoration(
                          labelText: 'Yıl',
                          isDense: true,
                        ),
                        items: [
                          for (int y = DateTime.now().year - 2;
                              y <= DateTime.now().year + 1;
                              y++)
                            DropdownMenuItem(value: y, child: Text('$y')),
                        ],
                        onChanged: (v) {
                          if (v != null) setState(() => _selectedYear = v);
                        },
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      flex: 2,
                      child: DropdownButtonFormField<int>(
                        initialValue: _selectedMonth,
                        decoration: const InputDecoration(
                          labelText: 'Dönem (Ay)',
                          isDense: true,
                        ),
                        items: [
                          for (int m = 0; m <= 12; m++)
                            DropdownMenuItem(value: m, child: Text(_months[m])),
                        ],
                        onChanged: (v) {
                          if (v != null) setState(() => _selectedMonth = v);
                        },
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                Row(
                  children: [
                    Expanded(
                      flex: 3,
                      child: FilledButton.icon(
                        onPressed: (yearInvoices.isEmpty && budgets.isEmpty)
                            ? null
                            : () => showEnergyReportWizardSheet(
                                  context,
                                  initialYear: _selectedYear,
                                  initialMonth: _selectedMonth,
                                  initialPreset: 'executive',
                                  invoices: yearInvoices,
                                  budgets: budgets,
                                  meters: meters,
                                ),
                        icon: const Icon(Icons.tune_rounded, size: 17),
                        label: const Text(
                          'Rapor Sihirbazı',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      flex: 2,
                      child: OutlinedButton.icon(
                        onPressed: yearInvoices.isEmpty
                            ? null
                            : () => EnergyExcelService.exportMonthlyInvoicesReport(
                                  context,
                                  year: _selectedYear,
                                  invoices: yearInvoices,
                                  budgets: budgets,
                                ),
                        icon: const Icon(Icons.download_outlined, size: 17),
                        label: const Text(
                          'Hızlı Excel',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 12),
        if (filtered.isEmpty)
          const Card(
            child: Padding(
              padding: EdgeInsets.all(24),
              child: Center(child: Text('Seçili dönem için fatura yok.')),
            ),
          )
        else
          ...filtered.map(
            (inv) => Card(
              margin: const EdgeInsets.only(bottom: 10),
              child: ListTile(
                title: Text(
                  '${inv.meterName} (${_months[inv.periodMonth]})',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontWeight: FontWeight.bold),
                ),
                subtitle: Text(
                  '${inv.provider} · ${_numFmt.format(inv.consumption)} '
                  '${inv.utilityType == 'electric' ? 'kWh' : 'm³'}'
                  '${inv.utilityType == 'electric' && inv.totalPenaltyTL > 0 ? ' · Ceza: ${_tlFmt.format(inv.totalPenaltyTL)} ₺' : ''}',
                ),
                trailing: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      '${_tlFmt.format(inv.amountTL)} ₺',
                      style: const TextStyle(
                        fontWeight: FontWeight.bold,
                        color: AppColors.primaryNavy,
                      ),
                    ),
                    if (canManage)
                      IconButton(
                        visualDensity: VisualDensity.compact,
                        constraints: const BoxConstraints(
                          minWidth: 32,
                          minHeight: 32,
                        ),
                        padding: EdgeInsets.zero,
                        tooltip: 'Faturayı Sil',
                        icon: const Icon(
                          Icons.delete_outline,
                          color: AppColors.priorityUrgent,
                          size: 20,
                        ),
                        onPressed: () => _deleteInvoice(inv),
                      ),
                  ],
                ),
              ),
            ),
          ),
      ],
    );
  }

  Widget _buildPdfTab(
    List<MeterModel> meters,
    List<EnergyInvoiceModel> existing,
    bool canManage,
  ) {
    if (!canManage) {
      return const Center(
        child: Text('PDF fatura yükleme için Enerji Yönetim yetkisi gereklidir.'),
      );
    }
    return ListView(
      padding: const EdgeInsets.all(12),
      children: [
        Card(
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Text(
                  'Gemini destekli PDF Fatura Analizi',
                  style: TextStyle(fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 6),
                const Text(
                  'API anahtarı güvenli Supabase Edge Function üzerinde saklanır.',
                  style: TextStyle(fontSize: 12, color: AppColors.textSecondary),
                ),
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  title: const Text('Hızlı Tarama Modu'),
                  value: _fastMode,
                  onChanged: (v) => setState(() => _fastMode = v),
                ),
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  title: const Text('Yalnızca Kayıtlı Sayaçları Al'),
                  value: _onlyRegistered,
                  onChanged: (v) => setState(() => _onlyRegistered = v),
                ),
                const SizedBox(height: 8),
                FilledButton.icon(
                  onPressed: _parsingPdf
                      ? null
                      : () => _pickAndParseInvoices(meters, existing),
                  icon: const Icon(Icons.upload_file_outlined),
                  label: Text(_parsingPdf ? 'Analiz Ediliyor...' : 'PDF Fatura Seç'),
                ),
                if (_statusMsg != null) ...[
                  const SizedBox(height: 8),
                  Text(_statusMsg!, style: const TextStyle(fontSize: 12)),
                ],
              ],
            ),
          ),
        ),
        const SizedBox(height: 12),
        for (final d in _drafts)
          Card(
            margin: const EdgeInsets.only(bottom: 10),
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  CheckboxListTile(
                    contentPadding: EdgeInsets.zero,
                    value: d.isSelected,
                    onChanged: (v) => setState(() => d.isSelected = v ?? true),
                    title: Text(
                      '${d.meterName} (${d.month}/${d.year})',
                      style: const TextStyle(fontWeight: FontWeight.bold),
                    ),
                    subtitle: Text(
                      '${d.provider} · ${_numFmt.format(d.consumption)} · ${_tlFmt.format(d.amountTL)} ₺',
                    ),
                  ),
                  if (d.warningMessage != null)
                    Text(
                      d.warningMessage!,
                      style: const TextStyle(
                        fontSize: 12,
                        color: AppColors.priorityHigh,
                      ),
                    ),
                  if (d.hasMeterConflict) ...[
                    const SizedBox(height: 6),
                    Text(
                      d.conflictMessage ?? 'Çakışma tespit edildi.',
                      style: const TextStyle(
                        fontSize: 12,
                        color: AppColors.priorityUrgent,
                      ),
                    ),
                    const SizedBox(height: 6),
                    DropdownButtonFormField<String>(
                      initialValue: d.conflictAction,
                      decoration:
                          const InputDecoration(labelText: 'Çakışma Kararı'),
                      items: const [
                        DropdownMenuItem(value: 'unset', child: Text('Seçiniz...')),
                        DropdownMenuItem(value: 'merge', child: Text('Birleştir')),
                        DropdownMenuItem(
                            value: 'separate', child: Text('Ayrı Kaydet')),
                        DropdownMenuItem(
                            value: 'overwrite', child: Text('Üzerine Yaz')),
                        DropdownMenuItem(value: 'skip', child: Text('Atla')),
                      ],
                      onChanged: (v) {
                        if (v != null) setState(() => d.conflictAction = v);
                      },
                    ),
                  ],
                ],
              ),
            ),
          ),
        if (_drafts.isNotEmpty)
          FilledButton(
            onPressed: _savingDrafts ? null : () => _saveSelectedDrafts(existing),
            child: Text(
              _savingDrafts ? 'Kaydediliyor...' : 'Seçili Faturaları Kaydet',
            ),
          ),
      ],
    );
  }

  Widget _buildMetersConfigTab(List<MeterModel> meters, bool canManage) {
    return ListView.builder(
      padding: const EdgeInsets.all(12),
      itemCount: meters.length,
      itemBuilder: (_, i) {
        final m = meters[i];
        return Card(
          margin: const EdgeInsets.only(bottom: 10),
          child: ListTile(
            title: Text(m.name, style: const TextStyle(fontWeight: FontWeight.bold)),
            subtitle: Text(
              [
                if (m.eicCode != null) 'EIC: ${m.eicCode}',
                if (m.meterNo != null) 'Sayaç: ${m.meterNo}',
                if (m.equipmentName != null) 'Ekipman: ${m.equipmentName}',
              ].join(' · '),
            ),
            trailing: canManage
                ? IconButton(
                    icon: const Icon(Icons.edit_outlined),
                    onPressed: () => _editMeterConfig(m),
                  )
                : null,
          ),
        );
      },
    );
  }

  Widget _buildBudgetTab(
    List<EnergyInvoiceModel> invoices,
    List<EnergyBudgetModel> budgets,
    List<MeterModel> meters,
    bool canManage,
  ) {
    final currentYear = DateTime.now().year;
    final years = [currentYear - 2, currentYear - 1, currentYear, currentYear + 1];
    final filteredBudgets = budgets.where((b) {
      if (_budgetMonth != 0 && b.periodMonth != _budgetMonth) return false;
      if (_budgetUtilityFilter != 'all' &&
          b.utilityType != _budgetUtilityFilter) {
        return false;
      }
      return true;
    }).toList()
      ..sort((a, b) {
        final cmp = a.periodMonth.compareTo(b.periodMonth);
        return cmp != 0 ? cmp : a.utilityType.compareTo(b.utilityType);
      });

    return ListView(
      padding: const EdgeInsets.fromLTRB(12, 12, 12, 16),
      children: [
        // Dönem Seçici (Yıl + Ay)
        Card(
          child: Padding(
            padding: const EdgeInsets.all(10),
            child: Row(
              children: [
                Expanded(
                  child: DropdownButtonFormField<int>(
                    initialValue: years.contains(_selectedYear)
                        ? _selectedYear
                        : currentYear,
                    decoration: const InputDecoration(labelText: 'Yıl'),
                    items: years
                        .map((y) => DropdownMenuItem(value: y, child: Text('$y')))
                        .toList(),
                    onChanged: (v) {
                      if (v != null) setState(() => _selectedYear = v);
                    },
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  flex: 2,
                  child: DropdownButtonFormField<int>(
                    initialValue: _budgetMonth,
                    decoration: const InputDecoration(labelText: 'Dönem (Ay)'),
                    items: List.generate(
                      _months.length,
                      (idx) => DropdownMenuItem(
                        value: idx,
                        child: Text(_months[idx]),
                      ),
                    ),
                    onChanged: (v) {
                      if (v != null) setState(() => _budgetMonth = v);
                    },
                  ),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 8),

        // Türkçe Tür Filtre Çipleri
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: Row(
            children: [
              for (final entry in const [
                ('all', 'Tümü'),
                ('electric', 'Elektrik'),
                ('gas', 'Doğalgaz'),
                ('water', 'Su'),
              ]) ...[
                ChoiceChip(
                  label: Text(
                    entry.$2,
                    style: TextStyle(
                      color: _budgetUtilityFilter == entry.$1
                          ? Colors.white
                          : AppColors.textPrimary,
                      fontWeight: FontWeight.w700,
                      fontSize: 12,
                    ),
                  ),
                  selected: _budgetUtilityFilter == entry.$1,
                  backgroundColor: AppColors.white,
                  selectedColor: AppColors.primaryNavy,
                  checkmarkColor: Colors.white,
                  side: BorderSide(
                    color: _budgetUtilityFilter == entry.$1
                        ? AppColors.primaryNavy
                        : AppColors.border,
                  ),
                  onSelected: (_) =>
                      setState(() => _budgetUtilityFilter = entry.$1),
                ),
                const SizedBox(width: 6),
              ],
            ],
          ),
        ),
        const SizedBox(height: 8),

        Card(
          child: Padding(
            padding: const EdgeInsets.all(10),
            child: Row(
              children: [
                Expanded(
                  child: FilledButton.icon(
                    onPressed: (budgets.isEmpty && invoices.isEmpty)
                        ? null
                        : () => showEnergyReportWizardSheet(
                              context,
                              initialYear: _selectedYear,
                              initialMonth: _budgetMonth,
                              initialUtilityFilter: _budgetUtilityFilter,
                              initialPreset: 'budget_matrix',
                              invoices: invoices,
                              budgets: budgets,
                              meters: meters,
                            ),
                    icon: const Icon(Icons.tune_rounded, size: 18),
                    label: const Text(
                      'Rapor Sihirbazı (Tarih & Veri Seç)',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                OutlinedButton.icon(
                  onPressed: (budgets.isEmpty && invoices.isEmpty)
                      ? null
                      : () => EnergyExcelService.exportMonthlyInvoicesReport(
                            context,
                            year: _selectedYear,
                            invoices: invoices,
                            budgets: budgets,
                            config: EnergyReportExportConfig.defaults(
                              year: _selectedYear,
                              selectedMonth: _budgetMonth,
                              utilityFilter: _budgetUtilityFilter,
                              preset: 'budget_matrix',
                            ),
                          ),
                  icon: const Icon(Icons.download_outlined, size: 18),
                  label: const Text('Matris Excel'),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 8),

        if (canManage)
          Card(
            child: Padding(
              padding: const EdgeInsets.all(10),
              child: Column(
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: FilledButton.icon(
                          onPressed: _importingBudget ? null : _importBudgetFile,
                          icon: const Icon(Icons.upload_outlined, size: 18),
                          label: Text(
                            _importingBudget ? 'Aktarılıyor...' : 'Bütçe Yükle',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: OutlinedButton.icon(
                          onPressed: () {
                            final bytes =
                                BudgetParserService.generateSampleBudgetExcel(
                                    _selectedYear);
                            EnergyExcelService.shareOrDownloadExcel(
                              bytes: Uint8List.fromList(bytes),
                              fileName: 'Ornek_Butce_Sablonu_$_selectedYear.xlsx',
                              text: 'Örnek Bütçe Şablonu',
                            );
                          },
                          icon: const Icon(Icons.table_view_outlined, size: 18),
                          label: const Text(
                            'Örnek Şablon',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  SizedBox(
                    width: double.infinity,
                    child: OutlinedButton.icon(
                      onPressed: () => _openBudgetFormDialog(),
                      icon: const Icon(Icons.add_rounded, size: 18),
                      label: const Text('Manuel Bütçe Ekle'),
                    ),
                  ),
                ],
              ),
            ),
          ),
        const SizedBox(height: 10),
        if (filteredBudgets.isEmpty)
          Card(
            child: Padding(
              padding: const EdgeInsets.all(20),
              child: Center(
                child: Text(
                  'Seçili dönem ($_selectedYear · ${_months[_budgetMonth]}) için bütçe kaydı yok.',
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: AppColors.textSecondary),
                ),
              ),
            ),
          )
        else
          ...filteredBudgets.map((b) {
            final matchingInvoices = invoices.where((i) =>
                i.utilityType == b.utilityType &&
                i.periodMonth == b.periodMonth);
            final actualTL =
                matchingInvoices.fold<double>(0, (s, e) => s + e.commonAmountTL);
            final actualQty = matchingInvoices.fold<double>(
                0, (s, e) => s + e.commonConsumption);
            final unit = b.utilityType == 'electric' ? 'kWh' : 'm³';
            final tlPct = EnergyBudgetModel.variancePercent(actualTL, b.budgetTL);
            final qtyPct = EnergyBudgetModel.variancePercent(
                actualQty, b.budgetConsumption);
            return Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Card(
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Container(
                            width: 34,
                            height: 34,
                            decoration: BoxDecoration(
                              color: _utilitySoftBg(b.utilityType),
                              borderRadius: BorderRadius.circular(10),
                            ),
                            child: Icon(
                              _utilityIcon(b.utilityType),
                              color: _utilityColor(b.utilityType),
                              size: 18,
                            ),
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Text(
                              '${_utilityLabel(b.utilityType)} – ${_months[b.periodMonth]} $_selectedYear',
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                fontWeight: FontWeight.w800,
                                fontSize: 13.5,
                              ),
                            ),
                          ),
                          if (tlPct != null) ...[
                            const SizedBox(width: 4),
                            StatusChip(
                              label:
                                  '${tlPct >= 0 ? '+' : ''}${tlPct.toStringAsFixed(1)}%',
                              color: tlPct > 0
                                  ? AppColors.priorityUrgent
                                  : AppColors.statusResolved,
                            ),
                          ],
                          if (canManage) ...[
                            IconButton(
                              visualDensity: VisualDensity.compact,
                              constraints: const BoxConstraints(
                                minWidth: 32,
                                minHeight: 32,
                              ),
                              padding: EdgeInsets.zero,
                              tooltip: 'Düzenle',
                              icon: const Icon(Icons.edit_outlined, size: 18),
                              onPressed: () =>
                                  _openBudgetFormDialog(existing: b),
                            ),
                            IconButton(
                              visualDensity: VisualDensity.compact,
                              constraints: const BoxConstraints(
                                minWidth: 32,
                                minHeight: 32,
                              ),
                              padding: EdgeInsets.zero,
                              tooltip: 'Sil',
                              icon: const Icon(
                                Icons.delete_outline,
                                size: 18,
                                color: AppColors.priorityUrgent,
                              ),
                              onPressed: () => _deleteBudget(b),
                            ),
                          ],
                        ],
                      ),
                      const SizedBox(height: 8),
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              'Miktar: ${_numFmt.format(b.budgetConsumption)} $unit\nGerçek: ${_numFmt.format(actualQty)} $unit${qtyPct != null ? ' (${qtyPct >= 0 ? '+' : ''}${qtyPct.toStringAsFixed(1)}%)' : ''}',
                              style: const TextStyle(
                                fontSize: 11.5,
                                color: AppColors.textSecondary,
                                height: 1.35,
                              ),
                            ),
                          ),
                          Expanded(
                            child: Text(
                              'Bütçe: ${_tlFmt.format(b.budgetTL)} ₺\nGerçek: ${_tlFmt.format(actualTL)} ₺',
                              textAlign: TextAlign.right,
                              style: const TextStyle(
                                fontSize: 12,
                                fontWeight: FontWeight.w700,
                                color: AppColors.textPrimary,
                                height: 1.35,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
            );
          }),
      ],
    );
  }
}

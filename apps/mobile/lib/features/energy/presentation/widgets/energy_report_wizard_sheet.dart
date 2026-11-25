import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import 'package:avm_tech_platform/core/theme/app_theme.dart';
import 'package:avm_tech_platform/features/energy/data/models/budget_model.dart';
import 'package:avm_tech_platform/features/energy/data/models/invoice_model.dart';
import 'package:avm_tech_platform/features/energy/data/models/meter_model.dart';
import 'package:avm_tech_platform/features/energy/services/energy_excel_service.dart';

Future<void> showEnergyReportWizardSheet(
  BuildContext context, {
  required int initialYear,
  int initialMonth = 0,
  String initialUtilityFilter = 'all',
  String initialPreset = 'executive',
  required List<EnergyInvoiceModel> invoices,
  required List<EnergyBudgetModel> budgets,
  List<MeterModel> meters = const [],
}) async {
  await showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    backgroundColor: AppColors.white,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(22)),
    ),
    builder: (ctx) => _EnergyReportWizardSheet(
      initialYear: initialYear,
      initialMonth: initialMonth,
      initialUtilityFilter: initialUtilityFilter,
      initialPreset: initialPreset,
      invoices: invoices,
      budgets: budgets,
      meters: meters,
    ),
  );
}

class _EnergyReportWizardSheet extends StatefulWidget {
  final int initialYear;
  final int initialMonth;
  final String initialUtilityFilter;
  final String initialPreset;
  final List<EnergyInvoiceModel> invoices;
  final List<EnergyBudgetModel> budgets;
  final List<MeterModel> meters;

  const _EnergyReportWizardSheet({
    required this.initialYear,
    required this.initialMonth,
    required this.initialUtilityFilter,
    required this.initialPreset,
    required this.invoices,
    required this.budgets,
    required this.meters,
  });

  @override
  State<_EnergyReportWizardSheet> createState() =>
      _EnergyReportWizardSheetState();
}

class _EnergyReportWizardSheetState extends State<_EnergyReportWizardSheet> {
  late EnergyReportExportConfig _cfg;
  final _tlFmt = NumberFormat('#,##0.00', 'tr_TR');

  static const _monthNames = [
    'Ocak',
    'Şubat',
    'Mart',
    'Nisan',
    'Mayıs',
    'Haziran',
    'Temmuz',
    'Ağustos',
    'Eylül',
    'Ekim',
    'Kasım',
    'Aralık',
  ];

  @override
  void initState() {
    super.initState();
    _cfg = EnergyReportExportConfig.defaults(
      year: widget.initialYear,
      selectedMonth: widget.initialMonth,
      utilityFilter: widget.initialUtilityFilter,
      preset: widget.initialPreset,
    );
  }

  void _toggleUtility(String u) {
    final current = List<String>.from(_cfg.utilities);
    if (current.contains(u)) {
      if (current.length <= 1) return;
      current.remove(u);
    } else {
      current.add(u);
    }
    setState(() {
      _cfg = _cfg.copyWith(
        utilities: current,
        includeReactivePenalty: current.contains('electric')
            ? _cfg.includeReactivePenalty
            : false,
      );
    });
  }

  @override
  Widget build(BuildContext context) {
    final matchedInvs = _cfg.filterInvoices(widget.invoices);
    final matchedBuds = _cfg.filterBudgets(widget.budgets);

    final grossSum =
        matchedInvs.fold<double>(0, (s, i) => s + i.amountTL);
    final netSum =
        matchedInvs.fold<double>(0, (s, i) => s + i.commonAmountTL);
    final budSum =
        matchedBuds.fold<double>(0, (s, b) => s + b.budgetTL);
    final diffPct = EnergyBudgetModel.variancePercent(netSum, budSum);

    final meterNames = <String>{
      for (final m in widget.meters)
        if (m.name.trim().isNotEmpty) m.name.trim(),
      for (final i in widget.invoices)
        if (i.meterName.trim().isNotEmpty) i.meterName.trim(),
    }.toList()
      ..sort();

    final providers = <String>{
      for (final i in widget.invoices)
        if (i.provider.trim().isNotEmpty) i.provider.trim(),
    }.toList()
      ..sort();

    final hasElectric = _cfg.utilities.contains('electric');

    return DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.88,
      minChildSize: 0.60,
      maxChildSize: 0.96,
      builder: (ctx, scrollCtrl) => Column(
        children: [
          // Üst başlık
          Container(
            padding: const EdgeInsets.fromLTRB(16, 12, 12, 12),
            decoration: const BoxDecoration(
              color: AppColors.primaryNavy,
              borderRadius: BorderRadius.vertical(top: Radius.circular(22)),
            ),
            child: Row(
              children: [
                Container(
                  width: 36,
                  height: 36,
                  decoration: BoxDecoration(
                    color: Colors.white.withValues(alpha: 0.14),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: const Icon(
                    Icons.auto_awesome_rounded,
                    color: Colors.white,
                    size: 20,
                  ),
                ),
                const SizedBox(width: 10),
                const Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'DOWNTOWN TEKNİK · RAPOR SİHİRBAZI',
                        style: TextStyle(
                          fontSize: 10,
                          fontWeight: FontWeight.w800,
                          color: Colors.cyanAccent,
                          letterSpacing: 0.5,
                        ),
                      ),
                      Text(
                        'Fatura & Bütçe Raporu Özelleştirme',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontSize: 14.5,
                          fontWeight: FontWeight.w800,
                          color: Colors.white,
                        ),
                      ),
                    ],
                  ),
                ),
                IconButton(
                  icon: const Icon(Icons.close, color: Colors.white),
                  onPressed: () => Navigator.pop(ctx),
                ),
              ],
            ),
          ),

          Expanded(
            child: ListView(
              controller: scrollCtrl,
              padding: const EdgeInsets.all(14),
              children: [
                // 1. Hazır Şablonlar
                const Text(
                  '1. HAZIR RAPOR ŞABLONU',
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w800,
                    color: AppColors.primaryNavy,
                    letterSpacing: 0.4,
                  ),
                ),
                const SizedBox(height: 6),
                Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  children: [
                    for (final entry in const [
                      ('executive', 'Kurumsal Yönetici Özeti'),
                      ('budget_matrix', '12 Aylık Yatay Matris'),
                      ('accounting', 'Muhasebe & Finans Listesi'),
                      ('technical_penalty', 'Teknik & Reaktif Ceza'),
                    ])
                      ChoiceChip(
                        label: Text(
                          entry.$2,
                          style: TextStyle(
                            fontSize: 11.5,
                            fontWeight: FontWeight.w700,
                            color: _cfg.preset == entry.$1
                                ? Colors.white
                                : AppColors.textPrimary,
                          ),
                        ),
                        selected: _cfg.preset == entry.$1,
                        selectedColor: AppColors.primaryNavy,
                        backgroundColor: AppColors.white,
                        checkmarkColor: Colors.white,
                        onSelected: (_) =>
                            setState(() => _cfg = _cfg.applyPreset(entry.$1)),
                      ),
                  ],
                ),
                const SizedBox(height: 14),

                // 2. Tarih & Dönem Seçimi
                const Text(
                  '2. TARİH & DÖNEM ARALIĞI',
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w800,
                    color: AppColors.primaryNavy,
                    letterSpacing: 0.4,
                  ),
                ),
                const SizedBox(height: 6),
                Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  children: [
                    for (final entry in const [
                      ('full_year', 'Tüm Yıl'),
                      ('ytd', 'Yıl Başından Bugüne (YTD)'),
                      ('single_month', 'Tek Ay'),
                      ('q1', '1. Çeyrek (Oca–Mar)'),
                      ('q2', '2. Çeyrek (Nis–Haz)'),
                      ('q3', '3. Çeyrek (Tem–Eyl)'),
                      ('q4', '4. Çeyrek (Eki–Ara)'),
                      ('custom_range', 'Özel Ay Aralığı'),
                    ])
                      ChoiceChip(
                        label: Text(
                          entry.$2,
                          style: TextStyle(
                            fontSize: 11,
                            fontWeight: FontWeight.w700,
                            color: _cfg.periodMode == entry.$1
                                ? Colors.white
                                : AppColors.textPrimary,
                          ),
                        ),
                        selected: _cfg.periodMode == entry.$1,
                        selectedColor: AppColors.accentTurquoise,
                        backgroundColor: AppColors.white,
                        checkmarkColor: Colors.white,
                        onSelected: (_) => setState(
                          () => _cfg = _cfg.copyWith(periodMode: entry.$1),
                        ),
                      ),
                  ],
                ),
                if (_cfg.periodMode == 'single_month' ||
                    _cfg.periodMode == 'custom_range' ||
                    _cfg.periodMode == 'ytd') ...[
                  const SizedBox(height: 10),
                  Row(
                    children: [
                      if (_cfg.periodMode != 'ytd')
                        Expanded(
                          child: DropdownButtonFormField<int>(
                            initialValue: _cfg.startMonth.clamp(1, 12),
                            decoration: InputDecoration(
                              labelText: _cfg.periodMode == 'single_month'
                                  ? 'Seçili Ay'
                                  : 'Başlangıç Ayı',
                            ),
                            items: List.generate(
                              12,
                              (i) => DropdownMenuItem(
                                value: i + 1,
                                child: Text(_monthNames[i]),
                              ),
                            ),
                            onChanged: (v) {
                              if (v == null) return;
                              setState(() {
                                _cfg = _cfg.copyWith(
                                  startMonth: v,
                                  endMonth: _cfg.periodMode == 'single_month'
                                      ? v
                                      : (_cfg.endMonth < v ? v : _cfg.endMonth),
                                );
                              });
                            },
                          ),
                        ),
                      if (_cfg.periodMode == 'custom_range')
                        const SizedBox(width: 8),
                      if (_cfg.periodMode == 'custom_range' ||
                          _cfg.periodMode == 'ytd')
                        Expanded(
                          child: DropdownButtonFormField<int>(
                            initialValue: _cfg.endMonth.clamp(1, 12),
                            decoration: const InputDecoration(
                              labelText: 'Bitiş Ayı',
                            ),
                            items: List.generate(
                              12,
                              (i) => DropdownMenuItem(
                                value: i + 1,
                                child: Text(_monthNames[i]),
                              ),
                            ),
                            onChanged: (v) {
                              if (v == null) return;
                              setState(() {
                                _cfg = _cfg.copyWith(
                                  endMonth: v,
                                  startMonth: _cfg.periodMode == 'custom_range'
                                      ? (_cfg.startMonth > v
                                          ? v
                                          : _cfg.startMonth)
                                      : 1,
                                );
                              });
                            },
                          ),
                        ),
                    ],
                  ),
                ],
                const SizedBox(height: 14),

                // 3. Enerji Türü & Kapsam Filtreleri
                const Text(
                  '3. ENERJİ TÜRÜ & KAPSAM FİLTRELERİ',
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w800,
                    color: AppColors.primaryNavy,
                    letterSpacing: 0.4,
                  ),
                ),
                const SizedBox(height: 6),
                Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  children: [
                    for (final entry in const [
                      ('electric', 'Elektrik'),
                      ('gas', 'Doğalgaz'),
                      ('water', 'Su'),
                    ])
                      FilterChip(
                        label: Text(
                          entry.$2,
                          style: TextStyle(
                            fontSize: 11.5,
                            fontWeight: FontWeight.w700,
                            color: _cfg.utilities.contains(entry.$1)
                                ? Colors.white
                                : AppColors.textPrimary,
                          ),
                        ),
                        selected: _cfg.utilities.contains(entry.$1),
                        selectedColor: AppColors.primaryNavy,
                        backgroundColor: AppColors.white,
                        checkmarkColor: Colors.white,
                        onSelected: (_) => _toggleUtility(entry.$1),
                      ),
                  ],
                ),
                const SizedBox(height: 10),
                Row(
                  children: [
                    Expanded(
                      child: DropdownButtonFormField<String>(
                        initialValue:
                            meterNames.contains(_cfg.meterFilter) ||
                                    _cfg.meterFilter == 'all'
                                ? _cfg.meterFilter
                                : 'all',
                        isExpanded: true,
                        decoration:
                            const InputDecoration(labelText: 'Sayaç / Pano'),
                        items: [
                          const DropdownMenuItem(
                            value: 'all',
                            child: Text(
                              'Tüm Sayaçlar',
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                          for (final m in meterNames)
                            DropdownMenuItem(
                              value: m,
                              child: Text(m, overflow: TextOverflow.ellipsis),
                            ),
                        ],
                        onChanged: (v) {
                          if (v != null) {
                            setState(() => _cfg = _cfg.copyWith(meterFilter: v));
                          }
                        },
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: DropdownButtonFormField<String>(
                        initialValue:
                            providers.contains(_cfg.providerFilter) ||
                                    _cfg.providerFilter == 'all'
                                ? _cfg.providerFilter
                                : 'all',
                        isExpanded: true,
                        decoration:
                            const InputDecoration(labelText: 'Tedarikçi'),
                        items: [
                          const DropdownMenuItem(
                            value: 'all',
                            child: Text(
                              'Tüm Tedarikçiler',
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                          for (final p in providers)
                            DropdownMenuItem(
                              value: p,
                              child: Text(p, overflow: TextOverflow.ellipsis),
                            ),
                        ],
                        onChanged: (v) {
                          if (v != null) {
                            setState(
                                () => _cfg = _cfg.copyWith(providerFilter: v));
                          }
                        },
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                Row(
                  children: [
                    Expanded(
                      child: DropdownButtonFormField<String>(
                        initialValue: _cfg.layoutStyle,
                        isExpanded: true,
                        decoration:
                            const InputDecoration(labelText: 'Rapor Formatı'),
                        items: const [
                          DropdownMenuItem(
                            value: 'multi_sheet',
                            child: Text(
                              'Çok Sekmeli Yönetim Kitabı',
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                          DropdownMenuItem(
                            value: 'monthly_matrix',
                            child: Text(
                              '12 Aylık Yatay Matris (Pivot)',
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                          DropdownMenuItem(
                            value: 'flat_list',
                            child: Text(
                              'Tek Sayfa Düz Liste',
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                        ],
                        onChanged: (v) {
                          if (v != null) {
                            setState(() => _cfg = _cfg.copyWith(layoutStyle: v));
                          }
                        },
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: DropdownButtonFormField<String>(
                        initialValue: _cfg.amountBasis,
                        isExpanded: true,
                        decoration:
                            const InputDecoration(labelText: 'Tutar Bazı'),
                        items: const [
                          DropdownMenuItem(
                            value: 'both',
                            child: Text(
                              'Brüt + Kiracı + Net Ortak',
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                          DropdownMenuItem(
                            value: 'net_common',
                            child: Text(
                              'Yalnızca Net Ortak Alan',
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                          DropdownMenuItem(
                            value: 'gross',
                            child: Text(
                              'Yalnızca Brüt Fatura',
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                        ],
                        onChanged: (v) {
                          if (v != null) {
                            setState(() => _cfg = _cfg.copyWith(amountBasis: v));
                          }
                        },
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 14),

                // 4. Veri Sütunları
                const Text(
                  '4. RAPORA DAHİL EDİLECEK VERİLER',
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w800,
                    color: AppColors.primaryNavy,
                    letterSpacing: 0.4,
                  ),
                ),
                const SizedBox(height: 4),
                CheckboxListTile(
                  dense: true,
                  contentPadding: EdgeInsets.zero,
                  value: _cfg.includeQuantity,
                  title: const Text('Tüketim Miktarı (kWh / m³)'),
                  onChanged: (v) => setState(
                    () => _cfg = _cfg.copyWith(includeQuantity: v ?? true),
                  ),
                ),
                CheckboxListTile(
                  dense: true,
                  contentPadding: EdgeInsets.zero,
                  value: _cfg.includeUnitCost,
                  title: const Text('Birim Maliyet Analizi (TL/kWh & TL/m³)'),
                  onChanged: (v) => setState(
                    () => _cfg = _cfg.copyWith(includeUnitCost: v ?? true),
                  ),
                ),
                CheckboxListTile(
                  dense: true,
                  contentPadding: EdgeInsets.zero,
                  value: _cfg.includeBudgetComparison,
                  title: const Text('Bütçe & Sapma Analizi (% / TL)'),
                  onChanged: (v) => setState(
                    () => _cfg =
                        _cfg.copyWith(includeBudgetComparison: v ?? true),
                  ),
                ),
                CheckboxListTile(
                  dense: true,
                  contentPadding: EdgeInsets.zero,
                  value: _cfg.includePrevYearComparison,
                  title: Text('${_cfg.year - 1} Yılı (Geçen Yıl) Kıyaslaması'),
                  onChanged: (v) => setState(
                    () => _cfg =
                        _cfg.copyWith(includePrevYearComparison: v ?? true),
                  ),
                ),
                if (hasElectric)
                  CheckboxListTile(
                    dense: true,
                    contentPadding: EdgeInsets.zero,
                    value: _cfg.includeReactivePenalty,
                    title: const Text('Reaktif Ceza (İndüktif / Kapasitif)'),
                    onChanged: (v) => setState(
                      () => _cfg =
                          _cfg.copyWith(includeReactivePenalty: v ?? true),
                    ),
                  ),
                CheckboxListTile(
                  dense: true,
                  contentPadding: EdgeInsets.zero,
                  value: _cfg.includeTechnicalIds,
                  title: const Text('Teknik Kodlar (Abone / Sayaç No / EIC)'),
                  onChanged: (v) => setState(
                    () => _cfg = _cfg.copyWith(includeTechnicalIds: v ?? false),
                  ),
                ),
                CheckboxListTile(
                  dense: true,
                  contentPadding: EdgeInsets.zero,
                  value: _cfg.includeMeterBreakdown,
                  title: const Text('Sayaç & Pano Maliyet Payı Sekmesi'),
                  onChanged: (v) => setState(
                    () =>
                        _cfg = _cfg.copyWith(includeMeterBreakdown: v ?? true),
                  ),
                ),
                const SizedBox(height: 8),

                // Canlı Kapsam Özeti Kartı
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: AppColors.turquoiseSoft,
                    borderRadius: BorderRadius.circular(14),
                    border: Border.all(
                      color: AppColors.accentTurquoise.withValues(alpha: 0.35),
                    ),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'SEÇİLİ DÖNEM: ${_cfg.periodLabel}',
                        style: const TextStyle(
                          fontSize: 11.5,
                          fontWeight: FontWeight.w800,
                          color: AppColors.primaryNavy,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        '${matchedInvs.length} Fatura · ${matchedBuds.length} Bütçe Kaydı · Net Ortak Alan: ${_tlFmt.format(netSum)} ₺ (Brüt: ${_tlFmt.format(grossSum)} ₺)'
                        '${diffPct != null ? ' · Bütçe Sapma: ${diffPct >= 0 ? '+' : ''}${diffPct.toStringAsFixed(1)}%' : ''}',
                        style: const TextStyle(
                          fontSize: 11.5,
                          color: AppColors.textPrimary,
                          height: 1.35,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),

          // Alt İndir Butonu
          Container(
            padding: const EdgeInsets.fromLTRB(14, 10, 14, 12),
            decoration: const BoxDecoration(
              color: AppColors.white,
              border: Border(top: BorderSide(color: AppColors.border)),
            ),
            child: Row(
              children: [
                TextButton(
                  onPressed: () => Navigator.pop(ctx),
                  child: const Text('Kapat'),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: FilledButton.icon(
                    onPressed:
                        (matchedInvs.isEmpty && matchedBuds.isEmpty)
                            ? null
                            : () async {
                                Navigator.pop(ctx);
                                await EnergyExcelService
                                    .exportMonthlyInvoicesReport(
                                  context,
                                  year: _cfg.year,
                                  invoices: widget.invoices,
                                  budgets: widget.budgets,
                                  config: _cfg,
                                );
                              },
                    icon: const Icon(Icons.download_rounded, size: 18),
                    label: const Text(
                      'Özelleştirilmiş Excel Raporu İndir',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

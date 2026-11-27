import 'dart:io';

import 'package:excel/excel.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart' hide Border, BorderStyle;
import 'package:intl/intl.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';

import 'package:avm_tech_platform/core/network/api_client.dart';
import 'package:avm_tech_platform/core/permissions/permission_models.dart';
import 'package:avm_tech_platform/core/utils/error_utils.dart';
import 'package:avm_tech_platform/core/widgets/common_widgets.dart';
import 'package:avm_tech_platform/features/energy/data/models/budget_model.dart';
import 'package:avm_tech_platform/features/energy/data/models/invoice_model.dart';
import 'package:avm_tech_platform/features/energy/data/models/meter_model.dart';
import 'package:avm_tech_platform/features/energy/data/models/reading_model.dart';

/// Büyük Excel dosyalarını ana UI iş parçacığını dondurmadan arka plan Isolate'ında kodlar.
List<int>? _encodeExcelInIsolate(Excel excel) => excel.save();

/// Enerji Fatura & Bütçe Raporu Sihirbazı Seçenekleri
class EnergyReportExportConfig {
  final String preset; // 'executive' | 'budget_matrix' | 'accounting' | 'technical_penalty'
  final int year;
  final String periodMode; // 'full_year' | 'ytd' | 'single_month' | 'q1' | 'q2' | 'q3' | 'q4' | 'custom_range'
  final int startMonth; // 1..12
  final int endMonth; // 1..12
  final List<String> utilities; // ['electric', 'gas', 'water']
  final String meterFilter; // 'all' or meterName
  final String providerFilter; // 'all' or provider
  final String invoiceKind; // 'all' | 'normal' | 'late_fee' | 'penalized_only'
  final String amountBasis; // 'both' | 'net_common' | 'gross'
  final String layoutStyle; // 'multi_sheet' | 'monthly_matrix' | 'flat_list'
  final bool includeQuantity;
  final bool includeUnitCost;
  final bool includeTenantSplit;
  final bool includeReactivePenalty;
  final bool includeBudgetComparison;
  final bool includePrevYearComparison;
  final bool includeTechnicalIds;
  final bool includeMeterBreakdown;

  const EnergyReportExportConfig({
    this.preset = 'executive',
    required this.year,
    this.periodMode = 'full_year',
    this.startMonth = 1,
    this.endMonth = 12,
    this.utilities = const ['electric', 'gas', 'water'],
    this.meterFilter = 'all',
    this.providerFilter = 'all',
    this.invoiceKind = 'all',
    this.amountBasis = 'both',
    this.layoutStyle = 'multi_sheet',
    this.includeQuantity = true,
    this.includeUnitCost = true,
    this.includeTenantSplit = true,
    this.includeReactivePenalty = true,
    this.includeBudgetComparison = true,
    this.includePrevYearComparison = true,
    this.includeTechnicalIds = false,
    this.includeMeterBreakdown = true,
  });

  factory EnergyReportExportConfig.defaults({
    required int year,
    int selectedMonth = 0,
    String utilityFilter = 'all',
    String preset = 'executive',
  }) {
    final nowMonth = DateTime.now().month;
    final utils = utilityFilter == 'all'
        ? const ['electric', 'gas', 'water']
        : [utilityFilter];
    final base = EnergyReportExportConfig(
      preset: preset,
      year: year,
      periodMode: selectedMonth > 0 ? 'single_month' : 'full_year',
      startMonth: selectedMonth > 0 ? selectedMonth : 1,
      endMonth: selectedMonth > 0 ? selectedMonth : nowMonth,
      utilities: utils,
      includeReactivePenalty: utils.contains('electric'),
    );
    return base.applyPreset(preset);
  }

  EnergyReportExportConfig copyWith({
    String? preset,
    int? year,
    String? periodMode,
    int? startMonth,
    int? endMonth,
    List<String>? utilities,
    String? meterFilter,
    String? providerFilter,
    String? invoiceKind,
    String? amountBasis,
    String? layoutStyle,
    bool? includeQuantity,
    bool? includeUnitCost,
    bool? includeTenantSplit,
    bool? includeReactivePenalty,
    bool? includeBudgetComparison,
    bool? includePrevYearComparison,
    bool? includeTechnicalIds,
    bool? includeMeterBreakdown,
  }) {
    return EnergyReportExportConfig(
      preset: preset ?? this.preset,
      year: year ?? this.year,
      periodMode: periodMode ?? this.periodMode,
      startMonth: startMonth ?? this.startMonth,
      endMonth: endMonth ?? this.endMonth,
      utilities: utilities ?? this.utilities,
      meterFilter: meterFilter ?? this.meterFilter,
      providerFilter: providerFilter ?? this.providerFilter,
      invoiceKind: invoiceKind ?? this.invoiceKind,
      amountBasis: amountBasis ?? this.amountBasis,
      layoutStyle: layoutStyle ?? this.layoutStyle,
      includeQuantity: includeQuantity ?? this.includeQuantity,
      includeUnitCost: includeUnitCost ?? this.includeUnitCost,
      includeTenantSplit: includeTenantSplit ?? this.includeTenantSplit,
      includeReactivePenalty:
          includeReactivePenalty ?? this.includeReactivePenalty,
      includeBudgetComparison:
          includeBudgetComparison ?? this.includeBudgetComparison,
      includePrevYearComparison:
          includePrevYearComparison ?? this.includePrevYearComparison,
      includeTechnicalIds: includeTechnicalIds ?? this.includeTechnicalIds,
      includeMeterBreakdown:
          includeMeterBreakdown ?? this.includeMeterBreakdown,
    );
  }

  EnergyReportExportConfig applyPreset(String newPreset) {
    switch (newPreset) {
      case 'budget_matrix':
        return copyWith(
          preset: newPreset,
          layoutStyle: 'monthly_matrix',
          amountBasis: 'net_common',
          includeQuantity: true,
          includeUnitCost: true,
          includeTenantSplit: false,
          includeReactivePenalty: false,
          includeBudgetComparison: true,
          includePrevYearComparison: true,
          includeTechnicalIds: false,
          includeMeterBreakdown: true,
        );
      case 'accounting':
        return copyWith(
          preset: newPreset,
          layoutStyle: 'multi_sheet',
          amountBasis: 'both',
          includeQuantity: true,
          includeUnitCost: true,
          includeTenantSplit: true,
          includeReactivePenalty: utilities.contains('electric'),
          includeBudgetComparison: false,
          includePrevYearComparison: false,
          includeTechnicalIds: true,
          includeMeterBreakdown: false,
        );
      case 'technical_penalty':
        return copyWith(
          preset: newPreset,
          utilities: const ['electric'],
          layoutStyle: 'multi_sheet',
          amountBasis: 'both',
          includeQuantity: true,
          includeUnitCost: true,
          includeTenantSplit: true,
          includeReactivePenalty: true,
          includeBudgetComparison: true,
          includePrevYearComparison: false,
          includeTechnicalIds: true,
          includeMeterBreakdown: true,
        );
      case 'executive':
      default:
        return copyWith(
          preset: 'executive',
          layoutStyle: 'multi_sheet',
          amountBasis: 'both',
          includeQuantity: true,
          includeUnitCost: true,
          includeTenantSplit: true,
          includeReactivePenalty: utilities.contains('electric'),
          includeBudgetComparison: true,
          includePrevYearComparison: true,
          includeTechnicalIds: false,
          includeMeterBreakdown: true,
        );
    }
  }

  List<int> get activeMonths {
    switch (periodMode) {
      case 'single_month':
        return [startMonth.clamp(1, 12)];
      case 'q1':
        return const [1, 2, 3];
      case 'q2':
        return const [4, 5, 6];
      case 'q3':
        return const [7, 8, 9];
      case 'q4':
        return const [10, 11, 12];
      case 'ytd':
        final e = endMonth.clamp(1, 12);
        return [for (int m = 1; m <= e; m++) m];
      case 'custom_range':
        final s = (startMonth < endMonth ? startMonth : endMonth).clamp(1, 12);
        final e = (startMonth > endMonth ? startMonth : endMonth).clamp(1, 12);
        return [for (int m = s; m <= e; m++) m];
      case 'full_year':
      default:
        return const [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    }
  }

  String get periodLabel {
    const names = [
      'Tüm Yıl',
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
    final mList = activeMonths;
    if (mList.length == 12) return '$year Tüm Yıl (Ocak–Aralık)';
    if (mList.length == 1) return '${names[mList.first]} $year';
    if (periodMode == 'q1') return '$year 1. Çeyrek (Ocak–Mart)';
    if (periodMode == 'q2') return '$year 2. Çeyrek (Nisan–Haziran)';
    if (periodMode == 'q3') return '$year 3. Çeyrek (Temmuz–Eylül)';
    if (periodMode == 'q4') return '$year 4. Çeyrek (Ekim–Aralık)';
    return '${names[mList.first]} – ${names[mList.last]} $year';
  }

  List<EnergyInvoiceModel> filterInvoices(List<EnergyInvoiceModel> all) {
    final mSet = activeMonths.toSet();
    final uSet = utilities.toSet();
    final filtered = all.where((inv) {
      if (inv.periodYear != year) return false;
      if (!mSet.contains(inv.periodMonth)) return false;
      if (!uSet.contains(inv.utilityType)) return false;
      if (meterFilter != 'all' &&
          inv.meterName != meterFilter &&
          inv.meterId != meterFilter) {
        return false;
      }
      if (providerFilter != 'all' && inv.provider != providerFilter) {
        return false;
      }
      if (invoiceKind == 'normal' && inv.invoiceType == 'late_fee') {
        return false;
      }
      if (invoiceKind == 'late_fee' && inv.invoiceType != 'late_fee') {
        return false;
      }
      if (invoiceKind == 'penalized_only') {
        final pen = inv.utilityType == 'electric' ? inv.totalPenaltyTL : 0.0;
        if (pen <= 0) return false;
      }
      return true;
    }).toList()
      ..sort((a, b) {
        final cmpM = a.periodMonth.compareTo(b.periodMonth);
        if (cmpM != 0) return cmpM;
        final cmpU = a.utilityType.compareTo(b.utilityType);
        if (cmpU != 0) return cmpU;
        return a.meterName.compareTo(b.meterName);
      });
    return filtered;
  }

  List<EnergyBudgetModel> filterBudgets(List<EnergyBudgetModel> all) {
    final mSet = activeMonths.toSet();
    final uSet = utilities.toSet();
    final filtered = all.where((b) {
      if (b.periodYear != year) return false;
      if (!mSet.contains(b.periodMonth)) return false;
      if (!uSet.contains(b.utilityType)) return false;
      return true;
    }).toList()
      ..sort((a, b) {
        final cmpM = a.periodMonth.compareTo(b.periodMonth);
        if (cmpM != 0) return cmpM;
        return a.utilityType.compareTo(b.utilityType);
      });
    return filtered;
  }
}

class EnergyExcelService {
  /// Enerji modülünde sayaç okuma Excel çıktısı yetkisi.
  /// Teknik personel dahil sayaç verisini görüntüleme veya okuma girişi yetkisi olan
  /// tüm onaylı kullanıcılar elektrik/mekanik sayaç verilerini dışa aktarabilir.
  static bool canExportMeters(ProfileModel? profile) {
    if (profile == null) return false;
    return profile.hasModulePermission('energy', ModulePermission.view) ||
        profile.hasModulePermission('energy', ModulePermission.create) ||
        profile.hasModulePermission('energy', ModulePermission.reports) ||
        profile.hasModulePermission('energy', ModulePermission.manage);
  }

  static Future<void> shareOrDownloadExcel({
    required List<int> bytes,
    required String fileName,
    required String text,
  }) async {
    final uint8 = bytes is Uint8List ? bytes : Uint8List.fromList(bytes);
    if (kIsWeb) {
      final xFile = XFile.fromData(
        uint8,
        name: fileName,
        mimeType:
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      await Share.shareXFiles([xFile], text: text);
    } else {
      final directory = await getApplicationDocumentsDirectory();
      final path = '${directory.path}/$fileName';
      File(path)
        ..createSync(recursive: true)
        ..writeAsBytesSync(uint8);
      await Share.shareXFiles([XFile(path)], text: text);
    }
  }

  static Future<Map<String, List<MeterReadingModel>>> _fetchReadingsForMeters(
    List<String> meterIds,
  ) async {
    if (meterIds.isEmpty) return {};
    final data = await Api.client
        .from('meter_readings')
        .select('id, meter_id, reading_date, active_value, inductive_value, capacitive_value, inductive_percent, capacitive_percent, index_value, consumption, entered_by_id, entered_by_name, notes, created_at')
        .inFilter('meter_id', meterIds)
        .order('reading_date', ascending: true)
        .limit(5000);

    final map = <String, List<MeterReadingModel>>{};
    for (final raw in (data as List)) {
      final r = MeterReadingModel.fromJson(Map<String, dynamic>.from(raw as Map));
      map.putIfAbsent(r.meterId, () => []).add(r);
    }
    return map;
  }

  static Future<void> exportMechanical(
    BuildContext context,
    List<MeterModel> meters,
  ) async {
    if (meters.isEmpty) return;
    showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (_) => const Center(child: CircularProgressIndicator()),
    );

    try {
      final readingsByMeter =
          await _fetchReadingsForMeters(meters.map((m) => m.id).toList());

      final excel = Excel.createExcel();
      excel.delete('Sheet1');
      final sheet = excel['Mekanik Rapor'];

      final thinBorder = Border(
        borderStyle: BorderStyle.Thin,
        borderColorHex: ExcelColor.fromHexString('#000000'),
      );
      final headerStyle = CellStyle(
        backgroundColorHex: ExcelColor.fromHexString('#17365D'),
        fontColorHex: ExcelColor.fromHexString('#FFFFFF'),
        bold: true,
        horizontalAlign: HorizontalAlign.Center,
        leftBorder: thinBorder,
        rightBorder: thinBorder,
        topBorder: thinBorder,
        bottomBorder: thinBorder,
      );
      final subHeaderStyle = CellStyle(
        backgroundColorHex: ExcelColor.fromHexString('#E3F2FD'),
        fontColorHex: ExcelColor.fromHexString('#000000'),
        bold: true,
        horizontalAlign: HorizontalAlign.Center,
        leftBorder: thinBorder,
        rightBorder: thinBorder,
        topBorder: thinBorder,
        bottomBorder: thinBorder,
      );
      final dataStyle = CellStyle(
        horizontalAlign: HorizontalAlign.Center,
        leftBorder: thinBorder,
        rightBorder: thinBorder,
        topBorder: thinBorder,
        bottomBorder: thinBorder,
      );

      final row0 = <CellValue>[TextCellValue('')];
      final row1 = <CellValue>[TextCellValue('TARİH')];
      for (final m in meters) {
        row0.add(TextCellValue(m.name.toUpperCase()));
        row0.add(TextCellValue(''));
        row1.add(TextCellValue('ENDEKS'));
        row1.add(TextCellValue('TÜKETİM'));
      }
      sheet.appendRow(row0);
      sheet.appendRow(row1);

      sheet.cell(CellIndex.indexByColumnRow(columnIndex: 0, rowIndex: 1)).cellStyle =
          headerStyle;
      for (int i = 0; i < meters.length; i++) {
        final startCol = 1 + i * 2;
        final endCol = 2 + i * 2;
        sheet.merge(
          CellIndex.indexByColumnRow(columnIndex: startCol, rowIndex: 0),
          CellIndex.indexByColumnRow(columnIndex: endCol, rowIndex: 0),
          customValue: TextCellValue(meters[i].name.toUpperCase()),
        );
        sheet.cell(CellIndex.indexByColumnRow(columnIndex: startCol, rowIndex: 0)).cellStyle =
            headerStyle;
        sheet.cell(CellIndex.indexByColumnRow(columnIndex: startCol, rowIndex: 1)).cellStyle =
            subHeaderStyle;
        sheet.cell(CellIndex.indexByColumnRow(columnIndex: endCol, rowIndex: 1)).cellStyle =
            subHeaderStyle;
      }

      final dateToMap = <String, Map<String, MeterReadingModel>>{};
      for (final m in meters) {
        for (final r in (readingsByMeter[m.id] ?? const <MeterReadingModel>[])) {
          final d = DateFormat('dd.MM.yyyy').format(r.readingDate.toLocal());
          dateToMap.putIfAbsent(d, () => {})[m.id] = r;
        }
      }

      final sortedDates = dateToMap.keys.toList()
        ..sort((a, b) => DateFormat('dd.MM.yyyy')
            .parse(a)
            .compareTo(DateFormat('dd.MM.yyyy').parse(b)));

      int rowIdx = 2;
      for (final d in sortedDates) {
        final row = <CellValue>[TextCellValue(d)];
        for (final m in meters) {
          final r = dateToMap[d]?[m.id];
          if (r != null) {
            row.add(DoubleCellValue(r.indexValue ?? 0));
            row.add(DoubleCellValue(r.consumption));
          } else {
            row.add(TextCellValue('-'));
            row.add(TextCellValue('-'));
          }
        }
        sheet.appendRow(row);
        for (int c = 0; c < row.length; c++) {
          sheet.cell(CellIndex.indexByColumnRow(columnIndex: c, rowIndex: rowIdx)).cellStyle =
              dataStyle;
        }
        rowIdx++;
      }

      final fileBytes = await compute(_encodeExcelInIsolate, excel);
      if (context.mounted) Navigator.of(context, rootNavigator: true).pop();
      if (context.mounted && fileBytes != null) {
        await shareOrDownloadExcel(
          bytes: fileBytes,
          fileName:
              'Mekanik_Rapor_${DateFormat('dd_MM_yyyy').format(DateTime.now())}.xlsx',
          text: 'Mekanik Sayaç Raporu',
        );
      }
    } catch (e) {
      if (context.mounted) Navigator.of(context, rootNavigator: true).pop();
      if (context.mounted) showAppSnack(context, friendlyError(e), error: true);
    }
  }

  static Future<void> exportElectrical(
    BuildContext context,
    List<MeterModel> meters,
  ) async {
    if (meters.isEmpty) return;
    showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (_) => const Center(child: CircularProgressIndicator()),
    );

    try {
      final readingsByMeter =
          await _fetchReadingsForMeters(meters.map((m) => m.id).toList());

      final excel = Excel.createExcel();
      excel.delete('Sheet1');

      final thinBorder = Border(
        borderStyle: BorderStyle.Thin,
        borderColorHex: ExcelColor.fromHexString('#000000'),
      );
      final headerStyle = CellStyle(
        backgroundColorHex: ExcelColor.fromHexString('#17365D'),
        fontColorHex: ExcelColor.fromHexString('#FFFFFF'),
        bold: true,
        horizontalAlign: HorizontalAlign.Center,
        leftBorder: thinBorder,
        rightBorder: thinBorder,
        topBorder: thinBorder,
        bottomBorder: thinBorder,
      );
      final warningStyle = CellStyle(
        backgroundColorHex: ExcelColor.fromHexString('#FFEB3B'),
        fontColorHex: ExcelColor.fromHexString('#D32F2F'),
        bold: true,
        horizontalAlign: HorizontalAlign.Center,
        leftBorder: thinBorder,
        rightBorder: thinBorder,
        topBorder: thinBorder,
        bottomBorder: thinBorder,
      );
      final dataStyle = CellStyle(
        horizontalAlign: HorizontalAlign.Center,
        leftBorder: thinBorder,
        rightBorder: thinBorder,
        topBorder: thinBorder,
        bottomBorder: thinBorder,
      );

      for (final meter in meters) {
        var sheetName = meter.name.replaceAll(RegExp(r'[\\/*?\[\]:]'), '_');
        if (sheetName.length > 31) sheetName = sheetName.substring(0, 31);
        final sheet = excel[sheetName];

        sheet.appendRow([
          TextCellValue('TARİH'),
          TextCellValue('AKTİF'),
          TextCellValue('İNDÜKTİF'),
          TextCellValue('KAPASİTİF'),
          TextCellValue('% İND'),
          TextCellValue('% KAP'),
          TextCellValue('TÜKETİM'),
          TextCellValue('GİREN'),
        ]);
        for (int c = 0; c < 8; c++) {
          sheet.cell(CellIndex.indexByColumnRow(columnIndex: c, rowIndex: 0)).cellStyle =
              headerStyle;
        }

        final readings = readingsByMeter[meter.id] ?? const <MeterReadingModel>[];
        int rowIndex = 1;
        for (final r in readings) {
          final d = DateFormat('dd.MM.yyyy').format(r.readingDate.toLocal());
          final indP = r.inductivePercent ?? 0;
          final capP = r.capacitivePercent ?? 0;

          sheet.appendRow([
            TextCellValue(d),
            DoubleCellValue(r.activeValue ?? 0),
            DoubleCellValue(r.inductiveValue ?? 0),
            DoubleCellValue(r.capacitiveValue ?? 0),
            DoubleCellValue(indP),
            DoubleCellValue(capP),
            DoubleCellValue(r.consumption),
            TextCellValue(r.enteredByName.toUpperCase()),
          ]);
          for (int c = 0; c < 8; c++) {
            sheet.cell(CellIndex.indexByColumnRow(columnIndex: c, rowIndex: rowIndex)).cellStyle =
                dataStyle;
          }
          if (indP > 20.0) {
            sheet.cell(CellIndex.indexByColumnRow(columnIndex: 4, rowIndex: rowIndex)).cellStyle =
                warningStyle;
          }
          if (capP > 15.0) {
            sheet.cell(CellIndex.indexByColumnRow(columnIndex: 5, rowIndex: rowIndex)).cellStyle =
                warningStyle;
          }
          rowIndex++;
        }
      }

      final fileBytes = await compute(_encodeExcelInIsolate, excel);
      if (context.mounted) Navigator.of(context, rootNavigator: true).pop();
      if (context.mounted && fileBytes != null) {
        await shareOrDownloadExcel(
          bytes: fileBytes,
          fileName:
              'Elektrik_Rapor_${DateFormat('dd_MM_yyyy').format(DateTime.now())}.xlsx',
          text: 'Elektrik Sayaç Raporu',
        );
      }
    } catch (e) {
      if (context.mounted) Navigator.of(context, rootNavigator: true).pop();
      if (context.mounted) showAppSnack(context, friendlyError(e), error: true);
    }
  }

  static Future<void> exportSingleMeter(
    BuildContext context,
    MeterModel meter,
    List<MeterReadingModel> readings,
  ) async {
    try {
      final excel = Excel.createExcel();
      final sheet = excel['Sheet1'];
      if (meter.isElectric) {
        sheet.appendRow([
          TextCellValue('TARİH'),
          TextCellValue('AKTİF'),
          TextCellValue('İNDÜKTİF'),
          TextCellValue('KAPASİTİF'),
          TextCellValue('% İND'),
          TextCellValue('% KAP'),
          TextCellValue('TÜKETİM (kWh)'),
          TextCellValue('GİREN'),
        ]);
        for (final r in readings) {
          sheet.appendRow([
            TextCellValue(DateFormat('dd.MM.yyyy').format(r.readingDate.toLocal())),
            DoubleCellValue(r.activeValue ?? 0),
            DoubleCellValue(r.inductiveValue ?? 0),
            DoubleCellValue(r.capacitiveValue ?? 0),
            DoubleCellValue(r.inductivePercent ?? 0),
            DoubleCellValue(r.capacitivePercent ?? 0),
            DoubleCellValue(r.consumption),
            TextCellValue(r.enteredByName.toUpperCase()),
          ]);
        }
      } else {
        sheet.appendRow([
          TextCellValue('TARİH'),
          TextCellValue('ENDEKS'),
          TextCellValue('TÜKETİM'),
          TextCellValue('GİREN'),
        ]);
        for (final r in readings) {
          sheet.appendRow([
            TextCellValue(DateFormat('dd.MM.yyyy').format(r.readingDate.toLocal())),
            DoubleCellValue(r.indexValue ?? 0),
            DoubleCellValue(r.consumption),
            TextCellValue(r.enteredByName.toUpperCase()),
          ]);
        }
      }

      final safeName = meter.name
          .replaceAll(RegExp(r'[^a-zA-Z0-9çğıöşüÇĞİÖŞÜ_\- ]'), '_')
          .trim();
      final baseName = safeName.isEmpty ? 'Sayac' : safeName;
      final fileBytes = await compute(_encodeExcelInIsolate, excel);
      if (fileBytes != null) {
        await shareOrDownloadExcel(
          bytes: fileBytes,
          fileName: '${baseName}_Raporu.xlsx',
          text: '${meter.name} Sayaç Okuma Raporu',
        );
      }
    } catch (e) {
      if (context.mounted) showAppSnack(context, friendlyError(e), error: true);
    }
  }

  static String _utilityLabelTr(String u) {
    switch (u) {
      case 'electric':
        return 'Elektrik';
      case 'gas':
        return 'Doğalgaz';
      case 'water':
        return 'Su';
      default:
        return u;
    }
  }

  static String _utilityUnitTr(String u) => u == 'electric' ? 'kWh' : 'm³';

  static double _r2(double v) => double.parse(v.toStringAsFixed(2));

  /// Çok sekmeli ve koşullu renklendirmeli Excel çalışma kitabı byte dizisi üretir.
  static List<int> buildCustomizedInvoicesBudgetExcelBytes({
    required List<EnergyInvoiceModel> allInvoices,
    required List<EnergyBudgetModel> allBudgets,
    required EnergyReportExportConfig config,
  }) {
    const monthNames = [
      'OCAK',
      'ŞUBAT',
      'MART',
      'NİSAN',
      'MAYIS',
      'HAZİRAN',
      'TEMMUZ',
      'AĞUSTOS',
      'EYLÜL',
      'EKİM',
      'KASIM',
      'ARALIK',
    ];

    final invoices = config.filterInvoices(allInvoices);
    final budgets = config.filterBudgets(allBudgets);
    final activeMonths = config.activeMonths;

    final excel = Excel.createExcel();

    final thinBorder = Border(
      borderStyle: BorderStyle.Thin,
      borderColorHex: ExcelColor.fromHexString('#CBD5E1'),
    );
    final headerStyle = CellStyle(
      backgroundColorHex: ExcelColor.fromHexString('#17365D'),
      fontColorHex: ExcelColor.fromHexString('#FFFFFF'),
      bold: true,
      horizontalAlign: HorizontalAlign.Center,
      leftBorder: thinBorder,
      rightBorder: thinBorder,
      topBorder: thinBorder,
      bottomBorder: thinBorder,
    );
    final dataStyle = CellStyle(
      horizontalAlign: HorizontalAlign.Center,
      leftBorder: thinBorder,
      rightBorder: thinBorder,
      topBorder: thinBorder,
      bottomBorder: thinBorder,
    );
    final badStyle = CellStyle(
      backgroundColorHex: ExcelColor.fromHexString('#FEE2E2'),
      fontColorHex: ExcelColor.fromHexString('#991B1B'),
      bold: true,
      horizontalAlign: HorizontalAlign.Center,
      leftBorder: thinBorder,
      rightBorder: thinBorder,
      topBorder: thinBorder,
      bottomBorder: thinBorder,
    );
    final goodStyle = CellStyle(
      backgroundColorHex: ExcelColor.fromHexString('#DCFCE7'),
      fontColorHex: ExcelColor.fromHexString('#166534'),
      bold: true,
      horizontalAlign: HorizontalAlign.Center,
      leftBorder: thinBorder,
      rightBorder: thinBorder,
      topBorder: thinBorder,
      bottomBorder: thinBorder,
    );
    final totalStyle = CellStyle(
      backgroundColorHex: ExcelColor.fromHexString('#E2E8F0'),
      fontColorHex: ExcelColor.fromHexString('#17365D'),
      bold: true,
      horizontalAlign: HorizontalAlign.Center,
      leftBorder: thinBorder,
      rightBorder: thinBorder,
      topBorder: thinBorder,
      bottomBorder: thinBorder,
    );

    void styleRow(Sheet sheet, int rowIndex, int colCount, CellStyle style) {
      for (int c = 0; c < colCount; c++) {
        sheet
            .cell(CellIndex.indexByColumnRow(columnIndex: c, rowIndex: rowIndex))
            .cellStyle = style;
      }
    }

    // 1. Yönetici Özeti Sekmesi
    void buildExecutiveSheet() {
      final sheet = excel['Yonetici Ozeti'];
      final headers = <CellValue>[
        TextCellValue('ENERJİ TÜRÜ'),
        TextCellValue('BİRİM'),
        TextCellValue('FATURA ADEDİ'),
        TextCellValue('TOPLAM TÜKETİM'),
        TextCellValue('ORTAK ALAN TÜKETİM'),
        TextCellValue('BRÜT FATURA (TL)'),
        TextCellValue('KİRACI PAYI (TL)'),
        TextCellValue('NET ORTAK ALAN (TL)'),
        TextCellValue('ORT. BİRİM MALİYET (TL)'),
        if (config.includeReactivePenalty && config.utilities.contains('electric'))
          TextCellValue('REAKTİF CEZA (TL)'),
        if (config.includeBudgetComparison) ...[
          TextCellValue('DÖNEM BÜTÇESİ (TL)'),
          TextCellValue('BÜTÇE FARKI (TL)'),
          TextCellValue('BÜTÇE SAPMA (%)'),
        ],
        if (config.includePrevYearComparison) ...[
          TextCellValue('${config.year - 1} GERÇEKLEŞEN (TL)'),
          TextCellValue('GEÇEN YILA GÖRE (%)'),
        ],
      ];
      sheet.appendRow(headers);
      styleRow(sheet, 0, headers.length, headerStyle);

      int rowIdx = 1;
      int totCount = 0;
      double totGross = 0;
      double totTenant = 0;
      double totNet = 0;
      double totPen = 0;
      double totBudTl = 0;
      double totPrevTl = 0;

      for (final u in config.utilities) {
        final uInvs = invoices.where((i) => i.utilityType == u).toList();
        final uBuds = budgets.where((b) => b.utilityType == u).toList();

        final cnt = uInvs.length;
        final qty = uInvs.fold<double>(0, (s, i) => s + i.consumption);
        final cQty = uInvs.fold<double>(0, (s, i) => s + i.commonConsumption);
        final gross = uInvs.fold<double>(0, (s, i) => s + i.amountTL);
        final tenant =
            uInvs.fold<double>(0, (s, i) => s + (i.tenantAmountTL ?? 0));
        final net = uInvs.fold<double>(0, (s, i) => s + i.commonAmountTL);
        final pen = u == 'electric'
            ? uInvs.fold<double>(0, (s, i) => s + i.totalPenaltyTL)
            : 0.0;
        final budTl = uBuds.fold<double>(0, (s, b) => s + b.budgetTL);
        final prevTl = uBuds.fold<double>(0, (s, b) => s + b.prevYearTL);
        final unitCost = qty > 0 ? gross / qty : 0.0;
        final diffPct = EnergyBudgetModel.variancePercent(net, budTl);
        final yoyPct = EnergyBudgetModel.variancePercent(net, prevTl);

        totCount += cnt;
        totGross += gross;
        totTenant += tenant;
        totNet += net;
        totPen += pen;
        totBudTl += budTl;
        totPrevTl += prevTl;

        final row = <CellValue>[
          TextCellValue(_utilityLabelTr(u)),
          TextCellValue(_utilityUnitTr(u)),
          IntCellValue(cnt),
          DoubleCellValue(_r2(qty)),
          DoubleCellValue(_r2(cQty)),
          DoubleCellValue(_r2(gross)),
          DoubleCellValue(_r2(tenant)),
          DoubleCellValue(_r2(net)),
          DoubleCellValue(_r2(unitCost)),
          if (config.includeReactivePenalty &&
              config.utilities.contains('electric'))
            u == 'electric' ? DoubleCellValue(_r2(pen)) : TextCellValue('-'),
          if (config.includeBudgetComparison) ...[
            DoubleCellValue(_r2(budTl)),
            DoubleCellValue(_r2(net - budTl)),
            TextCellValue(
              diffPct != null
                  ? '${diffPct >= 0 ? '+' : ''}${diffPct.toStringAsFixed(1)}%'
                  : '-',
            ),
          ],
          if (config.includePrevYearComparison) ...[
            DoubleCellValue(_r2(prevTl)),
            TextCellValue(
              yoyPct != null
                  ? '${yoyPct >= 0 ? '+' : ''}${yoyPct.toStringAsFixed(1)}%'
                  : '-',
            ),
          ],
        ];
        sheet.appendRow(row);
        styleRow(sheet, rowIdx, row.length, dataStyle);

        if (diffPct != null && config.includeBudgetComparison) {
          final sapmaCol = 9 +
              ((config.includeReactivePenalty &&
                      config.utilities.contains('electric'))
                  ? 1
                  : 0) +
              2;
          sheet
              .cell(CellIndex.indexByColumnRow(
                  columnIndex: sapmaCol, rowIndex: rowIdx))
              .cellStyle = diffPct > 0 ? badStyle : goodStyle;
        }
        rowIdx++;
      }

      final totDiffPct = EnergyBudgetModel.variancePercent(totNet, totBudTl);
      final totYoyPct = EnergyBudgetModel.variancePercent(totNet, totPrevTl);
      final totRow = <CellValue>[
        TextCellValue('GENEL TOPLAM'),
        TextCellValue(config.utilities.length == 1
            ? _utilityUnitTr(config.utilities.first)
            : 'Karma'),
        IntCellValue(totCount),
        TextCellValue('-'),
        TextCellValue('-'),
        DoubleCellValue(_r2(totGross)),
        DoubleCellValue(_r2(totTenant)),
        DoubleCellValue(_r2(totNet)),
        TextCellValue('-'),
        if (config.includeReactivePenalty &&
            config.utilities.contains('electric'))
          DoubleCellValue(_r2(totPen)),
        if (config.includeBudgetComparison) ...[
          DoubleCellValue(_r2(totBudTl)),
          DoubleCellValue(_r2(totNet - totBudTl)),
          TextCellValue(
            totDiffPct != null
                ? '${totDiffPct >= 0 ? '+' : ''}${totDiffPct.toStringAsFixed(1)}%'
                : '-',
          ),
        ],
        if (config.includePrevYearComparison) ...[
          DoubleCellValue(_r2(totPrevTl)),
          TextCellValue(
            totYoyPct != null
                ? '${totYoyPct >= 0 ? '+' : ''}${totYoyPct.toStringAsFixed(1)}%'
                : '-',
          ),
        ],
      ];
      sheet.appendRow(totRow);
      styleRow(sheet, rowIdx, totRow.length, totalStyle);
    }

    // 2. Fatura Listesi Sekmesi (Elektrik / Mekanik ayrımıyla)
    void buildInvoiceSheet(
      String sheetName,
      List<EnergyInvoiceModel> list,
      bool isElectricSheet,
    ) {
      final sheet = excel[sheetName];
      final unit = isElectricSheet ? 'kWh' : 'm³';
      final showReactive = isElectricSheet && config.includeReactivePenalty;
      final showGross =
          config.amountBasis == 'both' || config.amountBasis == 'gross';
      final showTenant =
          config.includeTenantSplit && config.amountBasis == 'both';
      final showNet =
          config.amountBasis == 'both' || config.amountBasis == 'net_common';

      final headers = <CellValue>[
        TextCellValue('AY'),
        TextCellValue('TÜR'),
        TextCellValue('SAYAÇ / PANO'),
        TextCellValue('TEDARİKÇİ'),
        TextCellValue('FATURA NO'),
        if (config.includeTechnicalIds) TextCellValue('ABONE / SAYAÇ / EIC'),
        if (config.includeQuantity) TextCellValue('TÜKETİM ($unit)'),
        if (showGross) TextCellValue('BRÜT TUTAR (TL)'),
        if (config.includeUnitCost) TextCellValue('BİRİM MALİYET (TL/$unit)'),
        if (showReactive) ...[
          TextCellValue('İND. CEZA (TL)'),
          TextCellValue('KAP. CEZA (TL)'),
        ],
        if (showTenant) TextCellValue('KİRACI PAYI (TL)'),
        if (showNet) TextCellValue('NET ORTAK ALAN (TL)'),
      ];
      sheet.appendRow(headers);
      styleRow(sheet, 0, headers.length, headerStyle);

      int rowIdx = 1;
      double sumQty = 0;
      double sumGross = 0;
      double sumInd = 0;
      double sumCap = 0;
      double sumTenant = 0;
      double sumNet = 0;

      for (final inv in list) {
        final qty = inv.consumption;
        final gross = inv.amountTL;
        final ind = inv.utilityType == 'electric' ? inv.inductivePenaltyTL : 0.0;
        final cap = inv.utilityType == 'electric' ? inv.capacitivePenaltyTL : 0.0;
        final tenant = inv.tenantAmountTL ?? 0.0;
        final net = inv.commonAmountTL;

        sumQty += qty;
        sumGross += gross;
        sumInd += ind;
        sumCap += cap;
        sumTenant += tenant;
        sumNet += net;

        final idCode = [
          inv.meterNo,
          inv.subscriberNo,
          inv.contractNo,
          inv.eicCode,
        ].where((x) => x != null && x.trim().isNotEmpty).join(' / ');

        final row = <CellValue>[
          TextCellValue(monthNames[(inv.periodMonth - 1).clamp(0, 11)]),
          TextCellValue(_utilityLabelTr(inv.utilityType)),
          TextCellValue(inv.meterName),
          TextCellValue(inv.provider),
          TextCellValue(inv.invoiceNo ?? '-'),
          if (config.includeTechnicalIds)
            TextCellValue(idCode.isEmpty ? '-' : idCode),
          if (config.includeQuantity) DoubleCellValue(_r2(qty)),
          if (showGross) DoubleCellValue(_r2(gross)),
          if (config.includeUnitCost)
            DoubleCellValue(qty > 0 ? _r2(gross / qty) : 0),
          if (showReactive) ...[
            DoubleCellValue(_r2(ind)),
            DoubleCellValue(_r2(cap)),
          ],
          if (showTenant) DoubleCellValue(_r2(tenant)),
          if (showNet) DoubleCellValue(_r2(net)),
        ];
        sheet.appendRow(row);
        styleRow(
          sheet,
          rowIdx,
          row.length,
          (ind + cap > 0) ? badStyle : dataStyle,
        );
        rowIdx++;
      }

      final totRow = <CellValue>[
        TextCellValue('TOPLAM'),
        TextCellValue('${list.length} Fatura'),
        TextCellValue('-'),
        TextCellValue('-'),
        TextCellValue('-'),
        if (config.includeTechnicalIds) TextCellValue('-'),
        if (config.includeQuantity) DoubleCellValue(_r2(sumQty)),
        if (showGross) DoubleCellValue(_r2(sumGross)),
        if (config.includeUnitCost)
          DoubleCellValue(sumQty > 0 ? _r2(sumGross / sumQty) : 0),
        if (showReactive) ...[
          DoubleCellValue(_r2(sumInd)),
          DoubleCellValue(_r2(sumCap)),
        ],
        if (showTenant) DoubleCellValue(_r2(sumTenant)),
        if (showNet) DoubleCellValue(_r2(sumNet)),
      ];
      sheet.appendRow(totRow);
      styleRow(sheet, rowIdx, totRow.length, totalStyle);
    }

    // 3. Bütçe Karşılaştırma Sekmesi
    void buildBudgetSheet() {
      final sheet = excel['Butce Karsilastirma'];
      final headers = <CellValue>[
        TextCellValue('KALEM'),
        TextCellValue('AY'),
        if (config.includeQuantity) ...[
          TextCellValue('${config.year} BÜTÇE (BİRİM)'),
          TextCellValue('${config.year} GERÇEKLEŞEN (BİRİM)'),
          TextCellValue('MİKTAR SAPMA %'),
        ],
        TextCellValue('${config.year} BÜTÇE (TL)'),
        TextCellValue('${config.year} GERÇEKLEŞEN ORTAK (TL)'),
        TextCellValue('TL SAPMA %'),
        if (config.includeUnitCost) TextCellValue('ORT. BİRİM MALİYET (TL)'),
        if (config.includePrevYearComparison)
          TextCellValue('${config.year - 1} GERÇEKLEŞEN (TL)'),
      ];
      sheet.appendRow(headers);
      styleRow(sheet, 0, headers.length, headerStyle);

      int rowIdx = 1;
      double sumBudTl = 0;
      double sumActTl = 0;
      double sumPrevTl = 0;

      for (final u in config.utilities) {
        final label = '${_utilityLabelTr(u)} (${_utilityUnitTr(u)})';
        for (final m in activeMonths) {
          final b = budgets
              .where((x) => x.utilityType == u && x.periodMonth == m)
              .firstOrNull;
          final actualList = invoices
              .where((x) => x.utilityType == u && x.periodMonth == m);
          final actualCons =
              actualList.fold<double>(0, (s, e) => s + e.commonConsumption);
          final actualTl =
              actualList.fold<double>(0, (s, e) => s + e.commonAmountTL);

          if (b == null && actualCons == 0 && actualTl == 0) continue;

          final budCons = b?.budgetConsumption ?? 0.0;
          final budTl = b?.budgetTL ?? 0.0;
          final prevTl = b?.prevYearTL ?? 0.0;
          final qtyDiff =
              EnergyBudgetModel.variancePercent(actualCons, budCons) ?? 0.0;
          final tlDiff =
              EnergyBudgetModel.variancePercent(actualTl, budTl) ?? 0.0;

          sumBudTl += budTl;
          sumActTl += actualTl;
          sumPrevTl += prevTl;

          final row = <CellValue>[
            TextCellValue(label),
            TextCellValue(monthNames[m - 1]),
            if (config.includeQuantity) ...[
              DoubleCellValue(_r2(budCons)),
              DoubleCellValue(_r2(actualCons)),
              DoubleCellValue(_r2(qtyDiff)),
            ],
            DoubleCellValue(_r2(budTl)),
            DoubleCellValue(_r2(actualTl)),
            DoubleCellValue(_r2(tlDiff)),
            if (config.includeUnitCost)
              DoubleCellValue(actualCons > 0 ? _r2(actualTl / actualCons) : 0),
            if (config.includePrevYearComparison)
              DoubleCellValue(_r2(prevTl)),
          ];
          sheet.appendRow(row);
          styleRow(
            sheet,
            rowIdx,
            row.length,
            budTl > 0 && actualTl > budTl
                ? badStyle
                : (budTl > 0 && actualTl < budTl ? goodStyle : dataStyle),
          );
          rowIdx++;
        }
      }

      final totTlDiff =
          EnergyBudgetModel.variancePercent(sumActTl, sumBudTl) ?? 0.0;
      final totRow = <CellValue>[
        TextCellValue('TOPLAM'),
        TextCellValue('${rowIdx - 1} Kayıt'),
        if (config.includeQuantity) ...[
          TextCellValue('-'),
          TextCellValue('-'),
          TextCellValue('-'),
        ],
        DoubleCellValue(_r2(sumBudTl)),
        DoubleCellValue(_r2(sumActTl)),
        DoubleCellValue(_r2(totTlDiff)),
        if (config.includeUnitCost) TextCellValue('-'),
        if (config.includePrevYearComparison) DoubleCellValue(_r2(sumPrevTl)),
      ];
      sheet.appendRow(totRow);
      styleRow(sheet, rowIdx, totRow.length, totalStyle);
    }

    // 4. 12 Aylık Yatay Matris (Pivot) Sekmesi
    void buildMatrixSheet() {
      final sheet = excel['Aylik Matris ${config.year}'];
      final headers = <CellValue>[
        TextCellValue('ENERJİ TÜRÜ & KALEM'),
        TextCellValue('BİRİM'),
        for (final m in activeMonths) TextCellValue(monthNames[m - 1]),
        TextCellValue('DÖNEM TOPLAMI'),
        TextCellValue('SAPMA (%)'),
      ];
      sheet.appendRow(headers);
      styleRow(sheet, 0, headers.length, headerStyle);

      int rowIdx = 1;
      final monthTotalBud = <int, double>{};
      final monthTotalAct = <int, double>{};

      for (final u in config.utilities) {
        final uTitle = _utilityLabelTr(u).toUpperCase();
        double totBud = 0;
        double totAct = 0;
        final budCells = <CellValue>[];
        final actCells = <CellValue>[];

        for (final m in activeMonths) {
          final b = budgets
              .where((x) => x.utilityType == u && x.periodMonth == m)
              .firstOrNull;
          final mInvs = invoices
              .where((x) => x.utilityType == u && x.periodMonth == m);
          final bTl = b?.budgetTL ?? 0.0;
          final aTl = mInvs.fold<double>(0, (s, e) => s + e.commonAmountTL);

          totBud += bTl;
          totAct += aTl;
          monthTotalBud[m] = (monthTotalBud[m] ?? 0) + bTl;
          monthTotalAct[m] = (monthTotalAct[m] ?? 0) + aTl;

          budCells.add(DoubleCellValue(_r2(bTl)));
          actCells.add(DoubleCellValue(_r2(aTl)));
        }

        if (config.includeBudgetComparison) {
          final rBud = <CellValue>[
            TextCellValue('$uTitle · Bütçe (TL)'),
            TextCellValue('TL'),
            ...budCells,
            DoubleCellValue(_r2(totBud)),
            TextCellValue('-'),
          ];
          sheet.appendRow(rBud);
          styleRow(sheet, rowIdx++, rBud.length, dataStyle);
        }

        final diff = EnergyBudgetModel.variancePercent(totAct, totBud);
        final rAct = <CellValue>[
          TextCellValue('$uTitle · Gerçekleşen Ortak Alan (TL)'),
          TextCellValue('TL'),
          ...actCells,
          DoubleCellValue(_r2(totAct)),
          TextCellValue(
            diff != null
                ? '${diff >= 0 ? '+' : ''}${diff.toStringAsFixed(1)}%'
                : '-',
          ),
        ];
        sheet.appendRow(rAct);
        styleRow(
          sheet,
          rowIdx++,
          rAct.length,
          diff != null && diff > 0
              ? badStyle
              : (diff != null && diff < 0 ? goodStyle : dataStyle),
        );
      }

      final grandBud =
          monthTotalBud.values.fold<double>(0, (s, v) => s + v);
      final grandAct =
          monthTotalAct.values.fold<double>(0, (s, v) => s + v);
      final grandDiff = EnergyBudgetModel.variancePercent(grandAct, grandBud);

      final totRow = <CellValue>[
        TextCellValue('GENEL TOPLAM GERÇEKLEŞEN (TL)'),
        TextCellValue('TL'),
        for (final m in activeMonths)
          DoubleCellValue(_r2(monthTotalAct[m] ?? 0)),
        DoubleCellValue(_r2(grandAct)),
        TextCellValue(
          grandDiff != null
              ? '${grandDiff >= 0 ? '+' : ''}${grandDiff.toStringAsFixed(1)}%'
              : '-',
        ),
      ];
      sheet.appendRow(totRow);
      styleRow(sheet, rowIdx, totRow.length, totalStyle);
    }

    // 5. Sayaç & Pano Kırılımı Sekmesi
    void buildMeterBreakdownSheet() {
      final sheet = excel['Sayac Pano Kirilimi'];
      final headers = <CellValue>[
        TextCellValue('SAYAÇ / PANO ADI'),
        TextCellValue('ENERJİ TÜRÜ'),
        TextCellValue('TEDARİKÇİ'),
        TextCellValue('BİRİM'),
        TextCellValue('FATURA ADEDİ'),
        TextCellValue('TOPLAM TÜKETİM'),
        TextCellValue('BRÜT TUTAR (TL)'),
        TextCellValue('NET ORTAK ALAN (TL)'),
        TextCellValue('ORT. BİRİM MALİYET (TL)'),
        TextCellValue('TOPLAM PAY (%)'),
      ];
      sheet.appendRow(headers);
      styleRow(sheet, 0, headers.length, headerStyle);

      final grouped = <String, List<EnergyInvoiceModel>>{};
      double totalNetAll = 0;
      for (final inv in invoices) {
        final k = '${inv.utilityType}::${inv.meterName}';
        grouped.putIfAbsent(k, () => []).add(inv);
        totalNetAll += inv.commonAmountTL;
      }

      final entries = grouped.entries.toList()
        ..sort((a, b) {
          final netA =
              a.value.fold<double>(0, (s, i) => s + i.commonAmountTL);
          final netB =
              b.value.fold<double>(0, (s, i) => s + i.commonAmountTL);
          return netB.compareTo(netA);
        });

      int rowIdx = 1;
      for (final entry in entries) {
        final list = entry.value;
        final first = list.first;
        final qty = list.fold<double>(0, (s, i) => s + i.consumption);
        final gross = list.fold<double>(0, (s, i) => s + i.amountTL);
        final net = list.fold<double>(0, (s, i) => s + i.commonAmountTL);
        final share = totalNetAll > 0 ? (net / totalNetAll) * 100 : 0.0;

        final row = <CellValue>[
          TextCellValue(first.meterName),
          TextCellValue(_utilityLabelTr(first.utilityType)),
          TextCellValue(first.provider),
          TextCellValue(_utilityUnitTr(first.utilityType)),
          IntCellValue(list.length),
          DoubleCellValue(_r2(qty)),
          DoubleCellValue(_r2(gross)),
          DoubleCellValue(_r2(net)),
          DoubleCellValue(qty > 0 ? _r2(gross / qty) : 0),
          TextCellValue('${share.toStringAsFixed(1)}%'),
        ];
        sheet.appendRow(row);
        styleRow(sheet, rowIdx++, row.length, dataStyle);
      }
    }

    if (config.layoutStyle == 'monthly_matrix') {
      buildMatrixSheet();
      buildExecutiveSheet();
      if (config.includeBudgetComparison) {
        buildBudgetSheet();
      }
    } else if (config.layoutStyle == 'flat_list') {
      final onlyMech = !config.utilities.contains('electric');
      buildInvoiceSheet(
        'Faturalar ${config.year}',
        invoices,
        !onlyMech,
      );
      if (config.includeBudgetComparison) {
        buildBudgetSheet();
      }
    } else {
      // multi_sheet (Önerilen Çok Sekmeli Kurumsal Yönetim Kitabı)
      buildExecutiveSheet();
      final elecList =
          invoices.where((i) => i.utilityType == 'electric').toList();
      final mechList =
          invoices.where((i) => i.utilityType != 'electric').toList();

      if (config.utilities.contains('electric') && elecList.isNotEmpty) {
        buildInvoiceSheet('Elektrik Faturalari', elecList, true);
      }
      if ((config.utilities.contains('gas') ||
              config.utilities.contains('water')) &&
          mechList.isNotEmpty) {
        buildInvoiceSheet('Dogalgaz ve Su', mechList, false);
      }
      // Geriye dönük uyumluluk: Tüm seçili faturalar sekmesi
      buildInvoiceSheet(
        'Faturalar ${config.year}',
        invoices,
        config.utilities.contains('electric'),
      );
      if (config.includeBudgetComparison) {
        buildBudgetSheet();
        buildMatrixSheet();
      }
      if (config.includeMeterBreakdown && invoices.isNotEmpty) {
        buildMeterBreakdownSheet();
      }
    }

    excel.delete('Sheet1');
    return excel.save() ?? <int>[];
  }

  static Future<void> exportMonthlyInvoicesReport(
    BuildContext context, {
    required int year,
    required List<EnergyInvoiceModel> invoices,
    required List<EnergyBudgetModel> budgets,
    EnergyReportExportConfig? config,
  }) async {
    final effectiveConfig =
        config ?? EnergyReportExportConfig.defaults(year: year);
    final fileBytes = buildCustomizedInvoicesBudgetExcelBytes(
      allInvoices: invoices,
      allBudgets: budgets,
      config: effectiveConfig,
    );
    if (fileBytes.isNotEmpty) {
      await shareOrDownloadExcel(
        bytes: fileBytes,
        fileName:
            'Downtown_Teknik_Fatura_Butce_${effectiveConfig.year}_${DateFormat('dd_MM_yyyy').format(DateTime.now())}.xlsx',
        text:
            '${effectiveConfig.periodLabel} Enerji Fatura ve Bütçe Yönetim Raporu',
      );
    }
  }
}

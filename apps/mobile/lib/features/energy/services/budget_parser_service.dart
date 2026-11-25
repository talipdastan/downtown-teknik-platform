import 'dart:convert';
import 'dart:typed_data';
import 'package:excel/excel.dart';

import 'package:avm_tech_platform/core/network/api_client.dart';
import 'package:avm_tech_platform/features/energy/data/models/budget_model.dart';

/// Excel (.xlsx), CSV (.csv) veya PDF (.pdf) dosyalarından aylık
/// Elektrik, Doğalgaz ve Su bütçe verilerini ayrıştıran servis.
class BudgetParserService {
  static const Map<String, int> _monthMap = {
    'ocak': 1,
    'şubat': 2,
    'subat': 2,
    'mart': 3,
    'nisan': 4,
    'mayıs': 5,
    'mayis': 5,
    'haziran': 6,
    'temmuz': 7,
    'ağustos': 8,
    'agustos': 8,
    'eylül': 9,
    'eylul': 9,
    'ekim': 10,
    'kasım': 11,
    'kasim': 11,
    'aralık': 12,
    'aralik': 12,
  };

  static Future<List<MonthlyBudgetResult>> parseBudgetFile({
    required Uint8List bytes,
    required String fileName,
    required int targetYear,
    void Function(String status)? onProgress,
  }) async {
    final lower = fileName.toLowerCase();
    if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
      onProgress?.call('Excel dosyası okunuyor...');
      return parseExcelBudgets(bytes, targetYear);
    } else if (lower.endsWith('.csv')) {
      onProgress?.call('CSV dosyası okunuyor...');
      final content = utf8.decode(bytes, allowMalformed: true);
      return parseCsvBudgets(content, targetYear);
    } else if (lower.endsWith('.pdf')) {
      onProgress?.call('PDF bütçe tablosu sunucu tarafında analiz ediliyor...');
      return parsePdfBudgetsViaEdge(pdfBytes: bytes, targetYear: targetYear);
    } else {
      throw Exception(
        'Desteklenmeyen dosya formatı. Lütfen .xlsx, .csv veya .pdf seçin.',
      );
    }
  }

  static List<MonthlyBudgetResult> parseExcelBudgets(
    Uint8List bytes,
    int targetYear,
  ) {
    final excel = Excel.decodeBytes(bytes);
    final rowsList = <List<String>>[];

    for (final sheetName in excel.tables.keys) {
      final sheet = excel.tables[sheetName];
      if (sheet == null) continue;
      for (final row in sheet.rows) {
        rowsList.add(
          row.map((cell) => cell?.value?.toString().trim() ?? '').toList(),
        );
      }
      rowsList.add([]);
    }
    return parseTabularRows(rowsList, targetYear);
  }

  static List<MonthlyBudgetResult> parseCsvBudgets(
    String csvContent,
    int targetYear,
  ) {
    final lines = const LineSplitter().convert(csvContent);
    final rows = <List<String>>[];
    for (final line in lines) {
      final delimiter =
          line.split(';').length > line.split(',').length ? ';' : ',';
      rows.add(line.split(delimiter).map((e) => e.trim()).toList());
    }
    return parseTabularRows(rows, targetYear);
  }

  /// Hem yatay (OCAK..ARALIK sütunlu AVM bütçe tablosu) hem dikey formatı destekler.
  static List<MonthlyBudgetResult> parseTabularRows(
    List<List<String>> rows,
    int targetYear,
  ) {
    final accMap = <String, _BudgetAcc>{};
    String? currentUtility;
    Map<int, int> currentMonthCols = {};

    for (final row in rows) {
      if (row.every((c) => c.trim().isEmpty)) continue;

      final firstCell = row.isNotEmpty ? row[0].trim() : '';
      final joinedLower = row.join(' ').toLowerCase();

      if (joinedLower.contains('elektrik') &&
          (joinedLower.contains('tüketim') ||
              joinedLower.contains('tuketim') ||
              joinedLower.contains('bütçe') ||
              joinedLower.contains('butce') ||
              joinedLower.contains('ortak'))) {
        currentUtility = 'electric';
        continue;
      }
      if ((joinedLower.contains('doğalgaz') || joinedLower.contains('dogalgaz')) &&
          (joinedLower.contains('tüketim') ||
              joinedLower.contains('tuketim') ||
              joinedLower.contains('bütçe') ||
              joinedLower.contains('butce') ||
              joinedLower.contains('ortak'))) {
        currentUtility = 'gas';
        continue;
      }
      if (RegExp(r'\bsu\b').hasMatch(joinedLower) &&
          (joinedLower.contains('tüketim') ||
              joinedLower.contains('tuketim') ||
              joinedLower.contains('bütçe') ||
              joinedLower.contains('butce') ||
              joinedLower.contains('ortak'))) {
        currentUtility = 'water';
        continue;
      }

      final detectedMonths = <int, int>{};
      for (int c = 0; c < row.length; c++) {
        final m = _monthMap[row[c].trim().toLowerCase()];
        if (m != null) detectedMonths[c] = m;
      }
      if (detectedMonths.length >= 3) {
        currentMonthCols = detectedMonths;
        continue;
      }

      if (row.length >= 4) {
        final rowUtil = _detectUtilityFromLabel(row[0]);
        final rowMonth =
            _monthMap[row[1].trim().toLowerCase()] ?? int.tryParse(row[1].trim());
        if (rowUtil != null &&
            rowMonth != null &&
            rowMonth >= 1 &&
            rowMonth <= 12) {
          final key = '${rowUtil}_$rowMonth';
          final acc =
              accMap.putIfAbsent(key, () => _BudgetAcc(rowUtil, rowMonth));
          final bCons = parseNumber(row[2]);
          final bTl = parseNumber(row[3]);
          if (bCons != null) acc.budgetConsumption = bCons;
          if (bTl != null) acc.budgetTL = bTl;
          if (row.length >= 5) {
            final pCons = parseNumber(row[4]);
            if (pCons != null) acc.prevYearConsumption = pCons;
          }
          if (row.length >= 6) {
            final pTl = parseNumber(row[5]);
            if (pTl != null) acc.prevYearTL = pTl;
          }
          continue;
        }
      }

      if (currentUtility != null && currentMonthCols.isNotEmpty) {
        final labelLower = firstCell.toLowerCase();
        if (labelLower.contains('%') || labelLower.contains('sapma')) continue;

        final isBudget = labelLower.contains('bütçe') ||
            labelLower.contains('butce') ||
            labelLower.contains('hedef');
        final isPrevYear = labelLower.contains('${targetYear - 1}') ||
            labelLower.contains('geçen yıl') ||
            labelLower.contains('gecen yil') ||
            labelLower.contains('önceki yıl') ||
            labelLower.contains('onceki yil');

        if (!isBudget && !isPrevYear) continue;

        final isTL = labelLower.contains('(tl)') ||
            labelLower.contains(' tl') ||
            labelLower.contains('tutar');
        final isQty = labelLower.contains('kw') ||
            labelLower.contains('m3') ||
            labelLower.contains('m³') ||
            labelLower.contains('miktar') ||
            !isTL;

        for (final entry in currentMonthCols.entries) {
          final colIdx = entry.key;
          final month = entry.value;
          if (colIdx >= row.length) continue;
          final val = parseNumber(row[colIdx]);
          if (val == null || val == 0) continue;

          final key = '${currentUtility}_$month';
          final acc = accMap.putIfAbsent(
            key,
            () => _BudgetAcc(currentUtility!, month),
          );
          if (isBudget) {
            if (isTL) {
              acc.budgetTL = val;
            } else if (isQty) {
              acc.budgetConsumption = val;
            }
          } else if (isPrevYear) {
            if (isTL) {
              acc.prevYearTL = val;
            } else if (isQty) {
              acc.prevYearConsumption = val;
            }
          }
        }
      }
    }

    final results = accMap.values
        .where((a) =>
            a.budgetConsumption > 0 ||
            a.budgetTL > 0 ||
            a.prevYearConsumption > 0 ||
            a.prevYearTL > 0)
        .map(
          (a) => EnergyBudgetModel(
            periodYear: targetYear,
            periodMonth: a.month,
            utilityType: a.utilityType,
            budgetConsumption: a.budgetConsumption,
            budgetTL: a.budgetTL,
            prevYearConsumption: a.prevYearConsumption,
            prevYearTL: a.prevYearTL,
          ),
        )
        .toList();

    results.sort((a, b) {
      final tCmp = a.utilityType.compareTo(b.utilityType);
      return tCmp != 0 ? tCmp : a.periodMonth.compareTo(b.periodMonth);
    });
    return results;
  }

  /// PDF bütçe tablosunu Supabase Edge Function (`parse-energy-document`) ile okur.
  static Future<List<EnergyBudgetModel>> parsePdfBudgetsViaEdge({
    required Uint8List pdfBytes,
    required int targetYear,
  }) async {
    final res = await Api.client.functions.invoke(
      'parse-energy-document',
      body: {
        'mode': 'budgets',
        'targetYear': targetYear,
        'pdfBase64': base64Encode(pdfBytes),
      },
    );

    final data = res.data;
    if (data is! Map || data['items'] is! List) {
      throw Exception('PDF bütçe yanıtı beklenen formatta değil.');
    }

    final list = <EnergyBudgetModel>[];
    for (final raw in (data['items'] as List)) {
      if (raw is! Map) continue;
      final type = raw['utilityType']?.toString() ?? '';
      if (type != 'electric' && type != 'gas' && type != 'water') continue;
      final month = (raw['month'] is num)
          ? (raw['month'] as num).toInt()
          : int.tryParse(raw['month']?.toString() ?? '') ?? 0;
      if (month < 1 || month > 12) continue;

      list.add(
        EnergyBudgetModel(
          periodYear: targetYear,
          periodMonth: month,
          utilityType: type,
          budgetConsumption: _toDouble(raw['budgetConsumption']),
          budgetTL: _toDouble(raw['budgetTL']),
          prevYearConsumption: _toDouble(raw['prevYearConsumption']),
          prevYearTL: _toDouble(raw['prevYearTL']),
        ),
      );
    }
    return list;
  }

  static Uint8List generateSampleBudgetExcel(int year) {
    final excel = Excel.createExcel();
    excel.delete('Sheet1');
    final sheet = excel['Bütçe Şablonu'];

    sheet.appendRow([
      TextCellValue('Kategori'),
      TextCellValue('Ay'),
      TextCellValue('$year Bütçe Miktar (kW/m³)'),
      TextCellValue('$year Bütçe Tutar (TL)'),
      TextCellValue('${year - 1} Gerçekleşen Miktar'),
      TextCellValue('${year - 1} Gerçekleşen Tutar (TL)'),
    ]);

    const months = [
      'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
      'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
    ];
    for (final cat in ['Elektrik', 'Doğalgaz', 'Su']) {
      for (final m in months) {
        sheet.appendRow([
          TextCellValue(cat),
          TextCellValue(m),
          const DoubleCellValue(0),
          const DoubleCellValue(0),
          const DoubleCellValue(0),
          const DoubleCellValue(0),
        ]);
      }
    }
    return Uint8List.fromList(excel.save()!);
  }

  static String? _detectUtilityFromLabel(String raw) {
    final lower = raw.trim().toLowerCase();
    if (lower.contains('elektrik') || lower == 'electric') return 'electric';
    if (lower.contains('doğalgaz') ||
        lower.contains('dogalgaz') ||
        lower == 'gas') {
      return 'gas';
    }
    if (lower == 'su' || lower.contains('buski') || lower == 'water') {
      return 'water';
    }
    return null;
  }

  static double? parseNumber(String raw) {
    final cleaned = raw.trim().replaceAll('TL', '').replaceAll('₺', '').trim();
    if (cleaned.isEmpty || cleaned.toLowerCase() == 'nan') return null;

    if (cleaned.contains(',') && cleaned.contains('.')) {
      final lastComma = cleaned.lastIndexOf(',');
      final lastDot = cleaned.lastIndexOf('.');
      if (lastComma > lastDot) {
        return double.tryParse(
          cleaned.replaceAll('.', '').replaceAll(',', '.'),
        );
      }
      return double.tryParse(cleaned.replaceAll(',', ''));
    } else if (cleaned.contains(',')) {
      return double.tryParse(cleaned.replaceAll(',', '.'));
    }
    return double.tryParse(cleaned);
  }

  static double _toDouble(dynamic val) {
    if (val == null) return 0.0;
    if (val is num) return val.toDouble();
    return parseNumber(val.toString()) ?? 0.0;
  }
}

typedef MonthlyBudgetResult = EnergyBudgetModel;

class _BudgetAcc {
  final String utilityType;
  final int month;
  double budgetConsumption = 0.0;
  double budgetTL = 0.0;
  double prevYearConsumption = 0.0;
  double prevYearTL = 0.0;

  _BudgetAcc(this.utilityType, this.month);
}

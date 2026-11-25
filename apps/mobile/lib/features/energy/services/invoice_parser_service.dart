import 'dart:convert';
import 'dart:typed_data';

import 'package:avm_tech_platform/core/network/api_client.dart';
import 'package:avm_tech_platform/features/energy/data/models/invoice_model.dart';
import 'package:avm_tech_platform/features/energy/data/models/meter_model.dart';

/// Supabase Edge Function (`parse-energy-document`) üzerinden PDF faturaları
/// ayrıştırır, kayıtlı sayaçlarla eşleştirir ve dönem/sayaç çakışmalarını tespit eder.
class InvoiceParserService {
  static Future<List<ParsedInvoiceDraft>> parsePdfViaEdge({
    required Uint8List pdfBytes,
    required List<MeterModel> existingMeters,
    List<EnergyInvoiceModel> historicalInvoices = const [],
    bool fastMode = true,
    bool onlyRegisteredMeters = true,
    void Function(int skippedCount)? onUnregisteredSkipped,
  }) async {
    final res = await Api.client.functions.invoke(
      'parse-energy-document',
      body: {
        'mode': 'invoices',
        'fastMode': fastMode,
        'onlyRegisteredMeters': onlyRegisteredMeters,
        'pdfBase64': base64Encode(pdfBytes),
        'registeredMeters': existingMeters
            .map(
              (m) => {
                'name': m.name,
                'meterNo': m.meterNo,
                'contractNo': m.contractNo,
                'eicCode': m.eicCode,
                'tekilCode': m.tekilCode,
                'subscriberNo': m.subscriberNo,
              },
            )
            .toList(),
      },
    );

    final data = res.data;
    if (data is! Map || data['items'] is! List) {
      throw Exception('PDF fatura analiz yanıtı beklenen formatta değil.');
    }

    return buildDraftsFromItems(
      items: List<Map<String, dynamic>>.from(
        (data['items'] as List).whereType<Map>().map((e) => Map<String, dynamic>.from(e)),
      ),
      existingMeters: existingMeters,
      historicalInvoices: historicalInvoices,
      onlyRegisteredMeters: onlyRegisteredMeters,
      onUnregisteredSkipped: onUnregisteredSkipped,
    );
  }

  /// Sunucudan gelen JSON nesnelerini eşleştirir ve çakışma tespiti yapar (saf Dart → test edilebilir).
  static List<ParsedInvoiceDraft> buildDraftsFromItems({
    required List<Map<String, dynamic>> items,
    required List<MeterModel> existingMeters,
    List<EnergyInvoiceModel> historicalInvoices = const [],
    bool onlyRegisteredMeters = true,
    void Function(int skippedCount)? onUnregisteredSkipped,
  }) {
    final drafts = <ParsedInvoiceDraft>[];
    int skippedCount = 0;

    for (final item in items) {
      final provider = item['provider']?.toString() ?? 'Bilinmeyen';
      final utilityType = item['utilityType']?.toString() ?? 'electric';
      final invoiceType = item['invoiceType']?.toString() ?? 'normal';
      final meterNo = _cleanIdentifier(item['meterNo']?.toString());
      final contractNo = _cleanIdentifier(item['contractNo']?.toString());
      final subscriberNo = _cleanIdentifier(item['subscriberNo']?.toString());
      final eicCode = EnergyInvoiceModel.cleanCode(item['eicCode']?.toString());
      final tekilCode = EnergyInvoiceModel.cleanCode(item['tekilCode']?.toString());
      final addressHint = item['addressHint']?.toString();
      final consumption = _toDouble(item['consumption']);
      final amountTL = _toDouble(item['amountTL']);
      final indPenalty = utilityType == 'electric'
          ? _toDouble(item['inductivePenaltyTL'])
          : 0.0;
      final capPenalty = utilityType == 'electric'
          ? _toDouble(item['capacitivePenaltyTL'])
          : 0.0;
      final year = _toInt(item['year']) ?? DateTime.now().year;
      final month = (_toInt(item['month']) ?? DateTime.now().month).clamp(1, 12);

      DateTime? invDate;
      if (item['invoiceDate'] != null) {
        invDate = DateTime.tryParse(item['invoiceDate'].toString());
      }

      final matched = matchMeter(
        meters: existingMeters,
        utilityType: utilityType,
        eicCode: eicCode,
        tekilCode: tekilCode,
        subscriberNo: subscriberNo,
        contractNo: contractNo,
        meterNo: meterNo,
      );

      if (onlyRegisteredMeters && matched == null) {
        skippedCount++;
        continue;
      }

      final defaultName = matched?.name ??
          (addressHint != null && addressHint.trim().isNotEmpty
              ? addressHint.trim()
              : '$provider (${meterNo ?? tekilCode ?? 'Sayaç'})');

      String? warning;
      if (invoiceType == 'normal' && consumption > 0) {
        final unitPrice = amountTL / consumption;
        final prevSameType = historicalInvoices
            .where((i) =>
                i.utilityType == utilityType &&
                i.invoiceType == 'normal' &&
                i.consumption > 0)
            .toList();
        if (prevSameType.isNotEmpty) {
          final avgUnit =
              prevSameType.map((e) => e.unitPrice).reduce((a, b) => a + b) /
                  prevSameType.length;
          if (avgUnit > 0) {
            final diffRatio = (unitPrice - avgUnit).abs() / avgUnit;
            if (diffRatio > 0.35) {
              final pct = (diffRatio * 100).toStringAsFixed(0);
              warning =
                  'Birim fiyat (${unitPrice.toStringAsFixed(2)} TL) geçmiş ortalamadan %$pct sapıyor!';
            }
          }
        }
      }

      drafts.add(
        ParsedInvoiceDraft(
          provider: provider,
          utilityType: utilityType,
          invoiceType: invoiceType,
          invoiceNo: item['invoiceNo']?.toString(),
          invoiceDate: invDate,
          year: year,
          month: month,
          meterNo: meterNo,
          contractNo: contractNo,
          eicCode: eicCode,
          tekilCode: tekilCode,
          subscriberNo: subscriberNo,
          addressHint: addressHint,
          consumption: consumption,
          amountTL: amountTL,
          inductivePenaltyTL: indPenalty,
          capacitivePenaltyTL: capPenalty,
          matchedMeterId: matched?.id,
          meterName: defaultName,
          warningMessage: warning,
        ),
      );
    }

    if (skippedCount > 0) {
      onUnregisteredSkipped?.call(skippedCount);
    }

    detectMeterConflicts(drafts, historicalInvoices);
    return drafts;
  }

  static void detectMeterConflicts(
    List<ParsedInvoiceDraft> drafts,
    List<EnergyInvoiceModel> historicalInvoices,
  ) {
    for (final d in drafts) {
      d.hasMeterConflict = false;
      d.conflictMessage = null;
    }

    final byPrimaryKey = <String, List<ParsedInvoiceDraft>>{};
    for (final d in drafts) {
      final key = d.primaryGroupKey;
      if (key.isNotEmpty) {
        byPrimaryKey.putIfAbsent('${d.year}_${d.month}_$key', () => []).add(d);
      }
    }

    for (final entry in byPrimaryKey.entries) {
      if (entry.value.length > 1) {
        final details = entry.value
            .map((e) =>
                '${e.addressHint ?? e.meterName} (${e.amountTL.toStringAsFixed(2)} TL)')
            .join(' ↔ ');
        for (final d in entry.value) {
          d.hasMeterConflict = true;
          d.conflictMessage =
              'Bu PDF içinde aynı dönem için ${entry.value.length} fatura çakışıyor:\n$details';
        }
      }
    }

    for (final d in drafts) {
      final key = d.primaryGroupKey;
      final existing = historicalInvoices
          .where((inv) =>
              inv.periodYear == d.periodYearOrYear &&
              inv.periodMonth == d.month &&
              inv.primaryIdentifier == key)
          .toList();
      if (existing.isNotEmpty) {
        d.hasMeterConflict = true;
        final dbInfo = existing
            .map((e) => '${e.meterName} (${e.amountTL.toStringAsFixed(2)} TL)')
            .join(', ');
        final msg =
            '${d.month}/${d.year} döneminde zaten kayıtlı fatura var: $dbInfo';
        d.conflictMessage =
            d.conflictMessage == null ? msg : '${d.conflictMessage}\n$msg';
      }
    }
  }

  /// Eşleştirme önceliği: 1) EIC -> 2) Tekil -> 3) Abone -> 4) Sayaç No -> 5) Sözleşme No
  static MeterModel? matchMeter({
    required List<MeterModel> meters,
    required String utilityType,
    String? eicCode,
    String? tekilCode,
    String? subscriberNo,
    String? contractNo,
    String? meterNo,
  }) {
    final cleanEic = EnergyInvoiceModel.cleanCode(eicCode);
    if (cleanEic != null) {
      for (final m in meters) {
        if (EnergyInvoiceModel.cleanCode(m.eicCode) == cleanEic) return m;
      }
    }

    final cleanTekil = EnergyInvoiceModel.cleanCode(tekilCode);
    if (cleanTekil != null) {
      for (final m in meters) {
        if (EnergyInvoiceModel.cleanCode(m.tekilCode) == cleanTekil) return m;
      }
    }

    final cleanSub = _cleanIdentifier(subscriberNo);
    if (cleanSub != null) {
      for (final m in meters) {
        if (_cleanIdentifier(m.subscriberNo) == cleanSub) return m;
      }
    }

    final normIncoming = EnergyInvoiceModel.normalizeMeterNo(meterNo);
    if (normIncoming != null && normIncoming.isNotEmpty) {
      final matches = meters.where((m) {
        if (EnergyInvoiceModel.normalizeMeterNo(m.meterNo) != normIncoming) {
          return false;
        }
        if (utilityType == 'electric') {
          if (cleanEic != null &&
              m.eicCode != null &&
              EnergyInvoiceModel.cleanCode(m.eicCode) != cleanEic) {
            return false;
          }
          if (cleanTekil != null &&
              m.tekilCode != null &&
              EnergyInvoiceModel.cleanCode(m.tekilCode) != cleanTekil) {
            return false;
          }
        }
        return true;
      }).toList();
      if (matches.length == 1) return matches.first;
    }

    final cleanContract = _cleanIdentifier(contractNo);
    if (cleanContract != null) {
      for (final m in meters) {
        if (_cleanIdentifier(m.contractNo) == cleanContract) {
          if (utilityType == 'electric' &&
              cleanEic != null &&
              m.eicCode != null &&
              EnergyInvoiceModel.cleanCode(m.eicCode) != cleanEic) {
            continue;
          }
          return m;
        }
      }
    }

    return null;
  }

  static String? _cleanIdentifier(String? raw) {
    if (raw == null) return null;
    final trimmed = raw.trim().replaceFirst(RegExp(r'^-+'), '');
    return trimmed.isEmpty ? null : trimmed;
  }

  static double _toDouble(dynamic val) {
    if (val == null) return 0.0;
    if (val is num) return val.toDouble();
    return double.tryParse(val.toString().replaceAll(',', '.')) ?? 0.0;
  }

  static int? _toInt(dynamic val) {
    if (val == null) return null;
    if (val is int) return val;
    if (val is num) return val.toInt();
    return int.tryParse(val.toString());
  }
}

extension on ParsedInvoiceDraft {
  int get periodYearOrYear => year;
}

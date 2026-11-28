import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:avm_tech_platform/features/energy/data/models/budget_model.dart';
import 'package:avm_tech_platform/features/energy/data/models/invoice_model.dart';
import 'package:avm_tech_platform/features/energy/services/budget_parser_service.dart';

void main() {
  group('EnergyBudgetModel', () {
    test('variancePercent hedef 0 veya negatifse null döner, pozitifse yüzde hesaplar', () {
      expect(EnergyBudgetModel.variancePercent(120, 0), isNull);
      expect(EnergyBudgetModel.variancePercent(120, -10), isNull);
      expect(EnergyBudgetModel.variancePercent(120, 100), closeTo(20.0, 0.001));
      expect(EnergyBudgetModel.variancePercent(85, 100), closeTo(-15.0, 0.001));
    });

    test('fromJson ve toUpsertJson tüm alanları kayıpsız dönüştürür', () {
      final model = EnergyBudgetModel.fromJson({
        'id': 'b-1',
        'period_year': 2026,
        'period_month': 11,
        'utility_type': 'electric',
        'budget_consumption': 150000,
        'budget_tl': 750000.5,
        'prev_year_consumption': 142000,
        'prev_year_tl': 690000,
      });

      expect(model.id, 'b-1');
      expect(model.periodYear, 2026);
      expect(model.periodMonth, 11);
      expect(model.utilityType, 'electric');
      expect(model.budgetConsumption, 150000.0);
      expect(model.budgetTL, 750000.5);

      final upsert = model.toUpsertJson(updatedById: 'user-1');
      expect(upsert['period_year'], 2026);
      expect(upsert['period_month'], 11);
      expect(upsert['utility_type'], 'electric');
      expect(upsert['updated_by_id'], 'user-1');
    });
  });

  group('EnergyInvoiceModel', () {
    test('ortak alan tüketim/tutar, birim fiyat ve toplam ceza hesaplamaları doğrudur', () {
      final inv = EnergyInvoiceModel(
        id: 'inv-1',
        periodYear: 2026,
        periodMonth: 11,
        utilityType: 'electric',
        provider: 'CK Enerji',
        meterName: 'TR-1 Ana Sayaç',
        eicCode: ' 40z0000123456789 ',
        meterNo: '6000012345',
        consumption: 10000,
        amountTL: 50000,
        inductivePenaltyTL: 1200,
        capacitivePenaltyTL: 300,
        tenantConsumption: 3500,
        tenantAmountTL: 17500,
        enteredByName: 'Teknik Müdür',
        createdAt: DateTime(2026, 11, 28),
      );

      expect(inv.unitPrice, closeTo(5.0, 0.001));
      expect(inv.totalPenaltyTL, closeTo(1500.0, 0.001));
      expect(inv.commonConsumption, closeTo(6500.0, 0.001));
      expect(inv.commonAmountTL, closeTo(32500.0, 0.001));
      expect(EnergyInvoiceModel.cleanCode(inv.eicCode), '40Z0000123456789');
      expect(EnergyInvoiceModel.normalizeMeterNo('6000012345'), '6012345');
      expect(inv.primaryIdentifier, contains('40Z0000123456789'));
    });

    test('kiracı tutarı toplamı aşsa bile ortak alan negatif olmaz', () {
      final inv = EnergyInvoiceModel(
        id: 'inv-2',
        periodYear: 2026,
        periodMonth: 11,
        utilityType: 'water',
        provider: 'İSKİ',
        meterName: 'Ana Su',
        consumption: 100,
        amountTL: 1000,
        tenantConsumption: 150,
        tenantAmountTL: 1500,
        enteredByName: 'Teknik Müdür',
        createdAt: DateTime(2026, 11, 28),
      );

      expect(inv.commonConsumption, 0.0);
      expect(inv.commonAmountTL, 0.0);
    });
  });

  group('BudgetParserService', () {
    test('örnek bütçe Excel şablonu geçerli ZIP/XLSX baytları üretir', () {
      final bytes = BudgetParserService.generateSampleBudgetExcel(2026);
      expect(bytes.length, greaterThan(500));
      // XLSX dosyası PK (0x50, 0x4B) ZIP imzasıyla başlar
      expect(bytes[0], 0x50);
      expect(bytes[1], 0x4B);
    });
  });

  group('Mimari Koruma (Energy & Work-Tracking Ekranları)', () {
    const guardedScreens = [
      'lib/features/energy/presentation/screens/energy_invoices_screen.dart',
      'lib/features/energy/presentation/screens/meter_detail_screen.dart',
      'lib/features/energy/presentation/screens/meter_list_screen.dart',
      'lib/features/work_tracking/presentation/screens/create_ticket_screen.dart',
      'lib/features/work_tracking/presentation/screens/manager_work_orders_screen.dart',
      'lib/features/work_tracking/presentation/screens/technician_work_order_detail_screen.dart',
      'lib/features/work_tracking/presentation/screens/ticket_detail_screen.dart',
    ];

    test('çekirdek ekranlar doğrudan Api.client.from/rpc çağırmamalı (Repository katmanı zorunlu)', () {
      final directPattern = RegExp(r"Api\.client\.(from|rpc)\(");
      for (final relPath in guardedScreens) {
        final file = File(relPath);
        expect(file.existsSync(), isTrue, reason: '$relPath bulunamadı');
        final content = file.readAsStringSync();
        expect(
          directPattern.hasMatch(content),
          isFalse,
          reason: '$relPath içinde doğrudan Api.client.from/rpc çağrısı bulundu — Repository kullanın.',
        );
      }
    });
  });
}

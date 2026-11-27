import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:avm_tech_platform/core/database/local_lookup_cache.dart';
import 'package:avm_tech_platform/core/database/pagination.dart';
import 'package:avm_tech_platform/core/network/api_client.dart';
import 'package:avm_tech_platform/features/energy/data/models/budget_model.dart';
import 'package:avm_tech_platform/features/energy/data/models/invoice_model.dart';
import 'package:avm_tech_platform/features/energy/data/models/meter_model.dart';
import 'package:avm_tech_platform/features/energy/data/models/reading_model.dart';

final energyDashboardProvider = FutureProvider.autoDispose
    .family<List<EnergyDashboardItem>, ({int year, int month})>((ref, period) async {
  final data = await Api.client.rpc(
    'rpc_energy_dashboard_summary',
    params: {'p_year': period.year, 'p_month': period.month},
  );
  if (data is! List) return const [];
  return data
      .map((e) => EnergyDashboardItem.fromJson(Map<String, dynamic>.from(e as Map)))
      .toList();
});

final metersProvider =
    FutureProvider.autoDispose.family<List<MeterModel>, String?>((ref, meterType) async {
  final rows = await LocalLookupCache.instance.readThrough(
    key: 'meters_${meterType ?? 'all'}',
    fetchRemote: () async {
      var q = Api.client
          .from('meters')
          .select('*, equipments(code, name)')
          .eq('is_active', true)
          .isFilter('deleted_at', null);
      if (meterType != null) {
        q = q.eq('meter_type', meterType);
      }
      final data = await q.order('sort_order').order('name');
      return (data as List)
          .map((e) => Map<String, dynamic>.from(e as Map))
          .toList();
    },
  );
  return rows.map((e) => MeterModel.fromJson(e)).toList();
});

final trashedMetersProvider =
    FutureProvider.autoDispose<List<TrashedMeterItem>>((ref) async {
  final data = await Api.client.rpc('rpc_list_trashed_meters');
  if (data is! List) return const [];
  return data
      .map((e) => TrashedMeterItem.fromJson(Map<String, dynamic>.from(e as Map)))
      .toList();
});

final meterDetailProvider =
    FutureProvider.autoDispose.family<MeterModel, String>((ref, meterId) async {
  final data = await Api.client
      .from('meters')
      .select('*, equipments(code, name)')
      .eq('id', meterId)
      .single();
  return MeterModel.fromJson(Map<String, dynamic>.from(data));
});

final meterReadingsProvider =
    FutureProvider.autoDispose.family<List<MeterReadingModel>, String>((ref, meterId) async {
  final data = await Api.client
      .from('meter_readings')
      .select('id, meter_id, reading_date, active_value, inductive_value, capacitive_value, inductive_percent, capacitive_percent, index_value, consumption, entered_by_id, entered_by_name, notes, created_at')
      .eq('meter_id', meterId)
      .order('reading_date', ascending: false)
      .limit(200);
  return (data as List)
      .map((e) => MeterReadingModel.fromJson(Map<String, dynamic>.from(e as Map)))
      .toList();
});

final energyInvoicesProvider =
    FutureProvider.autoDispose.family<List<EnergyInvoiceModel>, int>((ref, year) async {
  final data = await Api.client
      .from('energy_invoices')
      .select('id, period_year, period_month, utility_type, provider, invoice_no, invoice_date, invoice_type, meter_id, meter_name, meter_no, contract_no, eic_code, tekil_code, subscriber_no, consumption, amount_tl, inductive_penalty_tl, capacitive_penalty_tl, tenant_consumption, tenant_amount_tl, pdf_storage_path, notes, entered_by_name, created_at')
      .eq('period_year', year)
      .order('period_month', ascending: false)
      .order('meter_name');
  return (data as List)
      .map((e) => EnergyInvoiceModel.fromJson(Map<String, dynamic>.from(e as Map)))
      .toList();
});

final energyBudgetsProvider =
    FutureProvider.autoDispose.family<List<EnergyBudgetModel>, int>((ref, year) async {
  final data = await Api.client
      .from('energy_budgets')
      .select('id, period_year, period_month, utility_type, budget_consumption, budget_tl, prev_year_consumption, prev_year_tl')
      .eq('period_year', year)
      .order('period_month');
  return (data as List)
      .map((e) => EnergyBudgetModel.fromJson(Map<String, dynamic>.from(e as Map)))
      .toList();
});

class ReadingPageFilter {
  final String? meterId;
  final DateTime? fromDate;
  final DateTime? toDate;
  final int limit;
  final int offset;

  const ReadingPageFilter({
    this.meterId,
    this.fromDate,
    this.toDate,
    this.limit = 50,
    this.offset = 0,
  });

  @override
  bool operator ==(Object other) =>
      other is ReadingPageFilter &&
      other.meterId == meterId &&
      other.fromDate == fromDate &&
      other.toDate == toDate &&
      other.limit == limit &&
      other.offset == offset;

  @override
  int get hashCode =>
      Object.hash(meterId, fromDate, toDate, limit, offset);
}

final paginatedMeterReadingsProvider = FutureProvider.autoDispose
    .family<PaginatedResult<MeterReadingModel>, ReadingPageFilter>((ref, filter) async {
  final safeLimit = clampPageLimit(filter.limit);
  final safeOffset = clampPageOffset(filter.offset);
  final data = await Api.client.rpc(
    'rpc_list_meter_readings_paginated',
    params: {
      'p_meter_id': filter.meterId,
      'p_from_date': filter.fromDate?.toUtc().toIso8601String(),
      'p_to_date': filter.toDate?.toUtc().toIso8601String(),
      'p_limit': safeLimit,
      'p_offset': safeOffset,
    },
  );
  final rows = (data as List)
      .map((e) => Map<String, dynamic>.from(e as Map))
      .toList();
  final totalCount =
      rows.isEmpty ? 0 : (rows.first['total_count'] as num?)?.toInt() ?? rows.length;
  final items = rows.map(MeterReadingModel.fromJson).toList();
  return PaginatedResult(
    items: items,
    totalCount: totalCount,
    limit: safeLimit,
    offset: safeOffset,
  );
});

class InvoicePageFilter {
  final int? year;
  final String? utilityType;
  final int limit;
  final int offset;

  const InvoicePageFilter({
    this.year,
    this.utilityType,
    this.limit = 50,
    this.offset = 0,
  });

  @override
  bool operator ==(Object other) =>
      other is InvoicePageFilter &&
      other.year == year &&
      other.utilityType == utilityType &&
      other.limit == limit &&
      other.offset == offset;

  @override
  int get hashCode => Object.hash(year, utilityType, limit, offset);
}

final paginatedInvoicesProvider = FutureProvider.autoDispose
    .family<PaginatedResult<EnergyInvoiceModel>, InvoicePageFilter>((ref, filter) async {
  final safeLimit = clampPageLimit(filter.limit);
  final safeOffset = clampPageOffset(filter.offset);
  final data = await Api.client.rpc(
    'rpc_list_energy_invoices_paginated',
    params: {
      'p_year': filter.year,
      'p_utility_type': filter.utilityType,
      'p_limit': safeLimit,
      'p_offset': safeOffset,
    },
  );
  final rows = (data as List)
      .map((e) => Map<String, dynamic>.from(e as Map))
      .toList();
  final totalCount =
      rows.isEmpty ? 0 : (rows.first['total_count'] as num?)?.toInt() ?? rows.length;
  final items = rows.map(EnergyInvoiceModel.fromJson).toList();
  return PaginatedResult(
    items: items,
    totalCount: totalCount,
    limit: safeLimit,
    offset: safeOffset,
  );
});

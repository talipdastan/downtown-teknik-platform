import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:avm_tech_platform/core/database/local_lookup_cache.dart';
import 'package:avm_tech_platform/core/database/pagination.dart';
import 'package:avm_tech_platform/core/network/api_client.dart';
import 'package:avm_tech_platform/features/work_tracking/data/models/extra_models.dart';
import 'package:avm_tech_platform/features/work_tracking/data/models/ticket_model.dart';

List<Map<String, dynamic>> _rows(dynamic data) {
  return (data as List).map((e) => Map<String, dynamic>.from(e as Map)).toList();
}

const String _ticketSelect =
    '*, profiles(full_name), locations(name, floors(name)), categories(name), equipments(code, name)';

const String _workOrderSelect =
    '*, tickets(ticket_number, description, priority, status, locations(name, floors(name)), categories(name)), departments(name)';

// ---------- Açılır liste verileri (gerçek tablolar) ----------

final floorsProvider = FutureProvider.autoDispose<List<LookupItem>>((ref) async {
  final rows = await LocalLookupCache.instance.readThrough(
    key: 'floors',
    fetchRemote: () async {
      final data = await Api.client
          .from('floors')
          .select('id, name')
          .eq('is_active', true)
          .order('sort_order');
      return _rows(data);
    },
  );
  return rows.map((r) => LookupItem.fromJson(r)).toList();
});

final locationsByFloorProvider =
    FutureProvider.autoDispose.family<List<LookupItem>, String>((ref, floorId) async {
  final rows = await LocalLookupCache.instance.readThrough(
    key: 'locations_$floorId',
    fetchRemote: () async {
      final data = await Api.client
          .from('locations')
          .select('id, name, floor_id')
          .eq('is_active', true)
          .eq('floor_id', floorId)
          .order('name');
      return _rows(data);
    },
  );
  return rows.map((r) => LookupItem.fromJson(r, parentKey: 'floor_id')).toList();
});

final categoriesProvider = FutureProvider.autoDispose<List<LookupItem>>((ref) async {
  final rows = await LocalLookupCache.instance.readThrough(
    key: 'categories',
    fetchRemote: () async {
      final data = await Api.client
          .from('categories')
          .select('id, name')
          .eq('is_active', true)
          .order('name');
      return _rows(data);
    },
  );
  return rows.map((r) => LookupItem.fromJson(r)).toList();
});

// ---------- Arızalar ----------

/// RLS gereği personel yalnızca kendi arızalarını, yönetim tümünü görür.
final ticketsProvider = FutureProvider.autoDispose<List<TicketModel>>((ref) async {
  final data = await Api.client
      .from('tickets')
      .select(_ticketSelect)
      .order('created_at', ascending: false)
      .limit(300);
  return _rows(data).map((r) => TicketModel.fromJson(r)).toList();
});

final ticketDetailProvider =
    FutureProvider.autoDispose.family<TicketModel, String>((ref, id) async {
  final data = await Api.client.from('tickets').select(_ticketSelect).eq('id', id).single();
  return TicketModel.fromJson(Map<String, dynamic>.from(data));
});

final ticketHistoryProvider =
    FutureProvider.autoDispose.family<List<StatusHistoryModel>, String>((ref, id) async {
  final data = await Api.client
      .from('status_history')
      .select('id, ticket_id, old_status, new_status, changed_by, change_note, created_at, profiles(full_name)')
      .eq('ticket_id', id)
      .order('created_at');
  return _rows(data).map((r) => StatusHistoryModel.fromJson(r)).toList();
});

final ticketCommentsProvider =
    FutureProvider.autoDispose.family<List<CommentModel>, String>((ref, id) async {
  final data = await Api.client
      .from('comments')
      .select('id, ticket_id, work_order_id, user_id, comment, created_at, profiles(full_name)')
      .eq('ticket_id', id)
      .order('created_at');
  return _rows(data).map((r) => CommentModel.fromJson(r)).toList();
});

final ticketAttachmentsProvider =
    FutureProvider.autoDispose.family<List<AttachmentModel>, String>((ref, id) async {
  final data = await Api.client
      .from('attachments')
      .select('id, ticket_id, work_order_id, uploaded_by, file_path, file_name, mime_type, attachment_type, created_at')
      .eq('ticket_id', id)
      .order('created_at');
  return _rows(data).map((r) => AttachmentModel.fromJson(r)).toList();
});

// ---------- İş emirleri ----------

/// Yalnızca oturum açan kullanıcıya atanmış iş emirleri.
final myWorkOrdersProvider = FutureProvider.autoDispose<List<WorkOrderView>>((ref) async {
  final uid = Api.userId;
  final data = await Api.client
      .from('work_orders')
      .select('$_workOrderSelect, work_order_assignments!inner(user_id)')
      .eq('work_order_assignments.user_id', uid)
      .neq('status', 'cancelled')
      .order('created_at', ascending: false);
  return _rows(data).map((r) => WorkOrderView.fromJson(r)).toList();
});

final workOrderViewProvider =
    FutureProvider.autoDispose.family<WorkOrderView, String>((ref, id) async {
  final data = await Api.client.from('work_orders').select(_workOrderSelect).eq('id', id).single();
  return WorkOrderView.fromJson(Map<String, dynamic>.from(data));
});

final workOrderMaterialsProvider =
    FutureProvider.autoDispose.family<List<MaterialModel>, String>((ref, id) async {
  final data = await Api.client
      .from('work_order_materials')
      .select('id, work_order_id, material_name, quantity, unit, note, recorded_by, created_at')
      .eq('work_order_id', id)
      .order('created_at');
  return _rows(data).map((r) => MaterialModel.fromJson(r)).toList();
});

final workOrderAttachmentsProvider =
    FutureProvider.autoDispose.family<List<AttachmentModel>, String>((ref, id) async {
  final data = await Api.client
      .from('attachments')
      .select('id, ticket_id, work_order_id, uploaded_by, file_path, file_name, mime_type, attachment_type, created_at')
      .eq('work_order_id', id)
      .order('created_at');
  return _rows(data).map((r) => AttachmentModel.fromJson(r)).toList();
});

// ---------- Yönetici İş Emirleri (Atama & Onay) ----------

class TechnicianOption {
  final String id;
  final String fullName;
  final String? departmentId;

  const TechnicianOption({
    required this.id,
    required this.fullName,
    this.departmentId,
  });

  factory TechnicianOption.fromJson(Map<String, dynamic> json) {
    return TechnicianOption(
      id: json['id'] as String,
      fullName: json['full_name'] as String? ?? 'İsimsiz',
      departmentId: json['department_id'] as String?,
    );
  }
}

final activeDepartmentsProvider = FutureProvider.autoDispose<List<LookupItem>>((ref) async {
  final rows = await LocalLookupCache.instance.readThrough(
    key: 'active_departments',
    fetchRemote: () async {
      final data = await Api.client
          .from('departments')
          .select('id, name')
          .eq('is_active', true)
          .order('name');
      return _rows(data);
    },
  );
  return rows.map((r) => LookupItem.fromJson(r)).toList();
});

final approvedTechniciansProvider =
    FutureProvider.autoDispose<List<TechnicianOption>>((ref) async {
  final rows = await LocalLookupCache.instance.readThrough(
    key: 'approved_technicians',
    fetchRemote: () async {
      final data = await Api.client
          .from('profiles')
          .select('id, full_name, department_id')
          .inFilter('role', ['technician', 'team_lead'])
          .eq('approval_status', 'approved')
          .order('full_name');
      return _rows(data);
    },
  );
  return rows.map((r) => TechnicianOption.fromJson(r)).toList();
});

final pendingAssignmentTicketsProvider =
    FutureProvider.autoDispose<List<TicketModel>>((ref) async {
  final data = await Api.client
      .from('tickets')
      .select(_ticketSelect)
      .inFilter('status', ['new', 'under_review'])
      .order('created_at', ascending: false)
      .limit(200);
  return _rows(data).map((r) => TicketModel.fromJson(r)).toList();
});

/// İş Takip modülündeki herhangi bir ekranda işlem yapıldığında (arıza açma,
/// iş emri atama, işe başlama, bekletme, tamamlama, onay/iade) tüm ilgili
/// listeleri ve sayaçları tek seferde anında yeniler.
void invalidateAllWorkTrackingProviders(WidgetRef ref, [String? entityId]) {
  ref.invalidate(ticketsProvider);
  ref.invalidate(paginatedTicketsProvider);
  ref.invalidate(myWorkOrdersProvider);
  ref.invalidate(pendingAssignmentTicketsProvider);
  ref.invalidate(pendingReviewTicketsProvider);
  ref.invalidate(activeManagerWorkOrdersProvider);
  if (entityId != null) {
    ref.invalidate(ticketDetailProvider(entityId));
    ref.invalidate(ticketHistoryProvider(entityId));
    ref.invalidate(ticketCommentsProvider(entityId));
    ref.invalidate(ticketAttachmentsProvider(entityId));
    ref.invalidate(workOrderViewProvider(entityId));
    ref.invalidate(workOrderMaterialsProvider(entityId));
    ref.invalidate(workOrderAttachmentsProvider(entityId));
  }
}

final pendingReviewTicketsProvider =
    FutureProvider.autoDispose<List<TicketModel>>((ref) async {
  final data = await Api.client
      .from('tickets')
      .select(_ticketSelect)
      .eq('status', 'resolved')
      .order('resolved_at', ascending: false)
      .limit(200);
  return _rows(data).map((r) => TicketModel.fromJson(r)).toList();
});

final activeManagerWorkOrdersProvider =
    FutureProvider.autoDispose<List<WorkOrderView>>((ref) async {
  final data = await Api.client
      .from('work_orders')
      .select(_workOrderSelect)
      .inFilter('status', ['assigned', 'in_progress', 'waiting'])
      .order('created_at', ascending: false)
      .limit(200);
  return _rows(data).map((r) => WorkOrderView.fromJson(r)).toList();
});

class TicketPageFilter {
  final String? status;
  final String? priority;
  final String? equipmentId;
  final String? search;
  final int limit;
  final int offset;

  const TicketPageFilter({
    this.status,
    this.priority,
    this.equipmentId,
    this.search,
    this.limit = 25,
    this.offset = 0,
  });

  @override
  bool operator ==(Object other) =>
      other is TicketPageFilter &&
      other.status == status &&
      other.priority == priority &&
      other.equipmentId == equipmentId &&
      other.search == search &&
      other.limit == limit &&
      other.offset == offset;

  @override
  int get hashCode =>
      Object.hash(status, priority, equipmentId, search, limit, offset);
}

/// Sunucu taraflı sayfalamalı & RLS korumalı arıza listesi (`rpc_list_tickets_paginated`).
final paginatedTicketsProvider = FutureProvider.autoDispose
    .family<PaginatedResult<TicketModel>, TicketPageFilter>((ref, filter) async {
  final safeLimit = clampPageLimit(filter.limit);
  final safeOffset = clampPageOffset(filter.offset);
  final data = await Api.client.rpc(
    'rpc_list_tickets_paginated',
    params: {
      'p_status': filter.status,
      'p_priority': filter.priority,
      'p_equipment_id': filter.equipmentId,
      'p_search': filter.search,
      'p_limit': safeLimit,
      'p_offset': safeOffset,
    },
  );
  final list = _rows(data);
  final totalCount =
      list.isEmpty ? 0 : (list.first['total_count'] as num?)?.toInt() ?? list.length;
  final items = list
      .map((r) => TicketModel(
            id: r['id'] as String,
            ticketNumber: r['ticket_number'] as String?,
            reporterId: r['reporter_id'] as String,
            reporterName: r['reporter_name'] as String?,
            customLocation: r['location_label'] as String?,
            customCategory: r['category_name'] as String?,
            equipmentId: r['equipment_id'] as String?,
            equipmentCode: r['equipment_code'] as String?,
            equipmentName: r['equipment_name'] as String?,
            priority: r['priority'] as String? ?? 'normal',
            status: r['status'] as String? ?? 'new',
            description: r['description'] as String? ?? '',
            createdAt: DateTime.parse(r['created_at'] as String),
          ))
      .toList();

  return PaginatedResult(
    items: items,
    totalCount: totalCount,
    limit: safeLimit,
    offset: safeOffset,
  );
});

/// İş Takip modülü merkezi veri yazma/RPC katmanı (UI ekranlarını Supabase'ten ayırır).
class WorkTrackingRepository {
  static Future<void> insertTicket(Map<String, dynamic> payload) async {
    await Api.client.from('tickets').insert(payload);
  }

  static Future<void> managerCloseTicket({
    required String ticketId,
    required String resolutionNote,
    required bool reopen,
  }) async {
    await Api.client.rpc('rpc_manager_close_ticket', params: {
      'p_ticket_id': ticketId,
      'p_resolution_note': resolutionNote,
      'p_reopen': reopen,
    });
  }

  static Future<void> createWorkOrder({
    required String ticketId,
    required String departmentId,
    required List<String> assignedUserIds,
    String? workDescription,
  }) async {
    await Api.client.rpc('rpc_create_work_order', params: {
      'p_ticket_id': ticketId,
      'p_department_id': departmentId,
      'p_assigned_user_ids': assignedUserIds,
      'p_work_description': workDescription,
    });
  }

  static Future<void> technicianStartWork(String workOrderId) async {
    await Api.client.rpc('rpc_technician_start_work', params: {
      'p_work_order_id': workOrderId,
    });
  }

  static Future<void> technicianPauseWork(
    String workOrderId,
    String waitingReason,
  ) async {
    await Api.client.rpc('rpc_technician_pause_work', params: {
      'p_work_order_id': workOrderId,
      'p_waiting_reason': waitingReason,
    });
  }

  static Future<void> addWorkOrderMaterial({
    required String workOrderId,
    required String materialName,
    required double quantity,
    required String unit,
    String? recordedBy,
  }) async {
    await Api.client.from('work_order_materials').insert({
      'work_order_id': workOrderId,
      'material_name': materialName,
      'quantity': quantity,
      'unit': unit,
      'recorded_by': recordedBy ?? Api.userId,
    });
  }

  static Future<void> technicianCompleteWork({
    required String workOrderId,
    String? note,
  }) async {
    await Api.client.rpc('rpc_technician_complete_work', params: {
      'p_work_order_id': workOrderId,
      'p_note': note,
    });
  }
}

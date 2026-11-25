import 'package:avm_tech_platform/features/work_tracking/data/models/work_order_model.dart';

DateTime _parseDate(dynamic value) {
  if (value is String) return DateTime.tryParse(value) ?? DateTime.now();
  return DateTime.now();
}

Map<String, dynamic>? _asMap(dynamic value) {
  if (value is Map) return Map<String, dynamic>.from(value);
  return null;
}

/// Kat / kategori / mahal açılır listeleri için hafif model.
class LookupItem {
  final String id;
  final String name;
  final String? parentId;

  const LookupItem({required this.id, required this.name, this.parentId});

  factory LookupItem.fromJson(Map<String, dynamic> json, {String? parentKey}) {
    return LookupItem(
      id: json['id'] as String,
      name: json['name'] as String? ?? '-',
      parentId: parentKey != null ? json[parentKey] as String? : null,
    );
  }
}

class AttachmentModel {
  final String id;
  final String? ticketId;
  final String? workOrderId;
  final String filePath;
  final String? fileName;
  final String? mimeType;
  final String attachmentType;
  final DateTime createdAt;

  const AttachmentModel({
    required this.id,
    this.ticketId,
    this.workOrderId,
    required this.filePath,
    this.fileName,
    this.mimeType,
    this.attachmentType = 'general',
    required this.createdAt,
  });

  bool get isImage => (mimeType ?? '').startsWith('image/');

  String get typeLabel {
    switch (attachmentType) {
      case 'before':
        return 'Öncesi';
      case 'after':
        return 'Sonrası';
      default:
        return 'Genel';
    }
  }

  factory AttachmentModel.fromJson(Map<String, dynamic> json) {
    return AttachmentModel(
      id: json['id'] as String,
      ticketId: json['ticket_id'] as String?,
      workOrderId: json['work_order_id'] as String?,
      filePath: json['file_path'] as String? ?? '',
      fileName: json['file_name'] as String?,
      mimeType: json['mime_type'] as String?,
      attachmentType: json['attachment_type'] as String? ?? 'general',
      createdAt: _parseDate(json['created_at']),
    );
  }
}

class CommentModel {
  final String id;
  final String comment;
  final String? authorName;
  final DateTime createdAt;

  const CommentModel({
    required this.id,
    required this.comment,
    this.authorName,
    required this.createdAt,
  });

  factory CommentModel.fromJson(Map<String, dynamic> json) {
    return CommentModel(
      id: json['id'] as String,
      comment: json['comment'] as String? ?? '',
      authorName: _asMap(json['profiles'])?['full_name'] as String?,
      createdAt: _parseDate(json['created_at']),
    );
  }
}

class StatusHistoryModel {
  final String id;
  final String? oldStatus;
  final String newStatus;
  final String? changedByName;
  final String? changeNote;
  final DateTime createdAt;

  const StatusHistoryModel({
    required this.id,
    this.oldStatus,
    required this.newStatus,
    this.changedByName,
    this.changeNote,
    required this.createdAt,
  });

  factory StatusHistoryModel.fromJson(Map<String, dynamic> json) {
    return StatusHistoryModel(
      id: json['id'] as String,
      oldStatus: json['old_status'] as String?,
      newStatus: json['new_status'] as String? ?? '',
      changedByName: _asMap(json['profiles'])?['full_name'] as String?,
      changeNote: json['change_note'] as String?,
      createdAt: _parseDate(json['created_at']),
    );
  }
}

class MaterialModel {
  final String id;
  final String materialName;
  final num quantity;
  final String? unit;
  final String? note;

  const MaterialModel({
    required this.id,
    required this.materialName,
    required this.quantity,
    this.unit,
    this.note,
  });

  factory MaterialModel.fromJson(Map<String, dynamic> json) {
    return MaterialModel(
      id: json['id'] as String,
      materialName: json['material_name'] as String? ?? '-',
      quantity: json['quantity'] as num? ?? 0,
      unit: json['unit'] as String?,
      note: json['note'] as String?,
    );
  }
}

/// İş emri + bağlı arıza + mahal bilgisi (tek sorguda join ile gelir).
class WorkOrderView {
  final WorkOrderModel order;
  final String? ticketDescription;
  final String? ticketPriority;
  final String? ticketStatus;
  final String? locationLabel;
  final String? categoryName;

  const WorkOrderView({
    required this.order,
    this.ticketDescription,
    this.ticketPriority,
    this.ticketStatus,
    this.locationLabel,
    this.categoryName,
  });

  factory WorkOrderView.fromJson(Map<String, dynamic> json) {
    final ticket = _asMap(json['tickets']);
    final location = _asMap(ticket?['locations']);
    final floor = _asMap(location?['floors']);
    final category = _asMap(ticket?['categories']);

    final parts = <String>[
      if (floor?['name'] is String) floor!['name'] as String,
      if (location?['name'] is String) location!['name'] as String,
    ];

    return WorkOrderView(
      order: WorkOrderModel.fromJson(json),
      ticketDescription: ticket?['description'] as String?,
      ticketPriority: ticket?['priority'] as String?,
      ticketStatus: ticket?['status'] as String?,
      locationLabel: parts.isEmpty ? null : parts.join(' - '),
      categoryName: category?['name'] as String?,
    );
  }
}

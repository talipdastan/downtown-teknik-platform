class TicketModel {
  final String id;
  final String? ticketNumber;
  final String reporterId;
  final String? reporterName;
  final String? locationId;
  final String? locationName;
  final String? customLocation;
  final String? floorName;
  final String? categoryId;
  final String? categoryName;
  final String? customCategory;
  final String? equipmentId;
  final String? equipmentCode;
  final String? equipmentName;
  final String priority;
  final String status;
  final String description;
  final String? cancellationReason;
  final DateTime createdAt;
  final DateTime? resolvedAt;
  final DateTime? closedAt;

  TicketModel({
    required this.id,
    this.ticketNumber,
    required this.reporterId,
    this.reporterName,
    this.locationId,
    this.locationName,
    this.customLocation,
    this.floorName,
    this.categoryId,
    this.categoryName,
    this.customCategory,
    this.equipmentId,
    this.equipmentCode,
    this.equipmentName,
    this.priority = 'normal',
    this.status = 'new',
    required this.description,
    this.cancellationReason,
    required this.createdAt,
    this.resolvedAt,
    this.closedAt,
  });

  factory TicketModel.fromJson(Map<String, dynamic> json) {
    return TicketModel(
      id: json['id'] as String,
      ticketNumber: json['ticket_number'] as String?,
      reporterId: json['reporter_id'] as String,
      reporterName: json['profiles'] != null ? json['profiles']['full_name'] as String? : null,
      locationId: json['location_id'] as String?,
      locationName: json['locations'] != null ? json['locations']['name'] as String? : null,
      customLocation: json['custom_location'] as String?,
      floorName: json['locations'] != null && json['locations']['floors'] != null
          ? json['locations']['floors']['name'] as String?
          : null,
      categoryId: json['category_id'] as String?,
      categoryName: json['categories'] != null ? json['categories']['name'] as String? : null,
      customCategory: json['custom_category'] as String?,
      equipmentId: json['equipment_id'] as String?,
      equipmentCode: json['equipments'] is Map ? (json['equipments'] as Map)['code'] as String? : null,
      equipmentName: json['equipments'] is Map ? (json['equipments'] as Map)['name'] as String? : null,
      priority: json['priority'] as String? ?? 'normal',
      status: json['status'] as String? ?? 'new',
      description: json['description'] as String? ?? '',
      cancellationReason: json['cancellation_reason'] as String?,
      createdAt: DateTime.tryParse(json['created_at'] as String? ?? '') ?? DateTime.now(),
      resolvedAt: json['resolved_at'] != null ? DateTime.tryParse(json['resolved_at'] as String) : null,
      closedAt: json['closed_at'] != null ? DateTime.tryParse(json['closed_at'] as String) : null,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'ticket_number': ticketNumber,
      'reporter_id': reporterId,
      'location_id': locationId,
      'custom_location': customLocation,
      'category_id': categoryId,
      'custom_category': customCategory,
      'priority': priority,
      'status': status,
      'description': description,
    };
  }
}


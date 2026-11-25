class WorkOrderModel {
  final String id;
  final String ticketId;
  final String? ticketNumber;
  final String departmentId;
  final String? departmentName;
  final String status;
  final String createdBy;
  final String? workDescription;
  final String? waitingReason;
  final DateTime? startedAt;
  final DateTime? completedAt;
  final DateTime createdAt;

  WorkOrderModel({
    required this.id,
    required this.ticketId,
    this.ticketNumber,
    required this.departmentId,
    this.departmentName,
    this.status = 'assigned',
    required this.createdBy,
    this.workDescription,
    this.waitingReason,
    this.startedAt,
    this.completedAt,
    required this.createdAt,
  });

  factory WorkOrderModel.fromJson(Map<String, dynamic> json) {
    return WorkOrderModel(
      id: json['id'] as String,
      ticketId: json['ticket_id'] as String,
      ticketNumber: json['tickets'] != null ? json['tickets']['ticket_number'] as String? : null,
      departmentId: json['department_id'] as String,
      departmentName: json['departments'] != null ? json['departments']['name'] as String? : null,
      status: json['status'] as String? ?? 'assigned',
      createdBy: json['created_by'] as String? ?? '',
      workDescription: json['work_description'] as String?,
      waitingReason: json['waiting_reason'] as String?,
      startedAt: json['started_at'] != null ? DateTime.tryParse(json['started_at'] as String) : null,
      completedAt: json['completed_at'] != null ? DateTime.tryParse(json['completed_at'] as String) : null,
      createdAt: DateTime.tryParse(json['created_at'] as String? ?? '') ?? DateTime.now(),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'ticket_id': ticketId,
      'department_id': departmentId,
      'status': status,
      'created_by': createdBy,
      'work_description': workDescription,
      'waiting_reason': waitingReason,
    };
  }
}


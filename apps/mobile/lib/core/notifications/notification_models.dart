/// Modül-bağımsız merkezi bildirim modeli (`public.notifications`).
class AppNotification {
  final String id;
  final String moduleKey;
  final String? entityType;
  final String? entityId;
  final String title;
  final String message;
  final bool isRead;
  final DateTime createdAt;

  const AppNotification({
    required this.id,
    required this.moduleKey,
    this.entityType,
    this.entityId,
    required this.title,
    required this.message,
    required this.isRead,
    required this.createdAt,
  });

  factory AppNotification.fromJson(Map<String, dynamic> json) {
    return AppNotification(
      id: json['id'] as String,
      moduleKey: json['module_key'] as String? ?? 'system',
      entityType: json['entity_type'] as String?,
      entityId: json['entity_id'] as String?,
      title: json['title'] as String? ?? '',
      message: json['message'] as String? ?? '',
      isRead: json['is_read'] as bool? ?? false,
      createdAt:
          DateTime.tryParse(json['created_at'] as String? ?? '') ?? DateTime.now(),
    );
  }
}

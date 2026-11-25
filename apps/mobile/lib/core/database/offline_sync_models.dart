/// ARCHITECTURE.md Bölüm 5'te tanımlanan offline senkronizasyon
/// durum makinesi, tekrar deneme politikası, çakışma çözümü ve fotoğraf kuyruğu modelleri.
enum SyncStatus {
  pending,
  syncing,
  synced,
  failed,
  conflict,
}

enum ConflictResolutionStrategy {
  keepServer,
  reapplyLocal,
}

class OfflineRetryPolicy {
  static const int maxAutoRetries = 5;
  static const List<Duration> backoffSteps = [
    Duration(seconds: 10),
    Duration(seconds: 30),
    Duration(minutes: 2),
    Duration(minutes: 10),
    Duration(minutes: 30),
  ];

  static Duration? nextDelay(int retryCount) {
    if (retryCount >= maxAutoRetries) return null;
    return backoffSteps[retryCount.clamp(0, backoffSteps.length - 1)];
  }
}

class LocalSyncQueueItem {
  final String clientMutationId;
  final String moduleKey;
  final String entityType;
  final String operation; // 'insert' | 'update'
  final Map<String, dynamic> payload;
  final DateTime? baseUpdatedAt;
  final SyncStatus status;
  final int retryCount;
  final bool isPermanentError;
  final String? lastError;
  final DateTime? nextRetryAt;
  final Map<String, dynamic>? serverSnapshot;
  final DateTime createdAt;

  const LocalSyncQueueItem({
    required this.clientMutationId,
    required this.moduleKey,
    required this.entityType,
    required this.operation,
    required this.payload,
    this.baseUpdatedAt,
    this.status = SyncStatus.pending,
    this.retryCount = 0,
    this.isPermanentError = false,
    this.lastError,
    this.nextRetryAt,
    this.serverSnapshot,
    required this.createdAt,
  });

  bool get canAutoRetry =>
      status == SyncStatus.failed &&
      !isPermanentError &&
      retryCount < OfflineRetryPolicy.maxAutoRetries;

  bool isReadyForAutoRetry(DateTime now) {
    if (!canAutoRetry) return false;
    return nextRetryAt == null || !now.isBefore(nextRetryAt!);
  }

  LocalSyncQueueItem copyWith({
    Map<String, dynamic>? payload,
    DateTime? baseUpdatedAt,
    SyncStatus? status,
    int? retryCount,
    bool? isPermanentError,
    String? lastError,
    bool clearLastError = false,
    DateTime? nextRetryAt,
    bool clearNextRetryAt = false,
    Map<String, dynamic>? serverSnapshot,
    bool clearServerSnapshot = false,
  }) {
    return LocalSyncQueueItem(
      clientMutationId: clientMutationId,
      moduleKey: moduleKey,
      entityType: entityType,
      operation: operation,
      payload: payload ?? this.payload,
      baseUpdatedAt: baseUpdatedAt ?? this.baseUpdatedAt,
      status: status ?? this.status,
      retryCount: retryCount ?? this.retryCount,
      isPermanentError: isPermanentError ?? this.isPermanentError,
      lastError: clearLastError ? null : (lastError ?? this.lastError),
      nextRetryAt: clearNextRetryAt ? null : (nextRetryAt ?? this.nextRetryAt),
      serverSnapshot: clearServerSnapshot
          ? null
          : (serverSnapshot ?? this.serverSnapshot),
      createdAt: createdAt,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'client_mutation_id': clientMutationId,
      'module_key': moduleKey,
      'entity_type': entityType,
      'operation': operation,
      'payload': payload,
      'base_updated_at': baseUpdatedAt?.toUtc().toIso8601String(),
      'status': status.name,
      'retry_count': retryCount,
      'is_permanent_error': isPermanentError,
      'last_error': lastError,
      'next_retry_at': nextRetryAt?.toUtc().toIso8601String(),
      'server_snapshot': serverSnapshot,
      'created_at': createdAt.toUtc().toIso8601String(),
    };
  }

  factory LocalSyncQueueItem.fromJson(Map<String, dynamic> json) {
    final statusName = json['status'] as String? ?? 'pending';
    return LocalSyncQueueItem(
      clientMutationId: json['client_mutation_id'] as String,
      moduleKey: json['module_key'] as String,
      entityType: json['entity_type'] as String,
      operation: json['operation'] as String,
      payload: Map<String, dynamic>.from(json['payload'] as Map? ?? const {}),
      baseUpdatedAt: json['base_updated_at'] != null
          ? DateTime.tryParse(json['base_updated_at'] as String)
          : null,
      status: SyncStatus.values.firstWhere(
        (s) => s.name == statusName,
        orElse: () => SyncStatus.pending,
      ),
      retryCount: (json['retry_count'] as num?)?.toInt() ?? 0,
      isPermanentError: json['is_permanent_error'] as bool? ?? false,
      lastError: json['last_error'] as String?,
      nextRetryAt: json['next_retry_at'] != null
          ? DateTime.tryParse(json['next_retry_at'] as String)
          : null,
      serverSnapshot: json['server_snapshot'] is Map
          ? Map<String, dynamic>.from(json['server_snapshot'] as Map)
          : null,
      createdAt: DateTime.parse(json['created_at'] as String),
    );
  }
}

class LocalMediaQueueItem {
  final String id;
  final String parentMutationId;
  final String bucketName;
  final String localFilePath;
  final String? fileName;
  final String mimeType;
  final String attachmentType; // 'before' | 'after' | 'general'
  final String? uploadedStoragePath;
  final SyncStatus status;
  final int retryCount;
  final String? lastError;

  const LocalMediaQueueItem({
    required this.id,
    required this.parentMutationId,
    required this.bucketName,
    required this.localFilePath,
    this.fileName,
    this.mimeType = 'image/jpeg',
    this.attachmentType = 'before',
    this.uploadedStoragePath,
    this.status = SyncStatus.pending,
    this.retryCount = 0,
    this.lastError,
  });

  LocalMediaQueueItem copyWith({
    String? uploadedStoragePath,
    SyncStatus? status,
    int? retryCount,
    String? lastError,
    bool clearLastError = false,
  }) {
    return LocalMediaQueueItem(
      id: id,
      parentMutationId: parentMutationId,
      bucketName: bucketName,
      localFilePath: localFilePath,
      fileName: fileName,
      mimeType: mimeType,
      attachmentType: attachmentType,
      uploadedStoragePath: uploadedStoragePath ?? this.uploadedStoragePath,
      status: status ?? this.status,
      retryCount: retryCount ?? this.retryCount,
      lastError: clearLastError ? null : (lastError ?? this.lastError),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'parent_mutation_id': parentMutationId,
      'bucket_name': bucketName,
      'local_file_path': localFilePath,
      'file_name': fileName,
      'mime_type': mimeType,
      'attachment_type': attachmentType,
      'uploaded_storage_path': uploadedStoragePath,
      'status': status.name,
      'retry_count': retryCount,
      'last_error': lastError,
    };
  }

  factory LocalMediaQueueItem.fromJson(Map<String, dynamic> json) {
    final statusName = json['status'] as String? ?? 'pending';
    return LocalMediaQueueItem(
      id: json['id'] as String,
      parentMutationId: json['parent_mutation_id'] as String,
      bucketName: json['bucket_name'] as String,
      localFilePath: json['local_file_path'] as String,
      fileName: json['file_name'] as String?,
      mimeType: json['mime_type'] as String? ?? 'image/jpeg',
      attachmentType: json['attachment_type'] as String? ?? 'before',
      uploadedStoragePath: json['uploaded_storage_path'] as String?,
      status: SyncStatus.values.firstWhere(
        (s) => s.name == statusName,
        orElse: () => SyncStatus.pending,
      ),
      retryCount: (json['retry_count'] as num?)?.toInt() ?? 0,
      lastError: json['last_error'] as String?,
    );
  }
}

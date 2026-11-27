import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';
import 'package:path_provider/path_provider.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:uuid/uuid.dart';

import 'package:avm_tech_platform/core/config/supabase_config.dart';
import 'package:avm_tech_platform/core/database/offline_sync_engine.dart';
import 'package:avm_tech_platform/core/database/offline_sync_models.dart';
import 'package:avm_tech_platform/core/network/api_client.dart';
import 'package:avm_tech_platform/core/utils/app_utils.dart';
import 'package:avm_tech_platform/features/work_tracking/data/attachment_service.dart';

/// Uygulama geneli kalıcı çevrimdışı (offline) saha kuyruğu ve otomatik senkronizasyon servisi.
///
/// Bodrum, otopark ve makine daireleri gibi ağ bağlantısının koptuğu alanlarda:
///   1. Arıza kaydı (+ fotoğraflar) -> `rpc_sync_offline_ticket`
///   2. İş emri durum güncelleme / tamamlama (+ sonrası fotoğraf) -> `rpc_sync_offline_work_order_status`
///   3. Enerji sayaç okuma girişi -> `rpc_record_meter_reading` (`p_client_mutation_id`)
/// işlemlerini cihaz içi kalıcı JSON kuyruğuna kaydeder ve bağlantı geldiğinde
/// çift kayıt oluşturmadan (idempotent) sunucuya iletir.
class OfflineSyncService {
  OfflineSyncService._();

  static final OfflineSyncService instance = OfflineSyncService._();

  OfflineSyncEngine? _engine;
  Timer? _periodicTimer;
  bool _isSyncing = false;
  final ValueNotifier<int> pendingCountNotifier = ValueNotifier<int>(0);

  /// Hatanın geçici ağ/bağlantı kopması olup olmadığını tespit eder.
  static bool isLikelyNetworkError(Object error) {
    if (error is SocketException ||
        error is HandshakeException ||
        error is TimeoutException) {
      return true;
    }
    final msg = error.toString().toLowerCase();
    return msg.contains('socketexception') ||
        msg.contains('failed host lookup') ||
        msg.contains('connection refused') ||
        msg.contains('connection reset') ||
        msg.contains('connection closed') ||
        msg.contains('network is unreachable') ||
        msg.contains('clientexception') ||
        msg.contains('timed out') ||
        msg.contains('errno = 7') ||
        msg.contains('errno = 101') ||
        msg.contains('errno = 110');
  }

  Future<OfflineSyncEngine?> _ensureEngine() async {
    if (kIsWeb) return null;
    if (_engine != null) return _engine;

    final dir = await getApplicationDocumentsDirectory();
    final queueFile = File('${dir.path}/downtown_offline_queue.json');
    final storage = JsonFileOfflineQueueStorage(queueFile);

    _engine = OfflineSyncEngine(
      storage: storage,
      mediaUploader: _uploadQueuedMedia,
      mutationSender: _sendQueuedMutation,
    );
    await _refreshPendingCount();
    return _engine;
  }

  /// Arka planda 45 saniyede bir bekleyen kayıtları senkronize etmeyi dener.
  void startAutoSync({VoidCallback? onSynced}) {
    if (kIsWeb) return;
    _periodicTimer?.cancel();
    _periodicTimer = Timer.periodic(const Duration(seconds: 45), (_) async {
      final summary = await syncNow();
      if (summary != null && summary.syncedCount > 0) {
        onSynced?.call();
      }
    });
    // İlk açılışta yarım kalan kayıt varsa hemen dene
    unawaited(syncNow().then((summary) {
      if (summary != null && summary.syncedCount > 0) {
        onSynced?.call();
      }
    }));
  }

  void stopAutoSync() {
    _periodicTimer?.cancel();
    _periodicTimer = null;
  }

  Future<int> getPendingCount() async {
    final engine = await _ensureEngine();
    if (engine == null) return 0;
    final list = await engine.getMutations();
    final count = list.where((m) => m.status != SyncStatus.synced).length;
    pendingCountNotifier.value = count;
    return count;
  }

  Future<void> _refreshPendingCount() async {
    await getPendingCount();
  }

  Future<String> _persistMediaFile(XFile source, String mutationId) async {
    final dir = await getApplicationDocumentsDirectory();
    final mediaDir = Directory('${dir.path}/offline_media');
    if (!await mediaDir.exists()) {
      await mediaDir.create(recursive: true);
    }
    final safeName = source.name.replaceAll(RegExp(r'[^a-zA-Z0-9._-]'), '_');
    final dest = File(
      '${mediaDir.path}/${mutationId}_${DateTime.now().millisecondsSinceEpoch}_$safeName',
    );
    final bytes = await source.readAsBytes();
    await dest.writeAsBytes(bytes, flush: true);
    return dest.path;
  }

  /// İnternet yokken arıza kaydı (+ fotoğraflar) kuyruğa alınır.
  Future<LocalSyncQueueItem> enqueueTicket({
    required String clientMutationId,
    String? locationId,
    String? customLocation,
    String? categoryId,
    String? customCategory,
    String? equipmentId,
    required String priority,
    required String description,
    List<XFile> photos = const [],
  }) async {
    final engine = await _ensureEngine();
    if (engine == null) {
      throw OfflineSyncException.permanent(
        'Çevrimdışı kuyruk bu platformda desteklenmiyor.',
      );
    }

    final mediaItems = <LocalMediaQueueItem>[];
    for (final photo in photos) {
      final persistedPath = await _persistMediaFile(photo, clientMutationId);
      final mime = AppUtils.mimeFromFileName(photo.name) ?? 'image/jpeg';
      mediaItems.add(
        LocalMediaQueueItem(
          id: const Uuid().v4(),
          parentMutationId: clientMutationId,
          bucketName: AttachmentService.bucket,
          localFilePath: persistedPath,
          fileName: photo.name,
          mimeType: mime,
          attachmentType: 'general',
        ),
      );
    }

    final item = await engine.enqueueMutation(
      clientMutationId: clientMutationId,
      moduleKey: 'work_tracking',
      entityType: 'ticket',
      operation: 'insert',
      payload: {
        'location_id': locationId,
        'custom_location': customLocation,
        'category_id': categoryId,
        'custom_category': customCategory,
        'equipment_id': equipmentId,
        'priority': priority,
        'description': description,
      },
      attachments: mediaItems,
    );
    await _refreshPendingCount();
    return item;
  }

  /// İnternet yokken iş emri durum değişikliği (başlat / beklet / tamamla + fotoğraf) kuyruğa alınır.
  Future<LocalSyncQueueItem> enqueueWorkOrderStatus({
    required String workOrderId,
    required String targetStatus, // 'in_progress' | 'waiting' | 'completed'
    DateTime? baseUpdatedAt,
    String? waitingReason,
    String? note,
    XFile? afterPhoto,
  }) async {
    final engine = await _ensureEngine();
    if (engine == null) {
      throw OfflineSyncException.permanent(
        'Çevrimdışı kuyruk bu platformda desteklenmiyor.',
      );
    }

    final mutationId = const Uuid().v4();
    final mediaItems = <LocalMediaQueueItem>[];
    if (afterPhoto != null) {
      final persistedPath = await _persistMediaFile(afterPhoto, mutationId);
      final mime = AppUtils.mimeFromFileName(afterPhoto.name) ?? 'image/jpeg';
      mediaItems.add(
        LocalMediaQueueItem(
          id: const Uuid().v4(),
          parentMutationId: mutationId,
          bucketName: AttachmentService.bucket,
          localFilePath: persistedPath,
          fileName: afterPhoto.name,
          mimeType: mime,
          attachmentType: 'after',
        ),
      );
    }

    final item = await engine.enqueueMutation(
      clientMutationId: mutationId,
      moduleKey: 'work_tracking',
      entityType: 'work_order_status',
      operation: 'update',
      baseUpdatedAt: baseUpdatedAt,
      payload: {
        'work_order_id': workOrderId,
        'target_status': targetStatus,
        'waiting_reason': waitingReason,
        'note': note,
      },
      attachments: mediaItems,
    );
    await _refreshPendingCount();
    return item;
  }

  /// İnternet yokken enerji sayaç okuma kaydı kuyruğa alınır.
  Future<LocalSyncQueueItem> enqueueMeterReading({
    required String clientMutationId,
    required String meterId,
    required String readingDateIso,
    double? activeValue,
    double? inductiveValue,
    double? capacitiveValue,
    double? indexValue,
    String? notes,
    bool overwrite = false,
  }) async {
    final engine = await _ensureEngine();
    if (engine == null) {
      throw OfflineSyncException.permanent(
        'Çevrimdışı kuyruk bu platformda desteklenmiyor.',
      );
    }

    final item = await engine.enqueueMutation(
      clientMutationId: clientMutationId,
      moduleKey: 'energy',
      entityType: 'meter_reading',
      operation: 'insert',
      payload: {
        'p_meter_id': meterId,
        'p_reading_date': readingDateIso,
        'p_active_value': activeValue,
        'p_inductive_value': inductiveValue,
        'p_capacitive_value': capacitiveValue,
        'p_index_value': indexValue,
        'p_notes': notes,
        'p_overwrite': overwrite,
      },
    );
    await _refreshPendingCount();
    return item;
  }

  /// Bekleyen tüm çevrimdışı kayıtları sırayla sunucuya göndermeyi dener.
  Future<SyncBatchSummary?> syncNow() async {
    if (kIsWeb || _isSyncing) return null;
    if (SupabaseConfig.clientOrNull?.auth.currentUser == null) return null;

    final engine = await _ensureEngine();
    if (engine == null) return null;

    _isSyncing = true;
    try {
      final summary = await engine.processPending();
      await _cleanupSyncedQueue(engine);
      await _refreshPendingCount();
      return summary;
    } catch (_) {
      return null;
    } finally {
      _isSyncing = false;
    }
  }

  Future<void> _cleanupSyncedQueue(OfflineSyncEngine engine) async {
    final mutations = await engine.getMutations();
    final syncedIds = mutations
        .where((m) => m.status == SyncStatus.synced)
        .map((m) => m.clientMutationId)
        .toSet();
    if (syncedIds.isEmpty) return;

    final media = await engine.getMedia();
    for (final m in media) {
      if (syncedIds.contains(m.parentMutationId)) {
        try {
          final f = File(m.localFilePath);
          if (await f.exists()) await f.delete();
        } catch (_) {}
      }
    }

    final remainingMutations =
        mutations.where((m) => !syncedIds.contains(m.clientMutationId)).toList();
    final remainingMedia =
        media.where((m) => !syncedIds.contains(m.parentMutationId)).toList();
    await engine.storage.saveMutations(remainingMutations);
    await engine.storage.saveMedia(remainingMedia);
  }

  Future<String> _uploadQueuedMedia(LocalMediaQueueItem media) async {
    final file = File(media.localFilePath);
    if (!await file.exists()) {
      throw OfflineSyncException.permanent(
        'Yerel fotoğraf dosyası bulunamadı.',
      );
    }

    try {
      final bytes = await file.readAsBytes();
      final storagePath = AppUtils.buildStoragePath(
        userId: Api.userId,
        parentId: media.parentMutationId,
        fileName: media.fileName ?? 'photo.jpg',
        timestampMs: DateTime.now().millisecondsSinceEpoch,
      );
      await Api.client.storage.from(media.bucketName).uploadBinary(
            storagePath,
            bytes,
            fileOptions: FileOptions(contentType: media.mimeType),
          );
      return storagePath;
    } catch (e) {
      if (isLikelyNetworkError(e)) {
        throw OfflineSyncException.transient(e.toString());
      }
      throw OfflineSyncException.transient(e.toString());
    }
  }

  Future<OfflineMutationSendResult> _sendQueuedMutation(
    LocalSyncQueueItem item,
    List<LocalMediaQueueItem> uploadedMedia,
  ) async {
    try {
      if (item.entityType == 'ticket') {
        final attachmentsJson = uploadedMedia
            .where((m) => m.uploadedStoragePath != null)
            .map((m) => {
                  'file_path': m.uploadedStoragePath,
                  'file_name': m.fileName,
                  'mime_type': m.mimeType,
                  'attachment_type': m.attachmentType,
                })
            .toList();

        await Api.client.rpc(
          'rpc_sync_offline_ticket',
          params: {
            'p_client_mutation_id': item.clientMutationId,
            'p_location_id': item.payload['location_id'],
            'p_custom_location': item.payload['custom_location'],
            'p_category_id': item.payload['category_id'],
            'p_custom_category': item.payload['custom_category'],
            'p_equipment_id': item.payload['equipment_id'],
            'p_priority': item.payload['priority'] ?? 'normal',
            'p_description': item.payload['description'] ?? '',
            'p_attachments': attachmentsJson,
          },
        );
        return const OfflineMutationSendResult.synced();
      }

      if (item.entityType == 'work_order_status') {
        final workOrderId = item.payload['work_order_id'] as String;
        for (final m in uploadedMedia) {
          final path = m.uploadedStoragePath;
          if (path == null) continue;
          final existing = await Api.client
              .from('attachments')
              .select('id')
              .eq('work_order_id', workOrderId)
              .eq('file_path', path)
              .maybeSingle();
          if (existing == null) {
            await Api.client.from('attachments').insert({
              'work_order_id': workOrderId,
              'uploaded_by': Api.userId,
              'file_path': path,
              'file_name': m.fileName,
              'mime_type': m.mimeType,
              'attachment_type': m.attachmentType,
            });
          }
        }

        final res = await Api.client.rpc(
          'rpc_sync_offline_work_order_status',
          params: {
            'p_work_order_id': workOrderId,
            'p_target_status': item.payload['target_status'],
            'p_base_updated_at': item.baseUpdatedAt?.toUtc().toIso8601String(),
            'p_waiting_reason': item.payload['waiting_reason'],
            'p_note': item.payload['note'],
            'p_force_overwrite': item.payload['force_overwrite'] == true,
          },
        );

        final row = res is List && res.isNotEmpty
            ? Map<String, dynamic>.from(res.first as Map)
            : (res is Map ? Map<String, dynamic>.from(res) : null);

        if (row != null && row['sync_result'] == 'conflict') {
          return OfflineMutationSendResult.conflict(
            serverSnapshot: row,
            message: row['conflict_reason']?.toString(),
          );
        }
        return const OfflineMutationSendResult.synced();
      }

      if (item.entityType == 'meter_reading') {
        final params = Map<String, dynamic>.from(item.payload)
          ..['p_client_mutation_id'] = item.clientMutationId;
        await Api.client.rpc('rpc_record_meter_reading', params: params);
        return const OfflineMutationSendResult.synced();
      }

      throw OfflineSyncException.permanent(
        'Bilinmeyen çevrimdışı kayıt türü: ${item.entityType}',
      );
    } on PostgrestException catch (e) {
      final code = e.code ?? '';
      if (code == '42501' || code == 'P0001') {
        throw OfflineSyncException.permanent(e.message);
      }
      throw OfflineSyncException.transient(e.message);
    } catch (e) {
      if (e is OfflineSyncException) rethrow;
      throw OfflineSyncException.transient(e.toString());
    }
  }
}

final offlinePendingCountProvider = FutureProvider.autoDispose<int>((ref) {
  return OfflineSyncService.instance.getPendingCount();
});

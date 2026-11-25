import 'dart:async';
import 'dart:io';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path_provider/path_provider.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'package:avm_tech_platform/core/database/offline_sync_engine.dart';
import 'package:avm_tech_platform/core/database/offline_sync_models.dart';
import 'package:avm_tech_platform/core/network/api_client.dart';
import 'package:avm_tech_platform/core/utils/app_utils.dart';

bool _isPermanentPostgrestError(PostgrestException e) {
  final code = e.code ?? '';
  if (code == '42501' || code == '23502' || code == '23503' || code == '22P02') {
    return true;
  }
  final msg = e.message.toLowerCase();
  return msg.contains('erişim engellendi') ||
      msg.contains('row-level security') ||
      msg.contains('zorunludur') ||
      msg.contains('küçük olamaz');
}

/// Yerel kalıcı kuyruk deposu sağlayıcısı (uygulama belgeler dizini altında JSON dosyası).
final offlineSyncStorageProvider = Provider<OfflineQueueStorage>((ref) {
  return _LazyApplicationDocStorage();
});

class _LazyApplicationDocStorage implements OfflineQueueStorage {
  JsonFileOfflineQueueStorage? _delegate;

  Future<JsonFileOfflineQueueStorage> _ensureDelegate() async {
    if (_delegate != null) return _delegate!;
    final dir = await getApplicationDocumentsDirectory();
    _delegate = JsonFileOfflineQueueStorage(
      File('${dir.path}/avm_tech_offline_queue_v1.json'),
    );
    return _delegate!;
  }

  @override
  Future<List<LocalSyncQueueItem>> loadMutations() async =>
      (await _ensureDelegate()).loadMutations();

  @override
  Future<void> saveMutations(List<LocalSyncQueueItem> items) async =>
      (await _ensureDelegate()).saveMutations(items);

  @override
  Future<List<LocalMediaQueueItem>> loadMedia() async =>
      (await _ensureDelegate()).loadMedia();

  @override
  Future<void> saveMedia(List<LocalMediaQueueItem> items) async =>
      (await _ensureDelegate()).saveMedia(items);
}

final offlineSyncEngineProvider = Provider<OfflineSyncEngine>((ref) {
  final storage = ref.watch(offlineSyncStorageProvider);

  return OfflineSyncEngine(
    storage: storage,
    mediaUploader: (media) async {
      final file = File(media.localFilePath);
      if (!await file.exists()) {
        throw OfflineSyncException.permanent(
          'Yerel fotoğraf dosyası bulunamadı: ${media.localFilePath}',
          statusCode: 400,
        );
      }
      final bytes = await file.readAsBytes();
      final userId = Api.userId;
      final storagePath = AppUtils.buildStoragePath(
        userId: userId,
        parentId: media.parentMutationId,
        fileName: media.fileName ?? 'photo.jpg',
        timestampMs: DateTime.now().millisecondsSinceEpoch,
      );
      try {
        await Api.client.storage.from(media.bucketName).uploadBinary(
              storagePath,
              bytes,
              fileOptions: FileOptions(contentType: media.mimeType),
            );
        return storagePath;
      } on StorageException catch (e) {
        final code = int.tryParse(e.statusCode ?? '');
        if (code == 400 || code == 403 || code == 413 || code == 415) {
          throw OfflineSyncException.permanent(e.message, statusCode: code);
        }
        throw OfflineSyncException.transient(e.message, statusCode: code);
      } on SocketException catch (e) {
        throw OfflineSyncException.transient(e.message);
      } on TimeoutException catch (e) {
        throw OfflineSyncException.transient(e.message ?? 'Zaman aşımı');
      }
    },
    mutationSender: (item, uploadedMedia) async {
      try {
        if (item.moduleKey == 'work_tracking' && item.entityType == 'ticket') {
          final attJson = uploadedMedia
              .where((m) => m.uploadedStoragePath != null)
              .map((m) => {
                    'file_path': m.uploadedStoragePath,
                    'file_name': m.fileName ?? 'photo.jpg',
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
              'p_attachments': attJson,
            },
          );
          return const OfflineMutationSendResult.synced();
        }

        if (item.moduleKey == 'work_tracking' &&
            item.entityType == 'work_order_status') {
          final rows = await Api.client.rpc(
            'rpc_sync_offline_work_order_status',
            params: {
              'p_work_order_id': item.payload['work_order_id'],
              'p_target_status': item.payload['target_status'],
              'p_base_updated_at': item.baseUpdatedAt?.toUtc().toIso8601String(),
              'p_waiting_reason': item.payload['waiting_reason'],
              'p_note': item.payload['note'],
              'p_force_overwrite': item.payload['force_overwrite'] == true,
            },
          );
          if (rows is List && rows.isNotEmpty) {
            final row = Map<String, dynamic>.from(rows.first as Map);
            if (row['sync_result'] == 'conflict') {
              return OfflineMutationSendResult.conflict(
                serverSnapshot: row,
                message: row['conflict_reason'] as String? ??
                    'Sunucu kaydı daha güncel.',
              );
            }
          }
          return const OfflineMutationSendResult.synced();
        }

        if (item.moduleKey == 'energy' && item.entityType == 'meter_reading') {
          await Api.client.rpc(
            'rpc_record_meter_reading',
            params: {
              'p_meter_id': item.payload['meter_id'],
              'p_reading_date': item.payload['reading_date'],
              'p_active_value': item.payload['active_value'],
              'p_inductive_value': item.payload['inductive_value'],
              'p_capacitive_value': item.payload['capacitive_value'],
              'p_index_value': item.payload['index_value'],
              'p_notes': item.payload['notes'],
              'p_overwrite': item.payload['force_overwrite'] == true,
              'p_client_mutation_id': item.clientMutationId,
            },
          );
          return const OfflineMutationSendResult.synced();
        }

        throw OfflineSyncException.permanent(
          'Desteklenmeyen offline işlem türü: ${item.moduleKey}/${item.entityType}',
          statusCode: 400,
        );
      } on PostgrestException catch (e) {
        if (e.message.contains('SAME_DAY_EXISTS')) {
          return const OfflineMutationSendResult.conflict(
            message: 'Aynı gün için sunucuda zaten okuma kaydı mevcut.',
          );
        }
        if (_isPermanentPostgrestError(e)) {
          throw OfflineSyncException.permanent(e.message, statusCode: 400);
        }
        throw OfflineSyncException.transient(e.message);
      } on SocketException catch (e) {
        throw OfflineSyncException.transient(e.message);
      } on TimeoutException catch (e) {
        throw OfflineSyncException.transient(e.message ?? 'Zaman aşımı');
      }
    },
  );
});

final offlineQueueStateProvider =
    FutureProvider.autoDispose<List<LocalSyncQueueItem>>((ref) async {
  return ref.watch(offlineSyncEngineProvider).getMutations();
});

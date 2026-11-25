import 'dart:convert';
import 'dart:io';

import 'package:avm_tech_platform/core/database/offline_sync_models.dart';

class OfflineSyncException implements Exception {
  final String message;
  final int? statusCode;
  final bool isPermanent;

  const OfflineSyncException(
    this.message, {
    this.statusCode,
    this.isPermanent = false,
  });

  factory OfflineSyncException.transient(String message, {int? statusCode}) =>
      OfflineSyncException(message, statusCode: statusCode, isPermanent: false);

  factory OfflineSyncException.permanent(String message, {int? statusCode}) =>
      OfflineSyncException(message, statusCode: statusCode, isPermanent: true);

  @override
  String toString() => message;
}

enum OfflineMutationResultType { synced, conflict }

class OfflineMutationSendResult {
  final OfflineMutationResultType type;
  final Map<String, dynamic>? serverSnapshot;
  final String? message;

  const OfflineMutationSendResult._({
    required this.type,
    this.serverSnapshot,
    this.message,
  });

  const OfflineMutationSendResult.synced()
      : this._(type: OfflineMutationResultType.synced);

  const OfflineMutationSendResult.conflict({
    Map<String, dynamic>? serverSnapshot,
    String? message,
  }) : this._(
          type: OfflineMutationResultType.conflict,
          serverSnapshot: serverSnapshot,
          message: message,
        );
}

typedef MediaUploader = Future<String> Function(LocalMediaQueueItem media);
typedef MutationSender = Future<OfflineMutationSendResult> Function(
  LocalSyncQueueItem item,
  List<LocalMediaQueueItem> uploadedMedia,
);

abstract class OfflineQueueStorage {
  Future<List<LocalSyncQueueItem>> loadMutations();
  Future<void> saveMutations(List<LocalSyncQueueItem> items);
  Future<List<LocalMediaQueueItem>> loadMedia();
  Future<void> saveMedia(List<LocalMediaQueueItem> items);
}

class InMemoryOfflineQueueStorage implements OfflineQueueStorage {
  List<LocalSyncQueueItem> _mutations = const [];
  List<LocalMediaQueueItem> _media = const [];

  @override
  Future<List<LocalSyncQueueItem>> loadMutations() async =>
      List<LocalSyncQueueItem>.from(_mutations);

  @override
  Future<void> saveMutations(List<LocalSyncQueueItem> items) async {
    _mutations = List<LocalSyncQueueItem>.from(items);
  }

  @override
  Future<List<LocalMediaQueueItem>> loadMedia() async =>
      List<LocalMediaQueueItem>.from(_media);

  @override
  Future<void> saveMedia(List<LocalMediaQueueItem> items) async {
    _media = List<LocalMediaQueueItem>.from(items);
  }
}

/// Cihaz içi yerel JSON dosyasıyla kalıcı kuyruk deposu.
class JsonFileOfflineQueueStorage implements OfflineQueueStorage {
  final File file;

  JsonFileOfflineQueueStorage(this.file);

  Future<Map<String, dynamic>> _readRoot() async {
    if (!await file.exists()) {
      return {'mutations': const [], 'media': const []};
    }
    final raw = await file.readAsString();
    if (raw.trim().isEmpty) {
      return {'mutations': const [], 'media': const []};
    }
    return Map<String, dynamic>.from(jsonDecode(raw) as Map);
  }

  Future<void> _writeRoot(Map<String, dynamic> root) async {
    if (!await file.parent.exists()) {
      await file.parent.create(recursive: true);
    }
    await file.writeAsString(jsonEncode(root), flush: true);
  }

  @override
  Future<List<LocalSyncQueueItem>> loadMutations() async {
    final root = await _readRoot();
    final list = root['mutations'] as List? ?? const [];
    return list
        .map((e) =>
            LocalSyncQueueItem.fromJson(Map<String, dynamic>.from(e as Map)))
        .toList();
  }

  @override
  Future<void> saveMutations(List<LocalSyncQueueItem> items) async {
    final root = await _readRoot();
    root['mutations'] = items.map((e) => e.toJson()).toList();
    await _writeRoot(root);
  }

  @override
  Future<List<LocalMediaQueueItem>> loadMedia() async {
    final root = await _readRoot();
    final list = root['media'] as List? ?? const [];
    return list
        .map((e) =>
            LocalMediaQueueItem.fromJson(Map<String, dynamic>.from(e as Map)))
        .toList();
  }

  @override
  Future<void> saveMedia(List<LocalMediaQueueItem> items) async {
    final root = await _readRoot();
    root['media'] = items.map((e) => e.toJson()).toList();
    await _writeRoot(root);
  }
}

class SyncBatchSummary {
  final int syncedCount;
  final int failedCount;
  final int conflictCount;
  final int skippedCount;

  const SyncBatchSummary({
    required this.syncedCount,
    required this.failedCount,
    required this.conflictCount,
    required this.skippedCount,
  });
}

/// ARCHITECTURE.md Bölüm 5'e göre 2 aşamalı fotoğraf + kayıt senkronizasyon motoru.
class OfflineSyncEngine {
  final OfflineQueueStorage storage;
  final MediaUploader mediaUploader;
  final MutationSender mutationSender;

  OfflineSyncEngine({
    required this.storage,
    required this.mediaUploader,
    required this.mutationSender,
  });

  Future<List<LocalSyncQueueItem>> getMutations() => storage.loadMutations();

  Future<List<LocalMediaQueueItem>> getMedia() => storage.loadMedia();

  Future<LocalSyncQueueItem> enqueueMutation({
    required String clientMutationId,
    required String moduleKey,
    required String entityType,
    required String operation,
    required Map<String, dynamic> payload,
    DateTime? baseUpdatedAt,
    DateTime? createdAt,
    List<LocalMediaQueueItem> attachments = const [],
  }) async {
    final mutations = await storage.loadMutations();
    final existingIdx =
        mutations.indexWhere((m) => m.clientMutationId == clientMutationId);
    if (existingIdx >= 0) {
      return mutations[existingIdx];
    }

    final item = LocalSyncQueueItem(
      clientMutationId: clientMutationId,
      moduleKey: moduleKey,
      entityType: entityType,
      operation: operation,
      payload: payload,
      baseUpdatedAt: baseUpdatedAt,
      createdAt: createdAt ?? DateTime.now().toUtc(),
    );

    mutations.add(item);
    await storage.saveMutations(mutations);

    if (attachments.isNotEmpty) {
      final media = await storage.loadMedia();
      for (final m in attachments) {
        if (!media.any((existing) => existing.id == m.id)) {
          media.add(m);
        }
      }
      await storage.saveMedia(media);
    }

    return item;
  }

  /// Kuyruktaki bekleyen veya backoff süresi dolmuş kayıtları sırayla senkronize eder.
  Future<SyncBatchSummary> processPending({DateTime? nowOverride}) async {
    final now = (nowOverride ?? DateTime.now()).toUtc();
    final mutations = await storage.loadMutations()
      ..sort((a, b) => a.createdAt.compareTo(b.createdAt));

    var synced = 0;
    var failed = 0;
    var conflict = 0;
    var skipped = 0;

    for (var i = 0; i < mutations.length; i++) {
      final current = mutations[i];
      final eligible = current.status == SyncStatus.pending ||
          current.isReadyForAutoRetry(now);
      if (!eligible) {
        skipped++;
        continue;
      }

      // Çift gönderimi önlemek için kilitle
      mutations[i] = current.copyWith(status: SyncStatus.syncing);
      await storage.saveMutations(mutations);

      // Aşama 1: Bağlı fotoğrafları yükle (yarım kaldıysa yalnızca eksikleri yükler)
      final allMedia = await storage.loadMedia();
      final childIndices = <int>[];
      for (var mi = 0; mi < allMedia.length; mi++) {
        if (allMedia[mi].parentMutationId == current.clientMutationId) {
          childIndices.add(mi);
        }
      }

      OfflineSyncException? mediaError;
      for (final mi in childIndices) {
        final mediaItem = allMedia[mi];
        if (mediaItem.status == SyncStatus.synced &&
            mediaItem.uploadedStoragePath != null) {
          continue;
        }
        try {
          allMedia[mi] = mediaItem.copyWith(status: SyncStatus.syncing);
          await storage.saveMedia(allMedia);

          final storagePath = await mediaUploader(mediaItem);
          allMedia[mi] = mediaItem.copyWith(
            uploadedStoragePath: storagePath,
            status: SyncStatus.synced,
            clearLastError: true,
          );
          await storage.saveMedia(allMedia);
        } on OfflineSyncException catch (e) {
          allMedia[mi] = mediaItem.copyWith(
            status: SyncStatus.failed,
            retryCount: mediaItem.retryCount + 1,
            lastError: e.message,
          );
          await storage.saveMedia(allMedia);
          mediaError = e;
          break;
        } catch (e) {
          allMedia[mi] = mediaItem.copyWith(
            status: SyncStatus.failed,
            retryCount: mediaItem.retryCount + 1,
            lastError: e.toString(),
          );
          await storage.saveMedia(allMedia);
          mediaError = OfflineSyncException.transient(e.toString());
          break;
        }
      }

      if (mediaError != null) {
        mutations[i] = _applyFailure(current, mediaError, now);
        await storage.saveMutations(mutations);
        failed++;
        continue;
      }

      // Aşama 2: Tüm fotoğraflar yüklendikten sonra ana kaydı sunucuya gönder
      final uploadedMedia =
          childIndices.map((idx) => allMedia[idx]).toList(growable: false);

      try {
        final result = await mutationSender(mutations[i], uploadedMedia);
        if (result.type == OfflineMutationResultType.synced) {
          mutations[i] = mutations[i].copyWith(
            status: SyncStatus.synced,
            clearLastError: true,
            clearNextRetryAt: true,
            clearServerSnapshot: true,
          );
          synced++;
        } else {
          mutations[i] = mutations[i].copyWith(
            status: SyncStatus.conflict,
            lastError: result.message ?? 'Sunucu kaydı daha güncel.',
            serverSnapshot: result.serverSnapshot,
            clearNextRetryAt: true,
          );
          conflict++;
        }
      } on OfflineSyncException catch (e) {
        mutations[i] = _applyFailure(current, e, now);
        failed++;
      } catch (e) {
        mutations[i] =
            _applyFailure(current, OfflineSyncException.transient(e.toString()), now);
        failed++;
      }

      await storage.saveMutations(mutations);
    }

    return SyncBatchSummary(
      syncedCount: synced,
      failedCount: failed,
      conflictCount: conflict,
      skippedCount: skipped,
    );
  }

  LocalSyncQueueItem _applyFailure(
    LocalSyncQueueItem current,
    OfflineSyncException error,
    DateTime now,
  ) {
    final nextRetryCount = current.retryCount + 1;
    final delay = error.isPermanent
        ? null
        : OfflineRetryPolicy.nextDelay(current.retryCount);
    return current.copyWith(
      status: SyncStatus.failed,
      retryCount: nextRetryCount,
      isPermanentError: error.isPermanent,
      lastError: error.message,
      nextRetryAt: delay != null ? now.add(delay) : null,
      clearNextRetryAt: delay == null,
    );
  }

  /// Kalıcı hata alan veya maksimum denemeyi aşan kaydı manuel olarak tekrar kuyruğa alır.
  Future<void> retryManual(String clientMutationId) async {
    final mutations = await storage.loadMutations();
    final idx =
        mutations.indexWhere((m) => m.clientMutationId == clientMutationId);
    if (idx < 0) return;

    mutations[idx] = mutations[idx].copyWith(
      status: SyncStatus.pending,
      retryCount: 0,
      isPermanentError: false,
      clearLastError: true,
      clearNextRetryAt: true,
    );
    await storage.saveMutations(mutations);

    final media = await storage.loadMedia();
    var mediaChanged = false;
    for (var i = 0; i < media.length; i++) {
      if (media[i].parentMutationId == clientMutationId &&
          media[i].status != SyncStatus.synced) {
        media[i] = media[i].copyWith(
          status: SyncStatus.pending,
          retryCount: 0,
          clearLastError: true,
        );
        mediaChanged = true;
      }
    }
    if (mediaChanged) {
      await storage.saveMedia(media);
    }
  }

  /// Çakışan (`conflict`) kaydı sunucu lehine düşürür veya yerel değişikliği force_overwrite ile yeniden uygular.
  Future<LocalSyncQueueItem?> resolveConflict(
    String clientMutationId,
    ConflictResolutionStrategy strategy,
  ) async {
    final mutations = await storage.loadMutations();
    final idx =
        mutations.indexWhere((m) => m.clientMutationId == clientMutationId);
    if (idx < 0) return null;

    if (strategy == ConflictResolutionStrategy.keepServer) {
      mutations.removeAt(idx);
      await storage.saveMutations(mutations);

      final media = await storage.loadMedia();
      media.removeWhere((m) => m.parentMutationId == clientMutationId);
      await storage.saveMedia(media);
      return null;
    }

    final updatedPayload = Map<String, dynamic>.from(mutations[idx].payload)
      ..['force_overwrite'] = true;

    final updatedItem = mutations[idx].copyWith(
      payload: updatedPayload,
      status: SyncStatus.pending,
      retryCount: 0,
      isPermanentError: false,
      clearLastError: true,
      clearNextRetryAt: true,
      clearServerSnapshot: true,
    );
    mutations[idx] = updatedItem;
    await storage.saveMutations(mutations);
    return updatedItem;
  }
}

import 'package:image_picker/image_picker.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'package:avm_tech_platform/core/utils/app_utils.dart';
import 'package:avm_tech_platform/core/utils/error_utils.dart';
import 'package:avm_tech_platform/core/network/api_client.dart';

/// Storage ('attachments' bucket) yükleme + attachments tablosuna kayıt.
class AttachmentService {
  AttachmentService._();

  static const String bucket = 'work-attachments';

  /// [ticketId] veya [workOrderId]'den TAM BİRİ verilmelidir.
  /// [type]: 'before' | 'after' | 'general'.
  static Future<void> upload({
    required XFile file,
    String? ticketId,
    String? workOrderId,
    String type = 'general',
  }) async {
    if ((ticketId == null) == (workOrderId == null)) {
      throw const AppException(
          'Dosya yalnızca bir arıza veya bir iş emrine bağlanabilir.');
    }

    final client = Api.client;
    final userId = Api.userId;
    final parentId = (ticketId ?? workOrderId)!;

    final mime = AppUtils.mimeFromFileName(file.name);
    if (!AppUtils.isAllowedMime(mime)) {
      throw const AppException(
          'Desteklenmeyen dosya türü. Yalnızca JPEG, PNG, WEBP ve PDF yüklenebilir.');
    }

    final path = AppUtils.buildStoragePath(
      userId: userId,
      parentId: parentId,
      fileName: file.name,
      timestampMs: DateTime.now().millisecondsSinceEpoch,
    );

    final bytes = await file.readAsBytes();
    await client.storage.from(bucket).uploadBinary(
          path,
          bytes,
          fileOptions: FileOptions(contentType: mime),
        );

    try {
      await client.from('attachments').insert({
        if (ticketId != null) 'ticket_id': ticketId,
        if (workOrderId != null) 'work_order_id': workOrderId,
        'uploaded_by': userId,
        'file_path': path,
        'file_name': file.name,
        'mime_type': mime,
        'attachment_type': type,
      });
    } catch (_) {
      // Kayıt başarısızsa yetim dosya bırakma.
      try {
        await client.storage.from(bucket).remove([path]);
      } catch (_) {}
      rethrow;
    }
  }

  /// Özel bucket için süreli imzalı URL (1 saat).
  static Future<String> signedUrl(String filePath) {
    return Api.client.storage.from(bucket).createSignedUrl(filePath, 3600);
  }
}

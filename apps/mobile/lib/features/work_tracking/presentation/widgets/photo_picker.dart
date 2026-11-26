import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import 'package:avm_tech_platform/core/theme/app_theme.dart';

/// Samsung (50MP/108MP & HEIC/HEIF) ve diğer telefon kameralarından gelen
/// 5–12 MB büyüklüğündeki fotoğrafları okunabilirliği bozmadan ~90–140 KB
/// boyutuna (%97 tasarruf) indiren sıkıştırma politikası.
class PhotoCompressionPolicy {
  PhotoCompressionPolicy._();

  static const double maxWidthPx = 1200;
  static const double maxHeightPx = 1200;
  static const int jpegQuality = 70;
  static const int retentionDaysAfterClose = 15;
}

final ImagePicker _picker = ImagePicker();

/// Kamera veya galeriden tek fotoğraf seçtirir; vazgeçilirse null döner.
Future<XFile?> pickPhoto(BuildContext context) async {
  final source = await showModalBottomSheet<ImageSource>(
    context: context,
    builder: (ctx) => SafeArea(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          ListTile(
            leading: const Icon(Icons.camera_alt),
            title: const Text('Kamera'),
            onTap: () => Navigator.pop(ctx, ImageSource.camera),
          ),
          ListTile(
            leading: const Icon(Icons.photo_library),
            title: const Text('Galeri'),
            onTap: () => Navigator.pop(ctx, ImageSource.gallery),
          ),
        ],
      ),
    ),
  );
  if (source == null) return null;
  return _picker.pickImage(
    source: source,
    imageQuality: PhotoCompressionPolicy.jpegQuality,
    maxWidth: PhotoCompressionPolicy.maxWidthPx,
    maxHeight: PhotoCompressionPolicy.maxHeightPx,
  );
}

/// Seçilen fotoğrafın platformdan bağımsız küçük önizlemesi.
class PhotoPreview extends StatelessWidget {
  final XFile file;
  final double size;
  final VoidCallback? onRemove;

  const PhotoPreview({super.key, required this.file, this.size = 96, this.onRemove});

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<Uint8List>(
      future: file.readAsBytes(),
      builder: (context, snap) {
        Widget content;
        if (snap.hasData) {
          content = ClipRRect(
            borderRadius: BorderRadius.circular(8),
            child: Image.memory(snap.data!, width: size, height: size, fit: BoxFit.cover),
          );
        } else if (snap.hasError) {
          content = const Icon(Icons.broken_image_outlined);
        } else {
          content = const Center(child: CircularProgressIndicator(strokeWidth: 2));
        }
        return Stack(
          children: [
            Container(
              width: size,
              height: size,
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: AppColors.border),
              ),
              child: content,
            ),
            if (onRemove != null)
              Positioned(
                right: 0,
                top: 0,
                child: InkWell(
                  onTap: onRemove,
                  child: Container(
                    decoration: const BoxDecoration(color: Colors.black54, shape: BoxShape.circle),
                    padding: const EdgeInsets.all(2),
                    child: const Icon(Icons.close, size: 16, color: Colors.white),
                  ),
                ),
              ),
          ],
        );
      },
    );
  }
}

import 'package:flutter/material.dart';

import 'package:avm_tech_platform/core/theme/app_theme.dart';
import 'package:avm_tech_platform/features/work_tracking/data/attachment_service.dart';
import 'package:avm_tech_platform/features/work_tracking/data/models/extra_models.dart';

Color ticketStatusColor(String status) {
  switch (status) {
    case 'new':
      return AppColors.statusNew;
    case 'under_review':
      return AppColors.statusUnderReview;
    case 'assigned':
      return AppColors.statusAssigned;
    case 'in_progress':
      return AppColors.statusInProgress;
    case 'waiting':
      return AppColors.statusWaiting;
    case 'resolved':
      return AppColors.statusResolved;
    case 'closed':
      return AppColors.statusClosed;
    default:
      return AppColors.statusCancelled;
  }
}

Color workOrderStatusColor(String status) {
  switch (status) {
    case 'assigned':
      return AppColors.statusAssigned;
    case 'in_progress':
      return AppColors.statusInProgress;
    case 'waiting':
      return AppColors.statusWaiting;
    case 'completed':
      return AppColors.statusResolved;
    default:
      return AppColors.statusCancelled;
  }
}

Color priorityColor(String priority) {
  switch (priority) {
    case 'urgent':
      return AppColors.priorityUrgent;
    case 'priority':
      return AppColors.priorityHigh;
    default:
      return AppColors.priorityNormal;
  }
}

/// Ek dosya (fotoğraf) küçük resimleri; özel bucket için imzalı URL kullanır.
class AttachmentGallery extends StatelessWidget {
  final List<AttachmentModel> attachments;

  const AttachmentGallery({super.key, required this.attachments});

  @override
  Widget build(BuildContext context) {
    if (attachments.isEmpty) {
      return const Text('Henüz dosya eklenmemiş.',
          style: TextStyle(color: AppColors.textSecondary, fontSize: 13));
    }
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: [
        for (final a in attachments) _AttachmentThumb(key: ValueKey(a.id), attachment: a),
      ],
    );
  }
}

class _AttachmentThumb extends StatefulWidget {
  final AttachmentModel attachment;
  const _AttachmentThumb({super.key, required this.attachment});

  @override
  State<_AttachmentThumb> createState() => _AttachmentThumbState();
}

class _AttachmentThumbState extends State<_AttachmentThumb> {
  late final Future<String> _url = AttachmentService.signedUrl(widget.attachment.filePath);

  Widget _box(Widget child) => Container(
        width: 96,
        height: 96,
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: AppColors.border),
        ),
        child: child,
      );

  @override
  Widget build(BuildContext context) {
    final a = widget.attachment;
    if (!a.isImage) {
      return _box(Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Icon(Icons.picture_as_pdf, color: AppColors.priorityUrgent),
          Padding(
            padding: const EdgeInsets.all(4),
            child: Text(a.fileName ?? 'Belge',
                maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 10)),
          ),
        ],
      ));
    }
    return FutureBuilder<String>(
      future: _url,
      builder: (context, snap) {
        if (snap.connectionState != ConnectionState.done) {
          return _box(const Center(child: CircularProgressIndicator(strokeWidth: 2)));
        }
        if (snap.hasError || !snap.hasData) {
          return _box(const Icon(Icons.broken_image_outlined, color: AppColors.textSecondary));
        }
        final url = snap.data!;
        return GestureDetector(
          onTap: () => showDialog<void>(
            context: context,
            builder: (_) => Dialog(
              child: InteractiveViewer(
                child: Image.network(url, fit: BoxFit.contain),
              ),
            ),
          ),
          child: Stack(
            children: [
              ClipRRect(
                borderRadius: BorderRadius.circular(8),
                child: Image.network(
                  url,
                  width: 96,
                  height: 96,
                  fit: BoxFit.cover,
                  errorBuilder: (_, __, ___) =>
                      _box(const Icon(Icons.broken_image_outlined, color: AppColors.textSecondary)),
                ),
              ),
              Positioned(
                left: 4,
                bottom: 4,
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                  decoration: BoxDecoration(
                    color: Colors.black54,
                    borderRadius: BorderRadius.circular(4),
                  ),
                  child: Text(a.typeLabel,
                      style: const TextStyle(color: Colors.white, fontSize: 10)),
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}


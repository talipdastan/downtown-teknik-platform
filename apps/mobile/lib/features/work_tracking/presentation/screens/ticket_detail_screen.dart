import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:avm_tech_platform/features/work_tracking/presentation/widgets/work_tracking_widgets.dart';
import 'package:avm_tech_platform/core/theme/app_theme.dart';
import 'package:avm_tech_platform/core/network/api_client.dart';
import 'package:avm_tech_platform/features/work_tracking/data/attachment_service.dart';
import 'package:avm_tech_platform/core/utils/app_utils.dart';
import 'package:avm_tech_platform/core/utils/error_utils.dart';
import 'package:avm_tech_platform/features/work_tracking/utils/labels.dart';
import 'package:avm_tech_platform/features/work_tracking/data/models/ticket_model.dart';
import 'package:avm_tech_platform/core/auth/auth_provider.dart';
import 'package:avm_tech_platform/features/work_tracking/providers/data_providers.dart';
import 'package:avm_tech_platform/core/widgets/common_widgets.dart';
import 'package:avm_tech_platform/features/work_tracking/presentation/widgets/photo_picker.dart';

class TicketDetailScreen extends ConsumerStatefulWidget {
  final String ticketId;
  const TicketDetailScreen({super.key, required this.ticketId});

  @override
  ConsumerState<TicketDetailScreen> createState() => _TicketDetailScreenState();
}

class _TicketDetailScreenState extends ConsumerState<TicketDetailScreen> {
  bool _uploading = false;
  bool _confirming = false;

  Future<void> _confirmResolution(TicketModel t, {required bool reopen}) async {
    String note = 'İş isteği sahibi tarafından kontrol edilip onaylandı.';
    if (reopen) {
      final ctrl = TextEditingController();
      final entered = await showDialog<String>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('Tekrar İşe İade Et'),
          content: TextField(
            controller: ctrl,
            maxLines: 3,
            decoration: const InputDecoration(
              hintText: 'Sorunun neden devam ettiğini yazınız...',
            ),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Vazgeç')),
            ElevatedButton(
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.priorityUrgent,
                minimumSize: const Size(100, 40),
              ),
              onPressed: () {
                if (ctrl.text.trim().isNotEmpty) {
                  Navigator.pop(ctx, ctrl.text.trim());
                }
              },
              child: const Text('İade Et'),
            ),
          ],
        ),
      );
      ctrl.dispose();
      if (entered == null) return;
      note = entered;
    }

    setState(() => _confirming = true);
    try {
      await Api.client.rpc('rpc_manager_close_ticket', params: {
        'p_ticket_id': t.id,
        'p_resolution_note': note,
        'p_reopen': reopen,
      });
      _refreshAll();
      ref.invalidate(ticketsProvider);
      if (mounted) {
        showAppSnack(
          context,
          reopen
              ? 'İş isteği teknisyene yeniden iade edildi.'
              : 'İş isteğiniz onaylanarak kapatıldı.',
        );
      }
    } catch (e) {
      if (mounted) showAppSnack(context, friendlyError(e), error: true);
    } finally {
      if (mounted) setState(() => _confirming = false);
    }
  }

  Future<void> _addPhoto() async {
    try {
      final file = await pickPhoto(context);
      if (file == null) return;
      setState(() => _uploading = true);
      await AttachmentService.upload(file: file, ticketId: widget.ticketId, type: 'general');
      ref.invalidate(ticketAttachmentsProvider(widget.ticketId));
      if (mounted) showAppSnack(context, 'Fotoğraf eklendi.');
    } catch (e) {
      if (mounted) showAppSnack(context, friendlyError(e), error: true);
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
  }

  void _refreshAll() {
    final id = widget.ticketId;
    invalidateAllWorkTrackingProviders(ref, id);
  }

  @override
  Widget build(BuildContext context) {
    final id = widget.ticketId;
    final ticketAsync = ref.watch(ticketDetailProvider(id));
    final profile = ref.watch(authProvider).profile;

    return Scaffold(
      appBar: AppBar(title: const Text('Arıza Detayı')),
      body: SafeArea(
        top: false,
        child: AsyncValueView<TicketModel>(
          value: ticketAsync,
          onRetry: _refreshAll,
          data: (t) {
            final canConfirm = t.status == 'resolved' &&
                (t.reporterId == profile?.id || (profile?.isManagement ?? false));
            final locationParts = [
              if (t.floorName != null) t.floorName!,
              if (t.locationName != null) t.locationName!,
            ].join(' - ');
            final location = locationParts.isNotEmpty ? locationParts : (t.customLocation ?? '-');
            return RefreshIndicator(
              onRefresh: () async => _refreshAll(),
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Expanded(
                        child: Text(
                          t.ticketNumber ?? '-',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                              fontSize: 18,
                              fontWeight: FontWeight.bold,
                              color: AppColors.primaryNavy),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Flexible(
                        child: StatusChip(
                            label: Labels.ticketStatus(t.status), color: ticketStatusColor(t.status)),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Row(children: [
                    StatusChip(label: Labels.priority(t.priority), color: priorityColor(t.priority)),
                  ]),
                  const SizedBox(height: 12),
                  _InfoRow('Mahal', location),
                  _InfoRow('Arıza Türü', t.categoryName ?? t.customCategory ?? '-'),
                  if (t.equipmentName != null)
                    _InfoRow(
                      'İlgili Ekipman',
                      t.equipmentCode != null && t.equipmentCode!.isNotEmpty
                          ? '${t.equipmentCode} - ${t.equipmentName}'
                          : t.equipmentName!,
                    ),
                  _InfoRow('Bildiren', t.reporterName ?? '-'),
                  _InfoRow('Bildirim Tarihi', AppUtils.formatDateTime(t.createdAt)),
                  if (t.resolvedAt != null)
                    _InfoRow('Çözüm Tarihi', AppUtils.formatDateTime(t.resolvedAt!)),
                  if (t.closedAt != null)
                    _InfoRow('Kapanış Tarihi', AppUtils.formatDateTime(t.closedAt!)),
                  if (t.cancellationReason != null)
                    _InfoRow('İptal Gerekçesi', t.cancellationReason!),
                  const SectionTitle('Açıklama'),
                  Text(t.description),
                  if (canConfirm) ...[
                    const SizedBox(height: 16),
                    Container(
                      padding: const EdgeInsets.all(14),
                      decoration: BoxDecoration(
                        color: AppColors.statusResolved.withValues(alpha: 0.08),
                        border: Border.all(color: AppColors.statusResolved.withValues(alpha: 0.4)),
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          const Text(
                            'Çözüm Onayınız Bekleniyor',
                            style: TextStyle(
                              fontWeight: FontWeight.bold,
                              color: AppColors.statusResolved,
                            ),
                          ),
                          const SizedBox(height: 4),
                          const Text(
                            'Teknik ekip işlemi tamamladı. Çözümü onaylayabilir veya sorun devam ediyorsa iade edebilirsiniz.',
                            style: TextStyle(fontSize: 12),
                          ),
                          const SizedBox(height: 10),
                          Row(
                            children: [
                              Expanded(
                                child: OutlinedButton(
                                  style: OutlinedButton.styleFrom(
                                    foregroundColor: AppColors.priorityUrgent,
                                  ),
                                  onPressed: _confirming
                                      ? null
                                      : () => _confirmResolution(t, reopen: true),
                                  child: const Text('İade Et'),
                                ),
                              ),
                              const SizedBox(width: 8),
                              Expanded(
                                flex: 2,
                                child: ElevatedButton(
                                  style: ElevatedButton.styleFrom(
                                    backgroundColor: AppColors.statusResolved,
                                    minimumSize: const Size(0, 42),
                                  ),
                                  onPressed: _confirming
                                      ? null
                                      : () => _confirmResolution(t, reopen: false),
                                  child: Text(_confirming ? 'İşleniyor...' : 'Onayla ve Kapat'),
                                ),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                  ],
                  const SectionTitle('Fotoğraflar'),
                  AsyncValueView(
                    value: ref.watch(ticketAttachmentsProvider(id)),
                    onRetry: () => ref.invalidate(ticketAttachmentsProvider(id)),
                    data: (list) => AttachmentGallery(attachments: list),
                  ),
                  const SizedBox(height: 8),
                  if (t.status != 'closed' && t.status != 'cancelled')
                    Align(
                      alignment: Alignment.centerLeft,
                      child: OutlinedButton.icon(
                        onPressed: _uploading ? null : _addPhoto,
                        icon: const Icon(Icons.add_a_photo),
                        label: Text(_uploading ? 'Yükleniyor...' : 'Fotoğraf Ekle'),
                      ),
                    ),
                  const SectionTitle('Durum Geçmişi'),
                  AsyncValueView(
                    value: ref.watch(ticketHistoryProvider(id)),
                    onRetry: () => ref.invalidate(ticketHistoryProvider(id)),
                    data: (list) => list.isEmpty
                        ? const Text('Kayıt yok.',
                            style: TextStyle(color: AppColors.textSecondary))
                        : Column(
                            children: [
                              for (final h in list)
                                ListTile(
                                  dense: true,
                                  contentPadding: EdgeInsets.zero,
                                  leading: const Icon(Icons.history, size: 20),
                                  title: Text(
                                    h.oldStatus == null
                                        ? Labels.ticketStatus(h.newStatus)
                                        : '${Labels.ticketStatus(h.oldStatus!)} → ${Labels.ticketStatus(h.newStatus)}',
                                  ),
                                  subtitle: Text([
                                    AppUtils.formatDateTime(h.createdAt),
                                    if (h.changedByName != null) h.changedByName!,
                                  ].join(' · ')),
                                ),
                            ],
                          ),
                  ),
                  const SectionTitle('İşlem Notları'),
                  AsyncValueView(
                    value: ref.watch(ticketCommentsProvider(id)),
                    onRetry: () => ref.invalidate(ticketCommentsProvider(id)),
                    data: (list) => list.isEmpty
                        ? const Text('Not yok.', style: TextStyle(color: AppColors.textSecondary))
                        : Column(
                            children: [
                              for (final c in list)
                                Card(
                                  margin: const EdgeInsets.only(bottom: 8),
                                  child: Padding(
                                    padding: const EdgeInsets.all(12),
                                    child: Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        Text(c.comment),
                                        const SizedBox(height: 4),
                                        Text(
                                          [
                                            if (c.authorName != null) c.authorName!,
                                            AppUtils.formatDateTime(c.createdAt),
                                          ].join(' · '),
                                          style: const TextStyle(
                                              fontSize: 11, color: AppColors.textSecondary),
                                        ),
                                      ],
                                    ),
                                  ),
                                ),
                            ],
                          ),
                  ),
                ],
              ),
            );
          },
        ),
      ),
    );
  }
}

class _InfoRow extends StatelessWidget {
  final String label;
  final String value;
  const _InfoRow(this.label, this.value);

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 110,
            child: Text(label,
                style: const TextStyle(color: AppColors.textSecondary, fontSize: 13)),
          ),
          Expanded(child: Text(value, style: const TextStyle(fontSize: 14))),
        ],
      ),
    );
  }
}

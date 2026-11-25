import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

import 'package:avm_tech_platform/features/work_tracking/presentation/widgets/work_tracking_widgets.dart';
import 'package:avm_tech_platform/core/theme/app_theme.dart';
import 'package:avm_tech_platform/core/network/api_client.dart';
import 'package:avm_tech_platform/features/work_tracking/data/attachment_service.dart';
import 'package:avm_tech_platform/core/utils/error_utils.dart';
import 'package:avm_tech_platform/features/work_tracking/utils/labels.dart';
import 'package:avm_tech_platform/features/work_tracking/data/models/extra_models.dart';
import 'package:avm_tech_platform/features/work_tracking/providers/data_providers.dart';
import 'package:avm_tech_platform/core/widgets/common_widgets.dart';
import 'package:avm_tech_platform/features/work_tracking/presentation/widgets/photo_picker.dart';

typedef _MaterialInput = ({String name, double quantity, String unit});

class TechnicianWorkOrderDetailScreen extends ConsumerStatefulWidget {
  final String workOrderId;

  const TechnicianWorkOrderDetailScreen({super.key, required this.workOrderId});

  @override
  ConsumerState<TechnicianWorkOrderDetailScreen> createState() =>
      _TechnicianWorkOrderDetailScreenState();
}

class _TechnicianWorkOrderDetailScreenState
    extends ConsumerState<TechnicianWorkOrderDetailScreen> {
  final TextEditingController _noteCtrl = TextEditingController();
  XFile? _afterPhoto;
  bool _afterUploaded = false;
  bool _busy = false;

  String get _id => widget.workOrderId;

  @override
  void dispose() {
    _noteCtrl.dispose();
    super.dispose();
  }

  void _refresh() {
    ref.invalidate(workOrderViewProvider(_id));
    ref.invalidate(workOrderMaterialsProvider(_id));
    ref.invalidate(workOrderAttachmentsProvider(_id));
    ref.invalidate(myWorkOrdersProvider);
  }

  /// Sunucu işlemi başarısız olursa durum DEĞİŞTİRİLMEZ; hata kullanıcıya gösterilir.
  Future<void> _run(Future<void> Function() action, String successMessage) async {
    setState(() => _busy = true);
    try {
      await action();
      _refresh();
      if (mounted) showAppSnack(context, successMessage);
    } catch (e) {
      if (mounted) showAppSnack(context, friendlyError(e), error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _start() => _run(
        () => Api.client.rpc('rpc_technician_start_work', params: {'p_work_order_id': _id}),
        'İşe başlandı.',
      );

  Future<void> _pause() async {
    final reason = await showDialog<String>(
      context: context,
      builder: (_) => const _ReasonDialog(),
    );
    if (reason == null) return;
    await _run(
      () => Api.client.rpc('rpc_technician_pause_work', params: {
        'p_work_order_id': _id,
        'p_waiting_reason': reason,
      }),
      'İş emri beklemeye alındı.',
    );
  }

  Future<void> _addMaterial() async {
    final input = await showDialog<_MaterialInput>(
      context: context,
      builder: (_) => const _MaterialDialog(),
    );
    if (input == null) return;
    await _run(
      () => Api.client.from('work_order_materials').insert({
        'work_order_id': _id,
        'material_name': input.name,
        'quantity': input.quantity,
        'unit': input.unit,
        'recorded_by': Api.userId,
      }),
      'Malzeme kaydedildi.',
    );
  }

  Future<void> _addBeforePhoto() async {
    try {
      final file = await pickPhoto(context);
      if (file == null) return;
      await _run(
        () => AttachmentService.upload(file: file, workOrderId: _id, type: 'before'),
        'Öncesi fotoğrafı eklendi.',
      );
    } catch (e) {
      if (mounted) showAppSnack(context, friendlyError(e), error: true);
    }
  }

  Future<void> _pickAfterPhoto() async {
    try {
      final file = await pickPhoto(context);
      if (file != null && mounted) {
        setState(() {
          _afterPhoto = file;
          _afterUploaded = false;
        });
      }
    } catch (e) {
      if (mounted) showAppSnack(context, friendlyError(e), error: true);
    }
  }

  Future<void> _complete() async {
    final photo = _afterPhoto;
    if (photo == null) {
      showAppSnack(context, 'Çözüm (sonrası) fotoğrafı yüklenmesi zorunludur.', error: true);
      return;
    }
    final note = _noteCtrl.text.trim();
    await _run(() async {
      if (!_afterUploaded) {
        await AttachmentService.upload(file: photo, workOrderId: _id, type: 'after');
        _afterUploaded = true;
      }
      await Api.client.rpc('rpc_technician_complete_work', params: {
        'p_work_order_id': _id,
        'p_note': note.isEmpty ? null : note,
      });
      _afterPhoto = null;
      _afterUploaded = false;
      _noteCtrl.clear();
    }, 'İş emri tamamlandı ve yönetici onayına gönderildi.');
  }

  @override
  Widget build(BuildContext context) {
    final viewAsync = ref.watch(workOrderViewProvider(_id));

    return Scaffold(
      appBar: AppBar(title: const Text('İş Emri Detayı')),
      body: SafeArea(
        top: false,
        child: AsyncValueView<WorkOrderView>(
          value: viewAsync,
          onRetry: _refresh,
          data: (view) {
            final o = view.order;
            return RefreshIndicator(
              onRefresh: () async => _refresh(),
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: AppColors.border),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Expanded(
                              child: Text(
                                o.ticketNumber ?? '-',
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                    fontWeight: FontWeight.bold,
                                    fontSize: 16,
                                    color: AppColors.primaryNavy),
                              ),
                            ),
                            const SizedBox(width: 8),
                            Flexible(
                              child: StatusChip(
                                label: Labels.workOrderStatus(o.status),
                                color: workOrderStatusColor(o.status),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 8),
                        if (view.ticketPriority != null)
                          StatusChip(
                            label: Labels.priority(view.ticketPriority!),
                            color: priorityColor(view.ticketPriority!),
                          ),
                        const SizedBox(height: 8),
                        Text('Mahal: ${view.locationLabel ?? '-'}',
                            style: const TextStyle(fontSize: 13, color: AppColors.textSecondary)),
                        if (view.categoryName != null)
                          Text('Arıza türü: ${view.categoryName}',
                              style:
                                  const TextStyle(fontSize: 13, color: AppColors.textSecondary)),
                        if (o.departmentName != null)
                          Text('Departman: ${o.departmentName}',
                              style:
                                  const TextStyle(fontSize: 13, color: AppColors.textSecondary)),
                        const SizedBox(height: 8),
                        Text(view.ticketDescription ?? '-'),
                        if (o.workDescription != null && o.workDescription!.isNotEmpty) ...[
                          const SizedBox(height: 8),
                          Text('Yönetici talimatı: ${o.workDescription}',
                              style: const TextStyle(fontWeight: FontWeight.w600)),
                        ],
                        if (o.status == 'waiting' && o.waitingReason != null) ...[
                          const SizedBox(height: 8),
                          Text('Bekleme nedeni: ${o.waitingReason}',
                              style: const TextStyle(color: AppColors.statusWaiting)),
                        ],
                      ],
                    ),
                  ),
                  const SectionTitle('Kullanılan Malzemeler'),
                  AsyncValueView(
                    value: ref.watch(workOrderMaterialsProvider(_id)),
                    onRetry: () => ref.invalidate(workOrderMaterialsProvider(_id)),
                    data: (list) => list.isEmpty
                        ? const Text('Malzeme kaydı yok.',
                            style: TextStyle(color: AppColors.textSecondary))
                        : Column(
                            children: [
                              for (final m in list)
                                ListTile(
                                  dense: true,
                                  contentPadding: EdgeInsets.zero,
                                  leading: const Icon(Icons.build_circle_outlined),
                                  title: Text(m.materialName),
                                  trailing: Text('${m.quantity} ${m.unit ?? ''}'),
                                ),
                            ],
                          ),
                  ),
                  const SectionTitle('Fotoğraflar'),
                  AsyncValueView(
                    value: ref.watch(workOrderAttachmentsProvider(_id)),
                    onRetry: () => ref.invalidate(workOrderAttachmentsProvider(_id)),
                    data: (list) => AttachmentGallery(attachments: list),
                  ),
                  const SizedBox(height: 16),
                  if (o.status == 'assigned') ...[
                    ElevatedButton.icon(
                      onPressed: _busy ? null : _start,
                      icon: const Icon(Icons.play_arrow),
                      label: const Text('İşe Başla'),
                    ),
                    const SizedBox(height: 8),
                    OutlinedButton.icon(
                      onPressed: _busy ? null : _addBeforePhoto,
                      icon: const Icon(Icons.add_a_photo),
                      label: const Text('Öncesi Fotoğrafı Ekle'),
                    ),
                  ],
                  if (o.status == 'waiting')
                    ElevatedButton.icon(
                      onPressed: _busy ? null : _start,
                      icon: const Icon(Icons.play_arrow),
                      label: const Text('İşleme Tekrar Başla'),
                    ),
                  if (o.status == 'in_progress') ...[
                    Row(
                      children: [
                        Expanded(
                          child: OutlinedButton.icon(
                            onPressed: _busy ? null : _pause,
                            icon: const Icon(Icons.pause),
                            label: const Text('Beklemeye Al'),
                          ),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: OutlinedButton.icon(
                            onPressed: _busy ? null : _addMaterial,
                            icon: const Icon(Icons.build),
                            label: const Text('Malzeme Ekle'),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    OutlinedButton.icon(
                      onPressed: _busy ? null : _addBeforePhoto,
                      icon: const Icon(Icons.add_a_photo),
                      label: const Text('Öncesi Fotoğrafı Ekle'),
                    ),
                    const SectionTitle('Yapılan İşlem Açıklaması'),
                    TextField(
                      controller: _noteCtrl,
                      maxLines: 3,
                      decoration:
                          const InputDecoration(hintText: 'Yapılan teknik müdahaleyi açıklayınız...'),
                    ),
                    const SectionTitle('Çözüm / Sonuç Fotoğrafı (zorunlu)'),
                    if (_afterPhoto != null)
                      Align(
                        alignment: Alignment.centerLeft,
                        child: PhotoPreview(
                          key: ValueKey(_afterPhoto!.path),
                          file: _afterPhoto!,
                          size: 120,
                          onRemove: _busy
                              ? null
                              : () => setState(() {
                                    _afterPhoto = null;
                                    _afterUploaded = false;
                                  }),
                        ),
                      )
                    else
                      OutlinedButton.icon(
                        onPressed: _busy ? null : _pickAfterPhoto,
                        icon: const Icon(Icons.camera_alt),
                        label: const Text('Çözüm Fotoğrafı Ekle'),
                      ),
                    const SizedBox(height: 16),
                    ElevatedButton(
                      style: ElevatedButton.styleFrom(backgroundColor: AppColors.statusResolved),
                      onPressed: (_busy || _afterPhoto == null) ? null : _complete,
                      child: Text(_busy ? 'Gönderiliyor...' : 'İşi Tamamlandı Olarak Gönder'),
                    ),
                  ],
                  if (o.status == 'completed')
                    Container(
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(
                        color: AppColors.statusResolved.withValues(alpha: 0.08),
                        border:
                            Border.all(color: AppColors.statusResolved.withValues(alpha: 0.4)),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: const Row(
                        children: [
                          Icon(Icons.check_circle, color: AppColors.statusResolved, size: 28),
                          SizedBox(width: 12),
                          Expanded(
                            child: Text(
                              'İş emri tamamlandı. Teknik yöneticinin kontrol ve kapatma onayı beklenmektedir.',
                              style: TextStyle(fontSize: 13),
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

class _ReasonDialog extends StatefulWidget {
  const _ReasonDialog();

  @override
  State<_ReasonDialog> createState() => _ReasonDialogState();
}

class _ReasonDialogState extends State<_ReasonDialog> {
  final TextEditingController _ctrl = TextEditingController();
  String? _error;

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Beklemeye Alma Nedeni'),
      content: TextField(
        controller: _ctrl,
        maxLines: 3,
        decoration: InputDecoration(
          hintText: 'Örn: Yedek parça bekleniyor / Dış servis gerekli',
          helperText: 'Bekleme nedeni zorunludur.',
          errorText: _error,
        ),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: const Text('Vazgeç')),
        ElevatedButton(
          style: ElevatedButton.styleFrom(minimumSize: const Size(120, 40)),
          onPressed: () {
            final text = _ctrl.text.trim();
            if (text.isEmpty) {
              setState(() => _error = 'Lütfen bekleme nedenini yazınız.');
              return;
            }
            Navigator.pop(context, text);
          },
          child: const Text('Kaydet ve Beklet'),
        ),
      ],
    );
  }
}

class _MaterialDialog extends StatefulWidget {
  const _MaterialDialog();

  @override
  State<_MaterialDialog> createState() => _MaterialDialogState();
}

class _MaterialDialogState extends State<_MaterialDialog> {
  final TextEditingController _name = TextEditingController();
  final TextEditingController _qty = TextEditingController();
  final TextEditingController _unit = TextEditingController(text: 'adet');
  String? _error;

  @override
  void dispose() {
    _name.dispose();
    _qty.dispose();
    _unit.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Kullanılan Malzeme'),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: _name,
              decoration: const InputDecoration(labelText: 'Malzeme adı'),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _qty,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(labelText: 'Miktar'),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _unit,
              decoration: InputDecoration(labelText: 'Birim (adet, metre, kg...)', errorText: _error),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: const Text('Vazgeç')),
        ElevatedButton(
          style: ElevatedButton.styleFrom(minimumSize: const Size(100, 40)),
          onPressed: () {
            final name = _name.text.trim();
            final unit = _unit.text.trim();
            final qty = double.tryParse(_qty.text.trim().replaceAll(',', '.'));
            if (name.isEmpty || unit.isEmpty || qty == null || qty <= 0) {
              setState(() => _error = 'Ad, birim ve 0\'dan büyük miktar giriniz.');
              return;
            }
            Navigator.pop<_MaterialInput>(context, (name: name, quantity: qty, unit: unit));
          },
          child: const Text('Ekle'),
        ),
      ],
    );
  }
}

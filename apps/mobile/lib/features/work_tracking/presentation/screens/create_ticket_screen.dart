import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';
import 'package:uuid/uuid.dart';

import 'package:avm_tech_platform/core/theme/app_theme.dart';
import 'package:avm_tech_platform/core/network/api_client.dart';
import 'package:avm_tech_platform/features/work_tracking/data/attachment_service.dart';
import 'package:avm_tech_platform/core/utils/error_utils.dart';
import 'package:avm_tech_platform/features/work_tracking/data/models/extra_models.dart';
import 'package:avm_tech_platform/core/auth/auth_provider.dart';
import 'package:avm_tech_platform/core/equipment/equipment_model.dart';
import 'package:avm_tech_platform/core/equipment/equipment_providers.dart';
import 'package:avm_tech_platform/features/work_tracking/providers/data_providers.dart';
import 'package:avm_tech_platform/core/widgets/common_widgets.dart';
import 'package:avm_tech_platform/features/work_tracking/presentation/widgets/photo_picker.dart';

const int _maxPhotos = 5;
const String _otherValue = '__other__';

class CreateTicketScreen extends ConsumerStatefulWidget {
  const CreateTicketScreen({super.key});

  @override
  ConsumerState<CreateTicketScreen> createState() => _CreateTicketScreenState();
}

class _CreateTicketScreenState extends ConsumerState<CreateTicketScreen> {
  String? _floorId;
  String? _locationId;
  String? _categoryId;
  String? _equipmentId;
  String _priority = 'normal';
  final TextEditingController _customLocationCtrl = TextEditingController();
  final TextEditingController _customCategoryCtrl = TextEditingController();
  final TextEditingController _descCtrl = TextEditingController();
  final List<XFile> _images = [];
  bool _submitting = false;

  @override
  void dispose() {
    _customLocationCtrl.dispose();
    _customCategoryCtrl.dispose();
    _descCtrl.dispose();
    super.dispose();
  }

  Future<void> _addPhoto() async {
    if (_images.length >= _maxPhotos) {
      showAppSnack(context, 'En fazla $_maxPhotos fotoğraf eklenebilir.', error: true);
      return;
    }
    try {
      final file = await pickPhoto(context);
      if (file != null && mounted) setState(() => _images.add(file));
    } catch (e) {
      if (mounted) showAppSnack(context, 'Fotoğraf alınamadı: ${friendlyError(e)}', error: true);
    }
  }

  Future<void> _submit() async {
    final uid = ref.read(authProvider).profile?.id;
    final currentTickets = ref.read(ticketsProvider).valueOrNull ?? [];
    final pendingCount = currentTickets
        .where((t) => t.reporterId == uid && t.status == 'resolved')
        .length;
    if (pendingCount >= 3) {
      showAppSnack(
        context,
        'Onayınızda bekleyen $pendingCount adet tamamlanmış iş isteği var. Önce onları onaylayınız.',
        error: true,
      );
      return;
    }

    final isOtherLocation = _locationId == _otherValue;
    final isOtherCategory = _categoryId == _otherValue;

    if (_floorId == null || _locationId == null || _categoryId == null) {
      showAppSnack(context, 'Lütfen kat, mahal ve arıza türünü seçiniz.', error: true);
      return;
    }
    if (isOtherLocation && _customLocationCtrl.text.trim().isEmpty) {
      showAppSnack(context, 'Lütfen diğer mahal adını yazınız.', error: true);
      return;
    }
    if (isOtherCategory && _customCategoryCtrl.text.trim().isEmpty) {
      showAppSnack(context, 'Lütfen diğer arıza kategorisini yazınız.', error: true);
      return;
    }
    final description = _descCtrl.text.trim();
    if (description.isEmpty) {
      showAppSnack(context, 'Lütfen arıza açıklamasını yazınız.', error: true);
      return;
    }

    String? finalCustomLocation;
    if (isOtherLocation) {
      final floors = ref.read(floorsProvider).valueOrNull ?? [];
      final floorName = floors.where((f) => f.id == _floorId).map((f) => f.name).firstOrNull;
      final entered = _customLocationCtrl.text.trim();
      finalCustomLocation = floorName != null ? '$floorName - $entered' : entered;
    }

    setState(() => _submitting = true);
    try {
      // Kimliği istemcide üretiyoruz: RLS "select" politikası, INSERT ... RETURNING
      // sırasında yeni satırı göremeyebileceği için geri dönüş değerine güvenmiyoruz.
      final ticketId = const Uuid().v4();
      await Api.client.from('tickets').insert({
        'id': ticketId,
        'reporter_id': Api.userId,
        'location_id': isOtherLocation ? null : _locationId,
        'custom_location': finalCustomLocation,
        'category_id': isOtherCategory ? null : _categoryId,
        'custom_category': isOtherCategory ? _customCategoryCtrl.text.trim() : null,
        if (_equipmentId != null) 'equipment_id': _equipmentId,
        'priority': _priority,
        'description': description,
      });

      var failed = 0;
      for (final image in _images) {
        try {
          await AttachmentService.upload(file: image, ticketId: ticketId, type: 'general');
        } catch (_) {
          failed++;
        }
      }

      invalidateAllWorkTrackingProviders(ref, ticketId);
      if (!mounted) return;
      showAppSnack(
        context,
        failed == 0
            ? 'Arıza bildirimi oluşturuldu.'
            : 'Arıza oluşturuldu ancak $failed fotoğraf yüklenemedi. '
                'Arıza detayından fotoğrafı tekrar ekleyebilirsiniz.',
        error: failed > 0,
      );
      context.pop();
    } catch (e) {
      if (mounted) showAppSnack(context, 'Kayıt oluşturulamadı: ${friendlyError(e)}', error: true);
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  Widget _dropdown({
    required String label,
    required AsyncValue<List<LookupItem>> lookup,
    required String? value,
    required ValueChanged<String?> onChanged,
    required VoidCallback onRetry,
    bool includeOther = false,
    Key? fieldKey,
    String emptyText = 'Tanımlı kayıt yok. Lütfen yöneticinize başvurun.',
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SectionTitle(label),
        lookup.when(
          loading: () => const LinearProgressIndicator(),
          error: (e, _) => ErrorRetry(message: friendlyError(e), onRetry: onRetry),
          data: (items) {
            if (items.isEmpty && !includeOther) {
              return Text(emptyText, style: const TextStyle(color: AppColors.textSecondary));
            }
            return DropdownButtonFormField<String>(
              key: fieldKey,
              initialValue: value,
              isExpanded: true,
              hint: Text('$label seçiniz'),
              items: [
                for (final item in items)
                  DropdownMenuItem<String>(value: item.id, child: Text(item.name)),
                if (includeOther)
                  const DropdownMenuItem<String>(
                    value: _otherValue,
                    child: Text('Diğer (Elle Giriş)'),
                  ),
              ],
              onChanged: onChanged,
            );
          },
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final floors = ref.watch(floorsProvider);
    final categories = ref.watch(categoriesProvider);
    final equipments = ref.watch(equipmentOptionsProvider);
    final uid = ref.watch(authProvider).profile?.id;
    final pendingCount = (ref.watch(ticketsProvider).valueOrNull ?? [])
        .where((t) => t.reporterId == uid && t.status == 'resolved')
        .length;
    final blockedByPendingLimit = pendingCount >= 3;

    return Scaffold(
      appBar: AppBar(title: const Text('Yeni Arıza Bildirimi')),
      bottomNavigationBar: SafeArea(
        top: false,
        child: Container(
          padding: const EdgeInsets.fromLTRB(12, 8, 12, 10),
          decoration: const BoxDecoration(
            color: AppColors.white,
            border: Border(top: BorderSide(color: AppColors.border)),
          ),
          child: SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              onPressed: (_submitting || blockedByPendingLimit) ? null : _submit,
              child: Text(_submitting ? 'Gönderiliyor...' : 'Arıza Kaydı Oluştur'),
            ),
          ),
        ),
      ),
      body: SafeArea(
        top: false,
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(12, 10, 12, 16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (blockedByPendingLimit)
                Container(
                  margin: const EdgeInsets.only(bottom: 10),
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: Colors.amber.shade50,
                    border: Border.all(color: Colors.amber.shade400),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text(
                    'Onayınızda bekleyen $pendingCount adet tamamlanmış iş isteği bulunmaktadır. '
                    'Yeni iş isteği açabilmek için önce Arızalarım bölümünden onay bekleyen kayıtlarınızı onaylayınız.',
                    style: TextStyle(color: Colors.amber.shade900, fontSize: 12),
                  ),
                ),
              _dropdown(
                label: 'Kat',
                lookup: floors,
                value: _floorId,
                onRetry: () => ref.invalidate(floorsProvider),
                onChanged: (v) => setState(() {
                  _floorId = v;
                  _locationId = null;
                  _customLocationCtrl.clear();
                }),
              ),
              if (_floorId != null) ...[
                _dropdown(
                  label: 'Mahal',
                  lookup: ref.watch(locationsByFloorProvider(_floorId!)),
                  value: _locationId,
                  includeOther: true,
                  fieldKey: ValueKey('loc-$_floorId'),
                  onRetry: () => ref.invalidate(locationsByFloorProvider(_floorId!)),
                  onChanged: (v) => setState(() {
                    _locationId = v;
                    if (v != _otherValue) _customLocationCtrl.clear();
                  }),
                ),
                if (_locationId == _otherValue) ...[
                  const SizedBox(height: 6),
                  TextField(
                    controller: _customLocationCtrl,
                    decoration: const InputDecoration(
                      labelText: 'Diğer Mahal Adı',
                      hintText: 'Mahal adını yazınız...',
                    ),
                  ),
                ],
              ],
              _dropdown(
                label: 'Arıza Türü',
                lookup: categories,
                value: _categoryId,
                includeOther: true,
                onRetry: () => ref.invalidate(categoriesProvider),
                onChanged: (v) => setState(() {
                  _categoryId = v;
                  if (v != _otherValue) _customCategoryCtrl.clear();
                }),
              ),
              if (_categoryId == _otherValue) ...[
                const SizedBox(height: 6),
                TextField(
                  controller: _customCategoryCtrl,
                  decoration: const InputDecoration(
                    labelText: 'Diğer Arıza Kategorisi',
                    hintText: 'Arıza kategorisini yazınız...',
                  ),
                ),
              ],
              const SectionTitle('İlgili Ekipman (Opsiyonel)'),
              equipments.when(
                loading: () => const LinearProgressIndicator(),
                error: (_, __) => const Text(
                  'Ekipman listesi yüklenemedi.',
                  style: TextStyle(color: AppColors.textSecondary, fontSize: 12),
                ),
                data: (List<EquipmentModel> items) {
                  if (items.isEmpty) {
                    return const Text(
                      'Tanımlı aktif ekipman yok.',
                      style: TextStyle(color: AppColors.textSecondary, fontSize: 12),
                    );
                  }
                  return DropdownButtonFormField<String?>(
                    initialValue: _equipmentId,
                    isExpanded: true,
                    hint: const Text('Ekipman seçiniz (opsiyonel)'),
                    items: [
                      const DropdownMenuItem<String?>(
                        value: null,
                        child: Text('Ekipman bağımsız / Belirtilmedi'),
                      ),
                      for (final eq in items)
                        DropdownMenuItem<String?>(
                          value: eq.id,
                          child: Text('${eq.code} - ${eq.name}'),
                        ),
                    ],
                    onChanged: (v) => setState(() => _equipmentId = v),
                  );
                },
              ),
              const SectionTitle('Öncelik'),
              Wrap(
                spacing: 6,
                runSpacing: 6,
                children: [
                  for (final entry in const [
                    ('normal', 'Normal', AppColors.primaryNavy),
                    ('priority', 'Öncelikli', AppColors.priorityHigh),
                    ('urgent', 'Acil', AppColors.priorityUrgent),
                  ]) ...[
                    ChoiceChip(
                      label: Text(
                        entry.$2,
                        style: TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w700,
                          color: _priority == entry.$1
                              ? Colors.white
                              : AppColors.textPrimary,
                        ),
                      ),
                      selected: _priority == entry.$1,
                      backgroundColor: AppColors.white,
                      selectedColor: entry.$3,
                      checkmarkColor: Colors.white,
                      side: BorderSide(
                        color: _priority == entry.$1
                            ? entry.$3
                            : AppColors.border,
                      ),
                      onSelected: (_) => setState(() => _priority = entry.$1),
                    ),
                  ],
                ],
              ),
              const SectionTitle('Arıza Açıklaması'),
              TextField(
                controller: _descCtrl,
                maxLines: 2,
                maxLength: 1000,
                decoration: const InputDecoration(hintText: 'Arızayı kısaca açıklayınız...'),
              ),
              const SectionTitle('Fotoğraflar (opsiyonel)'),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  for (var i = 0; i < _images.length; i++)
                    PhotoPreview(
                      key: ValueKey(_images[i].path),
                      file: _images[i],
                      size: 76,
                      onRemove: () => setState(() => _images.removeAt(i)),
                    ),
                  InkWell(
                    onTap: _submitting ? null : _addPhoto,
                    child: Container(
                      width: 76,
                      height: 76,
                      decoration: BoxDecoration(
                        color: Colors.white,
                        border: Border.all(color: AppColors.border),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: const Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(Icons.add_a_photo, size: 20, color: AppColors.primaryNavy),
                          SizedBox(height: 2),
                          Text('Fotoğraf Ekle',
                              style: TextStyle(fontSize: 10.5, color: AppColors.primaryNavy)),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

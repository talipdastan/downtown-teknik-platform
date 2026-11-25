import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'package:avm_tech_platform/features/work_tracking/presentation/widgets/work_tracking_widgets.dart';
import 'package:avm_tech_platform/features/work_tracking/work_tracking_access.dart';
import 'package:avm_tech_platform/core/theme/app_theme.dart';
import 'package:avm_tech_platform/core/network/api_client.dart';
import 'package:avm_tech_platform/core/utils/app_utils.dart';
import 'package:avm_tech_platform/core/utils/error_utils.dart';
import 'package:avm_tech_platform/features/work_tracking/utils/labels.dart';
import 'package:avm_tech_platform/features/work_tracking/data/models/extra_models.dart';
import 'package:avm_tech_platform/features/work_tracking/data/models/ticket_model.dart';
import 'package:avm_tech_platform/core/auth/auth_provider.dart';
import 'package:avm_tech_platform/features/work_tracking/providers/data_providers.dart';
import 'package:avm_tech_platform/core/widgets/common_widgets.dart';

class ManagerWorkOrdersScreen extends ConsumerStatefulWidget {
  const ManagerWorkOrdersScreen({super.key});

  @override
  ConsumerState<ManagerWorkOrdersScreen> createState() =>
      _ManagerWorkOrdersScreenState();
}

class _ManagerWorkOrdersScreenState extends ConsumerState<ManagerWorkOrdersScreen> {
  bool _busy = false;

  void _refreshAll() {
    ref.invalidate(pendingAssignmentTicketsProvider);
    ref.invalidate(pendingReviewTicketsProvider);
    ref.invalidate(activeManagerWorkOrdersProvider);
    ref.invalidate(ticketsProvider);
  }

  String _locationLabel(TicketModel t) {
    final parts = [
      if (t.floorName != null) t.floorName!,
      if (t.locationName != null) t.locationName!,
    ].join(' - ');
    return parts.isNotEmpty ? parts : (t.customLocation ?? '-');
  }

  Future<void> _openAssignSheet(TicketModel ticket) async {
    final created = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => _AssignWorkOrderSheet(ticket: ticket),
    );
    if (created == true && mounted) {
      _refreshAll();
      showAppSnack(context, '${ticket.ticketNumber ?? ''} için iş emri oluşturuldu ve atandı.');
    }
  }

  Future<void> _approveAndClose(TicketModel ticket) async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Arızayı Onayla ve Kapat'),
        content: Text(
          '${ticket.ticketNumber ?? ''} numaralı arızanın çözümünü onaylayıp kalıcı olarak kapatmak istiyor musunuz?',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Vazgeç')),
          ElevatedButton(
            style: ElevatedButton.styleFrom(
              backgroundColor: AppColors.statusResolved,
              minimumSize: const Size(110, 40),
            ),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Onayla ve Kapat'),
          ),
        ],
      ),
    );
    if (confirm != true) return;

    setState(() => _busy = true);
    try {
      await Api.client.rpc('rpc_manager_close_ticket', params: {
        'p_ticket_id': ticket.id,
        'p_resolution_note': 'Yönetici tarafından mobil uygulama üzerinden onaylanarak kapatılmıştır.',
        'p_reopen': false,
      });
      _refreshAll();
      if (mounted) showAppSnack(context, '${ticket.ticketNumber ?? ''} onaylandı ve kapatıldı.');
    } catch (e) {
      if (mounted) showAppSnack(context, friendlyError(e), error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _reopenWithReason(TicketModel ticket) async {
    final reason = await showDialog<String>(
      context: context,
      builder: (_) => const _ReopenReasonDialog(),
    );
    if (reason == null) return;

    setState(() => _busy = true);
    try {
      await Api.client.rpc('rpc_manager_close_ticket', params: {
        'p_ticket_id': ticket.id,
        'p_resolution_note': reason,
        'p_reopen': true,
      });
      _refreshAll();
      if (mounted) showAppSnack(context, 'İş emri gerekçesiyle teknisyene iade edildi.');
    } catch (e) {
      if (mounted) showAppSnack(context, friendlyError(e), error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final profile = ref.watch(authProvider).profile;
    final canAssign = profile?.hasActionAccess('work_order_assign') ?? false;
    final canReview = profile?.hasActionAccess('work_order_review') ?? false;

    final assignAsync = ref.watch(pendingAssignmentTicketsProvider);
    final reviewAsync = ref.watch(pendingReviewTicketsProvider);
    final activeAsync = ref.watch(activeManagerWorkOrdersProvider);

    final assignCount = assignAsync.maybeWhen(data: (l) => l.length, orElse: () => 0);
    final reviewCount = reviewAsync.maybeWhen(data: (l) => l.length, orElse: () => 0);
    final activeCount = activeAsync.maybeWhen(data: (l) => l.length, orElse: () => 0);

    return DefaultTabController(
      length: 3,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('İş Emirleri Yönetimi'),
          actions: [
            IconButton(
              tooltip: 'Yenile',
              onPressed: _refreshAll,
              icon: const Icon(Icons.refresh),
            ),
          ],
          bottom: TabBar(
            labelColor: AppColors.primaryNavy,
            unselectedLabelColor: AppColors.textSecondary,
            indicatorColor: AppColors.accentTurquoise,
            tabs: [
              Tab(text: 'İş Ata ($assignCount)'),
              Tab(text: 'Onayla ($reviewCount)'),
              Tab(text: 'Sahada ($activeCount)'),
            ],
          ),
        ),
        body: SafeArea(
          top: false,
          child: TabBarView(
            children: [
              // 1. SEKME: ATAMA BEKLEYEN ARIZALAR
              AsyncValueView<List<TicketModel>>(
                value: assignAsync,
                onRetry: () => ref.invalidate(pendingAssignmentTicketsProvider),
                data: (list) => RefreshIndicator(
                  onRefresh: () => ref.refresh(pendingAssignmentTicketsProvider.future),
                  child: list.isEmpty
                      ? ListView(
                          children: const [
                            SizedBox(height: 80),
                            Center(
                              child: Text(
                                'İş emri bekleyen açık arıza yok.',
                                style: TextStyle(color: AppColors.textSecondary),
                              ),
                            ),
                          ],
                        )
                      : ListView.builder(
                          padding: const EdgeInsets.fromLTRB(12, 8, 12, 16),
                          itemCount: list.length,
                          itemBuilder: (context, i) {
                            final t = list[i];
                            return Card(
                              margin: const EdgeInsets.only(bottom: 8),
                              child: Padding(
                                padding: const EdgeInsets.all(14),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
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
                                              fontWeight: FontWeight.bold,
                                              color: AppColors.primaryNavy,
                                            ),
                                          ),
                                        ),
                                        const SizedBox(width: 8),
                                        Flexible(
                                          child: StatusChip(
                                            label: Labels.priority(t.priority),
                                            color: priorityColor(t.priority),
                                          ),
                                        ),
                                      ],
                                    ),
                                    const SizedBox(height: 6),
                                    Text(
                                      '${_locationLabel(t)} · ${t.categoryName ?? t.customCategory ?? '-'}',
                                      style: const TextStyle(
                                        fontSize: 12,
                                        fontWeight: FontWeight.w600,
                                        color: AppColors.textSecondary,
                                      ),
                                    ),
                                    const SizedBox(height: 6),
                                    Text(t.description),
                                    const SizedBox(height: 10),
                                    Row(
                                      children: [
                                        Expanded(
                                          child: OutlinedButton(
                                            onPressed: () => context.push('/work-tracking/tickets/${t.id}'),
                                            child: const Text('Detay'),
                                          ),
                                        ),
                                        if (canAssign) ...[
                                          const SizedBox(width: 8),
                                          Expanded(
                                            flex: 2,
                                            child: ElevatedButton.icon(
                                              style: ElevatedButton.styleFrom(
                                                minimumSize: const Size(0, 42),
                                              ),
                                              onPressed: _busy ? null : () => _openAssignSheet(t),
                                              icon: const Icon(Icons.assignment_ind, size: 18),
                                              label: const Text('İş Emri Ata'),
                                            ),
                                          ),
                                        ],
                                      ],
                                    ),
                                  ],
                                ),
                              ),
                            );
                          },
                        ),
                ),
              ),

              // 2. SEKME: ÇÖZÜM ONAY VE KAPATMA
              AsyncValueView<List<TicketModel>>(
                value: reviewAsync,
                onRetry: () => ref.invalidate(pendingReviewTicketsProvider),
                data: (list) => RefreshIndicator(
                  onRefresh: () => ref.refresh(pendingReviewTicketsProvider.future),
                  child: list.isEmpty
                      ? ListView(
                          children: const [
                            SizedBox(height: 80),
                            Center(
                              child: Text(
                                'Onay bekleyen tamamlanmış iş bulunmuyor.',
                                style: TextStyle(color: AppColors.textSecondary),
                              ),
                            ),
                          ],
                        )
                      : ListView.builder(
                          padding: const EdgeInsets.fromLTRB(12, 8, 12, 16),
                          itemCount: list.length,
                          itemBuilder: (context, i) {
                            final t = list[i];
                            return Card(
                              margin: const EdgeInsets.only(bottom: 8),
                              child: Padding(
                                padding: const EdgeInsets.all(14),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
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
                                              fontWeight: FontWeight.bold,
                                              color: AppColors.primaryNavy,
                                            ),
                                          ),
                                        ),
                                        const SizedBox(width: 8),
                                        const Flexible(
                                          child: StatusChip(
                                            label: 'Onay Bekliyor',
                                            color: AppColors.statusResolved,
                                          ),
                                        ),
                                      ],
                                    ),
                                    const SizedBox(height: 6),
                                    Text(
                                      _locationLabel(t),
                                      style: const TextStyle(
                                        fontSize: 12,
                                        fontWeight: FontWeight.w600,
                                        color: AppColors.textSecondary,
                                      ),
                                    ),
                                    const SizedBox(height: 6),
                                    Text(t.description),
                                    const SizedBox(height: 6),
                                    TextButton.icon(
                                      onPressed: () => context.push('/work-tracking/tickets/${t.id}'),
                                      icon: const Icon(Icons.photo_library_outlined, size: 16),
                                      label: const Text('Fotoğrafları ve Geçmişi Gör'),
                                    ),
                                    if (canReview) ...[
                                      const SizedBox(height: 4),
                                      Row(
                                        children: [
                                          Expanded(
                                            child: OutlinedButton.icon(
                                              style: OutlinedButton.styleFrom(
                                                foregroundColor: AppColors.priorityUrgent,
                                                minimumSize: const Size(0, 42),
                                              ),
                                              onPressed: _busy ? null : () => _reopenWithReason(t),
                                              icon: const Icon(Icons.replay, size: 18),
                                              label: const Text('İade Et'),
                                            ),
                                          ),
                                          const SizedBox(width: 8),
                                          Expanded(
                                            flex: 2,
                                            child: ElevatedButton.icon(
                                              style: ElevatedButton.styleFrom(
                                                backgroundColor: AppColors.statusResolved,
                                                minimumSize: const Size(0, 42),
                                              ),
                                              onPressed: _busy ? null : () => _approveAndClose(t),
                                              icon: const Icon(Icons.check_circle, size: 18),
                                              label: const Text('Onayla ve Kapat'),
                                            ),
                                          ),
                                        ],
                                      ),
                                    ],
                                  ],
                                ),
                              ),
                            );
                          },
                        ),
                ),
              ),

              // 3. SEKME: SAHADA AKTİF İŞ EMİRLERİ
              AsyncValueView<List<WorkOrderView>>(
                value: activeAsync,
                onRetry: () => ref.invalidate(activeManagerWorkOrdersProvider),
                data: (list) => RefreshIndicator(
                  onRefresh: () => ref.refresh(activeManagerWorkOrdersProvider.future),
                  child: list.isEmpty
                      ? ListView(
                          children: const [
                            SizedBox(height: 80),
                            Center(
                              child: Text(
                                'Sahada aktif iş emri yok.',
                                style: TextStyle(color: AppColors.textSecondary),
                              ),
                            ),
                          ],
                        )
                      : ListView.builder(
                          padding: const EdgeInsets.fromLTRB(12, 8, 12, 16),
                          itemCount: list.length,
                          itemBuilder: (context, i) {
                            final v = list[i];
                            final o = v.order;
                            return Card(
                              margin: const EdgeInsets.only(bottom: 8),
                              child: InkWell(
                                borderRadius: BorderRadius.circular(12),
                                onTap: () => context.push('/work-tracking/work-orders/${o.id}'),
                                child: Padding(
                                  padding: const EdgeInsets.all(14),
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
                                                color: AppColors.primaryNavy,
                                              ),
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
                                      const SizedBox(height: 6),
                                      Text(
                                        '${o.departmentName ?? '-'} · ${v.locationLabel ?? '-'}',
                                        style: const TextStyle(
                                          fontSize: 12,
                                          color: AppColors.textSecondary,
                                        ),
                                      ),
                                      const SizedBox(height: 4),
                                      Text(
                                        o.workDescription ?? v.ticketDescription ?? '-',
                                        maxLines: 2,
                                        overflow: TextOverflow.ellipsis,
                                      ),
                                      const SizedBox(height: 4),
                                      Text(
                                        AppUtils.formatDateTime(o.createdAt),
                                        style: const TextStyle(
                                          fontSize: 11,
                                          color: AppColors.textSecondary,
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              ),
                            );
                          },
                        ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _AssignWorkOrderSheet extends ConsumerStatefulWidget {
  final TicketModel ticket;
  const _AssignWorkOrderSheet({required this.ticket});

  @override
  ConsumerState<_AssignWorkOrderSheet> createState() => _AssignWorkOrderSheetState();
}

class _AssignWorkOrderSheetState extends ConsumerState<_AssignWorkOrderSheet> {
  String? _deptId;
  final Set<String> _techIds = {};
  final TextEditingController _noteCtrl = TextEditingController();
  bool _submitting = false;

  @override
  void dispose() {
    _noteCtrl.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_deptId == null) {
      showAppSnack(context, 'Lütfen departman seçiniz.', error: true);
      return;
    }
    setState(() => _submitting = true);
    try {
      await Api.client.rpc('rpc_create_work_order', params: {
        'p_ticket_id': widget.ticket.id,
        'p_department_id': _deptId,
        'p_assigned_user_ids': _techIds.toList(),
        'p_work_description': _noteCtrl.text.trim().isEmpty ? null : _noteCtrl.text.trim(),
      });
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) showAppSnack(context, friendlyError(e), error: true);
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final deptsAsync = ref.watch(activeDepartmentsProvider);
    final techsAsync = ref.watch(approvedTechniciansProvider);

    return Padding(
      padding: EdgeInsets.only(
        left: 16,
        right: 16,
        top: 16,
        bottom: MediaQuery.of(context).viewInsets.bottom + 16,
      ),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Expanded(
                  child: Text(
                    'İş Emri Ata · ${widget.ticket.ticketNumber ?? ''}',
                    style: const TextStyle(
                      fontSize: 17,
                      fontWeight: FontWeight.bold,
                      color: AppColors.primaryNavy,
                    ),
                  ),
                ),
                IconButton(
                  onPressed: () => Navigator.pop(context),
                  icon: const Icon(Icons.close),
                ),
              ],
            ),
            Text(widget.ticket.description,
                maxLines: 3,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontSize: 13, color: AppColors.textSecondary)),
            const SectionTitle('Departman *'),
            deptsAsync.when(
              loading: () => const LinearProgressIndicator(),
              error: (e, _) => Text(friendlyError(e),
                  style: const TextStyle(color: AppColors.priorityUrgent)),
              data: (depts) => DropdownButtonFormField<String>(
                initialValue: _deptId,
                isExpanded: true,
                hint: const Text('Departman seçiniz'),
                items: [
                  for (final d in depts) DropdownMenuItem(value: d.id, child: Text(d.name)),
                ],
                onChanged: (v) => setState(() {
                  _deptId = v;
                  _techIds.clear();
                }),
              ),
            ),
            if (_deptId != null) ...[
              const SectionTitle('Teknisyen Seçimi'),
              techsAsync.when(
                loading: () => const LinearProgressIndicator(),
                error: (e, _) => Text(friendlyError(e),
                    style: const TextStyle(color: AppColors.priorityUrgent)),
                data: (allTechs) {
                  final list = allTechs
                      .where((t) => t.departmentId == _deptId || t.departmentId == null)
                      .toList();
                  if (list.isEmpty) {
                    return const Text(
                      'Bu departmanda onaylı teknisyen bulunmuyor.',
                      style: TextStyle(fontSize: 12, color: AppColors.textSecondary),
                    );
                  }
                  return Container(
                    constraints: const BoxConstraints(maxHeight: 180),
                    decoration: BoxDecoration(
                      border: Border.all(color: AppColors.border),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: ListView(
                      shrinkWrap: true,
                      children: [
                        for (final tech in list)
                          CheckboxListTile(
                            dense: true,
                            value: _techIds.contains(tech.id),
                            title: Text(tech.fullName),
                            onChanged: (checked) => setState(() {
                              if (checked == true) {
                                _techIds.add(tech.id);
                              } else {
                                _techIds.remove(tech.id);
                              }
                            }),
                          ),
                      ],
                    ),
                  );
                },
              ),
            ],
            const SectionTitle('Teknik Talimatlar / Not'),
            TextField(
              controller: _noteCtrl,
              maxLines: 2,
              decoration: const InputDecoration(hintText: 'Teknisyene iletilecek talimatlar...'),
            ),
            const SizedBox(height: 16),
            ElevatedButton(
              onPressed: _submitting ? null : _submit,
              child: Text(_submitting ? 'Atanıyor...' : 'İş Emrini Oluştur ve Ata'),
            ),
          ],
        ),
      ),
    );
  }
}

class _ReopenReasonDialog extends StatefulWidget {
  const _ReopenReasonDialog();

  @override
  State<_ReopenReasonDialog> createState() => _ReopenReasonDialogState();
}

class _ReopenReasonDialogState extends State<_ReopenReasonDialog> {
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
      title: const Text('Tekrar İşe İade Et'),
      content: TextField(
        controller: _ctrl,
        maxLines: 3,
        decoration: InputDecoration(
          hintText: 'İade gerekçesini yazınız...',
          helperText: 'Gerekçesiz iade yapılamaz.',
          errorText: _error,
        ),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: const Text('Vazgeç')),
        ElevatedButton(
          style: ElevatedButton.styleFrom(
            backgroundColor: AppColors.priorityUrgent,
            minimumSize: const Size(110, 40),
          ),
          onPressed: () {
            final txt = _ctrl.text.trim();
            if (txt.isEmpty) {
              setState(() => _error = 'Lütfen iade gerekçesi giriniz.');
              return;
            }
            Navigator.pop(context, txt);
          },
          child: const Text('İade Et'),
        ),
      ],
    );
  }
}

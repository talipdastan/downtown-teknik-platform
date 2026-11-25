import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'package:avm_tech_platform/features/work_tracking/presentation/widgets/work_tracking_widgets.dart';
import 'package:avm_tech_platform/core/theme/app_theme.dart';
import 'package:avm_tech_platform/features/work_tracking/utils/labels.dart';
import 'package:avm_tech_platform/features/work_tracking/data/models/extra_models.dart';
import 'package:avm_tech_platform/features/work_tracking/providers/data_providers.dart';
import 'package:avm_tech_platform/core/widgets/common_widgets.dart';

class WorkOrderListScreen extends ConsumerStatefulWidget {
  const WorkOrderListScreen({super.key});

  @override
  ConsumerState<WorkOrderListScreen> createState() => _WorkOrderListScreenState();
}

class _WorkOrderListScreenState extends ConsumerState<WorkOrderListScreen> {
  bool _showActive = true;

  @override
  Widget build(BuildContext context) {
    final asyncValue = ref.watch(myWorkOrdersProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Bana Atanan İşler')),
      body: SafeArea(
        top: false,
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 12, 12, 10),
              child: SegmentedButton<bool>(
                segments: const [
                  ButtonSegment(value: true, label: Text('Aktif')),
                  ButtonSegment(value: false, label: Text('Tamamlanan')),
                ],
                selected: {_showActive},
                onSelectionChanged: (s) => setState(() => _showActive = s.first),
              ),
            ),
            Expanded(
              child: AsyncValueView<List<WorkOrderView>>(
                value: asyncValue,
                onRetry: () => ref.invalidate(myWorkOrdersProvider),
                data: (all) {
                  final list = all
                      .where((w) => _showActive
                          ? w.order.status != 'completed'
                          : w.order.status == 'completed')
                      .toList();
                  return RefreshIndicator(
                    onRefresh: () => ref.refresh(myWorkOrdersProvider.future),
                    child: list.isEmpty
                        ? ListView(
                            children: [
                              const SizedBox(height: 80),
                              Center(
                                child: Text(
                                  _showActive
                                      ? 'Size atanmış aktif iş emri yok.'
                                      : 'Tamamlanmış iş emri yok.',
                                  style: const TextStyle(color: AppColors.textSecondary),
                                ),
                              ),
                            ],
                          )
                        : ListView.builder(
                            padding: const EdgeInsets.fromLTRB(12, 0, 12, 16),
                            itemCount: list.length,
                            itemBuilder: (context, i) => _WorkOrderCard(view: list[i]),
                          ),
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _WorkOrderCard extends StatelessWidget {
  final WorkOrderView view;
  const _WorkOrderCard({required this.view});

  @override
  Widget build(BuildContext context) {
    final o = view.order;
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
                          fontWeight: FontWeight.bold, color: AppColors.primaryNavy),
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
              Text(view.ticketDescription ?? '-', maxLines: 2, overflow: TextOverflow.ellipsis),
              const SizedBox(height: 8),
              Row(
                children: [
                  if (view.ticketPriority != null) ...[
                    StatusChip(
                      label: Labels.priority(view.ticketPriority!),
                      color: priorityColor(view.ticketPriority!),
                    ),
                    const SizedBox(width: 8),
                  ],
                  Expanded(
                    child: Text(
                      view.locationLabel ?? '',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontSize: 12, color: AppColors.textSecondary),
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


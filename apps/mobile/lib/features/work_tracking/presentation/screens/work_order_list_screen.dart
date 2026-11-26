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
    final category = view.categoryName ?? 'Teknik İş Emri';
    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: () => context.push('/work-tracking/work-orders/${o.id}'),
        child: Padding(
          padding: const EdgeInsets.all(13),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Expanded(
                    child: Text(
                      'Teknik / $category',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 13.5,
                        fontWeight: FontWeight.w800,
                        color: AppColors.textPrimary,
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  if (view.ticketPriority != null)
                    StatusChip(
                      label: Labels.priority(view.ticketPriority!),
                      color: priorityColor(view.ticketPriority!),
                    ),
                ],
              ),
              const SizedBox(height: 4),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    o.departmentName ?? 'Teknik Ekip',
                    style: const TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                      color: AppColors.primaryNavy,
                    ),
                  ),
                  Text(
                    '#${o.ticketNumber ?? '-'}',
                    style: const TextStyle(
                      fontSize: 11.5,
                      fontWeight: FontWeight.w700,
                      color: AppColors.textSecondary,
                    ),
                  ),
                ],
              ),
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 8),
                child: Divider(height: 1, color: AppColors.border),
              ),
              _WoInfoLine(label: 'Lokasyon', value: view.locationLabel ?? '-'),
              _WoInfoLine(
                label: 'Durum',
                value: Labels.workOrderStatus(o.status),
                valueColor: workOrderStatusColor(o.status),
                bold: true,
              ),
              _WoInfoLine(
                label: 'Açıklama',
                value: view.ticketDescription ?? '-',
                maxLines: 2,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _WoInfoLine extends StatelessWidget {
  final String label;
  final String value;
  final Color? valueColor;
  final bool bold;
  final int maxLines;

  const _WoInfoLine({
    required this.label,
    required this.value,
    this.valueColor,
    this.bold = false,
    this.maxLines = 1,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 86,
            child: Text(
              label,
              style: const TextStyle(
                fontSize: 11.5,
                color: AppColors.textSecondary,
              ),
            ),
          ),
          const Text(
            ': ',
            style: TextStyle(fontSize: 11.5, color: AppColors.textSecondary),
          ),
          Expanded(
            child: Text(
              value,
              maxLines: maxLines,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontSize: 11.5,
                fontWeight: bold ? FontWeight.w800 : FontWeight.w600,
                color: valueColor ?? AppColors.textPrimary,
              ),
            ),
          ),
        ],
      ),
    );
  }
}


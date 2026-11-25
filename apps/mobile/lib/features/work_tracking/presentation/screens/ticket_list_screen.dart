import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'package:avm_tech_platform/features/work_tracking/presentation/widgets/work_tracking_widgets.dart';
import 'package:avm_tech_platform/features/work_tracking/work_tracking_access.dart';
import 'package:avm_tech_platform/core/theme/app_theme.dart';
import 'package:avm_tech_platform/core/utils/app_utils.dart';
import 'package:avm_tech_platform/features/work_tracking/utils/labels.dart';
import 'package:avm_tech_platform/features/work_tracking/utils/ticket_filter.dart';
import 'package:avm_tech_platform/features/work_tracking/data/models/ticket_model.dart';
import 'package:avm_tech_platform/core/auth/auth_provider.dart';
import 'package:avm_tech_platform/features/work_tracking/providers/data_providers.dart';
import 'package:avm_tech_platform/core/widgets/common_widgets.dart';

const List<String> _statuses = [
  'new',
  'under_review',
  'assigned',
  'in_progress',
  'waiting',
  'resolved',
  'closed',
  'cancelled',
];
const List<String> _priorities = ['normal', 'priority', 'urgent'];

class TicketListScreen extends ConsumerStatefulWidget {
  const TicketListScreen({super.key});

  @override
  ConsumerState<TicketListScreen> createState() => _TicketListScreenState();
}

class _TicketListScreenState extends ConsumerState<TicketListScreen> {
  String? _status;
  String? _priority;
  String _query = '';

  @override
  Widget build(BuildContext context) {
    final asyncValue = ref.watch(ticketsProvider);
    final canCreate = ref.watch(authProvider).profile?.hasActionAccess('ticket_create') ?? false;

    return Scaffold(
      appBar: AppBar(title: const Text('Arıza Kayıtları')),
      floatingActionButton: canCreate
          ? FloatingActionButton.extended(
              backgroundColor: AppColors.primaryNavy,
              foregroundColor: AppColors.white,
              onPressed: () => context.push('/work-tracking/tickets/new'),
              icon: const Icon(Icons.add),
              label: const Text('Yeni Arıza'),
            )
          : null,
      body: SafeArea(
        top: false,
        child: Column(
          children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
            child: TextField(
              decoration: const InputDecoration(
                hintText: 'Arıza no veya açıklama ara...',
                prefixIcon: Icon(Icons.search),
              ),
              onChanged: (v) => setState(() => _query = v),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
            child: Row(
              children: [
                Expanded(
                  child: DropdownButtonFormField<String?>(
                    initialValue: _status,
                    isExpanded: true,
                    decoration: const InputDecoration(
                      labelText: 'Durum',
                      isDense: true,
                      contentPadding: EdgeInsets.symmetric(horizontal: 10, vertical: 10),
                    ),
                    items: [
                      const DropdownMenuItem<String?>(value: null, child: Text('Tümü', overflow: TextOverflow.ellipsis)),
                      for (final s in _statuses)
                        DropdownMenuItem<String?>(
                          value: s,
                          child: Text(Labels.ticketStatus(s), overflow: TextOverflow.ellipsis),
                        ),
                    ],
                    onChanged: (v) => setState(() => _status = v),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: DropdownButtonFormField<String?>(
                    initialValue: _priority,
                    isExpanded: true,
                    decoration: const InputDecoration(
                      labelText: 'Öncelik',
                      isDense: true,
                      contentPadding: EdgeInsets.symmetric(horizontal: 10, vertical: 10),
                    ),
                    items: [
                      const DropdownMenuItem<String?>(value: null, child: Text('Tümü', overflow: TextOverflow.ellipsis)),
                      for (final p in _priorities)
                        DropdownMenuItem<String?>(
                          value: p,
                          child: Text(Labels.priority(p), overflow: TextOverflow.ellipsis),
                        ),
                    ],
                    onChanged: (v) => setState(() => _priority = v),
                  ),
                ),
              ],
            ),
          ),
          Expanded(
            child: AsyncValueView<List<TicketModel>>(
              value: asyncValue,
              onRetry: () => ref.invalidate(ticketsProvider),
              data: (tickets) {
                final filtered = TicketFilter.apply(
                  tickets,
                  status: _status,
                  priority: _priority,
                  query: _query,
                );
                return RefreshIndicator(
                  onRefresh: () => ref.refresh(ticketsProvider.future),
                  child: filtered.isEmpty
                      ? ListView(
                          children: [
                            const SizedBox(height: 80),
                            Center(
                              child: Text(
                                tickets.isEmpty
                                    ? 'Henüz arıza kaydı yok.'
                                    : 'Filtreye uyan kayıt bulunamadı.',
                                style: const TextStyle(color: AppColors.textSecondary),
                              ),
                            ),
                          ],
                        )
                      : ListView.builder(
                          padding: const EdgeInsets.fromLTRB(12, 0, 12, 88),
                          itemCount: filtered.length,
                          itemBuilder: (context, i) => _TicketCard(ticket: filtered[i]),
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

class _TicketCard extends StatelessWidget {
  final TicketModel ticket;
  const _TicketCard({required this.ticket});

  @override
  Widget build(BuildContext context) {
    final locationParts = [
      if (ticket.floorName != null) ticket.floorName!,
      if (ticket.locationName != null) ticket.locationName!,
    ].join(' - ');
    final location = locationParts.isNotEmpty ? locationParts : (ticket.customLocation ?? '');
    final category = ticket.categoryName ?? ticket.customCategory;

    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: () => context.push('/work-tracking/tickets/${ticket.id}'),
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
                      ticket.ticketNumber ?? '-',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                          fontWeight: FontWeight.bold, color: AppColors.primaryNavy),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Flexible(
                    child: StatusChip(
                      label: Labels.ticketStatus(ticket.status),
                      color: ticketStatusColor(ticket.status),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 6),
              Text(ticket.description, maxLines: 2, overflow: TextOverflow.ellipsis),
              const SizedBox(height: 8),
              Row(
                children: [
                  StatusChip(
                    label: Labels.priority(ticket.priority),
                    color: priorityColor(ticket.priority),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      [
                        if (location.isNotEmpty) location,
                        if (category != null && category.isNotEmpty) category,
                      ].join(' · '),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontSize: 12, color: AppColors.textSecondary),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 4),
              Text(AppUtils.formatDateTime(ticket.createdAt),
                  style: const TextStyle(fontSize: 11, color: AppColors.textSecondary)),
            ],
          ),
        ),
      ),
    );
  }
}


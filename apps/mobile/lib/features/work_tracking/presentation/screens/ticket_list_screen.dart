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
  final String? initialStatus;
  final String? initialTab; // 'active' | 'closed'

  const TicketListScreen({
    super.key,
    this.initialStatus,
    this.initialTab,
  });

  @override
  ConsumerState<TicketListScreen> createState() => _TicketListScreenState();
}

class _TicketListScreenState extends ConsumerState<TicketListScreen> {
  String? _status;
  String? _priority;
  String _query = '';
  // 'active' = Tüm Aktif İşler (Atama Bekleyen + Sahada İşlemde + Çözüm Onayı Bekleyen)
  // 'closed' = Yalnızca Onaylanıp Kapananlar (closed / cancelled)
  bool _showActiveTab = true;

  @override
  void initState() {
    super.initState();
    _status = widget.initialStatus;
    if (widget.initialTab == 'closed' ||
        widget.initialStatus == 'closed' ||
        widget.initialStatus == 'cancelled') {
      _showActiveTab = false;
    } else {
      _showActiveTab = true;
    }
  }

  bool _isClosedTicket(TicketModel t) =>
      t.status == 'closed' || t.status == 'cancelled';

  @override
  Widget build(BuildContext context) {
    final asyncValue = ref.watch(ticketsProvider);
    final canCreate =
        ref.watch(authProvider).profile?.hasActionAccess('ticket_create') ??
            false;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Hizmet Talepleri / Arızalar'),
        actions: [
          if (canCreate)
            Padding(
              padding: const EdgeInsets.only(right: 10),
              child: Tooltip(
                message: 'Yeni Arıza',
                child: InkWell(
                  onTap: () => context.push('/work-tracking/tickets/new'),
                  borderRadius: BorderRadius.circular(10),
                  child: Container(
                    width: 34,
                    height: 34,
                    decoration: BoxDecoration(
                      color: AppColors.background,
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(color: AppColors.border),
                    ),
                    child: const Icon(
                      Icons.add_rounded,
                      color: AppColors.primaryNavy,
                      size: 20,
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
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
            // 1) Arama Kutusu
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 10, 12, 6),
              child: TextField(
                decoration: const InputDecoration(
                  hintText: 'Arıza no, kategori, mahal veya açıklama ara...',
                  prefixIcon: Icon(Icons.search),
                ),
                onChanged: (v) => setState(() => _query = v),
              ),
            ),

            // 2) Senyonet Tarzı İkili Sekme: Aktif (Atama Bekleyen + Sahada + Onay Bekleyen) / Kapanan
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 2, 12, 6),
              child: Container(
                padding: const EdgeInsets.all(3),
                decoration: BoxDecoration(
                  color: AppColors.white,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: AppColors.border),
                ),
                child: Row(
                  children: [
                    Expanded(
                      child: _SegmentPill(
                        label: 'Aktif (Devam Eden & Onayda)',
                        selected: _showActiveTab,
                        onTap: () => setState(() {
                          _showActiveTab = true;
                          if (_status == 'closed' || _status == 'cancelled') {
                            _status = null;
                          }
                        }),
                      ),
                    ),
                    Expanded(
                      child: _SegmentPill(
                        label: 'Kapanan',
                        selected: !_showActiveTab,
                        onTap: () => setState(() {
                          _showActiveTab = false;
                          if (_status != null &&
                              _status != 'closed' &&
                              _status != 'cancelled') {
                            _status = null;
                          }
                        }),
                      ),
                    ),
                  ],
                ),
              ),
            ),

            // 3) Durum & Öncelik Alt Filtreleri
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 0, 12, 8),
              child: Row(
                children: [
                  Expanded(
                    child: DropdownButtonFormField<String?>(
                      initialValue: _status,
                      isExpanded: true,
                      decoration: const InputDecoration(
                        labelText: 'Durum',
                        isDense: true,
                        contentPadding:
                            EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                      ),
                      items: [
                        const DropdownMenuItem<String?>(
                          value: null,
                          child: Text('Tümü', overflow: TextOverflow.ellipsis),
                        ),
                        for (final s in _statuses)
                          DropdownMenuItem<String?>(
                            value: s,
                            child: Text(
                              Labels.ticketStatus(s),
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                      ],
                      onChanged: (v) => setState(() {
                        _status = v;
                        if (v == 'closed' || v == 'cancelled') {
                          _showActiveTab = false;
                        } else if (v != null) {
                          _showActiveTab = true;
                        }
                      }),
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
                        contentPadding:
                            EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                      ),
                      items: [
                        const DropdownMenuItem<String?>(
                          value: null,
                          child: Text('Tümü', overflow: TextOverflow.ellipsis),
                        ),
                        for (final p in _priorities)
                          DropdownMenuItem<String?>(
                            value: p,
                            child: Text(
                              Labels.priority(p),
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                      ],
                      onChanged: (v) => setState(() => _priority = v),
                    ),
                  ),
                ],
              ),
            ),

            // 4) Yapılandırılmış Hizmet Talebi Kart Listesi
            Expanded(
              child: AsyncValueView<List<TicketModel>>(
                value: asyncValue,
                onRetry: () => invalidateAllWorkTrackingProviders(ref),
                data: (tickets) {
                  final tabScoped = _status != null
                      ? tickets
                      : tickets
                          .where((t) => _showActiveTab
                              ? !_isClosedTicket(t)
                              : _isClosedTicket(t))
                          .toList();
                  final filtered = TicketFilter.apply(
                    tabScoped,
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
                                  style: const TextStyle(
                                      color: AppColors.textSecondary),
                                ),
                              ),
                            ],
                          )
                        : ListView.builder(
                            padding: const EdgeInsets.fromLTRB(12, 0, 12, 88),
                            itemCount: filtered.length,
                            itemBuilder: (context, i) =>
                                _TicketCard(ticket: filtered[i]),
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

class _SegmentPill extends StatelessWidget {
  final String label;
  final bool selected;
  final VoidCallback onTap;

  const _SegmentPill({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(10),
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 8),
        decoration: BoxDecoration(
          color: selected ? AppColors.primaryNavy : Colors.transparent,
          borderRadius: BorderRadius.circular(10),
        ),
        alignment: Alignment.center,
        child: Text(
          label,
          style: TextStyle(
            fontSize: 12.5,
            fontWeight: FontWeight.w800,
            color: selected ? Colors.white : AppColors.textSecondary,
          ),
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
    final location = locationParts.isNotEmpty
        ? locationParts
        : (ticket.customLocation ?? '-');
    final category = ticket.categoryName ?? ticket.customCategory ?? 'Teknik Arıza';
    final equipmentLabel = (ticket.equipmentName != null &&
            ticket.equipmentName!.trim().isNotEmpty)
        ? '${ticket.equipmentCode != null ? '(${ticket.equipmentCode}) ' : ''}${ticket.equipmentName}'
        : null;

    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: () => context.push('/work-tracking/tickets/${ticket.id}'),
        child: Padding(
          padding: const EdgeInsets.all(13),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Üst Başlık: Kategori + Öncelik Rozeti
              Row(
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
                  const SizedBox(width: 6),
                  StatusChip(
                    label: Labels.priority(ticket.priority),
                    color: priorityColor(ticket.priority),
                  ),
                ],
              ),
              if (equipmentLabel != null) ...[
                const SizedBox(height: 3),
                Text(
                  equipmentLabel,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 12.5,
                    fontWeight: FontWeight.w800,
                    color: AppColors.primaryNavy,
                  ),
                ),
              ],
              const SizedBox(height: 4),
              // Tarih & #Kayıt No Satırı
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    AppUtils.formatDateTime(ticket.createdAt),
                    style: const TextStyle(
                      fontSize: 11.5,
                      fontWeight: FontWeight.w700,
                      color: AppColors.textPrimary,
                    ),
                  ),
                  const SizedBox(width: 8),
                  Flexible(
                    child: Text(
                      '#${ticket.ticketNumber ?? ticket.id.substring(0, 8)}',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 11.5,
                        fontWeight: FontWeight.w700,
                        color: AppColors.textSecondary,
                      ),
                    ),
                  ),
                ],
              ),
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 8),
                child: Divider(height: 1, color: AppColors.border),
              ),
              // Yapılandırılmış Key : Value Tablosu
              _KeyValueLine(label: 'Lokasyon', value: location),
              _KeyValueLine(
                label: 'Durum',
                value: Labels.ticketStatus(ticket.status),
                valueColor: ticketStatusColor(ticket.status),
                boldValue: true,
              ),
              _KeyValueLine(
                label: 'Bildiren Kişi',
                value: ticket.reporterName ?? 'Downtown Teknik',
              ),
              _KeyValueLine(
                label: 'Açıklama',
                value: ticket.description,
                maxLines: 2,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _KeyValueLine extends StatelessWidget {
  final String label;
  final String value;
  final Color? valueColor;
  final bool boldValue;
  final int maxLines;

  const _KeyValueLine({
    required this.label,
    required this.value,
    this.valueColor,
    this.boldValue = false,
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
            style: TextStyle(
              fontSize: 11.5,
              color: AppColors.textSecondary,
            ),
          ),
          Expanded(
            child: Text(
              value.isEmpty ? '-' : value,
              maxLines: maxLines,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontSize: 11.5,
                fontWeight: boldValue ? FontWeight.w800 : FontWeight.w600,
                color: valueColor ?? AppColors.textPrimary,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'package:avm_tech_platform/core/auth/auth_provider.dart';
import 'package:avm_tech_platform/core/network/api_client.dart';
import 'package:avm_tech_platform/core/notifications/notification_models.dart';
import 'package:avm_tech_platform/core/notifications/notification_providers.dart';
import 'package:avm_tech_platform/core/theme/app_theme.dart';
import 'package:avm_tech_platform/core/utils/app_utils.dart';
import 'package:avm_tech_platform/core/utils/error_utils.dart';
import 'package:avm_tech_platform/core/widgets/common_widgets.dart';

/// Merkezi bildirim ekranı. Bildirime dokununca ilgili kayda gidilir; rota,
/// bildirimi üreten modülün `AppModule.notificationRoute` tanımından çözülür.
class NotificationsScreen extends ConsumerWidget {
  const NotificationsScreen({super.key});

  void _refresh(WidgetRef ref) {
    ref.invalidate(notificationsProvider);
    ref.invalidate(unreadCountProvider);
  }

  Future<void> _markRead(BuildContext context, WidgetRef ref, AppNotification n) async {
    if (n.isRead) return;
    try {
      await Api.client.from('notifications').update({'is_read': true}).eq('id', n.id);
      _refresh(ref);
    } catch (e) {
      if (context.mounted) showAppSnack(context, friendlyError(e), error: true);
    }
  }

  Future<void> _markAllRead(BuildContext context, WidgetRef ref) async {
    try {
      await Api.client
          .from('notifications')
          .update({'is_read': true})
          .eq('user_id', Api.userId)
          .eq('is_read', false);
      _refresh(ref);
    } catch (e) {
      if (context.mounted) showAppSnack(context, friendlyError(e), error: true);
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final asyncValue = ref.watch(notificationsProvider);
    final registry = ref.watch(moduleRegistryProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Bildirimler'),
        actions: [
          IconButton(
            tooltip: 'Tümünü okundu işaretle',
            onPressed: () => _markAllRead(context, ref),
            icon: const Icon(Icons.done_all),
          ),
        ],
      ),
      body: SafeArea(
        top: false,
        child: AsyncValueView<List<AppNotification>>(
          value: asyncValue,
          onRetry: () => _refresh(ref),
          data: (list) => RefreshIndicator(
            onRefresh: () => ref.refresh(notificationsProvider.future),
            child: list.isEmpty
                ? ListView(
                    children: const [
                      SizedBox(height: 80),
                      Center(
                        child: Text('Bildiriminiz yok.',
                            style: TextStyle(color: AppColors.textSecondary)),
                      ),
                    ],
                  )
                : ListView.separated(
                    itemCount: list.length,
                    separatorBuilder: (_, __) => const Divider(height: 1),
                    itemBuilder: (context, i) {
                      final n = list[i];
                      return ListTile(
                        tileColor: n.isRead ? null : AppColors.primaryNavy.withValues(alpha: 0.06),
                        leading: Icon(
                          n.isRead ? Icons.notifications_none : Icons.notifications_active,
                          color: n.isRead ? AppColors.textSecondary : AppColors.primaryNavy,
                        ),
                        title: Text(n.title,
                            style: TextStyle(
                                fontWeight: n.isRead ? FontWeight.normal : FontWeight.bold)),
                        subtitle: Text('${n.message}\n${AppUtils.formatDateTime(n.createdAt)}'),
                        isThreeLine: true,
                        onTap: () async {
                          await _markRead(context, ref, n);
                          final route = registry.resolveNotificationRoute(
                            n.moduleKey,
                            n.entityType,
                            n.entityId,
                          );
                          if (route != null && context.mounted) context.push(route);
                        },
                      );
                    },
                  ),
          ),
        ),
      ),
    );
  }
}

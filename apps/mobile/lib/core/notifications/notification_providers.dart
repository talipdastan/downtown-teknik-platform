import 'package:avm_tech_platform/core/network/api_client.dart';
import 'package:avm_tech_platform/core/notifications/notification_models.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

final notificationsProvider =
    FutureProvider.autoDispose<List<AppNotification>>((ref) async {
  final data = await Api.client
      .from('notifications')
      .select()
      .eq('user_id', Api.userId)
      .order('created_at', ascending: false)
      .limit(100);
  return (data as List)
      .map((e) => AppNotification.fromJson(Map<String, dynamic>.from(e as Map)))
      .toList();
});

final unreadCountProvider = FutureProvider.autoDispose<int>((ref) async {
  final data = await Api.client
      .from('notifications')
      .select('id')
      .eq('user_id', Api.userId)
      .eq('is_read', false)
      .limit(100);
  return (data as List).length;
});

import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'package:avm_tech_platform/core/config/supabase_config.dart';

@pragma('vm:entry-point')
Future<void> firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  try {
    await Firebase.initializeApp();
  } catch (_) {}
}

class NotificationService {
  NotificationService._();
  static final NotificationService instance = NotificationService._();

  final FlutterLocalNotificationsPlugin _plugin = FlutterLocalNotificationsPlugin();
  RealtimeChannel? _channel;
  StreamSubscription<RemoteMessage>? _fcmSub;
  String? _activeUserId;
  bool _initialized = false;
  bool _firebaseReady = false;
  final Set<String> _shownIds = {};

  static const AndroidNotificationChannel _androidChannel = AndroidNotificationChannel(
    'avm_tech_alerts',
    'Downtown Teknik Operasyon Bildirimleri',
    description: 'Yeni iş emri, acil arıza ve onay bildirimleri',
    importance: Importance.max,
  );

  Future<void> init() async {
    if (_initialized || kIsWeb) return;
    const androidInit = AndroidInitializationSettings('@mipmap/ic_launcher');
    const darwinInit = DarwinInitializationSettings(
      requestAlertPermission: true,
      requestBadgePermission: true,
      requestSoundPermission: true,
    );
    const settings = InitializationSettings(android: androidInit, iOS: darwinInit);
    await _plugin.initialize(settings);

    final androidPlugin =
        _plugin.resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>();
    if (androidPlugin != null) {
      await androidPlugin.createNotificationChannel(_androidChannel);
      await androidPlugin.requestNotificationsPermission();
    }

    try {
      await Firebase.initializeApp();
      FirebaseMessaging.onBackgroundMessage(firebaseMessagingBackgroundHandler);
      await FirebaseMessaging.instance.requestPermission(
        alert: true,
        badge: true,
        sound: true,
      );
      _firebaseReady = true;
    } catch (_) {
      _firebaseReady = false;
    }

    _initialized = true;
  }

  Future<void> showLocalNotification({
    required String idKey,
    required String title,
    required String body,
  }) async {
    if (kIsWeb || _shownIds.contains(idKey)) return;
    _shownIds.add(idKey);
    if (!_initialized) {
      await init();
    }
    const details = NotificationDetails(
      android: AndroidNotificationDetails(
        'avm_tech_alerts',
        'Downtown Teknik Operasyon Bildirimleri',
        channelDescription: 'Yeni iş emri, acil arıza ve onay bildirimleri',
        importance: Importance.max,
        priority: Priority.high,
        playSound: true,
        enableVibration: true,
      ),
      iOS: DarwinNotificationDetails(
        presentAlert: true,
        presentBadge: true,
        presentSound: true,
      ),
    );
    await _plugin.show(idKey.hashCode & 0x7fffffff, title, body, details);
  }

  Future<void> startListening(String userId, {VoidCallback? onNewNotification}) async {
    if (!SupabaseConfig.isConfigured) return;
    if (_activeUserId == userId && _channel != null) return;

    await stopListening();
    await init();
    _activeUserId = userId;

    if (_firebaseReady) {
      try {
        await FirebaseMessaging.instance.subscribeToTopic('user_$userId');
        _fcmSub = FirebaseMessaging.onMessage.listen((msg) {
          final title = msg.notification?.title ?? 'Downtown Teknik Bildirimi';
          final body = msg.notification?.body ?? '';
          final idKey = msg.data['notification_id'] as String? ??
              msg.messageId ??
              DateTime.now().millisecondsSinceEpoch.toString();
          unawaited(showLocalNotification(idKey: idKey, title: title, body: body));
          onNewNotification?.call();
        });
      } catch (_) {}
    }

    final client = SupabaseConfig.client;
    _channel = client
        .channel('public:notifications:$userId')
        .onPostgresChanges(
          event: PostgresChangeEvent.insert,
          schema: 'public',
          table: 'notifications',
          filter: PostgresChangeFilter(
            type: PostgresChangeFilterType.eq,
            column: 'user_id',
            value: userId,
          ),
          callback: (payload) {
            final rec = payload.newRecord;
            final id = rec['id'] as String? ?? DateTime.now().millisecondsSinceEpoch.toString();
            final title = rec['title'] as String? ?? 'Downtown Teknik Bildirimi';
            final message = rec['message'] as String? ?? '';
            unawaited(showLocalNotification(idKey: id, title: title, body: message));
            onNewNotification?.call();
          },
        )
        .subscribe();
  }

  Future<void> syncUnread(String userId, {VoidCallback? onNewNotification}) async {
    if (!SupabaseConfig.isConfigured) return;
    try {
      final rows = await SupabaseConfig.client
          .from('notifications')
          .select('id, title, message')
          .eq('user_id', userId)
          .eq('is_read', false)
          .order('created_at', ascending: false)
          .limit(5);
      final list = List<Map<String, dynamic>>.from(rows as List);
      for (final r in list) {
        final id = r['id'] as String? ?? '';
        if (id.isNotEmpty && !_shownIds.contains(id)) {
          await showLocalNotification(
            idKey: id,
            title: r['title'] as String? ?? 'Downtown Teknik',
            body: r['message'] as String? ?? '',
          );
          onNewNotification?.call();
        }
      }
    } catch (_) {}
  }

  Future<void> stopListening() async {
    final prevUser = _activeUserId;
    _activeUserId = null;
    await _fcmSub?.cancel();
    _fcmSub = null;
    if (_firebaseReady && prevUser != null) {
      try {
        await FirebaseMessaging.instance.unsubscribeFromTopic('user_$prevUser');
      } catch (_) {}
    }
    if (_channel != null && SupabaseConfig.isConfigured) {
      await SupabaseConfig.client.removeChannel(_channel!);
      _channel = null;
    }
  }
}

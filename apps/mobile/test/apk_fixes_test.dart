import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/date_symbol_data_local.dart';

import 'package:avm_tech_platform/core/auth/auth_provider.dart';
import 'package:avm_tech_platform/core/database/pagination.dart';
import 'package:avm_tech_platform/core/modules/module_registry.dart';
import 'package:avm_tech_platform/core/notifications/notification_providers.dart';
import 'package:avm_tech_platform/core/permissions/permission_models.dart';
import 'package:avm_tech_platform/core/router/app_router.dart';
import 'package:avm_tech_platform/core/screens/profile_screen.dart';
import 'package:avm_tech_platform/core/theme/app_theme.dart';
import 'package:avm_tech_platform/core/widgets/modern_shell_widgets.dart';
import 'package:excel/excel.dart' as xls;
import 'package:avm_tech_platform/features/energy/data/models/budget_model.dart';
import 'package:avm_tech_platform/features/energy/data/models/invoice_model.dart';
import 'package:avm_tech_platform/features/energy/data/models/meter_model.dart';
import 'package:avm_tech_platform/features/energy/data/models/reading_model.dart';
import 'package:avm_tech_platform/features/energy/presentation/screens/energy_home_screen.dart';
import 'package:avm_tech_platform/features/energy/presentation/screens/meter_detail_screen.dart';
import 'package:avm_tech_platform/features/energy/presentation/screens/meter_list_screen.dart';
import 'package:avm_tech_platform/features/energy/presentation/screens/reading_entry_sheet.dart';
import 'package:avm_tech_platform/features/energy/presentation/widgets/energy_report_wizard_sheet.dart';
import 'package:avm_tech_platform/features/energy/providers/energy_providers.dart';
import 'package:avm_tech_platform/features/energy/services/energy_excel_service.dart';
import 'package:avm_tech_platform/features/energy/services/invoice_parser_service.dart';
import 'package:avm_tech_platform/core/equipment/equipment_providers.dart';
import 'package:avm_tech_platform/core/screens/login_screen.dart';
import 'package:avm_tech_platform/core/screens/register_screen.dart';
import 'package:avm_tech_platform/features/energy/presentation/screens/energy_invoices_screen.dart';
import 'package:avm_tech_platform/features/work_tracking/data/models/extra_models.dart';
import 'package:avm_tech_platform/features/work_tracking/data/models/ticket_model.dart';
import 'package:avm_tech_platform/features/work_tracking/presentation/screens/create_ticket_screen.dart';
import 'package:avm_tech_platform/features/work_tracking/presentation/screens/manager_work_orders_screen.dart';
import 'package:avm_tech_platform/features/work_tracking/presentation/screens/ticket_list_screen.dart';
import 'package:avm_tech_platform/features/work_tracking/presentation/screens/work_tracking_home_screen.dart';
import 'package:avm_tech_platform/features/work_tracking/providers/data_providers.dart';

void main() {
  final now = DateTime(2026, 11, 20, 14, 30);

  setUpAll(() async {
    await initializeDateFormatting('tr_TR', null);
  });

  ProfileModel buildProfile({
    required String role,
    String fullName = 'Test Kullanıcı',
    String? customRole,
    String approvalStatus = 'approved',
    Map<String, dynamic> permissions = const {},
  }) {
    return ProfileModel(
      id: 'u-1',
      fullName: fullName,
      role: role,
      customRole: customRole,
      approvalStatus: approvalStatus,
      permissions: permissions,
      createdAt: now,
    );
  }

  ProviderScope wrapWithAuth({
    required ProfileModel profile,
    required Widget child,
    List<Override> extraOverrides = const [],
  }) {
    return ProviderScope(
      key: UniqueKey(),
      overrides: [
        authProvider.overrideWith(
          (_) => AuthNotifier.withInitialState(
            AuthState(status: AuthStatus.authenticated, profile: profile),
          ),
        ),
        unreadCountProvider.overrideWith((_) async => 2),
        ...extraOverrides,
      ],
      child: child,
    );
  }

  group('Madde 1 - Teknik Personel Sayaç Excel Dışa Aktarma', () {
    test('canExportMeters teknisyen ve yetkili roller için true, normal personel ve pending için false döner', () {
      expect(EnergyExcelService.canExportMeters(null), isFalse);
      expect(
        EnergyExcelService.canExportMeters(buildProfile(role: 'technician')),
        isTrue,
      );
      expect(
        EnergyExcelService.canExportMeters(buildProfile(role: 'team_lead')),
        isTrue,
      );
      expect(
        EnergyExcelService.canExportMeters(buildProfile(role: 'technical_manager')),
        isTrue,
      );
      expect(
        EnergyExcelService.canExportMeters(buildProfile(role: 'system_admin')),
        isTrue,
      );
      expect(
        EnergyExcelService.canExportMeters(buildProfile(role: 'employee')),
        isFalse,
      );
      expect(
        EnergyExcelService.canExportMeters(
          buildProfile(role: 'technician', approvalStatus: 'pending'),
        ),
        isFalse,
      );
      expect(
        EnergyExcelService.canExportMeters(
          buildProfile(
            role: 'employee',
            permissions: {
              'modules': {
                'energy': {'enabled': true, 'view': true},
              },
            },
          ),
        ),
        isTrue,
      );
    });

    testWidgets('MeterListScreen teknik personel için Excel İndir butonunu gösterir, Sayaç Ekle gizler', (tester) async {
      final tech = buildProfile(role: 'technician', fullName: 'Ahmet Teknik');
      const meters = [
        MeterModel(
          id: 'm-1',
          name: 'Ana Pano 1',
          meterType: 'electric',
          category: 'electric',
          multiplier: 10,
        ),
      ];

      await tester.pumpWidget(
        wrapWithAuth(
          profile: tech,
          extraOverrides: [
            metersProvider('electric').overrideWith((_) async => meters),
          ],
          child: MaterialApp(
            theme: AppTheme.lightTheme,
            home: const MeterListScreen(meterType: 'electric'),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.byTooltip('Excel İndir'), findsOneWidget);
      expect(find.byTooltip('Okuma Gir'), findsOneWidget);
      expect(find.byTooltip('Sayaç Ekle'), findsNothing);
    });

    testWidgets('MeterDetailScreen teknik personel için Excel İndir butonunu gösterir, Sil butonunu gizler', (tester) async {
      final tech = buildProfile(role: 'technician', fullName: 'Ahmet Teknik');
      const meter = MeterModel(
        id: 'm-1',
        name: 'Ana Pano 1',
        meterType: 'electric',
        category: 'electric',
        multiplier: 10,
      );
      final readings = [
        MeterReadingModel(
          id: 'r-1',
          meterId: 'm-1',
          readingDate: now,
          activeValue: 1200,
          inductiveValue: 100,
          capacitiveValue: 40,
          inductivePercent: 8.0,
          capacitivePercent: 3.0,
          consumption: 250,
          enteredByName: 'Ahmet Teknik',
        ),
      ];

      await tester.pumpWidget(
        wrapWithAuth(
          profile: tech,
          extraOverrides: [
            meterDetailProvider('m-1').overrideWith((_) async => meter),
            meterReadingsProvider('m-1').overrideWith((_) async => readings),
          ],
          child: MaterialApp(
            theme: AppTheme.lightTheme,
            home: const MeterDetailScreen(meterId: 'm-1'),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.byTooltip('Excel İndir'), findsOneWidget);
      expect(find.byIcon(Icons.delete_outline), findsNothing);
    });
  });

  group('Madde 2 - Ekrana Sığma, Buton Genişliği ve Taşma Kontrolü', () {
    testWidgets('AppTheme buton stilleri Row ve AlertDialog içinde yatay taşma üretmez', (tester) async {
      tester.view.physicalSize = const Size(320, 568);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      await tester.pumpWidget(
        MaterialApp(
          theme: AppTheme.lightTheme,
          home: Scaffold(
            body: Padding(
              padding: const EdgeInsets.all(12),
              child: Column(
                children: [
                  Row(
                    children: [
                      const Expanded(
                        child: TextField(
                          decoration: InputDecoration(labelText: 'Yeni Şifre'),
                        ),
                      ),
                      const SizedBox(width: 8),
                      OutlinedButton(
                        onPressed: () {},
                        child: const Text('123456'),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  AlertDialog(
                    title: const Text('Onay'),
                    content: const Text('İşlem yapılsın mı?'),
                    actions: [
                      TextButton(onPressed: () {}, child: const Text('İptal')),
                      ElevatedButton(onPressed: () {}, child: const Text('Tamam')),
                      FilledButton(onPressed: () {}, child: const Text('Kaydet')),
                    ],
                  ),
                ],
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(tester.takeException(), isNull);
    });

    testWidgets('360x640 standart telefonda EnergyHomeScreen tüm kartlarıyla taşmasız render edilir', (tester) async {
      tester.view.physicalSize = const Size(360, 640);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      final admin = buildProfile(
        role: 'system_admin',
        fullName: 'Talip Daştan',
        customRole: 'Sistem Yöneticisi',
      );
      final currentNow = DateTime.now();
      final period = (year: currentNow.year, month: currentNow.month);
      final dashboardItems = [
        EnergyDashboardItem(
          meterId: 'e-1',
          meterName: 'Trafo 1',
          meterType: 'electric',
          category: 'electric',
          multiplier: 100,
          sortOrder: 0,
          latestReadingDate: now,
          latestConsumption: 45200,
          latestInductivePercent: 10.0,
          latestCapacitivePercent: 4.0,
          monthlyTotalConsumption: 45200,
        ),
        const EnergyDashboardItem(
          meterId: 'w-1',
          meterName: 'Şebeke Suyu',
          meterType: 'mechanical',
          category: 'water',
          multiplier: 1,
          sortOrder: 1,
          monthlyTotalConsumption: 1450,
        ),
        const EnergyDashboardItem(
          meterId: 'c-1',
          meterName: 'Soğutma Kule',
          meterType: 'mechanical',
          category: 'cooling',
          multiplier: 1,
          sortOrder: 2,
          monthlyTotalConsumption: 620,
        ),
        const EnergyDashboardItem(
          meterId: 'g-1',
          meterName: 'Kazan Doğalgaz',
          meterType: 'mechanical',
          category: 'gas',
          multiplier: 1,
          sortOrder: 3,
          monthlyTotalConsumption: 8300,
        ),
      ];

      await tester.pumpWidget(
        wrapWithAuth(
          profile: admin,
          extraOverrides: [
            energyDashboardProvider(period).overrideWith((_) async => dashboardItems),
          ],
          child: MaterialApp(
            theme: AppTheme.lightTheme,
            builder: (context, child) {
              final mq = MediaQuery.of(context);
              return MediaQuery(
                data: mq.copyWith(textScaler: const TextScaler.linear(1.05)),
                child: child!,
              );
            },
            home: const EnergyHomeScreen(),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(tester.takeException(), isNull);
      expect(find.text('Elektrik Sayaçları'), findsOneWidget);
      expect(find.text('Bütçe & Sapma'), findsOneWidget);
      // Tüm kartlar aşağı kaydırmadan aynı ekranda görünür sınırlar içinde kalmalı
      final budgetBottom = tester.getBottomRight(find.text('Bütçe & Sapma')).dy;
      expect(budgetBottom, lessThan(640));
    });

    testWidgets('320x568 çok dar ekranda ModernUserTopBar ve FloatingPillBottomBar taşma yapmaz', (tester) async {
      tester.view.physicalSize = const Size(320, 568);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      final admin = buildProfile(
        role: 'system_admin',
        fullName: 'Muhammed Mustafa Yıldırımoğlu',
        customRole: 'Operasyon ve Teknik İşler Müdürü',
      );

      await tester.pumpWidget(
        wrapWithAuth(
          profile: admin,
          child: MaterialApp(
            theme: AppTheme.lightTheme,
            home: Scaffold(
              appBar: const ModernUserTopBar(statusPill: '12 Onay Bekliyor'),
              body: const Center(child: Text('İçerik')),
              bottomNavigationBar: FloatingPillBottomBar(
                activeKey: 'energy',
                quickActionLabel: 'OKUMA',
                onQuickAction: () {},
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(tester.takeException(), isNull);
      expect(find.text('MUHAMMED MUSTAFA YILDIRIMOĞLU'), findsOneWidget);
      expect(find.text('Modüller'), findsOneWidget);
      expect(find.text('Personel'), findsOneWidget);
      expect(find.text('OKUMA'), findsOneWidget);
    });
  });

  group('Madde 3 - Telefon Geri Tuşu Davranışı (AppBackScope)', () {
    testWidgets('Modül ve alt sayfalarda geri tuşu sırayla ana ekrana döner; ana ekranda 2 kez basılmadan çıkmaz', (tester) async {
      var fakeNow = DateTime(2026, 11, 20, 20, 0, 0);
      var exitCount = 0;

      final router = GoRouter(
        initialLocation: '/home',
        routes: [
          GoRoute(
            path: '/home',
            builder: (context, state) => AppBackScope(
              isHome: true,
              clock: () => fakeNow,
              onExit: () => exitCount++,
              child: const Scaffold(body: Center(child: Text('Ana Sayfa'))),
            ),
          ),
          GoRoute(
            path: '/energy',
            builder: (context, state) => const AppBackScope(
              child: Scaffold(body: Center(child: Text('Enerji Ekranı'))),
            ),
            routes: [
              GoRoute(
                path: 'electric',
                builder: (context, state) =>
                    const Scaffold(body: Center(child: Text('Elektrik Listesi'))),
              ),
            ],
          ),
        ],
      );

      await tester.pumpWidget(
        MaterialApp.router(
          theme: AppTheme.lightTheme,
          routerConfig: router,
        ),
      );
      await tester.pumpAndSettle();

      // Modüle context.go ile geç (stack uzunluğu 1 olur) ve alt sayfayı push et
      router.go('/energy');
      await tester.pumpAndSettle();
      expect(find.text('Enerji Ekranı'), findsOneWidget);

      router.push('/energy/electric');
      await tester.pumpAndSettle();
      expect(find.text('Elektrik Listesi'), findsOneWidget);

      // 1. geri: alt sayfadan Enerji Ekranı'na döner
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(find.text('Enerji Ekranı'), findsOneWidget);
      expect(exitCount, 0);

      // 2. geri: Enerji Ekranı'ndan çıkmaz, Ana Sayfa'ya (/home) döner
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(find.text('Ana Sayfa'), findsOneWidget);
      expect(exitCount, 0);

      // 3. geri (/home üzerinde ilk basış): çıkmaz, uyarı SnackBar gösterir
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(exitCount, 0);
      expect(
        find.text('Uygulamadan çıkmak için geri tuşuna tekrar basın'),
        findsOneWidget,
      );

      // 3 saniye sonra basılırsa süre dolduğu için yine çıkmaz
      fakeNow = fakeNow.add(const Duration(seconds: 3));
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(exitCount, 0);

      // 1 saniye içinde tekrar basılırsa uygulamadan çıkış çağrılır
      fakeNow = fakeNow.add(const Duration(seconds: 1));
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(exitCount, 1);
    });
  });

  group('Madde 4 - Açık Tema Chip ve Buton Kontrastı', () {
    test('AppTheme chipTheme seçili/seçili değil/pasif durumlarda yüksek kontrastlı metin ve beyaz onay ikonu üretir', () {
      final theme = AppTheme.lightTheme;
      expect(theme.brightness, Brightness.light);
      expect(theme.colorScheme.brightness, Brightness.light);
      expect(theme.chipTheme.checkmarkColor, Colors.white);

      final labelColor = theme.chipTheme.labelStyle?.color;
      expect(labelColor, isA<WidgetStateColor>());
      final resolved = labelColor! as WidgetStateColor;

      expect(resolved.resolve(const <WidgetState>{}), AppColors.textPrimary);
      expect(resolved.resolve(const {WidgetState.selected}), Colors.white);
      expect(
        resolved.resolve(const {WidgetState.disabled}),
        AppColors.textSecondary,
      );
    });

    testWidgets('FilterChip, ChoiceChip ve SegmentedButton tema üzerinden okunabilir metin rengiyle çizilir', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          theme: AppTheme.lightTheme,
          themeMode: ThemeMode.light,
          home: Scaffold(
            body: Column(
              children: [
                FilterChip(
                  label: const Text('Seçili Yetki'),
                  selected: true,
                  onSelected: (_) {},
                ),
                FilterChip(
                  label: const Text('Açık Yetki'),
                  selected: false,
                  onSelected: (_) {},
                ),
                const FilterChip(
                  label: Text('Pasif Yetki'),
                  selected: false,
                  onSelected: null,
                ),
                ChoiceChip(
                  label: const Text('Normal'),
                  selected: true,
                  onSelected: (_) {},
                ),
                ChoiceChip(
                  label: const Text('Acil'),
                  selected: false,
                  onSelected: (_) {},
                ),
                SegmentedButton<bool>(
                  segments: const [
                    ButtonSegment(value: true, label: Text('Aktif')),
                    ButtonSegment(value: false, label: Text('Tamamlanan')),
                  ],
                  selected: const {true},
                  onSelectionChanged: (_) {},
                ),
              ],
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      Color? colorFor(String label) =>
          DefaultTextStyle.of(tester.element(find.text(label))).style.color;

      expect(colorFor('Seçili Yetki'), Colors.white);
      expect(colorFor('Açık Yetki'), AppColors.textPrimary);
      expect(colorFor('Pasif Yetki'), AppColors.textSecondary);
      expect(colorFor('Normal'), Colors.white);
      expect(colorFor('Acil'), AppColors.textPrimary);
      expect(colorFor('Aktif'), Colors.white);
      expect(colorFor('Tamamlanan'), AppColors.textPrimary);
    });
  });

  group('Madde 5 - Admin Sayaç Çöp Kutusu', () {
    test('TrashedMeterItem.fromJson kalan saklama gününü ve okuma sayısını doğru hesaplar', () {
      final deleted = DateTime.now().toUtc().subtract(const Duration(days: 5));
      final purge = deleted.add(const Duration(days: 30));
      final item = TrashedMeterItem.fromJson({
        'id': 'm-kule',
        'name': 'Kule Sayaç',
        'meter_type': 'mechanical',
        'category': 'cooling',
        'multiplier': 1,
        'deleted_at': deleted.toIso8601String(),
        'deleted_by_name': 'Talip Daştan',
        'readings_count': 141,
        'purge_at': purge.toIso8601String(),
      });

      expect(item.name, 'Kule Sayaç');
      expect(item.readingsCount, 141);
      expect(item.deletedByName, 'Talip Daştan');
      expect(item.daysRemaining, inInclusiveRange(24, 26));

      final expired = TrashedMeterItem.fromJson({
        'id': 'm-old',
        'name': 'Eski Sayaç',
        'meter_type': 'mechanical',
        'category': 'water',
        'deleted_at': DateTime.now()
            .toUtc()
            .subtract(const Duration(days: 31))
            .toIso8601String(),
        'purge_at': DateTime.now()
            .toUtc()
            .subtract(const Duration(days: 1))
            .toIso8601String(),
      });
      expect(expired.daysRemaining, 0);
    });

    testWidgets('MeterListScreen Çöp Kutusu butonlarını yalnızca system_admin için gösterir', (tester) async {
      const meters = [
        MeterModel(
          id: 'm-1',
          name: 'Kule Sayaç',
          meterType: 'mechanical',
          category: 'water',
          multiplier: 1,
        ),
      ];

      final admin = buildProfile(role: 'system_admin', fullName: 'Sistem Admin');
      await tester.pumpWidget(
        wrapWithAuth(
          profile: admin,
          extraOverrides: [
            metersProvider('mechanical').overrideWith((_) async => meters),
          ],
          child: MaterialApp(
            theme: AppTheme.lightTheme,
            home: const MeterListScreen(meterType: 'mechanical'),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.byTooltip('Çöp Kutusu'), findsOneWidget);
      expect(find.byTooltip('Çöp Kutusuna Taşı'), findsOneWidget);

      final techManager =
          buildProfile(role: 'technical_manager', fullName: 'Teknik Yönetici');
      await tester.pumpWidget(
        wrapWithAuth(
          profile: techManager,
          extraOverrides: [
            metersProvider('mechanical').overrideWith((_) async => meters),
          ],
          child: MaterialApp(
            theme: AppTheme.lightTheme,
            home: const MeterListScreen(meterType: 'mechanical'),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.byTooltip('Çöp Kutusu'), findsNothing);
      expect(find.byTooltip('Çöp Kutusuna Taşı'), findsNothing);

      final tech = buildProfile(role: 'technician', fullName: 'Ahmet Teknik');
      await tester.pumpWidget(
        wrapWithAuth(
          profile: tech,
          extraOverrides: [
            metersProvider('mechanical').overrideWith((_) async => meters),
          ],
          child: MaterialApp(
            theme: AppTheme.lightTheme,
            home: const MeterListScreen(meterType: 'mechanical'),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.byTooltip('Çöp Kutusu'), findsNothing);
      expect(find.byTooltip('Çöp Kutusuna Taşı'), findsNothing);
    });
  });

  group('Madde 6 - Kullanıcı Profili & Hesap Güncelleme', () {
    test('resolvePlatformRedirect oturum açmış kullanıcı için /profile rotasına izin verir', () {
      final registry = ModuleRegistry();
      final emp = buildProfile(role: 'employee');

      expect(
        resolvePlatformRedirect(
          status: AuthStatus.authenticated,
          location: '/profile',
          registry: registry,
          profile: emp,
        ),
        isNull,
      );
      expect(
        resolvePlatformRedirect(
          status: AuthStatus.unauthenticated,
          location: '/profile',
          registry: registry,
          profile: null,
        ),
        '/login',
      );
    });

    test('ProfileFormValidator ad, e-posta ve şifre yenileme kurallarını doğrular', () {
      expect(ProfileFormValidator.validateName('   '), isNotNull);
      expect(ProfileFormValidator.validateName('Ahmet Yılmaz'), isNull);

      expect(ProfileFormValidator.validateEmail('gecersiz-mail'), isNotNull);
      expect(ProfileFormValidator.validateEmail('user@avm'), isNotNull);
      expect(ProfileFormValidator.validateEmail('user@avmtech.com'), isNull);

      expect(
        ProfileFormValidator.validatePasswordChange(
          currentPassword: '',
          newPassword: 'yeni123',
          confirmPassword: 'yeni123',
        ),
        isNotNull,
      );
      expect(
        ProfileFormValidator.validatePasswordChange(
          currentPassword: 'eski123',
          newPassword: '123',
          confirmPassword: '123',
        ),
        isNotNull,
      );
      expect(
        ProfileFormValidator.validatePasswordChange(
          currentPassword: 'eski123',
          newPassword: 'yeni123',
          confirmPassword: 'farkli123',
        ),
        isNotNull,
      );
      expect(
        ProfileFormValidator.validatePasswordChange(
          currentPassword: 'eski123',
          newPassword: 'yeni123',
          confirmPassword: 'yeni123',
        ),
        isNull,
      );

      final orig = OwnAccountInfo(
        id: 'u-1',
        fullName: 'Mehmet Yılmaz',
        phone: '05551234567',
        email: 'mehmet@avmtech.com',
        role: 'technician',
        approvalStatus: 'approved',
        createdAt: now,
      );
      expect(
        ProfileFormValidator.hasPersonalInfoChanged(
          original: orig,
          newName: 'Mehmet Yılmaz',
          newPhone: '05551234567',
          newEmail: 'mehmet@avmtech.com',
        ),
        isFalse,
      );
      expect(
        ProfileFormValidator.hasPersonalInfoChanged(
          original: orig,
          newName: 'Mehmet Yılmaz Yeni',
          newPhone: '05551234567',
          newEmail: 'mehmet@avmtech.com',
        ),
        isTrue,
      );
      expect(ProfileFormValidator.validateName('AB'), isNotNull);
    });

    testWidgets('360x640 telefonda ProfileScreen tüm bilgi ve şifre yenileme alanlarıyla taşmasız render edilir', (tester) async {
      tester.view.physicalSize = const Size(360, 640);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      final tech = buildProfile(
        role: 'technician',
        fullName: 'Mehmet Yılmaz',
        customRole: 'Elektrik Teknisyeni',
      );
      final account = OwnAccountInfo(
        id: 'u-1',
        fullName: 'Mehmet Yılmaz',
        phone: '05551234567',
        email: 'mehmet@avmtech.com',
        role: 'technician',
        customRole: 'Elektrik Teknisyeni',
        departmentName: 'Elektrik',
        approvalStatus: 'approved',
        createdAt: now,
      );

      await tester.pumpWidget(
        wrapWithAuth(
          profile: tech,
          extraOverrides: [
            ownAccountProvider.overrideWith((_) async => account),
          ],
          child: MaterialApp(
            theme: AppTheme.lightTheme,
            home: const ProfileScreen(),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(tester.takeException(), isNull);
      expect(find.text('Profil & Hesap Bilgilerim'), findsOneWidget);
      expect(find.text('Ad Soyad *'), findsOneWidget);
      expect(find.text('Telefon Numarası'), findsOneWidget);
      expect(find.text('E-Posta Adresi'), findsOneWidget);
      expect(find.text('Bilgileri Güncelle'), findsOneWidget);
      expect(find.text('Şifre Yenile'), findsOneWidget);
      expect(find.text('Mevcut Şifre'), findsOneWidget);
      expect(find.text('Yeni Şifre (En az 6 karakter)'), findsOneWidget);
      expect(find.text('Yeni Şifre (Tekrar)'), findsOneWidget);
      expect(find.text('Şifreyi Yenile'), findsOneWidget);
    });

    testWidgets('ModernUserTopBar kullanıcı adına tıklandığında /profile ekranını açar', (tester) async {
      final emp = buildProfile(role: 'employee', fullName: 'Ayşe Kaya');
      final router = GoRouter(
        initialLocation: '/home',
        routes: [
          GoRoute(
            path: '/home',
            builder: (context, state) => const Scaffold(
              appBar: ModernUserTopBar(statusPill: 'DOWNTOWN TEKNİK'),
              body: Center(child: Text('Ana Ekran')),
            ),
          ),
          GoRoute(
            path: '/profile',
            builder: (context, state) =>
                const Scaffold(body: Center(child: Text('Profil Ekranı Açıldı'))),
          ),
        ],
      );

      await tester.pumpWidget(
        wrapWithAuth(
          profile: emp,
          child: MaterialApp.router(
            theme: AppTheme.lightTheme,
            routerConfig: router,
          ),
        ),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.text('AYŞE KAYA'));
      await tester.pumpAndSettle();

      expect(find.text('Profil Ekranı Açıldı'), findsOneWidget);
    });
  });

  group('Madde 7 - Mekanik Sayaçlarda Yalnızca Endeks Mantığı', () {
    test('EnergyDashboardItem mekanik sayaçta reaktif yüzdeler gelse bile ceza bayrağı false döner', () {
      final mech = EnergyDashboardItem.fromJson({
        'meter_id': 'm-gas-1',
        'meter_name': 'Kazan Doğalgaz',
        'meter_type': 'mechanical',
        'category': 'gas',
        'multiplier': 1,
        'sort_order': 0,
        'latest_inductive_percent': 45.0,
        'latest_capacitive_percent': 30.0,
        'monthly_total_consumption': 378.0,
      });
      final elec = EnergyDashboardItem.fromJson({
        'meter_id': 'm-elec-1',
        'meter_name': 'GT.ADP.1',
        'meter_type': 'electric',
        'category': 'electric',
        'multiplier': 100,
        'sort_order': 0,
        'latest_inductive_percent': 25.0,
        'latest_capacitive_percent': 10.0,
        'monthly_total_consumption': 1500.0,
      });

      expect(mech.hasInductivePenalty, isFalse);
      expect(mech.hasCapacitivePenalty, isFalse);
      expect(elec.hasInductivePenalty, isTrue);
      expect(elec.hasCapacitivePenalty, isFalse);
    });

    testWidgets('MeterDetailScreen mekanik sayaçta yalnızca Endeks gösterir ve Aktif/İndüktif/Kapasitif göstermez', (tester) async {
      final tech = buildProfile(role: 'technician');
      const gasMeter = MeterModel(
        id: 'm-gas-1',
        name: 'Kazan Doğalgaz',
        meterType: 'mechanical',
        category: 'gas',
        multiplier: 1.0,
      );
      final reading = MeterReadingModel(
        id: 'r-1',
        meterId: 'm-gas-1',
        readingDate: now,
        inductivePercent: 50.0,
        capacitivePercent: 40.0,
        indexValue: 378.122,
        consumption: 37.0,
        enteredByName: 'erol',
      );

      await tester.pumpWidget(
        wrapWithAuth(
          profile: tech,
          extraOverrides: [
            meterDetailProvider('m-gas-1').overrideWith((_) async => gasMeter),
            meterReadingsProvider('m-gas-1').overrideWith((_) async => [reading]),
          ],
          child: MaterialApp(
            theme: AppTheme.lightTheme,
            home: const MeterDetailScreen(meterId: 'm-gas-1'),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.textContaining('Endeks: 378.122'), findsOneWidget);
      expect(find.text('37.0 m³'), findsOneWidget);
      expect(find.textContaining('Aktif:'), findsNothing);
      expect(find.textContaining('İnd:'), findsNothing);
      expect(find.textContaining('Kap:'), findsNothing);

      final chipText = tester.widget<Text>(find.text('37.0 m³'));
      expect(chipText.style?.color, AppColors.primaryNavy);
    });

    testWidgets('showReadingEntrySheet mekanik sayaç için yalnızca Güncel Endeks (m³) alanını gösterir', (tester) async {
      final tech = buildProfile(role: 'technician');
      const gasMeter = MeterModel(
        id: 'm-gas-1',
        name: 'Kazan Doğalgaz',
        meterType: 'mechanical',
        category: 'gas',
        multiplier: 1.0,
      );

      await tester.pumpWidget(
        wrapWithAuth(
          profile: tech,
          child: MaterialApp(
            theme: AppTheme.lightTheme,
            home: Scaffold(
              body: Consumer(
                builder: (ctx, ref, _) => Center(
                  child: FilledButton(
                    onPressed: () =>
                        showReadingEntrySheet(ctx, ref, meter: gasMeter),
                    child: const Text('Okuma Aç'),
                  ),
                ),
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.text('Okuma Aç'));
      await tester.pumpAndSettle();

      expect(find.text('Güncel Endeks (m³)'), findsOneWidget);
      expect(find.text('AKTİF (1.8.0)'), findsNothing);
      expect(find.text('İNDÜKTİF (5.8.0)'), findsNothing);
      expect(find.text('KAPASİTİF (8.8.0)'), findsNothing);
    });

    test('InvoiceParserService.buildDraftsFromItems su ve doğalgaz faturalarında reaktif cezayı sıfırlar, elektrikte korur', () {
      final drafts = InvoiceParserService.buildDraftsFromItems(
        onlyRegisteredMeters: false,
        existingMeters: const [],
        items: [
          {
            'provider': 'İGDAŞ',
            'utilityType': 'gas',
            'consumption': 500,
            'amountTL': 4200,
            'inductivePenaltyTL': 150,
            'capacitivePenaltyTL': 80,
            'year': 2026,
            'month': 11,
          },
          {
            'provider': 'İSKİ',
            'utilityType': 'water',
            'consumption': 200,
            'amountTL': 1800,
            'inductivePenaltyTL': 90,
            'capacitivePenaltyTL': 0,
            'year': 2026,
            'month': 11,
          },
          {
            'provider': 'CK Boğaziçi',
            'utilityType': 'electric',
            'consumption': 3000,
            'amountTL': 15000,
            'inductivePenaltyTL': 220,
            'capacitivePenaltyTL': 45,
            'year': 2026,
            'month': 11,
          },
        ],
      );

      expect(drafts.length, 3);
      expect(drafts[0].inductivePenaltyTL, 0.0);
      expect(drafts[0].capacitivePenaltyTL, 0.0);
      expect(drafts[1].inductivePenaltyTL, 0.0);
      expect(drafts[1].capacitivePenaltyTL, 0.0);
      expect(drafts[2].inductivePenaltyTL, 220.0);
      expect(drafts[2].capacitivePenaltyTL, 45.0);
    });
  });

  group('Madde 8 - Fatura & Bütçe Akıllı Rapor Sihirbazı ve Çok Sekmeli Excel', () {
    final sampleInvoices = [
      EnergyInvoiceModel(
        id: 'inv-e1',
        periodYear: 2026,
        periodMonth: 1,
        utilityType: 'electric',
        provider: 'CK Boğaziçi',
        invoiceNo: 'EL-2026-01',
        meterName: 'GT.ADP.1',
        consumption: 10000,
        amountTL: 45000,
        inductivePenaltyTL: 1200,
        capacitivePenaltyTL: 0,
        tenantAmountTL: 5000,
        enteredByName: 'talip',
        createdAt: now,
      ),
      EnergyInvoiceModel(
        id: 'inv-g1',
        periodYear: 2026,
        periodMonth: 2,
        utilityType: 'gas',
        provider: 'İGDAŞ',
        invoiceNo: 'GZ-2026-02',
        meterName: 'Kazan Doğalgaz',
        consumption: 2500,
        amountTL: 30000,
        tenantAmountTL: 0,
        enteredByName: 'talip',
        createdAt: now,
      ),
      EnergyInvoiceModel(
        id: 'inv-w1',
        periodYear: 2026,
        periodMonth: 5,
        utilityType: 'water',
        provider: 'İSKİ',
        invoiceNo: 'SU-2026-05',
        meterName: 'Ana Su Sayacı',
        consumption: 800,
        amountTL: 24000,
        tenantAmountTL: 4000,
        enteredByName: 'talip',
        createdAt: now,
      ),
    ];

    const sampleBudgets = [
      EnergyBudgetModel(
        id: 'b-1',
        periodYear: 2026,
        periodMonth: 1,
        utilityType: 'electric',
        budgetConsumption: 9500,
        budgetTL: 38000,
        prevYearConsumption: 9000,
        prevYearTL: 32000,
      ),
      EnergyBudgetModel(
        id: 'b-2',
        periodYear: 2026,
        periodMonth: 2,
        utilityType: 'gas',
        budgetConsumption: 2800,
        budgetTL: 35000,
        prevYearConsumption: 2600,
        prevYearTL: 29000,
      ),
    ];

    test('EnergyReportExportConfig çeyrek dönem, özel ay aralığı ve tür filtrelerini doğru uygular', () {
      final q1Cfg = EnergyReportExportConfig.defaults(year: 2026).copyWith(
        periodMode: 'q1',
      );
      expect(q1Cfg.activeMonths, [1, 2, 3]);
      final q1Invs = q1Cfg.filterInvoices(sampleInvoices);
      expect(q1Invs.length, 2); // Ocak elektrik + Şubat gaz

      final penCfg = EnergyReportExportConfig.defaults(year: 2026).copyWith(
        invoiceKind: 'penalized_only',
      );
      final penInvs = penCfg.filterInvoices(sampleInvoices);
      expect(penInvs.length, 1);
      expect(penInvs.first.id, 'inv-e1');
    });

    test('buildCustomizedInvoicesBudgetExcelBytes çok sekmeli kurumsal Excel çalışma kitabı üretir', () {
      final cfg = EnergyReportExportConfig.defaults(
        year: 2026,
        preset: 'executive',
      );
      final bytes = EnergyExcelService.buildCustomizedInvoicesBudgetExcelBytes(
        allInvoices: sampleInvoices,
        allBudgets: sampleBudgets,
        config: cfg,
      );
      expect(bytes, isNotEmpty);

      final decoded = xls.Excel.decodeBytes(bytes);
      expect(decoded.tables.keys, contains('Yonetici Ozeti'));
      expect(decoded.tables.keys, contains('Elektrik Faturalari'));
      expect(decoded.tables.keys, contains('Dogalgaz ve Su'));
      expect(decoded.tables.keys, contains('Butce Karsilastirma'));
      expect(decoded.tables.keys, contains('Aylik Matris 2026'));
      expect(decoded.tables.keys, contains('Sayac Pano Kirilimi'));
    });

    testWidgets('showEnergyReportWizardSheet açılır ve tarih/veri seçimleriyle taşmasız render edilir', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          theme: AppTheme.lightTheme,
          home: Scaffold(
            body: Builder(
              builder: (ctx) => Center(
                child: FilledButton(
                  onPressed: () => showEnergyReportWizardSheet(
                    ctx,
                    initialYear: 2026,
                    invoices: sampleInvoices,
                    budgets: sampleBudgets,
                  ),
                  child: const Text('Sihirbazı Aç'),
                ),
              ),
            ),
          ),
        ),
      );

      await tester.tap(find.text('Sihirbazı Aç'));
      await tester.pumpAndSettle();

      expect(tester.takeException(), isNull);
      expect(find.text('Fatura & Bütçe Raporu Özelleştirme'), findsOneWidget);
      expect(find.text('12 Aylık Yatay Matris'), findsOneWidget);
      expect(find.text('1. Çeyrek (Oca–Mar)'), findsOneWidget);
      expect(find.text('Özelleştirilmiş Excel Raporu İndir'), findsOneWidget);
    });

    testWidgets('320x568 küçük ekranda CreateTicketScreen, LoginScreen, RegisterScreen, ManagerWorkOrdersScreen ve EnergyInvoicesScreen taşmasız render edilir', (tester) async {
      tester.view.physicalSize = const Size(320, 568);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      final admin = buildProfile(
        role: 'system_admin',
        fullName: 'Talip Daştan',
        customRole: 'Sistem Yöneticisi',
      );

      // 1) CreateTicketScreen (sabit alt gönder butonu taşmadan görünür)
      await tester.pumpWidget(
        wrapWithAuth(
          profile: admin,
          extraOverrides: [
            floorsProvider.overrideWith((_) async => const [LookupItem(id: 'f-1', name: 'Zemin Kat')]),
            categoriesProvider.overrideWith((_) async => const [LookupItem(id: 'c-1', name: 'İklimlendirme')]),
            equipmentOptionsProvider.overrideWith((_) async => const []),
            ticketsProvider.overrideWith((_) async => const <TicketModel>[]),
          ],
          child: MaterialApp(
            theme: AppTheme.lightTheme,
            home: const CreateTicketScreen(),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      expect(find.text('Arıza Kaydı Oluştur'), findsOneWidget);
      final submitBottom = tester.getBottomRight(find.text('Arıza Kaydı Oluştur')).dy;
      expect(submitBottom, lessThanOrEqualTo(568));

      // 2) LoginScreen & RegisterScreen
      await tester.pumpWidget(
        wrapWithAuth(
          profile: admin,
          child: MaterialApp(
            theme: AppTheme.lightTheme,
            home: const LoginScreen(),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      expect(find.text('Giriş Yap'), findsOneWidget);

      await tester.pumpWidget(
        wrapWithAuth(
          profile: admin,
          child: MaterialApp(
            theme: AppTheme.lightTheme,
            home: const RegisterScreen(),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      expect(find.text('Kayıt Oluştur'), findsOneWidget);

      // 3) HomeScreen (İş Takip Ana Ekranı) & ManagerWorkOrdersScreen & TicketListScreen
      await tester.pumpWidget(
        wrapWithAuth(
          profile: admin,
          extraOverrides: [
            ticketsProvider.overrideWith((_) async => const <TicketModel>[]),
            myWorkOrdersProvider.overrideWith((_) async => const <WorkOrderView>[]),
            pendingAssignmentTicketsProvider.overrideWith((_) async => const <TicketModel>[]),
            pendingReviewTicketsProvider.overrideWith((_) async => const <TicketModel>[]),
            activeManagerWorkOrdersProvider.overrideWith((_) async => const <WorkOrderView>[]),
          ],
          child: MaterialApp(
            theme: AppTheme.lightTheme,
            home: const HomeScreen(),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);

      await tester.pumpWidget(
        wrapWithAuth(
          profile: admin,
          extraOverrides: [
            pendingAssignmentTicketsProvider.overrideWith((_) async => const <TicketModel>[]),
            pendingReviewTicketsProvider.overrideWith((_) async => const <TicketModel>[]),
            activeManagerWorkOrdersProvider.overrideWith((_) async => const <WorkOrderView>[]),
          ],
          child: MaterialApp(
            theme: AppTheme.lightTheme,
            home: const ManagerWorkOrdersScreen(),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);

      await tester.pumpWidget(
        wrapWithAuth(
          profile: admin,
          extraOverrides: [
            ticketsProvider.overrideWith((_) async => const <TicketModel>[]),
            paginatedTicketsProvider(
              const TicketPageFilter(limit: 30, offset: 0),
            ).overrideWith(
              (_) async => const PaginatedResult<TicketModel>(
                items: <TicketModel>[],
                totalCount: 0,
                limit: 30,
                offset: 0,
              ),
            ),
          ],
          child: MaterialApp(
            theme: AppTheme.lightTheme,
            home: const TicketListScreen(),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);

      // 4) EnergyInvoicesScreen
      await tester.pumpWidget(
        wrapWithAuth(
          profile: admin,
          extraOverrides: [
            metersProvider(null).overrideWith((_) async => const <MeterModel>[]),
            energyInvoicesProvider(DateTime.now().year).overrideWith((_) async => sampleInvoices),
            energyBudgetsProvider(DateTime.now().year).overrideWith((_) async => sampleBudgets),
          ],
          child: MaterialApp(
            theme: AppTheme.lightTheme,
            home: const EnergyInvoicesScreen(),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      expect(find.text('Rapor Sihirbazı'), findsOneWidget);
      expect(find.text('Hızlı Excel'), findsOneWidget);
    });
  });
}

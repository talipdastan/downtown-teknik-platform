import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

import 'package:avm_tech_platform/core/auth/auth_provider.dart';
import 'package:avm_tech_platform/core/database/offline_sync_engine.dart';
import 'package:avm_tech_platform/core/database/offline_sync_models.dart';
import 'package:avm_tech_platform/core/database/pagination.dart';
import 'package:avm_tech_platform/core/modules/app_module.dart';
import 'package:avm_tech_platform/core/modules/module_registry.dart';
import 'package:avm_tech_platform/core/permissions/permission_models.dart';
import 'package:avm_tech_platform/core/router/app_router.dart';
import 'package:avm_tech_platform/features/energy/energy_module.dart';
import 'package:avm_tech_platform/features/energy/data/models/invoice_model.dart';
import 'package:avm_tech_platform/features/energy/data/models/meter_model.dart';
import 'package:avm_tech_platform/features/energy/data/models/reading_model.dart';
import 'package:avm_tech_platform/features/energy/services/budget_parser_service.dart';
import 'package:avm_tech_platform/features/energy/services/invoice_parser_service.dart';
import 'package:avm_tech_platform/features/maintenance/maintenance_module.dart';
import 'package:avm_tech_platform/features/work_tracking/work_tracking_module.dart';
import 'package:avm_tech_platform/features/work_tracking/data/models/ticket_model.dart';
import 'package:avm_tech_platform/features/work_tracking/presentation/widgets/photo_picker.dart';
import 'package:avm_tech_platform/features/work_tracking/utils/labels.dart';
import 'package:avm_tech_platform/features/work_tracking/utils/ticket_filter.dart';
import 'package:avm_tech_platform/features/work_tracking/work_tracking_access.dart';

void main() {
  final now = DateTime(2026, 11, 19);

  ProfileModel buildProfile({
    required String role,
    String approvalStatus = 'approved',
    Map<String, dynamic> permissions = const {},
  }) {
    return ProfileModel(
      id: 'u-1',
      fullName: 'Test Kullanıcı',
      role: role,
      approvalStatus: approvalStatus,
      permissions: permissions,
      createdAt: now,
    );
  }

  group('Merkezi 8 Bağımsız Yetki Testleri', () {
    test('pending kullanıcı hiçbir modül iznine sahip olamaz', () {
      final p = buildProfile(role: 'system_admin', approvalStatus: 'pending');
      expect(p.hasModulePermission('energy', ModulePermission.enabled), isFalse);
      expect(p.hasModulePermission('work_tracking', ModulePermission.view), isFalse);
    });

    test('technician varsayılan olarak energy.create açık, delete/manage kapalı', () {
      final p = buildProfile(role: 'technician');
      expect(p.hasModulePermission('energy', ModulePermission.enabled), isTrue);
      expect(p.hasModulePermission('energy', ModulePermission.create), isTrue);
      expect(p.hasModulePermission('energy', ModulePermission.delete), isFalse);
      expect(p.hasModulePermission('energy', ModulePermission.manage), isFalse);
    });

    test('employee varsayılan olarak energy kapalı, özel izinle açılabilir', () {
      final defaultEmp = buildProfile(role: 'employee');
      expect(defaultEmp.hasModulePermission('energy', ModulePermission.enabled), isFalse);

      final customEmp = buildProfile(
        role: 'employee',
        permissions: {
          'modules': {
            'energy': {
              'enabled': true,
              'view': true,
              'create': true,
              'edit': false,
              'delete': false,
              'approve': false,
              'reports': false,
              'manage': false,
            },
          },
        },
      );
      expect(customEmp.hasModulePermission('energy', ModulePermission.enabled), isTrue);
      expect(customEmp.hasModulePermission('energy', ModulePermission.create), isTrue);
      expect(customEmp.hasModulePermission('energy', ModulePermission.edit), isFalse);
    });
  });

  group('ModuleRegistry ve Router Guard Testleri', () {
    final registry = ModuleRegistry();

    test('employee yalnızca İş Takip modülünü görür', () {
      final emp = buildProfile(role: 'employee');
      final modules = registry.visibleModulesFor(emp);
      expect(modules.map((m) => m.key).toList(), ['work_tracking']);
    });

    test('system_admin aktif ve yakında modüllerini görür', () {
      final admin = buildProfile(role: 'system_admin');
      final modules = registry.visibleModulesFor(admin);
      expect(
        modules.map((m) => m.key).toList(),
        containsAll(['energy', 'work_tracking', 'maintenance', 'assets']),
      );
    });

    test('sunucudan kapatılan modül normal kullanıcıya gizlenir', () {
      final tech = buildProfile(role: 'technician');
      final modules = registry.visibleModulesFor(
        tech,
        serverStates: const {
          'energy': SystemModuleState(
            key: 'energy',
            isEnabled: false,
            isComingSoon: false,
            sortOrder: 1,
          ),
        },
      );
      expect(modules.map((m) => m.key).toList(), ['work_tracking']);
    });

    test('yetkisiz modül rotasına giden kullanıcı /home ekranına yönlendirilir', () {
      final emp = buildProfile(role: 'employee');
      final redirect = resolvePlatformRedirect(
        status: AuthStatus.authenticated,
        location: '/energy',
        registry: registry,
        profile: emp,
      );
      expect(redirect, '/home');
    });

    test('pending kullanıcı /pending-approval ekranına yönlendirilir', () {
      final pending = buildProfile(role: 'employee', approvalStatus: 'pending');
      final redirect = resolvePlatformRedirect(
        status: AuthStatus.pendingApproval,
        location: '/home',
        registry: registry,
        profile: pending,
      );
      expect(redirect, '/pending-approval');
    });
  });

  group('Offline Retry Policy Testleri', () {
    test('exponential backoff 5 deneme sonrası null döner', () {
      expect(OfflineRetryPolicy.nextDelay(0), const Duration(seconds: 10));
      expect(OfflineRetryPolicy.nextDelay(4), const Duration(minutes: 30));
      expect(OfflineRetryPolicy.nextDelay(5), isNull);
    });
  });

  group('İş Takip Modülü Testleri', () {
    final registry = ModuleRegistry();

    test('WorkTrackingAccess roller ve bağımsız izinlerle uyumlu çalışır', () {
      final tech = buildProfile(role: 'technician');
      expect(tech.hasActionAccess('ticket_create'), isTrue);
      expect(tech.hasActionAccess('work_order_execute'), isTrue);
      expect(tech.hasActionAccess('work_order_assign'), isFalse);
      expect(tech.hasActionAccess('work_order_review'), isFalse);

      final lead = buildProfile(role: 'team_lead');
      expect(lead.hasActionAccess('work_order_assign'), isTrue);
      expect(lead.hasActionAccess('work_order_review'), isTrue);
    });

    test('alt rota guardları yetkisiz kullanıcıyı /work-tracking içine döndürür', () {
      final tech = buildProfile(role: 'technician');
      expect(
        resolvePlatformRedirect(
          status: AuthStatus.authenticated,
          location: '/work-tracking/manager-work-orders',
          registry: registry,
          profile: tech,
        ),
        '/work-tracking',
      );

      final empNoCreate = buildProfile(
        role: 'employee',
        permissions: {
          'modules': {
            'work_tracking': {'enabled': true, 'view': true, 'create': false},
          },
        },
      );
      expect(
        resolvePlatformRedirect(
          status: AuthStatus.authenticated,
          location: '/work-tracking/tickets/new',
          registry: registry,
          profile: empNoCreate,
        ),
        '/work-tracking',
      );
    });

    test('resolveNotificationRoute work_tracking kaydını çözer', () {
      expect(
        registry.resolveNotificationRoute('work_tracking', 'ticket', 'abc-123'),
        '/work-tracking/tickets/abc-123',
      );
      expect(
        registry.resolveNotificationRoute('work_tracking', 'ticket', null),
        '/work-tracking',
      );
      expect(
        registry.resolveNotificationRoute('maintenance', 'plan', '1'),
        isNull,
      );
    });

    test('TicketFilter durum, öncelik ve arama metnine göre filtreler', () {
      final list = [
        TicketModel(
          id: '1',
          ticketNumber: 'AVM-2026-000001',
          reporterId: 'u1',
          priority: 'urgent',
          status: 'new',
          description: 'Chiller su kaçağı',
          createdAt: now,
        ),
        TicketModel(
          id: '2',
          ticketNumber: 'AVM-2026-000002',
          reporterId: 'u2',
          priority: 'normal',
          status: 'closed',
          description: 'Lobi lamba arızası',
          createdAt: now,
        ),
      ];

      expect(TicketFilter.apply(list, status: 'new').length, 1);
      expect(TicketFilter.apply(list, priority: 'urgent').first.id, '1');
      expect(TicketFilter.apply(list, query: 'lamba').first.id, '2');
      expect(TicketFilter.apply(list, query: '000001').first.id, '1');
    });

    test('Labels Türkçe durum ve öncelik etiketlerini döndürür', () {
      expect(Labels.ticketStatus('resolved'), 'Çözüldü (Onay Bekliyor)');
      expect(Labels.priority('urgent'), 'Acil');
      expect(Labels.workOrderStatus('waiting'), 'Beklemede');
    });
  });

  group('Enerji Takip Modülü Testleri', () {
    final registry = ModuleRegistry();

    test('MeterReadingModel elektrik çarpan ve reaktif oran hesabı doğru çalışır', () {
      final res = MeterReadingModel.calculateElectric(
        active: 1100,
        inductive: 125,
        capacitive: 55,
        multiplier: 10,
        prevActive: 1000,
        prevInductive: 100,
        prevCapacitive: 50,
      );
      expect(res.consumption, 1000.0);
      expect(res.inductivePercent, 25.0);
      expect(res.capacitivePercent, 5.0);

      expect(
        () => MeterReadingModel.calculateElectric(
          active: 900,
          inductive: 100,
          capacitive: 50,
          multiplier: 1,
          prevActive: 1000,
          prevInductive: 100,
          prevCapacitive: 50,
        ),
        throwsArgumentError,
      );
    });

    test('MeterReadingModel mekanik sayaç tüketim hesabı', () {
      expect(
        MeterReadingModel.calculateMechanical(
          indexValue: 540,
          multiplier: 2,
          prevIndexValue: 500,
        ),
        80.0,
      );
    });

    test('BudgetParserService dikey ve yatay CSV bütçe tablosunu ayrıştırır', () {
      const csv = '''
Kategori;Ay;Bütçe Miktar;Bütçe TL;Önceki Yıl Miktar;Önceki Yıl TL
Elektrik;Ocak;250000;1475000;240000;1100000
Doğalgaz;Şubat;12000;180000;11000;150000
''';
      final parsed = BudgetParserService.parseCsvBudgets(csv, 2026);
      expect(parsed.length, 2);
      final elec = parsed.firstWhere((b) => b.utilityType == 'electric');
      expect(elec.periodMonth, 1);
      expect(elec.budgetConsumption, 250000);
      expect(elec.budgetTL, 1475000);
    });

    test('InvoiceParserService EIC ile sayaç eşleştirir ve dönem çakışmasını yakalar', () {
      const meters = [
        MeterModel(
          id: 'm-gt1',
          name: 'GT.ADP.1',
          meterType: 'electric',
          category: 'electric',
          eicCode: '40Z000193592876I',
          meterNo: '600036275',
        ),
      ];
      final historical = [
        EnergyInvoiceModel(
          id: 'inv-1',
          periodYear: 2026,
          periodMonth: 11,
          utilityType: 'electric',
          provider: 'Aras Elektrik',
          meterId: 'm-gt1',
          meterName: 'GT.ADP.1',
          eicCode: '40Z000193592876I',
          consumption: 1000,
          amountTL: 5000,
          enteredByName: 'Admin',
          createdAt: now,
        ),
      ];

      final drafts = InvoiceParserService.buildDraftsFromItems(
        items: [
          {
            'provider': 'Aras Elektrik',
            'utilityType': 'electric',
            'year': 2026,
            'month': 11,
            'eicCode': '40z000193592876i',
            'consumption': 1100,
            'amountTL': 5500,
          },
          {
            'provider': 'Bilinmeyen',
            'utilityType': 'electric',
            'year': 2026,
            'month': 11,
            'eicCode': '40Z999999999999X',
            'consumption': 100,
            'amountTL': 500,
          },
        ],
        existingMeters: meters,
        historicalInvoices: historical,
        onlyRegisteredMeters: true,
      );

      expect(drafts.length, 1);
      expect(drafts.first.matchedMeterId, 'm-gt1');
      expect(drafts.first.hasMeterConflict, isTrue);
    });

    test('EnergyModule bildirim rotası ve /energy/invoices yetki guardı çalışır', () {
      expect(
        registry.resolveNotificationRoute('energy', 'meter', 'm-gt1'),
        '/energy/meters/m-gt1',
      );
      final tech = buildProfile(role: 'technician');
      expect(
        resolvePlatformRedirect(
          status: AuthStatus.authenticated,
          location: '/energy/invoices',
          registry: registry,
          profile: tech,
        ),
        '/energy',
      );
    });
  });

  group('Aşama 6 Offline Senkronizasyon ve Performans Testleri', () {
    test('JsonFileOfflineQueueStorage kalıcı olarak kuyruğu saklar ve yinelenen eklemeyi önler', () async {
      final tempDir = await Directory.systemTemp.createTemp('avm_offline_test_');
      try {
        final queueFile = File('${tempDir.path}/queue.json');
        final storage1 = JsonFileOfflineQueueStorage(queueFile);
        final engine1 = OfflineSyncEngine(
          storage: storage1,
          mediaUploader: (_) async => 'unused',
          mutationSender: (_, __) async => const OfflineMutationSendResult.synced(),
        );

        await engine1.enqueueMutation(
          clientMutationId: 'mut-energy-1',
          moduleKey: 'energy',
          entityType: 'meter_reading',
          operation: 'insert',
          payload: {'meter_id': 'm-1', 'index_value': 1250},
        );
        // Aynı clientMutationId ikinci kez eklendiğinde mükerrer kayıt oluşmaz
        await engine1.enqueueMutation(
          clientMutationId: 'mut-energy-1',
          moduleKey: 'energy',
          entityType: 'meter_reading',
          operation: 'insert',
          payload: {'meter_id': 'm-1', 'index_value': 1250},
        );

        // Uygulama yeniden başlatıldığında yeni storage örneği diske kaydedilmiş kuyruğu okur
        final storage2 = JsonFileOfflineQueueStorage(queueFile);
        var sentCount = 0;
        final engine2 = OfflineSyncEngine(
          storage: storage2,
          mediaUploader: (_) async => 'unused',
          mutationSender: (_, __) async {
            sentCount++;
            return const OfflineMutationSendResult.synced();
          },
        );

        final loaded = await engine2.getMutations();
        expect(loaded.length, 1);
        expect(loaded.first.status, SyncStatus.pending);

        final res1 = await engine2.processPending();
        expect(res1.syncedCount, 1);
        expect(sentCount, 1);

        // Tekrar çalıştırıldığında synced kayıt yeniden gönderilmez
        final res2 = await engine2.processPending();
        expect(res2.syncedCount, 0);
        expect(sentCount, 1);
      } finally {
        await tempDir.delete(recursive: true);
      }
    });

    test('2 aşamalı fotoğraf yüklemesi yarım kalırsa ana kayıt bekler ve yalnızca eksik fotoğraf yüklenir', () async {
      final storage = InMemoryOfflineQueueStorage();
      final uploadAttempts = <String>[];
      var ticketSentCount = 0;
      List<String> finalUploadedPaths = const [];
      var failSecondPhoto = true;

      final engine = OfflineSyncEngine(
        storage: storage,
        mediaUploader: (media) async {
          uploadAttempts.add(media.id);
          if (media.id == 'img-2' && failSecondPhoto) {
            throw OfflineSyncException.transient('Bodrum otopark ağ kesintisi');
          }
          return 'u1/mut-ticket-1/${media.id}.jpg';
        },
        mutationSender: (item, uploadedMedia) async {
          ticketSentCount++;
          finalUploadedPaths =
              uploadedMedia.map((m) => m.uploadedStoragePath!).toList();
          return const OfflineMutationSendResult.synced();
        },
      );

      await engine.enqueueMutation(
        clientMutationId: 'mut-ticket-1',
        moduleKey: 'work_tracking',
        entityType: 'ticket',
        operation: 'insert',
        payload: {'description': 'Bodrum Pano Duman'},
        createdAt: DateTime.utc(2026, 11, 19, 10, 0),
        attachments: const [
          LocalMediaQueueItem(
            id: 'img-1',
            parentMutationId: 'mut-ticket-1',
            bucketName: 'work-attachments',
            localFilePath: '/tmp/img1.jpg',
          ),
          LocalMediaQueueItem(
            id: 'img-2',
            parentMutationId: 'mut-ticket-1',
            bucketName: 'work-attachments',
            localFilePath: '/tmp/img2.jpg',
          ),
        ],
      );

      // İlk denemede img-1 yüklenir, img-2 hata alır -> ana arıza kaydı gönderilmez!
      final t0 = DateTime.utc(2026, 11, 19, 10, 0, 0);
      final batch1 = await engine.processPending(nowOverride: t0);
      expect(batch1.failedCount, 1);
      expect(ticketSentCount, 0);
      expect(uploadAttempts, ['img-1', 'img-2']);

      // Backoff (10sn) dolmadan çalıştırılırsa otomatik deneme atlanır
      final batchTooEarly = await engine.processPending(
        nowOverride: t0.add(const Duration(seconds: 5)),
      );
      expect(batchTooEarly.skippedCount, 1);
      expect(ticketSentCount, 0);

      // 12sn sonra bağlantı gelince yalnızca eksik olan img-2 yüklenir, ardından ana kayıt gider
      failSecondPhoto = false;
      final batch2 = await engine.processPending(
        nowOverride: t0.add(const Duration(seconds: 12)),
      );
      expect(batch2.syncedCount, 1);
      expect(uploadAttempts, ['img-1', 'img-2', 'img-2']);
      expect(ticketSentCount, 1);
      expect(finalUploadedPaths, [
        'u1/mut-ticket-1/img-1.jpg',
        'u1/mut-ticket-1/img-2.jpg',
      ]);
    });

    test('Kalıcı 403/400 hatada otomatik tekrar durur; retryManual sonrası gönderilir', () async {
      final storage = InMemoryOfflineQueueStorage();
      var attempts = 0;
      var throwPermanent = true;

      final engine = OfflineSyncEngine(
        storage: storage,
        mediaUploader: (_) async => 'unused',
        mutationSender: (_, __) async {
          attempts++;
          if (throwPermanent) {
            throw OfflineSyncException.permanent('Erişim engellendi (403)', statusCode: 403);
          }
          return const OfflineMutationSendResult.synced();
        },
      );

      await engine.enqueueMutation(
        clientMutationId: 'mut-perm-1',
        moduleKey: 'energy',
        entityType: 'meter_reading',
        operation: 'insert',
        payload: {'meter_id': 'm-1', 'index_value': 10},
      );

      final b1 = await engine.processPending(nowOverride: DateTime.utc(2026, 11, 19, 12));
      expect(b1.failedCount, 1);
      final itemAfterFail = (await engine.getMutations()).first;
      expect(itemAfterFail.isPermanentError, isTrue);
      expect(itemAfterFail.canAutoRetry, isFalse);

      // Aradan uzun süre geçse de otomatik denenmez
      final b2 = await engine.processPending(nowOverride: DateTime.utc(2026, 11, 19, 15));
      expect(b2.skippedCount, 1);
      expect(attempts, 1);

      // Yönetici yetki açtıktan sonra kullanıcı manuel tetikler
      throwPermanent = false;
      await engine.retryManual('mut-perm-1');
      final b3 = await engine.processPending(nowOverride: DateTime.utc(2026, 11, 19, 15, 1));
      expect(b3.syncedCount, 1);
      expect(attempts, 2);
    });

    test('Çakışma (conflict) durumunda keepServer düşürür, reapplyLocal force_overwrite ile yeniden uygular', () async {
      final storage = InMemoryOfflineQueueStorage();
      final seenForceFlags = <bool>[];

      final engine = OfflineSyncEngine(
        storage: storage,
        mediaUploader: (_) async => 'unused',
        mutationSender: (item, _) async {
          final force = item.payload['force_overwrite'] == true;
          seenForceFlags.add(force);
          if (!force) {
            return const OfflineMutationSendResult.conflict(
              serverSnapshot: {'status': 'in_progress'},
              message: 'Sunucu sürümü daha güncel',
            );
          }
          return const OfflineMutationSendResult.synced();
        },
      );

      await engine.enqueueMutation(
        clientMutationId: 'mut-wo-reapply',
        moduleKey: 'work_tracking',
        entityType: 'work_order_status',
        operation: 'update',
        payload: {'work_order_id': 'wo-1', 'target_status': 'waiting'},
        createdAt: DateTime.utc(2026, 11, 19, 9, 0),
      );
      await engine.enqueueMutation(
        clientMutationId: 'mut-wo-drop',
        moduleKey: 'work_tracking',
        entityType: 'work_order_status',
        operation: 'update',
        payload: {'work_order_id': 'wo-2', 'target_status': 'waiting'},
        createdAt: DateTime.utc(2026, 11, 19, 9, 1),
      );

      final firstBatch = await engine.processPending();
      expect(firstBatch.conflictCount, 2);

      // keepServer: yerel değişikliği düşürür
      final dropped = await engine.resolveConflict(
        'mut-wo-drop',
        ConflictResolutionStrategy.keepServer,
      );
      expect(dropped, isNull);

      // reapplyLocal: force_overwrite=true ile yeniden kuyruğa alır
      final reapplied = await engine.resolveConflict(
        'mut-wo-reapply',
        ConflictResolutionStrategy.reapplyLocal,
      );
      expect(reapplied?.status, SyncStatus.pending);
      expect(reapplied?.payload['force_overwrite'], isTrue);

      final secondBatch = await engine.processPending();
      expect(secondBatch.syncedCount, 1);
      expect(seenForceFlags, [false, false, true]);
    });

    test('PhotoCompressionPolicy ve PaginatedResult sınır kuralları ARCHITECTURE/DATABASE ile uyumludur', () {
      expect(PhotoCompressionPolicy.maxWidthPx, 1200);
      expect(PhotoCompressionPolicy.maxHeightPx, 1200);
      expect(PhotoCompressionPolicy.jpegQuality, 70);
      expect(PhotoCompressionPolicy.retentionDaysAfterClose, 15);

      expect(clampPageLimit(0), 1);
      expect(clampPageLimit(500), 100);
      expect(clampPageOffset(-5), 0);

      const page1 = PaginatedResult<String>(
        items: ['a', 'b'],
        totalCount: 5,
        limit: 2,
        offset: 0,
      );
      expect(page1.hasMore, isTrue);

      const page3 = PaginatedResult<String>(
        items: ['e'],
        totalCount: 5,
        limit: 2,
        offset: 4,
      );
      expect(page3.hasMore, isFalse);
    });
  });

  group('Aşama 7 Yeni Modül Genişletilebilirlik ve İzolasyon Testleri', () {
    test('MaintenanceModule ana router ve mevcut modüllere dokunulmadan sisteme takılır ve çalışır', () {
      final defaultRegistry = ModuleRegistry();
      final tech = buildProfile(role: 'technician');
      // Varsayılan durumda Planlı Bakım isComingSoon = true olduğu için gizlidir
      expect(
        defaultRegistry.visibleModulesFor(tech).map((m) => m.key).toList(),
        ['energy', 'work_tracking'],
      );

      // Modül aktif hale getirildiğinde aynı AppModule arayüzüyle rotalar ve guard'lar çalışır
      final activeRegistry = ModuleRegistry(
        modules: [
          EnergyModule(),
          WorkTrackingModule(),
          MaintenanceModule(isComingSoon: false),
        ],
      );

      expect(activeRegistry.buildAllRoutes().length, greaterThanOrEqualTo(3));
      expect(
        activeRegistry.resolveNotificationRoute('maintenance', 'plan', 'p-42'),
        '/maintenance/plans/p-42',
      );

      final emp = buildProfile(role: 'employee');
      expect(
        resolvePlatformRedirect(
          status: AuthStatus.authenticated,
          location: '/maintenance',
          registry: activeRegistry,
          profile: emp,
        ),
        '/home',
      );

      final mgr = buildProfile(role: 'technical_manager');
      expect(
        resolvePlatformRedirect(
          status: AuthStatus.authenticated,
          location: '/maintenance/plans/p-42',
          registry: activeRegistry,
          profile: mgr,
        ),
        isNull,
      );

      final customTech = buildProfile(
        role: 'technician',
        permissions: {
          'modules': {
            'maintenance': {'enabled': true, 'view': true},
          },
        },
      );
      expect(
        activeRegistry.visibleModulesFor(customTech).map((m) => m.key).toList(),
        ['energy', 'work_tracking', 'maintenance'],
      );
    });

    test('Feature modülleri (energy, work_tracking, maintenance) birbirini doğrudan import etmez', () async {
      final cwd = Directory.current;
      final featuresDir = Directory('${cwd.path}/lib/features');
      expect(await featuresDir.exists(), isTrue);

      final moduleDirs = ['energy', 'work_tracking', 'maintenance'];
      for (final owner in moduleDirs) {
        final ownerDir = Directory('${featuresDir.path}/$owner');
        expect(await ownerDir.exists(), isTrue);
        await for (final entity in ownerDir.list(recursive: true)) {
          if (entity is! File || !entity.path.endsWith('.dart')) continue;
          final content = await entity.readAsString();
          for (final other in moduleDirs) {
            if (other == owner) continue;
            expect(
              content.contains('features/$other/'),
              isFalse,
              reason: '${entity.path} dosyası features/$other/ modülünü doğrudan import edemez.',
            );
          }
        }
      }
    });
  });
}

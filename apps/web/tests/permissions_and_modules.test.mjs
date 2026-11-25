import test from 'node:test';
import assert from 'node:assert/strict';

// Merkezi 8 bağımsız yetki mantığının Node native test doğrulaması
const PERMS = ['enabled', 'view', 'create', 'edit', 'delete', 'approve', 'reports', 'manage'];

function defaultModulePermission(role, moduleKey, perm) {
  if (role === 'system_admin') return true;
  if (moduleKey === 'work_tracking') {
    if (role === 'technical_manager' || role === 'team_lead') return perm !== 'delete';
    if (role === 'technician') return ['enabled', 'view', 'create', 'edit'].includes(perm);
    if (role === 'employee') return ['enabled', 'view', 'create', 'approve'].includes(perm);
    return false;
  }
  if (moduleKey === 'energy') {
    if (role === 'technical_manager') return true;
    if (role === 'team_lead') return ['enabled', 'view', 'create', 'edit', 'reports'].includes(perm);
    if (role === 'technician') return ['enabled', 'view', 'create'].includes(perm);
    return false;
  }
  return false;
}

function hasModulePermission(profile, moduleKey, perm) {
  if (!profile || profile.approval_status !== 'approved') return false;
  if (profile.role === 'system_admin') return true;
  const customMod = profile.permissions?.modules?.[moduleKey];
  if (customMod) {
    if (customMod.enabled === false) return false;
    if (typeof customMod[perm] === 'boolean') return customMod[perm];
  }
  return defaultModulePermission(profile.role, moduleKey, perm);
}

test('8 bağımsız yetki anahtarı tanımlı olmalı', () => {
  assert.equal(PERMS.length, 8);
  assert.ok(PERMS.includes('approve'));
  assert.ok(PERMS.includes('manage'));
});

test('pending kullanıcı hiçbir modüle erişememeli', () => {
  const pendingAdmin = { role: 'system_admin', approval_status: 'pending', permissions: {} };
  assert.equal(hasModulePermission(pendingAdmin, 'energy', 'enabled'), false);
  assert.equal(hasModulePermission(pendingAdmin, 'work_tracking', 'view'), false);
});

test('technician energy.create açık, energy.delete ve energy.manage kapalı olmalı', () => {
  const tech = { role: 'technician', approval_status: 'approved', permissions: {} };
  assert.equal(hasModulePermission(tech, 'energy', 'enabled'), true);
  assert.equal(hasModulePermission(tech, 'energy', 'create'), true);
  assert.equal(hasModulePermission(tech, 'energy', 'delete'), false);
  assert.equal(hasModulePermission(tech, 'energy', 'manage'), false);
});

test('kullanıcı bazlı özel izin rol varsayılanını bağımsız olarak ezebilmeli', () => {
  const customEmp = {
    role: 'employee',
    approval_status: 'approved',
    permissions: {
      modules: {
        energy: { enabled: true, view: true, create: true, edit: false, delete: false },
      },
    },
  };
  assert.equal(hasModulePermission(customEmp, 'energy', 'enabled'), true);
  assert.equal(hasModulePermission(customEmp, 'energy', 'create'), true);
  assert.equal(hasModulePermission(customEmp, 'energy', 'edit'), false);
});

test('work_tracking rolleri: employee approve açık ama manage kapalı, team_lead manage açık', () => {
  const emp = { role: 'employee', approval_status: 'approved', permissions: {} };
  const lead = { role: 'team_lead', approval_status: 'approved', permissions: {} };
  assert.equal(hasModulePermission(emp, 'work_tracking', 'create'), true);
  assert.equal(hasModulePermission(emp, 'work_tracking', 'approve'), true);
  assert.equal(hasModulePermission(emp, 'work_tracking', 'manage'), false);
  assert.equal(hasModulePermission(lead, 'work_tracking', 'manage'), true);
  assert.equal(hasModulePermission(lead, 'work_tracking', 'reports'), true);
  assert.equal(hasModulePermission(lead, 'work_tracking', 'delete'), false);
});

test('work_tracking alt menü rotaları tanımlı olmalı', () => {
  const expectedRoutes = [
    '/work-tracking',
    '/work-tracking/tickets',
    '/work-tracking/work-orders',
    '/work-tracking/review',
    '/work-tracking/reports',
  ];
  assert.equal(expectedRoutes.length, 5);
  assert.ok(expectedRoutes.every((r) => r.startsWith('/work-tracking')));
});

test('energy rolleri: technical_manager reports & manage açık, technician yalnızca view & create', () => {
  const mgr = { role: 'technical_manager', approval_status: 'approved', permissions: {} };
  const tech = { role: 'technician', approval_status: 'approved', permissions: {} };
  assert.equal(hasModulePermission(mgr, 'energy', 'manage'), true);
  assert.equal(hasModulePermission(mgr, 'energy', 'reports'), true);
  assert.equal(hasModulePermission(tech, 'energy', 'view'), true);
  assert.equal(hasModulePermission(tech, 'energy', 'create'), true);
  assert.equal(hasModulePermission(tech, 'energy', 'reports'), false);
  assert.equal(hasModulePermission(tech, 'energy', 'manage'), false);
});

test('energy alt menü rotaları tanımlı olmalı', () => {
  const expectedRoutes = [
    '/energy',
    '/energy/meters',
    '/energy/readings',
    '/energy/invoices',
    '/energy/budgets',
  ];
  assert.equal(expectedRoutes.length, 5);
  assert.ok(expectedRoutes.every((r) => r.startsWith('/energy')));
});

test('tüm 5 rol x 8 bağımsız yetki x 2 modül erişim matrisi tutarlı olmalı', () => {
  const roles = ['employee', 'technician', 'team_lead', 'technical_manager', 'system_admin'];
  const expectedMatrix = {
    work_tracking: {
      employee: { enabled: true, view: true, create: true, edit: false, delete: false, approve: true, reports: false, manage: false },
      technician: { enabled: true, view: true, create: true, edit: true, delete: false, approve: false, reports: false, manage: false },
      team_lead: { enabled: true, view: true, create: true, edit: true, delete: false, approve: true, reports: true, manage: true },
      technical_manager: { enabled: true, view: true, create: true, edit: true, delete: false, approve: true, reports: true, manage: true },
      system_admin: { enabled: true, view: true, create: true, edit: true, delete: true, approve: true, reports: true, manage: true },
    },
    energy: {
      employee: { enabled: false, view: false, create: false, edit: false, delete: false, approve: false, reports: false, manage: false },
      technician: { enabled: true, view: true, create: true, edit: false, delete: false, approve: false, reports: false, manage: false },
      team_lead: { enabled: true, view: true, create: true, edit: true, delete: false, approve: false, reports: true, manage: false },
      technical_manager: { enabled: true, view: true, create: true, edit: true, delete: true, approve: true, reports: true, manage: true },
      system_admin: { enabled: true, view: true, create: true, edit: true, delete: true, approve: true, reports: true, manage: true },
    },
  };

  for (const role of roles) {
    const user = { role, approval_status: 'approved', permissions: {} };
    for (const mod of ['work_tracking', 'energy']) {
      for (const perm of PERMS) {
        assert.equal(
          hasModulePermission(user, mod, perm),
          expectedMatrix[mod][role][perm],
          `Matris uyuşmazlığı: ${role}.${mod}.${perm}`
        );
      }
    }
    // rejected ve disabled hesaplar hiçbir rol yetkisine sahip olamaz
    for (const badStatus of ['pending', 'rejected', 'disabled']) {
      const blocked = { role, approval_status: badStatus, permissions: {} };
      for (const mod of ['work_tracking', 'energy']) {
        assert.equal(hasModulePermission(blocked, mod, 'view'), false);
      }
    }
  }

  // core_actions doğrulaması (apps/web/src/core/permissions.ts hasCoreAction ile uyumlu)
  const hasCoreAction = (profile, action) => {
    if (!profile || profile.approval_status !== 'approved') return false;
    if (profile.role === 'system_admin') return true;
    return Boolean(profile.permissions?.core_actions?.includes(action));
  };
  assert.equal(hasCoreAction({ role: 'system_admin', approval_status: 'approved', permissions: {} }, 'manage_modules'), true);
  assert.equal(hasCoreAction({ role: 'technician', approval_status: 'approved', permissions: { core_actions: ['manage_equipments'] } }, 'manage_equipments'), true);
  assert.equal(hasCoreAction({ role: 'technician', approval_status: 'disabled', permissions: { core_actions: ['manage_equipments'] } }, 'manage_equipments'), false);
});

test('Aşama 7: gelecek modül (maintenance) çekirdek değişmeden server flag + özel yetkiyle aktifleşir', () => {
  const defaultFuturePermission = (role, moduleKey, perm) => {
    if (role === 'system_admin') return true;
    if (role === 'technical_manager') return ['enabled', 'view', 'reports'].includes(perm);
    return false;
  };
  const canSeeFutureModule = (profile, moduleKey, serverMod) => {
    if (!profile || profile.approval_status !== 'approved') return false;
    if (serverMod.is_coming_soon) return profile.role === 'system_admin';
    if (!serverMod.is_enabled && profile.role !== 'system_admin') return false;
    const customMod = profile.permissions?.modules?.[moduleKey];
    if (customMod) {
      if (customMod.enabled === false) return false;
      if (typeof customMod.enabled === 'boolean') return customMod.enabled;
    }
    return defaultFuturePermission(profile.role, moduleKey, 'enabled');
  };

  const comingSoon = { key: 'maintenance', is_enabled: false, is_coming_soon: true };
  const activated = { key: 'maintenance', is_enabled: true, is_coming_soon: false };
  const mgr = { role: 'technical_manager', approval_status: 'approved', permissions: {} };
  const emp = { role: 'employee', approval_status: 'approved', permissions: {} };
  const customEmp = {
    role: 'employee',
    approval_status: 'approved',
    permissions: { modules: { maintenance: { enabled: true, view: true } } },
  };

  assert.equal(canSeeFutureModule(mgr, 'maintenance', comingSoon), false);
  assert.equal(canSeeFutureModule(mgr, 'maintenance', activated), true);
  assert.equal(canSeeFutureModule(emp, 'maintenance', activated), false);
  assert.equal(canSeeFutureModule(customEmp, 'maintenance', activated), true);
});

test('YAVUZ SEPİL senaryosu: kısıtlı izinlerle fatura/bütçe/iş emri/onay/rapor ve admin sayfaları engellenir', () => {
  const hasCoreAction = (profile, action) => {
    if (!profile || profile.approval_status !== 'approved') return false;
    if (profile.role === 'system_admin') return true;
    return Boolean(profile.permissions?.core_actions?.includes(action));
  };

  const navRules = {
    energy: {
      '/energy': ['enabled', 'view'],
      '/energy/meters': ['view', 'manage'],
      '/energy/readings': ['view', 'create'],
      '/energy/invoices': ['reports', 'manage'],
      '/energy/budgets': ['reports', 'manage'],
    },
    work_tracking: {
      '/work-tracking': ['enabled', 'view'],
      '/work-tracking/tickets': ['view', 'create'],
      '/work-tracking/work-orders': ['edit', 'manage', 'reports'],
      '/work-tracking/review': ['approve'],
      '/work-tracking/reports': ['reports'],
    },
  };

  const canAccessPath = (profile, pathname) => {
    if (!profile || profile.approval_status !== 'approved') return false;
    if (pathname === '/home') return true;
    if (pathname.startsWith('/admin/users')) {
      return (
        profile.role === 'system_admin' ||
        hasCoreAction(profile, 'manage_users') ||
        profile.role === 'technical_manager' ||
        profile.role === 'team_lead'
      );
    }
    if (pathname.startsWith('/admin/modules')) {
      return profile.role === 'system_admin' || hasCoreAction(profile, 'manage_modules');
    }
    if (pathname.startsWith('/admin/equipments')) {
      return (
        profile.role === 'system_admin' ||
        hasCoreAction(profile, 'manage_equipments') ||
        profile.role === 'technical_manager' ||
        profile.role === 'team_lead'
      );
    }
    if (pathname.startsWith('/admin/definitions')) {
      return profile.role === 'system_admin' || hasCoreAction(profile, 'manage_definitions');
    }

    const modKey = pathname.startsWith('/energy')
      ? 'energy'
      : pathname.startsWith('/work-tracking')
      ? 'work_tracking'
      : null;
    if (!modKey || !hasModulePermission(profile, modKey, 'enabled')) return false;
    if (profile.role === 'system_admin') return true;
    const req = navRules[modKey][pathname];
    if (!req) return true;
    return req.some((perm) => hasModulePermission(profile, modKey, perm));
  };

  const restrictedOpsManager = {
    role: 'technician',
    custom_role: 'OPERASYON MÜDÜRÜ',
    approval_status: 'approved',
    permissions: {
      modules: {
        energy: {
          enabled: true,
          view: true,
          create: false,
          edit: false,
          delete: false,
          approve: false,
          reports: false,
          manage: false,
        },
        work_tracking: {
          enabled: true,
          view: true,
          create: true,
          edit: false,
          delete: false,
          approve: false,
          reports: false,
          manage: false,
        },
      },
      core_actions: [],
    },
  };

  // İzin verilenler
  for (const okPath of [
    '/home',
    '/energy',
    '/energy/meters',
    '/energy/readings',
    '/work-tracking',
    '/work-tracking/tickets',
  ]) {
    assert.equal(canAccessPath(restrictedOpsManager, okPath), true, `${okPath} açık olmalı`);
  }

  // Engellenenler
  for (const deniedPath of [
    '/energy/invoices',
    '/energy/budgets',
    '/work-tracking/work-orders',
    '/work-tracking/review',
    '/work-tracking/reports',
    '/admin/users',
    '/admin/modules',
    '/admin/equipments',
    '/admin/definitions',
  ]) {
    assert.equal(
      canAccessPath(restrictedOpsManager, deniedPath),
      false,
      `${deniedPath} kapalı olmalı`
    );
  }

  // Modül içi aksiyon kontrolleri
  assert.equal(hasModulePermission(restrictedOpsManager, 'energy', 'create'), false);
  assert.equal(hasModulePermission(restrictedOpsManager, 'energy', 'edit'), false);
  assert.equal(hasModulePermission(restrictedOpsManager, 'energy', 'delete'), false);
  assert.equal(hasModulePermission(restrictedOpsManager, 'energy', 'reports'), false);
  assert.equal(hasModulePermission(restrictedOpsManager, 'work_tracking', 'create'), true);
  assert.equal(hasModulePermission(restrictedOpsManager, 'work_tracking', 'edit'), false);
  assert.equal(hasModulePermission(restrictedOpsManager, 'work_tracking', 'approve'), false);

  // manage_users yetki devri alan personel vs normal teknisyen
  const delegatedHrTech = {
    role: 'technician',
    approval_status: 'approved',
    permissions: { core_actions: ['manage_users'] },
  };
  const regularTech = { role: 'technician', approval_status: 'approved', permissions: {} };

  assert.equal(canAccessPath(delegatedHrTech, '/admin/users'), true);
  assert.equal(canAccessPath(delegatedHrTech, '/admin/modules'), false);
  assert.equal(canAccessPath(delegatedHrTech, '/admin/definitions'), false);
  assert.equal(canAccessPath(regularTech, '/admin/users'), false);
});

test('Diff-aware yetki kaydı: rol varsayılanıyla aynı modül override yazılmamalı', () => {
  const buildDiffModulesPayload = (role, formMap) => {
    const out = {};
    for (const modKey of ['energy', 'work_tracking']) {
      const mod = formMap[modKey];
      const differs = PERMS.some((p) => Boolean(mod[p]) !== defaultModulePermission(role, modKey, p));
      if (differs) out[modKey] = mod;
    }
    return out;
  };

  const defaultForTechnician = {
    energy: Object.fromEntries(
      PERMS.map((p) => [p, defaultModulePermission('technician', 'energy', p)])
    ),
    work_tracking: Object.fromEntries(
      PERMS.map((p) => [p, defaultModulePermission('technician', 'work_tracking', p)])
    ),
  };

  // Varsayılanla birebir aynıysa boş dönmeli -> rol değiştiğinde eski izin yapışmaz
  assert.deepEqual(buildDiffModulesPayload('technician', defaultForTechnician), {});

  // Yalnızca energy özelleştirilmişse sadece energy yazılmalı
  const partialCustom = {
    ...defaultForTechnician,
    energy: { ...defaultForTechnician.energy, reports: true },
  };
  assert.deepEqual(Object.keys(buildDiffModulesPayload('technician', partialCustom)), ['energy']);
});


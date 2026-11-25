// PGlite (WASM PostgreSQL) üzerinde Supabase migration'larının gerçek doğrulaması.
// Çalıştırma: npm install && npm test   (supabase/tests/sql klasöründe)
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import {
  computeSnapshotMetrics,
  normalizeFirestoreTimestamp,
} from '../../../scripts/migration/export_firestore.mjs';
import {
  inferLegacyCategory,
  mapLegacyUserPermissions,
  runMigrationWithDb,
} from '../../../scripts/migration/transform_and_import.mjs';
import { verifyMigrationWithDb } from '../../../scripts/migration/verify_migration.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const supabaseDir = path.resolve(here, '..', '..');

const BOOTSTRAP = `
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    email text unique,
    raw_user_meta_data jsonb default '{}'::jsonb
  );
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  create schema storage;
  create table storage.buckets (
    id text primary key, name text, public boolean,
    file_size_limit bigint, allowed_mime_types text[]
  );
  create table storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text, name text, owner uuid
  );
  alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[] language sql immutable as $$
    select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
  $$;
  create publication supabase_realtime;
  grant usage on schema public, storage to anon, authenticated;
  alter default privileges in schema public grant all on tables to authenticated;
  alter default privileges in schema public grant all on sequences to authenticated;
  alter default privileges in schema public grant execute on functions to anon, authenticated;
  grant select, insert, delete on storage.objects to authenticated;
`;

let db;

function readSql(rel) {
  return fs
    .readFileSync(path.join(supabaseDir, rel), 'utf8')
    .replace(/create extension if not exists "pgcrypto";/g, '');
}

const U = {
  admin: '00000000-0000-0000-0000-0000000000a1',
  manager: '00000000-0000-0000-0000-0000000000a2',
  lead: '00000000-0000-0000-0000-0000000000a3',
  tech: '00000000-0000-0000-0000-0000000000a4',
  emp: '00000000-0000-0000-0000-0000000000a5',
  emp2: '00000000-0000-0000-0000-0000000000a6',
  pending: '00000000-0000-0000-0000-0000000000a7',
};

async function as(uid, fn) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', false);`);
  try {
    return await fn();
  } finally {
    await db.exec('reset role;');
  }
}

async function q(sql, params) {
  return (await db.query(sql, params)).rows;
}

before(async () => {
  db = new PGlite();
  await db.exec(BOOTSTRAP);
  const files = [
    'migrations/20261119000001_core_schema.sql',
    'migrations/20261119000002_core_auth_and_permissions.sql',
    'migrations/20261119000003_core_hardening.sql',
    'migrations/20261119000004_work_tracking.sql',
    'migrations/20261119000005_energy_tracking.sql',
    'migrations/20261119000006_security_and_performance.sql',
    'migrations/20261119000007_extensibility_and_equipment_360.sql',
    'migrations/20261121000011_meter_trash_bin.sql',
    'migrations/20261121000013_enforce_mechanical_index_only.sql',
    'seed.sql',
  ];
  for (const f of files) {
    try {
      await db.exec(readSql(f));
    } catch (e) {
      throw new Error(`Migration hatası (${f}): ${e.message}`);
    }
  }

  const names = {
    admin: 'Admin Kullanıcı',
    manager: 'Teknik Müdür',
    lead: 'Ekip Lideri',
    tech: 'Teknisyen Ali',
    emp: 'Personel Ayşe',
    emp2: 'Personel Veli',
    pending: 'Bekleyen Kişi',
  };
  for (const [k, id] of Object.entries(U)) {
    await db.query(
      `insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`,
      [id, `${k}@avm.test`, JSON.stringify({ full_name: names[k], phone: `0555000${id.slice(-2)}00` })]
    );
  }
  // İlk yönetici (create_initial_admin.sql mantığı)
  await db.query(
    `update public.profiles set role='system_admin', approval_status='approved' where id=$1`,
    [U.admin]
  );
});

test('Gatekeeper: yeni kayıt employee + pending başlar', async () => {
  const rows = await q(`select role, approval_status from public.profiles where id=$1`, [U.pending]);
  assert.equal(rows[0].role, 'employee');
  assert.equal(rows[0].approval_status, 'pending');
});

test('Çekirdek SQL test dosyası (RLS aktif + varsayılan izinler) geçmeli', async () => {
  await db.exec(readSql('tests/core_rls_security_tests.sql'));
});

test('Onay akışı: pending kullanıcı onaylanamaz → yetkisiz çağıran reddedilir', async () => {
  await as(U.emp, async () => {
    await assert.rejects(
      db.query(`select public.rpc_approve_user($1, 'technician', null, null)`, [U.pending]),
      /Erişim engellendi/
    );
  });
});

test('Admin kullanıcıları onaylar ve rol atar', async () => {
  await as(U.admin, async () => {
    await db.query(`select public.rpc_approve_user($1,'technical_manager',null,null)`, [U.manager]);
    await db.query(`select public.rpc_approve_user($1,'team_lead',null,null)`, [U.lead]);
    await db.query(`select public.rpc_approve_user($1,'technician',null,null)`, [U.tech]);
    await db.query(`select public.rpc_approve_user($1,'employee',null,null)`, [U.emp]);
    await db.query(`select public.rpc_approve_user($1,'employee',null,null)`, [U.emp2]);
  });
  const rows = await q(`select count(*)::int c from public.profiles where approval_status='approved'`);
  assert.equal(rows[0].c, 6);
});

test('Teknik müdür system_admin rolü atayamaz (yetki yükseltme engeli)', async () => {
  await as(U.manager, async () => {
    await db.query(`select 1`); // oturum aç
    await assert.rejects(
      db.query(`select public.rpc_approve_user($1,'system_admin',null,null)`, [U.pending]),
      /Erişim engellendi|system_admin/
    );
  });
});

test('Kullanıcı kendi rolünü doğrudan UPDATE ile değiştiremez', async () => {
  await as(U.emp, async () => {
    const r = await db.query(`update public.profiles set role='system_admin' where id=$1`, [U.emp]);
    assert.equal(r.affectedRows, 0);
  });
  const rows = await q(`select role from public.profiles where id=$1`, [U.emp]);
  assert.equal(rows[0].role, 'employee');
});

test('Pending kullanıcı modül göremez ve arıza açamaz', async () => {
  await as(U.pending, async () => {
    const mods = await q(`select * from public.rpc_get_my_modules()`);
    assert.equal(mods.length, 0);
    await assert.rejects(
      db.query(
        `insert into public.tickets (reporter_id, custom_location, custom_category, description)
         values ($1,'Lobi','Diğer','test')`,
        [U.pending]
      ),
      /row-level security/
    );
  });
});

test('rpc_get_my_modules: employee yalnızca İş Takip, teknisyen Enerji + İş Takip, admin yakında modülleri de görür', async () => {
  await as(U.emp, async () => {
    const mods = (await q(`select key from public.rpc_get_my_modules()`)).map((r) => r.key);
    assert.deepEqual(mods, ['work_tracking']);
  });
  await as(U.tech, async () => {
    const mods = (await q(`select key from public.rpc_get_my_modules()`)).map((r) => r.key);
    assert.deepEqual(mods, ['energy', 'work_tracking']);
  });
  await as(U.admin, async () => {
    const mods = (await q(`select key from public.rpc_get_my_modules()`)).map((r) => r.key);
    assert.ok(mods.includes('maintenance') && mods.includes('energy'));
  });
});

let ticketId;
let equipmentId;

test('Ortak ekipman: admin ekipman ekler, employee ekleyemez ama okuyabilir', async () => {
  await as(U.emp, async () => {
    await assert.rejects(
      db.query(`insert into public.equipments (code, name) values ('X-1','Yetkisiz')`),
      /row-level security/
    );
  });
  await as(U.admin, async () => {
    const r = await q(
      `insert into public.equipments (code, name, equipment_type) values ('CHL-01','1 No.lu Chiller','hvac') returning id`
    );
    equipmentId = r[0].id;
  });
  await as(U.emp, async () => {
    const rows = await q(`select code from public.equipments`);
    assert.equal(rows.length, 1);
  });
});

test('Employee ekipman bağlantılı arıza açar; yöneticilere bildirim düşer', async () => {
  await as(U.emp, async () => {
    const r = await q(
      `insert into public.tickets (reporter_id, custom_location, custom_category, description, equipment_id, priority)
       values ($1,'Zemin Kat Lobi','Elektrik','Aydınlatma arızası',$2,'urgent') returning id, ticket_number, status`,
      [U.emp, equipmentId]
    );
    ticketId = r[0].id;
    assert.match(r[0].ticket_number, /^AVM-\d{4}-\d{6}$/);
    assert.equal(r[0].status, 'new');
  });
  const n = await q(
    `select count(*)::int c from public.notifications
     where module_key='work_tracking' and entity_id=$1 and user_id in ($2,$3,$4)`,
    [ticketId, U.admin, U.manager, U.lead]
  );
  assert.equal(n[0].c, 3);
});

test('Kayıt görünürlüğü: başka personel göremez, ekip lideri görür', async () => {
  await as(U.emp2, async () => {
    assert.equal((await q(`select id from public.tickets`)).length, 0);
  });
  await as(U.lead, async () => {
    assert.equal((await q(`select id from public.tickets`)).length, 1);
  });
});

test('Konum/kategori kuralı: ikisi de boşsa kayıt reddedilir', async () => {
  await as(U.emp, async () => {
    await assert.rejects(
      db.query(`insert into public.tickets (reporter_id, description) values ($1,'x')`, [U.emp]),
      /tickets_location_or_custom_check|check/
    );
  });
});

let workOrderId;

test('İş emri: teknisyen oluşturamaz, ekip lideri oluşturur ve ekipman devralınır', async () => {
  const dept = (await q(`select id from public.departments limit 1`))[0].id;
  await as(U.tech, async () => {
    await assert.rejects(
      db.query(`select public.rpc_create_work_order($1,$2,$3::uuid[],'x')`, [ticketId, dept, [U.tech]]),
      /Erişim engellendi/
    );
  });
  await as(U.lead, async () => {
    const r = await q(
      `select public.rpc_create_work_order($1,$2,$3::uuid[],'Armatür değişimi') as id`,
      [ticketId, dept, [U.tech]]
    );
    workOrderId = r[0].id;
  });
  const wo = await q(`select equipment_id from public.work_orders where id=$1`, [workOrderId]);
  assert.equal(wo[0].equipment_id, equipmentId);
  const t = await q(`select status from public.tickets where id=$1`, [ticketId]);
  assert.equal(t[0].status, 'assigned');
});

test('Teknisyen akışı: başlat → nedensiz bekletme reddi → bekle → başlat → tamamla → arıza resolved', async () => {
  await as(U.emp, async () => {
    await assert.rejects(
      db.query(`select public.rpc_technician_start_work($1)`, [workOrderId]),
      /Erişim engellendi/
    );
  });
  await as(U.tech, async () => {
    await db.query(`select public.rpc_technician_start_work($1)`, [workOrderId]);
    await assert.rejects(
      db.query(`select public.rpc_technician_pause_work($1,'  ')`, [workOrderId]),
      /bekleme nedeni/
    );
    await db.query(`select public.rpc_technician_pause_work($1,'Malzeme bekleniyor')`, [workOrderId]);
    await db.query(`select public.rpc_technician_start_work($1)`, [workOrderId]);
    await db.query(
      `insert into public.work_order_materials (work_order_id, material_name, quantity, unit, recorded_by)
       values ($1,'LED Armatür',2,'Adet',$2)`,
      [workOrderId, U.tech]
    );
    await db.query(`select public.rpc_technician_complete_work($1,'Değiştirildi')`, [workOrderId]);
  });
  const t = await q(`select status, resolved_at from public.tickets where id=$1`, [ticketId]);
  assert.equal(t[0].status, 'resolved');
  assert.ok(t[0].resolved_at);
});

test('Teknisyen arızayı doğrudan kapatamaz; başka personel onaylayamaz; bildiren onaylar', async () => {
  await as(U.tech, async () => {
    await assert.rejects(
      db.query(`select public.rpc_manager_close_ticket($1,'ok',false)`, [ticketId]),
      /Erişim engellendi/
    );
  });
  await as(U.emp2, async () => {
    await assert.rejects(
      db.query(`select public.rpc_manager_close_ticket($1,'ok',false)`, [ticketId]),
      /Erişim engellendi/
    );
  });
  await as(U.emp, async () => {
    await db.query(`select public.rpc_manager_close_ticket($1,'Teşekkürler',false)`, [ticketId]);
  });
  const t = await q(`select status from public.tickets where id=$1`, [ticketId]);
  assert.equal(t[0].status, 'closed');
  const h = await q(`select count(*)::int c from public.status_history where ticket_id=$1`, [ticketId]);
  assert.ok(h[0].c >= 4);
});

test('Onay bekleyen 3 kayıt limiti: 4. arıza reddedilir', async () => {
  for (let i = 0; i < 3; i++) {
    await q(
      `insert into public.tickets (reporter_id, custom_location, custom_category, description, status)
       values ($1,'Otopark','Diğer','bekleyen ${i}','resolved')`,
      [U.emp2]
    );
  }
  await as(U.emp2, async () => {
    await assert.rejects(
      db.query(
        `insert into public.tickets (reporter_id, custom_location, custom_category, description)
         values ($1,'Otopark','Diğer','4. kayıt')`,
        [U.emp2]
      ),
      /Onayınızda bekleyen 3/
    );
  });
});

test('Bağımsız yetki: kullanıcı bazlı work_tracking.view kapatılınca teknisyen arıza göremez', async () => {
  await as(U.admin, async () => {
    await db.query(
      `select public.rpc_update_user_permissions($1, $2::jsonb)`,
      [U.tech, JSON.stringify({ modules: { work_tracking: { enabled: true, view: false } } })]
    );
  });
  await as(U.tech, async () => {
    assert.equal((await q(`select id from public.work_orders`)).length, 0);
  });
  // Aynı kullanıcının modül kapatılınca rpc_get_my_modules'ten de düşmesi
  await as(U.admin, async () => {
    await db.query(
      `select public.rpc_update_user_permissions($1, $2::jsonb)`,
      [U.tech, JSON.stringify({ modules: { work_tracking: { enabled: false } } })]
    );
  });
  await as(U.tech, async () => {
    const mods = (await q(`select key from public.rpc_get_my_modules()`)).map((r) => r.key);
    assert.deepEqual(mods, ['energy']);
  });
});

test('Yetki RPC: yalnızca system_admin izinleri değiştirebilir', async () => {
  await as(U.manager, async () => {
    await assert.rejects(
      db.query(`select public.rpc_update_user_permissions($1,'{}'::jsonb)`, [U.emp]),
      /Erişim engellendi/
    );
  });
});

test('Sistem modülü kapatılınca normal kullanıcıya gizlenir', async () => {
  await as(U.admin, async () => {
    await db.query(`select public.rpc_toggle_system_module('energy', false, false)`);
  });
  await as(U.manager, async () => {
    const mods = (await q(`select key from public.rpc_get_my_modules()`)).map((r) => r.key);
    assert.ok(!mods.includes('energy'));
  });
  await as(U.admin, async () => {
    await db.query(`select public.rpc_toggle_system_module('energy', true, false)`);
  });
});

test('Özet RPC (security invoker): RLS kullanıcıya göre uygulanır', async () => {
  await as(U.lead, async () => {
    const r = (await q(`select * from public.rpc_work_tracking_summary()`))[0];
    assert.ok(Number(r.total_open) >= 3);
    assert.ok(Number(r.awaiting_approval_count) >= 3);
  });
  await as(U.emp, async () => {
    const r = (await q(`select * from public.rpc_work_tracking_summary()`))[0];
    assert.equal(Number(r.total_open), 0);
  });
});

test('Bildirim: kullanıcı yalnızca is_read günceller, başkasınınkini göremez', async () => {
  await as(U.emp, async () => {
    const mine = await q(`select id from public.notifications`);
    assert.ok(mine.length >= 1);
    await assert.rejects(
      db.query(`update public.notifications set title='hack'`),
      /permission denied/
    );
    await db.query(`update public.notifications set is_read=true`);
  });
});

test('Mahal silinince geçmiş arıza etiketi korunur', async () => {
  const floor = (await q(`select id from public.floors where name='Zemin Kat'`))[0].id;
  const loc = (await q(`insert into public.locations (floor_id, name) values ($1,'Test Mağaza') returning id`, [floor]))[0].id;
  const t = (await q(
    `insert into public.tickets (reporter_id, location_id, custom_category, description)
     values ($1,$2,'Diğer','mahal testi') returning id`,
    [U.emp, loc]
  ))[0].id;
  await q(`delete from public.locations where id=$1`, [loc]);
  const row = (await q(`select location_id, custom_location from public.tickets where id=$1`, [t]))[0];
  assert.equal(row.location_id, null);
  assert.match(row.custom_location, /Test Mağaza/);
});

test('Storage: yalnızca kendi klasörüne yükleme; yetkisiz okuma reddedilir', async () => {
  await as(U.emp, async () => {
    await db.query(
      `insert into storage.objects (bucket_id, name) values ('work-attachments', $1)`,
      [`${U.emp}/${ticketId}/foto.jpg`]
    );
    await assert.rejects(
      db.query(`insert into storage.objects (bucket_id, name) values ('work-attachments', $1)`, [
        `${U.emp2}/x/foto.jpg`,
      ]),
      /row-level security/
    );
  });
});

// =====================================================================
// ENERJİ TAKİP MODÜLÜ TESTLERİ
// =====================================================================

let elecMeterId;
let mechMeterId;

test('Enerji: varsayılan sayaç kurulumu teknisyene yasak, yöneticiye açık ve idempotent', async () => {
  await as(U.tech, async () => {
    await assert.rejects(db.query(`select public.rpc_setup_default_meters()`), /Erişim engellendi/);
  });
  await as(U.manager, async () => {
    const r1 = await q(`select public.rpc_setup_default_meters() as c`);
    assert.equal(r1[0].c, 13);
    const r2 = await q(`select public.rpc_setup_default_meters() as c`);
    assert.equal(r2[0].c, 0);
  });
  const m = await q(`select id, meter_type, eic_code from public.meters where legacy_id='gt_adp_1'`);
  assert.equal(m[0].meter_type, 'electric');
  assert.equal(m[0].eic_code, '40Z000193592876I');
  elecMeterId = m[0].id;
  mechMeterId = (await q(`select id from public.meters where legacy_id='şebeke_suyu'`))[0].id;
});

test('Enerji: sayaç ortak equipments tablosuna bağlanabilir', async () => {
  await as(U.manager, async () => {
    await db.query(`update public.meters set equipment_id=$1, multiplier=10 where id=$2`, [
      equipmentId,
      elecMeterId,
    ]);
  });
  const row = (await q(`select equipment_id, multiplier from public.meters where id=$1`, [elecMeterId]))[0];
  assert.equal(row.equipment_id, equipmentId);
  assert.equal(Number(row.multiplier), 10);
});

test('Enerji: employee sayaç ve okumaları göremez; teknisyen görür ve okuma girebilir', async () => {
  await as(U.emp, async () => {
    assert.equal((await q(`select id from public.meters`)).length, 0);
    await assert.rejects(
      db.query(
        `select public.rpc_record_meter_reading($1, '2026-11-18T10:00:00+03:00', 100, 10, 5, null, null, false, null)`,
        [elecMeterId]
      ),
      /Erişim engellendi/
    );
  });

  await as(U.tech, async () => {
    const r1 = (
      await q(
        `select * from public.rpc_record_meter_reading($1, '2026-11-18T10:00:00+03:00', 1000, 100, 50, null, null, false, null)`,
        [elecMeterId]
      )
    )[0];
    assert.equal(Number(r1.consumption), 0);

    // Aynı gün tekrarı overwrite=false iken reddedilir
    await assert.rejects(
      db.query(
        `select * from public.rpc_record_meter_reading($1, '2026-11-18T14:00:00+03:00', 1010, 100, 50, null, null, false, null)`,
        [elecMeterId]
      ),
      /SAME_DAY_EXISTS/
    );
  });
});

test('Enerji: azalan endeks reddedilir; reaktif sınır aşımında çarpan hesabı ve bildirim çalışır', async () => {
  const notifBefore = (
    await q(`select count(*)::int c from public.notifications where module_key='energy'`)
  )[0].c;

  await as(U.tech, async () => {
    // Önceki gün 1000 iken 990 girilemez
    await assert.rejects(
      db.query(
        `select * from public.rpc_record_meter_reading($1, '2026-11-19T10:00:00+03:00', 990, 100, 50, null, null, false, null)`,
        [elecMeterId]
      ),
      /önceki okumadan küçük olamaz/
    );

    // Aktif +100, İndüktif +25 (%25 > %20 ceza!), Kapasitif +5 (%5), Çarpan 10 => tüketim 1000
    const mutId = '11111111-1111-4111-8111-111111111111';
    const r2 = (
      await q(
        `select * from public.rpc_record_meter_reading($1, '2026-11-19T10:00:00+03:00', 1100, 125, 55, null, 'Reaktif test', false, $2)`,
        [elecMeterId, mutId]
      )
    )[0];
    assert.equal(Number(r2.consumption), 1000);
    assert.equal(Number(r2.inductive_percent), 25);
    assert.equal(Number(r2.capacitive_percent), 5);

    // Idempotent client_mutation_id aynı kaydı döndürür
    const dup = (
      await q(
        `select * from public.rpc_record_meter_reading($1, '2026-11-19T10:00:00+03:00', 1100, 125, 55, null, null, false, $2)`,
        [elecMeterId, mutId]
      )
    )[0];
    assert.equal(dup.id, r2.id);

    // Mekanik sayaç okuması
    await q(
      `select * from public.rpc_record_meter_reading($1, '2026-11-18T10:00:00+03:00', null, null, null, 500, null, false, null)`,
      [mechMeterId]
    );
    const m2 = (
      await q(
        `select * from public.rpc_record_meter_reading($1, '2026-11-19T10:00:00+03:00', null, null, null, 540, null, false, null)`,
        [mechMeterId]
      )
    )[0];
    assert.equal(Number(m2.consumption), 40);
  });

  const notifAfter = (
    await q(`select count(*)::int c from public.notifications where module_key='energy' and entity_id=$1`, [
      elecMeterId,
    ])
  )[0].c;
  assert.ok(notifAfter > notifBefore);
});

test('Enerji: teknisyen okuma silemez/fatura giremez; yönetici fatura ve bütçe kaydedebilir', async () => {
  await as(U.tech, async () => {
    const d = await db.query(`delete from public.meter_readings where meter_id=$1`, [elecMeterId]);
    assert.equal(d.affectedRows, 0);
    await assert.rejects(
      db.query(
        `insert into public.energy_invoices (period_year, period_month, utility_type, provider, meter_id, meter_name, consumption, amount_tl, entered_by_name)
         values (2026, 11, 'electric', 'Aras Elektrik', $1, 'GT.ADP.1', 1000, 4500, 'Teknisyen Ali')`,
        [elecMeterId]
      ),
      /row-level security/
    );
  });

  await as(U.manager, async () => {
    await db.query(
      `insert into public.energy_invoices (period_year, period_month, utility_type, provider, meter_id, meter_name, consumption, amount_tl, inductive_penalty_tl, tenant_consumption, tenant_amount_tl, entered_by_id, entered_by_name)
       values (2026, 11, 'electric', 'Aras Elektrik', $1, 'GT.ADP.1', 1000, 4500, 350, 200, 900, $2, 'Teknik Müdür')`,
      [elecMeterId, U.manager]
    );
    await db.query(
      `insert into public.energy_budgets (period_year, period_month, utility_type, budget_consumption, budget_tl, prev_year_consumption, prev_year_tl, updated_by_id)
       values (2026, 11, 'electric', 950, 4200, 900, 3800, $1)`,
      [U.manager]
    );
  });
});

test('Enerji: rpc_energy_dashboard_summary tek sorguda özet ve ekipman bilgisi döndürür', async () => {
  await as(U.manager, async () => {
    const rows = await q(`select * from public.rpc_energy_dashboard_summary(2026, 11)`);
    assert.equal(rows.length, 13);
    const gt1 = rows.find((r) => r.meter_id === elecMeterId);
    assert.equal(Number(gt1.monthly_total_consumption), 1000);
    assert.equal(Number(gt1.latest_inductive_percent), 25);
    assert.equal(gt1.equipment_code, 'CHL-01');
  });

  // Yetkisiz employee için boş dönmeli (security invoker)
  await as(U.emp, async () => {
    const rows = await q(`select * from public.rpc_energy_dashboard_summary(2026, 11)`);
    assert.equal(rows.length, 0);
  });
});

// =====================================================================
// AŞAMA 5: VERİ AKTARIMI VE DOĞRULAMA TESTLERİ (Firebase -> Supabase)
// =====================================================================

test('Aşama 5: legacy yetki, kategori ve zaman damgası eşleme yardımcıları doğru çalışır', () => {
  const adminPerm = mapLegacyUserPermissions({
    role: 'admin',
    canEnterData: false,
    canAddMeter: false,
    canAccessInvoices: false,
  });
  assert.equal(adminPerm.enabled, true);
  assert.equal(adminPerm.manage, true);
  assert.equal(adminPerm.delete, true);
  assert.ok(adminPerm.actions.includes('reading_create'));
  assert.ok(adminPerm.actions.includes('invoice_access'));

  const fieldTechPerm = mapLegacyUserPermissions({
    role: 'personel',
    canEnterData: true,
    canAddMeter: false,
    canAccessInvoices: false,
  });
  assert.equal(fieldTechPerm.create, true);
  assert.equal(fieldTechPerm.edit, false);
  assert.equal(fieldTechPerm.delete, false);
  assert.equal(fieldTechPerm.manage, false);
  assert.equal(fieldTechPerm.reports, true);
  assert.deepEqual(fieldTechPerm.actions, ['reading_create', 'energy_export_reports']);

  assert.equal(inferLegacyCategory('electric', 'Ana Pano', null), 'electric');
  assert.equal(inferLegacyCategory('mechanical', 'Şebeke Suyu Sayaç', null), 'water');
  assert.equal(inferLegacyCategory('mechanical', 'Chiller-1 Soğutma', null), 'cooling');
  assert.equal(inferLegacyCategory('mechanical', 'Kazan Doğalgaz', null), 'gas');
  assert.equal(inferLegacyCategory('mechanical', 'Özel Sayaç', null), 'other');

  assert.equal(
    normalizeFirestoreTimestamp({ _seconds: 1763510400, _nanoseconds: 0 }),
    '2025-11-19T00:00:00.000Z'
  );
  assert.equal(
    normalizeFirestoreTimestamp({ timestampValue: '2026-01-18T09:15:00Z' }),
    '2026-01-18T09:15:00.000Z'
  );
});

test('Aşama 5: Firebase snapshot idempotent aktarılır, eski yetki/sahiplik korunur ve 7 doğrulama geçer', async () => {
  const stagingDb = new PGlite();
  await stagingDb.exec(BOOTSTRAP);
  for (const f of [
    'migrations/20261119000001_core_schema.sql',
    'migrations/20261119000002_core_auth_and_permissions.sql',
    'migrations/20261119000003_core_hardening.sql',
    'migrations/20261119000004_work_tracking.sql',
    'migrations/20261119000005_energy_tracking.sql',
    'migrations/20261119000006_security_and_performance.sql',
    'migrations/20261119000007_extensibility_and_equipment_360.sql',
    'migrations/20261121000011_meter_trash_bin.sql',
    'migrations/20261121000013_enforce_mechanical_index_only.sql',
    'seed.sql',
  ]) {
    await stagingDb.exec(readSql(f));
  }

  const STG_ADMIN = '10000000-0000-0000-0000-000000000001';
  const STG_TECH = '10000000-0000-0000-0000-000000000002';

  await stagingDb.query(
    `insert into auth.users (id, email) values ($1, 'talip@avm.local'), ($2, 'mehmet@avm.local')`,
    [STG_ADMIN, STG_TECH]
  );

  // Mevcut work_tracking yetkilerinin aktarim sirasinda korunacagini test et
  // (auth.users insert trigger'i profiles satirini otomatik olusturur)
  await stagingDb.query(
    `update public.profiles
     set full_name = 'Talip Yönetici', role = 'technical_manager', approval_status = 'approved', permissions = $2::jsonb
     where id = $1`,
    [
      STG_ADMIN,
      JSON.stringify({
        modules: { work_tracking: { enabled: true, view: true, manage: true, actions: ['work_order_review'] } },
        core_actions: ['manage_users'],
      }),
    ]
  );
  await stagingDb.query(
    `update public.profiles
     set full_name = 'Mehmet Teknisyen', role = 'technician', approval_status = 'approved', permissions = $2::jsonb
     where id = $1`,
    [
      STG_TECH,
      JSON.stringify({
        modules: { work_tracking: { enabled: true, view: true, create: true, actions: ['work_order_execute'] } },
        core_actions: [],
      }),
    ]
  );

  const snapshot = {
    schemaVersion: '1.0.0',
    sourceProjectId: 'sayac-takip-avm-2026',
    exportedAt: '2026-11-19T12:00:00.000Z',
    users: [
      {
        uid: 'fb_uid_talip',
        name: 'talip',
        role: 'admin',
        canEnterData: true,
        canAddMeter: true,
        canAccessInvoices: true,
      },
      {
        uid: 'fb_uid_mehmet',
        name: 'mehmet',
        role: 'personel',
        canEnterData: true,
        canAddMeter: false,
        canAccessInvoices: false,
      },
      {
        uid: 'fb_uid_deleted',
        name: 'Eski Teknisyen Hasan',
        role: 'personel',
        canEnterData: true,
        canAddMeter: false,
        canAccessInvoices: false,
      },
    ],
    meters: [
      {
        id: 'gt_adp_1',
        name: 'GT.ADP.1',
        type: 'electric',
        multiplier: 1600,
        orderIndex: 1,
        meterNo: 'ELK-001',
        contractNo: 'SOZ-901',
        eicCode: '40Z000193592876I',
        tekilCode: '11223344',
        region: 'OG Odası',
      },
      {
        id: 'sebeke_su',
        name: 'Şebeke Suyu Ana Sayaç',
        type: 'mechanical',
        multiplier: 1,
        orderIndex: 2,
        subscriberNo: 'AB-4455',
        region: 'Bodrum -2',
      },
      {
        id: 'chiller_1',
        name: 'Chiller-1 Soğutma',
        type: 'mechanical',
        multiplier: 1,
        orderIndex: 3,
      },
    ],
    readingsByMeter: {
      gt_adp_1: [
        {
          id: 'r1',
          meterId: 'gt_adp_1',
          date: { _seconds: 1763424000, _nanoseconds: 0 },
          active: 100.5,
          inductive: 10.2,
          capacitive: 2.1,
          indPercent: 10.15,
          capPercent: 2.09,
          consumption: 1240.5,
          enteredBy: 'talip',
        },
        {
          id: 'r2',
          meterId: 'gt_adp_1',
          date: { _seconds: 1763510400, _nanoseconds: 0 },
          active: 101.319,
          inductive: 10.4,
          capacitive: 2.15,
          indPercent: 24.42,
          capPercent: 6.1,
          consumption: 1310.25,
          enteredBy: 'Eski Teknisyen Hasan',
        },
      ],
      sebeke_su: [
        {
          id: 'w1',
          meterId: 'sebeke_su',
          date: '2026-01-10T08:00:00Z',
          index: 500,
          consumption: 85.125,
          enteredBy: 'mehmet1',
        },
        {
          id: 'w2',
          meterId: 'sebeke_su',
          date: '2026-01-11T08:00:00Z',
          index: 592.375,
          consumption: 92.375,
          enteredBy: 'Silinmiş Ahmet',
        },
      ],
      chiller_1: [],
    },
    invoices: [
      {
        id: 'inv_2025_11_elec',
        year: 2025,
        month: 11,
        utilityType: 'electric',
        provider: 'CK Enerji',
        invoiceNo: 'FTR-2025-11',
        invoiceDate: { _seconds: 1763164800, _nanoseconds: 0 },
        invoiceType: 'normal',
        meterId: 'gt_adp_1',
        meterName: 'GT.ADP.1',
        eicCode: '40Z000193592876I',
        consumption: 2550.75,
        amountTL: 12450.5,
        inductivePenaltyTL: 320.25,
        capacitivePenaltyTL: 0,
        tenantConsumption: 550.75,
        tenantAmountTL: 2450.5,
        enteredBy: 'talip',
        createdAt: { _seconds: 1763251200, _nanoseconds: 0 },
      },
      {
        id: 'inv_2026_01_water',
        year: 2026,
        month: 1,
        utilityType: 'water',
        provider: 'İSKİ',
        invoiceDate: '2026-01-15T00:00:00Z',
        invoiceType: 'late_fee',
        meterId: 'sebeke_su',
        meterName: 'Şebeke Suyu Ana Sayaç',
        consumption: 177.5,
        amountTL: 4120.8,
        enteredBy: 'Eski Teknisyen Hasan',
        createdAt: '2026-01-18T09:15:00Z',
      },
    ],
    budgets: [
      {
        id: '2025_11_electric',
        year: 2025,
        month: 11,
        utilityType: 'electric',
        budgetConsumption: 2500,
        budgetTL: 12000,
        prevYearConsumption: 2400,
        prevYearTL: 10500,
      },
      {
        id: '2026_01_water',
        year: 2026,
        month: 1,
        utilityType: 'water',
        budgetConsumption: 180,
        budgetTL: 4000,
        prevYearConsumption: 165,
        prevYearTL: 3200,
      },
    ],
  };

  const userMapping = {
    mappings: [
      {
        legacy_firebase_uid: 'fb_uid_talip',
        legacy_username: 'talip',
        legacy_email: 'talip@sayacavm.com',
        legacy_name: 'talip',
        target_profile_id: STG_ADMIN,
      },
      {
        legacy_firebase_uid: 'fb_uid_mehmet',
        legacy_username: 'mehmet',
        legacy_email: 'mehmet1@sayacavm.com',
        legacy_name: 'mehmet',
        target_profile_id: STG_TECH,
      },
      {
        legacy_firebase_uid: 'fb_uid_deleted',
        legacy_username: 'eski',
        legacy_name: 'Eski Teknisyen Hasan',
        target_profile_id: null,
      },
    ],
    aliases: {
      byEnteredByName: {
        mehmet1: STG_TECH,
      },
    },
  };

  const snapMetrics = computeSnapshotMetrics(snapshot);
  assert.equal(snapMetrics.counts.meters, 3);
  assert.equal(snapMetrics.counts.readings, 4);
  assert.equal(snapMetrics.counts.invoices, 2);
  assert.equal(snapMetrics.counts.budgets, 2);

  // İlk aktarım
  const res1 = await runMigrationWithDb(stagingDb, snapshot, userMapping);
  assert.equal(res1.profilesUpdated, 2);
  assert.equal(res1.unmatchedUsers.length, 1);
  assert.equal(res1.metersUpserted, 3);
  assert.equal(res1.readingsUpserted, 4);
  assert.equal(res1.invoicesUpserted, 2);
  assert.equal(res1.budgetsUpserted, 2);

  // İkinci aktarım (idempotent: mükerrer kayıt oluşturmamalı)
  const res2 = await runMigrationWithDb(stagingDb, snapshot, userMapping);
  assert.equal(res2.metersUpserted, 3);
  assert.equal(res2.readingsUpserted, 4);

  const countRows = (
    await stagingDb.query(`
      select
        (select count(*)::int from public.meters) as meters_cnt,
        (select count(*)::int from public.meter_readings) as readings_cnt,
        (select count(*)::int from public.energy_invoices) as invoices_cnt,
        (select count(*)::int from public.energy_budgets) as budgets_cnt
    `)
  ).rows[0];
  assert.equal(countRows.meters_cnt, 3);
  assert.equal(countRows.readings_cnt, 4);
  assert.equal(countRows.invoices_cnt, 2);
  assert.equal(countRows.budgets_cnt, 2);

  // Kardeş modül (work_tracking) ve core_actions yetkilerinin ezilmediğini doğrula
  const adminProf = (
    await stagingDb.query(`select legacy_firebase_uid, permissions from public.profiles where id=$1`, [STG_ADMIN])
  ).rows[0];
  assert.equal(adminProf.legacy_firebase_uid, 'fb_uid_talip');
  assert.equal(adminProf.permissions.modules.work_tracking.manage, true);
  assert.equal(adminProf.permissions.modules.energy.manage, true);
  assert.deepEqual(adminProf.permissions.core_actions, ['manage_users']);

  // Silinmiş kullanıcı okumasının sahiplik adı korunup ID'sinin NULL kaldığını doğrula
  const deletedReading = (
    await stagingDb.query(
      `select entered_by_id, entered_by_name from public.meter_readings where legacy_id='gt_adp_1::r2'`
    )
  ).rows[0];
  assert.equal(deletedReading.entered_by_id, null);
  assert.equal(deletedReading.entered_by_name, 'Eski Teknisyen Hasan');

  // Fatura kiracı/ceza ve orijinal created_at korumasını doğrula
  const migratedInv = (
    await stagingDb.query(
      `select inductive_penalty_tl, tenant_amount_tl, created_at from public.energy_invoices where legacy_id='inv_2025_11_elec'`
    )
  ).rows[0];
  assert.equal(Number(migratedInv.inductive_penalty_tl), 320.25);
  assert.equal(Number(migratedInv.tenant_amount_tl), 2450.5);
  assert.equal(Date.parse(migratedInv.created_at), 1763251200 * 1000);

  // 7 adımlı bütünlük doğrulaması %100 geçmeli
  const report = await verifyMigrationWithDb(stagingDb, snapshot, userMapping);
  assert.equal(report.passed, true, `Doğrulama hataları: ${report.errors.join('; ')}`);
  assert.equal(report.passedChecks, 7);
});

// =====================================================================
// AŞAMA 6: GÜVENLİK (RLS MATRİSİ), OFFLINE RPC VE PERFORMANS TESTLERİ
// =====================================================================

test('Aşama 6 Güvenlik: disabled/rejected hesap tüm modüllerden kesilir; bağımsız özel yetkiler RLS ve Storage üzerinde işler', async () => {
  // Pending kullanıcıya ayrıca disabled testi (geçici hesap oluşturup disabled yap)
  const U_DISABLED = '00000000-0000-0000-0000-0000000000d1';
  await db.query(`insert into auth.users (id, email) values ($1, 'disabled@avm.local')`, [U_DISABLED]);
  await as(U.admin, async () => {
    await db.query(`select public.rpc_approve_user($1, 'employee', null)`, [U_DISABLED]);
    await db.query(`select public.rpc_set_user_approval_status($1, 'disabled')`, [U_DISABLED]);
  });

  await as(U_DISABLED, async () => {
    assert.equal((await q(`select * from public.rpc_get_my_modules()`)).length, 0);
    assert.equal((await q(`select id from public.equipments`)).length, 0);
    assert.equal((await q(`select id from public.tickets`)).length, 0);
    assert.equal((await q(`select id from public.meters`)).length, 0);
  });

  // Employee'ye yalnızca energy.view + energy.create açılır; okuma girebilir ancak fatura/sayaç yönetemez
  await as(U.admin, async () => {
    await db.query(`select public.rpc_update_user_permissions($1, $2::jsonb)`, [
      U.emp2,
      JSON.stringify({
        modules: {
          energy: { enabled: true, view: true, create: true, edit: false, delete: false, approve: false, reports: false, manage: false },
        },
      }),
    ]);
    // Teknisyene yalnızca ortak ekipman ekleme çekirdek aksiyonu tanımlanır; modül yönetimi hâlâ yasaktır
    await db.query(`select public.rpc_update_user_permissions($1, $2::jsonb)`, [
      U.tech,
      JSON.stringify({
        core_actions: ['manage_equipments'],
      }),
    ]);
  });

  await as(U.emp2, async () => {
    assert.ok((await q(`select id from public.meters`)).length >= 13);
    const r = (
      await q(
        `select * from public.rpc_record_meter_reading($1, '2026-11-21T10:00:00+03:00', null, null, null, 600, 'Özel yetki testi', false, null)`,
        [mechMeterId]
      )
    )[0];
    assert.equal(Number(r.index_value), 600);
    // energy.manage kapalı olduğundan fatura ekleyemez
    await assert.rejects(
      db.query(
        `insert into public.energy_invoices (period_year, period_month, utility_type, provider, meter_id, meter_name, consumption, amount_tl, entered_by_name)
         values (2026, 11, 'water', 'İSKİ', $1, 'Şebeke Suyu', 60, 900, 'Emp2')`,
        [mechMeterId]
      ),
      /row-level security/
    );
  });

  // Teknisyen core_actions=['manage_equipments'] ile ekipman ekleyebilir, ancak system_modules yönetemez
  await as(U.tech, async () => {
    const eqRow = (
      await q(
        `insert into public.equipments (code, name, equipment_type) values ('JNR-01', 'Ana Jeneratör', 'generator') returning id, code`
      )
    )[0];
    assert.equal(eqRow.code, 'JNR-01');
    await assert.rejects(
      db.query(`select public.rpc_toggle_system_module('energy', false)`),
      /Erişim engellendi/
    );
  });

  // Storage: employee energy-documents okuyamaz ve yükleyemez; technician yükleyemez; manager yükleyebilir
  await as(U.emp, async () => {
    await assert.rejects(
      db.query(`insert into storage.objects (bucket_id, name, owner) values ('energy-documents', '2026/fatura.pdf', $1)`, [U.emp]),
      /row-level security/
    );
    assert.equal((await q(`select id from storage.objects where bucket_id='energy-documents'`)).length, 0);
  });

  await as(U.tech, async () => {
    await assert.rejects(
      db.query(`insert into storage.objects (bucket_id, name, owner) values ('energy-documents', '2026/fatura_tech.pdf', $1)`, [U.tech]),
      /row-level security/
    );
  });

  await as(U.manager, async () => {
    const obj = (
      await q(
        `insert into storage.objects (bucket_id, name, owner) values ('energy-documents', '2026/fatura_mgr.pdf', $1) returning id, name`,
        [U.manager]
      )
    )[0];
    assert.equal(obj.name, '2026/fatura_mgr.pdf');
    assert.ok((await q(`select id from storage.objects where bucket_id='energy-documents'`)).length >= 1);
  });

  // İzinleri varsayılana temizle
  await as(U.admin, async () => {
    await db.query(`select public.rpc_update_user_permissions($1, '{}'::jsonb)`, [U.emp2]);
    await db.query(`select public.rpc_update_user_permissions($1, '{}'::jsonb)`, [U.tech]);
  });
});

test('Aşama 6 Offline RPC: rpc_sync_offline_ticket idempotent çalışır ve fotoğrafları atomik bağlar', async () => {
  const mutId = '22222222-2222-4222-8222-222222222222';
  const attachments = [
    { file_path: `${U.emp}/offline/photo_1.jpg`, file_name: 'photo_1.jpg', mime_type: 'image/jpeg', attachment_type: 'before' },
    { file_path: `${U.emp}/offline/photo_2.jpg`, file_name: 'photo_2.jpg', mime_type: 'image/jpeg', attachment_type: 'before' },
  ];

  let ticketId1;
  await as(U.emp, async () => {
    const t1 = (
      await q(
        `select * from public.rpc_sync_offline_ticket($1, null, 'Otopark -3', null, 'Aydınlatma', $2, 'priority', 'Otopark lamba arızası (offline)', $3::jsonb)`,
        [mutId, equipmentId, JSON.stringify(attachments)]
      )
    )[0];
    ticketId1 = t1.id;
    assert.equal(t1.client_mutation_id, mutId);

    // Aynı client_mutation_id ile ikinci kez senkronize edilirse mükerrer arıza veya fotoğraf oluşmamalı
    const t2 = (
      await q(
        `select * from public.rpc_sync_offline_ticket($1, null, 'Otopark -3', null, 'Aydınlatma', $2, 'priority', 'Otopark lamba arızası (offline)', $3::jsonb)`,
        [mutId, equipmentId, JSON.stringify(attachments)]
      )
    )[0];
    assert.equal(t2.id, ticketId1);
  });

  const attCount = (
    await q(`select count(*)::int as c from public.attachments where ticket_id=$1`, [ticketId1])
  )[0].c;
  assert.equal(attCount, 2);

  // Başka kullanıcı aynı client_mutation_id ile yetkisiz erişemez
  await as(U.emp2, async () => {
    await assert.rejects(
      db.query(
        `select * from public.rpc_sync_offline_ticket($1, null, 'B1', null, 'Elektrik', null, 'normal', 'Test', '[]'::jsonb)`,
        [mutId]
      ),
      /Erişim engellendi/
    );
  });
});

test('Aşama 6 Offline RPC: rpc_sync_offline_work_order_status çakışmayı yakalar ve force_overwrite ile çözer', async () => {
  const deptId = (await q(`select id from public.departments limit 1`))[0].id;
  let ticketId;
  let woId;
  let staleTimestamp;

  await as(U.emp, async () => {
    ticketId = (
      await q(
        `insert into public.tickets (reporter_id, custom_location, custom_category, priority, description)
         values ($1, 'Çatı Katı', 'Mekanik', 'normal', 'Offline çakışma testi') returning id`,
        [U.emp]
      )
    )[0].id;
  });

  await as(U.lead, async () => {
    woId = (await q(`select public.rpc_create_work_order($1, $2, array[$3]::uuid[], 'Kontrol et') as id`, [ticketId, deptId, U.tech]))[0].id;
    // İş emrini önce assigned zamanını baz alalım ve sunucuda ileriye taşıyalım
    staleTimestamp = (await q(`select updated_at from public.work_orders where id=$1`, [woId]))[0].updated_at;
    await db.query(
      `update public.work_orders set status='in_progress', updated_at = $2::timestamptz + interval '10 minutes' where id=$1`,
      [woId, staleTimestamp]
    );
  });

  // Atanmamış kullanıcı offline iş emri güncelleyemez
  await as(U.emp, async () => {
    await assert.rejects(
      db.query(`select * from public.rpc_sync_offline_work_order_status($1, 'waiting', $2, 'Malzeme', null, false)`, [woId, staleTimestamp]),
      /Erişim engellendi/
    );
  });

  // Atanmış teknisyen eski base_updated_at ile 'waiting' gönderirse conflict dönmeli
  await as(U.tech, async () => {
    const resConflict = (
      await q(
        `select * from public.rpc_sync_offline_work_order_status($1, 'waiting', $2, 'Yedek parça bekliyor', null, false)`,
        [woId, staleTimestamp]
      )
    )[0];
    assert.equal(resConflict.sync_result, 'conflict');
    assert.equal(resConflict.server_status, 'in_progress');

    // Kullanıcı reapplyLocal (p_force_overwrite = true) seçtiğinde güncelleme uygulanmalı
    const resForce = (
      await q(
        `select * from public.rpc_sync_offline_work_order_status($1, 'waiting', $2, 'Yedek parça bekliyor', null, true)`,
        [woId, staleTimestamp]
      )
    )[0];
    assert.equal(resForce.sync_result, 'synced');
    assert.equal(resForce.server_status, 'waiting');
  });
});

test('Aşama 6 Performans & Sayfalama: zorunlu indeksler mevcut ve sayfalamalı RPC\'ler RLS ile doğru dilimler döndürür', async () => {
  const requiredIndexes = [
    'idx_profiles_approval_role',
    'idx_notifications_user_unread',
    'idx_equipments_type_status',
    'idx_tickets_status_priority_created',
    'idx_tickets_reporter_status',
    'idx_tickets_equipment',
    'idx_work_orders_created',
    'idx_meter_readings_meter_date',
    'idx_energy_invoices_period',
    'idx_energy_invoices_meter',
  ];
  const existingIdxRows = await q(
    `select indexname from pg_indexes where schemaname='public' and indexname = any($1::text[])`,
    [requiredIndexes]
  );
  const existingSet = new Set(existingIdxRows.map((r) => r.indexname));
  for (const idxName of requiredIndexes) {
    assert.ok(existingSet.has(idxName), `Eksik performans indeksi: ${idxName}`);
  }

  // Ticket sayfalama & SECURITY INVOKER izolasyonu
  let totalAll = 0;
  await as(U.lead, async () => {
    const p1 = await q(`select * from public.rpc_list_tickets_paginated(null, null, null, null, 2, 0)`);
    assert.equal(p1.length, 2);
    totalAll = Number(p1[0].total_count);
    assert.ok(totalAll >= 3);
    const p2 = await q(`select * from public.rpc_list_tickets_paginated(null, null, null, null, 2, 2)`);
    assert.ok(p2.length >= 1);
    assert.notEqual(p1[0].id, p2[0].id);
    assert.notEqual(p1[1].id, p2[0].id);
  });

  // emp yalnızca kendi açtığı arızaları görebilmeli
  await as(U.emp, async () => {
    const empTickets = await q(`select * from public.rpc_list_tickets_paginated(null, null, null, null, 50, 0)`);
    assert.ok(empTickets.every((t) => t.reporter_id === U.emp));
    assert.ok(empTickets.length < totalAll);
    // Yetkisiz employee enerji sayfalama RPC'sinden boş dönmeli
    const noReadings = await q(`select * from public.rpc_list_meter_readings_paginated(null, null, null, 10, 0)`);
    assert.equal(noReadings.length, 0);
  });

  await as(U.manager, async () => {
    const rPage = await q(`select * from public.rpc_list_meter_readings_paginated($1, null, null, 1, 0)`, [mechMeterId]);
    assert.equal(rPage.length, 1);
    assert.ok(Number(rPage[0].total_count) >= 2);
    const invPage = await q(`select * from public.rpc_list_energy_invoices_paginated(2026, 'electric', 10, 0)`);
    assert.ok(invPage.length >= 1);
  });
});

// =====================================================================
// AŞAMA 7: YENİ MODÜLLERE HAZIRLIK VE ORTAK EKİPMAN 360° DOĞRULAMASI
// =====================================================================

test('Aşama 7: Planlı Bakım (maintenance) çekirdeği değiştirmeden aktifleşir ve merkezi RLS izinleriyle çalışır', async () => {
  // Başlangıçta is_coming_soon = true, is_enabled = false iken technical_manager görmemeli
  await as(U.manager, async () => {
    const mods = await q(`select key from public.rpc_get_my_modules()`);
    assert.ok(!mods.some((m) => m.key === 'maintenance'));
    assert.equal((await q(`select id from public.maintenance_plans`)).length, 0);
  });

  // system_admin mevcut modülleri bozmadan maintenance modülünü aktifleştirir
  await as(U.admin, async () => {
    await db.query(`select public.rpc_toggle_system_module('maintenance', true, false)`);
    await db.query(
      `insert into public.maintenance_plans (equipment_id, title, frequency, next_due_date, status, created_by)
       values ($1, 'Chiller Aylık Kondenser Bakımı', 'monthly', '2026-12-01', 'scheduled', $2)`,
      [equipmentId, U.admin]
    );
  });

  // Modül açılınca technical_manager varsayılan olarak görüntüleyebilir, ancak create/manage yoksa ekleyemez
  await as(U.manager, async () => {
    const mods = await q(`select key from public.rpc_get_my_modules()`);
    assert.ok(mods.some((m) => m.key === 'maintenance'));
    const plans = await q(`select title, equipment_id from public.maintenance_plans`);
    assert.equal(plans.length, 1);
    assert.equal(plans[0].equipment_id, equipmentId);

    await assert.rejects(
      db.query(
        `insert into public.maintenance_plans (equipment_id, title, frequency, next_due_date)
         values ($1, 'Yetkisiz Plan', 'weekly', '2026-11-25')`,
        [equipmentId]
      ),
      /row-level security/
    );
  });

  // Teknisyene yalnızca maintenance.create verilince ekleme yapabilir, silme yapamaz
  await as(U.admin, async () => {
    await db.query(`select public.rpc_update_user_permissions($1, $2::jsonb)`, [
      U.tech,
      JSON.stringify({
        modules: {
          maintenance: { enabled: true, view: true, create: true, edit: false, delete: false },
        },
      }),
    ]);
  });

  await as(U.tech, async () => {
    const p = (
      await q(
        `insert into public.maintenance_plans (equipment_id, title, frequency, next_due_date, created_by)
         values ($1, 'Haftalık Yağ Seviye Kontrolü', 'weekly', '2026-11-24', $2) returning id`,
        [equipmentId, U.tech]
      )
    )[0];
    assert.ok(p.id);
    const d = await db.query(`delete from public.maintenance_plans where id=$1`, [p.id]);
    assert.equal(d.affectedRows, 0);
  });
});

test('Aşama 7: Ortak equipments tablosu üzerinden sayaç + arıza + bakım 360° özet RLS ile doğrulanır', async () => {
  await as(U.manager, async () => {
    const summary = (await q(`select * from public.rpc_get_equipment_360_summary($1)`, [equipmentId]))[0];
    assert.equal(summary.equipment_code, 'CHL-01');
    assert.equal(Number(summary.linked_meters_count), 1);
    assert.equal(Number(summary.total_energy_consumption), 1000);
    assert.ok(Number(summary.total_tickets_count) >= 1);
    assert.equal(Number(summary.maintenance_plans_count), 2);
    assert.equal(Number(summary.due_maintenance_count), 2);
  });

  // Enerji ve Planlı Bakım yetkisi olmayan employee aynı ekipman 360 özetinde bu alanları 0 görür
  await as(U.emp, async () => {
    const summary = (await q(`select * from public.rpc_get_equipment_360_summary($1)`, [equipmentId]))[0];
    assert.equal(summary.equipment_code, 'CHL-01');
    assert.equal(Number(summary.linked_meters_count), 0);
    assert.equal(Number(summary.total_energy_consumption), 0);
    assert.equal(Number(summary.maintenance_plans_count), 0);
    assert.ok(Number(summary.total_tickets_count) >= 1);
  });

  // Temizlik: maintenance izinlerini ve modül durumunu başlangıç 'yakında' haline döndür
  await as(U.admin, async () => {
    await db.query(`select public.rpc_update_user_permissions($1, '{}'::jsonb)`, [U.tech]);
    await db.query(`select public.rpc_toggle_system_module('maintenance', false, true)`);
  });
});

test('Enerji Çöp Kutusu: yalnızca Admin silebilir/geri yükleyebilir; 1 ayı dolanlar otomatik kalıcı silinir', async () => {
  // Admin dışı roller (technical_manager, technician, employee) silme veya çöp kutusunu kullanamaz
  for (const uid of [U.manager, U.tech, U.emp]) {
    await as(uid, async () => {
      await assert.rejects(
        db.query(`select public.rpc_soft_delete_meter($1)`, [mechMeterId]),
        /Erişim engellendi/
      );
      await assert.rejects(
        db.query(`select * from public.rpc_list_trashed_meters()`),
        /Erişim engellendi/
      );
      await assert.rejects(
        db.query(`select public.rpc_restore_meter($1)`, [mechMeterId]),
        /Erişim engellendi/
      );
      await assert.rejects(
        db.query(`select public.rpc_permanently_delete_meter($1)`, [mechMeterId]),
        /Erişim engellendi/
      );
      const directDel = await db.query(`delete from public.meters where id=$1`, [mechMeterId]);
      assert.equal(directDel.affectedRows, 0);
    });
  }

  // Admin sayacı çöp kutusuna taşır: aktif özetlerden düşer, okumalar korunur
  await as(U.admin, async () => {
    const softDel = (await q(`select * from public.rpc_soft_delete_meter($1)`, [mechMeterId]))[0];
    assert.equal(softDel.is_active, false);
    assert.ok(softDel.deleted_at);

    const trashed = await q(`select * from public.rpc_list_trashed_meters()`);
    const item = trashed.find((t) => t.id === mechMeterId);
    assert.ok(item);
    assert.ok(Number(item.readings_count) >= 2);
    assert.ok(item.purge_at);
  });

  await as(U.manager, async () => {
    const activeSummary = await q(`select meter_id from public.rpc_energy_dashboard_summary(2026, 11)`);
    assert.ok(!activeSummary.some((r) => r.meter_id === mechMeterId));
    assert.equal((await q(`select id from public.meters where id=$1`, [mechMeterId])).length, 0);
  });

  await as(U.tech, async () => {
    await assert.rejects(
      db.query(
        `select public.rpc_record_meter_reading($1, '2026-11-20T10:00:00+03:00', null, null, null, 600, null, false, null)`,
        [mechMeterId]
      ),
      /bulunamadı veya pasif/
    );
  });

  // Admin geri yükler: sayaç ve tüm okumaları tekrar aktif olur
  await as(U.admin, async () => {
    const restored = (await q(`select * from public.rpc_restore_meter($1)`, [mechMeterId]))[0];
    assert.equal(restored.is_active, true);
    assert.equal(restored.deleted_at, null);
  });

  await as(U.manager, async () => {
    const activeSummary = await q(`select meter_id from public.rpc_energy_dashboard_summary(2026, 11)`);
    assert.ok(activeSummary.some((r) => r.meter_id === mechMeterId));
  });

  // Tekrar çöp kutusuna atıp 1 aylık saklama süresini aşınca otomatik kalıcı silinir
  await as(U.admin, async () => {
    await q(`select public.rpc_soft_delete_meter($1)`, [mechMeterId]);
  });
  await db.query(
    `update public.meters set deleted_at = now() - interval '1 month' - interval '1 day' where id=$1`,
    [mechMeterId]
  );
  await as(U.admin, async () => {
    const remainingTrash = await q(`select * from public.rpc_list_trashed_meters()`);
    assert.ok(!remainingTrash.some((t) => t.id === mechMeterId));
  });

  const goneMeter = await q(`select id from public.meters where id=$1`, [mechMeterId]);
  const goneReadings = await q(`select id from public.meter_readings where meter_id=$1`, [mechMeterId]);
  assert.equal(goneMeter.length, 0);
  assert.equal(goneReadings.length, 0);
});

test('Mekanik sayaçlarda yalnızca endeks okunabilir; aktif/indüktif/kapasitif ve reaktif ceza yalnızca elektriktedir', async () => {
  let gasMeterId;
  await as(U.admin, async () => {
    const m = (
      await q(
        `insert into public.meters (name, meter_type, category, multiplier)
         values ('Kazan Doğalgaz Test', 'mechanical', 'gas', 1) returning id`
      )
    )[0];
    gasMeterId = m.id;

    // Elektrik sayaçta kategori uyuşmazlığı reddedilmeli
    await assert.rejects(
      db.query(
        `insert into public.meters (name, meter_type, category, multiplier)
         values ('Hatalı Sayaç', 'mechanical', 'electric', 1)`
      ),
      /meters_type_category_consistency_chk/
    );

    // Su / doğalgaz faturasına reaktif ceza yazımı reddedilmeli
    await assert.rejects(
      db.query(
        `insert into public.energy_invoices (period_year, period_month, utility_type, provider, meter_name, consumption, amount_tl, inductive_penalty_tl, entered_by_id, entered_by_name)
         values (2026, 11, 'gas', 'İGDAŞ', 'Kazan Doğalgaz Test', 500, 3000, 120, $1, 'Admin Kullanıcı')`,
        [U.admin]
      ),
      /energy_invoices_reactive_electric_only_chk/
    );
  });

  await as(U.tech, async () => {
    // Mekanik sayaca aktif/indüktif/kapasitif parametreleri gönderilirse RPC reddetmeli
    await assert.rejects(
      db.query(
        `select public.rpc_record_meter_reading($1, '2026-11-20T10:00:00+03:00', 378, 10, 5, 378, null, false, null)`,
        [gasMeterId]
      ),
      /yalnızca endeks girilebilir/
    );

    // Doğrudan INSERT ile mekanik sayaca active_value yazılmaya çalışılırsa trigger reddetmeli
    await assert.rejects(
      db.query(
        `insert into public.meter_readings (meter_id, reading_date, active_value, index_value, consumption, entered_by_id, entered_by_name)
         values ($1, '2026-11-20T10:00:00+03:00', 100, 378, 0, $2, 'Teknisyen Ali')`,
        [gasMeterId, U.tech]
      ),
      /yalnızca endeks okunabilir/
    );

    // Elektrik sayacına mekanik p_index_value gönderilirse RPC reddetmeli
    await assert.rejects(
      db.query(
        `select public.rpc_record_meter_reading($1, '2026-11-22T10:00:00+03:00', 1200, 130, 60, 999, null, false, null)`,
        [elecMeterId]
      ),
      /mekanik endeks alanı kullanılamaz/
    );

    // Mekanik sayaçta yalnızca endeks ile iki ardışık okuma temiz kaydedilir; tüm elektrik alanları null olur
    const r1 = (
      await q(
        `select * from public.rpc_record_meter_reading($1, '2026-11-18T10:00:00+03:00', null, null, null, 378.085, null, false, null)`,
        [gasMeterId]
      )
    )[0];
    assert.equal(Number(r1.index_value), 378.085);
    assert.equal(r1.active_value, null);
    assert.equal(r1.inductive_value, null);
    assert.equal(r1.capacitive_value, null);
    assert.equal(r1.inductive_percent, null);
    assert.equal(r1.capacitive_percent, null);

    const r2 = (
      await q(
        `select * from public.rpc_record_meter_reading($1, '2026-11-19T10:00:00+03:00', null, null, null, 378.122, null, false, null)`,
        [gasMeterId]
      )
    )[0];
    assert.equal(Number(r2.consumption), 0.037);
    assert.equal(r2.active_value, null);
    assert.equal(r2.inductive_percent, null);
    assert.equal(r2.capacitive_percent, null);
  });

  await as(U.manager, async () => {
    const sum = await q(`select * from public.rpc_energy_dashboard_summary(2026, 11) where meter_id=$1`, [gasMeterId]);
    assert.equal(sum.length, 1);
    assert.equal(sum[0].latest_inductive_percent, null);
    assert.equal(sum[0].latest_capacitive_percent, null);
  });
});

#!/usr/bin/env node
/**
 * AVM TECH - Firebase -> Supabase Veri Butunlugu Dogrulama Scripti
 *
 * MIGRATION.md Faz 4'te tanimlanan 7 dogrulama maddesini otomatik olarak kontrol eder:
 *   1. Sayac sayisi (Firestore == PostgreSQL)
 *   2. Okuma sayisi (sayac bazli birebir eslesme)
 *   3. Tuketim toplami (sayac bazli fark < 0.001)
 *   4. Tarih araligi (sayac bazli MIN/MAX tarih birebir eslesme)
 *   5. Fatura sayisi ve TL toplamları (yil ve tur bazli birebir eslesme)
 *   6. Butce kayitlari ve TL toplamlari (yil ve tur bazli birebir eslesme)
 *   7. Kullanici eslestirmesi, tarihsel sahiplik (entered_by_name) ve yetki/RLS dogrulamasi
 *
 * Kullanim:
 *   node verify_migration.mjs --snapshot ../../backups/firestore_export.json --mapping ./user_mapping.json --database-url "$DATABASE_URL"
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { computeSnapshotMetrics } from './export_firestore.mjs';
import {
  mapLegacyUserPermissions,
  normalizeUtilityType,
  prepareMigrationPlan,
} from './transform_and_import.mjs';

function almostEqual(a, b, epsilon) {
  return Math.abs(Number(a ?? 0) - Number(b ?? 0)) < epsilon;
}

function toEpochOrNull(val) {
  if (val === null || val === undefined) return null;
  if (val instanceof Date) return Number.isNaN(val.getTime()) ? null : val.getTime();
  const parsed = Date.parse(String(val));
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Verilen DB adaptoru uzerinde 7 adimli veri butunlugu dogrulamasi calistirir.
 */
export async function verifyMigrationWithDb(db, snapshot, userMapping = {}, options = {}) {
  const scopedToSnapshot = Boolean(options.scopedToSnapshot);
  const verifyRls = options.verifyRls !== false;

  const snapshotMetrics = computeSnapshotMetrics(snapshot);
  const plan = prepareMigrationPlan(snapshot, userMapping);
  const expectedMeterIds = plan.meters.map((m) => m.legacy_id);

  const checks = [];
  const errors = [];

  function record(id, label, passed, details) {
    checks.push({ id, label, passed, details });
    if (!passed) {
      errors.push(`${id}: ${JSON.stringify(details)}`);
    }
  }

  // 1. Sayac Sayisi
  const metersRes = scopedToSnapshot
    ? await db.query(
        `SELECT id, legacy_id, name FROM public.meters WHERE legacy_id = ANY($1::text[])`,
        [expectedMeterIds],
      )
    : await db.query(`SELECT id, legacy_id, name FROM public.meters`);

  const pgMetersByLegacy = new Map();
  for (const row of metersRes.rows ?? []) {
    if (row.legacy_id) pgMetersByLegacy.set(row.legacy_id, row);
  }
  const missingMeters = expectedMeterIds.filter((lid) => !pgMetersByLegacy.has(lid));
  const meterCountPassed =
    metersRes.rows.length === snapshotMetrics.counts.meters && missingMeters.length === 0;

  record('meter_count', 'Sayaç sayısı eşitliği', meterCountPassed, {
    firestoreCount: snapshotMetrics.counts.meters,
    postgresCount: metersRes.rows.length,
    missingLegacyIds: missingMeters,
  });

  // 2, 3, 4. Okuma Sayisi, Tuketim Toplami (< 0.001) ve Tarih Araligi (Sayac Bazli)
  const readingAggRes = scopedToSnapshot
    ? await db.query(
        `SELECT
           m.legacy_id,
           count(r.id)::int AS reading_count,
           coalesce(sum(r.consumption), 0)::double precision AS consumption_sum,
           min(r.reading_date) AS min_date,
           max(r.reading_date) AS max_date
         FROM public.meters m
         LEFT JOIN public.meter_readings r ON r.meter_id = m.id
         WHERE m.legacy_id = ANY($1::text[])
         GROUP BY m.legacy_id`,
        [expectedMeterIds],
      )
    : await db.query(
        `SELECT
           m.legacy_id,
           count(r.id)::int AS reading_count,
           coalesce(sum(r.consumption), 0)::double precision AS consumption_sum,
           min(r.reading_date) AS min_date,
           max(r.reading_date) AS max_date
         FROM public.meters m
         LEFT JOIN public.meter_readings r ON r.meter_id = m.id
         GROUP BY m.legacy_id`,
      );

  const pgReadingsByMeter = new Map();
  let totalPgReadings = 0;
  for (const row of readingAggRes.rows ?? []) {
    if (row.legacy_id) pgReadingsByMeter.set(row.legacy_id, row);
    totalPgReadings += Number(row.reading_count ?? 0);
  }

  const countMismatches = [];
  const consumptionMismatches = [];
  const dateMismatches = [];

  for (const legacyId of expectedMeterIds) {
    const expected = snapshotMetrics.perMeter[legacyId];
    const actual = pgReadingsByMeter.get(legacyId) ?? {
      reading_count: 0,
      consumption_sum: 0,
      min_date: null,
      max_date: null,
    };

    if (Number(actual.reading_count) !== expected.readingsCount) {
      countMismatches.push({
        legacyId,
        expected: expected.readingsCount,
        actual: Number(actual.reading_count),
      });
    }
    if (!almostEqual(actual.consumption_sum, expected.consumptionSum, 0.001)) {
      consumptionMismatches.push({
        legacyId,
        expected: expected.consumptionSum,
        actual: Number(actual.consumption_sum),
      });
    }

    const expMin = toEpochOrNull(expected.minDateIso);
    const actMin = toEpochOrNull(actual.min_date);
    const expMax = toEpochOrNull(expected.maxDateIso);
    const actMax = toEpochOrNull(actual.max_date);
    if (expMin !== actMin || expMax !== actMax) {
      dateMismatches.push({
        legacyId,
        expectedMin: expected.minDateIso,
        actualMin: actual.min_date,
        expectedMax: expected.maxDateIso,
        actualMax: actual.max_date,
      });
    }
  }

  record(
    'reading_count_per_meter',
    'Sayaç bazlı okuma sayısı eşitliği',
    countMismatches.length === 0 && totalPgReadings === snapshotMetrics.counts.readings,
    {
      firestoreTotalReadings: snapshotMetrics.counts.readings,
      postgresTotalReadings: totalPgReadings,
      mismatches: countMismatches,
    },
  );

  record(
    'consumption_sum_per_meter',
    'Sayaç bazlı tüketim toplamı (< 0.001)',
    consumptionMismatches.length === 0,
    {
      firestoreTotalConsumption: snapshotMetrics.totals.readingConsumption,
      mismatches: consumptionMismatches,
    },
  );

  record(
    'date_range_per_meter',
    'Sayaç bazlı tarih aralığı (MIN/MAX) eşitliği',
    dateMismatches.length === 0,
    {
      mismatches: dateMismatches,
    },
  );

  // 5. Fatura Sayisi ve Toplam Tutar (Yil + Tur Bazli)
  const expectedInvoiceIds = plan.invoices.map((i) => i.legacy_id);
  const invRes = scopedToSnapshot
    ? await db.query(
        `SELECT
           period_year::int,
           utility_type,
           count(*)::int AS cnt,
           coalesce(sum(amount_tl), 0)::double precision AS total_tl,
           coalesce(sum(inductive_penalty_tl), 0)::double precision AS ind_pen,
           coalesce(sum(capacitive_penalty_tl), 0)::double precision AS cap_pen,
           coalesce(sum(tenant_amount_tl), 0)::double precision AS tenant_tl
         FROM public.energy_invoices
         WHERE legacy_id = ANY($1::text[])
         GROUP BY period_year, utility_type`,
        [expectedInvoiceIds],
      )
    : await db.query(
        `SELECT
           period_year::int,
           utility_type,
           count(*)::int AS cnt,
           coalesce(sum(amount_tl), 0)::double precision AS total_tl,
           coalesce(sum(inductive_penalty_tl), 0)::double precision AS ind_pen,
           coalesce(sum(capacitive_penalty_tl), 0)::double precision AS cap_pen,
           coalesce(sum(tenant_amount_tl), 0)::double precision AS tenant_tl
         FROM public.energy_invoices
         GROUP BY period_year, utility_type`,
      );

  const expectedInvGroups = {};
  for (const inv of plan.invoices) {
    const key = `${inv.period_year}:${normalizeUtilityType(inv.utility_type)}`;
    if (!expectedInvGroups[key]) {
      expectedInvGroups[key] = { count: 0, amountTL: 0, indPen: 0, capPen: 0, tenantTL: 0 };
    }
    expectedInvGroups[key].count += 1;
    expectedInvGroups[key].amountTL += inv.amount_tl;
    expectedInvGroups[key].indPen += inv.inductive_penalty_tl;
    expectedInvGroups[key].capPen += inv.capacitive_penalty_tl;
    expectedInvGroups[key].tenantTL += inv.tenant_amount_tl ?? 0;
  }

  const pgInvGroups = {};
  for (const r of invRes.rows ?? []) {
    const key = `${r.period_year}:${r.utility_type}`;
    pgInvGroups[key] = {
      count: Number(r.cnt),
      amountTL: Number(r.total_tl),
      indPen: Number(r.ind_pen),
      capPen: Number(r.cap_pen),
      tenantTL: Number(r.tenant_tl),
    };
  }

  const invKeys = new Set([...Object.keys(expectedInvGroups), ...Object.keys(pgInvGroups)]);
  const invoiceMismatches = [];
  for (const key of invKeys) {
    const exp = expectedInvGroups[key] ?? { count: 0, amountTL: 0, indPen: 0, capPen: 0, tenantTL: 0 };
    const act = pgInvGroups[key] ?? { count: 0, amountTL: 0, indPen: 0, capPen: 0, tenantTL: 0 };
    if (
      exp.count !== act.count ||
      !almostEqual(exp.amountTL, act.amountTL, 0.01) ||
      !almostEqual(exp.indPen, act.indPen, 0.01) ||
      !almostEqual(exp.capPen, act.capPen, 0.01) ||
      !almostEqual(exp.tenantTL, act.tenantTL, 0.01)
    ) {
      invoiceMismatches.push({ key, expected: exp, actual: act });
    }
  }

  record(
    'invoices_by_year_and_type',
    'Yıl ve tür bazlı fatura sayısı ve tutar toplamı',
    invoiceMismatches.length === 0,
    {
      firestoreCount: plan.invoices.length,
      mismatches: invoiceMismatches,
    },
  );

  // 6. Butce Kayitlari ve Tutar Toplamlari (Yil + Tur Bazli)
  const budgetRes = await db.query(
    `SELECT
       period_year::int,
       utility_type,
       count(*)::int AS cnt,
       coalesce(sum(budget_tl), 0)::double precision AS total_budget_tl,
       coalesce(sum(prev_year_tl), 0)::double precision AS total_prev_tl
     FROM public.energy_budgets
     GROUP BY period_year, utility_type`,
  );

  const expectedBudgetGroups = {};
  for (const b of plan.budgets) {
    const key = `${b.period_year}:${normalizeUtilityType(b.utility_type)}`;
    if (!expectedBudgetGroups[key]) {
      expectedBudgetGroups[key] = { count: 0, budgetTL: 0, prevYearTL: 0 };
    }
    expectedBudgetGroups[key].count += 1;
    expectedBudgetGroups[key].budgetTL += b.budget_tl;
    expectedBudgetGroups[key].prevYearTL += b.prev_year_tl;
  }

  const pgBudgetGroups = {};
  for (const r of budgetRes.rows ?? []) {
    pgBudgetGroups[`${r.period_year}:${r.utility_type}`] = {
      count: Number(r.cnt),
      budgetTL: Number(r.total_budget_tl),
      prevYearTL: Number(r.total_prev_tl),
    };
  }

  const budgetKeys = new Set([
    ...Object.keys(expectedBudgetGroups),
    ...(scopedToSnapshot ? [] : Object.keys(pgBudgetGroups)),
  ]);
  const budgetMismatches = [];
  for (const key of budgetKeys) {
    const exp = expectedBudgetGroups[key] ?? { count: 0, budgetTL: 0, prevYearTL: 0 };
    const act = pgBudgetGroups[key] ?? { count: 0, budgetTL: 0, prevYearTL: 0 };
    if (
      exp.count !== act.count ||
      !almostEqual(exp.budgetTL, act.budgetTL, 0.01) ||
      !almostEqual(exp.prevYearTL, act.prevYearTL, 0.01)
    ) {
      budgetMismatches.push({ key, expected: exp, actual: act });
    }
  }

  record(
    'budgets_by_year_and_type',
    'Yıl ve tür bazlı bütçe kaydı ve tutar toplamı',
    budgetMismatches.length === 0,
    {
      firestoreCount: plan.budgets.length,
      mismatches: budgetMismatches,
    },
  );

  // 7. Kullanici Eslestirme, Tarihsel Sahiplik (entered_by_name) ve Yetki/RLS Dogrulamasi
  const userErrors = [];
  for (const mu of plan.matchedUsers) {
    const profRes = await db.query(
      `SELECT id, legacy_firebase_uid, permissions FROM public.profiles WHERE id = $1::uuid`,
      [mu.targetProfileId],
    );
    if ((profRes.rows?.length ?? 0) === 0) {
      userErrors.push({ type: 'missing_profile', targetProfileId: mu.targetProfileId });
      continue;
    }
    const prof = profRes.rows[0];
    if (prof.legacy_firebase_uid !== mu.legacyFirebaseUid) {
      userErrors.push({
        type: 'uid_mismatch',
        targetProfileId: mu.targetProfileId,
        expected: mu.legacyFirebaseUid,
        actual: prof.legacy_firebase_uid,
      });
    }
    const energyMod = prof.permissions?.modules?.energy;
    const expectedPerm = mu.energyPermissions;
    for (const k of ['enabled', 'view', 'create', 'edit', 'delete', 'reports', 'manage']) {
      if (Boolean(energyMod?.[k]) !== Boolean(expectedPerm[k])) {
        userErrors.push({
          type: 'permission_mismatch',
          targetProfileId: mu.targetProfileId,
          key: k,
          expected: Boolean(expectedPerm[k]),
          actual: Boolean(energyMod?.[k]),
        });
      }
    }
  }

  // Tarihsel reading entered_by_id & entered_by_name kontrolu
  for (const r of plan.readings) {
    const rowRes = await db.query(
      `SELECT entered_by_id, entered_by_name FROM public.meter_readings WHERE legacy_id = $1`,
      [r.legacy_id],
    );
    const actual = rowRes.rows?.[0];
    if (!actual) {
      userErrors.push({ type: 'missing_reading', legacyId: r.legacy_id });
      continue;
    }
    if (actual.entered_by_name !== r.entered_by_name) {
      userErrors.push({
        type: 'entered_by_name_mismatch',
        legacyId: r.legacy_id,
        expected: r.entered_by_name,
        actual: actual.entered_by_name,
      });
    }
    if ((actual.entered_by_id ?? null) !== (r.entered_by_id ?? null)) {
      userErrors.push({
        type: 'entered_by_id_mismatch',
        legacyId: r.legacy_id,
        expected: r.entered_by_id ?? null,
        actual: actual.entered_by_id ?? null,
      });
    }
  }

  // Opsiyonel RLS yetki dogrulamasi (matched admin / personel uzerinde)
  if (verifyRls && plan.matchedUsers.length > 0 && plan.meters.length > 0) {
    for (const mu of plan.matchedUsers) {
      const legacyUser = (snapshot?.users ?? []).find(
        (u) => String(u.uid ?? u.id) === mu.legacyFirebaseUid,
      );
      const expectedEnergy = mapLegacyUserPermissions(legacyUser);
      await db.query('BEGIN');
      try {
        await db.query(`SET LOCAL ROLE authenticated`);
        await db.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [
          mu.targetProfileId,
        ]);
        await db.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
          JSON.stringify({ sub: mu.targetProfileId, role: 'authenticated' }),
        ]);
        const visibleMeters = await db.query(`SELECT count(*)::int AS c FROM public.meters`);
        if (expectedEnergy.view && Number(visibleMeters.rows[0].c) < plan.meters.length) {
          userErrors.push({
            type: 'rls_meter_visibility_failed',
            targetProfileId: mu.targetProfileId,
            visible: Number(visibleMeters.rows[0].c),
            expectedAtLeast: plan.meters.length,
          });
        }
        if (!expectedEnergy.delete && plan.readings.length > 0) {
          const delRes = await db.query(`DELETE FROM public.meter_readings WHERE legacy_id = $1`, [
            plan.readings[0].legacy_id,
          ]);
          if ((delRes.affectedRows ?? 0) !== 0) {
            userErrors.push({
              type: 'rls_unauthorized_delete_allowed',
              targetProfileId: mu.targetProfileId,
            });
          }
        }
      } finally {
        await db.query('ROLLBACK');
      }
    }
  }

  record(
    'user_mapping_and_ownership',
    'Kullanıcı eşleştirme, tarihsel sahiplik ve RLS yetki doğrulaması',
    userErrors.length === 0,
    {
      matchedUsersCount: plan.matchedUsers.length,
      unmatchedUsersCount: plan.unmatchedUsers.length,
      errors: userErrors,
    },
  );

  return {
    passed: errors.length === 0,
    totalChecks: checks.length,
    passedChecks: checks.filter((c) => c.passed).length,
    checks,
    errors,
  };
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        out[key] = true;
      } else {
        out[key] = next;
        i++;
      }
    }
  }
  return out;
}

async function runCli() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.snapshot) {
    throw new Error('Eksik parametre: --snapshot <firestore_export.json>');
  }

  const snapshot = JSON.parse(await fs.readFile(path.resolve(String(args.snapshot)), 'utf8'));
  const userMapping = args.mapping
    ? JSON.parse(await fs.readFile(path.resolve(String(args.mapping)), 'utf8'))
    : {};

  const dbUrl = String(args['database-url'] || process.env.DATABASE_URL || '');
  if (!dbUrl) {
    throw new Error('Canli dogrulama icin --database-url veya DATABASE_URL gereklidir.');
  }

  let pgMod;
  try {
    pgMod = await import('pg');
  } catch {
    throw new Error('`pg` paketi yuklu degil.');
  }

  const client = new pgMod.default.Client({ connectionString: dbUrl });
  await client.connect();
  try {
    const report = await verifyMigrationWithDb(client, snapshot, userMapping, {
      scopedToSnapshot: Boolean(args['scoped']),
      verifyRls: !args['skip-rls'],
    });
    console.log(JSON.stringify(report, null, 2));
    if (!report.passed) {
      process.exitCode = 1;
    }
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch((err) => {
    console.error('[Verify Migration HATA]', err);
    process.exit(1);
  });
}

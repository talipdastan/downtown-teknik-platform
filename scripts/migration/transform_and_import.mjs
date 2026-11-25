#!/usr/bin/env node
/**
 * AVM TECH - Firebase (sayac_takip_app) -> Supabase PostgreSQL Idempotent Aktarim Motoru
 *
 * Ozellikler:
 *  - FK bagimlilik sirasina gore idempotent UPSERT:
 *      1. profiles (legacy_firebase_uid + permissions.modules.energy birlestirme)
 *      2. meters (legacy_id uzerinden)
 *      3. meter_readings (legacy_id, meter_id, entered_by_id, entered_by_name, reading_date)
 *      4. energy_invoices (legacy_id, invoice_date, created_at, kiraci/ceza alanlari)
 *      5. energy_budgets ((period_year, period_month, utility_type) benzersiz anahtariyla)
 *  - Diger modullerin yetkilerini (ornegin work_tracking) KESINLIKLE ezmez.
 *  - Silinmis / eslesmemis kullanicilarin entered_by_name bilgisini kayipsiz korur (entered_by_id = NULL).
 *  - Hem PGlite/pg DB adaptoru ile testlerde hem de CLI uzerinden kullanilabilir.
 *
 * Kullanim:
 *   node transform_and_import.mjs --snapshot ../../backups/firestore_export.json --mapping ./user_mapping.json --dry-run
 *   node transform_and_import.mjs --snapshot ../../backups/firestore_export.json --mapping ./user_mapping.json --database-url "$DATABASE_URL"
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { normalizeFirestoreTimestamp } from './export_firestore.mjs';

const VALID_CATEGORIES = new Set(['electric', 'water', 'cooling', 'gas', 'other']);
const VALID_UTILITY_TYPES = new Set(['electric', 'gas', 'water']);

/**
 * sayac_takip_app UserModel -> AVM TECH `profiles.permissions.modules.energy` eslemesi.
 */
export function mapLegacyUserPermissions(legacyUser) {
  const roleStr = String(legacyUser?.role ?? '').trim().toLowerCase();
  const isAdmin = roleStr === 'admin';
  const canEnterData = isAdmin || Boolean(legacyUser?.canEnterData);
  const canAddMeter = isAdmin || Boolean(legacyUser?.canAddMeter);
  const canAccessInvoices = isAdmin || Boolean(legacyUser?.canAccessInvoices);

  const actions = [];
  if (canEnterData) actions.push('reading_create');
  if (isAdmin) actions.push('reading_edit_delete');
  if (canAddMeter) actions.push('meter_manage');
  if (canAccessInvoices) {
    actions.push('invoice_access');
    actions.push('budget_manage');
  }
  if (canEnterData || canAccessInvoices) {
    actions.push('energy_export_reports');
  }

  return {
    enabled: true,
    view: true,
    create: canEnterData,
    edit: isAdmin,
    delete: isAdmin,
    approve: isAdmin,
    reports: canEnterData || canAccessInvoices,
    manage: isAdmin || canAddMeter || canAccessInvoices,
    actions,
  };
}

/**
 * sayac_takip_app MeterModel._inferCategory ile birebir uyumlu kategori cikarimi.
 */
export function inferLegacyCategory(meterType, meterName, explicitCategory) {
  const normalizedExplicit = String(explicitCategory ?? '').trim().toLowerCase();
  if (VALID_CATEGORIES.has(normalizedExplicit)) {
    return normalizedExplicit;
  }

  const normalizedType = String(meterType ?? 'electric').trim().toLowerCase();
  if (normalizedType !== 'mechanical') {
    return 'electric';
  }

  const lower = String(meterName ?? '').toLowerCase();
  if (lower.includes('su') || lower.includes('water')) return 'water';
  if (
    lower.includes('chiller') ||
    lower.includes('soğut') ||
    lower.includes('sogut') ||
    lower.includes('cooling') ||
    lower.includes('fancoil') ||
    lower.includes('klima')
  ) {
    return 'cooling';
  }
  if (
    lower.includes('gaz') ||
    lower.includes('doğal') ||
    lower.includes('dogal') ||
    lower.includes('gas')
  ) {
    return 'gas';
  }
  return 'other';
}

export function normalizeUtilityType(rawType) {
  const s = String(rawType ?? 'electric').trim().toLowerCase();
  if (VALID_UTILITY_TYPES.has(s)) return s;
  if (s.includes('gaz') || s.includes('gas')) return 'gas';
  if (s === 'su' || s.includes('water')) return 'water';
  return 'electric';
}

export function normalizeInvoiceType(rawType) {
  const s = String(rawType ?? 'normal').trim().toLowerCase();
  if (s === 'late_fee' || s === 'latefee' || s.includes('gecik')) return 'late_fee';
  return 'normal';
}

function toNullableNumber(val) {
  if (val === null || val === undefined || val === '') return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

function toNumberOrZero(val) {
  const n = Number(val ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function toNullableText(val) {
  if (val === null || val === undefined) return null;
  const s = String(val).trim();
  return s.length > 0 ? s : null;
}

function toIsoDateOnly(val) {
  const iso = normalizeFirestoreTimestamp(val);
  return iso ? iso.slice(0, 10) : null;
}

/**
 * Snapshot + userMapping girdilerinden kullanici cozumleme indeksleri olusturur.
 */
export function buildUserResolutionIndex(snapshotUsers = [], userMapping = {}) {
  const byUid = new Map();
  const byNameLower = new Map();
  const aliasByEnteredBy = new Map();

  for (const [k, v] of Object.entries(userMapping?.aliases?.byEnteredByName ?? {})) {
    if (v) aliasByEnteredBy.set(String(k).trim().toLowerCase(), String(v));
  }

  for (const m of userMapping?.mappings ?? []) {
    const targetId = toNullableText(m.target_profile_id);
    const uid = toNullableText(m.legacy_firebase_uid);
    if (uid && targetId) {
      byUid.set(uid, { targetId, mapping: m });
    }
    for (const candidate of [m.legacy_username, m.legacy_name]) {
      const c = toNullableText(candidate);
      if (c && targetId) {
        byNameLower.set(c.toLowerCase(), targetId);
      }
    }
    const email = toNullableText(m.legacy_email);
    if (email && email.includes('@') && targetId) {
      const local = email.split('@')[0].toLowerCase();
      byNameLower.set(local, targetId);
    }
  }

  // Snapshot icindeki users koleksiyonundan uid -> name eslestirmesi de okuyalım
  const snapshotUsersByUid = new Map();
  for (const u of snapshotUsers ?? []) {
    const uid = toNullableText(u.uid ?? u.id);
    if (uid) snapshotUsersByUid.set(uid, u);
  }

  function resolveEnteredById(enteredByRaw) {
    const raw = toNullableText(enteredByRaw);
    if (!raw) return null;
    const lower = raw.toLowerCase();
    if (aliasByEnteredBy.has(lower)) return aliasByEnteredBy.get(lower);
    if (byNameLower.has(lower)) return byNameLower.get(lower);
    // Sayi ekli legacy kullanicilar (ornegin ahmet1 -> ahmet) yalnizca acikca yoksa degil;
    // yalnizca sayisiz hali eslesmis bir profile isaret ediyorsa dene:
    const withoutDigits = lower.replace(/[0-9]+$/, '');
    if (withoutDigits && withoutDigits !== lower && byNameLower.has(withoutDigits)) {
      return byNameLower.get(withoutDigits);
    }
    return null;
  }

  return {
    byUid,
    snapshotUsersByUid,
    resolveEnteredById,
  };
}

/**
 * Snapshot verisini DB'ye dokunmadan normalize edilmiş kayit paketine cevirir (--dry-run icin de kullanilir).
 */
export function prepareMigrationPlan(snapshot, userMapping = {}) {
  const users = Array.isArray(snapshot?.users) ? snapshot.users : [];
  const meters = Array.isArray(snapshot?.meters) ? snapshot.meters : [];
  const readingsByMeter =
    snapshot?.readingsByMeter && typeof snapshot.readingsByMeter === 'object'
      ? snapshot.readingsByMeter
      : {};
  const invoices = Array.isArray(snapshot?.invoices) ? snapshot.invoices : [];
  const budgets = Array.isArray(snapshot?.budgets) ? snapshot.budgets : [];

  const userIndex = buildUserResolutionIndex(users, userMapping);
  const matchedUsers = [];
  const unmatchedUsers = [];

  for (const u of users) {
    const uid = toNullableText(u.uid ?? u.id);
    const mapped = uid ? userIndex.byUid.get(uid) : null;
    const energyPerm = mapLegacyUserPermissions(u);
    if (mapped) {
      matchedUsers.push({
        legacyFirebaseUid: uid,
        targetProfileId: mapped.targetId,
        legacyName: toNullableText(u.name) ?? uid,
        energyPermissions: energyPerm,
      });
    } else {
      unmatchedUsers.push({
        legacyFirebaseUid: uid,
        legacyName: toNullableText(u.name) ?? uid,
        energyPermissions: energyPerm,
      });
    }
  }

  const normalizedMeters = meters.map((m, idx) => {
    const meterType =
      String(m.type ?? m.meter_type ?? 'electric').trim().toLowerCase() === 'mechanical'
        ? 'mechanical'
        : 'electric';
    const rawMultiplier = Number(m.multiplier ?? 1);
    const multiplier = Number.isFinite(rawMultiplier) && rawMultiplier > 0 ? rawMultiplier : 1;

    return {
      legacy_id: String(m.id ?? `meter_${idx}`),
      name: String(m.name ?? `Sayaç ${idx + 1}`).trim(),
      meter_type: meterType,
      category: inferLegacyCategory(meterType, m.name, m.category),
      multiplier,
      sort_order: Number.isFinite(Number(m.orderIndex)) ? Math.trunc(Number(m.orderIndex)) : idx,
      meter_no: toNullableText(m.meterNo),
      contract_no: toNullableText(m.contractNo),
      eic_code: toNullableText(m.eicCode),
      tekil_code: toNullableText(m.tekilCode),
      subscriber_no: toNullableText(m.subscriberNo),
      region: toNullableText(m.region),
      is_active: m.is_active === undefined ? true : Boolean(m.is_active),
    };
  });

  const normalizedReadings = [];
  for (const meter of normalizedMeters) {
    const list = Array.isArray(readingsByMeter[meter.legacy_id])
      ? readingsByMeter[meter.legacy_id]
      : [];
    list.forEach((r, idx) => {
      const readingDateIso = normalizeFirestoreTimestamp(r.date) ?? new Date().toISOString();
      const enteredByName = toNullableText(r.enteredBy) ?? 'Bilinmeyen Kullanıcı';
      const rawId = toNullableText(r.id);
      const legacyId = rawId
        ? `${meter.legacy_id}::${rawId}`
        : `${meter.legacy_id}::${readingDateIso}::${idx}`;

      normalizedReadings.push({
        legacy_id: legacyId,
        meter_legacy_id: meter.legacy_id,
        reading_date: readingDateIso,
        active_value: toNullableNumber(r.active),
        inductive_value: toNullableNumber(r.inductive),
        capacitive_value: toNullableNumber(r.capacitive),
        inductive_percent: toNullableNumber(r.indPercent),
        capacitive_percent: toNullableNumber(r.capPercent),
        index_value: toNullableNumber(r.index),
        consumption: toNumberOrZero(r.consumption),
        entered_by_id: userIndex.resolveEnteredById(enteredByName),
        entered_by_name: enteredByName,
        notes: toNullableText(r.notes),
      });
    });
  }

  const normalizedInvoices = invoices.map((inv, idx) => {
    const enteredByName = toNullableText(inv.enteredBy) ?? 'Sistem Aktarımı';
    const createdAtIso = normalizeFirestoreTimestamp(inv.createdAt);
    return {
      legacy_id: toNullableText(inv.id) ?? `invoice_${inv.year ?? 0}_${inv.month ?? 0}_${idx}`,
      period_year: Math.trunc(Number(inv.year ?? new Date().getUTCFullYear())),
      period_month: Math.min(12, Math.max(1, Math.trunc(Number(inv.month ?? 1)))),
      utility_type: normalizeUtilityType(inv.utilityType),
      provider: toNullableText(inv.provider) ?? 'Bilinmeyen Tedarikçi',
      invoice_no: toNullableText(inv.invoiceNo),
      invoice_date: toIsoDateOnly(inv.invoiceDate),
      invoice_type: normalizeInvoiceType(inv.invoiceType),
      meter_legacy_id: toNullableText(inv.meterId),
      meter_name: toNullableText(inv.meterName) ?? toNullableText(inv.provider) ?? 'Genel',
      meter_no: toNullableText(inv.meterNo),
      contract_no: toNullableText(inv.contractNo),
      eic_code: toNullableText(inv.eicCode),
      tekil_code: toNullableText(inv.tekilCode),
      subscriber_no: toNullableText(inv.subscriberNo),
      consumption: toNumberOrZero(inv.consumption),
      amount_tl: toNumberOrZero(inv.amountTL),
      inductive_penalty_tl: toNumberOrZero(inv.inductivePenaltyTL),
      capacitive_penalty_tl: toNumberOrZero(inv.capacitivePenaltyTL),
      tenant_consumption: toNullableNumber(inv.tenantConsumption),
      tenant_amount_tl: toNullableNumber(inv.tenantAmountTL),
      pdf_storage_path: toNullableText(inv.pdfStoragePath),
      notes: toNullableText(inv.notes),
      entered_by_id: userIndex.resolveEnteredById(enteredByName),
      entered_by_name: enteredByName,
      created_at: createdAtIso,
    };
  });

  const normalizedBudgets = budgets.map((b) => ({
    period_year: Math.trunc(Number(b.year ?? new Date().getUTCFullYear())),
    period_month: Math.min(12, Math.max(1, Math.trunc(Number(b.month ?? 1)))),
    utility_type: normalizeUtilityType(b.utilityType),
    budget_consumption: toNumberOrZero(b.budgetConsumption),
    budget_tl: toNumberOrZero(b.budgetTL),
    prev_year_consumption: toNumberOrZero(b.prevYearConsumption),
    prev_year_tl: toNumberOrZero(b.prevYearTL),
    updated_by_id: userIndex.resolveEnteredById(b.updatedBy),
  }));

  return {
    matchedUsers,
    unmatchedUsers,
    meters: normalizedMeters,
    readings: normalizedReadings,
    invoices: normalizedInvoices,
    budgets: normalizedBudgets,
  };
}

/**
 * Verilen DB adaptoru ({ query(sql, params) }) uzerinde tum aktarimi tek transaction icinde
 * ve %100 idempotent olarak calistirir.
 */
export async function runMigrationWithDb(db, snapshot, userMapping = {}) {
  const plan = prepareMigrationPlan(snapshot, userMapping);

  let profilesUpdated = 0;
  let metersUpserted = 0;
  let readingsUpserted = 0;
  let invoicesUpserted = 0;
  let budgetsUpserted = 0;

  await db.query('BEGIN');
  try {
    // 1. Kullanicilar: legacy_firebase_uid ve permissions.modules.energy birlestirme
    for (const u of plan.matchedUsers) {
      const res = await db.query(
        `UPDATE public.profiles
         SET
           legacy_firebase_uid = COALESCE(legacy_firebase_uid, $2::text),
           permissions = jsonb_set(
             CASE
               WHEN permissions IS NULL OR jsonb_typeof(permissions->'modules') IS DISTINCT FROM 'object'
                 THEN jsonb_set(coalesce(permissions, '{}'::jsonb), '{modules}', '{}'::jsonb, true)
               ELSE permissions
             END,
             '{modules,energy}',
             $3::jsonb,
             true
           )
         WHERE id = $1::uuid
         RETURNING id`,
        [u.targetProfileId, u.legacyFirebaseUid, JSON.stringify(u.energyPermissions)],
      );
      if ((res.rows?.length ?? 0) > 0) {
        profilesUpdated++;
      }
    }

    // 2. Sayaclar (legacy_id -> uuid haritasi)
    const meterLegacyToUuid = new Map();
    for (const m of plan.meters) {
      const res = await db.query(
        `INSERT INTO public.meters (
           legacy_id, name, meter_type, category, multiplier, sort_order,
           meter_no, contract_no, eic_code, tekil_code, subscriber_no, region, is_active
         ) VALUES (
           $1, $2, $3, $4, $5, $6,
           $7, $8, $9, $10, $11, $12, $13
         )
         ON CONFLICT (legacy_id) DO UPDATE SET
           name = EXCLUDED.name,
           meter_type = EXCLUDED.meter_type,
           category = EXCLUDED.category,
           multiplier = EXCLUDED.multiplier,
           sort_order = EXCLUDED.sort_order,
           meter_no = EXCLUDED.meter_no,
           contract_no = EXCLUDED.contract_no,
           eic_code = EXCLUDED.eic_code,
           tekil_code = EXCLUDED.tekil_code,
           subscriber_no = EXCLUDED.subscriber_no,
           region = EXCLUDED.region,
           is_active = EXCLUDED.is_active
         RETURNING id`,
        [
          m.legacy_id,
          m.name,
          m.meter_type,
          m.category,
          m.multiplier,
          m.sort_order,
          m.meter_no,
          m.contract_no,
          m.eic_code,
          m.tekil_code,
          m.subscriber_no,
          m.region,
          m.is_active,
        ],
      );
      meterLegacyToUuid.set(m.legacy_id, res.rows[0].id);
      metersUpserted++;
    }

    // 3. Sayac Okumalari
    for (const r of plan.readings) {
      const meterUuid = meterLegacyToUuid.get(r.meter_legacy_id);
      if (!meterUuid) {
        throw new Error(`Okuma icin meter_id bulunamadi: ${r.meter_legacy_id}`);
      }
      await db.query(
        `INSERT INTO public.meter_readings (
           legacy_id, meter_id, reading_date,
           active_value, inductive_value, capacitive_value,
           inductive_percent, capacitive_percent,
           index_value, consumption, entered_by_id, entered_by_name, notes
         ) VALUES (
           $1, $2::uuid, $3::timestamptz,
           $4, $5, $6,
           $7, $8,
           $9, $10, $11::uuid, $12, $13
         )
         ON CONFLICT (legacy_id) DO UPDATE SET
           meter_id = EXCLUDED.meter_id,
           reading_date = EXCLUDED.reading_date,
           active_value = EXCLUDED.active_value,
           inductive_value = EXCLUDED.inductive_value,
           capacitive_value = EXCLUDED.capacitive_value,
           inductive_percent = EXCLUDED.inductive_percent,
           capacitive_percent = EXCLUDED.capacitive_percent,
           index_value = EXCLUDED.index_value,
           consumption = EXCLUDED.consumption,
           entered_by_id = EXCLUDED.entered_by_id,
           entered_by_name = EXCLUDED.entered_by_name,
           notes = EXCLUDED.notes`,
        [
          r.legacy_id,
          meterUuid,
          r.reading_date,
          r.active_value,
          r.inductive_value,
          r.capacitive_value,
          r.inductive_percent,
          r.capacitive_percent,
          r.index_value,
          r.consumption,
          r.entered_by_id,
          r.entered_by_name,
          r.notes,
        ],
      );
      readingsUpserted++;
    }

    // 4. Faturalar
    for (const inv of plan.invoices) {
      const meterUuid = inv.meter_legacy_id ? (meterLegacyToUuid.get(inv.meter_legacy_id) ?? null) : null;
      await db.query(
        `INSERT INTO public.energy_invoices (
           legacy_id, period_year, period_month, utility_type, provider,
           invoice_no, invoice_date, invoice_type, meter_id, meter_name,
           meter_no, contract_no, eic_code, tekil_code, subscriber_no,
           consumption, amount_tl, inductive_penalty_tl, capacitive_penalty_tl,
           tenant_consumption, tenant_amount_tl, pdf_storage_path, notes,
           entered_by_id, entered_by_name, created_at
         ) VALUES (
           $1, $2, $3, $4, $5,
           $6, $7::date, $8, $9::uuid, $10,
           $11, $12, $13, $14, $15,
           $16, $17, $18, $19,
           $20, $21, $22, $23,
           $24::uuid, $25, COALESCE($26::timestamptz, now())
         )
         ON CONFLICT (legacy_id) DO UPDATE SET
           period_year = EXCLUDED.period_year,
           period_month = EXCLUDED.period_month,
           utility_type = EXCLUDED.utility_type,
           provider = EXCLUDED.provider,
           invoice_no = EXCLUDED.invoice_no,
           invoice_date = EXCLUDED.invoice_date,
           invoice_type = EXCLUDED.invoice_type,
           meter_id = EXCLUDED.meter_id,
           meter_name = EXCLUDED.meter_name,
           meter_no = EXCLUDED.meter_no,
           contract_no = EXCLUDED.contract_no,
           eic_code = EXCLUDED.eic_code,
           tekil_code = EXCLUDED.tekil_code,
           subscriber_no = EXCLUDED.subscriber_no,
           consumption = EXCLUDED.consumption,
           amount_tl = EXCLUDED.amount_tl,
           inductive_penalty_tl = EXCLUDED.inductive_penalty_tl,
           capacitive_penalty_tl = EXCLUDED.capacitive_penalty_tl,
           tenant_consumption = EXCLUDED.tenant_consumption,
           tenant_amount_tl = EXCLUDED.tenant_amount_tl,
           pdf_storage_path = COALESCE(EXCLUDED.pdf_storage_path, public.energy_invoices.pdf_storage_path),
           notes = EXCLUDED.notes,
           entered_by_id = EXCLUDED.entered_by_id,
           entered_by_name = EXCLUDED.entered_by_name,
           created_at = COALESCE($26::timestamptz, public.energy_invoices.created_at)`,
        [
          inv.legacy_id,
          inv.period_year,
          inv.period_month,
          inv.utility_type,
          inv.provider,
          inv.invoice_no,
          inv.invoice_date,
          inv.invoice_type,
          meterUuid,
          inv.meter_name,
          inv.meter_no,
          inv.contract_no,
          inv.eic_code,
          inv.tekil_code,
          inv.subscriber_no,
          inv.consumption,
          inv.amount_tl,
          inv.inductive_penalty_tl,
          inv.capacitive_penalty_tl,
          inv.tenant_consumption,
          inv.tenant_amount_tl,
          inv.pdf_storage_path,
          inv.notes,
          inv.entered_by_id,
          inv.entered_by_name,
          inv.created_at,
        ],
      );
      invoicesUpserted++;
    }

    // 5. Butceler
    for (const b of plan.budgets) {
      await db.query(
        `INSERT INTO public.energy_budgets (
           period_year, period_month, utility_type,
           budget_consumption, budget_tl, prev_year_consumption, prev_year_tl,
           updated_by_id
         ) VALUES (
           $1, $2, $3,
           $4, $5, $6, $7,
           $8::uuid
         )
         ON CONFLICT (period_year, period_month, utility_type) DO UPDATE SET
           budget_consumption = EXCLUDED.budget_consumption,
           budget_tl = EXCLUDED.budget_tl,
           prev_year_consumption = EXCLUDED.prev_year_consumption,
           prev_year_tl = EXCLUDED.prev_year_tl,
           updated_by_id = COALESCE(EXCLUDED.updated_by_id, public.energy_budgets.updated_by_id)`,
        [
          b.period_year,
          b.period_month,
          b.utility_type,
          b.budget_consumption,
          b.budget_tl,
          b.prev_year_consumption,
          b.prev_year_tl,
          b.updated_by_id,
        ],
      );
      budgetsUpserted++;
    }

    await db.query('COMMIT');
  } catch (err) {
    await db.query('ROLLBACK');
    throw err;
  }

  return {
    profilesUpdated,
    matchedUsersCount: plan.matchedUsers.length,
    unmatchedUsers: plan.unmatchedUsers.map((u) => ({
      legacyFirebaseUid: u.legacyFirebaseUid,
      legacyName: u.legacyName,
    })),
    metersUpserted,
    readingsUpserted,
    invoicesUpserted,
    budgetsUpserted,
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

function sqlText(val) {
  if (val === null || val === undefined) return 'NULL';
  const cleaned = String(val).replace(/\u0000/g, '').replace(/'/g, "''");
  return `'${cleaned}'`;
}

function sqlNum(val) {
  if (val === null || val === undefined) return 'NULL';
  const n = Number(val);
  return Number.isFinite(n) ? String(n) : 'NULL';
}

function sqlBool(val) {
  return val ? 'TRUE' : 'FALSE';
}

function sqlUuid(val) {
  return val === null || val === undefined ? 'NULL::uuid' : `${sqlText(val)}::uuid`;
}

/**
 * Supabase SQL Editor'da dogrudan calistirilabilecek idempotent aktarım SQL betigi uretir.
 */
export function emitMigrationSql(snapshot, userMapping = {}) {
  const plan = prepareMigrationPlan(snapshot, userMapping);
  const lines = [
    '-- =====================================================================',
    '-- AVM TECH - FIREBASE (sayac-takip-avm-2026) IDEMPOTENT VERI AKTARIMI',
    `-- Uretim Zamani: ${new Date().toISOString()}`,
    `-- Ozeti: ${plan.meters.length} sayac, ${plan.readings.length} okuma, ${plan.invoices.length} fatura, ${plan.budgets.length} butce`,
    '-- =====================================================================',
    '',
    'BEGIN;',
    '',
  ];

  // 1. Eslesen profiller (varsa)
  for (const u of plan.matchedUsers) {
    lines.push(
      `UPDATE public.profiles SET`,
      `  legacy_firebase_uid = COALESCE(legacy_firebase_uid, ${sqlText(u.legacyFirebaseUid)}),`,
      `  permissions = jsonb_set(`,
      `    CASE`,
      `      WHEN permissions IS NULL OR jsonb_typeof(permissions->'modules') IS DISTINCT FROM 'object'`,
      `        THEN jsonb_set(coalesce(permissions, '{}'::jsonb), '{modules}', '{}'::jsonb, true)`,
      `      ELSE permissions`,
      `    END,`,
      `    '{modules,energy}',`,
      `    ${sqlText(JSON.stringify(u.energyPermissions))}::jsonb,`,
      `    true`,
      `  )`,
      `WHERE id = ${sqlUuid(u.targetProfileId)};`,
    );
  }
  if (plan.matchedUsers.length > 0) lines.push('');

  // 2. Sayaclar
  for (const m of plan.meters) {
    lines.push(
      `INSERT INTO public.meters (legacy_id, name, meter_type, category, multiplier, sort_order, meter_no, contract_no, eic_code, tekil_code, subscriber_no, region, is_active)`,
      `VALUES (${sqlText(m.legacy_id)}, ${sqlText(m.name)}, ${sqlText(m.meter_type)}, ${sqlText(m.category)}, ${sqlNum(m.multiplier)}, ${sqlNum(m.sort_order)}, ${sqlText(m.meter_no)}, ${sqlText(m.contract_no)}, ${sqlText(m.eic_code)}, ${sqlText(m.tekil_code)}, ${sqlText(m.subscriber_no)}, ${sqlText(m.region)}, ${sqlBool(m.is_active)})`,
      `ON CONFLICT (legacy_id) DO UPDATE SET name = EXCLUDED.name, meter_type = EXCLUDED.meter_type, category = EXCLUDED.category, multiplier = EXCLUDED.multiplier, sort_order = EXCLUDED.sort_order, meter_no = EXCLUDED.meter_no, contract_no = EXCLUDED.contract_no, eic_code = EXCLUDED.eic_code, tekil_code = EXCLUDED.tekil_code, subscriber_no = EXCLUDED.subscriber_no, region = EXCLUDED.region, is_active = EXCLUDED.is_active;`,
    );
  }
  lines.push('');

  // 3. Okumalar (meter_id legacy_id uzerinden cozulur)
  for (const r of plan.readings) {
    lines.push(
      `INSERT INTO public.meter_readings (legacy_id, meter_id, reading_date, active_value, inductive_value, capacitive_value, inductive_percent, capacitive_percent, index_value, consumption, entered_by_id, entered_by_name, notes)`,
      `SELECT ${sqlText(r.legacy_id)}, m.id, ${sqlText(r.reading_date)}::timestamptz, ${sqlNum(r.active_value)}, ${sqlNum(r.inductive_value)}, ${sqlNum(r.capacitive_value)}, ${sqlNum(r.inductive_percent)}, ${sqlNum(r.capacitive_percent)}, ${sqlNum(r.index_value)}, ${sqlNum(r.consumption)}, ${sqlUuid(r.entered_by_id)}, ${sqlText(r.entered_by_name)}, ${sqlText(r.notes)}`,
      `FROM public.meters m WHERE m.legacy_id = ${sqlText(r.meter_legacy_id)}`,
      `ON CONFLICT (legacy_id) DO UPDATE SET meter_id = EXCLUDED.meter_id, reading_date = EXCLUDED.reading_date, active_value = EXCLUDED.active_value, inductive_value = EXCLUDED.inductive_value, capacitive_value = EXCLUDED.capacitive_value, inductive_percent = EXCLUDED.inductive_percent, capacitive_percent = EXCLUDED.capacitive_percent, index_value = EXCLUDED.index_value, consumption = EXCLUDED.consumption, entered_by_id = EXCLUDED.entered_by_id, entered_by_name = EXCLUDED.entered_by_name, notes = EXCLUDED.notes;`,
    );
  }
  lines.push('');

  // 4. Faturalar
  for (const inv of plan.invoices) {
    const meterSubquery = inv.meter_legacy_id
      ? `(SELECT id FROM public.meters WHERE legacy_id = ${sqlText(inv.meter_legacy_id)} LIMIT 1)`
      : 'NULL::uuid';
    const invDateSql = inv.invoice_date ? `${sqlText(inv.invoice_date)}::date` : 'NULL::date';
    const createdAtSql = inv.created_at ? `${sqlText(inv.created_at)}::timestamptz` : 'now()';

    lines.push(
      `INSERT INTO public.energy_invoices (legacy_id, period_year, period_month, utility_type, provider, invoice_no, invoice_date, invoice_type, meter_id, meter_name, meter_no, contract_no, eic_code, tekil_code, subscriber_no, consumption, amount_tl, inductive_penalty_tl, capacitive_penalty_tl, tenant_consumption, tenant_amount_tl, pdf_storage_path, notes, entered_by_id, entered_by_name, created_at)`,
      `VALUES (${sqlText(inv.legacy_id)}, ${sqlNum(inv.period_year)}, ${sqlNum(inv.period_month)}, ${sqlText(inv.utility_type)}, ${sqlText(inv.provider)}, ${sqlText(inv.invoice_no)}, ${invDateSql}, ${sqlText(inv.invoice_type)}, ${meterSubquery}, ${sqlText(inv.meter_name)}, ${sqlText(inv.meter_no)}, ${sqlText(inv.contract_no)}, ${sqlText(inv.eic_code)}, ${sqlText(inv.tekil_code)}, ${sqlText(inv.subscriber_no)}, ${sqlNum(inv.consumption)}, ${sqlNum(inv.amount_tl)}, ${sqlNum(inv.inductive_penalty_tl)}, ${sqlNum(inv.capacitive_penalty_tl)}, ${sqlNum(inv.tenant_consumption)}, ${sqlNum(inv.tenant_amount_tl)}, ${sqlText(inv.pdf_storage_path)}, ${sqlText(inv.notes)}, ${sqlUuid(inv.entered_by_id)}, ${sqlText(inv.entered_by_name)}, ${createdAtSql})`,
      `ON CONFLICT (legacy_id) DO UPDATE SET period_year = EXCLUDED.period_year, period_month = EXCLUDED.period_month, utility_type = EXCLUDED.utility_type, provider = EXCLUDED.provider, invoice_no = EXCLUDED.invoice_no, invoice_date = EXCLUDED.invoice_date, invoice_type = EXCLUDED.invoice_type, meter_id = EXCLUDED.meter_id, meter_name = EXCLUDED.meter_name, meter_no = EXCLUDED.meter_no, contract_no = EXCLUDED.contract_no, eic_code = EXCLUDED.eic_code, tekil_code = EXCLUDED.tekil_code, subscriber_no = EXCLUDED.subscriber_no, consumption = EXCLUDED.consumption, amount_tl = EXCLUDED.amount_tl, inductive_penalty_tl = EXCLUDED.inductive_penalty_tl, capacitive_penalty_tl = EXCLUDED.capacitive_penalty_tl, tenant_consumption = EXCLUDED.tenant_consumption, tenant_amount_tl = EXCLUDED.tenant_amount_tl, pdf_storage_path = COALESCE(EXCLUDED.pdf_storage_path, public.energy_invoices.pdf_storage_path), notes = EXCLUDED.notes, entered_by_id = EXCLUDED.entered_by_id, entered_by_name = EXCLUDED.entered_by_name, created_at = ${inv.created_at ? `${sqlText(inv.created_at)}::timestamptz` : 'public.energy_invoices.created_at'};`,
    );
  }
  lines.push('');

  // 5. Butceler
  for (const b of plan.budgets) {
    lines.push(
      `INSERT INTO public.energy_budgets (period_year, period_month, utility_type, budget_consumption, budget_tl, prev_year_consumption, prev_year_tl, updated_by_id)`,
      `VALUES (${sqlNum(b.period_year)}, ${sqlNum(b.period_month)}, ${sqlText(b.utility_type)}, ${sqlNum(b.budget_consumption)}, ${sqlNum(b.budget_tl)}, ${sqlNum(b.prev_year_consumption)}, ${sqlNum(b.prev_year_tl)}, ${sqlUuid(b.updated_by_id)})`,
      `ON CONFLICT (period_year, period_month, utility_type) DO UPDATE SET budget_consumption = EXCLUDED.budget_consumption, budget_tl = EXCLUDED.budget_tl, prev_year_consumption = EXCLUDED.prev_year_consumption, prev_year_tl = EXCLUDED.prev_year_tl, updated_by_id = COALESCE(EXCLUDED.updated_by_id, public.energy_budgets.updated_by_id);`,
    );
  }

  lines.push('', 'COMMIT;', '');
  return lines.join('\n');
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

  if (args['emit-sql']) {
    const outPath = path.resolve(String(args['emit-sql']));
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    const sqlTextOut = emitMigrationSql(snapshot, userMapping);
    await fs.writeFile(outPath, sqlTextOut, 'utf8');
    console.log(
      JSON.stringify(
        {
          emitSql: true,
          outputPath: outPath,
          bytes: Buffer.byteLength(sqlTextOut, 'utf8'),
        },
        null,
        2,
      ),
    );
    return;
  }

  if (args['dry-run']) {
    const plan = prepareMigrationPlan(snapshot, userMapping);
    console.log(
      JSON.stringify(
        {
          dryRun: true,
          matchedUsers: plan.matchedUsers.length,
          unmatchedUsers: plan.unmatchedUsers.length,
          meters: plan.meters.length,
          readings: plan.readings.length,
          invoices: plan.invoices.length,
          budgets: plan.budgets.length,
        },
        null,
        2,
      ),
    );
    return;
  }

  const dbUrl = String(args['database-url'] || process.env.DATABASE_URL || '');
  if (!dbUrl) {
    throw new Error(
      'Canli aktarım icin --database-url veya DATABASE_URL gereklidir (onizleme icin --dry-run kullanabilirsiniz).',
    );
  }

  let pgMod;
  try {
    pgMod = await import('pg');
  } catch {
    throw new Error(
      '`pg` paketi yuklu degil. Canli PostgreSQL aktarimi icin migration dizininde `npm install pg` calistirin.',
    );
  }

  const client = new pgMod.default.Client({ connectionString: dbUrl });
  await client.connect();
  try {
    const summary = await runMigrationWithDb(client, snapshot, userMapping);
    console.log('[Migration Basarili]', JSON.stringify(summary, null, 2));
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch((err) => {
    console.error('[Migration HATA]', err);
    process.exit(1);
  });
}

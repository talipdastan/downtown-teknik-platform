#!/usr/bin/env node
/**
 * AVM TECH - Firestore Salt-Okunur Yedekleme (Export) Scripti
 *
 * sayac_takip_app (Firebase projectId: sayac-takip-avm-2026) uzerindeki
 * `users`, `meters`, `meters/{meterId}/readings`, `invoices` ve `budgets`
 * koleksiyonlarini salt-okunur (datastore.readonly + HTTP GET) olarak
 * zaman damgali JSON dosyasina aktarir ve ozet metrik raporu uretir.
 *
 * Canli Firebase veritabaninda HICBIR yazma, guncelleme veya silme islemi yapmaz.
 *
 * Kullanim:
 *   node export_firestore.mjs --service-account ./sa.json --out ../../backups
 *   node export_firestore.mjs --inspect ../../backups/firestore_export_20261119.json
 */

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_PROJECT_ID = 'sayac-takip-avm-2026';

/**
 * Firestore Timestamp, Date, epoch veya ISO string degerlerini UTC ISO-8601
 * string'e donusturur.
 */
export function normalizeFirestoreTimestamp(val) {
  if (val === null || val === undefined || val === '') return null;
  if (val instanceof Date) {
    return Number.isNaN(val.getTime()) ? null : val.toISOString();
  }
  if (typeof val === 'string') {
    const parsed = Date.parse(val);
    return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
  }
  if (typeof val === 'number') {
    if (!Number.isFinite(val)) return null;
    // Saniye vs milisaniye heuristigi
    const ms = val < 1e12 ? val * 1000 : val;
    return new Date(ms).toISOString();
  }
  if (typeof val === 'object') {
    if (typeof val.toDate === 'function') {
      return normalizeFirestoreTimestamp(val.toDate());
    }
    if (typeof val.timestampValue === 'string') {
      return normalizeFirestoreTimestamp(val.timestampValue);
    }
    const sec = val._seconds ?? val.seconds;
    const ns = val._nanoseconds ?? val.nanoseconds ?? 0;
    if (typeof sec === 'number' && Number.isFinite(sec)) {
      const ms = sec * 1000 + Math.floor(Number(ns || 0) / 1e6);
      return new Date(ms).toISOString();
    }
  }
  return null;
}

/**
 * Tek bir Firestore REST API value nesnesini JS degerine cozer.
 */
export function decodeFirestoreValue(value) {
  if (!value || typeof value !== 'object') return null;
  if ('nullValue' in value) return null;
  if ('booleanValue' in value) return Boolean(value.booleanValue);
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('timestampValue' in value) return normalizeFirestoreTimestamp(value.timestampValue);
  if ('stringValue' in value) return String(value.stringValue);
  if ('referenceValue' in value) return String(value.referenceValue);
  if ('arrayValue' in value) {
    const values = value.arrayValue?.values ?? [];
    return values.map((item) => decodeFirestoreValue(item));
  }
  if ('mapValue' in value) {
    const fields = value.mapValue?.fields ?? {};
    const out = {};
    for (const [k, v] of Object.entries(fields)) {
      out[k] = decodeFirestoreValue(v);
    }
    return out;
  }
  return null;
}

/**
 * Firestore REST API belge nesnesini duz JSON kaydina cevirir.
 */
export function decodeFirestoreDocument(doc) {
  const name = String(doc?.name ?? '');
  const id = name.includes('/') ? name.slice(name.lastIndexOf('/') + 1) : name;
  const fields = doc?.fields ?? {};
  const decoded = { id };
  for (const [key, val] of Object.entries(fields)) {
    decoded[key] = decodeFirestoreValue(val);
  }
  return decoded;
}

/**
 * Snapshot icindeki veriler icin sayac bazli, yil/tur bazli dogrulama metrikleri hesaplar.
 */
export function computeSnapshotMetrics(snapshot) {
  const users = Array.isArray(snapshot?.users) ? snapshot.users : [];
  const meters = Array.isArray(snapshot?.meters) ? snapshot.meters : [];
  const readingsByMeter =
    snapshot?.readingsByMeter && typeof snapshot.readingsByMeter === 'object'
      ? snapshot.readingsByMeter
      : {};
  const invoices = Array.isArray(snapshot?.invoices) ? snapshot.invoices : [];
  const budgets = Array.isArray(snapshot?.budgets) ? snapshot.budgets : [];

  const perMeter = {};
  let totalReadings = 0;
  let totalReadingConsumption = 0;

  for (const meter of meters) {
    const legacyId = String(meter.id ?? '');
    const readings = Array.isArray(readingsByMeter[legacyId]) ? readingsByMeter[legacyId] : [];
    let consumptionSum = 0;
    let minEpoch = null;
    let maxEpoch = null;

    for (const r of readings) {
      const cons = Number(r.consumption ?? 0);
      if (Number.isFinite(cons)) {
        consumptionSum += cons;
      }
      const iso = normalizeFirestoreTimestamp(r.date);
      if (iso) {
        const ms = Date.parse(iso);
        if (minEpoch === null || ms < minEpoch) minEpoch = ms;
        if (maxEpoch === null || ms > maxEpoch) maxEpoch = ms;
      }
    }

    totalReadings += readings.length;
    totalReadingConsumption += consumptionSum;
    perMeter[legacyId] = {
      meterName: meter.name ?? legacyId,
      readingsCount: readings.length,
      consumptionSum: Number(consumptionSum.toFixed(6)),
      minDateIso: minEpoch !== null ? new Date(minEpoch).toISOString() : null,
      maxDateIso: maxEpoch !== null ? new Date(maxEpoch).toISOString() : null,
    };
  }

  const invoicesByYearType = {};
  let totalInvoiceAmountTL = 0;
  for (const inv of invoices) {
    const year = Number(inv.year ?? 0);
    const type = String(inv.utilityType ?? 'electric');
    const key = `${year}:${type}`;
    if (!invoicesByYearType[key]) {
      invoicesByYearType[key] = { periodYear: year, utilityType: type, count: 0, amountTL: 0 };
    }
    const amt = Number(inv.amountTL ?? 0);
    invoicesByYearType[key].count += 1;
    invoicesByYearType[key].amountTL = Number((invoicesByYearType[key].amountTL + amt).toFixed(4));
    totalInvoiceAmountTL += amt;
  }

  const budgetsByYearType = {};
  let totalBudgetTL = 0;
  for (const b of budgets) {
    const year = Number(b.year ?? 0);
    const type = String(b.utilityType ?? 'electric');
    const key = `${year}:${type}`;
    if (!budgetsByYearType[key]) {
      budgetsByYearType[key] = { periodYear: year, utilityType: type, count: 0, budgetTL: 0 };
    }
    const btl = Number(b.budgetTL ?? 0);
    budgetsByYearType[key].count += 1;
    budgetsByYearType[key].budgetTL = Number((budgetsByYearType[key].budgetTL + btl).toFixed(4));
    totalBudgetTL += btl;
  }

  return {
    counts: {
      users: users.length,
      meters: meters.length,
      readings: totalReadings,
      invoices: invoices.length,
      budgets: budgets.length,
    },
    totals: {
      readingConsumption: Number(totalReadingConsumption.toFixed(6)),
      invoiceAmountTL: Number(totalInvoiceAmountTL.toFixed(4)),
      budgetTL: Number(totalBudgetTL.toFixed(4)),
    },
    perMeter,
    invoicesByYearType,
    budgetsByYearType,
  };
}

/**
 * Firestore `users` dokumanlarindan yonetici incelemesine hazir user_mapping taslagi uretir.
 */
export function buildUserMappingTemplateFromUsers(users, projectId = DEFAULT_PROJECT_ID) {
  const mappings = (users ?? []).map((u) => {
    const rawName = String(u.name ?? '').trim();
    const fallbackUsername = rawName
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/[^a-z0-9._-]/g, '');
    const email = u.email ?? (fallbackUsername ? `${fallbackUsername}@sayacavm.com` : null);
    return {
      legacy_firebase_uid: String(u.uid ?? u.id ?? ''),
      legacy_username: fallbackUsername || String(u.id ?? ''),
      legacy_email: email,
      legacy_name: rawName || String(u.id ?? ''),
      legacy_role: String(u.role ?? 'personel'),
      legacy_permissions: {
        canEnterData: Boolean(u.canEnterData),
        canAddMeter: Boolean(u.canAddMeter),
        canAccessInvoices: Boolean(u.canAccessInvoices),
      },
      target_profile_id: null,
      target_email: null,
      target_role: u.role === 'admin' ? 'technical_manager' : 'technician',
      match_status: 'pending_review',
      notes: '',
    };
  });

  return {
    $schema: 'avm-tech-user-mapping-v1',
    generatedAt: new Date().toISOString(),
    projectId,
    mappings,
    aliases: {
      byEnteredByName: {},
    },
  };
}

function base64UrlEncode(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

async function fetchReadOnlyAccessToken(serviceAccount) {
  const nowSec = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = base64UrlEncode(
    JSON.stringify({
      iss: serviceAccount.client_email,
      // Firestore REST API listDocuments yalnizca datastore kapsamina izin verir; script sadece HTTP GET yapar.
      scope: 'https://www.googleapis.com/auth/datastore',
      aud: 'https://oauth2.googleapis.com/token',
      exp: nowSec + 3600,
      iat: nowSec,
    }),
  );
  const unsigned = `${header}.${claim}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsigned);
  const signature = base64UrlEncode(signer.sign(serviceAccount.private_key));
  const assertion = `${unsigned}.${signature}`;

  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
  });

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    throw new Error(`OAuth2 token alinamadi (${res.status}): ${await res.text()}`);
  }
  const json = await res.json();
  return json.access_token;
}

async function listFirestoreCollection(projectId, accessToken, collectionPath) {
  const docs = [];
  let pageToken = '';

  do {
    const url = new URL(
      `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/${collectionPath}`,
    );
    url.searchParams.set('pageSize', '300');
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      throw new Error(`Firestore GET hatasi (${collectionPath}, ${res.status}): ${await res.text()}`);
    }
    const payload = await res.json();
    for (const rawDoc of payload.documents ?? []) {
      docs.push(decodeFirestoreDocument(rawDoc));
    }
    pageToken = payload.nextPageToken ?? '';
  } while (pageToken);

  return docs;
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

  if (args.inspect) {
    const raw = await fs.readFile(path.resolve(String(args.inspect)), 'utf8');
    const snapshot = JSON.parse(raw);
    const metrics = computeSnapshotMetrics(snapshot);
    console.log(JSON.stringify(metrics, null, 2));
    return;
  }

  const saPath =
    args['service-account'] ||
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS;

  if (!saPath) {
    throw new Error(
      'Service account JSON yolu verilmedi (--service-account <path> veya FIREBASE_SERVICE_ACCOUNT_PATH).',
    );
  }

  const saRaw = await fs.readFile(path.resolve(String(saPath)), 'utf8');
  const serviceAccount = JSON.parse(saRaw);
  const projectId = String(args['project-id'] || serviceAccount.project_id || DEFAULT_PROJECT_ID);

  console.log(`[Firestore Export] Salt-okunur baglanti baslatiliyor (${projectId})...`);
  const accessToken = await fetchReadOnlyAccessToken(serviceAccount);

  const [users, meters, invoices, budgets] = await Promise.all([
    listFirestoreCollection(projectId, accessToken, 'users'),
    listFirestoreCollection(projectId, accessToken, 'meters'),
    listFirestoreCollection(projectId, accessToken, 'invoices'),
    listFirestoreCollection(projectId, accessToken, 'budgets'),
  ]);

  const readingsByMeter = {};
  for (const meter of meters) {
    readingsByMeter[meter.id] = await listFirestoreCollection(
      projectId,
      accessToken,
      `meters/${meter.id}/readings`,
    );
  }

  const exportedAt = new Date().toISOString();
  const snapshot = {
    schemaVersion: '1.0.0',
    sourceProjectId: projectId,
    exportedAt,
    readOnlyExport: true,
    users,
    meters,
    readingsByMeter,
    invoices,
    budgets,
  };

  const metrics = computeSnapshotMetrics(snapshot);
  const stamp = exportedAt.replace(/[-:T]/g, '').slice(0, 15);
  const outDir = path.resolve(String(args.out || path.join(process.cwd(), 'backups')));
  await fs.mkdir(outDir, { recursive: true });

  const snapshotFile = path.join(outDir, `firestore_export_${stamp}.json`);
  const summaryFile = path.join(outDir, `firestore_export_${stamp}.summary.json`);

  await fs.writeFile(snapshotFile, JSON.stringify(snapshot, null, 2), 'utf8');
  await fs.writeFile(summaryFile, JSON.stringify({ exportedAt, projectId, ...metrics }, null, 2), 'utf8');

  console.log(`[Firestore Export] Snapshot yazildi: ${snapshotFile}`);
  console.log(`[Firestore Export] Ozet yazildi:     ${summaryFile}`);
  console.log(`[Firestore Export] Kayit sayilari:`, metrics.counts);

  if (args['write-mapping']) {
    const mappingPath = path.resolve(String(args['write-mapping']));
    const template = buildUserMappingTemplateFromUsers(users, projectId);
    await fs.writeFile(mappingPath, JSON.stringify(template, null, 2), 'utf8');
    console.log(`[Firestore Export] Kullanici esleme taslagi yazildi: ${mappingPath}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch((err) => {
    console.error('[Firestore Export HATA]', err);
    process.exit(1);
  });
}

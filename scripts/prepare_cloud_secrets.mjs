#!/usr/bin/env node
/**
 * Downtown Teknik - Bulut CI/CD, 4.5G GitHub Releases & Edge Function Secret Hazirlayici
 *
 * Bu arac yalnizca yerel makinede calisir ve uretilen gizli degerleri
 * Git disindaki `~/.downtown-teknik-secrets/github_secrets_ready.txt` dosyasina yazar.
 * Hicbir gizli anahtari terminale veya Git deposuna yazmaz.
 */

import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

const secretsDir = resolve(homedir(), '.downtown-teknik-secrets');
const keystorePath = resolve(secretsDir, 'upload-keystore.jks');
const keyPropsPath = resolve(secretsDir, 'key.properties');
const cronSecretPath = resolve(secretsDir, 'photo_purge_cron_secret.txt');
const outPath = resolve(secretsDir, 'github_secrets_ready.txt');
const dartDefinesPath = resolve(process.cwd(), 'apps', 'mobile', 'dart_defines.json');

mkdirSync(secretsDir, { recursive: true });

if (!existsSync(keystorePath) || !existsSync(keyPropsPath)) {
  console.error('[HATA] ~/.downtown-teknik-secrets icinde upload-keystore.jks veya key.properties bulunamadi.');
  process.exit(1);
}

const props = Object.fromEntries(
  readFileSync(keyPropsPath, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => {
      const idx = l.indexOf('=');
      return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
    })
);

let cronSecret = '';
if (existsSync(cronSecretPath)) {
  cronSecret = readFileSync(cronSecretPath, 'utf8').trim();
} else {
  cronSecret = randomBytes(32).toString('hex');
  writeFileSync(cronSecretPath, cronSecret + '\n', { mode: 0o600 });
}

let dartDefines = {};
if (existsSync(dartDefinesPath)) {
  dartDefines = JSON.parse(readFileSync(dartDefinesPath, 'utf8'));
}

const keystoreBase64 = readFileSync(keystorePath).toString('base64');

const lines = [
  '# DOWNTOWN TEKNIK - GITHUB ACTIONS SECRETS (SADECE YEREL, ASLA GIT\'E EKLEMEYIN)',
  '# GitHub Repo -> Settings -> Secrets and variables -> Actions -> New repository secret',
  '',
  `ANDROID_KEYSTORE_BASE64=${keystoreBase64}`,
  `ANDROID_KEY_ALIAS=${props.keyAlias || 'downtown-teknik-upload'}`,
  `ANDROID_KEY_PASSWORD=${props.keyPassword || ''}`,
  `ANDROID_STORE_PASSWORD=${props.storePassword || ''}`,
  `SUPABASE_URL=${dartDefines.SUPABASE_URL || 'https://urahnnrofnkbssxftuyz.supabase.co'}`,
  `SUPABASE_ANON_KEY=${dartDefines.SUPABASE_ANON_KEY || ''}`,
  `PHOTO_PURGE_CRON_SECRET=${cronSecret}`,
  '',
  '# SUPABASE EDGE FUNCTION KURULUM KOMUTLARI:',
  '# 1) npx supabase login',
  '# 2) npx supabase link --project-ref urahnnrofnkbssxftuyz',
  `# 3) npx supabase secrets set PHOTO_PURGE_CRON_SECRET=${cronSecret}`,
  '# 4) npx supabase functions deploy purge-expired-photos --no-verify-jwt',
  '# 5) npx supabase functions deploy send-push-notification --no-verify-jwt',
  '',
  '# 4.5G GITHUB RELEASES TETIKLEME:',
  '# git tag v1.3.0 && git push origin v1.3.0',
];

writeFileSync(outPath, lines.join('\n') + '\n', { mode: 0o600 });
console.log('[BASARILI] Bulut gizli anahtar rehberi yerel olarak hazirlandi:');
console.log(`  Dosya: ${outPath}`);
console.log('  (Git disindadir; guvenle acip GitHub Actions Secrets alanina yapistirabilirsiniz.)');

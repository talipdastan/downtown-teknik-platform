#!/usr/bin/env node
/**
 * Downtown Teknik - Shorebird OTA Code Push (APK Indirmeden Sessiz Guncelleme) Araci
 *
 * Guvenlik:
 *   - Supabase anahtari kaynak kodda sabit tutulmaz.
 *   - Ortam degiskenlerinden (SUPABASE_URL, SUPABASE_ANON_KEY, UPDATE_SERVER_URL)
 *     veya git-disi apps/mobile/dart_defines.json dosyasindan okunur.
 *
 * Kullanim:
 *   1. Ilk kurulum / ana APK surumu olusturmak icin:
 *      node scripts/patch_mobile.mjs release
 *
 *   2. Kullanicilara APK indirtmeden arka planda sessiz guncelleme (yama) gondermek icin:
 *      node scripts/patch_mobile.mjs patch
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

const mode = (process.argv[2] || 'patch').toLowerCase();
const mobileDir = resolve(process.cwd(), 'apps', 'mobile');
const dartDefinesPath = resolve(mobileDir, 'dart_defines.json');

function resolveShorebirdBin() {
  if (process.env.SHOREBIRD_BIN) return process.env.SHOREBIRD_BIN;
  if (process.platform === 'win32') {
    const winBin = resolve(homedir(), '.shorebird', 'bin', 'shorebird.bat');
    return existsSync(winBin) ? winBin : 'shorebird';
  }
  const unixBin = resolve(homedir(), '.shorebird', 'bin', 'shorebird');
  return existsSync(unixBin) ? unixBin : 'shorebird';
}

function loadConfig() {
  let fileCfg = {};
  if (existsSync(dartDefinesPath)) {
    try {
      fileCfg = JSON.parse(readFileSync(dartDefinesPath, 'utf8'));
    } catch (err) {
      throw new Error(`dart_defines.json okunamadi: ${err.message}`);
    }
  }

  const supabaseUrl = process.env.SUPABASE_URL || fileCfg.SUPABASE_URL || '';
  const supabaseAnonKey =
    process.env.SUPABASE_ANON_KEY || fileCfg.SUPABASE_ANON_KEY || '';
  const updateServerUrl =
    process.env.UPDATE_SERVER_URL ||
    fileCfg.UPDATE_SERVER_URL ||
    'http://10.16.19.19';

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      'SUPABASE_URL ve SUPABASE_ANON_KEY eksik. Ortam degiskeni olarak verin veya apps/mobile/dart_defines.json dosyasini olusturun.'
    );
  }

  return { supabaseUrl, supabaseAnonKey, updateServerUrl };
}

try {
  const shorebirdBin = resolveShorebirdBin();
  const { supabaseUrl, supabaseAnonKey, updateServerUrl } = loadConfig();

  const dartDefines = [
    `--dart-define=SUPABASE_URL=${supabaseUrl}`,
    `--dart-define=SUPABASE_ANON_KEY=${supabaseAnonKey}`,
    `--dart-define=UPDATE_SERVER_URL=${updateServerUrl}`,
  ].join(' ');

  if (mode === 'release') {
    console.log('\n==> Shorebird Ana Surum (Release APK) olusturuluyor...');
    execSync(
      `"${shorebirdBin}" release android --artifact apk -- ${dartDefines}`,
      { cwd: mobileDir, stdio: 'inherit' }
    );
    console.log('\n[BASARILI] Shorebird Release APK hazir!');
  } else if (mode === 'patch') {
    console.log(
      '\n==> Shorebird OTA Yama (APK indirmeden sessiz guncelleme) gonderiliyor...'
    );
    execSync(`"${shorebirdBin}" patch android -- ${dartDefines}`, {
      cwd: mobileDir,
      stdio: 'inherit',
    });
    console.log(
      '\n[BASARILI] Yama yayinlandi! Kullanicilar uygulamayi actiginda APK indirmeden otomatik guncellenecek.'
    );
  } else {
    throw new Error(`Gecersiz mod: "${mode}". "release" veya "patch" kullanin.`);
  }
} catch (err) {
  console.error('\n[HATA] Shorebird islemi sirasinda hata:', err.message);
  process.exit(1);
}

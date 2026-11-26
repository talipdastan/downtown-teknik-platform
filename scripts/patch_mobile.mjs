#!/usr/bin/env node
/**
 * Downtown Teknik - Shorebird OTA Code Push (APK Indirmeden Sessiz Guncelleme) Araci
 *
 * Kullanim:
 *   1. Ilk kurulum / ana APK surumu olusturmak icin:
 *      node scripts/patch_mobile.mjs release
 *
 *   2. Kullanicilara APK indirtmeden arka planda sessiz guncelleme (yama) gondermek icin:
 *      node scripts/patch_mobile.mjs patch
 */

import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { homedir } from 'node:os';

const mode = (process.argv[2] || 'patch').toLowerCase();
const shorebirdBin = resolve(homedir(), '.shorebird', 'bin', 'shorebird.bat');
const mobileDir = resolve(process.cwd(), 'apps', 'mobile');

const dartDefines = [
  '--dart-define=SUPABASE_URL=https://urahnnrofnkbssxftuyz.supabase.co',
  '--dart-define=SUPABASE_ANON_KEY=sb_publishable_yo4TE_SHiSPB5vAQxc_2mQ_FNNggljo',
  '--dart-define=UPDATE_SERVER_URL=http://10.16.19.19',
].join(' ');

try {
  if (mode === 'release') {
    console.log('\n==> Shorebird Ana Surum (Release APK) olusturuluyor...');
    execSync(
      `"${shorebirdBin}" release android --artifact apk -- ${dartDefines}`,
      { cwd: mobileDir, stdio: 'inherit' }
    );
    console.log('\n[BASARILI] Shorebird Release APK hazir!');
  } else {
    console.log('\n==> Shorebird OTA Yama (APK indirmeden sessiz guncelleme) gonderiliyor...');
    execSync(
      `"${shorebirdBin}" patch android -- ${dartDefines}`,
      { cwd: mobileDir, stdio: 'inherit' }
    );
    console.log('\n[BASARILI] Yama yayinlandi! Kullanicilar uygulamayi actiginda APK indirmeden otomatik guncellenecek.');
  }
} catch (err) {
  console.error('\n[HATA] Shorebird islemi sirasinda hata:', err.message);
  process.exit(1);
}

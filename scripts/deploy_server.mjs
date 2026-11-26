#!/usr/bin/env node
/**
 * Downtown Teknik - GitHub + Ubuntu Server + OTA APK Tek Komut Canli Dagitim Araci
 *
 * Kullanim (Windows proje kok dizininde):
 *   node scripts/deploy_server.mjs "Guncelleme aciklamasi"
 */

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const SERVER_HOST = process.env.DEPLOY_HOST || '10.16.19.19';
const SERVER_USER = process.env.DEPLOY_USER || 'teknik';
const SERVER_PASS = process.env.DEPLOY_PASS || 'teknik1616';
const commitMsg =
  process.argv.slice(2).join(' ').trim() ||
  `Update: ${new Date().toISOString()}`;

const APK_LOCAL_PATH = resolve(
  process.cwd(),
  'apps/mobile/build/app/outputs/flutter-apk/app-release.apk'
);
const REMOTE_DOWNLOAD_DIR = '/var/www/avm-teknik/apps/web/public/download';
const REMOTE_APK_PATH = `${REMOTE_DOWNLOAD_DIR}/downtown-teknik.apk`;

function run(cmd, label) {
  console.log(`\n==> ${label}`);
  execSync(cmd, { stdio: 'inherit' });
}

try {
  const status = execSync('git status --porcelain', { encoding: 'utf8' }).trim();
  if (status.length > 0) {
    run('git add .', 'Degisiklikler Git sahnesine ekleniyor...');
    run(
      `git commit -m "${commitMsg.replace(/"/g, '\\"')}"`,
      'Commit olusturuluyor...'
    );
  } else {
    console.log('==> Yerel degisiklik yok, mevcut commit push ediliyor...');
  }

  run('git push origin main', 'GitHub (origin/main) deposuna gonderiliyor...');

  // Eger yerel derlenmis APK mevcutsa dogrudan Ubuntu sunucusunun public/download klasorune yukle
  if (existsSync(APK_LOCAL_PATH)) {
    run(
      `"C:\\Program Files\\PuTTY\\plink.exe" -batch -ssh -l ${SERVER_USER} -pw ${SERVER_PASS} ${SERVER_HOST} "mkdir -p ${REMOTE_DOWNLOAD_DIR}"`,
      'Sunucuda /download dizini hazirlaniyor...'
    );
    run(
      `"C:\\Program Files\\PuTTY\\pscp.exe" -batch -pw ${SERVER_PASS} "${APK_LOCAL_PATH}" ${SERVER_USER}@${SERVER_HOST}:${REMOTE_APK_PATH}`,
      `Guncel Android APK sunucuya yukleniyor (http://${SERVER_HOST}/download/downtown-teknik.apk)...`
    );
  }

  run(
    `"C:\\Program Files\\PuTTY\\plink.exe" -batch -ssh -l ${SERVER_USER} -pw ${SERVER_PASS} ${SERVER_HOST} "/usr/local/bin/downtown-deploy"`,
    `Ubuntu Server (${SERVER_HOST}) GitHub'dan guncelleniyor ve derleniyor...`
  );

  console.log(`\n[BASARILI] Canli sunucu ve Mobil Dagitim Merkezi guncellendi:`);
  console.log(`  • Web Panel & PWA : http://${SERVER_HOST}`);
  console.log(`  • Mobil Indirme   : http://${SERVER_HOST}/download`);
  console.log(`  • Dogrudan APK    : http://${SERVER_HOST}/download/downtown-teknik.apk`);
  console.log(`  • OTA Versiyon    : http://${SERVER_HOST}/download/version.json`);
} catch (err) {
  console.error('\n[HATA] Dagitim sirasinda hata olustu:', err.message);
  process.exit(1);
}

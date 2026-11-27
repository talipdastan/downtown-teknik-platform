#!/usr/bin/env node
/**
 * Downtown Teknik - GitHub + Ubuntu Server + OTA APK Tek Komut Canli Dagitim Araci
 *
 * Guvenlik:
 *   - Parola kullanmaz; yalnizca SSH anahtari (key-based auth) ile baglanir.
 *   - Varsayilan anahtar: ~/.ssh/id_ed25519 (veya DEPLOY_SSH_KEY env degiskeni).
 *
 * Kullanim (proje kok dizininde):
 *   node scripts/deploy_server.mjs "Guncelleme aciklamasi"
 */

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

const SERVER_HOST = process.env.DEPLOY_HOST || '10.16.19.19';
const SERVER_USER = process.env.DEPLOY_USER || 'teknik';
const SSH_KEY_PATH =
  process.env.DEPLOY_SSH_KEY || resolve(homedir(), '.ssh', 'id_ed25519');
const commitMsg =
  process.argv.slice(2).join(' ').trim() ||
  `Update: ${new Date().toISOString()}`;

const APK_DIR = resolve(
  process.cwd(),
  'apps/mobile/build/app/outputs/flutter-apk'
);
const REMOTE_DOWNLOAD_DIR = '/var/www/avm-teknik/apps/web/public/download';

const APK_ARTIFACTS = [
  {
    local: resolve(APK_DIR, 'app-release.apk'),
    remote: `${REMOTE_DOWNLOAD_DIR}/downtown-teknik.apk`,
    label: 'Universal APK (downtown-teknik.apk)',
  },
  {
    local: resolve(APK_DIR, 'app-arm64-v8a-release.apk'),
    remote: `${REMOTE_DOWNLOAD_DIR}/downtown-teknik-arm64-v8a.apk`,
    label: 'ARM64 APK (downtown-teknik-arm64-v8a.apk)',
  },
  {
    local: resolve(APK_DIR, 'app-armeabi-v7a-release.apk'),
    remote: `${REMOTE_DOWNLOAD_DIR}/downtown-teknik-armeabi-v7a.apk`,
    label: 'ARMv7 APK (downtown-teknik-armeabi-v7a.apk)',
  },
];

function run(cmd, label) {
  console.log(`\n==> ${label}`);
  execSync(cmd, { stdio: 'inherit' });
}

function buildSshBaseArgs() {
  const args = [
    '-o',
    'BatchMode=yes',
    '-o',
    'StrictHostKeyChecking=accept-new',
    '-o',
    'ConnectTimeout=10',
  ];
  if (existsSync(SSH_KEY_PATH)) {
    args.push('-i', `"${SSH_KEY_PATH}"`);
  }
  return args.join(' ');
}

try {
  if (!existsSync(SSH_KEY_PATH)) {
    console.error(
      `\n[HATA] SSH ozel anahtari bulunamadi: ${SSH_KEY_PATH}\n` +
        'Once SSH anahtari olusturup sunucuya yetkilendirin:\n' +
        '  1) ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519\n' +
        `  2) Genel anahtari (${SSH_KEY_PATH}.pub) ${SERVER_USER}@${SERVER_HOST}:~/.ssh/authorized_keys dosyasina ekleyin.\n` +
        'Alternatif olarak DEPLOY_SSH_KEY ortam degiskeniyle anahtar yolunu belirtebilirsiniz.'
    );
    process.exit(1);
  }

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

  const sshOpts = buildSshBaseArgs();
  const existingApks = APK_ARTIFACTS.filter((a) => existsSync(a.local));

  if (existingApks.length > 0) {
    run(
      `ssh ${sshOpts} ${SERVER_USER}@${SERVER_HOST} "mkdir -p ${REMOTE_DOWNLOAD_DIR}"`,
      'Sunucuda /download dizini hazirlaniyor...'
    );
    for (const apk of existingApks) {
      run(
        `scp ${sshOpts} "${apk.local}" ${SERVER_USER}@${SERVER_HOST}:"${apk.remote}"`,
        `Yukleniyor: ${apk.label}...`
      );
    }
  }

  run(
    `ssh ${sshOpts} ${SERVER_USER}@${SERVER_HOST} "/usr/local/bin/downtown-deploy"`,
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

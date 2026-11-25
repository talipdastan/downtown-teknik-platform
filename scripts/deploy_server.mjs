#!/usr/bin/env node
/**
 * Downtown Teknik - GitHub + Ubuntu Server Tek Komut Canli Dagitim Araci
 *
 * Kullanim (Windows proje kok dizininde):
 *   node scripts/deploy_server.mjs "Guncelleme aciklamasi"
 */

import { execSync } from 'node:child_process';

const SERVER_HOST = process.env.DEPLOY_HOST || '10.16.19.19';
const SERVER_USER = process.env.DEPLOY_USER || 'teknik';
const SERVER_PASS = process.env.DEPLOY_PASS || 'teknik1616';
const commitMsg = process.argv.slice(2).join(' ').trim() || `Update: ${new Date().toISOString()}`;

function run(cmd, label) {
  console.log(`\n==> ${label}`);
  execSync(cmd, { stdio: 'inherit' });
}

try {
  const status = execSync('git status --porcelain', { encoding: 'utf8' }).trim();
  if (status.length > 0) {
    run('git add .', 'Degisiklikler Git sahnesine ekleniyor...');
    run(`git commit -m "${commitMsg.replace(/"/g, '\\"')}"`, 'Commit olusturuluyor...');
  } else {
    console.log('==> Yerel degisiklik yok, mevcut commit push ediliyor...');
  }

  run('git push origin main', 'GitHub (origin/main) deposuna gonderiliyor...');

  run(
    `"C:\\Program Files\\PuTTY\\plink.exe" -batch -ssh -l ${SERVER_USER} -pw ${SERVER_PASS} ${SERVER_HOST} "/usr/local/bin/downtown-deploy"`,
    `Ubuntu Server (${SERVER_HOST}) GitHub'dan guncelleniyor ve derleniyor...`,
  );

  console.log(`\n[BASARILI] Canli sunucu guncellendi: http://${SERVER_HOST}`);
} catch (err) {
  console.error('\n[HATA] Dagitim sirasinda hata olustu:', err.message);
  process.exit(1);
}

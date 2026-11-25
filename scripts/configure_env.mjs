#!/usr/bin/env node
/**
 * AVM TECH - Ortam Yapilandirma Araci (Web + Mobil)
 *
 * Yeni Supabase projenizin URL ve ANON KEY bilgilerini tek komutla hem
 * Web (.env.local) hem de Mobil Flutter (dart_defines.json) icin yazar.
 *
 * Kullanim:
 *   node scripts/configure_env.mjs --url "https://xxxx.supabase.co" --anon-key "eyJ..."
 *   node scripts/configure_env.mjs --url "https://xxxx.supabase.co" --anon-key "eyJ..." --dry-run
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

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

export function buildEnvPayloads({ url, anonKey }) {
  const cleanUrl = String(url ?? '').trim().replace(/\/+$/, '');
  const cleanKey = String(anonKey ?? '').trim();

  if (!cleanUrl || (!cleanUrl.startsWith('https://') && !cleanUrl.startsWith('http://localhost') && !cleanUrl.startsWith('http://127.0.0.1'))) {
    throw new Error('Gecerli bir Supabase Project URL girin (ornegin https://xxxx.supabase.co).');
  }
  if (!cleanKey || cleanKey.includes('YOUR_SUPABASE_ANON_KEY')) {
    throw new Error('Gecerli bir Supabase Anon Key girin.');
  }

  const webEnvContent = [
    '# AVM TECH - Web Yonetim Paneli (otomatik olusturuldu)',
    `NEXT_PUBLIC_SUPABASE_URL=${cleanUrl}`,
    `NEXT_PUBLIC_SUPABASE_ANON_KEY=${cleanKey}`,
    '',
  ].join('\n');

  const mobileDartDefines = JSON.stringify(
    {
      SUPABASE_URL: cleanUrl,
      SUPABASE_ANON_KEY: cleanKey,
    },
    null,
    2,
  ) + '\n';

  return {
    cleanUrl,
    webEnvPath: path.join(ROOT_DIR, 'apps', 'web', '.env.local'),
    webEnvContent,
    mobileDefinesPath: path.join(ROOT_DIR, 'apps', 'mobile', 'dart_defines.json'),
    mobileDartDefines,
  };
}

async function runCli() {
  const args = parseArgs(process.argv.slice(2));
  const url = args.url || process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = args['anon-key'] || process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const payloads = buildEnvPayloads({ url, anonKey });

  if (args['dry-run']) {
    console.log(
      JSON.stringify(
        {
          dryRun: true,
          url: payloads.cleanUrl,
          webEnvPath: payloads.webEnvPath,
          mobileDefinesPath: payloads.mobileDefinesPath,
        },
        null,
        2,
      ),
    );
    return;
  }

  await fs.writeFile(payloads.webEnvPath, payloads.webEnvContent, 'utf8');
  await fs.writeFile(payloads.mobileDefinesPath, payloads.mobileDartDefines, 'utf8');

  console.log('[OK] Web ortami yazildi:  ', payloads.webEnvPath);
  console.log('[OK] Mobil ortami yazildi:', payloads.mobileDefinesPath);
  console.log('\nCalistirma komutlari:');
  console.log('  Web:   cd apps/web && npm run dev');
  console.log('  Mobil: cd apps/mobile && flutter run --dart-define-from-file=dart_defines.json');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch((err) => {
    console.error('[HATA]', err.message);
    process.exit(1);
  });
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const selectsSrc = readFileSync(
  resolve(process.cwd(), 'src/core/supabase/selects.ts'),
  'utf8'
);
const dbTypesSrc = readFileSync(
  resolve(process.cwd(), 'src/types/database.ts'),
  'utf8'
);

function parseSelect(name) {
  const m = selectsSrc.match(new RegExp(`export const ${name}\\s*=\\s*'([^']+)'`));
  assert.ok(m, `${name} selects.ts içinde tanımlı olmalı`);
  return m[1]
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);
}

function parseInterfaceFields(interfaceName) {
  const m = dbTypesSrc.match(
    new RegExp(`export interface ${interfaceName}\\s*\\{([\\s\\S]*?)\\n\\}`)
  );
  assert.ok(m, `${interfaceName} database.ts içinde tanımlı olmalı`);
  const fields = new Set();
  for (const line of m[1].split('\n')) {
    const f = line.trim().match(/^([a-zA-Z0-9_]+)\??\s*:/);
    if (f) fields.add(f[1]);
  }
  return fields;
}

const BINDINGS = [
  ['PROFILE_SELECT', 'Profile'],
  ['SYSTEM_MODULE_SELECT', 'SystemModule'],
  ['DEPARTMENT_SELECT', 'Department'],
  ['FLOOR_SELECT', 'Floor'],
  ['LOCATION_SELECT', 'Location'],
  ['CATEGORY_SELECT', 'Category'],
  ['EQUIPMENT_SELECT', 'Equipment'],
  ['METER_SELECT', 'Meter'],
  ['ENERGY_INVOICE_SELECT', 'EnergyInvoice'],
  ['ENERGY_BUDGET_SELECT', 'EnergyBudget'],
  ['METER_READING_SELECT', 'MeterReading'],
];

const EXTRA_ALLOWED_DB_COLS = {
  METER_READING_SELECT: new Set(['created_at']),
};

test('selects.ts içindeki hiçbir sorguda wildcard (*) bulunmamalı', () => {
  for (const [selectName] of BINDINGS) {
    const cols = parseSelect(selectName);
    assert.equal(cols.includes('*'), false, `${selectName} wildcard (*) içeremez`);
  }
});

for (const [selectName, ifaceName] of BINDINGS) {
  test(`${selectName} sütunları ${ifaceName} şemasıyla birebir uyumlu olmalı`, () => {
    const cols = parseSelect(selectName);
    const allowed = parseInterfaceFields(ifaceName);
    const extras = EXTRA_ALLOWED_DB_COLS[selectName] ?? new Set();
    const unknown = cols.filter((c) => !allowed.has(c) && !extras.has(c));
    assert.deepEqual(
      unknown,
      [],
      `${selectName} içinde ${ifaceName} arayüzünde olmayan sütun(lar) bulundu: ${unknown.join(', ')}`
    );
  });
}

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildReadingsExportData,
  meterCategoryLabel,
  resolveReadingsViewMode,
} from '../src/core/utils/energy-readings.ts';

const fmt = (iso) => iso.slice(0, 10);

const mechRows = [
  {
    reading_date: '2026-11-19T12:00:00+03:00',
    active_value: null,
    inductive_value: null,
    capacitive_value: null,
    inductive_percent: null,
    capacitive_percent: null,
    index_value: 378.122,
    consumption: 37,
    entered_by_name: 'erol',
    meters: { name: 'Kazan Doğalgaz', meter_type: 'mechanical', category: 'gas' },
  },
];

const elecRows = [
  {
    reading_date: '2026-11-19T12:00:00+03:00',
    active_value: 1500,
    inductive_value: 180,
    capacitive_value: 45,
    inductive_percent: 12.5,
    capacitive_percent: 3.1,
    index_value: null,
    consumption: 240,
    entered_by_name: 'talip',
    meters: { name: 'GT.ADP.1', meter_type: 'electric', category: 'electric' },
  },
];

test('resolveReadingsViewMode mekanik sayaç seçiliyse mechanical döndürür', () => {
  assert.equal(
    resolveReadingsViewMode('all', { meter_type: 'mechanical' }, elecRows),
    'mechanical'
  );
  assert.equal(resolveReadingsViewMode('mechanical', null, []), 'mechanical');
  assert.equal(resolveReadingsViewMode('all', null, mechRows), 'mechanical');
  assert.equal(resolveReadingsViewMode('all', null, elecRows), 'electric');
  assert.equal(
    resolveReadingsViewMode('all', null, [...mechRows, ...elecRows]),
    'all'
  );
});

test('buildReadingsExportData mechanical modda Aktif/İndüktif/Kapasitif/Reaktif içermez', () => {
  const { headers, reportRows } = buildReadingsExportData('mechanical', mechRows, fmt);
  const joined = headers.join(' ');
  assert.ok(!joined.includes('Aktif'));
  assert.ok(!joined.includes('İndüktif'));
  assert.ok(!joined.includes('Kapasitif'));
  assert.ok(!joined.includes('Reaktif'));
  assert.deepEqual(headers, ['Tarih', 'Sayaç', 'Kategori', 'Endeks', 'Tüketim (m³)', 'Giren']);
  assert.deepEqual(reportRows[0], ['2026-11-19', 'Kazan Doğalgaz', 'Doğalgaz', 378.122, 37, 'erol']);
});

test('buildReadingsExportData electric modda tüm elektrik ve reaktif başlıklarını içerir', () => {
  const { headers, reportRows } = buildReadingsExportData('electric', elecRows, fmt);
  assert.ok(headers.includes('Aktif Endeks'));
  assert.ok(headers.includes('İndüktif Endeks'));
  assert.ok(headers.includes('Kapasitif Endeks'));
  assert.ok(headers.includes('İndüktif %'));
  assert.ok(headers.includes('Kapasitif %'));
  assert.equal(reportRows[0][2], 1500);
});

test('buildReadingsExportData karma all modunda mekanik satırda yalnızca Endeks ve m³ üretir', () => {
  const { headers, reportRows } = buildReadingsExportData(
    'all',
    [...mechRows, ...elecRows],
    fmt
  );
  assert.deepEqual(headers, [
    'Tarih',
    'Sayaç',
    'Tür',
    'Okuma / Endeks',
    'Tüketim',
    'Birim',
    'Reaktif Durum',
    'Giren',
  ]);
  assert.equal(reportRows[0][2], 'Doğalgaz');
  assert.equal(reportRows[0][3], 'Endeks: 378.122');
  assert.equal(reportRows[0][5], 'm³');
  assert.equal(reportRows[0][6], '-');
  assert.equal(reportRows[1][2], 'Elektrik');
  assert.equal(reportRows[1][5], 'kWh');
  assert.equal(meterCategoryLabel('water', 'mechanical'), 'Şebeke Suyu');
  assert.equal(meterCategoryLabel('cooling', 'mechanical'), 'Soğutma / Kule');
});

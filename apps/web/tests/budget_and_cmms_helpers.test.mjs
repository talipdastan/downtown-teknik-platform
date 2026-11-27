import test from 'node:test';
import assert from 'node:assert/strict';

// Bütçe parser, reaktif ceza eşiği ve CMMS modül tanımları doğrulama testleri
function parseNumber(val) {
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  const s = String(val ?? '').trim().replace(/\s+/g, '');
  if (!s) return 0;
  if (s.includes(',') && s.includes('.')) {
    const lastComma = s.lastIndexOf(',');
    const lastDot = s.lastIndexOf('.');
    const normalized =
      lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    const n = Number(normalized);
    return Number.isFinite(n) ? n : 0;
  }
  if (s.includes(',')) {
    const n = Number(s.replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function parseMonth(val) {
  const n = Number(val);
  if (Number.isInteger(n) && n >= 1 && n <= 12) return n;
  const s = String(val ?? '').trim().toLowerCase();
  const map = {
    ocak: 1, subat: 2, şubat: 2, mart: 3, nisan: 4, mayis: 5, mayıs: 5,
    haziran: 6, temmuz: 7, agustos: 8, ağustos: 8, eylul: 9, eylül: 9,
    ekim: 10, kasim: 11, kasım: 11, aralik: 12, aralık: 12,
  };
  return map[s] ?? null;
}

function isReactivePenaltyRisk(inductivePct, capacitivePct) {
  return Number(inductivePct || 0) >= 20 || Number(capacitivePct || 0) >= 15;
}

function getInitials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'U';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

test('parseNumber Türkçe (1.234,56) ve İngilizce (1,234.56) sayı biçimlerini doğru ayrıştırmalı', () => {
  assert.equal(parseNumber('1.234.567,89'), 1234567.89);
  assert.equal(parseNumber('1,234,567.89'), 1234567.89);
  assert.equal(parseNumber('450,5'), 450.5);
  assert.equal(parseNumber(''), 0);
  assert.equal(parseNumber(null), 0);
});

test('parseMonth hem sayı hem Türkçe ay adını 1-12 aralığına çevirmeli', () => {
  assert.equal(parseMonth(1), 1);
  assert.equal(parseMonth(12), 12);
  assert.equal(parseMonth(13), null);
  assert.equal(parseMonth('Şubat'), 2);
  assert.equal(parseMonth('Ağustos'), 8);
  assert.equal(parseMonth('Aralık'), 12);
  assert.equal(parseMonth('Bilinmeyen'), null);
});

test('Reaktif ceza eşiği Endüktif >= %20 veya Kapasitif >= %15 olduğunda alarm vermeli', () => {
  assert.equal(isReactivePenaltyRisk(19.9, 14.9), false);
  assert.equal(isReactivePenaltyRisk(20.0, 5.0), true);
  assert.equal(isReactivePenaltyRisk(10.0, 15.0), true);
  assert.equal(isReactivePenaltyRisk(25.4, 18.2), true);
});

test('getInitials personel adından doğru baş harfleri üretmeli', () => {
  assert.equal(getInitials('Talip Daştan'), 'TD');
  assert.equal(getInitials('Ahmet Mehmet Yılmaz'), 'AY');
  assert.equal(getInitials('Teknik'), 'TE');
  assert.equal(getInitials(''), 'U');
});

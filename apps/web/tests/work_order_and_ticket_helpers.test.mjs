import test from 'node:test';
import assert from 'node:assert/strict';

// İş emri süre, kişi/mahal çözümleme ve dosya adı temizleme mantık testleri
function calcDurationLabel(startIso, endIso) {
  if (!startIso || !endIso) return '-';
  const diffMin = Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000);
  if (diffMin < 0 || !Number.isFinite(diffMin)) return '-';
  if (diffMin < 60) return `${diffMin} dk`;
  const h = Math.floor(diffMin / 60);
  const m = diffMin % 60;
  if (h < 24) return m > 0 ? `${h} sa ${m} dk` : `${h} sa`;
  const d = Math.floor(h / 24);
  const remH = h % 24;
  return remH > 0 ? `${d} gün ${remH} sa` : `${d} gün`;
}

function sanitizeFileName(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function resolveLocationLabel(ticket) {
  if (!ticket) return '-';
  if (ticket.locations?.name) {
    const fl = ticket.locations.floors?.name;
    return fl ? `${fl} - ${ticket.locations.name}` : ticket.locations.name;
  }
  return ticket.custom_location || '-';
}

function toIsoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

test('calcDurationLabel dakika, saat ve gün formatlarını doğru hesaplamalı', () => {
  assert.equal(calcDurationLabel(null, '2026-11-27T10:00:00Z'), '-');
  assert.equal(
    calcDurationLabel('2026-11-27T10:00:00Z', '2026-11-27T10:45:00Z'),
    '45 dk'
  );
  assert.equal(
    calcDurationLabel('2026-11-27T10:00:00Z', '2026-11-27T12:00:00Z'),
    '2 sa'
  );
  assert.equal(
    calcDurationLabel('2026-11-27T10:00:00Z', '2026-11-27T12:30:00Z'),
    '2 sa 30 dk'
  );
  assert.equal(
    calcDurationLabel('2026-11-27T10:00:00Z', '2026-11-29T13:00:00Z'),
    '2 gün 3 sa'
  );
  // Negatif zaman farkı güvenli şekilde '-' dönmeli
  assert.equal(
    calcDurationLabel('2026-11-27T12:00:00Z', '2026-11-27T10:00:00Z'),
    '-'
  );
});

test('sanitizeFileName Türkçe karakter ve boşlukları güvenli ASCII alt çizgiye çevirmeli', () => {
  assert.equal(sanitizeFileName('Arıza Fotoğrafı (1).webp'), 'Ar_za_Foto_raf___1_.webp');
  assert.equal(sanitizeFileName('photo_2026-11.jpg'), 'photo_2026-11.jpg');
});

test('resolveLocationLabel kat + mahal veya özel mahal metnini doğru döndürmeli', () => {
  assert.equal(
    resolveLocationLabel({ locations: { name: 'Kazan Dairesi', floors: { name: 'B2' } } }),
    'B2 - Kazan Dairesi'
  );
  assert.equal(
    resolveLocationLabel({ locations: { name: 'Otopark Giriş', floors: null } }),
    'Otopark Giriş'
  );
  assert.equal(
    resolveLocationLabel({ custom_location: 'Çatı Chiller Platformu' }),
    'Çatı Chiller Platformu'
  );
  assert.equal(resolveLocationLabel(null), '-');
});

test('toIsoDate YYYY-MM-DD biçiminde sıfır dolgulu tarih üretmeli', () => {
  assert.equal(toIsoDate(new Date(2026, 0, 5)), '2026-01-05');
  assert.equal(toIsoDate(new Date(2026, 10, 27)), '2026-11-27');
});

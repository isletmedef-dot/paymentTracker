'use strict';
const test = require('node:test');
const assert = require('node:assert');
const F = require('../lib/fis');

test('tutarDuzelt Türkçe biçimleri okur', () => {
  assert.equal(F.tutarDuzelt('1.200,50 TL'), 1200.5);
  assert.equal(F.tutarDuzelt('1200'), 1200);
  assert.equal(F.tutarDuzelt(1200.5), 1200.5);
  assert.equal(F.tutarDuzelt('abc'), null);
});

test('tarihDuzelt gün.ay.yıl ve ISO okur', () => {
  assert.equal(F.tarihDuzelt('05.11.2026'), '2026-11-05');
  assert.equal(F.tarihDuzelt('5.11.26'), '2026-11-05');
  assert.equal(F.tarihDuzelt('2026-11-05'), '2026-11-05');
});

test('jsonAyikla kod bloğu ve fazladan metni temizler', () => {
  const j = F.jsonAyikla('İşte sonuç:\n```json\n{"tutar": 1200, "tarih": "2026-11-05"}\n```');
  assert.deepEqual(j, { tutar: 1200, tarih: '2026-11-05' });
});

test('normalize Türkçe harfleri sadeleştirir', () => {
  assert.equal(F.normalize('MİRA ALTUNTAŞ'), 'mira altuntas');
});

test('eslesmeBul veli adından öğrenciyi bulur', () => {
  const ogrenciler = [
    { id: 1, ad: 'Ayşe Yılmaz', veli: 'Fatma Yılmaz' },
    { id: 2, ad: 'Can Demir', veli: 'Zeynep Demir' },
  ];
  const r = F.eslesmeBul({ gonderen: 'FATMA YILMAZ' }, ogrenciler);
  assert.equal(r.student_id, 1);
  assert.ok(r.puan >= 80);
});

test('eslesmeBul isim yoksa boş döner', () => {
  const r = F.eslesmeBul({ gonderen: null, ogrenci: null, aciklama: null }, [{ id: 1, ad: 'X Y' }]);
  assert.equal(r.student_id, null);
});

test('eslesmeBul alakasız isimde eşik altı puan verir', () => {
  const r = F.eslesmeBul({ gonderen: 'Ahmet Kaya' }, [{ id: 1, ad: 'Ayşe Yılmaz', veli: 'Fatma Yılmaz' }]);
  assert.ok(r.puan < 60);
});

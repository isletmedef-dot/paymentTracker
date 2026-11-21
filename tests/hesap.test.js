'use strict';
const test = require('node:test');
const assert = require('node:assert');
const H = require('../lib/hesap');

test('vadeTarihi ayın gün sayısına kırpar', () => {
  assert.equal(H.vadeTarihi(2026, 2, 31), '2026-02-28');
  assert.equal(H.vadeTarihi(2026, 4, 31), '2026-04-30');
  assert.equal(H.vadeTarihi(2026, 11, 5), '2026-11-05');
});

test('vadeTakvimi her ayın belirtilen gününü üretir', () => {
  const v = H.vadeTakvimi('2026-01-10', 5, '2026-04-20');
  assert.deepEqual(v, ['2026-02-05', '2026-03-05', '2026-04-05']);
});

test('vadeTakvimi başlangıç ayının günü geçmişse o ayı atlar', () => {
  const v = H.vadeTakvimi('2026-01-10', 20, '2026-03-01');
  assert.deepEqual(v, ['2026-01-20', '2026-02-20']);
});

test('mahsup en eski vadeden başlayarak öder', () => {
  const vadeler = ['2026-01-05', '2026-02-05', '2026-03-05'];
  const r = H.mahsup(vadeler, [{ tutar: 1200, tarih: '2026-01-06' }, { tutar: 500, tarih: '2026-02-07' }], 1200, '2026-03-10');
  assert.equal(r.vadeler[0].durum, 'odendi');
  assert.equal(r.vadeler[1].odenen, 500);
  assert.equal(r.vadeler[1].kalan, 700);
  assert.equal(r.vadeler[1].durum, 'gecikti');
  assert.equal(r.vadeler[2].durum, 'gecikti');
});

test('mahsup fazla ödemeyi avans olarak döner', () => {
  const r = H.mahsup(['2026-01-05'], [{ tutar: 2000, tarih: '2026-01-06' }], 1200, '2026-01-10');
  assert.equal(r.vadeler[0].durum, 'odendi');
  assert.equal(r.fazla, 800);
});

test('ozet borç ve sonraki vadeyi doğru hesaplar', () => {
  const ogr = { baslangic: '2026-01-05', aylik_ucret: 1000, odeme_gunu: 5 };
  const od = [
    { tutar: 1000, tarih: '2026-01-05' },
    { tutar: 1000, tarih: '2026-02-06' },
  ];
  const z = H.ozet(ogr, od, '2026-04-10');
  // vadeler: 01-05, 02-05, 03-05, 04-05 → 2 ödendi, 2 gecikmiş
  assert.equal(z.vade_sayisi, 4);
  assert.equal(z.odenmis_vade_sayisi, 2);
  assert.equal(z.borc, 2000);
  assert.equal(z.durum, 'gecikti');
  assert.equal(z.en_eski_odeme.vade, '2026-03-05');
});

test('ozet her şey ödendiğinde güncel der', () => {
  const ogr = { baslangic: '2026-01-05', aylik_ucret: 1000, odeme_gunu: 5 };
  const od = [{ tutar: 3000, tarih: '2026-03-01' }];
  const z = H.ozet(ogr, od, '2026-03-10');
  assert.equal(z.borc, 0);
  assert.equal(z.durum, 'odendi');
  assert.equal(z.sonraki_vade, '2026-04-05');
  assert.equal(z.sonraki_vade_gun, 26);
});

test('ozet vadesi 7 gün içindeyse yaklaşıyor der', () => {
  const ogr = { baslangic: '2026-01-05', aylik_ucret: 1000, odeme_gunu: 5 };
  const z = H.ozet(ogr, [{ tutar: 3000, tarih: '2026-04-01' }], '2026-04-03');
  assert.equal(z.durum, 'yaklasiyor');
  assert.equal(z.sonraki_vade, '2026-04-05');
});

test('aylık ücret 0 ise vade üretilmez, borç oluşmaz', () => {
  const z = H.ozet({ baslangic: '2026-01-05', aylik_ucret: 0, odeme_gunu: 5 }, [], '2026-06-01');
  assert.equal(z.borc, 0);
  assert.equal(z.vade_sayisi, 0);
});

test('gunFarki ve ayEkle', () => {
  assert.equal(H.gunFarki('2026-03-01', '2026-02-28'), 1);
  assert.equal(H.ayEkle('2026-01-31', 1), '2026-02-28');
  assert.equal(H.ayEkle('2026-12-15', 1), '2027-01-15');
});

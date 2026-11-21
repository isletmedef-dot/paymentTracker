'use strict';
const test = require('node:test');
const assert = require('node:assert');
const EX = require('../lib/excel');

test('eslemeOner Türkçe başlıkları tanır', () => {
  const r = EX.eslemeOner(['Ad Soyad', 'Veli Adı', 'Telefon', 'Aylık Ücret', 'Ödeme Günü', 'Başlangıç', 'Bilinmeyen']);
  assert.equal(r.kolonlar.ad, 0);
  assert.equal(r.kolonlar.veli, 1);
  assert.equal(r.kolonlar.telefon, 2);
  assert.equal(r.kolonlar.ucret, 3);
  assert.equal(r.kolonlar.odeme_gunu, 4);
  assert.equal(r.kolonlar.baslangic, 5);
  assert.equal(r.mod, 'ogrenci');
  assert.equal(r.taninmayan.length, 1);
});

test('eslemeOner sırasız sütunlarla da çalışır', () => {
  const r = EX.eslemeOner(['Ödeme Tarihi', 'Tutar', 'Öğrenci']);
  assert.equal(r.mod, 'odeme');
  assert.equal(r.kolonlar.tarih, 0);
  assert.equal(r.kolonlar.ucret, 1);
  assert.equal(r.kolonlar.ad, 2);
});

test('onizle öğrenci kayıtlarını üretir ve ödeme gününü başlangıçtan çıkarır', () => {
  const kolonlar = { ad: 0, veli: 1, ucret: 2, baslangic: 3 };
  const satirlar = [['Ayşe Yılmaz', 'Fatma Yılmaz', 1200, '2026-11-08']];
  const r = EX.onizle('ogrenci', kolonlar, satirlar, '2026-11-21');
  assert.equal(r.kayitlar.length, 1);
  assert.equal(r.kayitlar[0].ad, 'Ayşe Yılmaz');
  assert.equal(r.kayitlar[0].aylik_ucret, 1200);
  assert.equal(r.kayitlar[0].odeme_gunu, 8);
  assert.equal(r.kayitlar[0].baslangic, '2026-11-08');
});

test('onizle ödeme kaydında tarih/tutar eksikse hataya yazar', () => {
  const kolonlar = { ad: 0, ucret: 1, tarih: 2 };
  const r = EX.onizle('odeme', kolonlar, [['Can Demir', '', '2026-11-05'], ['Ali Veli', 500, '']], '2026-11-21');
  assert.equal(r.kayitlar.length, 0);
  assert.equal(r.hatalar.length, 2);
});

test('onizle boş satırları sessizce atlar', () => {
  const r = EX.onizle('ogrenci', { ad: 0 }, [['', ''], [null, null]], '2026-11-21');
  assert.equal(r.kayitlar.length, 0);
  assert.equal(r.hatalar.length, 0);
});

test('sablonUret geçerli bir xlsx üretir ve geri okunabilir', async () => {
  const b = await EX.sablonUret();
  assert.ok(b.length > 1000);
  const { sayfalar } = await EX.calismaKitabiOku(b, 'sablon.xlsx');
  const adlar = sayfalar.map((s) => s.ad);
  assert.ok(adlar.includes('Öğrenciler'));
  assert.ok(adlar.includes('Ödemeler'));
  const ogr = sayfalar.find((s) => s.ad === 'Öğrenciler');
  assert.equal(ogr.basliklar[0], 'Ad Soyad');
  const oneri = EX.eslemeOner(ogr.basliklar);
  assert.equal(oneri.mod, 'ogrenci');
  assert.equal(oneri.kolonlar.ucret, 3);
});

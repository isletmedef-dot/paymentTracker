'use strict';
/**
 * PDF fiş okuma testleri — YEREL çalışır, anahtar/ağ gerekmez.
 * fixtures/ornek-dekont.pdf : gerçek bir banka dekontu PDF'i (metin katmanlı)
 * fixtures/taranmis.pdf     : yalnızca görüntü içeren PDF (metin katmanı yok)
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const pdf = require('../lib/pdf');

const DEKONT = path.join(__dirname, 'fixtures', 'ornek-dekont.pdf');
const TARANMIS = path.join(__dirname, 'fixtures', 'taranmis.pdf');

test('paraDegeri Türkçe para biçimlerini okur', () => {
  assert.equal(pdf.paraDegeri('1.000,00 TL'), 1000);
  assert.equal(pdf.paraDegeri('12.500,50'), 12500.5);
  assert.equal(pdf.paraDegeri('900 TL'), 900);
  assert.equal(pdf.paraDegeri('1.200'), 1200);
  assert.equal(pdf.paraDegeri('yazı'), null);
});

test('tariheCevir gün.ay.yıl, ISO ve 2 haneli yılı çevirir', () => {
  assert.equal(pdf.tariheCevir('18.11.2026'), '2026-11-18');
  assert.equal(pdf.tariheCevir('5.11.2026 14:32'), '2026-11-05');
  assert.equal(pdf.tariheCevir('2026-11-18'), '2026-11-18');
  assert.equal(pdf.tariheCevir('18.11.26'), '2026-11-18');
});

test('etiketliDeger etiketli satırı ve alt satırı bulur', () => {
  assert.equal(pdf.etiketliDeger('Gönderen: Ali Veli\nTutar 100 TL', ['Gönderen']), 'Ali Veli');
  assert.equal(pdf.etiketliDeger('Alıcı\nÜreten Çocuk', ['Alıcı']), 'Üreten Çocuk');
  assert.equal(pdf.etiketliDeger('başka satır', ['Gönderen']), null);
});

test('gerçek PDF dekontundan metin çıkarılır (metin katmanı)', async () => {
  const { metin, sayfa_sayisi } = await pdf.metinCikar(fs.readFileSync(DEKONT));
  assert.equal(sayfa_sayisi, 1);
  assert.match(metin, /ZİRAAT BANKASI/);
  assert.match(metin, /Zeynep Demir/);
  assert.ok(pdf.metinYeterli(metin));
});

test('PDF metninden tutar, tarih, isim ve yöntem çıkarılır', async () => {
  const { metin } = await pdf.metinCikar(fs.readFileSync(DEKONT));
  const v = pdf.metindenAlanlariCikar(metin);
  assert.equal(v.tutar, 1000);
  assert.equal(v.tarih, '2026-11-18');
  assert.equal(v.gonderen, 'Zeynep Demir');
  assert.equal(v.alici, 'Üreten Çocuk Oyun Atölyesi');
  assert.match(v.aciklama, /Can Demir/);
  assert.equal(v.yontem, 'Havale');
  assert.equal(v.kaynak, 'pdf-metin');
  assert.ok(v.guven >= 90, 'yüksek güven bekleniyordu: ' + v.guven);
});

test('taranmış PDF metin katmanı içermez', async () => {
  const { metin } = await pdf.metinCikar(fs.readFileSync(TARANMIS));
  assert.equal(pdf.metinYeterli(metin), false, 'metin: ' + JSON.stringify(metin.slice(0, 80)));
});

test('fisiCoz PDF için yerel yolu seçer, anahtar istemez', async () => {
  const eski = process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_API_KEY; // anahtar yokken de çalışmalı
  const fis = require('../lib/fis');
  const r = await fis.fisiCoz(fs.readFileSync(DEKONT), 'application/pdf');
  assert.equal(r.ok, true, r.hata);
  assert.equal(r.yol, 'pdf-metin');
  assert.equal(r.veri.tutar, 1000);
  if (eski) process.env.OPENROUTER_API_KEY = eski;
});

test('fisiCoz taranmış PDF için ekran görüntüsü ister', async () => {
  const fis = require('../lib/fis');
  const r = await fis.fisiCoz(fs.readFileSync(TARANMIS), 'application/pdf');
  assert.equal(r.ok, false);
  assert.equal(r.yol, 'pdf-taranmis');
  assert.match(r.hata, /ekran görüntüsü/i);
});

test('fisiCoz anahtarsız görselde ne yapılacağını söyler', async () => {
  const eski = process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  const fis = require('../lib/fis');
  const r = await fis.fisiCoz(Buffer.from('89504e47', 'hex'), 'image/png');
  assert.equal(r.ok, false);
  assert.match(r.hata, /OPENROUTER_API_KEY/);
  if (eski) process.env.OPENROUTER_API_KEY = eski;
});

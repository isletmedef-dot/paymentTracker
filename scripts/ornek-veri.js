'use strict';
/**
 * ÖRNEK (DEMO) VERİ — sadece arayüzü denemek/önizlemek için.
 * Uydurma isimler kullanır; gerçek müşteri verisi içermez.
 *
 * Kullanım:  node scripts/ornek-veri.js [sunucu]
 * Boş veritabanında çalıştırın. Mevcut öğrenci varsa hiçbir şey yapmaz
 * (--zorla ile yine de ekler).
 */
const T = process.argv.find((a) => a.startsWith('http')) || 'http://127.0.0.1:3400';
const ZORLA = process.argv.includes('--zorla');
const fs = require('fs');
const path = require('path');

async function istek(yol, secenek) {
  const r = await fetch(T + yol, secenek);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${yol} → ${j.hata || r.status}`);
  return j;
}
const post = (g) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(g) });

const gun = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Istanbul' }).format(d);
};
const ay = (kaydir, gunNo) => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + kaydir);
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}-${String(gunNo).padStart(2, '0')}`;
};

(async () => {
  const mevcut = await istek('/api/ogrenciler');
  if (mevcut.ogrenciler.length && !ZORLA) {
    console.log(`Veritabanında zaten ${mevcut.ogrenciler.length} öğrenci var. Örnek veri eklenmedi.`);
    console.log('Yine de eklemek için: node scripts/ornek-veri.js --zorla');
    return;
  }

  // [ad, veli, telefon, aylık ücret, ödeme günü, kaç ay önce başladı, kaç ay borçlu]
  const liste = [
    ['Ayşe Yılmaz', 'Fatma Yılmaz', '05001112233', 1200, 5, 3, 2],
    ['Burak Taş', 'Hale Taş', '05007654321', 1100, 15, 3, 0],
    ['Elif Kaya', 'Murat Kaya', '05007778899', 900, 1, 4, 1],
    ['Can Demir', 'Zeynep Demir', '05004445566', 1000, Number(gun(2).slice(8, 10)), 2, 0],
    ['Deniz Ak', 'Selin Ak', '05001234567', 1500, 10, 2, 0],
    ['Mert Öz', 'Aylin Öz', '05323334455', 1250, 20, 1, 0],
    ['Zehra Çelik', 'Onur Çelik', '05351119988', 800, 12, 1, 1],
    ['Kerem Aslan', 'Derya Aslan', '05442223344', 1300, 8, 1, 0],
  ];

  const bugunGun = Number(gun(0).slice(8, 10));
  const idler = {};
  for (const [ad, veli, telefon, ucret, gunu, geriAy, borclu] of liste) {
    // Bu öğrenci için bugüne kadar oluşmuş vade sayısı
    const vadeSayisi = geriAy + (bugunGun >= gunu ? 1 : 0);
    const odenen = Math.max(0, vadeSayisi - borclu);
    const r = await istek('/api/ogrenciler', post({
      ad, veli, telefon, aylik_ucret: ucret, odeme_gunu: gunu, baslangic: ay(-geriAy, gunu),
    }));
    idler[ad] = r.id;
    for (let i = 0; i < odenen; i++) {
      await istek('/api/odemeler', post({
        student_id: r.id, tutar: ucret, tarih: ay(-geriAy + i, gunu),
        yontem: ['Havale', 'EFT', 'Nakit', 'Kredi Kartı'][i % 4],
      }));
    }
  }

  // Pasif öğrenci (durum çipini göstermek için)
  await istek('/api/ogrenciler', post({
    ad: 'Selin Ateş', veli: 'Banu Ateş', telefon: '05009998877',
    aylik_ucret: 1000, odeme_gunu: 3, baslangic: ay(-2, 3), durum: 'Pasif',
  }));

  // Eşleşmeyen fiş örneği (görsel varsa bağlanır)
  const gorsel = path.join(__dirname, '..', 'fisler', 'ornek-fis.png');
  let fisYolu = null;
  if (fs.existsSync(gorsel)) fisYolu = gorsel;
  const db = require('../lib/db');
  await db.init();
  await db.run(
    "INSERT INTO payments(student_id,tutar,tarih,yontem,kaynak,fis_dosya,fis_metin,dogrulandi,created_at) VALUES(NULL,?,?,?,?,?,?,0,?)",
    [1000, gun(-1), 'Havale', 'telegram', fisYolu,
      JSON.stringify({ gonderen: 'Hakan Uysal', tutar: 1000, tarih: gun(-1), yontem: 'Havale', guven: 45 }),
      new Date().toISOString()]
  );

  const o = await istek('/api/ozet');
  console.log(`Örnek veri eklendi: ${o.ogrenci_sayisi} öğrenci, ${o.gecikmis_sayisi} gecikmiş, toplam borç ${o.toplam_borc} TL.`);
  console.log('Not: Bu veriler uydurmadır. Gerçek kullanım için database.db dosyasını silip yeniden başlatın.');
})().catch((e) => { console.error('HATA:', e.message); process.exit(1); });

'use strict';
/**
 * Telegram botu uçtan uca testi — sahte (stub) Telegram ve model sunucularıyla.
 * Gerçek Telegram'a veya gerçek modele bağlanmaz; bu yüzden anahtar gerekmez.
 */
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const FIS_KLASOR = path.join(os.tmpdir(), 'ot-test-fisler');
process.env.TELEGRAM_BOT_TOKEN = 'TEST:TOKEN';
process.env.TELEGRAM_CHAT_ID = '999';
process.env.FIS_KLASOR = FIS_KLASOR;

const gonderilenler = [];
let bekleyenGuncellemeler = [];
let modelCevabi = { tutar: 1000, tarih: '2026-11-18', gonderen: 'Zeynep Demir', ogrenci: 'Can Demir', yontem: 'Havale', guven: 95 };
let modelDurum = 200;
let PDF_ICERIK = null;

const RESIM = Buffer.from(
  '89504e470d0a1a0a0000000d494844520000000100000001080600000' + '01f15c4890000000a49444154789c6360000002000100' + '05fe02fea7' + '0000000049454e44ae426082', 'hex');

const sunucu = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const cevap = (o, kod = 200) => { res.writeHead(kod, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };

  if (u.pathname === '/api/v1/chat/completions') {
    if (modelDurum !== 200) return cevap({ error: { message: 'model hatası' } }, modelDurum);
    return cevap({ choices: [{ message: { content: '```json\n' + JSON.stringify(modelCevabi) + '\n```' } }] });
  }
  if (u.pathname === '/botTEST:TOKEN/getMe') return cevap({ ok: true, result: { username: 'test_bot' } });
  if (u.pathname === '/botTEST:TOKEN/getUpdates') {
    if (u.searchParams.get('offset') === '-1') return cevap({ ok: true, result: [] });
    const c = bekleyenGuncellemeler;
    bekleyenGuncellemeler = [];
    return cevap({ ok: true, result: c });
  }
  if (u.pathname === '/botTEST:TOKEN/getFile') return cevap({ ok: true, result: { file_path: PDF_ICERIK ? 'fis/dekont.pdf' : 'fis/test.png' } });
  if (u.pathname.startsWith('/file/bot') || u.pathname === '/fis/test.png') {
    const icerik = PDF_ICERIK || RESIM;
    res.writeHead(200, { 'Content-Type': icerik === RESIM ? 'image/png' : 'application/pdf' });
    return res.end(icerik);
  }
  if (u.pathname === '/botTEST:TOKEN/sendMessage') {
    let govde = '';
    req.on('data', (d) => (govde += d));
    return req.on('end', () => { gonderilenler.push(JSON.parse(govde)); cevap({ ok: true, result: { message_id: gonderilenler.length } }); });
  }
  cevap({ ok: false, description: 'bilinmeyen yol: ' + u.pathname }, 404);
});

const bekle = (ms) => new Promise((r) => setTimeout(r, ms));
const son = () => gonderilenler[gonderilenler.length - 1].text;
const sonrakiGuncelleme = (g) => new Promise((r) => { bekleyenGuncellemeler.push(g); setTimeout(r, 120); });

test.before(async () => {
  await new Promise((r) => sunucu.listen(0, '127.0.0.1', r));
  const p = sunucu.address().port;
  process.env.TELEGRAM_API_BASE = `http://127.0.0.1:${p}`;
  process.env.OPENROUTER_API_BASE = `http://127.0.0.1:${p}/api/v1`;
  process.env.OPENROUTER_API_KEY = 'test';
  process.env.DB_PATH = path.join(os.tmpdir(), 'ot-test-' + Date.now() + '.db');
  fs.rmSync(process.env.DB_PATH, { force: true });
  fs.rmSync(FIS_KLASOR, { recursive: true, force: true });

  const db = require('../lib/db');
  await db.init();
  await db.run("INSERT INTO students(ad,veli,telefon,aylik_ucret,odeme_gunu,baslangic,durum,created_at) VALUES('Can Demir','Zeynep Demir','0500',1000,18,'2026-11-01','Aktif','x')");
  await db.run("INSERT INTO students(ad,veli,telefon,aylik_ucret,odeme_gunu,baslangic,durum,created_at) VALUES('Elif Kaya','Murat Kaya','0501',900,5,'2026-11-01','Aktif','x')");

  const telegram = require('../lib/telegram');
  await telegram.baslat();
  await bekle(300);
});

test.after(() => {
  require('../lib/telegram').durdur();
  sunucu.close();
});

test('fiş fotoğrafı okunur, öğrenciye bağlanır ve onay mesajı gider', async () => {
  await sonrakiGuncelleme({
    update_id: 1,
    message: { message_id: 1, chat: { id: 999 }, photo: [{ file_id: 'kucuk', width: 90 }, { file_id: 'buyuk', width: 900 }] },
  });
  await bekle(1200);
  assert.ok(gonderilenler.length >= 2, 'okunuyor + sonuç mesajı bekleniyordu');
  assert.match(son(), /Ödeme kaydedildi/);
  assert.match(son(), /Can Demir/);
  assert.match(son(), /1\.000 TL/);

  const db = require('../lib/db');
  const p = await db.get('SELECT * FROM payments ORDER BY id DESC LIMIT 1');
  assert.equal(p.student_id, 1);
  assert.equal(p.tutar, 1000);
  assert.equal(p.tarih, '2026-11-18');
  assert.equal(p.dogrulandi, 1);
  assert.equal(p.kaynak, 'telegram');
  assert.ok(p.fis_dosya && fs.existsSync(p.fis_dosya), 'fiş dosyası diske yazılmalı');
});

test('isim okunamazsa kayıt onay bekleyen olarak saklanır', async () => {
  modelCevabi = { tutar: 1500, tarih: '2026-11-19', gonderen: 'Tanınmayan Kişi', ogrenci: null, yontem: 'EFT', guven: 40 };
  await sonrakiGuncelleme({ update_id: 2, message: { message_id: 2, chat: { id: 999 }, photo: [{ file_id: 'x', width: 900 }] } });
  await bekle(1200);
  assert.match(son(), /onay bekliyor/);
  const db = require('../lib/db');
  const p = await db.get('SELECT * FROM payments ORDER BY id DESC LIMIT 1');
  assert.equal(p.dogrulandi, 0);
  assert.equal(p.student_id, null);
  modelCevabi = { tutar: 1000, tarih: '2026-11-18', gonderen: 'Zeynep Demir', ogrenci: 'Can Demir', yontem: 'Havale', guven: 95 };
});

test('model hata verirse fiş kaybolmaz, okunamadı olarak saklanır', async () => {
  modelDurum = 500;
  await sonrakiGuncelleme({ update_id: 3, message: { message_id: 3, chat: { id: 999 }, photo: [{ file_id: 'x', width: 900 }] } });
  await bekle(1200);
  assert.match(son(), /okunamadı/i);
  const db = require('../lib/db');
  const p = await db.get('SELECT * FROM payments ORDER BY id DESC LIMIT 1');
  assert.equal(p.dogrulandi, 0);
  assert.match(p.fis_metin, /OKUNAMADI/);
  modelDurum = 200;
});

test('/durum gecikmiş ödemeleri listeler', async () => {
  await sonrakiGuncelleme({ update_id: 4, message: { message_id: 4, chat: { id: 999 }, text: '/durum' } });
  await bekle(600);
  assert.match(son(), /Ödeme Özeti/);
  assert.match(son(), /Elif Kaya/);
});

test('/liste öğrencileri gösterir', async () => {
  await sonrakiGuncelleme({ update_id: 5, message: { message_id: 5, chat: { id: 999 }, text: '/liste' } });
  await bekle(600);
  assert.match(son(), /Can Demir/);
  assert.match(son(), /Elif Kaya/);
});

test('/ode ile elle ödeme kaydedilir', async () => {
  await sonrakiGuncelleme({ update_id: 6, message: { message_id: 6, chat: { id: 999 }, text: '/ode Elif 900' } });
  await bekle(600);
  assert.match(son(), /Elif Kaya için 900 TL ödeme kaydedildi/);
  const db = require('../lib/db');
  const p = await db.get("SELECT * FROM payments WHERE student_id=2 AND kaynak='telegram' AND dogrulandi=1 ORDER BY id DESC LIMIT 1");
  assert.ok(p, 'elle kayıt bulunmalı');
  assert.equal(p.tutar, 900);
});

test('/ode bilinmeyen isimde uyarır', async () => {
  await sonrakiGuncelleme({ update_id: 7, message: { message_id: 7, chat: { id: 999 }, text: '/ode Zzz 100' } });
  await bekle(600);
  assert.match(son(), /bulamadım/);
});

test('/yardim komut listesini gönderir', async () => {
  await sonrakiGuncelleme({ update_id: 8, message: { message_id: 8, chat: { id: 999 }, text: '/yardim' } });
  await bekle(600);
  assert.match(son(), /Ödeme Takip Botu/);
  assert.match(son(), /\/durum/);
});

test('günlük bildirim metni gecikmiş ve yaklaşanı içerir', async () => {
  const bildirim = require('../lib/bildirim');
  // Bu tarihte Elif Kaya'nın 5 Aralık vadesi geçmiş olur (5 Kasım ödenmişti).
  const m = await bildirim.bildirimMetni('2026-12-20');
  assert.ok(m, 'bildirim metni üretilmeli');
  assert.match(m, /Ödeme Hatırlatması/);
  assert.match(m, /Elif Kaya/);
  assert.match(m, /Gecikmiş ödemeler/);
});

test('borcu olmayan ve yaklaşan vadesi olmayan günde bildirim üretilmez', async () => {
  const bildirim = require('../lib/bildirim');
  const m = await bildirim.bildirimMetni('2026-11-21');
  assert.equal(m, null);
});

test('PDF dekont Telegram üzerinden YEREL olarak okunur (anahtar gerekmez)', async () => {
  PDF_ICERIK = fs.readFileSync(path.join(__dirname, 'fixtures', 'ornek-dekont.pdf'));
  const eskiAnahtar = process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_API_KEY; // PDF yolu anahtara hiç bakmamalı
  try {
    await sonrakiGuncelleme({
      update_id: 9,
      message: { message_id: 9, chat: { id: 999 }, document: { file_id: 'pdf1', mime_type: 'application/pdf', file_name: 'dekont.pdf' } },
    });
    await bekle(1800);
    assert.match(son(), /Ödeme kaydedildi/);
    assert.match(son(), /PDF metninden okundu/);
    assert.match(son(), /1\.000 TL/);
    const db = require('../lib/db');
    const p = await db.get('SELECT * FROM payments ORDER BY id DESC LIMIT 1');
    assert.equal(p.student_id, 1, 'Can Demir eşleşmeli');
    assert.equal(p.tutar, 1000);
    assert.equal(p.tarih, '2026-11-18');
    assert.equal(p.dogrulandi, 1);
    assert.match(p.fis_metin, /ZİRAAT BANKASI/, 'PDF metni kayda geçmeli');
  } finally {
    PDF_ICERIK = null;
    if (eskiAnahtar) process.env.OPENROUTER_API_KEY = eskiAnahtar;
  }
});

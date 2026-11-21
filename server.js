'use strict';
/**
 * Ödeme Takip — sunucu.
 * Bağımsız çalışır: kendi database.db dosyası, kendi .env dosyası.
 * Varsayılan olarak yalnızca yerel ağdan erişilebilir (127.0.0.1:3400).
 */
const path = require('path');
const fs = require('fs');
const express = require('express');

/* ------------------------- .env okuma ------------------------- */
(function envYukle() {
  const p = path.join(__dirname, '.env');
  if (!fs.existsSync(p)) return;
  for (const satir of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(satir);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] == null) process.env[m[1]] = v;
  }
})();

process.env.TZ = process.env.TZ || 'Europe/Istanbul';

const DB = require('./lib/db');
const H = require('./lib/hesap');
const FIS = require('./lib/fis');
const EXCEL = require('./lib/excel');
const telegram = require('./lib/telegram');
const bildirim = require('./lib/bildirim');

const app = express();
app.use(express.json({ limit: '40mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const PORT = parseInt(process.env.PORT || '3400', 10);
const HOST = process.env.HOST || '127.0.0.1';

/* ------------------------- yardımcılar ------------------------- */

function hata(res, kod, mesaj) { return res.status(kod).json({ hata: mesaj }); }
const tarihMi = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

/** Öğrenci + özet üretir. */
async function ogrenciOzetli(o, bugunT = H.bugun()) {
  const od = await DB.all('SELECT * FROM payments WHERE student_id=? AND dogrulandi=1 ORDER BY tarih DESC, id DESC', [o.id]);
  const z = H.ozet(o, od, bugunT);
  return {
    ...o,
    ozet: {
      durum: z.durum,
      borc: z.borc,
      alacak: z.alacak,
      odenen_toplam: z.odenen_toplam,
      beklenen_toplam: z.beklenen_toplam,
      odenmis_vade_sayisi: z.odenmis_vade_sayisi,
      vade_sayisi: z.vade_sayisi,
      gecikmis_sayisi: z.gecikmis_sayisi,
      sonraki_vade: z.sonraki_vade,
      sonraki_vade_gun: z.sonraki_vade_gun,
      en_eski_odeme: z.en_eski_odeme,
      son_odeme: z.son_odeme ? { tarih: z.son_odeme.tarih, tutar: z.son_odeme.tutar } : null,
    },
  };
}

/* ------------------------- API: özet ------------------------- */

app.get('/api/ozet', async (req, res) => {
  try {
    const bugunT = H.bugun();
    const ogrenciler = await DB.all("SELECT * FROM students WHERE durum='Aktif' ORDER BY ad");
    let toplamBorc = 0, gecikmisSayisi = 0, aylikToplam = 0;
    const yaklasan = [];
    for (const o of ogrenciler) {
      const z = await ogrenciOzetli(o, bugunT);
      aylikToplam += Number(o.aylik_ucret) || 0;
      if (z.ozet.borc > 0) { toplamBorc += z.ozet.borc; gecikmisSayisi++; }
      if (z.ozet.sonraki_vade_gun != null && z.ozet.sonraki_vade_gun >= 0 && z.ozet.sonraki_vade_gun <= 7) {
        yaklasan.push({ id: o.id, ad: o.ad, veli: o.veli, telefon: o.telefon, tarih: z.ozet.sonraki_vade, gun: z.ozet.sonraki_vade_gun, tutar: Number(o.aylik_ucret) || 0 });
      }
    }
    const ayBasi = bugunT.slice(0, 8) + '01';
    const buAy = await DB.get("SELECT COALESCE(SUM(tutar),0) AS t FROM payments WHERE dogrulandi=1 AND tarih>=?", [ayBasi]);
    const bekleyenFis = await DB.get('SELECT COUNT(*) AS t FROM payments WHERE dogrulandi=0');
    res.json({
      bugun: bugunT,
      ogrenci_sayisi: ogrenciler.length,
      aylik_beklenen: H.round2(aylikToplam),
      toplam_borc: H.round2(toplamBorc),
      gecikmis_sayisi: gecikmisSayisi,
      bu_ay_tahsilat: H.round2(buAy.t),
      bekleyen_fis: bekleyenFis.t,
      yaklasan: yaklasan.sort((a, b) => a.gun - b.gun),
    });
  } catch (e) { hata(res, 500, e.message); }
});

/* ------------------------- API: öğrenciler ------------------------- */

app.get('/api/ogrenciler', async (req, res) => {
  try {
    const ara = (req.query.ara || '').toString().trim();
    const bugunT = H.bugun();
    let ogrenciler = await DB.all('SELECT * FROM students ORDER BY ad');
    const liste = [];
    for (const o of ogrenciler) {
      const z = await ogrenciOzetli(o, bugunT);
      if (ara) {
        const h = FIS.normalize(`${o.ad} ${o.veli || ''} ${o.telefon || ''}`);
        if (!h.includes(FIS.normalize(ara))) continue;
      }
      liste.push(z);
    }
    const sira = { gecikti: 0, bugun: 1, yaklasiyor: 2, bekliyor: 3, odendi: 4 };
    liste.sort((a, b) => (sira[a.ozet.durum] ?? 9) - (sira[b.ozet.durum] ?? 9) || a.ad.localeCompare(b.ad, 'tr'));
    res.json({ ogrenciler: liste, bugun: bugunT });
  } catch (e) { hata(res, 500, e.message); }
});

app.get('/api/ogrenciler/:id', async (req, res) => {
  try {
    const o = await DB.get('SELECT * FROM students WHERE id=?', [req.params.id]);
    if (!o) return hata(res, 404, 'Öğrenci bulunamadı');
    const bugunT = H.bugun();
    const odemeler = await DB.all('SELECT * FROM payments WHERE student_id=? ORDER BY tarih DESC, id DESC', [o.id]);
    const onayli = odemeler.filter((x) => x.dogrulandi === 1);
    const z = H.ozet(o, onayli, bugunT);
    // Önümüzdeki 12 vade
    const ileri = H.vadeTakvimi(o.baslangic, o.odeme_gunu || H.varsayilanOdemeGunu(o.baslangic), H.ayEkle(bugunT, 12));
    const harita = new Map(z.vadeler.map((s) => [s.vade, s]));
    const gelecek = ileri.filter((v) => v >= bugunT).map((v) => harita.get(v) || { vade: v, beklenen: Number(o.aylik_ucret) || 0, odenen: 0, kalan: Number(o.aylik_ucret) || 0, durum: 'bekliyor' });
    res.json({ ogrenci: o, ozet: { ...z, vadeler: z.vadeler.slice(-24) }, gelecek_vadeler: gelecek, odemeler });
  } catch (e) { hata(res, 500, e.message); }
});

function ogrenciAlanlari(g) {
  return {
    ad: String(g.ad || '').trim(),
    veli: g.veli ? String(g.veli).trim() : null,
    telefon: g.telefon ? String(g.telefon).replace(/[^\d+]/g, '') : null,
    aylik_ucret: H.round2(g.aylik_ucret),
    odeme_gunu: g.odeme_gunu ? Math.max(1, Math.min(31, parseInt(g.odeme_gunu, 10))) : null,
    baslangic: tarihMi(g.baslangic) ? g.baslangic : H.bugun(),
    durum: g.durum === 'Pasif' ? 'Pasif' : 'Aktif',
    not_metni: g.not_metni ? String(g.not_metni).trim() : null,
  };
}

app.post('/api/ogrenciler', async (req, res) => {
  try {
    const a = ogrenciAlanlari(req.body || {});
    if (!a.ad) return hata(res, 400, 'Öğrenci adı zorunlu');
    if (!a.odeme_gunu) a.odeme_gunu = H.varsayilanOdemeGunu(a.baslangic);
    const r = await DB.run(
      'INSERT INTO students(ad,veli,telefon,aylik_ucret,odeme_gunu,baslangic,durum,not_metni,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
      [a.ad, a.veli, a.telefon, a.aylik_ucret, a.odeme_gunu, a.baslangic, a.durum, a.not_metni, new Date().toISOString()]
    );
    res.json({ ok: true, id: r.lastID });
  } catch (e) { hata(res, 500, e.message); }
});

app.put('/api/ogrenciler/:id', async (req, res) => {
  try {
    const o = await DB.get('SELECT * FROM students WHERE id=?', [req.params.id]);
    if (!o) return hata(res, 404, 'Öğrenci bulunamadı');
    const a = ogrenciAlanlari({ ...o, ...req.body });
    if (!a.ad) return hata(res, 400, 'Öğrenci adı zorunlu');
    if (!a.odeme_gunu) a.odeme_gunu = H.varsayilanOdemeGunu(a.baslangic);
    await DB.run('UPDATE students SET ad=?,veli=?,telefon=?,aylik_ucret=?,odeme_gunu=?,baslangic=?,durum=?,not_metni=? WHERE id=?',
      [a.ad, a.veli, a.telefon, a.aylik_ucret, a.odeme_gunu, a.baslangic, a.durum, a.not_metni, o.id]);
    res.json({ ok: true });
  } catch (e) { hata(res, 500, e.message); }
});

app.delete('/api/ogrenciler/:id', async (req, res) => {
  try {
    const o = await DB.get('SELECT * FROM students WHERE id=?', [req.params.id]);
    if (!o) return hata(res, 404, 'Öğrenci bulunamadı');
    await DB.withTransaction(async () => {
      await DB.run('DELETE FROM payments WHERE student_id=?', [o.id]);
      await DB.run('DELETE FROM students WHERE id=?', [o.id]);
    });
    res.json({ ok: true });
  } catch (e) { hata(res, 500, e.message); }
});

/* ------------------------- API: ödemeler ------------------------- */

app.post('/api/odemeler', async (req, res) => {
  try {
    const b = req.body || {};
    const sid = parseInt(b.student_id, 10);
    const tutar = H.round2(b.tutar);
    const tarih = tarihMi(b.tarih) ? b.tarih : H.bugun();
    if (!sid) return hata(res, 400, 'Öğrenci seçilmedi');
    if (!(tutar > 0)) return hata(res, 400, 'Tutar sıfırdan büyük olmalı');
    const o = await DB.get('SELECT id FROM students WHERE id=?', [sid]);
    if (!o) return hata(res, 404, 'Öğrenci bulunamadı');
    const r = await DB.run(
      "INSERT INTO payments(student_id,tutar,tarih,yontem,kaynak,dogrulandi,created_at) VALUES(?,?,?,?,?,1,?)",
      [sid, tutar, tarih, b.yontem ? String(b.yontem).trim() : null, b.kaynak || 'manuel', new Date().toISOString()]
    );
    res.json({ ok: true, id: r.lastID });
  } catch (e) { hata(res, 500, e.message); }
});

app.delete('/api/odemeler/:id', async (req, res) => {
  try {
    const r = await DB.run('DELETE FROM payments WHERE id=?', [req.params.id]);
    if (!r.changes) return hata(res, 404, 'Ödeme bulunamadı');
    res.json({ ok: true });
  } catch (e) { hata(res, 500, e.message); }
});

/* ------------------------- API: fişler ------------------------- */

app.get('/api/fisler', async (req, res) => {
  try {
    const liste = await DB.all(`
      SELECT p.*, s.ad AS ogrenci_ad FROM payments p
      LEFT JOIN students s ON s.id = p.student_id
      WHERE p.dogrulandi = 0 ORDER BY p.created_at DESC, p.id DESC`);
    res.json({ fisler: liste });
  } catch (e) { hata(res, 500, e.message); }
});

app.get('/api/fisler/:id/dosya', async (req, res) => {
  try {
    const p = await DB.get('SELECT fis_dosya FROM payments WHERE id=?', [req.params.id]);
    if (!p || !p.fis_dosya || !fs.existsSync(p.fis_dosya)) return hata(res, 404, 'Fiş görseli yok');
    res.sendFile(path.resolve(p.fis_dosya));
  } catch (e) { hata(res, 500, e.message); }
});

/** Onay bekleyen fişi bir öğrenciye bağlar (veya siler). */
app.post('/api/fisler/:id/onayla', async (req, res) => {
  try {
    const p = await DB.get('SELECT * FROM payments WHERE id=?', [req.params.id]);
    if (!p) return hata(res, 404, 'Fiş bulunamadı');
    const b = req.body || {};
    const sid = parseInt(b.student_id, 10);
    const tutar = b.tutar != null ? H.round2(b.tutar) : p.tutar;
    const tarih = tarihMi(b.tarih) ? b.tarih : (tarihMi(p.tarih) ? p.tarih : H.bugun());
    if (!sid) return hata(res, 400, 'Öğrenci seçilmedi');
    if (!(tutar > 0)) return hata(res, 400, 'Tutar sıfırdan büyük olmalı');
    await DB.run('UPDATE payments SET student_id=?, tutar=?, tarih=?, yontem=?, dogrulandi=1 WHERE id=?',
      [sid, tutar, tarih, b.yontem ? String(b.yontem) : p.yontem, p.id]);
    const o = await DB.get('SELECT ad FROM students WHERE id=?', [sid]);
    res.json({ ok: true, ogrenci: o && o.ad });
  } catch (e) { hata(res, 500, e.message); }
});

/* ------------------------- API: ayarlar / bildirim ------------------------- */

app.get('/api/ayarlar', async (req, res) => {
  try {
    const a = await DB.all('SELECT key,value FROM settings');
    const harita = Object.fromEntries(a.map((x) => [x.key, x.value]));
    res.json({
      ayarlar: harita,
      ortam: {
        telegram_token_var: !!process.env.TELEGRAM_BOT_TOKEN,
        telegram_chat_var: !!process.env.TELEGRAM_CHAT_ID,
        gorsel_model_var: !!process.env.OPENROUTER_API_KEY,
        gorsel_model: process.env.VISION_MODEL || 'google/gemini-4-neon',
        bildirim_saati: process.env.BILDIRIM_SAATI || '09:00',
      },
    });
  } catch (e) { hata(res, 500, e.message); }
});

app.post('/api/ayarlar', async (req, res) => {
  try {
    const b = req.body || {};
    if (b.hatirlatma_gun != null) {
      const g = Math.max(0, Math.min(30, parseInt(b.hatirlatma_gun, 10) || 0));
      await DB.ayarYaz('hatirlatma_gun', g);
    }
    res.json({ ok: true });
  } catch (e) { hata(res, 500, e.message); }
});

app.post('/api/bildirim/test', async (req, res) => {
  try {
    const r = await bildirim.simdiGonder(true);
    if (!r.ok) return hata(res, 502, r.hata || 'Telegram gönderilemedi');
    res.json({ ok: true, atlandi: r.atlandi || null });
  } catch (e) { hata(res, 500, e.message); }
});

/* ------------------------- API: Excel ------------------------- */

app.get('/api/sablon.xlsx', async (req, res) => {
  try {
    const b = await EXCEL.sablonUret();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="odeme-takip-sablonu.xlsx"');
    res.send(b);
  } catch (e) { hata(res, 500, e.message); }
});

app.post('/api/ice-aktar/onizle', async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.base64) return hata(res, 400, 'Dosya gönderilmedi');
    const buffer = Buffer.from(String(b.base64).replace(/^data:[^,]+,/, ''), 'base64');
    const { sayfalar } = await EXCEL.calismaKitabiOku(buffer, b.dosyaAdi || '');
    if (!sayfalar.length) return hata(res, 400, 'Dosyada sayfa bulunamadı');
    const cikti = sayfalar.map((s, i) => {
      const oneri = EXCEL.eslemeOner(s.basliklar);
      const mod = b.mod || oneri.mod;
      const oz = EXCEL.onizle(mod === 'odeme' ? 'odeme' : 'ogrenci', oneri.kolonlar, s.satirlar, H.bugun());
      return {
        index: i, ad: s.ad, baslikSatiri: s.baslikSatiri,
        basliklar: s.basliklar,
        satir_sayisi: s.satirlar.filter((r) => r.some((c) => String(c || '').trim() !== '')).length,
        onerilen_mod: oneri.mod,
        mod,
        kolonlar: oneri.kolonlar,
        taninmayan: oneri.taninmayan,
        kayit_sayisi: oz.kayitlar.length,
        hatalar: oz.hatalar.slice(0, 20),
        ornek: oz.kayitlar.slice(0, 8),
        _kayitlar: oz.kayitlar,
      };
    });
    res.json({ sayfalar: cikti });
  } catch (e) { hata(res, 500, e.message); }
});

app.post('/api/ice-aktar/uygula', async (req, res) => {
  try {
    const b = req.body || {};
    const buffer = Buffer.from(String(b.base64 || '').replace(/^data:[^,]+,/, ''), 'base64');
    const sayfaIndex = parseInt(b.sayfaIndex, 10) || 0;
    const mod = b.mod === 'odeme' ? 'odeme' : 'ogrenci';
    const { sayfalar } = await EXCEL.calismaKitabiOku(buffer, b.dosyaAdi || '');
    const s = sayfalar[sayfaIndex];
    if (!s) return hata(res, 400, 'Sayfa bulunamadı');
    const kolonlar = b.kolonlar && Object.keys(b.kolonlar).length ? b.kolonlar : EXCEL.eslemeOner(s.basliklar).kolonlar;
    const { kayitlar, hatalar } = EXCEL.onizle(mod, kolonlar, s.satirlar, H.bugun());

    const sonuc = { eklenen: 0, guncellenen: 0, odeme_eklenen: 0, eslesmeyen: [], atlanan: 0, hatalar };
    await DB.withTransaction(async () => {
      for (const k of kayitlar) {
        if (mod === 'ogrenci') {
          const var_olan = await bulOgrenci(k.ad);
          if (var_olan) {
            await DB.run('UPDATE students SET veli=COALESCE(?,veli), telefon=COALESCE(?,telefon), aylik_ucret=?, odeme_gunu=COALESCE(?,odeme_gunu), baslangic=COALESCE(?,baslangic), durum=? WHERE id=?',
              [k.veli, k.telefon, k.aylik_ucret, k.odeme_gunu, k.baslangic, k.durum, var_olan.id]);
            sonuc.guncellenen++;
          } else {
            await DB.run('INSERT INTO students(ad,veli,telefon,aylik_ucret,odeme_gunu,baslangic,durum,not_metni,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
              [k.ad, k.veli, k.telefon, k.aylik_ucret, k.odeme_gunu, k.baslangic, k.durum, k.not_metni, new Date().toISOString()]);
            sonuc.eklenen++;
          }
        } else {
          const o = await bulOgrenci(k.ad);
          if (!o) { sonuc.eslesmeyen.push(k.ad); continue; }
          const var_odeme = await DB.get('SELECT id FROM payments WHERE student_id=? AND tarih=? AND ABS(tutar-?)<0.01', [o.id, k.tarih, k.tutar]);
          if (var_odeme) { sonuc.atlanan++; continue; }
          await DB.run("INSERT INTO payments(student_id,tutar,tarih,yontem,kaynak,dogrulandi,created_at) VALUES(?,?,?,?,'excel',1,?)",
            [o.id, k.tutar, k.tarih, k.yontem || null, new Date().toISOString()]);
          sonuc.odeme_eklenen++;
        }
      }
    });
    res.json({ ok: true, sonuc });
  } catch (e) { hata(res, 500, e.message); }
});

/** İsme göre öğrenci bulur (tam, sonra benzer eşleşme). */
async function bulOgrenci(ad) {
  const hedef = FIS.normalize(ad);
  const ogrenciler = await DB.all('SELECT id, ad, veli FROM students');
  const tam = ogrenciler.find((o) => FIS.normalize(o.ad) === hedef);
  if (tam) return tam;
  const puanli = ogrenciler
    .map((o) => ({ o, p: FIS.normalize(o.ad).includes(hedef) || hedef.includes(FIS.normalize(o.ad)) ? 80 : 0 }))
    .filter((x) => x.p >= 80)
    .sort((a, b) => b.p - a.p);
  return puanli.length === 1 ? puanli[0].o : null;
}

/* ------------------------- başlatma ------------------------- */

app.get('/api/durum', async (req, res) => {
  res.json({ ok: true, surum: require('./package.json').version, db: DB.DB_PATH, bugun: H.bugun() });
});

async function baslat() {
  await DB.init();
  const server = app.listen(PORT, HOST, async () => {
    console.log(`Ödeme Takip çalışıyor →  http://${HOST}:${PORT}`);
    console.log(`Veritabanı: ${DB.DB_PATH}`);
    await telegram.baslat();
    bildirim.baslat();
    // Açılışta bir kez hatırlatma kontrolü (gün içinde gönderilmediyse)
    bildirim.simdiGonder(false).then((r) => {
      if (r && !r.ok && r.hata) console.log('[bildirim] gönderilemedi:', r.hata);
    }).catch(() => {});
  });
  return server;
}

if (require.main === module) {
  baslat().catch((e) => { console.error('Başlatma hatası:', e); process.exit(1); });
}

module.exports = { app, baslat };

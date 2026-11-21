'use strict';
/**
 * Bildirim zamanlayıcısı.
 * Günde bir kez (varsayılan 09:00) vadesi yaklaşan ve gecikmiş ödemeleri
 * Telegram'a tek mesaj halinde gönderir. Uygulama açılışta bir kez de kontrol eder.
 */
const { all, ayar, ayarYaz } = require('./db');
const { bugun, ozet, gunFarki } = require('./hesap');
const telegram = require('./telegram');

const VARSAYILAN_SAAT = '09:00';
const VARSAYILAN_GUN = 3; // kaç gün önce hatırlatılsın

async function hatirlatmaGun() {
  return parseInt(await ayar('hatirlatma_gun', VARSAYILAN_GUN), 10) || VARSAYILAN_GUN;
}

/** Gönderilecek metni üretir; gönderilecek bir şey yoksa null döner. */
async function bildirimMetni(bugunT = bugun()) {
  const gun = await hatirlatmaGun();
  const ogrenciler = await all("SELECT * FROM students WHERE durum='Aktif'");
  const gecikmis = [];
  const yaklasan = [];
  for (const o of ogrenciler) {
    const od = await all('SELECT tutar, tarih FROM payments WHERE student_id=? AND dogrulandi=1', [o.id]);
    const z = ozet(o, od, bugunT);
    if (z.borc > 0) gecikmis.push({ o, z });
    if (z.sonraki_vade && z.sonraki_vade_gun != null && z.sonraki_vade_gun >= 0 && z.sonraki_vade_gun <= gun) {
      yaklasan.push({ o, z });
    }
  }
  if (!gecikmis.length && !yaklasan.length) return null;

  let m = `🔔 <b>Ödeme Hatırlatması</b> — ${bugunT}\n`;
  if (gecikmis.length) {
    const toplam = gecikmis.reduce((s, x) => s + x.z.borc, 0);
    m += `\n🔴 <b>Gecikmiş ödemeler (${gecikmis.length}) — toplam ${toplam.toLocaleString('tr-TR')} TL</b>\n`;
    for (const x of gecikmis) {
      const g = gunFarki(bugunT, x.z.en_eski_odeme.vade);
      m += `• ${x.o.ad}${x.o.veli ? ' (' + x.o.veli + ')' : ''} — <b>${x.z.borc.toLocaleString('tr-TR')} TL</b>, vade ${x.z.en_eski_odeme.vade} (${g} gün gecikti)\n`;
      if (x.o.telefon) m += `   ☎️ ${x.o.telefon}\n`;
    }
  }
  if (yaklasan.length) {
    m += `\n🟡 <b>Yaklaşan ödemeler (${yaklasan.length})</b>\n`;
    for (const x of yaklasan) {
      m += `• ${x.o.ad} — ${x.z.sonraki_vade} (${x.z.sonraki_vade_gun === 0 ? 'bugün' : x.z.sonraki_vade_gun + ' gün sonra'}), ${(Number(x.o.aylik_ucret) || 0).toLocaleString('tr-TR')} TL\n`;
    }
  }
  return m;
}

/** Bir kez çalıştır: bildirim gönder, gönderildiyse tarihini kaydet. */
async function simdiGonder(zorla = false) {
  const bugunT = bugun();
  const son = await ayar('son_bildirim_tarihi', '');
  if (!zorla && son === bugunT) return { ok: true, atlandi: 'bugün zaten gönderildi' };
  const metin = await bildirimMetni(bugunT);
  if (!metin) { await ayarYaz('son_bildirim_tarihi', bugunT); return { ok: true, atlandi: 'bildirim yok' }; }
  const r = await telegram.mesajGonder(metin);
  if (r.ok) await ayarYaz('son_bildirim_tarihi', bugunT);
  return r;
}

let zamanlayici = null;
function baslat() {
  const saat = process.env.BILDIRIM_SAATI || VARSAYILAN_SAAT;
  if (zamanlayici) clearInterval(zamanlayici);
  // Her 10 dakikada bir saati kontrol et; gün içinde bir kez gönderilir.
  zamanlayici = setInterval(async () => {
    try {
      const simdi = new Intl.DateTimeFormat('sv-SE', { timeZone: process.env.TZ || 'Europe/Istanbul', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
      if (simdi >= saat) await simdiGonder(false);
    } catch (e) { console.error('[bildirim] hata:', e.message); }
  }, 10 * 60 * 1000);
  console.log(`[bildirim] günlük kontrol aktif (saat ${saat}).`);
}

module.exports = { baslat, simdiGonder, bildirimMetni, hatirlatmaGun };

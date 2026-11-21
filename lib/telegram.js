'use strict';
/**
 * Telegram bot — uzun yoklama (long polling) ile çalışır, webhook/port gerekmez.
 * Bu sayede sistem sadece kendi bilgisayarınızda çalışsa bile Telegram'a erişir.
 *
 * Gönderilenler : günlük vade/borç bildirimleri, fiş kayıt onayları
 * Alınanlar     : fiş fotoğrafı, /durum /liste /ode /yardim komutları
 */
const fs = require('fs');
const path = require('path');
const { all, get, run, withTransaction, ayar, ayarYaz } = require('./db');
const { bugun, ozet, gunFarki } = require('./hesap');
const { fisiCoz, eslesmeBul } = require('./fis');

const KOK = () => process.env.TELEGRAM_API_BASE || 'https://api.telegram.org';
const API = (token) => `${KOK()}/bot${token}`;

function token() { return process.env.TELEGRAM_BOT_TOKEN || ''; }
function sohbetId() { return process.env.TELEGRAM_CHAT_ID || ''; }

/** Telegram'a mesaj gönderir. chatId verilmezse .env'deki sohbet kullanılır. */
async function mesajGonder(metin, chatId = null, ekstra = {}) {
  const t = token();
  const cid = chatId || sohbetId();
  if (!t) return { ok: false, hata: 'TELEGRAM_BOT_TOKEN tanımlı değil (.env).' };
  if (!cid) return { ok: false, hata: 'TELEGRAM_CHAT_ID tanımlı değil (.env).' };
  try {
    const y = await fetch(`${API(t)}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: cid, text: metin, parse_mode: 'HTML', disable_web_page_preview: true, ...ekstra }),
    });
    const j = await y.json().catch(() => null);
    if (!y.ok || !j || !j.ok) return { ok: false, hata: (j && j.description) || `HTTP ${y.status}` };
    return { ok: true, sonuc: j.result };
  } catch (e) { return { ok: false, hata: e.message }; }
}

async function dosyaIndir(fileId, hedefKlasor, mime = null) {
  const t = token();
  const y = await fetch(`${API(t)}/getFile?file_id=${encodeURIComponent(fileId)}`);
  const j = await y.json();
  if (!j.ok) throw new Error('getFile: ' + (j.description || 'hata'));
  const url = `${KOK()}/file/bot${t}/${j.result.file_path}`;
  const b = await fetch(url);
  if (!b.ok) throw new Error('Dosya indirilemedi: HTTP ' + b.status);
  const buf = Buffer.from(await b.arrayBuffer());
  fs.mkdirSync(hedefKlasor, { recursive: true });
  const ad = path.join(hedefKlasor, `${Date.now()}_${path.basename(j.result.file_path)}`);
  fs.writeFileSync(ad, buf);
  return { yol: ad, boyut: buf.length, mime: dosyaTuru(ad, mime) };
}

/** Dosya türünü belirler: Telegram'ın bildirdiği tür, yoksa uzantıdan. */
function dosyaTuru(ad, bildirilen) {
  if (bildirilen && /^(image\/|application\/pdf)/i.test(bildirilen)) {
    if (/pdf/i.test(bildirilen)) return 'application/pdf';
    return bildirilen;
  }
  if (/\.pdf$/i.test(ad)) return 'application/pdf';
  if (/\.png$/i.test(ad)) return 'image/png';
  if (/\.(jpe?g)$/i.test(ad)) return 'image/jpeg';
  return bildirilen || 'application/octet-stream';
}

/* ------------------------- mesaj üretimi ------------------------- */

async function ozetMetni() {
  const ogrenciler = await all("SELECT * FROM students WHERE durum='Aktif' ORDER BY ad");
  const bugunT = bugun();
  const satirlar = [];
  let toplamBorc = 0;
  for (const o of ogrenciler) {
    const od = await all('SELECT tutar, tarih FROM payments WHERE student_id=? AND dogrulandi=1', [o.id]);
    const z = ozet(o, od, bugunT);
    if (z.borc > 0) toplamBorc += z.borc;
    satirlar.push({ o, z });
  }
  const gecikmis = satirlar.filter((s) => s.z.durum === 'gecikti');
  const yaklasan = satirlar.filter((s) => s.z.durum === 'yaklasiyor' || s.z.durum === 'bugun');

  let m = `📊 <b>Ödeme Özeti</b> — ${bugunT}\n`;
  m += `Aktif öğrenci: ${ogrenciler.length}\n`;
  m += `Toplam gecikmiş borç: <b>${toplamBorc.toLocaleString('tr-TR')} TL</b>\n`;
  if (gecikmis.length) {
    m += `\n⚠️ <b>Gecikmiş (${gecikmis.length})</b>\n`;
    for (const s of gecikmis.slice(0, 15)) {
      m += `• ${s.o.ad} — ${s.z.borc.toLocaleString('tr-TR')} TL (en eski vade ${s.z.en_eski_odeme.vade})\n`;
    }
  }
  if (yaklasan.length) {
    m += `\n🔔 <b>Yaklaşan (${yaklasan.length})</b>\n`;
    for (const s of yaklasan.slice(0, 15)) {
      m += `• ${s.o.ad} — ${s.z.sonraki_vade} (${s.z.sonraki_vade_gun} gün)\n`;
    }
  }
  if (!gecikmis.length && !yaklasan.length) m += `\nHer şey güncel, bekleyen ödeme yok. ✅\n`;
  return m;
}

async function listeMetni() {
  const ogrenciler = await all("SELECT * FROM students WHERE durum='Aktif' ORDER BY ad");
  if (!ogrenciler.length) return 'Kayıtlı öğrenci yok. Web arayüzünden veya Excel içe aktararak ekleyin.';
  const bugunT = bugun();
  let m = `👥 <b>Öğrenciler (${ogrenciler.length})</b>\n`;
  for (const o of ogrenciler) {
    const od = await all('SELECT tutar, tarih FROM payments WHERE student_id=? AND dogrulandi=1', [o.id]);
    const z = ozet(o, od, bugunT);
    const isaret = z.borc > 0 ? '🔴' : z.durum === 'yaklasiyor' || z.durum === 'bugun' ? '🟡' : '🟢';
    m += `${isaret} ${o.ad} — ${(Number(o.aylik_ucret) || 0).toLocaleString('tr-TR')} TL/ay`;
    m += z.sonraki_vade ? `, sonraki ${z.sonraki_vade}` : '';
    m += z.borc > 0 ? `, <b>borç ${z.borc.toLocaleString('tr-TR')} TL</b>` : '';
    m += '\n';
  }
  return m;
}

const YARDIM = `🤖 <b>Ödeme Takip Botu</b>

Fiş gönderin → tutar, tarih ve isim okunup kaydedilir:
• <b>PDF dekont</b> (bankadan indirilen/e-postayla gelen) → yazı doğrudan okunur, ücretsiz ve hatasız.
• <b>Fotoğraf / ekran görüntüsü</b> → görsel okuma ile çözülür.

Komutlar:
/durum — gecikmiş ve yaklaşan ödemeler
/liste — tüm öğrenciler ve durumları
/ode &lt;isim&gt; &lt;tutar&gt; — elle ödeme kaydı (örn: /ode Defne 1200)
/yardim — bu mesaj`;

/* ------------------------- fiş işleme ------------------------- */

async function fisIsle(msg, chatId, cevapla) {
  const foto = msg.photo ? msg.photo[msg.photo.length - 1] : msg.document;
  if (!foto) return cevapla('Bu dosyayı okuyamadım. Fişin fotoğrafını veya PDF dekontunu gönderin.');
  const fileId = foto.file_id;
  const bildirilenTur = msg.document ? msg.document.mime_type : 'image/jpeg';
  const klasor = process.env.FIS_KLASOR || path.join(__dirname, '..', 'fisler');
  let indirilen;
  try {
    indirilen = await dosyaIndir(fileId, klasor, bildirilenTur);
  } catch (e) {
    return cevapla('Fiş indirilemedi: ' + e.message);
  }

  await cevapla('🔎 Fiş okunuyor, birkaç saniye...');
  const okuma = await fisiCoz(fs.readFileSync(indirilen.yol), indirilen.mime);
  if (!okuma.ok) {
    await run("INSERT INTO payments(student_id,tutar,tarih,kaynak,fis_dosya,fis_metin,dogrulandi,created_at) VALUES(NULL,0,?,?,?,?,0,?)",
      [bugun(), 'telegram', indirilen.yol, 'OKUNAMADI: ' + okuma.hata, new Date().toISOString()]);
    return cevapla('❌ Fiş okunamadı: ' + okuma.hata + '\nFiş kaydedildi, web arayüzündeki <b>Eşleşmeyen fişler</b> bölümünden elle girebilirsiniz.');
  }

  const v = okuma.veri;
  const ogrenciler = await all("SELECT id, ad, veli, telefon FROM students WHERE durum='Aktif'");
  const es = eslesmeBul(v, ogrenciler);

  const ozetSatir =
    `👤 ${v.gonderen || v.ogrenci || '—'}\n` +
    `💰 ${v.tutar != null ? v.tutar.toLocaleString('tr-TR') + ' TL' : 'tutar okunamadı'}\n` +
    `📅 ${v.tarih || 'tarih okunamadı'}\n` +
    `💳 ${v.yontem || '—'}`;

  const eksik = v.tutar == null || !v.tarih;
  if (eksik || !es.student_id || es.puan < 60) {
    await run("INSERT INTO payments(student_id,tutar,tarih,kaynak,fis_dosya,fis_metin,dogrulandi,created_at) VALUES(?,?,?,?,?,?,0,?)",
      [es.puan >= 60 ? es.student_id : null, v.tutar || 0, v.tarih || bugun(), 'telegram', indirilen.yol, JSON.stringify(v), new Date().toISOString()]);
    let cevap = `⚠️ Fiş kaydedildi ama <b>onay bekliyor</b>.\n\n${ozetSatir}\n`;
    if (es.puan >= 60) cevap += `\nTahmin edilen öğrenci: ${es.neden} (benzerlik ${es.puan})`;
    else cevap += `\nHangi öğrenciye ait olduğunu belirleyemedim.`;
    cevap += `\nWeb arayüzündeki <b>Eşleşmeyen fişler</b> bölümünden onaylayın.`;
    return cevapla(cevap);
  }

  const id = await run(
    "INSERT INTO payments(student_id,tutar,tarih,yontem,kaynak,fis_dosya,fis_metin,dogrulandi,created_at) VALUES(?,?,?,?,?,?,?,1,?)",
    [es.student_id, v.tutar, v.tarih, v.yontem || null, 'telegram', indirilen.yol, okuma.metin || JSON.stringify(v), new Date().toISOString()]
  );
  const o = await get('SELECT * FROM students WHERE id=?', [es.student_id]);
  const od = await all('SELECT tutar, tarih FROM payments WHERE student_id=? AND dogrulandi=1', [o.id]);
  const z = ozet(o, od, bugun());
  const nasil = okuma.yol === 'pdf-metin' ? 'PDF metninden okundu (anahtar gerekmedi)' : 'fotoğraftan okundu';
  let cevap = `✅ <b>Ödeme kaydedildi</b>\n\n${ozetSatir}\n\n👦 ${o.ad} hesabına işlendi (fiş #${id.lastID}, ${nasil}).\n`;
  if (z.borc > 0) cevap += `\n⚠️ Kalan gecikmiş borç: <b>${z.borc.toLocaleString('tr-TR')} TL</b>`;
  else cevap += `\n${z.sonraki_vade ? 'Sonraki ödeme: ' + z.sonraki_vade : 'Bekleyen ödeme yok.'}`;
  return cevapla(cevap);
}

/* ------------------------- güncelleme döngüsü ------------------------- */

let offset = 0;
let calisiyor = false;
let durduruldu = false;

async function guncellemeleriIsle(update, cevapla) {
  const msg = update.message || update.edited_message;
  if (!msg) return;
  const chatId = msg.chat && msg.chat.id;
  const metin = (msg.text || '').trim();

  if (msg.photo || msg.document) return fisIsle(msg, chatId, cevapla);
  if (!metin) return;

  const [komut, ...rest] = metin.split(/\s+/);
  const k = komut.toLowerCase().replace(/@.*$/, '');
  if (k === '/start' || k === '/yardim' || k === '/help') return cevapla(YARDIM);
  if (k === '/durum') return cevapla(await ozetMetni());
  if (k === '/liste') return cevapla(await listeMetni());
  if (k === '/ode') {
    const tutar = rest.length ? parseFloat(String(rest[rest.length - 1]).replace(',', '.')) : NaN;
    const isim = rest.slice(0, -1).join(' ');
    if (!isim || isNaN(tutar)) return cevapla('Kullanım: /ode &lt;isim&gt; &lt;tutar&gt;\nÖrnek: /ode Defne 1200');
    const bulunan = await ogrenciBul(isim);
    if (!bulunan) return cevapla(`"${isim}" adında bir öğrenci bulamadım. /liste ile bakabilirsiniz.`);
    await run("INSERT INTO payments(student_id,tutar,tarih,kaynak,dogrulandi,created_at) VALUES(?,?,?,'telegram',1,?)",
      [bulunan.id, tutar, bugun(), new Date().toISOString()]);
    return cevapla(`✅ ${bulunan.ad} için ${tutar.toLocaleString('tr-TR')} TL ödeme kaydedildi (${bugun()}).`);
  }
  return cevapla('Anlamadım. /yardim yazarak komutları görebilirsiniz.');
}

async function ogrenciBul(isim) {
  const { normalize } = require('./fis');
  const aranan = normalize(isim);
  const ogrenciler = await all("SELECT id, ad, veli FROM students WHERE durum='Aktif'");
  let en = null, puan = 0;
  for (const o of ogrenciler) {
    for (const h of [o.ad, o.veli].filter(Boolean)) {
      const n = normalize(h);
      let p = 0;
      if (n === aranan) p = 100;
      else if (n.includes(aranan) || aranan.includes(n)) p = 80;
      else {
        const A = new Set(aranan.split(' ')), H = n.split(' ');
        const ortak = H.filter((x) => x.length > 2 && A.has(x)).length;
        if (ortak) p = 30 + ortak * 25;
      }
      if (p > puan) { puan = p; en = o; }
    }
  }
  return puan >= 60 ? en : null;
}

async function dongu() {
  while (!durduruldu) {
    try {
      const y = await fetch(`${API(token())}/getUpdates?timeout=30&offset=${offset}&allowed_updates=${encodeURIComponent(JSON.stringify(['message']))}`, { signal: AbortSignal.timeout(45000) });
      const j = await y.json();
      if (!j.ok) throw new Error(j.description || 'getUpdates hatası');
      const liste = j.result || [];
      for (const u of liste) {
        offset = u.update_id + 1;
        try {
          await guncellemeleriIsle(u, (t, extra) => mesajGonder(t, u.message && u.message.chat && u.message.chat.id, extra));
        } catch (e) { console.error('[telegram] güncelleme hatası:', e.message); }
      }
      // Gerçek Telegram uzun yoklama yapar (30 sn bekler); yoklama anında dönerse
      // boşa dönmemek için kısa bir bekleme eklenir.
      if (!liste.length) await new Promise((r) => setTimeout(r, 400));
    } catch (e) {
      if (durduruldu) break;
      console.error('[telegram] yoklama hatası:', e.message);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

async function baslat() {
  if (!token()) { console.log('[telegram] TELEGRAM_BOT_TOKEN yok — bot başlatılmadı.'); return false; }
  if (calisiyor) return true;
  calisiyor = true;
  // Eski birikmiş mesajları atla
  try {
    const y = await fetch(`${API(token())}/getUpdates?offset=-1`);
    const j = await y.json();
    if (j.ok && j.result && j.result.length) offset = j.result[j.result.length - 1].update_id + 1;
    const me = await (await fetch(`${API(token())}/getMe`)).json();
    if (me.ok) console.log(`[telegram] bot hazır: @${me.result.username}`);
  } catch (e) { console.error('[telegram] başlangıç uyarısı:', e.message); }
  dongu();
  return true;
}

function durdur() { durduruldu = true; }

module.exports = { baslat, durdur, mesajGonder, ozetMetni, listeMetni, fisIsle, guncellemeleriIsle, ogrenciBul, dosyaIndir, YARDIM };

'use strict';
/**
 * Fiş (makbuz / dekont) okuma.
 * Fotoğraf, görsel yeteneği olan bir modele (OpenRouter) gönderilir ve
 * içindeki bilgiler JSON olarak geri alınır. Hiçbir şey uydurulmaz:
 * okunamayan alan null döner.
 */
const API_URL = (process.env.OPENROUTER_API_BASE || 'https://openrouter.ai/api/v1') + '/chat/completions';
const pdf = require('./pdf');

const PROMPT = `Bu görsel bir ödeme makbuzu, banka dekontu veya havale/EFT ekran görüntüsü.
Sadece görselde GERÇEKTEN yazan bilgileri çıkar. Emin olmadığın alanı null bırak, tahmin etme.

Yanıtı SADECE şu JSON ile ver, başka hiçbir metin yazma:
{
  "tutar": sayı (sadece rakam, örn 1200 veya 1200.50; para birimi yazma),
  "tarih": "YYYY-MM-DD" (ödeme tarihi; gün.ay.yıl biçimindeyse çevir),
  "gonderen": "ödemeyi yapan kişinin adı soyadı (varsa)",
  "alici": "ödemeyi alan kişi/kurum adı (varsa)",
  "ogrenci": "makbuzda çocuk/öğrenci adı geçiyorsa o ad",
  "yontem": "Havale" | "EFT" | "Kredi Kartı" | "Nakit" | "Diğer",
  "aciklama": "makbuzdaki açıklama satırı (varsa)",
  "guven": 0-100 arası sayı (bu bilgileri okuma güvenin)
}`;

function normalize(s) {
  return String(s == null ? '' : s)
    .toLocaleLowerCase('tr-TR')
    .replace(/[ıİ]/g, 'i').replace(/[şŞ]/g, 's').replace(/[ğĞ]/g, 'g')
    .replace(/[üÜ]/g, 'u').replace(/[öÖ]/g, 'o').replace(/[çÇ]/g, 'c')
    .replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Türkçe biçimli tarihleri 'YYYY-MM-DD' yapar. */
function tarihDuzelt(t) {
  if (!t) return null;
  const s = String(t).trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${String(+m[2]).padStart(2, '0')}-${String(+m[3]).padStart(2, '0')}`;
  m = /^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})/.exec(s);
  if (m) {
    let y = +m[3]; if (y < 100) y += 2000;
    return `${y}-${String(+m[2]).padStart(2, '0')}-${String(+m[1]).padStart(2, '0')}`;
  }
  const d = new Date(s);
  if (!isNaN(d)) return new Intl.DateTimeFormat('sv-SE', { timeZone: process.env.TZ || 'Europe/Istanbul' }).format(d);
  return null;
}

function tutarDuzelt(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Math.round(v * 100) / 100;
  let s = String(v).replace(/[^\d.,-]/g, '');
  if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.');
  else if (s.includes(',')) s = s.replace(',', '.');
  const n = parseFloat(s);
  return isNaN(n) ? null : Math.round(n * 100) / 100;
}

/** Modelin cevabından JSON'u ayıklar (```json blokları, fazladan metin vb.). */
function jsonAyikla(metin) {
  if (!metin) return null;
  let s = String(metin).replace(/```json/gi, '```');
  const blok = /```([\s\S]*?)```/.exec(s);
  if (blok) s = blok[1];
  const bas = s.indexOf('{'), son = s.lastIndexOf('}');
  if (bas === -1 || son === -1) return null;
  try { return JSON.parse(s.slice(bas, son + 1)); } catch (_) { return null; }
}

/**
 * Görseli modele gönderip fiş bilgilerini döner.
 * @returns {Promise<{ok:boolean, hata?:string, veri?:object}>}
 */
async function fisiOku(buffer, mime = 'image/jpeg') {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return { ok: false, hata: 'OPENROUTER_API_KEY tanımlı değil (.env dosyasına ekleyin).' };
  const model = process.env.VISION_MODEL || 'google/gemini-4-neon';
  const dataUrl = `data:${mime};base64,${buffer.toString('base64')}`;
  const govde = {
    model,
    temperature: 0,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: PROMPT },
        { type: 'image_url', image_url: { url: dataUrl } },
      ],
    }],
  };
  let sonHata = '';
  for (let deneme = 1; deneme <= 2; deneme++) {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 90000);
      const y = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify(govde),
        signal: ctl.signal,
      });
      clearTimeout(t);
      const j = await y.json().catch(() => null);
      if (!y.ok) { sonHata = `HTTP ${y.status}: ${j && j.error ? j.error.message : 'bilinmeyen hata'}`; continue; }
      const icerik = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
      const veri = jsonAyikla(icerik);
      if (!veri) { sonHata = 'Model okunabilir JSON döndürmedi.'; continue; }
      return {
        ok: true,
        veri: {
          tutar: tutarDuzelt(veri.tutar),
          tarih: tarihDuzelt(veri.tarih),
          gonderen: veri.gonderen || null,
          alici: veri.alici || null,
          ogrenci: veri.ogrenci || null,
          yontem: veri.yontem || null,
          aciklama: veri.aciklama || null,
          guven: Number(veri.guven) || 0,
          ham: icerik,
          model,
        },
      };
    } catch (e) {
      sonHata = e.name === 'AbortError' ? 'Model zaman aşımına uğradı.' : e.message;
    }
  }
  return { ok: false, hata: sonHata };
}

/**
 * Okunan isimleri kayıtlı öğrencilerle eşleştirir (en yüksek puanlı aday).
 * ogrenciler: [{id, ad, veli, telefon}]
 */
function eslesmeBul(veri, ogrenciler) {
  const arananlar = [veri.ogrenci, veri.gonderen, veri.aciklama]
    .filter(Boolean).map(normalize).filter((x) => x.length > 2);
  if (!arananlar.length) return { student_id: null, puan: 0, neden: 'Fişte isim bulunamadı' };
  let en = { student_id: null, puan: 0, neden: 'Eşleşme yok' };
  for (const o of ogrenciler) {
    const hedefler = [o.ad, o.veli].filter(Boolean).map(normalize);
    for (const a of arananlar) {
      for (const h of hedefler) {
        if (!h) continue;
        let puan = 0;
        if (a === h) puan = 100;
        else if (a.includes(h) || h.includes(a)) puan = 80;
        else {
          const A = new Set(a.split(' ')), H = h.split(' ');
          const ortak = H.filter((k) => k.length > 2 && A.has(k)).length;
          if (ortak) puan = Math.min(75, 30 + ortak * 25);
        }
        if (puan > en.puan) en = { student_id: o.id, puan, neden: `${o.ad}${o.veli ? ' / ' + o.veli : ''}` };
      }
    }
  }
  return en;
}

/**
 * Fişi çözer — türe göre en uygun yolu seçer:
 *  - PDF (metin katmanlı): metin YEREL olarak okunur. Anahtar gerekmez, ücret yok, harf hatası yok.
 *  - PDF (taranmış): metin katmanı yoktur; ekran görüntüsü istenir.
 *  - Görsel (JPG/PNG): görsel model kullanılır (anahtar gerekir).
 * @returns {Promise<{ok:boolean, yol?:string, veri?:object, metin?:string, hata?:string}>}
 */
async function fisiCoz(buffer, mime = 'image/jpeg') {
  if (/pdf/i.test(mime)) {
    let cikti;
    try {
      cikti = await pdf.metinCikar(buffer);
    } catch (e) {
      return { ok: false, yol: 'pdf', hata: 'PDF açılamadı: ' + e.message };
    }
    if (!pdf.metinYeterli(cikti.metin)) {
      return {
        ok: false, yol: 'pdf-taranmis',
        hata: 'Bu PDF taranmış görüntü içeriyor (içinde yazı katmanı yok). Dekontun ekran görüntüsünü (JPG/PNG) gönderin, o zaman okunabilir.',
      };
    }
    return { ok: true, yol: 'pdf-metin', veri: pdf.metindenAlanlariCikar(cikti.metin), metin: cikti.metin };
  }
  if (/^image\//.test(mime)) {
    if (!process.env.OPENROUTER_API_KEY) {
      return {
        ok: false, yol: 'gorsel-model',
        hata: 'Fotoğraf okumak için görsel model anahtarı gerekir (.env → OPENROUTER_API_KEY). Bankanın PDF dekontunu gönderirseniz anahtar gerekmez.',
      };
    }
    const r = await fisiOku(buffer, mime);
    return r.ok ? { ok: true, yol: 'gorsel-model', veri: r.veri, metin: r.veri.ham } : { ok: false, yol: 'gorsel-model', hata: r.hata };
  }
  return { ok: false, hata: 'Desteklenmeyen dosya türü: ' + mime };
}

module.exports = { fisiOku, fisiCoz, eslesmeBul, normalize, tarihDuzelt, tutarDuzelt, jsonAyikla, PROMPT };

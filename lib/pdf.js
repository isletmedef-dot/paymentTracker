'use strict';
/**
 * PDF fiş okuma — YEREL, anahtar gerektirmez.
 *
 * Banka uygulamasından indirilen / e-postayla gelen bir dekont PDF'i genellikle
 * GERÇEK METİN katmanı içerir (yazıcıdan taranmış değildir). O durumda tutar, tarih
 * ve isim doğrudan PDF'in içinden okunur: model çağrısı yok, ücret yok, harf hatası yok.
 *
 * Taranmış (fotoğraf/scan) PDF'lerde metin katmanı bulunmaz; o durumda kullanıcıdan
 * ekran görüntüsü istenir (görsel model o yolu okur).
 */
const path = require('path');

let pdfjsPromise = null;
function pdfjsYukle() {
  if (!pdfjsPromise) {
    // pdfjs-dist ESM olarak yüklenir; worker'a gerek yok (metin çıkarma).
    pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs');
  }
  return pdfjsPromise;
}

/** PDF buffer'ından tüm metni çıkarır. @returns {Promise<{metin, sayfa_sayisi}>} */
async function metinCikar(buffer) {
  const pdfjs = await pdfjsYukle();
  const yuklemeGorevi = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: false,
    disableFontFace: true,
    isEvalSupported: false,
  });
  const doc = await yuklemeGorevi.promise;
  const parcalar = [];
  let sayfaSayisi = 0;
  try {
    sayfaSayisi = doc.numPages;
    for (let s = 1; s <= sayfaSayisi; s++) {
      const sayfa = await doc.getPage(s);
      const icerik = await sayfa.getTextContent();
      let satir = '';
      for (const it of icerik.items) {
        satir += it.str;
        if (it.hasEOL) { parcalar.push(satir); satir = ''; }
      }
      if (satir) parcalar.push(satir);
      parcalar.push('\n');
    }
  } finally {
    // pdfjs sürümleri arasında API adı değişebiliyor: hangisi varsa onu kullan.
    try {
      if (typeof yuklemeGorevi.destroy === 'function') await yuklemeGorevi.destroy();
      else if (typeof doc.destroy === 'function') await doc.destroy();
      else if (typeof doc.cleanup === 'function') doc.cleanup();
    } catch (_) { /* kapatma hatası okumayı etkilemez */ }
  }
  return { metin: parcalar.join('\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n'), sayfa_sayisi: sayfaSayisi };
}

/* --------------------- metinden alan çıkarma --------------------- */

/** Türkçe para biçimlerini sayıya çevirir: "1.000,00 TL" -> 1000 */
function paraDegeri(s) {
  if (!s) return null;
  let t = String(s).replace(/[^\d.,]/g, '');
  if (!t) return null;
  if (t.includes(',') && t.includes('.')) t = t.replace(/\./g, '').replace(',', '.');
  else if (t.includes(',')) t = t.replace(',', '.');
  else if ((t.match(/\./g) || []).length > 1) t = t.replace(/\./g, '');
  else if (/^\d{1,3}\.\d{3}$/.test(t)) t = t.replace('.', '');
  const n = parseFloat(t);
  return isNaN(n) ? null : Math.round(n * 100) / 100;
}

const PARA_DESENI = /(\d{1,3}(?:[.\s]\d{3})*(?:,\d{2})|\d+(?:[.,]\d{2})?)\s*(?:TL|TRY|₺)/i;

function tariheCevir(s) {
  if (!s) return null;
  let m = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${String(+m[2]).padStart(2, '0')}-${String(+m[3]).padStart(2, '0')}`;
  m = /(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})/.exec(s);
  if (m) return `${m[3]}-${String(+m[2]).padStart(2, '0')}-${String(+m[1]).padStart(2, '0')}`;
  m = /(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2})\b/.exec(s);
  if (m) return `20${m[3]}-${String(+m[2]).padStart(2, '0')}-${String(+m[1]).padStart(2, '0')}`;
  return null;
}

/** Etiketli satırdan değer alır: "Gönderen: Ali Veli" / "Gönderen  Ali Veli" */
function etiketliDeger(metin, etiketler) {
  const satirlar = String(metin).split(/\r?\n/);
  for (let i = 0; i < satirlar.length; i++) {
    const s = satirlar[i];
    for (const et of etiketler) {
      const re = new RegExp('^\\s*' + et + '\\s*[:\\-]?\\s*(.+)$', 'i');
      const m = re.exec(s);
      if (m && m[1] && m[1].trim().length > 1) return m[1].trim();
      // Etiket tek başına bir satırda, değer altındaki satırda olabilir
      if (new RegExp('^\\s*' + et + '\\s*[:\\-]?\\s*$', 'i').test(s) && satirlar[i + 1]) {
        const alt = satirlar[i + 1].trim();
        if (alt) return alt;
      }
    }
  }
  return null;
}

const YONTEM_DESENLERI = [
  [/FAST|havale|EFT|swift/i, 'Havale'],
  [/kredi kart|kart ile|pos\b/i, 'Kredi Kartı'],
  [/nakit|peşin|pesin/i, 'Nakit'],
  [/otomatik ödeme|düzenli ödeme/i, 'Otomatik Ödeme'],
];

/**
 * PDF metninden fiş alanlarını çıkarır. Bulunamayan alan null kalır (uydurulmaz).
 */
function metindenAlanlariCikar(metin) {
  const m = String(metin || '');
  const duz = m.replace(/\s+/g, ' ');

  // Tutar: önce "Tutar" etiketli satır, sonra metindeki en büyük TL değeri.
  let tutar = paraDegeri(etiketliDeger(m, ['Tutar', 'İşlem Tutarı', 'Islem Tutari', 'Toplam Tutar', 'Ödenen Tutar', 'Odenen Tutar', 'Amount']));
  if (tutar == null) {
    const bulunan = [];
    const re = new RegExp(PARA_DESENI.source, 'gi');
    let x;
    while ((x = re.exec(duz)) !== null) {
      const v = paraDegeri(x[0]);
      if (v != null && v > 0) bulunan.push(v);
    }
    if (bulunan.length) tutar = Math.max(...bulunan);
  }

  const tarihHam = etiketliDeger(m, ['İşlem Tarihi', 'Islem Tarihi', 'Ödeme Tarihi', 'Odeme Tarihi', 'Tarih', 'Date', 'Valör', 'Valor'])
    || (/(\d{1,2}[.\/-]\d{1,2}[.\/-]\d{2,4})/.exec(duz) || [])[1];
  const tarih = tariheCevir(tarihHam);

  const gonderen = etiketliDeger(m, ['Gönderen', 'Gonderen', 'Gönderen Adı', 'Ad Soyad', 'Adı Soyadı', 'Müşteri', 'Hesap Sahibi', 'Borçlu', 'Sender']);
  const alici = etiketliDeger(m, ['Alıcı', 'Alici', 'Alıcı Adı', 'Alıcı Hesap Adı', 'Receiver', 'Lehtar']);
  const aciklama = etiketliDeger(m, ['Açıklama', 'Aciklama', 'İşlem Açıklaması', 'Detay', 'Description']);

  let yontem = null;
  for (const [re, ad] of YONTEM_DESENLERI) if (re.test(duz)) { yontem = ad; break; }

  const guven = [tutar != null, tarih != null, !!(gonderen || alici)].filter(Boolean).length * 30
    + (aciklama ? 10 : 0);

  return {
    tutar, tarih, gonderen, alici,
    ogrenci: null, // öğrenci adı varsa açıklama satırından eşleştirme yapılır
    aciklama,
    yontem,
    guven: Math.min(100, guven),
    kaynak: 'pdf-metin',
  };
}

/** Metin katmanı var mı? (taranmış PDF'lerde birkaç karakterden fazlası olmaz) */
function metinYeterli(metin) {
  const t = String(metin || '').replace(/\s/g, '');
  return t.length >= 25;
}

module.exports = { metinCikar, metindenAlanlariCikar, metinYeterli, paraDegeri, tariheCevir, etiketliDeger };

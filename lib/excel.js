'use strict';
/**
 * Excel (.xlsx / .csv) içe aktarma.
 * Sütunlar başlık adına göre eşleştirilir; sütunların sırası önemli değildir,
 * bilinmeyen sütunlar yok sayılır. Önce ÖNİZLEME üretilir, kullanıcı onaylarsa yazılır.
 */
const ExcelJS = require('exceljs');
const { tarihDuzelt, tutarDuzelt } = require('./fis');

/* --------------------- başlık eşleştirme --------------------- */

const DESENLER = {
  ad:        [/^ad\s*soyad$/i, /öğrenci|ogrenci|isim|adı|adi|çocuk|cocuk|child|name/i],
  veli:      [/^veli/i, /anne|baba|parent|ebeveyn/i],
  telefon:   [/telefon|tel\b|gsm|phone|cep/i],
  ucret:     [/aylık|aylik|ücret|ucret|aidat|tutar|fee|price|bedel/i],
  odeme_gunu:[/ödeme\s*gün|odeme\s*gun|vade\s*gün|ayın\s*gün|gun\b|gün\b|due\s*day/i],
  baslangic: [/başlang|baslang|kayıt\s*tarih|kayit\s*tarih|start/i],
  tarih:     [/ödeme\s*tarih|odeme\s*tarih|^tarih$|date/i],
  durum:     [/durum|status/i],
  not:       [/^not\b|açıklama|aciklama|note|desc/i],
};

function baslikNormal(s) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
}

/** Başlık satırından sütun eşlemesi çıkarır. */
function eslemeOner(basliklar) {
  const kolonlar = {};
  const taninmayan = [];
  basliklar.forEach((b, i) => {
    const ad = baslikNormal(b);
    if (!ad) return;
    let bulundu = null;
    for (const [alan, desenler] of Object.entries(DESENLER)) {
      if (kolonlar[alan] != null) continue;
      if (desenler.some((d) => d.test(ad))) { bulundu = alan; break; }
    }
    if (bulundu) kolonlar[bulundu] = i; else taninmayan.push({ sutun: i, baslik: ad });
  });
  // Ödeme sayfası: bir tarih sütunu var ama vade günü/başlangıç yok → geçmiş ödemeler listesi.
  const mod = kolonlar.ad == null ? 'bilinmiyor'
    : (kolonlar.tarih != null && kolonlar.odeme_gunu == null && kolonlar.baslangic == null) ? 'odeme'
    : 'ogrenci';
  return { kolonlar, taninmayan, mod };
}

/* --------------------- dosya okuma --------------------- */

function hucreDegeri(c) {
  if (c == null) return null;
  if (c instanceof Date) return c;
  if (typeof c === 'object') {
    if (c.text != null) return c.text;
    if (c.result != null) return c.result;
    if (c.richText) return c.richText.map((t) => t.text).join('');
    if (c.hyperlink) return c.text || c.hyperlink;
    return null;
  }
  return c;
}

function hucreMetni(c) {
  const v = hucreDegeri(c);
  if (v == null) return '';
  if (v instanceof Date) return tarihDuzelt(v) || '';
  return String(v).replace(/\s+/g, ' ').trim();
}

/** Buffer -> { sayfalar: [{ad, basliklar, satirlar}] } */
async function calismaKitabiOku(buffer, dosyaAdi = '') {
  const sayfalar = [];
  if (/\.csv$/i.test(dosyaAdi)) {
    const wb = new ExcelJS.Workbook();
    const ws = await wb.csv.read(require('stream').Readable.from(buffer));
    sayfalar.push(sayfaCevir('CSV', ws));
    return { sayfalar };
  }
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  wb.eachSheet((ws) => sayfalar.push(sayfaCevir(ws.name, ws)));
  return { sayfalar };
}

function sayfaCevir(ad, ws) {
  const satirlarHam = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const dizi = [];
    const son = Math.max(row.cellCount, 1);
    for (let i = 1; i <= son; i++) dizi.push(hucreDegeri(row.getCell(i)));
    satirlarHam.push(dizi);
  });
  // İlk dolu satır başlık kabul edilir; ondan önceki açıklama satırları atlanır.
  let baslikIdx = satirlarHam.findIndex((r) => r.filter((c) => hucreMetni(c) !== '').length >= 2);
  if (baslikIdx === -1) baslikIdx = 0;
  const basliklar = (satirlarHam[baslikIdx] || []).map(hucreMetni);
  const satirlar = satirlarHam.slice(baslikIdx + 1).map((r) => r.map((c) => (c instanceof Date ? c : hucreMetni(c))));
  return { ad, basliklar, satirlar, baslikSatiri: baslikIdx + 1 };
}

/* --------------------- kayıt üretimi --------------------- */

function hucre(satir, idx) {
  if (idx == null) return null;
  const v = satir[idx];
  if (v == null || v === '') return null;
  return v;
}

function sayi(v) { return tutarDuzelt(v); }

function tariheCevir(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return tarihDuzelt(v);
  return tarihDuzelt(v);
}

/**
 * Önizleme: satırları kayıtlara çevirir, hatalı satırları ayrı döner.
 * mod: 'ogrenci' | 'odeme'
 */
function onizle(mod, kolonlar, satirlar, bugunT) {
  const kayitlar = [];
  const hatalar = [];
  satirlar.forEach((satir, i) => {
    const satirNo = i + 2; // başlık 1. satır varsayımı (bilgi amaçlı)
    const ad = String(hucre(satir, kolonlar.ad) || '').trim();
    if (!ad) {
      const dolu = satir.some((c) => hucreMetni(c) !== '');
      if (dolu) hatalar.push({ satir: satirNo, hata: 'İsim sütunu boş' });
      return;
    }
    if (mod === 'odeme') {
      const tutar = sayi(hucre(satir, kolonlar.ucret));
      const tarih = tariheCevir(hucre(satir, kolonlar.tarih));
      if (!tutar || tutar <= 0) return hatalar.push({ satir: satirNo, hata: `"${ad}" için tutar okunamadı` });
      if (!tarih) return hatalar.push({ satir: satirNo, hata: `"${ad}" için tarih okunamadı` });
      kayitlar.push({ ad, tutar, tarih, yontem: hucre(satir, kolonlar.not) ? String(hucre(satir, kolonlar.not)) : null, satir: satirNo });
    } else {
      const ucret = sayi(hucre(satir, kolonlar.ucret));
      const gunHam = hucre(satir, kolonlar.odeme_gunu);
      let gun = null;
      if (gunHam != null) {
        const g = parseInt(String(gunHam).replace(/\D/g, ''), 10);
        if (g >= 1 && g <= 31) gun = g;
      }
      if (gun == null) {
        const t = tariheCevir(hucre(satir, kolonlar.baslangic)) || tariheCevir(hucre(satir, kolonlar.tarih));
        if (t) gun = parseInt(t.slice(8, 10), 10);
      }
      kayitlar.push({
        ad,
        veli: hucre(satir, kolonlar.veli) ? String(hucre(satir, kolonlar.veli)).trim() : null,
        telefon: hucre(satir, kolonlar.telefon) ? String(hucre(satir, kolonlar.telefon)).replace(/[^\d+]/g, '') : null,
        aylik_ucret: ucret || 0,
        odeme_gunu: gun,
        baslangic: tariheCevir(hucre(satir, kolonlar.baslangic)) || tariheCevir(hucre(satir, kolonlar.tarih)) || bugunT,
        durum: /pasif|kapalı|kapali|inaktif/i.test(String(hucre(satir, kolonlar.durum) || '')) ? 'Pasif' : 'Aktif',
        not_metni: hucre(satir, kolonlar.not) ? String(hucre(satir, kolonlar.not)).trim() : null,
        satir: satirNo,
      });
    }
  });
  return { kayitlar, hatalar };
}

/** Boş şablon üretir (indirilebilir). */
async function sablonUret() {
  const wb = new ExcelJS.Workbook();
  const s1 = wb.addWorksheet('Öğrenciler');
  s1.columns = [
    { header: 'Ad Soyad', key: 'ad', width: 24 },
    { header: 'Veli', key: 'veli', width: 20 },
    { header: 'Telefon', key: 'tel', width: 16 },
    { header: 'Aylık Ücret', key: 'ucret', width: 12 },
    { header: 'Ödeme Günü', key: 'gun', width: 12 },
    { header: 'Başlangıç', key: 'bas', width: 14 },
    { header: 'Durum', key: 'durum', width: 10 },
    { header: 'Not', key: 'not', width: 28 },
  ];
  s1.addRow({ ad: 'Örnek Öğrenci', veli: 'Örnek Veli', tel: '05xx xxx xx xx', ucret: 1200, gun: 5, bas: '2026-11-01', durum: 'Aktif', not: 'Bu satırı silin' });
  s1.getRow(1).font = { bold: true };

  const s2 = wb.addWorksheet('Ödemeler');
  s2.columns = [
    { header: 'Ad Soyad', key: 'ad', width: 24 },
    { header: 'Tutar', key: 'tutar', width: 12 },
    { header: 'Ödeme Tarihi', key: 'tarih', width: 16 },
    { header: 'Açıklama', key: 'not', width: 28 },
  ];
  s2.addRow({ ad: 'Örnek Öğrenci', tutar: 1200, tarih: '2026-11-05', not: 'Havale' });
  s2.getRow(1).font = { bold: true };

  const s3 = wb.addWorksheet('Açıklama');
  s3.getColumn(1).width = 90;
  [
    'ÖDEME TAKİP — İÇE AKTARMA ŞABLONU',
    '',
    '1) "Öğrenciler" sayfası: bir satır = bir öğrenci. Aylık ücret ve ödeme günü',
    '   doldurulursa sistem vade takvimini kendisi oluşturur ve borç hesaplar.',
    '   Ödeme Günü: her ayın kaçında ödeme yapıldığı (1-31).',
    '   Başlangıç: ücretin işlemeye başladığı tarih (YYYY-AA-GG). Boşsa bugün alınır.',
    '',
    '2) "Ödemeler" sayfası: bir satır = bir ödeme. Geçmiş ödemeleri buraya girin.',
    '   Sistem öğrenciyi isme göre bulur.',
    '',
    'Sütun sırası önemli değildir; başlık adına göre eşleştirilir.',
    'Bilinmeyen sütunlar yok sayılır. Boş satırlar atlanır.',
  ].forEach((t, i) => { s3.getCell(`A${i + 1}`).value = t; });
  s3.getCell('A1').font = { bold: true, size: 13 };

  return Buffer.from(await wb.xlsx.writeBuffer());
}

module.exports = { calismaKitabiOku, eslemeOner, onizle, sablonUret, baslikNormal, DESENLER };

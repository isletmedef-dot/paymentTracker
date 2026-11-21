'use strict';
/**
 * Ödeme / vade hesaplamaları — saf fonksiyonlar, veritabanına dokunmaz.
 *
 * Tüm tarihler 'YYYY-MM-DD' biçiminde metindir ve karşılaştırmalar
 * sözlük sırasına göre yapılır (bu biçimde alfabetik sıra = kronolojik sıra).
 */

const TZ = process.env.TZ || 'Europe/Istanbul';

/** Bugünün YEREL tarihi: 'YYYY-MM-DD'. */
function bugun(now = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: TZ }).format(now);
}

/** 'YYYY-MM-DD' -> {y,m,d} (geçersizse null) */
function parcala(tarih) {
  if (typeof tarih !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(tarih.trim());
  if (!m) return null;
  return { y: +m[1], m: +m[2], d: +m[3] };
}

/** Ayın gününü (1-31) o ayın gerçek gün sayısına kırparak 'YYYY-MM-DD' üretir. */
function vadeTarihi(yil, ay, gun) {
  const ayGunSayisi = new Date(Date.UTC(yil, ay, 0)).getUTCDate(); // ay 1-12
  const g = Math.max(1, Math.min(31, Number(gun) || 1, ayGunSayisi));
  return `${yil}-${String(ay).padStart(2, '0')}-${String(g).padStart(2, '0')}`;
}

/** İki tarih arasındaki gün farkı (a - b). */
function gunFarki(a, b) {
  const A = parcala(a), B = parcala(b);
  if (!A || !B) return null;
  return Math.round((Date.UTC(A.y, A.m - 1, A.d) - Date.UTC(B.y, B.m - 1, B.d)) / 86400000);
}

function ayEkle(tarih, n) {
  const p = parcala(tarih);
  if (!p) return null;
  const t = new Date(Date.UTC(p.y, p.m - 1 + n, 1));
  return vadeTarihi(t.getUTCFullYear(), t.getUTCMonth() + 1, p.d);
}

/**
 * Bir öğrencinin vade takvimi.
 * baslangic: 'YYYY-MM-DD' (ücretin işlemeye başladığı tarih)
 * odemeGunu: 1-31 (her ayın ödeme günü)
 * bitis: bugüne kadar üretilecek son vade (varsayılan: bugün)
 * Başlangıç ayının ödeme günü başlangıç tarihinden ÖNCEYSE o ay atlanır.
 */
function vadeTakvimi(baslangic, odemeGunu, bitis = bugun()) {
  const b = parcala(baslangic);
  const son = parcala(bitis);
  if (!b || !son) return [];
  const liste = [];
  let y = b.y, m = b.m;
  const ilk = vadeTarihi(y, m, odemeGunu);
  if (ilk < baslangic) { m += 1; if (m > 12) { m = 1; y += 1; } }
  // güvenlik freni: en fazla 600 vade (50 yıl)
  for (let i = 0; i < 600; i++) {
    const v = vadeTarihi(y, m, odemeGunu);
    if (v > bitis) break;
    liste.push(v);
    m += 1; if (m > 12) { m = 1; y += 1; }
  }
  return liste;
}

/** Öğrencinin vade günü yoksa: ayın 1'i varsayılır. */
function varsayilanOdemeGunu(baslangic) {
  const b = parcala(baslangic);
  return b ? b.d : 1;
}

/**
 * Ödemeleri en eski vadeden başlayarak mahsup eder.
 * odemeler: [{tutar, tarih}] — sıralı olması gerekmez, burada sıralanır.
 * Dönen: her vade için {vade, beklenen, odenen, kalan, durum}
 *   durum: 'odendi' | 'kismi' | 'gecikti' | 'bekliyor'
 */
function mahsup(vadeler, odemeler, aylikUcret, bugunT = bugun()) {
  const ucret = Number(aylikUcret) || 0;
  const od = (odemeler || [])
    .filter((o) => parcala(o.tarih) && Number(o.tutar) > 0)
    .map((o) => ({ tutar: Number(o.tutar), tarih: o.tarih }))
    .sort((a, b) => (a.tarih < b.tarih ? -1 : a.tarih > b.tarih ? 1 : 0));

  let kalanHavuz = od.reduce((s, o) => s + o.tutar, 0);
  const sonuc = [];
  for (const vade of vadeler) {
    const odenen = Math.min(ucret, kalanHavuz);
    kalanHavuz -= odenen;
    const kalan = ucret - odenen;
    let durum;
    if (kalan <= 0.004) durum = 'odendi';
    else if (vade < bugunT) durum = 'gecikti';
    else if (odenen > 0) durum = 'kismi';
    else durum = 'bekliyor';
    sonuc.push({ vade, beklenen: ucret, odenen: round2(odenen), kalan: round2(kalan), durum });
  }
  return { vadeler: sonuc, fazla: round2(kalanHavuz) };
}

function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

/**
 * Öğrencinin özet durumu.
 * ogrenci: {baslangic, aylik_ucret, odeme_gunu}
 * odemeler: [{tutar, tarih, ...}]
 */
function ozet(ogrenci, odemeler, bugunT = bugun()) {
  const ucret = Number(ogrenci.aylik_ucret) || 0;
  const gun = ogrenci.odeme_gunu || varsayilanOdemeGunu(ogrenci.baslangic);
  // Aylık ücret tanımlı değilse vade takvimi yoktur (0 TL'lik boş vadeler üretilmez).
  const vadeler = ucret > 0 ? vadeTakvimi(ogrenci.baslangic, gun, bugunT) : [];
  const { vadeler: satirlar, fazla } = mahsup(vadeler, odemeler, ucret, bugunT);

  const odenmisVade = satirlar.filter((s) => s.durum === 'odendi').length;
  const gecikmis = satirlar.filter((s) => s.durum === 'gecikti');
  const borc = round2(gecikmis.reduce((s, x) => s + x.kalan, 0));
  const odenenToplam = round2((odemeler || []).reduce((s, o) => s + (Number(o.tutar) || 0), 0));
  const beklenenToplam = round2(satirlar.length * ucret);

  // En eski ödenmemiş vade (gecikmiş varsa o)
  const eskiOdeme = gecikmis[0] || satirlar.find((s) => s.kalan > 0.004) || null;

  // Sonraki vade: bugünden itibaren ilk vade (yoksa takvimi ileri doğru üret)
  let sonraki = null;
  if (ucret > 0 && ogrenci.baslangic) {
    const ileri = vadeTakvimi(ogrenci.baslangic, gun, ayEkle(bugunT, 12));
    const gelecek = ileri.filter((v) => v >= bugunT);
    const odemeHaritasi = new Map(satirlar.map((s) => [s.vade, s]));
    for (const v of gelecek) {
      const s = odemeHaritasi.get(v);
      if (!s || s.kalan > 0.004) { sonraki = v; break; }
    }
  }

  const sonOdeme = (odemeler || [])
    .filter((o) => parcala(o.tarih))
    .sort((a, b) => (a.tarih < b.tarih ? 1 : a.tarih > b.tarih ? -1 : 0))[0] || null;

  const sonrakiGun = sonraki ? gunFarki(sonraki, bugunT) : null;

  let durum = 'odendi';
  if (gecikmis.length) durum = 'gecikti';
  else if (sonraki && sonrakiGun === 0) durum = 'bugun';
  else if (sonraki && sonrakiGun != null && sonrakiGun > 0 && sonrakiGun <= 7) durum = 'yaklasiyor';

  return {
    durum,
    borc,
    alacak: fazla,               // fazla ödeme (avans)
    odenen_toplam: odenenToplam,
    beklenen_toplam: beklenenToplam,
    odenmis_vade_sayisi: odenmisVade,
    vade_sayisi: satirlar.length,
    gecikmis_sayisi: gecikmis.length,
    en_eski_odeme: eskiOdeme,
    sonraki_vade: sonraki,
    sonraki_vade_gun: sonrakiGun,
    son_odeme: sonOdeme,
    vadeler: satirlar,
  };
}

module.exports = {
  TZ, bugun, parcala, vadeTarihi, gunFarki, ayEkle,
  vadeTakvimi, mahsup, ozet, varsayilanOdemeGunu, round2,
};

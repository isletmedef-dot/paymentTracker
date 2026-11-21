'use strict';
/**
 * Uçtan uca duman testi — çalışan sunucuya karşı API'leri dener.
 * Kullanım: node scripts/duman-testi.js [http://127.0.0.1:3400]
 * NOT: Bu betik demo (örnek) kayıtlar oluşturur. Gerçek veriyle çalıştırmayın.
 */
const T = process.argv[2] || 'http://127.0.0.1:3400';
let gecen = 0, kalan = 0;

async function istek(yol, secenek) {
  const r = await fetch(T + yol, secenek);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${yol} → HTTP ${r.status} ${j.hata || ''}`);
  return j;
}
const json = (g) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(g) });

function kontrol(ad, kosul, ek = '') {
  if (kosul) { gecen++; console.log(`  ✔ ${ad}`); }
  else { kalan++; console.log(`  ✖ ${ad} ${ek}`); }
}

(async () => {
  console.log('1) Sunucu durumu');
  const d = await istek('/api/durum');
  kontrol('sunucu ayakta', d.ok === true, JSON.stringify(d));

  console.log('2) Öğrenci oluşturma');
  const bugun = d.bugun;
  const [y, m] = bugun.split('-').map(Number);
  const ayBasi = (n) => `${y}-${String(m).padStart(2, '0')}-${String(n).padStart(2, '0')}`;
  const ogrenciler = [
    // gecikmiş: geçen aylardan beri ödeme yok
    { ad: 'Ayşe Yılmaz', veli: 'Fatma Yılmaz', telefon: '05001112233', aylik_ucret: 1200, odeme_gunu: 5, baslangic: `${y}-${String(Math.max(1, m - 2)).padStart(2, '0')}-05` },
    // yaklaşan: bu ayın vadesi 2 gün sonra
    { ad: 'Can Demir', veli: 'Zeynep Demir', telefon: '05004445566', aylik_ucret: 1000, odeme_gunu: Math.min(28, Number(bugun.slice(8, 10)) + 2), baslangic: ayBasi(1) },
    // güncel: tüm vadeler ödendi
    { ad: 'Elif Kaya', veli: 'Murat Kaya', telefon: '05007778899', aylik_ucret: 900, odeme_gunu: 1, baslangic: ayBasi(1) },
  ];
  const idler = {};
  for (const o of ogrenciler) {
    const r = await istek('/api/ogrenciler', json(o));
    idler[o.ad] = r.id;
    kontrol(`${o.ad} eklendi (id ${r.id})`, !!r.id);
  }
  kontrol('isimsiz kayıt reddedildi', await istek('/api/ogrenciler', json({ ad: '' })).then(() => false).catch(() => true));

  console.log('3) Ödeme kaydı');
  const r1 = await istek('/api/odemeler', json({ student_id: idler['Elif Kaya'], tutar: 900, tarih: ayBasi(1), yontem: 'Havale' }));
  kontrol('ödeme eklendi', !!r1.id);
  kontrol('negatif tutar reddedildi', await istek('/api/odemeler', json({ student_id: idler['Elif Kaya'], tutar: -5 })).then(() => false).catch(() => true));

  console.log('4) Özet ve durum hesapları');
  const oz = await istek('/api/ozet');
  kontrol('özet döndü', oz.ogrenci_sayisi >= 3, JSON.stringify(oz));
  kontrol('gecikmiş borç hesaplandı', oz.toplam_borc > 0, `borç=${oz.toplam_borc}`);
  kontrol('yaklaşan liste boş değil', oz.yaklasan.length >= 1, JSON.stringify(oz.yaklasan));

  const liste = await istek('/api/ogrenciler');
  const ayse = liste.ogrenciler.find((o) => o.ad === 'Ayşe Yılmaz');
  const can = liste.ogrenciler.find((o) => o.ad === 'Can Demir');
  const elif = liste.ogrenciler.find((o) => o.ad === 'Elif Kaya');
  kontrol('Ayşe → gecikmiş', ayse.ozet.durum === 'gecikti', ayse.ozet.durum);
  kontrol('Ayşe en az 2 ay gecikmiş', ayse.ozet.gecikmis_sayisi >= 2, String(ayse.ozet.gecikmis_sayisi));
  kontrol('Ayşe borcu = gecikmiş ay × aylık ücret', ayse.ozet.borc === ayse.ozet.gecikmis_sayisi * 1200, `borç=${ayse.ozet.borc} ay=${ayse.ozet.gecikmis_sayisi}`);
  kontrol('Can → yaklaşıyor', can.ozet.durum === 'yaklasiyor', can.ozet.durum);
  kontrol('Elif → güncel', elif.ozet.durum === 'odendi', elif.ozet.durum);
  kontrol('Elif borcu yok', elif.ozet.borc === 0, String(elif.ozet.borc));
  kontrol('sıralama gecikmiş önce', liste.ogrenciler[0].ozet.durum === 'gecikti');

  console.log('5) Arama');
  const arama = await istek('/api/ogrenciler?ara=zeynep');
  kontrol('veli adından arama', arama.ogrenciler.length === 1 && arama.ogrenciler[0].ad === 'Can Demir', JSON.stringify(arama.ogrenciler.map((x) => x.ad)));

  console.log('6) Öğrenci detayı');
  const detay = await istek('/api/ogrenciler/' + idler['Can Demir']);
  kontrol('detay öğrenci döndü', detay.ogrenci.ad === 'Can Demir');
  kontrol('gelecek vadeler listelendi', detay.gelecek_vadeler.length >= 1, String(detay.gelecek_vadeler.length));

  console.log('7) Şablon indirme');
  const sablon = await fetch(T + '/api/sablon.xlsx');
  const sb = Buffer.from(await sablon.arrayBuffer());
  kontrol('şablon xlsx indi', sablon.ok && sb.length > 1000 && sb.slice(0, 2).toString() === 'PK', `${sb.length} bayt`);

  console.log('8) Excel içe aktarma (önizleme + uygulama)');
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Ogrenciler');
  ws.addRow(['Ad Soyad', 'Veli Adı', 'Telefon', 'Aylık Ücret', 'Ödeme Günü', 'Başlangıç']);
  ws.addRow(['Deniz Ak', 'Selin Ak', '05001234567', 1500, 10, ayBasi(1)]);
  ws.addRow(['Burak Taş', 'Hale Taş', '05007654321', 1100, 15, ayBasi(1)]);
  ws.addRow(['', '', '', '', '', '']); // boş satır atlanmalı
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  const b64 = buf.toString('base64');

  const onizleme = await istek('/api/ice-aktar/onizle', json({ base64: b64, dosyaAdi: 'test.xlsx' }));
  kontrol('sayfa bulundu', onizleme.sayfalar.length === 1);
  kontrol('mod öğrenci olarak seçildi', onizleme.sayfalar[0].mod === 'ogrenci', onizleme.sayfalar[0].mod);
  kontrol('2 kayıt okundu', onizleme.sayfalar[0].kayit_sayisi === 2, String(onizleme.sayfalar[0].kayit_sayisi));

  const uygula = await istek('/api/ice-aktar/uygula', json({ base64: b64, dosyaAdi: 'test.xlsx', sayfaIndex: 0, mod: 'ogrenci', kolonlar: onizleme.sayfalar[0].kolonlar }));
  kontrol('2 öğrenci eklendi', uygula.sonuc.eklenen === 2, JSON.stringify(uygula.sonuc));
  const tekrar = await istek('/api/ice-aktar/uygula', json({ base64: b64, dosyaAdi: 'test.xlsx', sayfaIndex: 0, mod: 'ogrenci', kolonlar: onizleme.sayfalar[0].kolonlar }));
  kontrol('tekrar aktarınca günceller (kopya oluşmaz)', tekrar.sonuc.eklenen === 0 && tekrar.sonuc.guncellenen === 2, JSON.stringify(tekrar.sonuc));

  console.log('9) Ödeme geçmişi sayfası');
  const wb2 = new ExcelJS.Workbook();
  const ws2 = wb2.addWorksheet('Odemeler');
  ws2.addRow(['Öğrenci', 'Tutar', 'Ödeme Tarihi', 'Açıklama']);
  ws2.addRow(['Deniz Ak', 1500, ayBasi(3), 'Havale']);
  ws2.addRow(['Bilinmeyen Kişi', 500, ayBasi(3), '']);
  const b642 = Buffer.from(await wb2.xlsx.writeBuffer()).toString('base64');
  const on2 = await istek('/api/ice-aktar/onizle', json({ base64: b642, dosyaAdi: 'odeme.xlsx' }));
  kontrol('ödeme sayfası modu doğru', on2.sayfalar[0].mod === 'odeme', on2.sayfalar[0].mod);
  const uy2 = await istek('/api/ice-aktar/uygula', json({ base64: b642, dosyaAdi: 'odeme.xlsx', sayfaIndex: 0, mod: 'odeme', kolonlar: on2.sayfalar[0].kolonlar }));
  kontrol('1 ödeme eklendi', uy2.sonuc.odeme_eklenen === 1, JSON.stringify(uy2.sonuc));
  kontrol('tanınmayan isim raporlandı', uy2.sonuc.eslesmeyen.length === 1, JSON.stringify(uy2.sonuc.eslesmeyen));

  console.log('10) Fişler ve ayarlar');
  const fis = await istek('/api/fisler');
  kontrol('fiş listesi döndü', Array.isArray(fis.fisler));
  const ayar = await istek('/api/ayarlar');
  kontrol('ayarlar döndü', !!ayar.ortam);
  kontrol('telegram token durumu bildirildi', typeof ayar.ortam.telegram_token_var === 'boolean');
  await istek('/api/ayarlar', json({ hatirlatma_gun: 5 }));
  const ayar2 = await istek('/api/ayarlar');
  kontrol('hatırlatma günü kaydedildi', ayar2.ayarlar.hatirlatma_gun === '5', JSON.stringify(ayar2.ayarlar));

  console.log('11) Silme');
  const sil = await istek('/api/odemeler/' + r1.id, { method: 'DELETE' });
  kontrol('ödeme silindi', sil.ok === true);
  kontrol('olmayan ödeme 404', await istek('/api/odemeler/999999', { method: 'DELETE' }).then(() => false).catch(() => true));

  console.log(`\nSONUÇ: ${gecen} geçti, ${kalan} kaldı`);
  process.exit(kalan ? 1 : 0);
})().catch((e) => { console.error('DUMAN TESTİ ÇÖKTÜ:', e.message); process.exit(2); });

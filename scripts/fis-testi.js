'use strict';
/**
 * Fiş okuma testi: verilen görseli modele gönderir, okunan alanları ve
 * hangi öğrenciye eşleştiğini yazdırır. Anahtar .env'den okunur.
 * Kullanım: node scripts/fis-testi.js <görsel> [sunucu]
 */
const fs = require('fs');
const path = require('path');

// .env yükle (server.js ile aynı biçim)
(function () {
  const p = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(p)) return;
  for (const s of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(s);
    if (m && process.env[m[1]] == null) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
})();

const { fisiCoz, eslesmeBul } = require('../lib/fis');

(async () => {
  const dosya = process.argv[2];
  const sunucu = process.argv[3] || 'http://127.0.0.1:3400';
  if (!dosya) { console.error('Kullanım: node scripts/fis-testi.js <görsel veya PDF> [sunucu]'); process.exit(1); }
  const mime = /\.pdf$/i.test(dosya) ? 'application/pdf' : /\.png$/i.test(dosya) ? 'image/png' : 'image/jpeg';
  if (mime !== 'application/pdf' && !process.env.OPENROUTER_API_KEY) {
    console.error('Görsel için OPENROUTER_API_KEY gerekli (.env). PDF dekontta gerekmez.');
    process.exit(1);
  }
  console.log('Dosya:', dosya, '(' + mime + ')');
  if (mime !== 'application/pdf') console.log('Model:', process.env.VISION_MODEL || 'google/gemini-4-neon');
  const t0 = Date.now();
  const r = await fisiCoz(fs.readFileSync(dosya), mime);
  console.log(`Süre: ${((Date.now() - t0) / 1000).toFixed(1)} sn`);
  if (!r.ok) { console.error('OKUNAMADI (' + r.yol + '):', r.hata); process.exit(2); }
  console.log('Okuma yolu:', r.yol === 'pdf-metin' ? 'PDF metni (yerel, ücretsiz)' : 'görsel model');
  console.log('Okunan alanlar:');
  for (const [k, v] of Object.entries(r.veri)) if (k !== 'ham') console.log(`  ${k}: ${v}`);

  let eslesme = 'sunucu kapalı olduğu için denenmedi';
  try {
    const l = await (await fetch(sunucu + '/api/ogrenciler')).json();
    const es = eslesmeBul(r.veri, l.ogrenciler.map((o) => ({ id: o.id, ad: o.ad, veli: o.veli })));
    eslesme = es.student_id ? `${es.neden} (puan ${es.puan}, id ${es.student_id})` : 'bulunamadı (' + es.neden + ')';
  } catch (_) { /* sunucu çalışmıyorsa eşleştirme atlanır */ }
  console.log('\nEşleşme:', eslesme);
  process.exit(0);
})().catch((e) => { console.error('HATA:', e.message); process.exit(3); });

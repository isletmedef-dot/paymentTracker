'use strict';
/* Ödeme Takip — arayüz mantığı (bağımlılık yok) */

const $ = (s) => document.querySelector(s);
const el = (t, s, m) => { const e = document.createElement(t); if (s) e.className = s; if (m != null) e.textContent = m; return e; };
const TL = (n) => (Number(n) || 0).toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' TL';
const tarihTR = (s) => { if (!s) return '—'; const [y, m, d] = String(s).split('-'); return `${d}.${m}.${y}`; };

const DURUM_ADI = { gecikti: 'Gecikmiş', bugun: 'Bugün', yaklasiyor: 'Yaklaşıyor', bekliyor: 'Bekliyor', odendi: 'Güncel' };

let durum = { ogrenciler: [], ozet: null, filtre: 'hepsi', ara: '', acikOgrenci: null };

async function api(yol, secenek) {
  const r = await fetch(yol, secenek);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.hata || ('HTTP ' + r.status));
  return j;
}

/* ------------------------- listeler ------------------------- */

async function yukle() {
  const [o, l] = await Promise.all([api('/api/ozet'), api('/api/ogrenciler')]);
  durum.ozet = o;
  durum.ogrenciler = l.ogrenciler;
  $('#bugunTarih').textContent = tarihTR(o.bugun);
  kartlariCiz();
  tabloyuCiz();
  fisleriYukle();
}

function kartlariCiz() {
  const o = durum.ozet;
  const k = $('#kartlar');
  k.innerHTML = '';
  const kart = (etiket, deger, sinif = '') => {
    const d = el('div', 'kart ' + sinif);
    d.appendChild(el('div', 'etiket', etiket));
    d.appendChild(el('div', 'deger', deger));
    return d;
  };
  k.appendChild(kart('Bu ay tahsil edilen', TL(o.bu_ay_tahsilat), 'yesil'));
  k.appendChild(kart('Gecikmiş borç', TL(o.toplam_borc), o.toplam_borc > 0 ? 'kirmizi' : ''));
  k.appendChild(kart('Yaklaşan (7 gün)', o.yaklasan.length + ' öğrenci', o.yaklasan.length ? 'sari' : ''));
  k.appendChild(kart('Aktif öğrenci', o.ogrenci_sayisi + ' / aylık ' + TL(o.aylik_beklenen)));
}

function suzulmus() {
  const ara = durum.ara.toLocaleLowerCase('tr-TR');
  return durum.ogrenciler.filter((o) => {
    const f = durum.filtre;
    if (f === 'gecikti' && !(o.ozet.borc > 0)) return false;
    if (f === 'yaklasiyor' && !(o.ozet.durum === 'yaklasiyor' || o.ozet.durum === 'bugun')) return false;
    if (f === 'odendi' && o.ozet.borc > 0) return false;
    if (ara) {
      const h = `${o.ad} ${o.veli || ''} ${o.telefon || ''}`.toLocaleLowerCase('tr-TR');
      if (!h.includes(ara)) return false;
    }
    return true;
  });
}

function tabloyuCiz() {
  const govde = $('#ogrenciGovde');
  govde.innerHTML = '';
  const liste = suzulmus();
  $('#bosMesaj').classList.toggle('gizli', durum.ogrenciler.length > 0);
  for (const o of liste) {
    const tr = el('tr', 'tik');
    tr.onclick = () => panelAc(o.id);

    const td1 = el('td');
    td1.appendChild(el('div', 'ad', o.ad));
    if (o.veli) td1.appendChild(el('div', 'alt', o.veli));
    tr.appendChild(td1);

    tr.appendChild(el('td', '', o.telefon || '—'));
    tr.appendChild(el('td', 'sag', TL(o.aylik_ucret)));

    tr.appendChild(el('td', '', o.ozet.son_odeme ? `${tarihTR(o.ozet.son_odeme.tarih)} · ${TL(o.ozet.son_odeme.tutar)}` : '—'));
    tr.appendChild(el('td', '', o.ozet.sonraki_vade
      ? `${tarihTR(o.ozet.sonraki_vade)}${o.ozet.sonraki_vade_gun != null && o.ozet.sonraki_vade_gun >= 0 ? ` (${o.ozet.sonraki_vade_gun} gün)` : ''}`
      : '—'));

    const td6 = el('td', 'sag');
    if (o.ozet.borc > 0) td6.appendChild(el('span', 'borc', TL(o.ozet.borc)));
    else td6.appendChild(el('span', 'sifir', o.ozet.alacak > 0 ? '+' + TL(o.ozet.alacak) : '—'));
    tr.appendChild(td6);

    const td7 = el('td');
    const d = o.durum === 'Pasif' ? 'pasif' : o.ozet.durum;
    td7.appendChild(el('span', 'durum d-' + d, o.durum === 'Pasif' ? 'Pasif' : (DURUM_ADI[d] || d)));
    tr.appendChild(td7);

    govde.appendChild(tr);
  }
  if (durum.ogrenciler.length && !liste.length) {
    const tr = el('tr');
    const td = el('td', 'bos', 'Bu filtreye uyan öğrenci yok.');
    td.colSpan = 7;
    tr.appendChild(td);
    govde.appendChild(tr);
  }
}

/* ------------------------- eşleşmeyen fişler ------------------------- */

async function fisleriYukle() {
  try {
    const { fisler } = await api('/api/fisler');
    const bolum = $('#fisBolum');
    bolum.classList.toggle('gizli', fisler.length === 0);
    $('#fisSayi').textContent = fisler.length;
    const kap = $('#fisListe');
    kap.innerHTML = '';
    for (const f of fisler) {
      let veri = {};
      try { veri = JSON.parse(f.fis_metin || '{}'); } catch (_) {}
      const kart = el('div', 'fis-kart');
      const img = el('img');
      img.src = `/api/fisler/${f.id}/dosya`;
      img.onclick = () => window.open(img.src, '_blank');
      img.onerror = () => { img.replaceWith(el('div', 'fis-bilgi', 'görsel yok')); };
      kart.appendChild(img);

      const bilgi = el('div', 'fis-bilgi');
      bilgi.appendChild(el('div', 't', veri.gonderen || veri.ogrenci || f.ogrenci_ad || 'İsim okunamadı'));
      const satir = [];
      if (f.tutar) satir.push(TL(f.tutar));
      if (f.tarih) satir.push(tarihTR(f.tarih));
      if (veri.yontem) satir.push(veri.yontem);
      bilgi.appendChild(el('div', 'alt', satir.join(' · ') || 'bilgi okunamadı'));

      const form = el('form', 'fis-form');
      const sec = el('select');
      sec.appendChild(new Option('Öğrenci seç...', ''));
      for (const o of durum.ogrenciler) sec.appendChild(new Option(o.ad, o.id));
      if (f.student_id) sec.value = String(f.student_id);
      const tut = el('input'); tut.type = 'number'; tut.step = '0.01'; tut.placeholder = 'tutar'; tut.value = f.tutar || '';
      const tar = el('input'); tar.type = 'date'; tar.value = f.tarih || '';
      const kaydet = el('button', 'btn kucuk', 'Onayla'); kaydet.type = 'submit';
      form.append(sec, tut, tar, kaydet);
      form.onsubmit = async (e) => {
        e.preventDefault();
        if (!sec.value) return alert('Öğrenci seçin.');
        try {
          await api(`/api/fisler/${f.id}/onayla`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ student_id: sec.value, tutar: tut.value, tarih: tar.value }),
          });
          await yukle();
          if (durum.acikOgrenci) panelAc(durum.acikOgrenci);
        } catch (err) { alert('Kaydedilemedi: ' + err.message); }
      };
      bilgi.appendChild(form);

      const sil = el('button', 'btn kucuk tehlike', 'Sil'); sil.type = 'button'; sil.style.marginTop = '6px';
      sil.onclick = async () => {
        if (!confirm('Bu fiş kaydı silinsin mi?')) return;
        await api('/api/odemeler/' + f.id, { method: 'DELETE' });
        yukle();
      };
      bilgi.appendChild(sil);

      kart.appendChild(bilgi);
      kap.appendChild(kart);
    }
  } catch (e) { console.error(e); }
}

/* ------------------------- öğrenci paneli ------------------------- */

async function panelAc(id) {
  const d = await api('/api/ogrenciler/' + id);
  durum.acikOgrenci = id;
  const o = d.ogrenci, z = d.ozet;
  $('#pAd').textContent = o.ad;
  $('#pAlt').textContent = [o.veli, o.telefon, o.durum === 'Pasif' ? 'Pasif' : null].filter(Boolean).join(' · ') || '—';

  const kutu = (etiket, deger, sinif = '') => {
    const k = el('div', 'kutu');
    k.appendChild(el('div', 'etiket', etiket));
    const dv = el('div', 'deger', deger);
    if (sinif) dv.style.color = `var(--${sinif})`;
    k.appendChild(dv);
    return k;
  };
  const oz = $('#pOzet'); oz.innerHTML = '';
  oz.appendChild(kutu('Aylık ücret', TL(o.aylik_ucret)));
  oz.appendChild(kutu('Ödeme günü', 'Her ayın ' + (o.odeme_gunu || '—') + '. günü'));
  oz.appendChild(kutu('Gecikmiş borç', z.borc > 0 ? TL(z.borc) : 'Yok', z.borc > 0 ? 'kirmizi' : 'yesil'));
  oz.appendChild(kutu('Sonraki ödeme', z.sonraki_vade ? tarihTR(z.sonraki_vade) : '—'));
  oz.appendChild(kutu('Tahsil edilen', TL(z.odenen_toplam)));
  oz.appendChild(kutu('Ödenen vade', `${z.odenmis_vade_sayisi} / ${z.vade_sayisi}`));

  const gecmis = $('#pOdemeler'); gecmis.innerHTML = '';
  const odemeler = d.odemeler.filter((x) => x.dogrulandi === 1);
  if (!odemeler.length) {
    const tr = el('tr'); const td = el('td', 'bos', 'Kayıtlı ödeme yok.'); td.colSpan = 4; tr.appendChild(td); gecmis.appendChild(tr);
  }
  for (const p of odemeler) {
    const tr = el('tr');
    tr.appendChild(el('td', '', tarihTR(p.tarih)));
    tr.appendChild(el('td', 'sag', TL(p.tutar)));
    tr.appendChild(el('td', 'yontem-et', p.yontem || (p.kaynak === 'telegram' ? 'Telegram fişi' : p.kaynak || '')));
    const td = el('td', 'sag');
    const b = el('button', 'kapat', '✕'); b.title = 'Ödemeyi sil';
    b.onclick = async () => {
      if (!confirm(`${tarihTR(p.tarih)} tarihli ${TL(p.tutar)} ödeme silinsin mi?`)) return;
      await api('/api/odemeler/' + p.id, { method: 'DELETE' });
      await yukle(); panelAc(id);
    };
    td.appendChild(b); tr.appendChild(td);
    gecmis.appendChild(tr);
  }

  const vad = $('#pVadeler'); vad.innerHTML = '';
  // Geçmiş 6 vade eskiden yeniye, ardından gelecek 6 vade — okunabilir bir zaman çizelgesi.
  const hepsi = [...z.vadeler.slice(-6), ...d.gelecek_vadeler.slice(0, 6)];
  for (const v of hepsi) {
    const tr = el('tr');
    tr.appendChild(el('td', '', tarihTR(v.vade)));
    tr.appendChild(el('td', 'sag', v.odenen > 0 && v.kalan > 0 ? TL(v.odenen) + ' / ' + TL(v.beklenen) : TL(v.beklenen)));
    const td = el('td');
    td.appendChild(el('span', 'durum d-' + v.durum, DURUM_ADI[v.durum] || v.durum));
    tr.appendChild(td);
    vad.appendChild(tr);
  }

  $('#oTarih').value = durum.ozet.bugun;
  $('#oTutar').value = o.aylik_ucret || '';
  $('#panel').classList.remove('gizli');
}

function panelKapat() { $('#panel').classList.add('gizli'); durum.acikOgrenci = null; }

/* ------------------------- modal yardımcıları ------------------------- */

function modalAc(baslik, govdeHtml, altButonlar = []) {
  $('#mBaslik').textContent = baslik;
  $('#mGovde').innerHTML = '';
  if (typeof govdeHtml === 'string') $('#mGovde').innerHTML = govdeHtml; else $('#mGovde').appendChild(govdeHtml);
  const alt = $('#mAlt'); alt.innerHTML = '';
  for (const b of altButonlar) {
    const btn = el('button', 'btn ' + (b.sinif || ''), b.etiket);
    btn.onclick = b.tikla;
    alt.appendChild(btn);
  }
  $('#modalArka').classList.remove('gizli');
}
function modalKapat() { $('#modalArka').classList.add('gizli'); }

function ogrenciFormu(o = {}) {
  const f = el('div');
  f.innerHTML = `
    <div class="form-satir">
      <div><label>Öğrenci adı soyadı</label><input id="fAd" value="${o.ad || ''}"></div>
      <div><label>Veli adı</label><input id="fVeli" value="${o.veli || ''}"></div>
    </div>
    <div class="form-satir">
      <div><label>Telefon</label><input id="fTel" value="${o.telefon || ''}" placeholder="05xx xxx xx xx"></div>
      <div><label>Aylık ücret (TL)</label><input id="fUcret" type="number" step="0.01" min="0" value="${o.aylik_ucret || ''}"></div>
    </div>
    <div class="form-satir">
      <div><label>Ödeme günü (ayın kaçı)</label><input id="fGun" type="number" min="1" max="31" value="${o.odeme_gunu || ''}"></div>
      <div><label>Başlangıç tarihi</label><input id="fBas" type="date" value="${o.baslangic || durum.ozet.bugun}"></div>
    </div>
    <div class="form-satir">
      <div><label>Durum</label><select id="fDurum"><option>Aktif</option><option ${o.durum === 'Pasif' ? 'selected' : ''}>Pasif</option></select></div>
      <div><label>Not</label><input id="fNot" value="${(o.not_metni || '').replace(/"/g, '&quot;')}"></div>
    </div>`;
  return f;
}

function formDegerleri() {
  return {
    ad: $('#fAd').value, veli: $('#fVeli').value, telefon: $('#fTel').value,
    aylik_ucret: $('#fUcret').value, odeme_gunu: $('#fGun').value,
    baslangic: $('#fBas').value, durum: $('#fDurum').value, not_metni: $('#fNot').value,
  };
}

/* ------------------------- Excel içe aktarma ------------------------- */

let iceAktarDurum = { dosya: null, ad: '', onizleme: null, sayfaIndex: 0 };

function excelModal() {
  iceAktarDurum = { dosya: null, ad: '', onizleme: null, sayfaIndex: 0 };
  const g = el('div');
  g.innerHTML = `
    <p class="ipucu">Öğrenci listesi ve/veya ödeme geçmişi içeren Excel (.xlsx) veya CSV dosyanızı seçin.
    Sütun sırası önemli değildir — başlıklara göre eşleştirilir. Önce önizleme gösterilir, onaylamadan hiçbir kayıt yazılmaz.</p>
    <p><a href="/api/sablon.xlsx">Boş şablonu indir</a> · <input type="file" id="xlsDosya" accept=".xlsx,.xls,.csv"></p>
    <div id="xlsOnizleme"></div>`;
  modalAc('Excel’den içe aktar', g, [{ etiket: 'Kapat', sinif: 'ikincil', tikla: modalKapat }]);
  $('#xlsDosya').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const b64 = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.readAsDataURL(f); });
    iceAktarDurum.dosya = b64; iceAktarDurum.ad = f.name;
    await onizlemeAl();
  };
}

async function onizlemeAl() {
  const kap = $('#xlsOnizleme');
  kap.innerHTML = '<p class="ipucu">Dosya okunuyor...</p>';
  try {
    const r = await api('/api/ice-aktar/onizle', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base64: iceAktarDurum.dosya, dosyaAdi: iceAktarDurum.ad }),
    });
    iceAktarDurum.onizleme = r.sayfalar;
    iceAktarDurum.sayfaIndex = 0;
    onizlemeCiz();
  } catch (e) { kap.innerHTML = `<p class="hata-metin">Dosya okunamadı: ${e.message}</p>`; }
}

function onizlemeCiz() {
  const kap = $('#xlsOnizleme');
  kap.innerHTML = '';
  const sayfalar = iceAktarDurum.onizleme;
  const s = sayfalar[iceAktarDurum.sayfaIndex];

  if (sayfalar.length > 1) {
    const sec = el('select');
    sayfalar.forEach((x, i) => sec.appendChild(new Option(`${x.ad} (${x.kayit_sayisi} kayıt)`, i)));
    sec.value = String(iceAktarDurum.sayfaIndex);
    sec.onchange = () => { iceAktarDurum.sayfaIndex = +sec.value; onizlemeCiz(); };
    const sar = el('div'); sar.style.marginBottom = '12px';
    sar.innerHTML = '<label>Sayfa</label>'; sar.appendChild(sec);
    kap.appendChild(sar);
  }

  const modSec = el('select');
  modSec.appendChild(new Option('Öğrenci listesi + aylık ücret', 'ogrenci'));
  modSec.appendChild(new Option('Ödeme geçmişi (tarih + tutar)', 'odeme'));
  modSec.value = s.mod;
  const modSar = el('div'); modSar.style.marginBottom = '12px';
  modSar.innerHTML = '<label>Bu sayfa ne içeriyor?</label>'; modSar.appendChild(modSec);
  kap.appendChild(modSar);

  const bilgi = el('div', 'tamam');
  bilgi.innerHTML = `<b>${s.ad}</b> sayfası: ${s.satir_sayisi} dolu satır bulundu, <b>${s.kayit_sayisi}</b> kayıt okunabilir.`;
  kap.appendChild(bilgi);

  const eslesen = Object.entries(s.kolonlar).map(([k, v]) => `${k} → “${s.basliklar[v] || ''}”`).join(' · ');
  const km = el('p', 'ipucu', 'Eşleşen sütunlar: ' + (eslesen || 'yok'));
  kap.appendChild(km);
  if (s.taninmayan.length) {
    const t = el('p', 'ipucu', 'Yok sayılan sütunlar: ' + s.taninmayan.map((x) => x.baslik).join(', '));
    kap.appendChild(t);
  }
  if (!s.kayit_sayisi) {
    const u = el('div', 'uyari', 'Bu sayfadan okunabilir kayıt çıkmadı. Sayfayı veya eşleşen sütunları kontrol edin.');
    kap.appendChild(u);
  }
  if (s.hatalar.length) {
    const u = el('div', 'uyari');
    u.innerHTML = '<b>Atlanan satırlar:</b>';
    const ul = el('ul', 'sade');
    s.hatalar.forEach((h) => ul.appendChild(el('li', '', `${h.satir}. satır: ${h.hata}`)));
    u.appendChild(ul);
    kap.appendChild(u);
  }
  if (s.ornek.length) {
    const tb = el('table', 'tablo kucuk');
    tb.innerHTML = '<thead><tr>' + (s.mod === 'odeme'
      ? '<th>Öğrenci</th><th class="sag">Tutar</th><th>Tarih</th>'
      : '<th>Öğrenci</th><th>Veli</th><th>Telefon</th><th class="sag">Aylık</th><th>Ödeme günü</th><th>Başlangıç</th>') + '</tr></thead>';
    const tb2 = el('tbody');
    for (const k of s.ornek) {
      const tr = el('tr');
      if (s.mod === 'odeme') {
        tr.append(el('td', '', k.ad), el('td', 'sag', TL(k.tutar)), el('td', '', tarihTR(k.tarih)));
      } else {
        tr.append(el('td', '', k.ad), el('td', '', k.veli || '—'), el('td', '', k.telefon || '—'),
          el('td', 'sag', TL(k.aylik_ucret)), el('td', '', k.odeme_gunu || '—'), el('td', '', tarihTR(k.baslangic)));
      }
      tb2.appendChild(tr);
    }
    tb.appendChild(tb2);
    const h = el('h3', '', 'İlk satırlar'); h.style.marginTop = '16px'; kap.appendChild(h);
    kap.appendChild(tb);
  }

  const alt = $('#mAlt');
  alt.innerHTML = '';
  const kapat = el('button', 'btn ikincil', 'Kapat'); kapat.onclick = modalKapat;
  const uygula = el('button', 'btn', `${s.kayit_sayisi} kaydı içe aktar`);
  uygula.disabled = !s.kayit_sayisi;
  uygula.onclick = async () => {
    uygula.disabled = true; uygula.textContent = 'Aktarılıyor...';
    try {
      const r = await api('/api/ice-aktar/uygula', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base64: iceAktarDurum.dosya, dosyaAdi: iceAktarDurum.ad, sayfaIndex: iceAktarDurum.sayfaIndex, mod: s.mod, kolonlar: s.kolonlar }),
      });
      const sn = r.sonuc;
      let ozet = `İçe aktarma tamamlandı.\n\nYeni öğrenci: ${sn.eklenen}\nGüncellenen: ${sn.guncellenen}\nEklenen ödeme: ${sn.odeme_eklenen}\nZaten var olduğu için atlanan: ${sn.atlanan}`;
      if (sn.eslesmeyen.length) ozet += `\n\nÖğrencisi bulunamayan ${sn.eslesmeyen.length} ödeme: ${sn.eslesmeyen.slice(0, 8).join(', ')}`;
      alert(ozet);
      modalKapat(); yukle();
    } catch (e) { alert('Hata: ' + e.message); uygula.disabled = false; uygula.textContent = 'Tekrar dene'; }
  };
  alt.append(kapat, uygula);
}

/* ------------------------- olaylar ------------------------- */

$('#btnYeni').onclick = () => {
  modalAc('Yeni öğrenci', ogrenciFormu(), [
    { etiket: 'Vazgeç', sinif: 'ikincil', tikla: modalKapat },
    {
      etiket: 'Kaydet', tikla: async () => {
        try {
          await api('/api/ogrenciler', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(formDegerleri()) });
          modalKapat(); yukle();
        } catch (e) { alert('Kaydedilemedi: ' + e.message); }
      }
    },
  ]);
};

$('#pDuzenle').onclick = async () => {
  const d = await api('/api/ogrenciler/' + durum.acikOgrenci);
  modalAc('Öğrenci bilgileri', ogrenciFormu(d.ogrenci), [
    { etiket: 'Vazgeç', sinif: 'ikincil', tikla: modalKapat },
    {
      etiket: 'Kaydet', tikla: async () => {
        try {
          await api('/api/ogrenciler/' + durum.acikOgrenci, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(formDegerleri()) });
          modalKapat(); await yukle(); panelAc(durum.acikOgrenci);
        } catch (e) { alert('Kaydedilemedi: ' + e.message); }
      }
    },
  ]);
};

$('#pSil').onclick = async () => {
  const ad = $('#pAd').textContent;
  if (!confirm(`${ad} ve tüm ödeme kayıtları silinsin mi? Bu işlem geri alınamaz.`)) return;
  await api('/api/ogrenciler/' + durum.acikOgrenci, { method: 'DELETE' });
  panelKapat(); yukle();
};

$('#odemeForm').onsubmit = async (e) => {
  e.preventDefault();
  try {
    await api('/api/odemeler', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ student_id: durum.acikOgrenci, tutar: $('#oTutar').value, tarih: $('#oTarih').value, yontem: $('#oYontem').value }),
    });
    await yukle(); panelAc(durum.acikOgrenci);
  } catch (err) { alert('Kaydedilemedi: ' + err.message); }
};

$('#pKapat').onclick = panelKapat;
$('#mKapat').onclick = modalKapat;
$('#modalArka').onclick = (e) => { if (e.target.id === 'modalArka') modalKapat(); };
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { modalKapat(); panelKapat(); } });

$('#ara').oninput = (e) => { durum.ara = e.target.value; tabloyuCiz(); };
$('#filtre').onclick = (e) => {
  const b = e.target.closest('.cip'); if (!b) return;
  durum.filtre = b.dataset.f;
  document.querySelectorAll('.cip').forEach((x) => x.classList.toggle('secili', x === b));
  tabloyuCiz();
};

$('#btnExcel').onclick = excelModal;

$('#btnBildirim').onclick = async () => {
  try {
    const r = await api('/api/bildirim/test', { method: 'POST' });
    alert(r.atlandi ? 'Gönderilecek bildirim yok (' + r.atlandi + ').' : 'Telegram bildirimi gönderildi.');
  } catch (e) { alert('Gönderilemedi: ' + e.message); }
};

$('#btnAyarlar').onclick = async () => {
  const a = await api('/api/ayarlar');
  const g = el('div');
  const durumSatiri = (etiket, var_mi) =>
    `<p>${etiket}: <b style="color:var(--${var_mi ? 'yesil' : 'kirmizi'})">${var_mi ? 'tanımlı' : 'tanımlı değil'}</b></p>`;
  g.innerHTML = `
    <div class="form-satir tam">
      <div><label>Vadesi yaklaşan ödemeler kaç gün önce bildirilsin?</label>
      <input id="aGun" type="number" min="0" max="30" value="${a.ayarlar.hatirlatma_gun || 3}"></div>
    </div>
    <h3>Bağlantı durumu</h3>
    ${durumSatiri('Telegram bot token', a.ortam.telegram_token_var)}
    ${durumSatiri('Telegram sohbet (chat) kimliği', a.ortam.telegram_chat_var)}
    ${durumSatiri('Fotoğraf okuma anahtarı (PDF dekont için gerekmez)', a.ortam.gorsel_model_var)}
    <p class="ipucu">Günlük bildirim saati: <b>${a.ortam.bildirim_saati}</b> · Fiş okuma modeli: <b>${a.ortam.gorsel_model}</b></p>
    <p class="ipucu">Bu değerler uygulama klasöründeki <b>.env</b> dosyasından okunur. Değiştirdikten sonra uygulamayı yeniden başlatın.</p>`;
  modalAc('Ayarlar', g, [
    { etiket: 'Kapat', sinif: 'ikincil', tikla: modalKapat },
    {
      etiket: 'Kaydet', tikla: async () => {
        await api('/api/ayarlar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hatirlatma_gun: $('#aGun').value }) });
        modalKapat(); alert('Kaydedildi.');
      }
    },
  ]);
};

yukle().catch((e) => { document.body.insertAdjacentHTML('afterbegin', `<p class="hata-metin" style="padding:20px">Sunucuya bağlanılamadı: ${e.message}</p>`); });

# Ödeme Takip

Öğrencilerin aylık ödemelerini takip eden, borçları hesaplayan, gecikince Telegram'dan
haber veren ve Telegram'a gönderdiğiniz **fişi (PDF dekont veya fotoğraf) okuyup** ödemeyi
kendisi kaydeden küçük bir web uygulaması.

- Tamamen **bağımsız** çalışır: kendi `database.db` dosyası, kendi `.env` dosyası.
  Başka hiçbir uygulamanın verisini okumaz, ona bağlanmaz.
- Tek komutla başlar, veritabanı kurulumu istemez, internet bağlantısı dışında hiçbir servise ihtiyaç duymaz.

---

## 1. Kurulum (kendi bilgisayarınızda)

1. **Node.js** kurulu olmalı (20 veya üzeri): https://nodejs.org  → “LTS” sürümü indirin.
2. Bu klasörü bilgisayarınıza kopyalayın (ör. `C:\odeme-takip`).
3. Klasörde bir komut penceresi açıp **bir kez** şunu çalıştırın:
   ```
   npm install
   ```
4. `.env.ornek` dosyasını kopyalayıp adını `.env` yapın ve içindeki alanları doldurun
   (aşağıda anlatılıyor). Token yoksa uygulama yine açılır, sadece Telegram bölümü çalışmaz.
5. Bundan sonra başlatmak için **`baslat.bat`** dosyasına çift tıklayın.
   Tarayıcı kendiliğinden `http://127.0.0.1:3400` adresini açar.

---

## 2. Telegram botu kurulumu (bildirim ve fiş okuma için)

1. Telegram'da **@BotFather**'a yazın → `/newbot` → bota bir isim verin.
   BotFather size şuna benzer bir **token** verir: `1234567890:AAH...`
2. Bu token'ı `.env` dosyasındaki `TELEGRAM_BOT_TOKEN=` satırına yapıştırın.
3. Botunuza Telegram'dan bir mesaj yazın (ör. `merhaba`), sonra komut penceresinde:
   ```
   node scripts/telegram-kur.js
   ```
   Betik botun adını ve **chat id** numaranızı yazdırır. O numarayı `.env` dosyasındaki
   `TELEGRAM_CHAT_ID=` satırına yazın.
4. Uygulamayı yeniden başlatın. Artık:
   - gecikmiş / yaklaşan ödemeler her gün saat **09:00**'da Telegram'a gelir,
   - botunuza **fiş fotoğrafı** gönderdiğinizde tutar, tarih ve isim okunup kaydedilir,
   - bot üzerinden `/durum`, `/liste`, `/ode` komutlarını kullanabilirsiniz.

### Fiş okuma: PDF için anahtar gerekmez

Sistem fişi iki yoldan okur ve **önce ücretsiz yolu dener**:

| Gönderilen | Nasıl okunur | Anahtar gerekir mi? |
|---|---|---|
| **PDF dekont** (bankadan indirilen, e-postayla gelen) | PDF'in içindeki **gerçek yazı katmanı** doğrudan okunur | **Hayır** — yerel, ücretsiz, harf hatası yok |
| **Taranmış PDF** (kâğıdı tarayıp PDF yapılmış) | İçinde yazı katmanı yoktur → ekran görüntüsü istenir | — |
| **Fotoğraf / ekran görüntüsü** (JPG/PNG) | Görsel model ile okunur | Evet |

Yani **bankanın PDF dekontunu gönderirseniz hiçbir anahtara ihtiyaç yoktur.**
Anahtar yalnızca fotoğraf/ekran görüntüsü okumak için gerekir; isterseniz hiç almadan kullanın.

Anahtar almak isterseniz (fotoğraf yolu için): https://openrouter.ai → kayıt olun → **Keys** →
yeni anahtar → `.env` dosyasındaki `OPENROUTER_API_KEY=` satırına yapıştırın.

Kurulumu denemek için: `node scripts/fis-testi.js <fiş.pdf veya fiş.png>`

---

## 3. Kullanım

### Öğrenci ekleme
**Yeni öğrenci** düğmesi: ad soyad, veli, telefon, **aylık ücret**, **ödeme günü**
(her ayın kaçında ödüyor) ve başlangıç tarihi.

Bu dört bilgi vade takvimini üretir: örneğin aylık 1.200 TL, ödeme günü 5, başlangıç
01.11.2026 → her ayın 5'i bir vade. Ödemeler en eski vadeden başlanarak mahsup edilir;
karşılanmayan vadeler **gecikmiş borç** olur.

### Excel'den içe aktarma
**Excel'den içe aktar** düğmesi → dosyayı seçin → sistem sütunları **başlıklarına göre**
tanır (sıraları önemli değil) → önizlemeyi gösterir → onaylayınca yazar. Onaylamadan
hiçbir kayıt oluşmaz.

İki tür sayfa desteklenir (sayfa başına tür seçilir):

| Sayfa türü | Beklenen sütunlar |
|---|---|
| Öğrenci listesi | Ad Soyad, Veli, Telefon, Aylık Ücret, Ödeme Günü, Başlangıç, Durum |
| Ödeme geçmişi | Ad Soyad, Tutar, Ödeme Tarihi, Açıklama |

Boş şablonu uygulamadaki bağlantıdan indirebilirsiniz: `/api/sablon.xlsx`
(veya `http://127.0.0.1:3400/api/sablon.xlsx`).

Aynı dosyayı iki kez aktarmak kopya oluşturmaz: var olan öğrenci güncellenir, aynı tarih
ve tutardaki ödeme atlanır.

### Ekranlar
- **Özet kartları**: bu ay tahsil edilen, toplam gecikmiş borç, 7 gün içinde vadesi gelenler, aktif öğrenci sayısı.
- **Öğrenci listesi**: durum sırasına göre (gecikmiş → yaklaşan → güncel). Satıra tıklayınca
  yan panel açılır: ödeme geçmişi, vade takvimi, ödeme ekleme, bilgi düzenleme.
- **Eşleşmeyen fişler**: Telegram'dan gelip bir öğrenciye bağlanamayan fişler. Fotoğrafa
  bakıp öğrenciyi seçin, tutarı/tarihi düzeltin, **Onayla** deyin.
- **Ayarlar**: vadesi yaklaşan ödemelerin kaç gün önce bildirileceği ve bağlantı durumu.

---

## 4. Telegram komutları

| Komut | Ne yapar |
|---|---|
| *(fiş gönder)* | PDF dekont veya fotoğraf: tutar/tarih/isim çıkarılır, öğrenciye bağlanır ve kaydedilir |
| `/durum` | Gecikmiş ve yaklaşan ödemelerin özeti |
| `/liste` | Tüm öğrenciler ve durumları |
| `/ode <isim> <tutar>` | Elle ödeme kaydı (ör. `/ode Defne 1200`) |
| `/yardim` | Komut listesi |

Fiş, bir öğrenciye güvenle bağlanamazsa (isim okunamadı veya tutar/tarih eksik)
kayıt **onay bekliyor** olarak saklanır ve size bildirilir; arayüzden onaylarsınız.
Hiçbir ödeme yanlış öğrenciye sessizce yazılmaz.

---

## 5. Ayarlar (.env)

| Alan | Açıklama |
|---|---|
| `HOST` | `127.0.0.1` = sadece bu bilgisayar. Aynı ağdaki tablet/telefondan da açmak için `0.0.0.0` |
| `PORT` | Varsayılan `3400` |
| `TELEGRAM_BOT_TOKEN` | BotFather'dan alınan token |
| `TELEGRAM_CHAT_ID` | Bildirimlerin gideceği sohbet numarası |
| `OPENROUTER_API_KEY` | Fiş okuma anahtarı |
| `VISION_MODEL` | Fiş okuma modeli (varsayılan `google/gemini-4-neon`) |
| `BILDIRIM_SAATI` | Günlük bildirim saati (varsayılan `09:00`) |
| `TZ` | Saat dilimi (varsayılan `Europe/Istanbul`) |
| `DB_PATH` | Veritabanı dosyası yeri (varsayılan: uygulama klasörü/database.db) |
| `FIS_KLASOR` | Fiş fotoğraflarının saklanacağı klasör (varsayılan: `fisler/`) |

`HOST=0.0.0.0` yaparsanız arayüz ağdaki diğer cihazlardan açılabilir hale gelir —
modem yönlendirmesi (port forward) yapmadığınız sürece internetten erişilemez.

---

## 6. Yedekleme

- Tüm veri tek dosyada: **`database.db`**. Bu dosyayı kopyalamak tam yedektir.
- Fiş fotoğrafları `fisler/` klasöründedir (silinirse yalnızca görsel kaybolur, kayıt kalır).

---

## 7. Testler

```
npm test
```
Vade/borç hesapları, Excel eşleştirme, fiş ayrıştırma ve Telegram bot akışı (sahte
Telegram sunucusuyla) test edilir. Gerçek çalışan sunucuya karşı uçtan uca deneme:

```
node scripts/duman-testi.js          # DİKKAT: demo kayıtlar oluşturur, boş veritabanında çalıştırın
```

---

## 8. Dosya yapısı

```
server.js              HTTP sunucusu ve API uçları
lib/hesap.js           vade takvimi, mahsup, borç hesabı (saf fonksiyonlar)
lib/db.js              SQLite şeması ve yardımcıları
lib/telegram.js        Telegram botu (uzun yoklama), komutlar, fiş alma
lib/fis.js             fiş fotoğrafını okuma + öğrenci eşleştirme
lib/excel.js           Excel okuma, sütun eşleştirme, önizleme, şablon
lib/bildirim.js        günlük bildirim zamanlayıcısı
public/                web arayüzü (index.html, app.js, style.css)
scripts/               kurulum ve test yardımcıları
tests/                 otomatik testler
```

## 9. Sorun giderme

| Belirti | Çözüm |
|---|---|
| Telegram'a bildirim gelmiyor | `.env`'de token ve chat id dolu mu? `node scripts/telegram-kur.js` ile kontrol edin. **Bildirimi dene** düğmesi sonucu hemen söyler. |
| Bot mesajlara cevap vermiyor | Uygulama açık olmalı (bot yalnızca uygulama çalışırken dinler). Aynı token'ı başka bir program kullanıyorsa ikisi çakışır. |
| Fiş okunamadı | PDF dekont gönderin (yazı katmanı varsa anahtarsız okunur). Fotoğraf için net ve tam çekim gerekir; `VISION_MODEL` değerini değiştirip başka model deneyebilirsiniz. |
| Excel'den kayıt çıkmadı | Önizleme ekranındaki “sayfa ne içeriyor?” seçimini değiştirin; başlık satırının ilk dolu satır olduğundan emin olun. |
| Arayüz açılmıyor | Komut penceresinde hata var mı bakın; `npm install` çalıştırılmış olmalı. |

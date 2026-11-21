'use strict';
/**
 * Telegram kurulum yardımcısı.
 * .env içindeki TELEGRAM_BOT_TOKEN ile bağlanır, botun adını ve size gelen
 * sohbet kimliğini (chat id) yazdırır.
 *
 * Kullanım:  node scripts/telegram-kur.js
 * Önce Telegram'da botunuza bir mesaj yazın (ör. "merhaba"), sonra bu betiği çalıştırın.
 */
const fs = require('fs');
const path = require('path');

(function () {
  const p = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(p)) return;
  for (const s of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(s);
    if (m && process.env[m[1]] == null) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
})();

const kok = process.env.TELEGRAM_API_BASE || 'https://api.telegram.org';

(async () => {
  const t = process.env.TELEGRAM_BOT_TOKEN;
  if (!t) {
    console.error('✖ .env dosyasında TELEGRAM_BOT_TOKEN boş.');
    console.error('  Telegram\'da @BotFather → /newbot ile bot oluşturup token\'ı .env dosyasına yazın.');
    process.exit(1);
  }
  const me = await (await fetch(`${kok}/bot${t}/getMe`)).json();
  if (!me.ok) {
    console.error('✖ Bot doğrulanamadı:', me.description || 'bilinmeyen hata');
    console.error('  Token yanlış olabilir. @BotFather\'dan aldığınız token\'ı aynen kopyalayın.');
    process.exit(2);
  }
  console.log(`✔ Bot bulundu: @${me.result.username} (${me.result.first_name})`);

  const g = await (await fetch(`${kok}/bot${t}/getUpdates?timeout=0`)).json();
  if (!g.ok) { console.error('✖ getUpdates hatası:', g.description); process.exit(3); }
  const sohbetler = new Map();
  for (const u of g.result || []) {
    const c = (u.message || u.edited_message || {}).chat;
    if (c) sohbetler.set(String(c.id), `${c.first_name || ''} ${c.last_name || ''}`.trim() || c.username || c.type);
  }
  if (!sohbetler.size) {
    console.log('\n⚠ Henüz mesaj görünmüyor.');
    console.log('  1) Telegram\'da botunuza (@' + me.result.username + ') bir mesaj yazın: merhaba');
    console.log('  2) Bu betiği tekrar çalıştırın.');
    process.exit(0);
  }
  console.log('\nBulunan sohbetler:');
  for (const [id, ad] of sohbetler) console.log(`  chat id: ${id}   (${ad})`);
  console.log('\nYapılacak: .env dosyasındaki TELEGRAM_CHAT_ID satırına yukarıdaki numarayı yazın,');
  console.log('sonra uygulamayı yeniden başlatın. Bildirimler bu sohbete gider.');
})().catch((e) => { console.error('✖ Hata:', e.message); process.exit(9); });

'use strict';
/**
 * Veritabanı katmanı (SQLite, tek dosya: database.db).
 * Uygulama tamamen bağımsızdır — başka hiçbir sistemin verisini okumaz.
 */
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'database.db');

const db = new sqlite3.Database(DB_PATH);
db.configure('busyTimeout', 5000);

function run(sql, params = []) {
  return new Promise((res, rej) => db.run(sql, params, function (e) { e ? rej(e) : res({ lastID: this.lastID, changes: this.changes }); }));
}
function get(sql, params = []) {
  return new Promise((res, rej) => db.get(sql, params, (e, r) => (e ? rej(e) : res(r))));
}
function all(sql, params = []) {
  return new Promise((res, rej) => db.all(sql, params, (e, r) => (e ? rej(e) : res(r || []))));
}
function exec(sql) {
  return new Promise((res, rej) => db.exec(sql, (e) => (e ? rej(e) : res())));
}
async function withTransaction(fn) {
  await run('BEGIN IMMEDIATE');
  try { const r = await fn(); await run('COMMIT'); return r; }
  catch (e) { try { await run('ROLLBACK'); } catch (_) {} throw e; }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS students (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ad            TEXT NOT NULL,
  veli          TEXT,
  telefon       TEXT,
  aylik_ucret   REAL NOT NULL DEFAULT 0,
  odeme_gunu    INTEGER,
  baslangic     TEXT,
  durum         TEXT NOT NULL DEFAULT 'Aktif',
  not_metni     TEXT,
  created_at    TEXT
);
CREATE TABLE IF NOT EXISTS payments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id    INTEGER REFERENCES students(id) ON DELETE CASCADE,
  tutar         REAL NOT NULL,
  tarih         TEXT NOT NULL,
  donem         TEXT,
  yontem        TEXT,
  kaynak        TEXT NOT NULL DEFAULT 'manuel',
  fis_dosya     TEXT,
  fis_metin     TEXT,
  dogrulandi    INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT
);
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);
CREATE INDEX IF NOT EXISTS idx_pay_student ON payments(student_id);
CREATE INDEX IF NOT EXISTS idx_pay_tarih   ON payments(tarih);
CREATE INDEX IF NOT EXISTS idx_pay_dogrul  ON payments(dogrulandi);
`;

async function init() {
  await exec(SCHEMA);
  return DB_PATH;
}

async function ayar(key, varsayilan = null) {
  const r = await get('SELECT value FROM settings WHERE key=?', [key]);
  return r ? r.value : varsayilan;
}
async function ayarYaz(key, value) {
  await run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [key, String(value)]);
}

/** Bir öğrencinin tüm ödemeleri (onaylanmış + onay bekleyen). */
async function ogrenciOdemeleri(studentId) {
  return all('SELECT * FROM payments WHERE student_id=? ORDER BY tarih DESC, id DESC', [studentId]);
}

module.exports = { db, DB_PATH, run, get, all, exec, withTransaction, init, ayar, ayarYaz, ogrenciOdemeleri, SCHEMA };

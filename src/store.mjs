import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { dataDir } from './config.mjs';
export const db = new DatabaseSync(path.join(dataDir, 'nightdesk.sqlite'));
db.exec(`PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS calls (id TEXT PRIMARY KEY, record TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS snapshots (name TEXT PRIMARY KEY, record TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS deliveries (id TEXT PRIMARY KEY, hash TEXT NOT NULL, response TEXT);
CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, at TEXT NOT NULL, kind TEXT NOT NULL, detail TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS rules_history (id INTEGER PRIMARY KEY, at TEXT NOT NULL, text TEXT NOT NULL);`);
db.exec(`PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS memory_notes (id INTEGER PRIMARY KEY, at TEXT NOT NULL, call_id TEXT NOT NULL, note TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS memory_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
db.prepare('INSERT OR IGNORE INTO memory_meta VALUES (?,?)').run('created_at',new Date().toISOString());
const bootstrap = path.join(dataDir,'bootstrap.sqlite');
if (existsSync(bootstrap) && !db.prepare('SELECT value FROM memory_meta WHERE key=?').get('local_import_at')) {
  db.prepare('ATTACH DATABASE ? AS bootstrap').run(bootstrap);
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const name of ['calls','snapshots','deliveries','rules_history','events','memory_notes']) {
      if (db.prepare("SELECT name FROM bootstrap.sqlite_master WHERE type='table' AND name=?").get(name)) db.exec(`INSERT OR IGNORE INTO main.${name} SELECT * FROM bootstrap.${name}`);
    }
    db.prepare('INSERT INTO memory_meta VALUES (?,?)').run('local_import_at',new Date().toISOString());
    db.exec('COMMIT');
  } catch(e) { db.exec('ROLLBACK'); throw e; }
  db.exec('DETACH DATABASE bootstrap');
}
export function getCall(id) { const row = db.prepare('SELECT record FROM calls WHERE id=?').get(id); return row ? JSON.parse(row.record) : null; }
export function saveCall(c) { db.prepare('INSERT OR REPLACE INTO calls VALUES (?,?)').run(c.call_id, JSON.stringify(c)); }
export function snapshot(name, data) { db.prepare('INSERT OR REPLACE INTO snapshots VALUES (?,?)').run(name, JSON.stringify(data)); }
export function getSnapshot(name) { const row = db.prepare('SELECT record FROM snapshots WHERE name=?').get(name); return row ? JSON.parse(row.record) : null; }
export function log(kind, detail) { db.prepare('INSERT INTO events(at,kind,detail) VALUES (?,?,?)').run(new Date().toISOString(), kind, JSON.stringify(detail)); }
export function recentEvents() { return db.prepare('SELECT * FROM events ORDER BY id DESC LIMIT 60').all().map(r => ({ ...r, detail: JSON.parse(r.detail) })); }
export function recentCalls() { return db.prepare('SELECT record FROM calls ORDER BY rowid DESC LIMIT 20').all().map(r => JSON.parse(r.record)); }

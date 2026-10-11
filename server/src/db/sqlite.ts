import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '../lib/logger.js';

const migrationsDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'migrations',
);

export type Db = DatabaseSync;

export function openDatabase(dbPath: string): Db {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  runMigrations(db);
  logger.info({ dbPath }, 'SQLite database ready');
  return db;
}

function runMigrations(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);
  const applied = new Set(
    db
      .prepare('SELECT id FROM schema_migrations')
      .all()
      .map((r) => String((r as { id: string }).id)),
  );

  if (!fs.existsSync(migrationsDir)) return;
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    db.exec('BEGIN');
    try {
      db.exec(sql);
      db.prepare(
        'INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)',
      ).run(file, new Date().toISOString());
      db.exec('COMMIT');
      logger.info({ migration: file }, 'Applied migration');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}

import { describe, expect, it, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WalletService } from '../src/services/walletService.js';

function openTestDb() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  const migDir = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '../src/db/migrations',
  );
  for (const file of fs.readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(fs.readFileSync(path.join(migDir, file), 'utf8'));
  }
  return db;
}

describe('wallet balances', () => {
  let svc: WalletService;

  beforeEach(() => {
    svc = new WalletService(openTestDb() as never);
  });

  it('defaults every region to zero without writing', () => {
    const rows = svc.list();
    expect(rows.map((r) => r.region)).toEqual(['IL', 'JP', 'IN', 'TR']);
    expect(rows.every((r) => r.balance.amountMinor === 0)).toBe(true);
    expect(rows.every((r) => r.updatedAt == null)).toBe(true);
  });

  it('updates only the region that was explicitly saved', () => {
    svc.set('JP', 1420);
    const rows = svc.list();
    expect(rows.find((r) => r.region === 'JP')?.balance.amountMinor).toBe(1420);
    expect(rows.find((r) => r.region === 'IL')?.balance.amountMinor).toBe(0);
    expect(rows.find((r) => r.region === 'IN')?.updatedAt).toBeNull();
  });

  it('rejects negative balances and unknown regions', () => {
    expect(() => svc.set('JP', -1)).toThrow();
    expect(() => svc.set('US', 10)).toThrow();
  });
});

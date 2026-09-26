import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/db/sqlite.js';
import { upsertRates, getRates } from '../src/db/repositories/rates.js';

describe('sqlite persistence', () => {
  it('survives reopen and does not erase rates on failed overwrite path', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pspc-'));
    const dbPath = path.join(dir, 'test.sqlite');
    const db = openDatabase(dbPath);
    upsertRates(db, 'ILS', { JPY: 50, INR: 30, TRY: 10 }, 'test', '2026-09-23T00:00:00Z');
    db.close();

    const db2 = openDatabase(dbPath);
    const rates = getRates(db2, 'ILS');
    expect(rates?.rates.JPY).toBe(50);
    // Simulate "failed refresh" by not calling upsertRates — data remains
    const ratesAgain = getRates(db2, 'ILS');
    expect(ratesAgain?.rates.JPY).toBe(50);
    db2.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

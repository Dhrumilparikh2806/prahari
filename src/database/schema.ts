/**
 * schema.ts — SQLite via expo-sqlite v13 (Expo SDK 50)
 *
 * expo-sqlite v13 API used here:
 *   SQLite.openDatabase(name)          → SQLiteDatabase (sync open)
 *   db.transactionAsync(async tx => )  → async transaction
 *   tx.executeSqlAsync(sql, params)    → { rows: { _array: any[] } }
 */

import * as SQLite from 'expo-sqlite';

export const db = SQLite.openDatabase('prahari_v1.sqlite');

/**
 * Creates all tables on first launch.  Call once from app/_layout.tsx.
 */
export async function initDatabase(): Promise<void> {
  await db.transactionAsync(async (tx) => {
    await tx.executeSqlAsync(`
      CREATE TABLE IF NOT EXISTS Personnel (
        id            TEXT PRIMARY KEY,
        name          TEXT NOT NULL,
        enc_embedding TEXT NOT NULL,
        iv            TEXT NOT NULL,
        enrolled_at   INTEGER NOT NULL
      )
    `);

    await tx.executeSqlAsync(`
      CREATE TABLE IF NOT EXISTS AttendanceLogs (
        id            TEXT PRIMARY KEY,
        personnel_id  TEXT NOT NULL,
        timestamp     INTEGER NOT NULL,
        location      TEXT,
        confidence    REAL DEFAULT 0,
        bpm           INTEGER DEFAULT 0,
        synced        INTEGER DEFAULT 0,
        sync_at       INTEGER
      )
    `);

    await tx.executeSqlAsync(`
      CREATE TABLE IF NOT EXISTS SchemaVersion (
        version INTEGER NOT NULL
      )
    `);

    const versionRes = await tx.executeSqlAsync(
      'SELECT version FROM SchemaVersion LIMIT 1'
    );
    if (versionRes.rows.length === 0) {
      await tx.executeSqlAsync('INSERT INTO SchemaVersion (version) VALUES (?)', [1]);
    }
  });
}

/** DEV only — destroys all data */
export async function resetDatabase(confirm: string): Promise<void> {
  if (confirm !== 'DESTROY_ALL_DATA') throw new Error('Explicit confirmation required');
  await db.transactionAsync(async (tx) => {
    await tx.executeSqlAsync('DROP TABLE IF EXISTS AttendanceLogs');
    await tx.executeSqlAsync('DROP TABLE IF EXISTS Personnel');
    await tx.executeSqlAsync('DROP TABLE IF EXISTS SchemaVersion');
  });
  await initDatabase();
}

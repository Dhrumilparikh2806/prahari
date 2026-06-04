/**
 * schema.ts — SQLite Database Initialisation via expo-sqlite
 *
 * expo-sqlite v13 (Expo SDK 50) API used throughout:
 *   openDatabaseSync(name)         → SQLiteDatabase
 *   db.execAsync(sql)              → CREATE TABLE / DDL
 *   db.runAsync(sql, params)       → INSERT / UPDATE / DELETE  → { lastInsertRowId, changes }
 *   db.getAllAsync(sql, params)     → SELECT many  → row[]
 *   db.getFirstAsync(sql, params)  → SELECT one   → row | null
 */

import * as SQLite from 'expo-sqlite';

// ─── Single shared connection ─────────────────────────────────────────────────

export const db = SQLite.openDatabaseSync('prahari_v1.sqlite');

// ─── Schema version ───────────────────────────────────────────────────────────

const SCHEMA_VERSION = 1;

// ─── initDatabase ─────────────────────────────────────────────────────────────

/**
 * Creates all tables and runs any pending migrations.
 * Call once from app/_layout.tsx on startup.
 */
export async function initDatabase(): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS Personnel (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      enc_embedding TEXT NOT NULL,
      iv            TEXT NOT NULL,
      enrolled_at   INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS AttendanceLogs (
      id            TEXT PRIMARY KEY,
      personnel_id  TEXT NOT NULL,
      timestamp     INTEGER NOT NULL,
      location      TEXT,
      confidence    REAL DEFAULT 0,
      bpm           INTEGER DEFAULT 0,
      synced        INTEGER DEFAULT 0,
      sync_at       INTEGER
    );

    CREATE TABLE IF NOT EXISTS SchemaVersion (
      version INTEGER NOT NULL
    );
  `);

  const versionRow = await db.getFirstAsync<{ version: number }>(
    'SELECT version FROM SchemaVersion LIMIT 1'
  );

  if (!versionRow) {
    await db.runAsync('INSERT INTO SchemaVersion (version) VALUES (?)', [SCHEMA_VERSION]);
  }
}

/**
 * Drops all tables and re-initialises. DEV/TEST only.
 */
export async function resetDatabase(confirm: string): Promise<void> {
  if (confirm !== 'DESTROY_ALL_DATA') throw new Error('Explicit confirmation required');
  await db.execAsync(`
    DROP TABLE IF EXISTS AttendanceLogs;
    DROP TABLE IF EXISTS Personnel;
    DROP TABLE IF EXISTS SchemaVersion;
  `);
  await initDatabase();
}

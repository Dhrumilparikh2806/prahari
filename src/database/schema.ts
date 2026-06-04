/**
 * schema.ts — SQLite Database Init via expo-sqlite v13
 *
 * expo-sqlite v13 API:
 *   SQLite.openDatabase(name)          → SQLiteDatabase (sync)
 *   db.transactionAsync(async tx => )  → async transaction
 *   tx.executeSqlAsync(sql, params)    → { rows: any[], rowsAffected: number }
 *
 * Note: openDatabase is sync and safe to call at module load time.
 * initDatabase() must be called (and awaited) once in _layout.tsx before
 * any other DB operation.
 */

import * as SQLite from 'expo-sqlite';

export const db = SQLite.openDatabase('prahari_v1.sqlite');

/**
 * Creates all tables on first launch and stamps schema version.
 * Re-entrant safe — CREATE TABLE IF NOT EXISTS is idempotent.
 *
 * @throws If any SQL statement fails (e.g. disk full, corrupt DB).
 *         The caller (_layout.tsx) is responsible for surfacing this to the user.
 */
export async function initDatabase(): Promise<void> {
  await db.transactionAsync(async (tx) => {
    await tx.executeSqlAsync(`
      CREATE TABLE IF NOT EXISTS Personnel (
        id            TEXT PRIMARY KEY,
        name          TEXT NOT NULL,
        enc_embedding TEXT NOT NULL,
        iv            TEXT NOT NULL DEFAULT '',
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
        version INTEGER PRIMARY KEY
      )
    `);

    const versionRes = await tx.executeSqlAsync(
      'SELECT version FROM SchemaVersion LIMIT 1'
    );
    if (versionRes.rows.length === 0) {
      await tx.executeSqlAsync('INSERT INTO SchemaVersion (version) VALUES (1)');
    }
  });

  console.log('[schema] Database initialised successfully');
}

/** DEV/TEST only — destroys all data and re-initialises. */
export async function resetDatabase(confirm: string): Promise<void> {
  if (confirm !== 'DESTROY_ALL_DATA') throw new Error('Explicit confirmation required');
  await db.transactionAsync(async (tx) => {
    await tx.executeSqlAsync('DROP TABLE IF EXISTS AttendanceLogs');
    await tx.executeSqlAsync('DROP TABLE IF EXISTS Personnel');
    await tx.executeSqlAsync('DROP TABLE IF EXISTS SchemaVersion');
  });
  await initDatabase();
}

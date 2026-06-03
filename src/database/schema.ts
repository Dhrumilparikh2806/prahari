/**
 * schema.ts — SQLite Database Initialisation & Migrations
 *
 * Opens the SQLite database and creates all required tables on first launch.
 * This module exports:
 *   db          — the open database handle (used by vault.js, attendance.ts)
 *   initDatabase — call once at app startup (inside app/_layout.tsx)
 *
 * Tables:
 *   Personnel      — enrolled personnel records (encrypted biometrics)
 *   AttendanceLogs — per-verification attendance events pending cloud sync
 *
 * Migration strategy: each column addition is guarded by a schema_version
 * table.  New versions run their ALTER TABLE statements once and bump the
 * version.  This ensures safe upgrades without data loss.
 */

import { open } from 'react-native-quick-sqlite';

// ─── Database Handle ──────────────────────────────────────────────────────────

/**
 * The single, shared SQLite connection for the app.
 * react-native-quick-sqlite opens a WAL-mode connection by default, which
 * allows concurrent reads while a write is in progress.
 */
export const db = open({ name: 'prahari_v1.sqlite' });

// ─── Current Schema Version ───────────────────────────────────────────────────

const SCHEMA_VERSION = 1;

// ─── Table Definitions ────────────────────────────────────────────────────────

/**
 * Personnel — stores one row per enrolled field worker.
 *
 * Columns:
 *   id            — UUID (primary key)
 *   name          — Display name entered during enrollment
 *   enc_embedding — AES-encrypted 128-dim face embedding (hex string)
 *   iv            — 16-byte IV used for encryption (hex string)
 *   enrolled_at   — Unix timestamp (ms) of enrollment
 */
const CREATE_PERSONNEL = `
  CREATE TABLE IF NOT EXISTS Personnel (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    enc_embedding TEXT NOT NULL,
    iv            TEXT NOT NULL,
    enrolled_at   INTEGER NOT NULL
  )
`;

/**
 * AttendanceLogs — one row per successful verification event.
 *
 * Columns:
 *   id            — UUID (primary key)
 *   personnel_id  — FK → Personnel.id
 *   timestamp     — Unix timestamp (ms) of the verification
 *   location      — Optional GPS coordinates as "lat,lng" string
 *   confidence    — Cosine similarity score at the time of match (0–1)
 *   bpm           — Detected heart rate (BPM) at the time of verification
 *   synced        — 0 = pending sync, 1 = confirmed synced to S3
 *   sync_at       — Unix timestamp (ms) when sync was confirmed (nullable)
 */
const CREATE_ATTENDANCE_LOGS = `
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
`;

/**
 * SchemaVersion — single-row table tracking migration state.
 *
 * Columns:
 *   version — integer schema version number
 */
const CREATE_SCHEMA_VERSION = `
  CREATE TABLE IF NOT EXISTS SchemaVersion (
    version INTEGER NOT NULL
  )
`;

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Initialises the database.  Must be called once during app startup and
 * awaited before any other database operation.
 *
 * Steps:
 *   1. Create all tables if they do not exist.
 *   2. Read / insert the schema version.
 *   3. Run any pending migrations (none in v1, placeholder for future).
 *
 * @throws If any SQL statement fails (e.g., disk full, corrupt DB file).
 */
export async function initDatabase(): Promise<void> {
  // Create core tables
  await db.executeAsync(CREATE_PERSONNEL);
  await db.executeAsync(CREATE_ATTENDANCE_LOGS);
  await db.executeAsync(CREATE_SCHEMA_VERSION);

  // Check current schema version
  const { rows } = await db.executeAsync('SELECT version FROM SchemaVersion LIMIT 1');
  const currentVersion = rows?._array?.[0]?.version ?? 0;

  if (currentVersion === 0) {
    // First launch — insert the initial schema version
    await db.executeAsync('INSERT INTO SchemaVersion (version) VALUES (?)', [SCHEMA_VERSION]);
  } else if (currentVersion < SCHEMA_VERSION) {
    // Run incremental migrations
    await runMigrations(currentVersion);
    await db.executeAsync('UPDATE SchemaVersion SET version = ?', [SCHEMA_VERSION]);
  }
  // currentVersion === SCHEMA_VERSION → no action needed
}

/**
 * Runs all migrations between fromVersion and SCHEMA_VERSION.
 * Add new cases here as the schema evolves.
 *
 * @param fromVersion  The version recorded in SchemaVersion before this run.
 */
async function runMigrations(fromVersion: number): Promise<void> {
  // v1 → v2 example (not needed yet):
  // if (fromVersion < 2) {
  //   await db.executeAsync('ALTER TABLE Personnel ADD COLUMN department TEXT');
  // }
  void fromVersion; // suppress unused-variable lint warning for now
}

/**
 * Drops all tables and resets the schema version.
 * USE ONLY in development / testing — this permanently destroys all data.
 *
 * @param confirm  Must be exactly the string 'DESTROY_ALL_DATA' to proceed.
 */
export async function resetDatabase(confirm: string): Promise<void> {
  if (confirm !== 'DESTROY_ALL_DATA') {
    throw new Error('[schema] resetDatabase requires explicit confirmation string');
  }
  await db.executeAsync('DROP TABLE IF EXISTS AttendanceLogs');
  await db.executeAsync('DROP TABLE IF EXISTS Personnel');
  await db.executeAsync('DROP TABLE IF EXISTS SchemaVersion');
  await initDatabase();
}

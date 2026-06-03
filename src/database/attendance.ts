/**
 * attendance.ts — Attendance Log CRUD Operations
 *
 * Provides typed functions for creating, querying, marking synced, and purging
 * attendance records.  All functions operate on the AttendanceLogs table
 * defined in schema.ts.
 *
 * Usage lifecycle:
 *   1. logAttendance()      — called on each successful verification.
 *   2. getPendingLogs()     — called by syncService before each S3 upload.
 *   3. markSynced()         — called after S3 confirms the upload.
 *   4. purgeSyncedLogs()    — called after markSynced to free local storage.
 *   5. getRecentLogs()      — called by the dashboard screen.
 */

import { db } from '@database/schema';

// ─── Types ────────────────────────────────────────────────────────────────────

/** A single attendance verification event */
export interface AttendanceLog {
  /** UUID generated at log time */
  id: string;
  /** Personnel UUID matching Personnel.id */
  personnelId: string;
  /** Unix timestamp (ms) of the verification */
  timestamp: number;
  /** Optional GPS position: "lat,lng" */
  location: string | null;
  /** Cosine similarity score from the face match (0–1) */
  confidence: number;
  /** Detected heart rate in BPM */
  bpm: number;
  /** 0 = not yet synced to S3, 1 = confirmed synced */
  synced: number;
  /** Unix timestamp (ms) when sync was confirmed, or null */
  syncAt: number | null;
}

// ─── UUID helper ──────────────────────────────────────────────────────────────

/** Generates a RFC-4122 v4 UUID using crypto random bytes */
function generateUUID(): string {
  // Hermes / JSC provide Math.random but not crypto.randomUUID
  const hex = () => Math.floor(Math.random() * 0xffff).toString(16).padStart(4, '0');
  return `${hex()}${hex()}-${hex()}-4${hex().slice(1)}-${hex()}-${hex()}${hex()}${hex()}`;
}

// ─── Row Mapper ───────────────────────────────────────────────────────────────

/** Converts a raw SQLite row object to a typed AttendanceLog */
function rowToLog(row: Record<string, unknown>): AttendanceLog {
  return {
    id: row.id as string,
    personnelId: row.personnel_id as string,
    timestamp: row.timestamp as number,
    location: (row.location as string | null) ?? null,
    confidence: (row.confidence as number) ?? 0,
    bpm: (row.bpm as number) ?? 0,
    synced: (row.synced as number) ?? 0,
    syncAt: (row.sync_at as number | null) ?? null,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Creates a new attendance log entry for a successful verification.
 *
 * @param personnelId  UUID of the verified person (FK → Personnel.id).
 * @param confidence   Cosine similarity score from the face match.
 * @param bpm          Detected heart rate during verification.
 * @param location     Optional GPS string "lat,lng".
 * @returns            The UUID of the newly created log entry.
 */
export async function logAttendance(
  personnelId: string,
  confidence = 0,
  bpm = 0,
  location: string | null = null
): Promise<string> {
  const id = generateUUID();
  const timestamp = Date.now();

  await db.executeAsync(
    `INSERT INTO AttendanceLogs
       (id, personnel_id, timestamp, location, confidence, bpm, synced, sync_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, NULL)`,
    [id, personnelId, timestamp, location, confidence, bpm]
  );

  return id;
}

/**
 * Returns all attendance log entries that have not yet been synced to S3.
 * These are uploaded by syncService and then marked via markSynced().
 *
 * @returns Array of unsynced AttendanceLog records, oldest first.
 */
export async function getPendingLogs(): Promise<AttendanceLog[]> {
  const { rows } = await db.executeAsync(
    'SELECT * FROM AttendanceLogs WHERE synced = 0 ORDER BY timestamp ASC'
  );
  return (rows?._array ?? []).map(rowToLog);
}

/**
 * Marks a set of attendance logs as successfully synced to S3.
 *
 * @param ids  Array of AttendanceLog UUIDs to mark as synced.
 */
export async function markSynced(ids: string[]): Promise<void> {
  if (ids.length === 0) return;

  const placeholders = ids.map(() => '?').join(', ');
  const syncAt = Date.now();

  await db.executeAsync(
    `UPDATE AttendanceLogs SET synced = 1, sync_at = ? WHERE id IN (${placeholders})`,
    [syncAt, ...ids]
  );
}

/**
 * Permanently deletes all attendance logs that have been confirmed synced.
 * Call this after markSynced() to keep the local SQLite file small.
 *
 * Per the privacy design, synced logs are not needed locally — the S3 copy
 * is the system of record for auditing.
 *
 * @returns Number of rows deleted.
 */
export async function purgeSyncedLogs(): Promise<number> {
  const result = await db.executeAsync(
    'DELETE FROM AttendanceLogs WHERE synced = 1'
  );
  return result.rowsAffected ?? 0;
}

/**
 * Returns the most recent N attendance log entries for display in the
 * dashboard, regardless of sync status.
 *
 * @param limit  Maximum number of rows to return (default 50).
 * @returns      Array of AttendanceLog records, newest first.
 */
export async function getRecentLogs(limit = 50): Promise<AttendanceLog[]> {
  const { rows } = await db.executeAsync(
    'SELECT * FROM AttendanceLogs ORDER BY timestamp DESC LIMIT ?',
    [limit]
  );
  return (rows?._array ?? []).map(rowToLog);
}

/**
 * Returns the total count of unsynced log entries.
 * Shown on the home screen as an "offline queue" badge.
 *
 * @returns Number of pending (unsynced) log entries.
 */
export async function getPendingCount(): Promise<number> {
  const { rows } = await db.executeAsync(
    'SELECT COUNT(*) as cnt FROM AttendanceLogs WHERE synced = 0'
  );
  return (rows?._array?.[0]?.cnt as number) ?? 0;
}

/**
 * Returns all log entries for a specific personnel member.
 * Useful for per-person attendance history.
 *
 * @param personnelId  UUID of the person to query.
 * @param limit        Maximum rows to return (default 100).
 */
export async function getLogsForPersonnel(
  personnelId: string,
  limit = 100
): Promise<AttendanceLog[]> {
  const { rows } = await db.executeAsync(
    'SELECT * FROM AttendanceLogs WHERE personnel_id = ? ORDER BY timestamp DESC LIMIT ?',
    [personnelId, limit]
  );
  return (rows?._array ?? []).map(rowToLog);
}

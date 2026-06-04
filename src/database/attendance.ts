/**
 * attendance.ts — Attendance Log CRUD (expo-sqlite v13)
 */

import { db } from '@database/schema';

export interface AttendanceLog {
  id: string;
  personnelId: string;
  timestamp: number;
  location: string | null;
  confidence: number;
  bpm: number;
  synced: number;
  syncAt: number | null;
}

// Raw SQLite row shape
interface AttendanceRow {
  id: string;
  personnel_id: string;
  timestamp: number;
  location: string | null;
  confidence: number;
  bpm: number;
  synced: number;
  sync_at: number | null;
}

function generateUUID(): string {
  const hex = () => Math.floor(Math.random() * 0xffff).toString(16).padStart(4, '0');
  return `${hex()}${hex()}-${hex()}-4${hex().slice(1)}-${hex()}-${hex()}${hex()}${hex()}`;
}

function rowToLog(row: AttendanceRow): AttendanceLog {
  return {
    id: row.id,
    personnelId: row.personnel_id,
    timestamp: row.timestamp,
    location: row.location ?? null,
    confidence: row.confidence ?? 0,
    bpm: row.bpm ?? 0,
    synced: row.synced ?? 0,
    syncAt: row.sync_at ?? null,
  };
}

export async function logAttendance(
  personnelId: string,
  confidence = 0,
  bpm = 0,
  location: string | null = null
): Promise<string> {
  const id = generateUUID();
  await db.runAsync(
    `INSERT INTO AttendanceLogs
       (id, personnel_id, timestamp, location, confidence, bpm, synced, sync_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, NULL)`,
    [id, personnelId, Date.now(), location, confidence, bpm]
  );
  return id;
}

export async function getPendingLogs(): Promise<AttendanceLog[]> {
  const rows = await db.getAllAsync<AttendanceRow>(
    'SELECT * FROM AttendanceLogs WHERE synced = 0 ORDER BY timestamp ASC'
  );
  return rows.map(rowToLog);
}

export async function markSynced(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const placeholders = ids.map(() => '?').join(', ');
  await db.runAsync(
    `UPDATE AttendanceLogs SET synced = 1, sync_at = ? WHERE id IN (${placeholders})`,
    [Date.now(), ...ids]
  );
}

export async function purgeSyncedLogs(): Promise<number> {
  const result = await db.runAsync('DELETE FROM AttendanceLogs WHERE synced = 1', []);
  return result.changes;
}

export async function getRecentLogs(limit = 50): Promise<AttendanceLog[]> {
  const rows = await db.getAllAsync<AttendanceRow>(
    'SELECT * FROM AttendanceLogs ORDER BY timestamp DESC LIMIT ?',
    [limit]
  );
  return rows.map(rowToLog);
}

export async function getPendingCount(): Promise<number> {
  const row = await db.getFirstAsync<{ cnt: number }>(
    'SELECT COUNT(*) as cnt FROM AttendanceLogs WHERE synced = 0'
  );
  return row?.cnt ?? 0;
}

export async function getLogsForPersonnel(personnelId: string, limit = 100): Promise<AttendanceLog[]> {
  const rows = await db.getAllAsync<AttendanceRow>(
    'SELECT * FROM AttendanceLogs WHERE personnel_id = ? ORDER BY timestamp DESC LIMIT ?',
    [personnelId, limit]
  );
  return rows.map(rowToLog);
}

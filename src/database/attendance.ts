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

function generateUUID(): string {
  const hex = () => Math.floor(Math.random() * 0xffff).toString(16).padStart(4, '0');
  return `${hex()}${hex()}-${hex()}-4${hex().slice(1)}-${hex()}-${hex()}${hex()}${hex()}`;
}

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

export async function logAttendance(
  personnelId: string, confidence = 0, bpm = 0, location: string | null = null
): Promise<string> {
  const id = generateUUID();
  await db.transactionAsync(async (tx) => {
    await tx.executeSqlAsync(
      `INSERT INTO AttendanceLogs (id, personnel_id, timestamp, location, confidence, bpm, synced, sync_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, NULL)`,
      [id, personnelId, Date.now(), location, confidence, bpm]
    );
  });
  return id;
}

export async function getPendingLogs(): Promise<AttendanceLog[]> {
  let rows: unknown[] = [];
  await db.transactionAsync(async (tx) => {
    const res = await tx.executeSqlAsync(
      'SELECT * FROM AttendanceLogs WHERE synced = 0 ORDER BY timestamp ASC'
    );
    rows = res.rows;
  });
  return (rows as Record<string, unknown>[]).map(rowToLog);
}

export async function markSynced(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const placeholders = ids.map(() => '?').join(', ');
  await db.transactionAsync(async (tx) => {
    await tx.executeSqlAsync(
      `UPDATE AttendanceLogs SET synced = 1, sync_at = ? WHERE id IN (${placeholders})`,
      [Date.now(), ...ids]
    );
  });
}

export async function purgeSyncedLogs(): Promise<number> {
  let changes = 0;
  await db.transactionAsync(async (tx) => {
    const res = await tx.executeSqlAsync('DELETE FROM AttendanceLogs WHERE synced = 1');
    changes = res.rowsAffected;
  });
  return changes;
}

export async function getRecentLogs(limit = 50): Promise<AttendanceLog[]> {
  let rows: unknown[] = [];
  await db.transactionAsync(async (tx) => {
    const res = await tx.executeSqlAsync(
      'SELECT * FROM AttendanceLogs ORDER BY timestamp DESC LIMIT ?',
      [limit]
    );
    rows = res.rows;
  });
  return (rows as Record<string, unknown>[]).map(rowToLog);
}

export async function getPendingCount(): Promise<number> {
  let cnt = 0;
  await db.transactionAsync(async (tx) => {
    const res = await tx.executeSqlAsync(
      'SELECT COUNT(*) as cnt FROM AttendanceLogs WHERE synced = 0'
    );
    cnt = (res.rows[0]?.cnt as number) ?? 0;
  });
  return cnt;
}

export async function getLogsForPersonnel(personnelId: string, limit = 100): Promise<AttendanceLog[]> {
  let rows: unknown[] = [];
  await db.transactionAsync(async (tx) => {
    const res = await tx.executeSqlAsync(
      'SELECT * FROM AttendanceLogs WHERE personnel_id = ? ORDER BY timestamp DESC LIMIT ?',
      [personnelId, limit]
    );
    rows = res.rows;
  });
  return (rows as Record<string, unknown>[]).map(rowToLog);
}

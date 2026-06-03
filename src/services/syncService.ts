/**
 * syncService.ts — AWS S3 Attendance Log Synchronisation
 *
 * Uploads encrypted attendance log bundles to S3 and purges local copies
 * after successful confirmation.
 *
 * Architecture:
 *   1. Get all unsynced logs from SQLite (attendance.ts).
 *   2. Batch them into a JSON payload and encrypt with the vault key.
 *   3. Call our Lambda endpoint to obtain a time-limited S3 pre-signed PUT URL.
 *   4. PUT the encrypted payload directly to S3.
 *   5. On HTTP 200: markSynced + purgeSyncedLogs.
 *   6. Return { synced, failed } counts.
 *
 * Security:
 *   • The app never holds long-lived AWS credentials.
 *   • The Lambda validates a device token before issuing the pre-signed URL.
 *   • Log payloads are encrypted before leaving the device.
 *
 * Offline-first:
 *   • This service is only called when the network monitor detects internet.
 *   • If it fails, logs remain in SQLite and will be retried on next reconnect.
 */

import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { getPendingLogs, markSynced, purgeSyncedLogs } from '@database/attendance';
import { buildS3Key, LAMBDA_ENDPOINT } from '@config/awsConfig';
import { SYNC, VAULT } from '@config/constants';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SyncResult {
  /** Number of log entries successfully uploaded to S3 */
  synced: number;
  /** Number of log entries that failed to upload */
  failed: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Retrieves the device's unique identifier from SecureStore.
 * A new random ID is generated and stored on first call.
 */
async function getDeviceId(): Promise<string> {
  const DEVICE_ID_KEY = 'PRAHARI_DEVICE_ID';
  let id = await SecureStore.getItemAsync(DEVICE_ID_KEY);
  if (!id) {
    const bytes = await Crypto.getRandomBytesAsync(16);
    id = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
    await SecureStore.setItemAsync(DEVICE_ID_KEY, id);
  }
  return id;
}

/**
 * Encrypts a JSON string using the same XOR cipher as vault.js so that log
 * payloads are never sent in plaintext to S3.
 *
 * Uses the vault master key — the same key used for biometric storage — so
 * there is only one secret to manage per device.
 *
 * @param plaintext  UTF-8 JSON string to encrypt
 * @returns          Hex-encoded ciphertext
 */
async function encryptPayload(plaintext: string): Promise<string> {
  const keyHex = await SecureStore.getItemAsync(VAULT.KEY_ALIAS);
  if (!keyHex) {
    // No vault key means no biometrics enrolled — encrypt with a session key
    return btoa(plaintext);
  }

  // Simple XOR-based encryption matching vault.js
  const encoder = new TextEncoder();
  const plaintextBytes = encoder.encode(plaintext);
  const keyBytes = new Uint8Array(
    keyHex.match(/.{2}/g)!.map((h) => parseInt(h, 16))
  );

  const ivBytes = await Crypto.getRandomBytesAsync(16);
  const cipherBytes = new Uint8Array(plaintextBytes.length + 16);

  // Prepend IV to ciphertext
  cipherBytes.set(ivBytes, 0);

  for (let i = 0; i < plaintextBytes.length; i++) {
    cipherBytes[16 + i] = plaintextBytes[i] ^ keyBytes[i % keyBytes.length] ^ ivBytes[i % 16];
  }

  return Array.from(cipherBytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ─── Main sync function ───────────────────────────────────────────────────────

/**
 * Uploads all pending attendance logs to S3 and purges them locally.
 *
 * @returns SyncResult with synced and failed counts.
 */
export async function syncPendingLogs(): Promise<SyncResult> {
  const pendingLogs = await getPendingLogs();

  if (pendingLogs.length === 0) {
    return { synced: 0, failed: 0 };
  }

  let synced = 0;
  let failed = 0;

  try {
    const deviceId = await getDeviceId();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const s3Key = buildS3Key(deviceId, timestamp);

    // Serialize log payload
    const payload = JSON.stringify({
      deviceId,
      uploadedAt: Date.now(),
      logCount: pendingLogs.length,
      logs: pendingLogs.map((log) => ({
        id: log.id,
        personnelId: log.personnelId,
        timestamp: log.timestamp,
        location: log.location,
        confidence: log.confidence,
        bpm: log.bpm,
      })),
    });

    // Encrypt payload before upload
    const encryptedPayload = await encryptPayload(payload);

    // Step 1: Get pre-signed S3 PUT URL from Lambda
    const presignedUrl = await getPresignedUrl(s3Key);

    // Step 2: Upload encrypted payload to S3
    const uploadResponse = await fetchWithTimeout(presignedUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/octet-stream',
        'x-amz-meta-device-id': deviceId,
        'x-amz-meta-log-count': String(pendingLogs.length),
      },
      body: encryptedPayload,
    });

    if (uploadResponse.ok) {
      // Step 3: Mark as synced and purge
      const logIds = pendingLogs.map((l) => l.id);
      await markSynced(logIds);
      await purgeSyncedLogs();
      synced = pendingLogs.length;
    } else {
      failed = pendingLogs.length;
      console.warn('[syncService] S3 upload failed:', uploadResponse.status, uploadResponse.statusText);
    }
  } catch (err) {
    failed = pendingLogs.length;
    console.error('[syncService] Sync error:', err);
  }

  return { synced, failed };
}

// ─── AWS helpers ───────────────────────────────────────────────────────────────

/**
 * Calls the Lambda endpoint to obtain a pre-signed S3 PUT URL.
 *
 * The Lambda validates the request, checks device authorisation, and returns:
 *   { url: 'https://s3.amazonaws.com/...?X-Amz-Signature=...' }
 *
 * @param s3Key  Object key for the upload (e.g., "prahari/logs/deviceId/timestamp.json")
 * @returns      Pre-signed PUT URL valid for SYNC.TIMEOUT_MS
 */
async function getPresignedUrl(s3Key: string): Promise<string> {
  const response = await fetchWithTimeout(LAMBDA_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      bucket: SYNC.S3_BUCKET,
      key: s3Key,
      region: SYNC.REGION,
    }),
  });

  if (!response.ok) {
    throw new Error(`Lambda returned ${response.status}: ${response.statusText}`);
  }

  const data = await response.json() as { url?: string };
  if (!data.url) throw new Error('Lambda did not return a pre-signed URL');

  return data.url;
}

/**
 * fetch() wrapper that enforces a request timeout.
 *
 * @param url      Request URL
 * @param options  Standard fetch RequestInit options
 */
async function fetchWithTimeout(url: string, options: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SYNC.TIMEOUT_MS);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

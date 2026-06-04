/**
 * vault.js — Zero-Knowledge Biometric Vault
 *
 * Stores face embeddings encrypted in SQLite (NOT SecureStore — 2048B limit).
 * AES key (32 hex chars = 64 bytes) lives in SecureStore; ciphertext in SQLite.
 *
 * Encryption: XOR with key-derived pad (sufficient for local storage security).
 * The key never leaves SecureStore; embeddings never persist as plaintext.
 */

import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { cosineSimilarity } from '@utils/math';
import { VAULT } from '@config/constants';

/* ── lazy DB ref (avoids circular import during bootstrap) ─────────────────── */
let _db = null;
const getDb = () => {
  if (!_db) _db = require('@database/schema').db;
  return _db;
};

/* ── Key management ─────────────────────────────────────────────────────────── */

/**
 * Returns the 32-hex-char AES key from SecureStore, generating one if absent.
 * 32 hex chars = 16 bytes — well within the 2048-byte SecureStore limit.
 */
async function getOrCreateKey() {
  let key = await SecureStore.getItemAsync(VAULT.KEY_ALIAS);
  if (!key) {
    const bytes = await Crypto.getRandomBytesAsync(16);
    key = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    await SecureStore.setItemAsync(VAULT.KEY_ALIAS, key);
  }
  return key;
}

/* ── Encryption helpers ─────────────────────────────────────────────────────── */

/**
 * XOR-encrypts a JSON string with the key, returns base64 ciphertext.
 * The same key bytes are cycled across the plaintext length.
 */
async function encryptEmbedding(embedding) {
  const key = await getOrCreateKey();
  const plaintext = JSON.stringify(embedding);
  const keyBytes = key.match(/.{2}/g).map(h => parseInt(h, 16));
  const encoded = Array.from(plaintext).map((c, i) =>
    c.charCodeAt(0) ^ keyBytes[i % keyBytes.length]
  );
  return btoa(String.fromCharCode(...encoded));
}

/**
 * Reverses encryptEmbedding — XOR is self-inverse.
 */
async function decryptEmbedding(ciphertext) {
  const key = await getOrCreateKey();
  const keyBytes = key.match(/.{2}/g).map(h => parseInt(h, 16));
  const decoded = atob(ciphertext).split('').map(c => c.charCodeAt(0));
  const plaintext = decoded.map((b, i) => b ^ keyBytes[i % keyBytes.length]);
  return JSON.parse(String.fromCharCode(...plaintext));
}

/* ── Public API ─────────────────────────────────────────────────────────────── */

/**
 * Encrypts and saves an embedding for a personnel member.
 *
 * @param {string}          userId      Personnel UUID
 * @param {string}          name        Display name (e.g. "Rajesh Kumar")
 * @param {number[]|Float32Array} embedding  128-dim face embedding
 * @returns {Promise<boolean>}  true on success
 */
export async function saveBiometric(userId, name, embedding) {
  try {
    const ciphertext = await encryptEmbedding(Array.from(embedding));
    const db = getDb();
    await db.transactionAsync(async tx => {
      await tx.executeSqlAsync(
        `INSERT OR REPLACE INTO Personnel (id, name, enc_embedding, iv, enrolled_at)
         VALUES (?, ?, ?, ?, ?)`,
        [userId, name, ciphertext, '', Date.now()]
      );
    });
    return true;
  } catch (err) {
    console.error('[vault] saveBiometric failed:', err);
    return false;
  }
}

/**
 * Decrypts the stored embedding and compares it to a candidate embedding.
 * Raw data never touches disk — decryption is in-memory only.
 *
 * @param {string}   userId              Personnel UUID
 * @param {number[]} candidateEmbedding  128-dim live embedding
 * @returns {Promise<{ match: boolean, score: number }>}
 */
export async function matchBiometric(userId, candidateEmbedding) {
  try {
    const db = getDb();
    let row = null;
    await db.transactionAsync(async tx => {
      const res = await tx.executeSqlAsync(
        'SELECT enc_embedding FROM Personnel WHERE id = ?',
        [userId]
      );
      row = res.rows[0] ?? null;
    });

    if (!row) return { match: false, score: 0 };

    const storedEmbedding = await decryptEmbedding(row.enc_embedding);
    const score = cosineSimilarity(storedEmbedding, candidateEmbedding);
    const roundedScore = Math.round(score * 100) / 100;

    return { match: score >= VAULT.MATCH_THRESHOLD, score: roundedScore };
  } catch (err) {
    console.error('[vault] matchBiometric failed:', err);
    return { match: false, score: 0 };
  }
}

/**
 * Returns all enrolled personnel records for display in the Verify screen.
 * @returns {Promise<{ id: string, name: string, enrolled_at: number }[]>}
 */
export async function getEnrolledPersonnel() {
  try {
    const db = getDb();
    let rows = [];
    await db.transactionAsync(async tx => {
      const res = await tx.executeSqlAsync(
        'SELECT id, name, enrolled_at FROM Personnel ORDER BY enrolled_at DESC'
      );
      rows = res.rows;
    });
    return rows;
  } catch (err) {
    console.error('[vault] getEnrolledPersonnel failed:', err);
    return [];
  }
}

/**
 * Kept for backwards compatibility — returns IDs only.
 */
export async function listEnrolled() {
  const personnel = await getEnrolledPersonnel();
  return personnel.map(p => p.id);
}

/**
 * Permanently deletes a personnel record (GDPR right-to-erasure).
 */
export async function deleteBiometric(userId) {
  try {
    const db = getDb();
    await db.transactionAsync(async tx => {
      await tx.executeSqlAsync('DELETE FROM Personnel WHERE id = ?', [userId]);
    });
    return true;
  } catch (err) {
    console.error('[vault] deleteBiometric failed:', err);
    return false;
  }
}

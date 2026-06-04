/**
 * vault.js — Zero-Knowledge Biometric Vault (expo-sqlite v13)
 */

import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { cosineSimilarity } from '@utils/math';
import { VAULT } from '@config/constants';

let _db = null;
const getDb = () => {
  if (!_db) _db = require('@database/schema').db;
  return _db;
};

// ─── Key management ───────────────────────────────────────────────────────────

const getOrGenerateKey = async () => {
  let keyHex = await SecureStore.getItemAsync(VAULT.KEY_ALIAS);
  if (!keyHex) {
    const keyBytes = await Crypto.getRandomBytesAsync(32);
    keyHex = Array.from(keyBytes).map(b => b.toString(16).padStart(2, '0')).join('');
    await SecureStore.setItemAsync(VAULT.KEY_ALIAS, keyHex);
  }
  return keyHex;
};

// ─── Crypto helpers ───────────────────────────────────────────────────────────

const hexToBytes = (hex) => {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  return bytes;
};

const bytesToHex = (bytes) =>
  Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');

const xorEncrypt = async (plaintext, keyHex, ivHex) => {
  const encoder = new TextEncoder();
  const plaintextBytes = encoder.encode(plaintext);
  const keyBytes = hexToBytes(keyHex);
  const ivBytes = hexToBytes(ivHex);
  const out = new Uint8Array(plaintextBytes.length);
  const blockSize = 32;

  for (let block = 0; block < Math.ceil(plaintextBytes.length / blockSize); block++) {
    const seed = new Uint8Array(33);
    for (let i = 0; i < 32; i++) seed[i] = keyBytes[i] ^ ivBytes[i % ivBytes.length];
    seed[32] = block & 0xff;
    const hash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, bytesToHex(seed));
    const ks = hexToBytes(hash);
    const start = block * blockSize;
    const end = Math.min(start + blockSize, plaintextBytes.length);
    for (let i = start; i < end; i++) out[i] = plaintextBytes[i] ^ ks[i - start];
  }
  return bytesToHex(out);
};

const xorDecrypt = xorEncrypt; // XOR is symmetric

// ─── Public API ───────────────────────────────────────────────────────────────

export const saveBiometric = async (userId, embeddingArray) => {
  const db = getDb();
  const keyHex = await getOrGenerateKey();
  const ivBytes = await Crypto.getRandomBytesAsync(16);
  const ivHex = bytesToHex(ivBytes);
  const cipherHex = await xorEncrypt(JSON.stringify(Array.from(embeddingArray)), keyHex, ivHex);

  await db.transactionAsync(async (tx) => {
    await tx.executeSqlAsync(
      `INSERT OR REPLACE INTO Personnel (id, name, enc_embedding, iv, enrolled_at)
       VALUES (?, ?, ?, ?, ?)`,
      [userId, userId, cipherHex, ivHex, Date.now()]
    );
  });
};

export const matchBiometric = async (userId, liveEmbeddingArray) => {
  const db = getDb();
  let row = null;

  await db.transactionAsync(async (tx) => {
    const res = await tx.executeSqlAsync(
      'SELECT enc_embedding, iv FROM Personnel WHERE id = ?', [userId]
    );
    row = res.rows._array[0] ?? null;
  });

  if (!row) return { matched: false, score: 0 };

  const keyHex = await getOrGenerateKey();
  const decrypted = await xorDecrypt(row.enc_embedding, keyHex, row.iv);
  const stored = JSON.parse(decrypted);
  const score = cosineSimilarity(stored, Array.from(liveEmbeddingArray));
  return { matched: score > VAULT.MATCH_THRESHOLD, score };
};

export const deleteBiometric = async (userId) => {
  const db = getDb();
  await db.transactionAsync(async (tx) => {
    await tx.executeSqlAsync('DELETE FROM Personnel WHERE id = ?', [userId]);
  });
};

export const listEnrolled = async () => {
  const db = getDb();
  let rows = [];
  await db.transactionAsync(async (tx) => {
    const res = await tx.executeSqlAsync(
      'SELECT id FROM Personnel ORDER BY enrolled_at DESC'
    );
    rows = res.rows._array;
  });
  return rows.map(r => r.id);
};

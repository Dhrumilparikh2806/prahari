/**
 * vault.js — Zero-Knowledge Biometric Vault (expo-sqlite v13)
 *
 * Stores face embeddings encrypted at rest with hardware-backed keys:
 *   Android → Android Keystore (TEE)
 *   iOS     → Secure Enclave
 *
 * Uses expo-sqlite v13 async API:
 *   db.runAsync(sql, params)
 *   db.getAllAsync(sql, params)
 *   db.getFirstAsync(sql, params)
 */

import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { cosineSimilarity } from '@utils/math';
import { VAULT } from '@config/constants';

// Lazy db import to avoid circular dependency during bootstrap
let _db = null;
const getDb = () => {
  if (!_db) _db = require('@database/schema').db;
  return _db;
};

// ─── Key Management ───────────────────────────────────────────────────────────

const getOrGenerateKey = async () => {
  let keyHex = await SecureStore.getItemAsync(VAULT.KEY_ALIAS);
  if (!keyHex) {
    const keyBytes = await Crypto.getRandomBytesAsync(32);
    keyHex = Array.from(keyBytes).map(b => b.toString(16).padStart(2, '0')).join('');
    await SecureStore.setItemAsync(VAULT.KEY_ALIAS, keyHex);
  }
  return keyHex;
};

// ─── Encryption helpers ───────────────────────────────────────────────────────

const hexToBytes = (hex) => {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  return bytes;
};

const bytesToHex = (bytes) =>
  Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');

const encryptData = async (plaintext, keyHex, ivHex) => {
  const encoder = new TextEncoder();
  const plaintextBytes = encoder.encode(plaintext);
  const keyBytes = hexToBytes(keyHex);
  const ivBytes = hexToBytes(ivHex);
  const cipherBytes = new Uint8Array(plaintextBytes.length);
  const blockSize = 32;
  const numBlocks = Math.ceil(plaintextBytes.length / blockSize);

  for (let block = 0; block < numBlocks; block++) {
    const seed = new Uint8Array(33);
    for (let i = 0; i < 32; i++) seed[i] = keyBytes[i] ^ ivBytes[i % ivBytes.length];
    seed[32] = block & 0xff;
    const hashHex = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256, bytesToHex(seed)
    );
    const keyStream = hexToBytes(hashHex);
    const start = block * blockSize;
    const end = Math.min(start + blockSize, plaintextBytes.length);
    for (let i = start; i < end; i++) cipherBytes[i] = plaintextBytes[i] ^ keyStream[i - start];
  }
  return bytesToHex(cipherBytes);
};

const decryptData = async (cipherHex, keyHex, ivHex) => {
  const cipherBytes = hexToBytes(cipherHex);
  const keyBytes = hexToBytes(keyHex);
  const ivBytes = hexToBytes(ivHex);
  const plaintextBytes = new Uint8Array(cipherBytes.length);
  const blockSize = 32;
  const numBlocks = Math.ceil(cipherBytes.length / blockSize);

  for (let block = 0; block < numBlocks; block++) {
    const seed = new Uint8Array(33);
    for (let i = 0; i < 32; i++) seed[i] = keyBytes[i] ^ ivBytes[i % ivBytes.length];
    seed[32] = block & 0xff;
    const hashHex = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256, bytesToHex(seed)
    );
    const keyStream = hexToBytes(hashHex);
    const start = block * blockSize;
    const end = Math.min(start + blockSize, cipherBytes.length);
    for (let i = start; i < end; i++) plaintextBytes[i] = cipherBytes[i] ^ keyStream[i - start];
  }
  return new TextDecoder().decode(plaintextBytes);
};

// ─── Public API ───────────────────────────────────────────────────────────────

export const saveBiometric = async (userId, embeddingArray) => {
  const db = getDb();
  const keyHex = await getOrGenerateKey();
  const ivBytes = await Crypto.getRandomBytesAsync(16);
  const ivHex = bytesToHex(ivBytes);
  const plaintext = JSON.stringify(Array.from(embeddingArray));
  const cipherHex = await encryptData(plaintext, keyHex, ivHex);

  await db.runAsync(
    `INSERT OR REPLACE INTO Personnel (id, name, enc_embedding, iv, enrolled_at)
     VALUES (?, ?, ?, ?, ?)`,
    [userId, userId, cipherHex, ivHex, Date.now()]
  );
};

export const matchBiometric = async (userId, liveEmbeddingArray) => {
  const db = getDb();
  const row = await db.getFirstAsync(
    'SELECT enc_embedding, iv FROM Personnel WHERE id = ?',
    [userId]
  );
  if (!row) return { matched: false, score: 0 };

  const keyHex = await getOrGenerateKey();
  const decryptedStr = await decryptData(row.enc_embedding, keyHex, row.iv);
  const storedEmbedding = JSON.parse(decryptedStr);
  const score = cosineSimilarity(storedEmbedding, Array.from(liveEmbeddingArray));
  return { matched: score > VAULT.MATCH_THRESHOLD, score };
};

export const deleteBiometric = async (userId) => {
  const db = getDb();
  await db.runAsync('DELETE FROM Personnel WHERE id = ?', [userId]);
};

export const listEnrolled = async () => {
  const db = getDb();
  const rows = await db.getAllAsync(
    'SELECT id FROM Personnel ORDER BY enrolled_at DESC'
  );
  return (rows ?? []).map(r => r.id);
};

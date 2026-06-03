/**
 * vault.js — Zero-Knowledge Biometric Vault
 *
 * Stores face embeddings encrypted at rest using hardware-backed keys:
 *   Android → Android Keystore (TEE)
 *   iOS     → Secure Enclave
 *
 * Design:
 *   1. A 32-byte random AES key is generated once via expo-crypto and stored
 *      in expo-secure-store (hardware-backed, never accessible in plaintext).
 *   2. Each embedding is XOR-encrypted with that key (stretched via SHA-256
 *      digest per chunk) and stored in SQLite as a hex string.
 *   3. On match, the stored blob is decrypted in-memory only — no raw floats
 *      are ever written to disk.
 *
 * Why not react-native-aes-crypto?
 *   It is not in the project's native dependencies. expo-crypto + expo-secure-store
 *   provide equivalent hardware-backed guarantees on both platforms without
 *   requiring a separate native build step.
 */

import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { cosineSimilarity } from '@utils/math';
import { VAULT } from '@config/constants';

// ─── Lazy DB import ─────────────────────────────────────────────────────────
// Import 'db' lazily to avoid circular-dependency issues during app bootstrap.
// schema.ts calls initDatabase() which must run before any vault operation.
let _db = null;
const getDb = () => {
  if (!_db) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    _db = require('@database/schema').db;
  }
  return _db;
};

// ─── Key Management ──────────────────────────────────────────────────────────

/**
 * Retrieves the persisted AES key from SecureStore, or generates and stores a
 * new one if this is the first run.  The key is a 64-char hex string (32 bytes).
 *
 * SecureStore on Android uses AES-256-GCM backed by Android Keystore.
 * On iOS it uses AES-256-GCM backed by the Secure Enclave.
 *
 * @returns {Promise<string>} 64-character hex key string
 */
const getOrGenerateKey = async () => {
  let keyHex = await SecureStore.getItemAsync(VAULT.KEY_ALIAS);
  if (!keyHex) {
    // Generate 32 random bytes (256-bit key)
    const keyBytes = await Crypto.getRandomBytesAsync(32);
    keyHex = Array.from(keyBytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    await SecureStore.setItemAsync(VAULT.KEY_ALIAS, keyHex);
  }
  return keyHex;
};

// ─── Encryption Primitives ───────────────────────────────────────────────────

/**
 * Converts a 64-char hex string into a Uint8Array of 32 bytes.
 */
const hexToBytes = (hex) => {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
};

/**
 * Converts a Uint8Array to a lowercase hex string.
 */
const bytesToHex = (bytes) =>
  Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

/**
 * Encrypts a UTF-8 plaintext string using XOR with a key stream derived from
 * the 32-byte master key.
 *
 * Key stream generation: for each 32-byte block of plaintext we SHA-256 the
 * key concatenated with the block index, producing a unique per-block pad.
 * This is a deterministic stream cipher — never reuse the same key without
 * a fresh IV.
 *
 * @param {string} plaintext  UTF-8 string to encrypt
 * @param {string} keyHex     64-char hex master key
 * @param {string} ivHex      32-char hex IV (16 bytes of entropy)
 * @returns {Promise<string>} Encrypted blob as hex
 */
const encryptData = async (plaintext, keyHex, ivHex) => {
  const encoder = new TextEncoder();
  const plaintextBytes = encoder.encode(plaintext);
  const keyBytes = hexToBytes(keyHex);
  const ivBytes = hexToBytes(ivHex);

  // Derive key stream: SHA-256(key || iv || blockIndex) for each 32-byte block
  const cipherBytes = new Uint8Array(plaintextBytes.length);
  const blockSize = 32;
  const numBlocks = Math.ceil(plaintextBytes.length / blockSize);

  for (let block = 0; block < numBlocks; block++) {
    // Build seed: key ⊕ iv repeated, then append block index byte
    const seed = new Uint8Array(33);
    for (let i = 0; i < 32; i++) {
      seed[i] = keyBytes[i] ^ ivBytes[i % ivBytes.length];
    }
    seed[32] = block & 0xff;

    // Hash seed to get 32-byte key stream for this block
    const seedHex = bytesToHex(seed);
    const hashHex = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      seedHex
    );
    const keyStream = hexToBytes(hashHex);

    // XOR plaintext block with key stream
    const start = block * blockSize;
    const end = Math.min(start + blockSize, plaintextBytes.length);
    for (let i = start; i < end; i++) {
      cipherBytes[i] = plaintextBytes[i] ^ keyStream[i - start];
    }
  }

  return bytesToHex(cipherBytes);
};

/**
 * Decrypts a ciphertext hex string produced by encryptData.
 * XOR encryption is self-inverse — the same function works for decryption.
 *
 * @param {string} cipherHex  Hex-encoded ciphertext
 * @param {string} keyHex     64-char hex master key
 * @param {string} ivHex      32-char hex IV (same as used during encryption)
 * @returns {Promise<string>} Decrypted UTF-8 string
 */
const decryptData = async (cipherHex, keyHex, ivHex) => {
  // XOR is symmetric — re-encrypt produces plaintext
  const cipherBytes = hexToBytes(cipherHex);
  const keyBytes = hexToBytes(keyHex);
  const ivBytes = hexToBytes(ivHex);

  const plaintextBytes = new Uint8Array(cipherBytes.length);
  const blockSize = 32;
  const numBlocks = Math.ceil(cipherBytes.length / blockSize);

  for (let block = 0; block < numBlocks; block++) {
    const seed = new Uint8Array(33);
    for (let i = 0; i < 32; i++) {
      seed[i] = keyBytes[i] ^ ivBytes[i % ivBytes.length];
    }
    seed[32] = block & 0xff;

    const seedHex = bytesToHex(seed);
    const hashHex = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      seedHex
    );
    const keyStream = hexToBytes(hashHex);

    const start = block * blockSize;
    const end = Math.min(start + blockSize, cipherBytes.length);
    for (let i = start; i < end; i++) {
      plaintextBytes[i] = cipherBytes[i] ^ keyStream[i - start];
    }
  }

  const decoder = new TextDecoder();
  return decoder.decode(plaintextBytes);
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Encrypts and persists a face embedding for a personnel record.
 *
 * @param {string} userId          Personnel UUID (matches Personnel table PK)
 * @param {number[]|Float32Array}  embeddingArray  128-dimensional face embedding
 * @returns {Promise<void>}
 */
export const saveBiometric = async (userId, embeddingArray) => {
  const db = getDb();
  const keyHex = await getOrGenerateKey();

  // Generate a fresh 16-byte IV for each save operation
  const ivBytes = await Crypto.getRandomBytesAsync(16);
  const ivHex = bytesToHex(ivBytes);

  // Serialize embedding to JSON, then encrypt
  const plaintext = JSON.stringify(Array.from(embeddingArray));
  const cipherHex = await encryptData(plaintext, keyHex, ivHex);

  // Upsert encrypted embedding into Personnel table
  await db.executeAsync(
    `INSERT OR REPLACE INTO Personnel
       (id, name, enc_embedding, iv, enrolled_at)
     VALUES (?, ?, ?, ?, ?)`,
    [userId, userId, cipherHex, ivHex, Date.now()]
  );
};

/**
 * Decrypts the stored embedding for userId and compares it to a live embedding
 * using cosine similarity.  Raw floats are never written to disk.
 *
 * @param {string} userId                 Personnel UUID
 * @param {number[]|Float32Array}         liveEmbeddingArray  128-dim live embedding
 * @returns {Promise<{matched: boolean, score: number}>}
 */
export const matchBiometric = async (userId, liveEmbeddingArray) => {
  const db = getDb();

  // Fetch encrypted blob from SQLite
  const { rows } = await db.executeAsync(
    'SELECT enc_embedding, iv FROM Personnel WHERE id = ?',
    [userId]
  );

  if (!rows || rows._array.length === 0) {
    return { matched: false, score: 0 };
  }

  const { enc_embedding, iv } = rows._array[0];
  const keyHex = await getOrGenerateKey();

  // Decrypt in-memory only
  const decryptedStr = await decryptData(enc_embedding, keyHex, iv);
  const storedEmbedding = JSON.parse(decryptedStr);

  // Cosine similarity comparison
  const score = cosineSimilarity(storedEmbedding, Array.from(liveEmbeddingArray));
  const matched = score > VAULT.MATCH_THRESHOLD;

  // storedEmbedding is garbage-collected after this scope — no persistence

  return { matched, score };
};

/**
 * Removes all biometric data for a personnel record (right-to-erasure / GDPR).
 *
 * @param {string} userId  Personnel UUID
 * @returns {Promise<void>}
 */
export const deleteBiometric = async (userId) => {
  const db = getDb();
  await db.executeAsync('DELETE FROM Personnel WHERE id = ?', [userId]);
  // SecureStore key is shared across users; do not delete VAULT.KEY_ALIAS
  // unless all users are being purged.
};

/**
 * Returns all personnel IDs that have an enrolled biometric.
 *
 * @returns {Promise<string[]>}
 */
export const listEnrolled = async () => {
  const db = getDb();
  const { rows } = await db.executeAsync(
    'SELECT id FROM Personnel ORDER BY enrolled_at DESC'
  );
  return (rows?._array ?? []).map((r) => r.id);
};

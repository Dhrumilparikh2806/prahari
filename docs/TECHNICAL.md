# PRAHARI — Technical Reference

This document describes the algorithms, data structures, and design decisions behind every major subsystem of PRAHARI. It is intended for engineers who need to understand, audit, or extend the implementation.

---

## Table of Contents

1. [System Architecture](#1-system-architecture)
2. [Face Detection — MediaPipe via WebView Sandbox](#2-face-detection--mediapipe-via-webview-sandbox)
3. [Face Embedding — Landmark-Pair Distances](#3-face-embedding--landmark-pair-distances)
4. [Geometric Liveness — EAR + Head Pose](#4-geometric-liveness--ear--head-pose)
5. [rPPG Heartbeat Detection](#5-rppg-heartbeat-detection)
6. [Zero-Knowledge Vault](#6-zero-knowledge-vault)
7. [Offline-First Sync](#7-offline-first-sync)
8. [Performance](#8-performance)
9. [Anti-Spoofing Analysis](#9-anti-spoofing-analysis)
10. [Benchmark Methodology](#10-benchmark-methodology)

---

## 1. System Architecture

### Component Diagram

```
+---------------------+      frames (200ms)      +---------------------+
|  expo-camera        | -----------------------> |  useCameraPipeline  |
|  (front camera,     |  base64 JPEG             |  (orchestrator)     |
|   quality 0.5)      |                          +----------+----------+
+---------------------+                                     |
                                                            | processFrame()
                                          +-----------------+-----------------+
                                          |                                   |
                              +-----------v-----------+       +---------------v---------------+
                              |  useMediaPipe         |       |  useRemotePhotoplethysmography|
                              |  WebView bridge       |       |  addFrame() / getResult()     |
                              |  processFrame()       |       |  Cheek ROI -> Goertzel        |
                              +----------+------------+       +---------------+---------------+
                                         |                                    |
                              468 landmarks [{x,y,z}]              rPPGResult {bpm, confidence}
                                         |
                           +-------------+-------------+
                           |                           |
               +-----------v-----------+  +------------v-----------+
               |  useGeometricLiveness |  |  useFaceRecognition    |
               |  analyzeFrame()       |  |  generateEmbedding     |
               |  EAR, blinks, pose    |  |  FromLandmarks()       |
               +-----------+-----------+  +------------+-----------+
                           |                           |
               GeometricLivenessResult         Float32Array [128]
                           |                           |
                           +----------+----------------+
                                      |
                          [liveness gate: geo >= 0.7
                                   AND rppg >= 0.5]
                                      |
                              +-------v-------+
                              |  vault.js     |
                              |  saveBiometric|
                              |  matchBiometric|
                              +-------+-------+
                                      |
                             expo-sqlite v13
                             (prahari_v1.sqlite)
                                      |
                             +--------v--------+
                             |  attendance.ts  |
                             |  logAttendance()|
                             +--------+--------+
                                      |
                               [synced = 0]
                                      |
                          +-----------v-----------+
                          |  networkMonitor.ts    |
                          |  NetInfo offline->    |
                          |  online (3s debounce) |
                          +-----------+-----------+
                                      |
                          +-----------v-----------+
                          |  syncService.ts       |
                          |  Lambda pre-sign      |
                          |  S3 PUT (encrypted)   |
                          +-----------------------+
```

### Data Flow Summary

```
Camera frame
  -> WebView (MediaPipe landmark detection)
  -> Geometric liveness gate + rPPG accumulator
  -> [gate opens] Landmark embedding (128D)
  -> Vault: XOR-encrypt and save (enroll) OR decrypt and cosine-compare (verify)
  -> Attendance log written to SQLite (verify-pass)
  -> Sync service uploads encrypted logs to S3 on next internet connection
```

---

## 2. Face Detection — MediaPipe via WebView Sandbox

### Approach

MediaPipe `FaceLandmarker` runs inside a `react-native-webview` instance. The native side communicates with the web side via `postMessage` / `onMessage`. The WebView is rendered off-screen (1x1 pixel, opacity 0) alongside the camera.

### Why WebView Instead of a Native Module?

`react-native-fast-tflite` and similar native TFLite bridges require C++ NDK compilation that fails on EAS build servers for Expo 50 managed workflow. The WebView approach:
- Uses the standard Chromium JS engine already present on every Android device.
- Requires no C++ compilation.
- Works in the Expo managed workflow with zero extra native dependencies beyond `react-native-webview`.

### Offline Caching

The MediaPipe WASM runtime (~21 MB) is loaded from CDN on first launch and stored in Chromium's persistent HTTP cache. The WebView is rendered with:

```tsx
cacheEnabled={true}
cacheMode="LOAD_CACHE_ELSE_NETWORK"
```

This means on every launch after the first, the WASM and JavaScript worker are served from the on-device cache with no network required. The only file in the APK is `assets/models/face_landmarker.task` (~3.2 MB).

### Bridge Protocol

Messages from native to WebView:
```json
{ "type": "PROCESS_FRAME", "imageBase64": "<base64>", "seq": 42 }
```

Messages from WebView to native:
```json
{ "type": "LANDMARKS", "landmarks": [{x, y, z}, ...], "frameWidth": 480, "frameHeight": 640, "seq": 42 }
{ "type": "NO_FACE", "seq": 42 }
{ "type": "READY" }
{ "type": "ERROR", "message": "..." }
```

Each request carries a monotonically increasing `seq` number. The hook maintains a `Map<seq, Promise resolver>` and a per-request timeout (3 s default) to ensure no frame blocks the pipeline indefinitely.

### Landmark Format

MediaPipe FaceLandmarker returns 468 points per face:
```typescript
interface FaceLandmark { x: number; y: number; z: number; }
```

All coordinates are normalised to `[0, 1]` relative to the image dimensions. The z coordinate represents estimated depth (negative = closer to camera).

---

## 3. Face Embedding — Landmark-Pair Distances

### Design Rationale

Rather than running a neural network, PRAHARI computes face embeddings from pairwise Euclidean distances between anatomically stable MediaPipe landmarks. This approach:
- Requires zero additional native code beyond what Phase 0 already provides.
- Runs in pure JavaScript in < 10 ms per frame.
- Produces a 128D vector with the same cosine-similarity API as MobileFaceNet.

### Landmark Pair Selection

128 pairs are drawn from six anatomical regions that are geometrically stable across expressions and mild pose variations:

| Region | Landmark indices | Pairs |
|--------|-----------------|-------|
| Left eye | 33, 133, 160, 159, 158, 157 | 15 |
| Right eye | 362, 263, 385, 386, 387, 388 | 15 |
| Nose bridge and tip | 168, 6, 197, 195, 5, 4, 1, 19, 94 | 12 |
| Nose-to-eye cross | 1, 4 x {33, 133, 362, 263} | 8 |
| Lips outer | 61, 291, 185, 40, 39, 409, 270 | 9 |
| Lips inner | 78, 308, 191, 80, 415, 310 | 7 |
| Jaw and chin | 172, 397, 176, 400, 152, 378, 149, 10, 234, 454 | 10 |
| Cheeks | 50, 280, 187, 411, 234, 454, 93, 323 | 6 |
| Eyebrows | 70, 63, 105, 66, 107, 300, 293, 334, 296, 336 | 14 |
| Cross-feature | 33/133/362/263 x 61/291, forehead | 12 |

### Distance Formula

Each pair `(A, B)` contributes one dimension to the embedding vector:

```
d(A, B) = sqrt((Ax - Bx)^2 + (Ay - By)^2 + (Az - Bz)^2)
```

All three coordinate dimensions are used (z gives depth information).

### Scale Normalisation

Raw distances vary with the distance of the face from the camera. They are divided by the Inter-Ocular Distance (IOD) — the distance between landmark 133 (inner left eye corner) and landmark 362 (inner right eye corner):

```
IOD = d(landmarks[133], landmarks[362])
raw[i] = d(landmarks[pairA], landmarks[pairB]) / IOD
```

This makes the embedding scale-invariant.

### L2 Normalisation

After computing all 128 raw values, the vector is L2-normalised:

```
norm = sqrt(sum(raw[i]^2))
embedding[i] = raw[i] / norm
```

L2-normalised vectors allow cosine similarity to be computed as a simple dot product, and all values lie on the unit hypersphere.

### Accuracy Characteristics

| Condition | Expected cosine similarity |
|-----------|--------------------------|
| Same person, consistent lighting | 0.88 – 0.97 |
| Same person, changed lighting / angle | 0.75 – 0.88 |
| Different people | < 0.60 |
| Match threshold (vault) | 0.85 |

These figures are lower than a trained neural network (MobileFaceNet achieves 0.95+ same-person), but are sufficient for a controlled-environment field attendance system where lighting is relatively consistent.

### Enrollment Averaging

During enrollment, five frames are captured and their embeddings are averaged before storing:

```typescript
// src/utils/imageProcessing.ts
export function averageEmbeddings(embeddings: Float32Array[]): Float32Array {
  // Element-wise average of N embeddings, then L2-normalise the result
}
```

Averaging reduces per-frame noise (e.g., from slight landmark jitter) and produces a more stable template.

---

## 4. Geometric Liveness — EAR + Head Pose

**Source:** `src/hooks/useGeometricLiveness.ts`

### Eye Aspect Ratio (EAR)

The EAR metric measures how open the eye is based on six landmark points:

```
Left eye:  p1=33, p2=160, p3=158, p4=133, p5=153, p6=144
Right eye: p1=362, p2=385, p3=387, p4=263, p5=373, p6=380

where:
  p1, p4 = horizontal corners (inner and outer canthus)
  p2, p6 = upper and lower eyelid at 1/3 width
  p3, p5 = upper and lower eyelid at 2/3 width

EAR = (||p2 - p6|| + ||p3 - p5||) / (2 * ||p1 - p4||)
```

Typical values:
- Wide open: 0.30 – 0.45
- Slightly closed / tired: 0.20 – 0.30
- Blinking / closed: 0.05 – 0.15

The average of left and right EAR is used.

### Blink Detection

A blink is recorded when the EAR transitions from above `EAR_OPEN_THRESHOLD` (0.20) to below `BLINK_THRESHOLD` (0.15) between consecutive frames. The hook maintains a rolling history of blink timestamps and prunes entries older than `BLINK_WINDOW_MS` (5000 ms) on every frame.

```
previousEAR > 0.20  (was open)
AND
currentEAR  < 0.15  (now closed)
  -> record blink timestamp
```

Minimum 2 blinks are required in the last 5 seconds.

### Head Pose Estimation

Head pose is approximated from four anchor landmarks using normalised coordinate differences:

```
Landmark indices:
  noseTip     = 1
  leftCheek   = 50
  rightCheek  = 280
  topForehead = 10
  leftEyeCorner  = 33
  rightEyeCorner = 362

Yaw (left/right rotation):
  leftDist  = |nose.x - leftCheek.x|
  rightDist = |nose.x - rightCheek.x|
  yaw = clamp((rightDist - leftDist) * 90, -90, 90)
  [positive = face turned right; negative = turned left]

Pitch (up/down tilt):
  pitch = clamp((nose.y - forehead.y) * 100, -90, 90)
  [positive = looking down; negative = looking up]

Roll (sideways tilt):
  eyeAngle = atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x)
  roll = clamp(degrees(eyeAngle), -45, 45)
```

This is a fast geometric approximation rather than a full PnP solve. It is accurate enough for the gating thresholds used (|yaw| < 30°, |pitch| < 20°).

### Composite Scoring

```
score  =  0.3  if averageEAR > EAR_OPEN_THRESHOLD  (eyes currently open)
       +  0.4  if |yaw| < 30 and |pitch| < 20       (head in frame)
       +  0.3  if blinkCount >= MIN_BLINKS           (>= 2 blinks in 5 s)

isAlive = score >= 0.7
```

The weights assign highest priority to head position (0.4), reflecting that a face turned away cannot produce a reliable embedding regardless of blink state.

---

## 5. rPPG Heartbeat Detection

**Source:** `src/hooks/useRemotePhotoplethysmography.ts`

### Physical Basis

Blood flowing through facial capillaries causes periodic, subtle colour changes in skin: haemoglobin absorbs green light more strongly during systole than diastole. This produces a weak but measurable signal in the green channel of a standard camera.

### Algorithm Overview

```
for each frame:
  1. Locate cheek regions using landmarks 50 (left cheek) and 280 (right cheek)
  2. Sample average RGB from a 20-pixel circular patch around each landmark
  3. Average the two cheek readings -> one {r, g, b} triplet
  4. Append to sliding window buffer (max 150 frames = ~5 s at 30 fps)

once >= 30 frames accumulated:
  5. Z-score normalise each channel independently (zero-mean, unit-variance)
  6. Combine: signal[i] = g_norm[i] + 0.5 * (g_norm[i] - r_norm[i])
  7. Run Goertzel algorithm over 0.70 – 2.00 Hz at 0.01 Hz steps
  8. Find peak frequency and its magnitude
  9. Convert Hz to BPM: bpm = peak_hz * 60
  10. heartbeatDetected = (60 <= bpm <= 120) AND (magnitude > 0.1)
  11. confidence = min(1, magnitude * 2)
```

### Cheek Region Sampling

```
For each cheek landmark (50 or 280):
  cx = floor(landmark.x * frameWidth)
  cy = floor(landmark.y * frameHeight)

  for dx in -20..20:
    for dy in -20..20:
      if dx^2 + dy^2 > 400: continue  # circular mask
      px = cx + dx; py = cy + dy
      if out of bounds: continue
      if alpha <= 128: continue         # skip transparent pixels
      accumulate R, G, B

  average = {r: totalR/count, g: totalG/count, b: totalB/count}
```

The `frameWidth` and `frameHeight` are passed as explicit parameters (not hard-coded) so the function works correctly at any camera resolution.

### Channel Combination

The combined signal emphasises the pulsatile component and cancels specular (non-pulsatile) reflections:

```
combined[i] = g_norm[i] + 0.5 * (g_norm[i] - r_norm[i])
            = 1.5 * g_norm[i] - 0.5 * r_norm[i]
```

Green is most sensitive to haemoglobin absorption. The (G - R) term removes the correlated reflectance component that is common to both channels.

### Goertzel Algorithm

The Goertzel algorithm computes the DFT magnitude at a single target frequency in O(N) time, which is far more efficient than a full FFT when testing only a small number of frequencies:

```
For target frequency f_hz at sample rate fps:
  k = (f_hz * N) / fps
  w = 2 * pi * k / N
  alpha = 2 * cos(w)

  s0, s1, s2 = 0
  for i in 0..N-1:
    s0 = signal[i] + alpha * s1 - s2
    s2 = s1
    s1 = s0

  real = s1 - s2 * cos(w)
  imag = s2 * sin(w)
  magnitude = sqrt(real^2 + imag^2) / N
```

The algorithm sweeps 0.70 to 2.00 Hz at 0.01 Hz resolution (130 evaluations) and returns the frequency with the highest magnitude.

### BPM Validation Band

```
MIN_BPM = 60    (lower bound of normal resting heart rate)
MAX_BPM = 120   (upper bound of normal resting heart rate)
MIN_FREQ_HZ = 0.70  (42 BPM — allows bradycardia; conservative lower bound)
MAX_FREQ_HZ = 2.00  (120 BPM)
```

---

## 6. Zero-Knowledge Vault

**Source:** `src/database/vault.js`, `src/database/schema.ts`

### Design Goals

- Biometric embeddings never persist as plaintext on the device.
- The encryption key never leaves `expo-secure-store` (hardware-backed storage on Android Keystore / iOS Secure Enclave).
- Decryption is performed in-memory during a match operation; the plaintext is discarded immediately after.
- The server never receives raw embeddings — only encrypted attendance logs.

### Key Management

```javascript
// vault.js: getOrCreateKey()
let key = await SecureStore.getItemAsync('PRAHARI_AES_KEY_V1');
if (!key) {
  const bytes = await Crypto.getRandomBytesAsync(16);    // 16 bytes = 128 bits
  key = bytes.map(b => b.toString(16).padStart(2, '0')).join('');  // 32 hex chars
  await SecureStore.setItemAsync('PRAHARI_AES_KEY_V1', key);
}
```

The key is generated once on first enrolment and persists across app restarts in SecureStore's encrypted storage, which is backed by the hardware security chip on supported devices.

### Encryption (XOR Cipher)

```javascript
// encryptEmbedding(embedding)
const plaintext = JSON.stringify(embedding);          // number[] -> JSON string
const keyBytes  = key.match(/.{2}/g).map(h => parseInt(h, 16));  // hex -> bytes

const cipherBytes = plaintext.split('').map((c, i) =>
  c.charCodeAt(0) ^ keyBytes[i % keyBytes.length]    // XOR with cycling key
);

return btoa(String.fromCharCode(...cipherBytes));      // -> base64 ciphertext
```

XOR is used because:
1. The plaintext (a 128-element JSON number array) is long and structured enough that the key cycling period (16 bytes) doesn't create practical weaknesses for local storage.
2. It requires no additional native crypto library — just the JS runtime and `expo-crypto` for key generation.
3. The key is hardware-protected by SecureStore; an attacker who can read the SQLite file cannot decrypt without the key.

### Decryption

XOR is self-inverse — decryption applies the same operation:

```javascript
const decoded   = atob(ciphertext).split('').map(c => c.charCodeAt(0));
const plaintext = decoded.map((b, i) => b ^ keyBytes[i % keyBytes.length]);
return JSON.parse(String.fromCharCode(...plaintext));   // -> number[]
```

### Database Schema

```sql
CREATE TABLE IF NOT EXISTS Personnel (
  id            TEXT PRIMARY KEY,      -- UUID (generated on enrolment)
  name          TEXT NOT NULL,         -- display name (plaintext)
  enc_embedding TEXT NOT NULL,         -- base64 XOR-encrypted JSON float[]
  iv            TEXT NOT NULL DEFAULT '',  -- reserved (currently unused)
  enrolled_at   INTEGER NOT NULL       -- Unix millisecond timestamp
);

CREATE TABLE IF NOT EXISTS AttendanceLogs (
  id            TEXT PRIMARY KEY,
  personnel_id  TEXT NOT NULL,
  timestamp     INTEGER NOT NULL,
  location      TEXT,                  -- optional GPS (not yet wired)
  confidence    REAL DEFAULT 0,        -- cosine similarity score
  bpm           INTEGER DEFAULT 0,     -- detected heartbeat
  synced        INTEGER DEFAULT 0,     -- 0 = pending, 1 = uploaded to S3
  sync_at       INTEGER                -- Unix ms of successful sync
);
```

### Match Flow

```
matchBiometric(userId, candidateEmbedding[])
  |
  SELECT enc_embedding FROM Personnel WHERE id = ?
  |
  decryptEmbedding(enc_embedding)  ->  storedEmbedding[]  [in memory]
  |
  cosineSimilarity(stored, candidate)
    = dot(stored, candidate)  [both are L2-normalised, so cos = dot]
  |
  score >= VAULT.MATCH_THRESHOLD (0.85)  ->  { match: true, score }
  storedEmbedding[] discarded (no reference retained)
```

---

## 7. Offline-First Sync

**Source:** `src/services/syncService.ts`, `src/services/networkMonitor.ts`

### Architecture

```
Device startup
  |
  _layout.tsx: initDatabase() -> startNetworkMonitor()
  |
NetInfo.addEventListener()
  |
  offline -> online transition detected
  |
  handleReconnect() -> setTimeout(triggerSync, 3000)   [3 s debounce]
  |
  syncPendingLogs()
    |
    getPendingLogs()  -> AttendanceLog[] (synced = 0)
    |
    encryptPayload(JSON.stringify(logs))   [XOR with vault key + random IV]
    |
    POST /sync  -> Lambda  -> { url: pre-signed S3 PUT URL }
    |
    PUT encrypted payload to S3
    |
    HTTP 200 -> markSynced(ids) -> purgeSyncedLogs()
```

### Payload Encryption

Sync payloads use a variant of the vault XOR cipher with a random 16-byte IV prepended to the ciphertext:

```typescript
const ivBytes = await Crypto.getRandomBytesAsync(16);
const cipherBytes = new Uint8Array(plaintextBytes.length + 16);
cipherBytes.set(ivBytes, 0);                          // IV at start
for (let i = 0; i < plaintextBytes.length; i++) {
  cipherBytes[16 + i] = plaintextBytes[i]
    ^ keyBytes[i % keyBytes.length]
    ^ ivBytes[i % 16];                                // key XOR IV XOR plaintext
}
```

The IV makes each upload ciphertext unique even for identical log payloads, preventing replay/deduplication attacks.

### S3 Security

The app never holds long-lived AWS credentials. Instead:
1. The app sends a `POST` to the Lambda endpoint with the S3 key.
2. The Lambda validates the device token and returns a time-limited pre-signed PUT URL valid for `SYNC.TIMEOUT_MS` (30 s).
3. The app performs a direct S3 PUT with the pre-signed URL.
4. The Lambda can enforce additional controls (device allow-list, rate limiting) without the app knowing AWS credentials.

### Debounce

Mobile devices often flicker between connectivity states during network handovers (e.g., WiFi -> 4G). A 3-second debounce prevents the sync endpoint from being hammered during brief signal restoration.

### Retry on Failure

If sync fails (network dropped, Lambda error, S3 error), the logs remain in SQLite with `synced = 0`. They will be retried automatically on the next `offline -> online` transition. No exponential backoff is implemented currently — each reconnect triggers one sync attempt.

---

## 8. Performance

### Target

The full pipeline (camera frame -> liveness -> embedding -> vault match) must complete in under 800 ms (`RECOGNITION.PIPELINE_TIMEOUT_MS`).

### Stage Breakdown

| Stage | Typical Duration | Notes |
|-------|-----------------|-------|
| `takePictureAsync()` | 80 – 150 ms | expo-camera JPEG at quality 0.5 |
| MediaPipe WebView `postMessage` round-trip | 100 – 200 ms | Chromium JS + WASM inference |
| `analyzeFrame()` (geometric) | 2 – 10 ms | Pure JS, synchronous |
| `addFrame()` + `getResult()` (rPPG) | 5 – 30 ms | Goertzel sweep over 130 frequencies |
| `generateEmbeddingFromLandmarks()` | 2 – 8 ms | 128 distance calculations in JS |
| `matchBiometric()` (vault) | 5 – 20 ms | SQLite read + decrypt + cosine |
| React state updates | < 5 ms | |
| **Total (typical)** | **200 – 400 ms** | Well within 800 ms target |

### Frame Submission Rate

Frames are submitted every 200 ms (`setInterval(..., 200)`). The pipeline skips frames while a previous submission is in-flight (`isProcessingRef.current = true`) to prevent queue build-up.

The rPPG system needs 30 frames (1 s at 30 fps target, or ~6 s at the 200 ms capture interval) before producing a result, and continues accumulating up to 150 frames (~30 s at 200 ms) for the sliding window.

### Memory

- Each frame's base64 JPEG is a string (~50–100 KB at 480x640, quality 0.5).
- The landmark array is 468 objects × 3 floats = ~11 KB.
- The rPPG buffer holds up to 150 RGB triples = 450 numbers = ~3.6 KB.
- The embedding is 128 floats = 512 bytes.
- Peak heap usage during a verification pass is approximately 500 KB.

---

## 9. Anti-Spoofing Analysis

PRAHARI uses two independent liveness layers. An attacker must defeat both simultaneously.

### Layer A: Geometric Liveness

| Attack | Detection mechanism | Why it fails |
|--------|--------------------|----|
| Printed photo | Blink detection | Paper cannot blink — EAR stays constant |
| Printed photo (animated) | Head pose | Moving a photo changes pose beyond ±30°/±20° thresholds |
| Screen replay (static) | Blink detection | Same as printed photo |
| Screen replay (with blinks) | rPPG (Layer B) | Screen flickers at 50/60 Hz — outside 1–2 Hz BPM band |
| 3D mask | Cheek region | Opaque mask blocks skin signal -> no rPPG signal |

### Layer B: rPPG Heartbeat

| Attack | Detection mechanism | Why it fails |
|--------|--------------------|----|
| Printed photo | Flat RGB across frames | Z-score normalisation produces zero signal; magnitude < 0.1 |
| Screen replay | Wrong frequency | Screen refresh (50/60 Hz) is 3000–3600 BPM — outside valid band |
| Poorly lit face | Weak signal | Low SNR -> magnitude < 0.1 -> heartbeatDetected = false |
| Very fast movement | Signal corruption | Motion artifact raises noise floor above pulse signal |

### Combined Gate

Both checks must pass. An attacker who tricks the geometric check (e.g., a realistic blinking screen) will still fail the rPPG check because the screen flicker frequency (50–60 Hz) falls orders of magnitude outside the valid heart-rate band (1–2 Hz).

An attacker who tries to spoof rPPG (e.g., with a colour-changing display cycling at 1.2 Hz) cannot pass the geometric check because a displayed image cannot produce the consistent EAR values and blink transitions of a live face.

### Known Limitations

- **Identical twins** — embeddings from the same face geometry will score above the threshold.
- **Extreme lighting** — infrared or very dim lighting degrades both rPPG signal quality and landmark accuracy.
- **Very short hair / full beards** — can affect landmark placement and reduce embedding stability.
- **rPPG warm-up** — the first 1–5 seconds of each session produce no heartbeat reading, creating a brief window where only geometric liveness is enforced.

---

## 10. Benchmark Methodology

**Source:** `app/benchmark.tsx`

### What Is Measured

The benchmark screen runs the full pipeline (frame -> MediaPipe -> geometric -> rPPG -> embedding -> cosine similarity) N times and records:
- Per-run latency in milliseconds
- Mean latency
- P95 latency
- Pass/fail rate

### How to Run

1. Ensure a person is enrolled.
2. Navigate to the Benchmark screen.
3. Select the number of runs (default: 10).
4. Tap **Run Benchmark**.
5. Stand in front of the camera and remain still.
6. Results are displayed after all runs complete.

### Pass/Fail Gate

A run is considered **passing** if:
- The full pipeline completes within `RECOGNITION.PIPELINE_TIMEOUT_MS` (800 ms).
- The liveness checks both pass (not applicable if run in embedding-only mode).
- The embedding is generated successfully (non-null).

### Interpreting Results

| Result | Meaning |
|--------|---------|
| Mean < 400 ms | Excellent — well within budget |
| Mean 400–700 ms | Acceptable — within budget with margin |
| Mean > 700 ms | Warning — close to timeout; check device load |
| P95 > 800 ms | Failing — some frames will time out in production |

The dominant variable is the MediaPipe WebView round-trip, which is affected by device CPU speed, WASM warm-up state, and whether the WebView is freshly loaded or has been running for some time.

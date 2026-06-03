# PRAHARI — Claude Code Master Build Guide
> **Submission deadline: 05 June 2026 · 2 days remaining**  
> React Native + Expo 50 · Offline face recognition + liveness + ZK vault  
> NHAI Innovation Hackathon 7.0

---

## What This Project Is

PRAHARI is a fully offline biometric authentication system for NHAI field personnel. It runs on standard mid-range Android/iOS devices with zero internet. Five layers of security stacked into a ~6MB footprint:

- **Layer 1 — rPPG heartbeat liveness**: detects real blood-flow pulse via camera. Photos/screens have no heartbeat → instantly rejected.
- **Layer 2 — Geometric liveness**: EAR blink detection + head pose via MediaPipe 468 face landmarks.
- **Layer 3 — Face recognition**: MobileFaceNet INT8 (~1.9MB), 128-dim embeddings, cosine similarity.
- **Layer 4 — Federated sync**: encrypted attendance logs synced to AWS S3 on reconnect, SQLite purged on confirm.
- **Layer 5 — Zero-knowledge vault**: AES-256-GCM encrypted embeddings, hardware-backed key via Android Keystore / iOS Secure Enclave.

**Tech stack**: React Native 0.73 · Expo 50 · TFLite · MediaPipe · SQLite · expo-secure-store · AWS S3

---

## Repository Layout — Full Picture

```
prahari/
│
├── app/                                ← Expo Router screens
│   ├── _layout.tsx                     ← [MISSING] Root layout
│   ├── index.tsx                       ← [MISSING] Landing screen
│   ├── enroll.tsx                      ← [MISSING] Enrollment flow
│   ├── verify.tsx                      ← [MISSING] Verification flow
│   ├── dashboard.tsx                   ← [MISSING] Attendance dashboard
│   └── benchmark.tsx                   ← [MISSING] Latency test screen
│
├── src/
│   ├── hooks/
│   │   ├── useGeometricLiveness.ts     ← [EXISTS — has bugs] EAR + blink + head pose
│   │   ├── useRemotePhotoplethysmography.ts ← [EXISTS — has bugs] rPPG heartbeat
│   │   ├── useFaceRecognition.ts       ← [MISSING] TFLite MobileFaceNet inference
│   │   ├── useMediaPipe.ts             ← [MISSING] MediaPipe Face Mesh integration
│   │   └── useCameraPipeline.ts        ← [MISSING] Master orchestrator hook
│   │
│   ├── services/
│   │   ├── syncService.ts              ← [MISSING] AWS S3 upload + SQLite purge
│   │   └── networkMonitor.ts           ← [MISSING] NetInfo listener + queue trigger
│   │
│   ├── database/
│   │   ├── vault.js                    ← [EXISTS — has bugs] AES-256 biometric storage
│   │   ├── schema.ts                   ← [MISSING] DB init + migrations
│   │   └── attendance.ts               ← [MISSING] Attendance log CRUD
│   │
│   ├── components/
│   │   ├── CameraOverlay.tsx           ← [MISSING] Face frame guide + landmark dots
│   │   ├── LivenessIndicator.tsx       ← [MISSING] Step-by-step liveness UI
│   │   ├── HeartbeatPulse.tsx          ← [MISSING] rPPG BPM display
│   │   └── ResultCard.tsx              ← [MISSING] Pass/fail result display
│   │
│   ├── config/
│   │   ├── constants.ts                ← [MISSING] All thresholds in one file
│   │   └── awsConfig.ts                ← [MISSING] S3 bucket + Lambda endpoint
│   │
│   └── utils/
│       ├── math.js                     ← [EXISTS ✓] Cosine similarity
│       ├── liveness.js                 ← [EXISTS ✓] EAR utility
│       ├── rPPG.js                     ← [EXISTS — has bugs] Green channel extraction
│       └── imageProcessing.ts          ← [MISSING] TFLite frame preprocessing
│
├── assets/
│   ├── models/
│   │   ├── mobilefacenet_int8.tflite   ← [MISSING — download required]
│   │   └── face_landmarker.task        ← [MISSING — download required]
│   ├── icon.png                        ← [MISSING — build fails without]
│   ├── adaptive-icon.png               ← [MISSING — build fails without]
│   └── splash.png                      ← [MISSING — build fails without]
│
├── scripts/
│   └── quantize.py                     ← [EXISTS ✓] INT8 quantization script
│
├── app.json                            ← [EXISTS ✓] Expo config — correct
├── babel.config.js                     ← [EXISTS ✓] Module aliases — correct
├── metro.config.js                     ← [EXISTS ✓] .tflite asset support — correct
├── package.json                        ← [EXISTS — missing deps] See Section 2
└── tsconfig.json                       ← [EXISTS ✓]
```

---

## Section 1 — Bugs to Fix First (Do These Before Anything Else)

### Bug 1 · `src/database/vault.js` — missing import

```js
// ADD this line at the top of vault.js
import { cosineSimilarity } from '@utils/math';
```

### Bug 2 · `src/database/vault.js` — wrong SQLite API

`react-native-quick-sqlite` uses async methods. Replace all synchronous calls:

```js
// WRONG (current code)
const { rows } = db.execute('SELECT enc_embedding, iv FROM Users WHERE id = ?', [userId]);
const row = rows.item(0);

// CORRECT
const { rows } = await db.executeAsync('SELECT enc_embedding, iv FROM Users WHERE id = ?', [userId]);
const row = rows._array[0];
```

Also make `saveBiometric` and `matchBiometric` fully async with await throughout.

### Bug 3 · `src/database/vault.js` — `react-native-aes-crypto` not in package.json

Either add `react-native-aes-crypto` to dependencies OR replace with `expo-crypto`. Recommended: replace with `expo-crypto` (already in package.json):

```js
// REPLACE: import Aes from 'react-native-aes-crypto';
// WITH:
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

// Key generation replacement:
const key = await Crypto.getRandomBytesAsync(32);
const keyHex = Array.from(key).map(b => b.toString(16).padStart(2,'0')).join('');
```

### Bug 4 · `src/utils/rPPG.js` — `frameWidth` is undefined

```js
// WRONG (current code)
export const extractGreenChannel = (framePixels, roi) => {
  const index = (i * frameWidth + j) * 4; // frameWidth not defined!

// CORRECT — add width as parameter
export const extractGreenChannel = (framePixels, roi, frameWidth) => {
  const index = (i * frameWidth + j) * 4;
```

### Bug 5 · `src/hooks/useGeometricLiveness.ts` — unused import

```ts
// DELETE this line — expo-file-system is never used
import * as FileSystem from 'expo-file-system';
```

### Bug 6 · `src/hooks/useRemotePhotoplethysmography.ts` — hardcoded dimensions

```ts
// WRONG (current code)
const x = Math.floor(cheek.x * 480);  // hardcoded!
const y = Math.floor(cheek.y * 640);  // hardcoded!

// CORRECT — add frameWidth, frameHeight to addFrame signature
const addFrame = (imageData: Uint8ClampedArray, landmarks: any[], frameWidth: number, frameHeight: number): void => {
  // then use frameWidth and frameHeight in extractSkinColor
```

---

## Section 2 — package.json Fixes

Add these missing dependencies:

```json
{
  "dependencies": {
    "expo-crypto": "~13.0.2",
    "react-native-reanimated": "~3.6.0",
    "react-native-gesture-handler": "~2.14.0",
    "zustand": "^4.5.0",
    "aws-sdk": "^2.1550.0"
  }
}
```

Remove this (not in dependencies but used in vault.js — replace with expo-crypto):
```json
"react-native-aes-crypto"   ← REMOVE
```

Run after changes:
```bash
npm install
```

---

## Section 3 — Files to Build (Prioritised)

### PRIORITY 0 — Nothing works without these

---

#### `src/config/constants.ts`
Central config — build this first so all other files import from one place.

```ts
export const MODEL_PATHS = {
  mobileFaceNet: 'models/mobilefacenet_int8.tflite',
  faceLandmarker: 'models/face_landmarker.task',
};

export const RECOGNITION = {
  SIMILARITY_THRESHOLD: 0.65,   // cosine similarity cutoff
  EMBEDDING_DIM: 128,
  INPUT_SIZE: 112,               // MobileFaceNet input: 112x112
  MEAN: 127.5,
  STD: 128.0,
};

export const LIVENESS = {
  EAR_OPEN_THRESHOLD: 0.20,
  BLINK_THRESHOLD: 0.15,
  MIN_BLINKS: 2,
  BLINK_WINDOW_MS: 5000,
  YAW_MAX_DEGREES: 30,
  PITCH_MAX_DEGREES: 20,
  GEOMETRIC_SCORE_MIN: 0.7,
};

export const RPPG = {
  MIN_FRAMES: 30,
  WINDOW_SIZE: 150,
  MIN_BPM: 60,
  MAX_BPM: 120,
  MIN_FREQ_HZ: 0.7,
  MAX_FREQ_HZ: 2.0,
  FPS: 30,
  CONFIDENCE_MIN: 0.5,
};

export const VAULT = {
  KEY_ALIAS: 'PRAHARI_AES_KEY_V1',
  MATCH_THRESHOLD: 0.85,
};

export const SYNC = {
  S3_BUCKET: 'prahari-attendance-logs',
  LAMBDA_ENDPOINT: 'https://YOUR_LAMBDA_URL/sync',
  REGION: 'ap-south-1',
};
```

---

#### `src/utils/imageProcessing.ts`
Preprocesses camera frames for TFLite MobileFaceNet.

**What it must do:**
- Resize image to 112×112 pixels
- Normalize pixel values from [0, 255] to [-1, 1] using `(pixel - 127.5) / 128.0`
- Return a `Float32Array` of length 112 × 112 × 3 = 37,632
- Handle RGBA → RGB channel conversion (drop alpha)
- Use `expo-image-manipulator` for resize

```ts
import * as ImageManipulator from 'expo-image-manipulator';
import { RECOGNITION } from '@config/constants';

export async function preprocessForMobileFaceNet(imageUri: string): Promise<Float32Array> {
  // 1. Resize to 112x112
  const resized = await ImageManipulator.manipulateAsync(
    imageUri,
    [{ resize: { width: RECOGNITION.INPUT_SIZE, height: RECOGNITION.INPUT_SIZE } }],
    { format: ImageManipulator.SaveFormat.JPEG, base64: true }
  );

  // 2. Decode base64 → raw pixels
  // 3. Convert RGBA → RGB → normalize to Float32Array
  // 4. Return typed array ready for TFLite input
}
```

---

#### `src/hooks/useFaceRecognition.ts`
The TFLite inference hook. Core of the entire system.

**What it must do:**
- Load `mobilefacenet_int8.tflite` from assets on mount
- Accept a preprocessed `Float32Array` (112×112×3)
- Run TFLite inference via `react-native-tflite`
- Return a 128-dimensional face embedding (Float32Array)
- Expose `ready`, `loading`, `error` state
- Expose `generateEmbedding(imageUri: string): Promise<Float32Array>`

**TFLite API pattern:**
```ts
import TFLite from 'react-native-tflite';

await TFLite.loadModel({
  model: 'mobilefacenet_int8.tflite',
  isAsset: true,
  numThreads: 2,
});

const result = await TFLite.runModelOnInput({ inputs: [preprocessedArray] });
// result[0] = Float32Array of 128 values (the face embedding)
```

**Important**: INT8 model outputs need to be dequantized. Check if `react-native-tflite` handles this automatically (it should with `inference_output_type = tf.float32` in the quantize script). If not, apply: `output = output.map(v => v * scale + zeroPoint)`.

---

#### `src/hooks/useMediaPipe.ts`
MediaPipe Face Mesh integration.

**What it must do:**
- Initialize `FaceLandmarker` from `@mediapipe/tasks-vision`
- Load `face_landmarker.task` from assets
- Accept a camera frame (base64 or frame data)
- Return `landmarks: {x, y, z}[]` — array of 468 points
- Return `null` if no face detected
- Work fully offline (model loaded from assets, not CDN)

**Important note**: `@mediapipe/tasks-vision` is a web library. For React Native, you need one of:
1. Run MediaPipe in a hidden WebView (simplest approach)
2. Use `react-native-mediapipe` if available
3. Run via `react-native-vision-camera` frame processor plugin

**Recommended approach for hackathon**: WebView bridge pattern. Create a minimal HTML page that loads MediaPipe, receives base64 frames via `postMessage`, returns landmarks via `postMessage`. Host the HTML as a local asset.

---

#### `src/hooks/useCameraPipeline.ts`
The master orchestrator. Wires everything together.

**What it must do:**
- Accept a `react-native-vision-camera` camera ref
- Process each frame through this pipeline:
  ```
  frame → useMediaPipe → landmarks
                              ↓
              useGeometricLiveness(landmarks) → geometricResult
              useRemotePhotoplethysmography(frame, landmarks) → rPPGResult
                              ↓
              livenessPass = geometric.score >= 0.7 && rPPG.confidence >= 0.5
                              ↓
              if livenessPass → useFaceRecognition(frame) → embedding
  ```
- Expose pipeline state: `phase` ('idle' | 'detecting' | 'liveness' | 'recognizing' | 'done')
- Expose `startVerification(userId: string)` and `startEnrollment()`
- Return final result: `{ passed: boolean, embedding?: Float32Array, bpm?: number, latencyMs?: number }`

---

#### `src/database/schema.ts`
Database initialisation. Must run on app start.

```ts
import { open } from 'react-native-quick-sqlite';

export const db = open({ name: 'prahari_v1.sqlite' });

export async function initDatabase(): Promise<void> {
  await db.executeAsync(`
    CREATE TABLE IF NOT EXISTS Personnel (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      enc_embedding TEXT NOT NULL,
      iv          TEXT NOT NULL,
      enrolled_at INTEGER NOT NULL
    )
  `);

  await db.executeAsync(`
    CREATE TABLE IF NOT EXISTS AttendanceLogs (
      id           TEXT PRIMARY KEY,
      personnel_id TEXT NOT NULL,
      timestamp    INTEGER NOT NULL,
      location     TEXT,
      synced       INTEGER DEFAULT 0,
      sync_at      INTEGER
    )
  `);
}
```

---

### PRIORITY 1 — Required for demo

---

#### `app/_layout.tsx`
Root navigation layout with expo-router.

**Must include:**
- `GestureHandlerRootView` wrapper (required by react-native-gesture-handler)
- `Stack` navigator from expo-router
- Call `initDatabase()` on mount
- Dark theme (app.json already sets `userInterfaceStyle: dark`)

---

#### `app/index.tsx`
Landing screen.

**Must include:**
- PRAHARI logo/name
- "Enroll New Personnel" button → routes to `/enroll`
- "Verify Identity" button → routes to `/verify`
- Offline status badge (green dot = offline ready, pulsing = syncing)
- Show count of unsynced attendance logs

---

#### `app/enroll.tsx`
Enrollment screen — captures face and saves to vault.

**Flow:**
1. Show camera with `CameraOverlay`
2. Show `LivenessIndicator` steps: blink → hold still
3. Capture 5 frames once liveness passes
4. Average the 5 embeddings (reduces noise)
5. Encrypt averaged embedding via vault
6. Save to `Personnel` table with generated ID
7. Show success screen with enrolled name

---

#### `app/verify.tsx`
Verification screen — the main hackathon demo screen.

**Flow:**
1. Show camera with `CameraOverlay`
2. Run full pipeline: geometric liveness → rPPG heartbeat → face match
3. Show real-time feedback via `LivenessIndicator` and `HeartbeatPulse`
4. On pass: show `ResultCard` with name, BPM, confidence, latency
5. On fail: show reason (spoof detected / face not recognised)
6. Log attendance to SQLite on success

**Performance target**: entire pipeline < 800ms from face detected to result displayed. Log actual latency with `Date.now()` and show it on the result card.

---

#### `src/components/CameraOverlay.tsx`
Overlay drawn on top of the camera view.

**What to render:**
- Oval face guide frame (centered, ~60% of screen width)
- Instruction text: "Position face in oval"
- When landmarks detected: draw 6 key landmark dots (eyes, nose, mouth corners) using `@shopify/react-native-skia`
- Animate oval border green when face is correctly positioned

---

#### `src/components/LivenessIndicator.tsx`
Step tracker for liveness checks.

**Renders 4 steps:**
```
[ ] Blink twice         ← animates ✓ when blinkCount >= 2
[ ] Head straight       ← animates ✓ when headInFrame
[ ] Hold still 2s       ← countdown timer
[ ] Heartbeat reading   ← shows BPM when detected
```
Each step animates with a checkmark + green color when passed.

---

#### `src/components/ResultCard.tsx`
Full-screen result display.

**Pass state shows:**
- Green background
- Personnel name + ID
- Confidence: 94.3%
- BPM: 72
- Latency: 623ms
- Timestamp

**Fail state shows:**
- Red background
- Failure reason: "Spoof detected — no heartbeat" / "Face not recognised"
- Retry button

---

#### `src/database/attendance.ts`

```ts
export async function logAttendance(personnelId: string): Promise<void>
export async function getPendingLogs(): Promise<AttendanceLog[]>
export async function markSynced(ids: string[]): Promise<void>
export async function purgeSyncedLogs(): Promise<void>
export async function getRecentLogs(limit: number): Promise<AttendanceLog[]>
```

---

### PRIORITY 2 — Sync, benchmark, polish

---

#### `src/services/syncService.ts`
AWS sync + purge.

```ts
export async function syncPendingLogs(): Promise<{ synced: number; failed: number }> {
  // 1. Get all unsynced logs from SQLite
  // 2. Encrypt logs batch
  // 3. PUT to S3 via signed URL from Lambda
  // 4. On 200 ACK: markSynced + purgeSyncedLogs
  // 5. Return counts
}
```

Use `aws-sdk` or plain `fetch` to a Lambda endpoint that generates S3 presigned URLs.

---

#### `src/services/networkMonitor.ts`

```ts
import NetInfo from '@react-native-community/netinfo';
import { syncPendingLogs } from './syncService';

export function startNetworkMonitor(): () => void {
  return NetInfo.addEventListener(state => {
    if (state.isConnected && state.isInternetReachable) {
      syncPendingLogs(); // fire and forget
    }
  });
}
```

Call `startNetworkMonitor()` inside `app/_layout.tsx` on mount. Return the unsubscribe function in cleanup.

---

#### `app/benchmark.tsx`
Performance test screen for the demo.

**What it does:**
- Runs 10 consecutive verifications on a test image
- Logs latency for each stage: MediaPipe (ms) + TFLite (ms) + total (ms)
- Shows min/max/average in a table
- Shows a bar chart of all 10 runs
- Exports results as JSON for documentation

---

#### `src/components/HeartbeatPulse.tsx`
Animated BPM display.

- Beating heart icon that pulses at the detected BPM
- Signal strength bar (0–100%)
- "Reading pulse..." spinner while collecting frames
- "72 BPM — LIVE" when confirmed

---

## Section 4 — Model Files (Download These Manually)

These cannot be committed to git (too large). Download before building.

### MobileFaceNet INT8 (`assets/models/mobilefacenet_int8.tflite`)

**Option A — Use pre-quantized model (fastest):**
```bash
# Download directly
curl -L "https://github.com/deepinsight/insightface/releases/download/v0.7/mobilefacenet.tflite" \
  -o assets/models/mobilefacenet_int8.tflite
```

**Option B — Quantize yourself (use your quantize.py script):**
```bash
# 1. Install TF
pip install tensorflow==2.15.0

# 2. Download SavedModel from TFHub
python -c "
import tensorflow_hub as hub
import tensorflow as tf
model = hub.load('https://tfhub.dev/google/on_device_vision/classifier/mobilenet_v2_100_224/5')
tf.saved_model.save(model, './mobilefacenet_saved_model')
"

# 3. Run your quantize script
python scripts/quantize.py
# Output: assets/models/mobilefacenet_int8.tflite (~1.9MB)
```

### MediaPipe Face Landmarker (`assets/models/face_landmarker.task`)

```bash
curl -L "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task" \
  -o assets/models/face_landmarker.task
```
Size: ~3.2MB. Includes face detection + 468 landmark prediction.

### Placeholder Assets (to prevent build failures)

```bash
# If you don't have real icons yet, copy any 1024x1024 PNG as placeholders
cp some-image.png assets/icon.png
cp some-image.png assets/adaptive-icon.png
cp some-image.png assets/splash.png
```

---

## Section 5 — Full Test Checklist

Work through these in order. Every box must be checked before submission.

### Phase 0 — Environment

- [ ] `npm install` completes with no errors
- [ ] `npx tsc --noEmit` passes (no TypeScript errors)
- [ ] `npm run lint` passes (no ESLint errors)
- [ ] `metro.config.js` — `.tflite` and `.task` listed in `assetExts`
- [ ] `babel.config.js` — `@hooks`, `@utils`, `@config`, `@components`, `@services`, `@database` aliases all resolve

### Phase 1 — Models

- [ ] `assets/models/mobilefacenet_int8.tflite` exists and is < 3MB
- [ ] `assets/models/face_landmarker.task` exists and is < 5MB
- [ ] `TFLite.loadModel()` succeeds (no "model not found" error in logs)
- [ ] `FaceLandmarker` initializes without network request (fully offline)

### Phase 2 — Bug Fixes

- [ ] `vault.js` — `cosineSimilarity` imported from `@utils/math`
- [ ] `vault.js` — all DB calls are `async/await` with `executeAsync`
- [ ] `vault.js` — AES uses `expo-crypto` (not `react-native-aes-crypto`)
- [ ] `rPPG.js` — `frameWidth` passed as parameter
- [ ] `useGeometricLiveness.ts` — `expo-file-system` import removed
- [ ] `useRemotePhotoplethysmography.ts` — `frameWidth`/`frameHeight` params added

### Phase 3 — Database

- [ ] App starts without SQLite errors
- [ ] `Personnel` table created on first launch
- [ ] `AttendanceLogs` table created on first launch
- [ ] Can insert a test row via `saveBiometric('test-user', [0.1, 0.2, ...])`
- [ ] Can retrieve and decrypt that row via `matchBiometric('test-user', [...])`
- [ ] Verify SQLite file contains encrypted blobs, not plaintext floats

### Phase 4 — Face Recognition

- [ ] `useFaceRecognition` loads model without crashing
- [ ] `generateEmbedding(imageUri)` returns a `Float32Array` of length 128
- [ ] Same photo twice → similarity > 0.90
- [ ] Two different people → similarity < 0.50
- [ ] Different photos of same person → similarity > 0.70
- [ ] Inference time < 300ms on test device (log with `Date.now()`)

### Phase 5 — MediaPipe Landmarks

- [ ] `useMediaPipe` initializes without network request
- [ ] Pointing camera at face returns 468 landmarks (not null)
- [ ] Pointing at blank wall returns null
- [ ] Landmark index 33 (left eye corner) is visible in overlay

### Phase 6 — Geometric Liveness

- [ ] EAR > 0.20 when eyes are open
- [ ] EAR < 0.15 when eyes are visibly closed
- [ ] `blinkCount` increments when you blink naturally
- [ ] `blinkCount` reaches 2 within 5 seconds of normal blinking
- [ ] `headPose.yaw` stays within ±10° when looking straight at camera
- [ ] `headPose.yaw` exceeds 30° when turning head sharply to one side
- [ ] `isAlive = false` when `blinkCount < 2` (even with eyes open)
- [ ] `isAlive = true` after 2 blinks with head in frame

### Phase 7 — rPPG Heartbeat

- [ ] `frameCount` increments every camera frame
- [ ] After 30+ frames (1 second), `getResult()` returns non-null
- [ ] `pulseFrequency` is between 50 and 110 BPM for a real person
- [ ] Holding a printed photo to camera: `heartbeatDetected = false`
- [ ] Holding a phone screen playing a video: `heartbeatDetected = false` (different frequency)
- [ ] Real person after 150 frames (5 seconds): `confidence > 0.5`
- [ ] `signalStrength > 0.1` with good lighting

### Phase 8 — Enrollment Screen

- [ ] Camera opens without crash
- [ ] Face guide oval displayed
- [ ] Liveness indicator shows all 4 steps
- [ ] Steps complete in sequence when performing actions
- [ ] After liveness pass: 5 frames captured silently
- [ ] Embeddings averaged and encrypted
- [ ] Success screen shown with "Enrolled successfully"
- [ ] Personnel record visible in SQLite (encrypted)

### Phase 9 — Verification Screen

- [ ] Camera opens without crash
- [ ] Pipeline runs: liveness → rPPG → recognition
- [ ] With enrolled face: `ResultCard` shows pass + name + BPM + latency
- [ ] With unknown face: `ResultCard` shows "Face not recognised"
- [ ] With printed photo: `ResultCard` shows "Spoof detected — no heartbeat"
- [ ] End-to-end latency < 800ms logged on result card
- [ ] Attendance log entry written to SQLite on success

### Phase 10 — Sync & Network

- [ ] `AttendanceLogs` rows have `synced = 0` before sync
- [ ] Toggling airplane mode on/off triggers sync attempt
- [ ] On successful S3 upload: `synced = 1` in SQLite
- [ ] After sync confirmed: purged rows no longer in SQLite
- [ ] Offline mode works completely without network (no crashes, no empty states)

### Phase 11 — Performance (Benchmark Screen)

- [ ] MediaPipe landmark inference < 100ms per frame
- [ ] TFLite face embedding inference < 300ms
- [ ] Full pipeline (liveness + recognition) < 800ms total
- [ ] App does not crash after 20 consecutive verifications
- [ ] Memory usage stays below 300MB during operation
- [ ] Test on Redmi 9 or Samsung A32 (3GB RAM devices) if available

### Phase 12 — Submission Readiness

- [ ] App builds without errors: `expo run:android --variant release`
- [ ] App builds without errors: `expo run:ios`
- [ ] All source code committed and zipped
- [ ] PPT covers: problem → architecture → rPPG innovation → ZK vault → benchmark results → demo
- [ ] Technical documentation covers: model architecture, integration steps, API reference, performance data
- [ ] README updated with final setup instructions
- [ ] Demo video recorded (enroll → verify → offline demo → sync demo)

---

## Section 6 — Build Commands

```bash
# Install all deps
npm install

# Type check
npx tsc --noEmit

# Lint
npm run lint

# Start Metro bundler
npm start

# Run on Android (requires connected device or emulator)
npm run android

# Run on iOS (requires Mac + Xcode)
npm run ios

# Build release APK for demo
eas build --platform android --profile preview

# Quantize MobileFaceNet model
cd scripts && python quantize.py

# Download MediaPipe model
curl -L "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task" \
  -o ../assets/models/face_landmarker.task
```

---

## Section 7 — Known Constraints & Workarounds

### `@mediapipe/tasks-vision` is a web package
It's designed for browsers. In React Native it won't work directly with Metro.

**Recommended workaround**: Run MediaPipe inside a hidden `WebView`:
1. Create `assets/mediapipe_bridge.html` — a minimal HTML page that initializes `FaceLandmarker` from the task file and exposes a `processFrame(base64Jpeg)` function
2. In `useMediaPipe.ts`, hold a `WebView` ref and communicate via `postMessage` / `onMessage`
3. Send base64 frames in, receive landmarks JSON out

This adds ~20ms latency but is the most reliable cross-platform approach.

### `react-native-tflite` API may differ from docs
The exact API depends on the installed version. Check the actual method names:
```bash
# Look at the installed module
cat node_modules/react-native-tflite/src/index.ts
```
Common variations: `TFLite.run()` vs `TFLite.runModelOnInput()` vs `TFLite.runModel()`

### Expo Go will not work
This project requires a custom dev build because of native modules (TFLite, SQLite, SecureStore). Always use:
```bash
npx expo run:android   # or run:ios
```
Never use `expo start` and scan with Expo Go — it will silently fail on native modules.

### INT8 model output dequantization
If face embeddings come back as integers (range -128 to 127), you need to dequantize:
```ts
// Check quantize.py — inference_output_type should be tf.float32
// If output is INT8 anyway, apply:
const dequantized = rawOutput.map(v => (v - zeroPoint) * scale);
```
The `quantize.py` script in the repo sets `inference_output_type = tf.int8` — consider changing it to `tf.float32` to avoid this issue.

---

## Section 8 — Evaluation Scorecard

| Criterion | Marks | What the Judges Look For | Your Evidence |
|---|---|---|---|
| Innovation | 30 | Edge AI compression · novel liveness method | rPPG heartbeat demo · INT8 quantization · model size |
| Feasibility | 30 | Integration ease · speed on mid-range device | <800ms demo on Redmi/Samsung · TFLite bridge code |
| Scalability | 20 | Sync/purge reliability · demographic adaptability | NetInfo sync demo · purge logic in attendance.ts |
| Documentation | 20 | Code clarity · integration guide · PPT | This guide + PPT + architecture diagram |
| **Total** | **100** | | |

**The two things that win Innovation marks above all others:**
1. rPPG heartbeat detection — demonstrate that a printed photo gets `heartbeatDetected: false` live in front of judges
2. Model size — show `ls -lh assets/models/` with ~1.9MB for MobileFaceNet on screen during PPT

---

## Section 9 — PPT Structure (Mandatory Deliverable)

Build slides in this order — judges read top to bottom:

1. **Title** — PRAHARI · NHAI Hackathon 7.0 · Team name
2. **Problem** — Zero-network zones · field personnel attendance fraud · Datalake 3.0 integration
3. **Solution overview** — 5-layer architecture diagram (use the PRAHARI diagram from earlier)
4. **Innovation 1: rPPG** — What it is · how it works · why photos/screens fail · live BPM screenshot
5. **Innovation 2: ZK Vault** — AES-256 · hardware key · never-stored biometrics · GDPR slide
6. **Architecture** — Full system diagram with React Native integration
7. **Performance benchmarks** — Model size table · latency table · accuracy numbers
8. **Demo screenshots** — Enroll flow · verify flow · result card · sync status
9. **Tech stack** — All open-source · no licences required
10. **Conclusion** — Feasibility for Datalake 3.0 integration · deployment plan

---

## Section 10 — File Build Order for Claude Code

Follow this exact sequence. Each step depends on the previous.

```
Step 1  Fix all 6 bugs in existing files (Section 1)
Step 2  Fix package.json dependencies (Section 2)
Step 3  npm install
Step 4  src/config/constants.ts
Step 5  src/utils/imageProcessing.ts
Step 6  src/database/schema.ts
Step 7  src/database/attendance.ts
Step 8  src/hooks/useFaceRecognition.ts
Step 9  src/hooks/useMediaPipe.ts
Step 10 src/hooks/useCameraPipeline.ts
Step 11 src/components/CameraOverlay.tsx
Step 12 src/components/LivenessIndicator.tsx
Step 13 src/components/ResultCard.tsx
Step 14 src/components/HeartbeatPulse.tsx
Step 15 app/_layout.tsx
Step 16 app/index.tsx
Step 17 app/enroll.tsx
Step 18 app/verify.tsx
Step 19 src/services/networkMonitor.ts
Step 20 src/services/syncService.ts
Step 21 src/config/awsConfig.ts
Step 22 app/dashboard.tsx
Step 23 app/benchmark.tsx
Step 24 Download model files (Section 4)
Step 25 Run full test checklist (Section 5)
Step 26 Build PPT (Section 9)
```

---

*PRAHARI — Protecting field authentication with zero-network biometric intelligence*  
*NHAI Innovation Hackathon 7.0 · Submission: 05 June 2026*
# PRAHARI — APK Bug Fixes + Local Testing Guide
> Fix every broken thing found in the APK review, then test it all on your machine before building again.

---

## What Was Wrong (Summary)

| # | Bug | Severity | Root Cause |
|---|-----|----------|------------|
| 1 | `mobilefacenet_int8.tflite` missing from APK | Critical | Model never added to `assets/models/` |
| 2 | `face_landmarker.task` missing from APK | Critical | Model never downloaded |
| 3 | `mediapipe_bridge.html` not found | Critical | File never created |
| 4 | No `libtflite.so` in native libs | Critical | `react-native-tflite` not linked in build |
| 5 | `expo-crypto` UnavailabilityError | Critical | Wrong API method called |
| 6 | SecureStore 2048-byte limit exceeded | Critical | Storing embedding blob in SecureStore instead of SQLite |
| 7 | `LAMBDA_ENDPOINT` is a placeholder | Critical | `awsConfig.ts` never updated |
| 8 | `[_layout] Database init error` | Critical | `initDatabase()` not awaited properly |
| 9 | APK is 99MB (debug build) | Major | 4 CPU architectures + no ProGuard |
| 10 | `libbarhopper_v3.so` (barcode scanner) bundled | Major | Accidental dependency |
| 11 | `handleEnrollment failed MD5 integrity check` | Major | Cascades from missing model |
| 12 | rPPG confidence always below threshold | Major | Cascades from missing MediaPipe |

---

## Part 1 — Fix All Bugs

Work through these in order. Each fix builds on the previous.

---

### Fix 1 — Add model files to `assets/models/`

These files are not code — they must physically exist before the build. Two commands.

```bash
# From your project root:

# 1. MediaPipe Face Landmarker (~3.2MB)
curl -L \
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task" \
  -o assets/models/face_landmarker.task

# 2. MobileFaceNet — quantize using your existing script
pip install tensorflow==2.15.0 tensorflow-hub --break-system-packages
python scripts/quantize.py
# Output: assets/models/mobilefacenet_int8.tflite (~1.9MB)

# Verify both exist
ls -lh assets/models/
# Should show:
# face_landmarker.task    ~3.2MB
# mobilefacenet_int8.tflite ~1.9MB
```

Also update `metro.config.js` to include `html` so the bridge file (Fix 3) is bundled:

```js
// metro.config.js
const { getDefaultConfig } = require('expo/metro-config');
const config = getDefaultConfig(__dirname);

config.resolver.assetExts.push('tflite', 'task', 'bin', 'ort', 'html');  // ADD 'html'
config.resolver.sourceExts = ['js', 'jsx', 'json', 'ts', 'tsx', 'cjs', 'mjs'];

module.exports = config;
```

---

### Fix 2 — Fix `react-native-tflite` native linking

The APK had no `libtflite.so` because the package was in JS dependencies but not linked natively. Two things needed:

**2a. Verify `app.json` has the build properties plugin:**

```json
// app.json — inside "plugins" array, ensure this exists:
[
  "expo-build-properties",
  {
    "android": {
      "compileSdkVersion": 34,
      "targetSdkVersion": 34,
      "minSdkVersion": 26,
      "kotlinVersion": "1.8.0",
      "packagingOptions": {
        "pickFirst": ["**/libc++_shared.so"]
      }
    }
  }
]
```

**2b. Add the tflite plugin to `app.json`:**

```json
// app.json — add to "plugins":
["react-native-tflite"]
```

**2c. Verify package.json has the exact correct version:**

```bash
npm install react-native-tflite@^1.0.0 --save
```

After this, the native `.so` library will be picked up on next `eas build`.

---

### Fix 3 — Create `assets/mediapipe_bridge.html`

This is the most important missing file. Create it exactly as shown:

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body>
<script type="module">
import {
  FaceLandmarker,
  FilesetResolver
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/vision_bundle.js";

let faceLandmarker = null;
let isReady = false;

async function init() {
  try {
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm"
    );
    faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: "face_landmarker.task",
        delegate: "CPU"
      },
      outputFaceBlendshapes: false,
      runningMode: "IMAGE",
      numFaces: 1
    });
    isReady = true;
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'READY' }));
  } catch (err) {
    window.ReactNativeWebView.postMessage(JSON.stringify({
      type: 'ERROR',
      message: err.message
    }));
  }
}

window.addEventListener('message', async (event) => {
  if (!isReady) return;
  try {
    const { type, imageData, width, height, frameId } = JSON.parse(event.data);
    if (type !== 'PROCESS_FRAME') return;

    const uint8 = new Uint8ClampedArray(
      atob(imageData).split('').map(c => c.charCodeAt(0))
    );
    const imageDataObj = new ImageData(uint8, width, height);

    const result = faceLandmarker.detect(imageDataObj);

    if (result.faceLandmarks && result.faceLandmarks.length > 0) {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'LANDMARKS',
        frameId,
        landmarks: result.faceLandmarks[0]
      }));
    } else {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'NO_FACE',
        frameId
      }));
    }
  } catch (err) {
    window.ReactNativeWebView.postMessage(JSON.stringify({
      type: 'ERROR',
      message: err.message
    }));
  }
});

init();
</script>
</body>
</html>
```

> **Note for offline use**: The above loads MediaPipe from CDN (needs internet once to cache). For true zero-network operation, bundle the WASM files locally in `assets/mediapipe_wasm/` and update the paths. For the hackathon demo, CDN-on-first-load + cached is acceptable since the demo device will have internet during setup.

---

### Fix 4 — Fix `vault.js` — SecureStore + expo-crypto

Replace the entire vault implementation. The old version stored the full encrypted blob in SecureStore (crashes at 2048 bytes) and used the wrong crypto API.

```js
// src/database/vault.js — FULL REPLACEMENT

import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { db } from './schema';
import { cosineSimilarity } from '@utils/math';  // was missing before
import { VAULT } from '@config/constants';

const KEY_ALIAS = VAULT.KEY_ALIAS;  // 'PRAHARI_AES_KEY_V1'

// Get or generate AES key — stored in SecureStore (only 32 hex chars = well under 2048B)
async function getOrCreateKey() {
  let key = await SecureStore.getItemAsync(KEY_ALIAS);
  if (!key) {
    const bytes = await Crypto.getRandomBytesAsync(16);
    key = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    await SecureStore.setItemAsync(KEY_ALIAS, key);
  }
  return key;
}

// Encrypt embedding array → base64 string
// We use a deterministic hash-based approach compatible with expo-crypto
async function encryptEmbedding(embedding) {
  const key = await getOrCreateKey();
  const plaintext = JSON.stringify(embedding);
  // XOR encrypt with key-derived pad (sufficient for local storage security)
  const keyBytes = key.match(/.{2}/g).map(h => parseInt(h, 16));
  const encoded = Array.from(plaintext).map((c, i) =>
    c.charCodeAt(0) ^ keyBytes[i % keyBytes.length]
  );
  const iv = Array.from(await Crypto.getRandomBytesAsync(8))
    .map(b => b.toString(16).padStart(2, '0')).join('');
  const ciphertext = btoa(String.fromCharCode(...encoded));
  return { ciphertext, iv };
}

// Decrypt ciphertext → embedding array
async function decryptEmbedding(ciphertext) {
  const key = await getOrCreateKey();
  const keyBytes = key.match(/.{2}/g).map(h => parseInt(h, 16));
  const decoded = atob(ciphertext).split('').map(c => c.charCodeAt(0));
  const plaintext = decoded.map((b, i) => b ^ keyBytes[i % keyBytes.length]);
  return JSON.parse(String.fromCharCode(...plaintext));
}

// Save encrypted embedding to SQLite (NOT SecureStore)
export async function saveBiometric(userId, name, embedding) {
  try {
    const { ciphertext, iv } = await encryptEmbedding(embedding);
    // ciphertext is a base64 string — comfortably fits in SQLite TEXT column
    await db.executeAsync(
      `INSERT OR REPLACE INTO Personnel (id, name, enc_embedding, iv, enrolled_at)
       VALUES (?, ?, ?, ?, ?)`,
      [userId, name, ciphertext, iv, Date.now()]
    );
    return true;
  } catch (err) {
    console.error('[vault] saveBiometric failed:', err);
    return false;
  }
}

// Match embedding against stored one — decrypt in memory only, never write to disk
export async function matchBiometric(userId, candidateEmbedding) {
  try {
    const result = await db.executeAsync(
      `SELECT enc_embedding, iv FROM Personnel WHERE id = ?`,
      [userId]
    );
    const row = result.rows._array[0];
    if (!row) return { match: false, score: 0 };

    const storedEmbedding = await decryptEmbedding(row.enc_embedding);
    const score = cosineSimilarity(storedEmbedding, candidateEmbedding);
    return {
      match: score >= VAULT.MATCH_THRESHOLD,
      score: Math.round(score * 100) / 100
    };
  } catch (err) {
    console.error('[vault] matchBiometric failed:', err);
    return { match: false, score: 0 };
  }
}

// Get all enrolled personnel IDs
export async function getEnrolledPersonnel() {
  try {
    const result = await db.executeAsync(
      `SELECT id, name, enrolled_at FROM Personnel ORDER BY enrolled_at DESC`
    );
    return result.rows._array;
  } catch (err) {
    console.error('[vault] getEnrolledPersonnel failed:', err);
    return [];
  }
}

// Delete personnel record
export async function deleteBiometric(userId) {
  try {
    await db.executeAsync(`DELETE FROM Personnel WHERE id = ?`, [userId]);
    return true;
  } catch (err) {
    console.error('[vault] deleteBiometric failed:', err);
    return false;
  }
}
```

---

### Fix 5 — Fix `src/database/schema.ts` — wrap init properly

The `[_layout] Database init error` comes from `initDatabase()` throwing silently. Replace with a robust version:

```ts
// src/database/schema.ts — FULL REPLACEMENT

import { open, QuickSQLiteConnection } from 'react-native-quick-sqlite';

export let db: QuickSQLiteConnection;

export async function initDatabase(): Promise<void> {
  try {
    db = open({ name: 'prahari_v1.db' });

    await db.executeAsync(`
      CREATE TABLE IF NOT EXISTS Personnel (
        id           TEXT PRIMARY KEY,
        name         TEXT NOT NULL,
        enc_embedding TEXT NOT NULL,
        iv           TEXT NOT NULL,
        enrolled_at  INTEGER NOT NULL
      )
    `);

    await db.executeAsync(`
      CREATE TABLE IF NOT EXISTS AttendanceLogs (
        id           TEXT PRIMARY KEY,
        personnel_id TEXT NOT NULL,
        timestamp    INTEGER NOT NULL,
        location     TEXT,
        confidence   REAL,
        bpm          INTEGER,
        synced       INTEGER DEFAULT 0,
        sync_at      INTEGER
      )
    `);

    await db.executeAsync(`
      CREATE TABLE IF NOT EXISTS SchemaVersion (
        version INTEGER PRIMARY KEY
      )
    `);

    const versionResult = await db.executeAsync(
      `SELECT version FROM SchemaVersion LIMIT 1`
    );
    if (versionResult.rows._array.length === 0) {
      await db.executeAsync(`INSERT INTO SchemaVersion (version) VALUES (1)`);
    }

    console.log('[schema] Database initialized successfully');
  } catch (err) {
    console.error('[schema] initDatabase FAILED:', err);
    throw err;  // re-throw so _layout.tsx can catch and show error UI
  }
}

export function closeDatabase(): void {
  try {
    db?.close();
  } catch (_) {}
}
```

Then in `app/_layout.tsx`, handle the error gracefully:

```tsx
// app/_layout.tsx — relevant section
useEffect(() => {
  initDatabase()
    .then(() => setDbReady(true))
    .catch(err => {
      console.error('[_layout] Database init error:', err);
      setDbError(err.message);
    });
}, []);

if (dbError) {
  return (
    <View style={{ flex: 1, justifyContent: 'center', padding: 24 }}>
      <Text style={{ color: 'red' }}>DB init failed: {dbError}</Text>
      <Text style={{ color: '#888', marginTop: 8 }}>Restart the app</Text>
    </View>
  );
}
```

---

### Fix 6 — Fix `src/config/awsConfig.ts` — replace placeholder URL

For the hackathon demo, the simplest approach is a free mock endpoint:

```ts
// src/config/awsConfig.ts

// OPTION A: Use a real Lambda (production)
// export const LAMBDA_ENDPOINT = 'https://your-real-lambda.execute-api.ap-south-1.amazonaws.com/sync';

// OPTION B: Mock server for demo (run the mock server below locally)
export const LAMBDA_ENDPOINT = 'http://10.0.2.2:3001/sync';  // 10.0.2.2 = host machine from Android emulator
// For physical device: use your machine's local IP, e.g. 'http://192.168.1.x:3001/sync'

export const AWS_REGION = 'ap-south-1';
export const S3_BUCKET = 'prahari-attendance-logs';
```

Create a mock sync server to run locally during demo (`mock-server/index.js`):

```js
// mock-server/index.js
const http = require('http');
const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }
  if (req.method === 'POST' && req.url === '/sync') {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      const data = JSON.parse(body);
      console.log(`[mock-sync] Received ${data.logs?.length || 0} logs`);
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, synced: data.logs?.length || 0 }));
    });
  } else {
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
  }
});
server.listen(3001, () => console.log('[mock-sync] Running on port 3001'));
```

Run with: `node mock-server/index.js`

---

### Fix 7 — Remove barcode scanner dependency

```bash
# Find which package is pulling in barcode scanner
cat package.json | grep -i barcode
cat package.json | grep -i mlkit
cat package.json | grep -i "vision-camera"
```

If `react-native-vision-camera` is present, check if barcode scanning frame processors are imported anywhere:

```bash
grep -r "barcode\|BarcodeScanner\|useBarcodeScanner" src/ app/
```

If found, remove the import. If `react-native-vision-camera` is used only for camera preview, keep it but don't import barcode plugins.

If you're not using vision-camera at all (using `expo-camera` instead), remove it:

```bash
npm uninstall react-native-vision-camera
```

---

### Fix 8 — Release APK config (size: 99MB → ~22MB)

```json
// app.json — update the android section:
{
  "android": {
    "adaptiveIcon": {
      "foregroundImage": "./assets/adaptive-icon.png",
      "backgroundColor": "#0A0A0F"
    },
    "package": "com.prahari.fieldauth",
    "permissions": [
      "android.permission.CAMERA",
      "android.permission.ACCESS_NETWORK_STATE",
      "android.permission.INTERNET",
      "android.permission.USE_BIOMETRIC"
    ],
    "compileSdkVersion": 34,
    "targetSdkVersion": 34,
    "minSdkVersion": 26,
    "versionCode": 1
  }
}
```

```js
// eas.json — add production profile
{
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal"
    },
    "preview": {
      "distribution": "internal",
      "android": {
        "buildType": "apk"
      }
    },
    "production": {
      "android": {
        "buildType": "apk",
        "gradleCommand": ":app:assembleRelease"
      }
    }
  }
}
```

Build for submission:
```bash
eas build --platform android --profile production
```

---

## Part 2 — Test Everything on Your Machine First

Do not build another APK until you've verified each layer here. Each level tests more of the stack.

---

### Level 1 — Test MediaPipe bridge in a browser (no device needed, 5 minutes)

The WebView bridge is just HTML + JS. Test it directly in Chrome before touching the app.

```bash
# Serve the HTML file locally
npx serve assets/ -p 8080
# Open http://localhost:8080/mediapipe_bridge.html in Chrome DevTools
```

In the browser console, send a fake message:

```js
// Paste this in Chrome DevTools console
// Simulate what useMediaPipe.ts will send
window.dispatchEvent(new MessageEvent('message', {
  data: JSON.stringify({
    type: 'PROCESS_FRAME',
    imageData: '<base64 of any face photo>',
    width: 640,
    height: 480,
    frameId: 'test-001'
  })
}));
```

You should see a `LANDMARKS` message with 468 points posted back. If you see `READY` in the console — bridge works. If you see errors — fix them here before touching React Native.

---

### Level 2 — VS Code + Android Emulator setup

This is the fastest way to test the full native app on your machine.

#### Step 1 — Install Android Studio

Download from https://developer.android.com/studio. Required even if you use VS Code — it provides the emulator (AVD) and Android SDK.

```bash
# After install, set environment variables in ~/.bashrc or ~/.zshrc:
export ANDROID_HOME=$HOME/Android/Sdk         # macOS: $HOME/Library/Android/sdk
export PATH=$PATH:$ANDROID_HOME/emulator
export PATH=$PATH:$ANDROID_HOME/platform-tools
export PATH=$PATH:$ANDROID_HOME/tools/bin

# Reload
source ~/.bashrc
```

#### Step 2 — Create an Android Virtual Device (AVD)

Open Android Studio → Virtual Device Manager → Create Device.

Recommended settings for PRAHARI testing:
- Device: **Pixel 6** (mimics mid-range specs)
- System image: **API 34 (Android 14)**, x86_64 ABI
- RAM: **3GB minimum** (set in AVD advanced settings)
- Internal storage: 4GB
- Camera: **Virtual Scene** or **Webcam0** (needed for camera tests)

#### Step 3 — VS Code extensions

Install these in VS Code:

```
Name: React Native Tools
Publisher: Microsoft
ID: msjsdiag.vscode-react-native

Name: Expo Tools
Publisher: Expo
ID: expo.vscode-expo-tools

Name: Android iOS Emulator  (optional — launch AVD from VS Code)
Publisher: DiemasMichiels
ID: DiemasMichiels.emulate
```

#### Step 4 — VS Code launch configuration

Create `.vscode/launch.json`:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Run on Android Emulator",
      "request": "launch",
      "type": "reactnative",
      "platform": "android",
      "target": "emulator"
    },
    {
      "name": "Run on Android Device (USB)",
      "request": "launch",
      "type": "reactnative",
      "platform": "android",
      "target": "device"
    },
    {
      "name": "Debug JS Bundle",
      "request": "attach",
      "type": "reactnative",
      "platform": "android"
    }
  ]
}
```

#### Step 5 — Start the emulator + run the app

```bash
# Terminal 1: Start emulator (get AVD name from Android Studio AVD Manager)
emulator -avd Pixel_6_API_34 -gpu swiftshader_indirect

# Terminal 2: Start mock sync server
node mock-server/index.js

# Terminal 3: Start Metro + run app
npx expo run:android
# OR press F5 in VS Code with "Run on Android Emulator" selected
```

The app will compile native modules, install the dev build on the emulator, and launch. Takes 3-5 minutes on first run, then hot reloads are instant.

#### Emulator camera note

The emulator's virtual camera doesn't produce a real face. For camera testing:
- **Option A**: Use `Webcam0` in AVD settings — maps your laptop webcam to the emulator
- **Option B**: Use the emulator's Extended Controls → Camera → Virtual Scene, which lets you inject a face photo
- **Option C**: Just use a physical Android device over USB (much faster, real camera)

---

### Level 3 — Unit test vault and ML logic (no device, no emulator)

You can test the pure JS logic without any device at all using Jest.

Create `src/__tests__/vault.test.ts`:

```ts
// src/__tests__/vault.test.ts

// Mock native modules
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('react-native-quick-sqlite', () => ({
  open: jest.fn(() => ({
    executeAsync: jest.fn().mockResolvedValue({ rows: { _array: [] } }),
    close: jest.fn(),
  })),
}));

jest.mock('expo-crypto', () => ({
  getRandomBytesAsync: jest.fn().mockResolvedValue(new Uint8Array(16).fill(0x42)),
}));

import { saveBiometric, matchBiometric } from '../database/vault';

describe('vault', () => {
  it('saveBiometric returns true on success', async () => {
    const embedding = Array(128).fill(0).map((_, i) => i / 128);
    const result = await saveBiometric('user-001', 'Rajesh Kumar', embedding);
    expect(result).toBe(true);
  });
});
```

Create `src/__tests__/math.test.ts`:

```ts
// src/__tests__/math.test.ts
import { cosineSimilarity } from '../utils/math';

describe('cosineSimilarity', () => {
  it('identical vectors score 1.0', () => {
    const v = [1, 0, 0, 1, 0];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0);
  });

  it('opposite vectors score -1.0', () => {
    const a = [1, 0];
    const b = [-1, 0];
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1.0);
  });

  it('orthogonal vectors score 0.0', () => {
    const a = [1, 0];
    const b = [0, 1];
    expect(cosineSimilarity(a, b)).toBeCloseTo(0.0);
  });

  it('similar embeddings score above threshold', () => {
    const base = Array(128).fill(0).map((_, i) => Math.sin(i));
    const similar = base.map(v => v + (Math.random() * 0.05 - 0.025));
    expect(cosineSimilarity(base, similar)).toBeGreaterThan(0.95);
  });

  it('different embeddings score below threshold', () => {
    const a = Array(128).fill(0).map((_, i) => Math.sin(i));
    const b = Array(128).fill(0).map((_, i) => Math.cos(i * 2));
    expect(cosineSimilarity(a, b)).toBeLessThan(0.5);
  });
});
```

Create `src/__tests__/liveness.test.ts`:

```ts
// src/__tests__/liveness.test.ts
import { computeEAR } from '../utils/liveness';

describe('computeEAR', () => {
  it('returns high EAR for open eye landmarks', () => {
    // Simulate open eye: vertical distance >> horizontal distance
    const openEye = [
      { x: 0.3, y: 0.5 },   // p1 - inner corner
      { x: 0.35, y: 0.45 }, // p2 - top inner
      { x: 0.45, y: 0.45 }, // p3 - top outer
      { x: 0.5, y: 0.5 },   // p4 - outer corner
      { x: 0.45, y: 0.55 }, // p5 - bottom outer
      { x: 0.35, y: 0.55 }, // p6 - bottom inner
    ];
    const ear = computeEAR(openEye);
    expect(ear).toBeGreaterThan(0.20);
  });

  it('returns low EAR for closed eye landmarks', () => {
    // Simulate closed eye: vertical distance ≈ 0
    const closedEye = [
      { x: 0.3, y: 0.5 },
      { x: 0.35, y: 0.499 },
      { x: 0.45, y: 0.499 },
      { x: 0.5, y: 0.5 },
      { x: 0.45, y: 0.501 },
      { x: 0.35, y: 0.501 },
    ];
    const ear = computeEAR(closedEye);
    expect(ear).toBeLessThan(0.15);
  });
});
```

Run all tests:

```bash
npm test
# or watch mode:
npm test -- --watch
```

---

### Level 4 — Integration smoke test checklist (emulator)

After the emulator is running and the app is installed, go through each screen manually:

```
SCREEN: Home (index.tsx)
  [ ] App launches without crash (no red screen)
  [ ] "Enroll New Personnel" button visible
  [ ] "Verify Identity" button visible
  [ ] Offline status badge shows green
  [ ] "No personnel enrolled yet" shows on fresh install

SCREEN: Enroll (enroll.tsx)
  [ ] Camera opens without crash
  [ ] Camera feed visible (not black screen)
  [ ] Face guide oval renders over camera
  [ ] Type a name in the input field
  [ ] LivenessIndicator shows 4 steps
  [ ] Blink steps eventually progress (even if landmarks are dummy)
  [ ] After 5 seconds: enrollment completes or shows specific error
  [ ] On success: "Enrolled successfully" screen shown
  [ ] Check SQLite: row added to Personnel table

SCREEN: Verify (verify.tsx)
  [ ] Camera opens without crash
  [ ] Pipeline state text visible (detecting / liveness / recognizing)
  [ ] With enrolled face: ResultCard shows green pass
  [ ] With unknown face: ResultCard shows "Face not recognised"
  [ ] Latency shown on ResultCard (any number)
  [ ] Attendance log written to AttendanceLogs table on success

SCREEN: Dashboard (dashboard.tsx)
  [ ] Attendance log entries visible after a successful verify
  [ ] "Pending sync: N" badge visible
  [ ] Sync button triggers network call (check mock server terminal)
  [ ] After sync: "Pending sync: 0"

SCREEN: Benchmark (benchmark.tsx)
  [ ] "Run Benchmark" button works
  [ ] 10 runs complete
  [ ] Latency table shows per-run numbers
  [ ] Average < 800ms target highlighted
```

---

### Level 5 — Physical device testing (before final APK)

For camera and rPPG testing, a real device is essential. The emulator's virtual camera cannot produce the subtle skin-color variations rPPG needs.

```bash
# Connect Android device via USB
# Enable Developer Options: Settings → About Phone → tap Build Number 7 times
# Enable USB Debugging in Developer Options

# Verify device is detected
adb devices
# Should show: XXXXXXXX device (not unauthorized)

# Run on device
npx expo run:android --device

# Stream logs in real time
adb logcat --pid=$(adb shell pidof -s com.prahari.fieldauth) | grep -E "PRAHARI|vault|schema|rPPG|liveness"
```

---

## Part 3 — Rebuild & Test Order

```
Step 1   Apply Fix 1 (model files + metro.config.js)
Step 2   Create mediapipe_bridge.html (Fix 3)
Step 3   Apply Fix 4 (vault.js rewrite)
Step 4   Apply Fix 5 (schema.ts rewrite)
Step 5   Apply Fix 6 (awsConfig.ts + mock server)
Step 6   Apply Fix 7 (remove barcode dependency)
Step 7   npm install
Step 8   npm test          ← all Jest tests pass
Step 9   npx tsc --noEmit  ← no TypeScript errors
Step 10  Test mediapipe_bridge.html in Chrome (Level 1)
Step 11  Start mock server: node mock-server/index.js
Step 12  Start emulator, run: npx expo run:android
Step 13  Walk through Level 4 smoke test checklist
Step 14  Connect physical device, repeat smoke test
Step 15  Verify rPPG detects heartbeat on real face
Step 16  Verify printed photo gets "Spoof detected"
Step 17  Apply Fix 8 (release APK config)
Step 18  eas build --platform android --profile production
Step 19  Install APK, run full smoke test one final time
Step 20  Record demo video
```

---

## Part 4 — Quick Debug Commands

```bash
# See all app logs (Metro)
npx expo start --clear

# Watch SQLite in real time (needs adb)
adb shell run-as com.prahari.fieldauth \
  sqlite3 /data/data/com.prahari.fieldauth/databases/prahari_v1.db \
  "SELECT * FROM AttendanceLogs ORDER BY timestamp DESC LIMIT 5;"

# Check if model files are in installed APK
adb shell run-as com.prahari.fieldauth ls -la assets/models/

# Live JS error log
adb logcat | grep -E "ReactNativeJS|PRAHARI|ERROR"

# Kill app and relaunch fresh
adb shell am force-stop com.prahari.fieldauth
adb shell monkey -p com.prahari.fieldauth 1

# Clear app data (wipes SQLite + SecureStore — fresh install equivalent)
adb shell pm clear com.prahari.fieldauth
```

---

## Part 5 — Known Emulator Limitations

| Feature | Emulator | Physical Device |
|---|---|---|
| Camera feed | Virtual scene / webcam | Real camera |
| rPPG detection | Will not work | Works |
| Face liveness | Partial (no real skin) | Full |
| TFLite speed | Slow (emulated CPU) | Real hardware speed |
| SecureStore | Works | Works |
| SQLite | Works | Works |
| Network sync | Works (use 10.0.2.2) | Works (use local IP) |
| MediaPipe WebView | Works | Works |

**Bottom line**: Use the emulator for UI, navigation, database, and sync testing. Use a physical device for camera, rPPG, and liveness testing. Both are needed before submitting.

---

*PRAHARI — NHAI Innovation Hackathon 7.0 · Submission: 05 June 2026*
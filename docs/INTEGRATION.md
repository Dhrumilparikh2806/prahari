# PRAHARI — Integration Guide for Datalake 3.0 Developers

This guide explains how to add PRAHARI's offline biometric attendance stack to an existing Expo 50 project, or how to integrate individual modules into Datalake 3.0. Read this alongside `TECHNICAL.md` for algorithm details.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Package Dependencies](#2-package-dependencies)
3. [Module Aliases (Babel + TypeScript)](#3-module-aliases-babel--typescript)
4. [Database Initialisation in App Layout](#4-database-initialisation-in-app-layout)
5. [Using useCameraPipeline for Enrollment](#5-using-usecamerapipeline-for-enrollment)
6. [Using useCameraPipeline for Verification](#6-using-usecamerapipeline-for-verification)
7. [Configuring AWS Sync](#7-configuring-aws-sync)
8. [Permission Setup in app.json](#8-permission-setup-in-appjson)
9. [Troubleshooting](#9-troubleshooting)

---

## 1. Prerequisites

- Expo SDK 50 (`expo@~50.0.0`)
- React Native 0.73
- Node 18+ and npm 9+
- An Expo dev build (Expo Go is not supported — `react-native-webview` requires a native build)
- For Android: Android SDK with minSdkVersion 26+
- For iOS: Xcode 15+, deployment target iOS 14+

---

## 2. Package Dependencies

Add the following to your `package.json` dependencies. These are the exact versions tested with Expo 50:

```json
{
  "dependencies": {
    "@mediapipe/tasks-vision": "^0.10.0",
    "@react-native-community/netinfo": "11.1.0",
    "aws-sdk": "^2.1550.0",
    "expo-asset": "~9.0.2",
    "expo-camera": "~14.0.6",
    "expo-crypto": "~12.8.1",
    "expo-file-system": "~16.0.8",
    "expo-image-manipulator": "~11.8.0",
    "expo-secure-store": "~12.8.1",
    "expo-sqlite": "~13.2.0",
    "react-native-gesture-handler": "~2.14.0",
    "react-native-reanimated": "~3.6.0",
    "react-native-webview": "13.6.4",
    "zustand": "^4.5.0"
  },
  "devDependencies": {
    "babel-plugin-module-resolver": "^5.0.0"
  }
}
```

Install with:

```bash
npm install
```

### Do NOT add these packages

These packages were evaluated but do not work with Expo 50 EAS builds and must be avoided:

- `react-native-fast-tflite` — C++ NDK compilation fails on EAS for Expo 50 managed workflow.
- `react-native-quick-sqlite` — Replaced by `expo-sqlite` v13 which has the same async transaction API.
- `expo-crypto` used for AES-256 directly — the XOR cipher in `vault.js` uses `expo-crypto` only for random byte generation.

---

## 3. Module Aliases (Babel + TypeScript)

PRAHARI uses module aliases to avoid relative import paths. Add these to both config files.

### babel.config.js

```javascript
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      [
        'module-resolver',
        {
          root: ['./'],
          alias: {
            '@hooks':      './src/hooks',
            '@utils':      './src/utils',
            '@services':   './src/services',
            '@components': './src/components',
            '@config':     './src/config',
            '@database':   './src/database',
          },
        },
      ],
      // react-native-reanimated/plugin MUST be the last plugin
      'react-native-reanimated/plugin',
    ],
  };
};
```

### tsconfig.json

```json
{
  "extends": "expo/tsconfig.base",
  "compilerOptions": {
    "strict": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "baseUrl": ".",
    "paths": {
      "@hooks/*":      ["src/hooks/*"],
      "@utils/*":      ["src/utils/*"],
      "@services/*":   ["src/services/*"],
      "@components/*": ["src/components/*"],
      "@config/*":     ["src/config/*"],
      "@database/*":   ["src/database/*"]
    },
    "skipLibCheck": true,
    "esModuleInterop": true
  },
  "include": ["**/*.ts", "**/*.tsx"],
  "exclude": ["node_modules", "dist", "build", ".expo"]
}
```

### metro.config.js

Add `.task` and `.html` to the Metro asset extensions so the MediaPipe model bundle and bridge HTML are bundled correctly:

```javascript
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Allow Metro to bundle .task (MediaPipe model) and .html (WebView bridge)
config.resolver.assetExts.push('task', 'html');

module.exports = config;
```

---

## 4. Database Initialisation in App Layout

`initDatabase()` must be called and awaited exactly once, before any screen renders. The recommended location is `app/_layout.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { View, ActivityIndicator, Text } from 'react-native';
import { Stack } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';
import { initDatabase } from '@database/schema';
import { startNetworkMonitor } from '@services/networkMonitor';

export default function RootLayout() {
  const [dbReady, setDbReady] = useState(false);
  const [dbError, setDbError] = useState<string | null>(null);

  useEffect(() => {
    let stopMonitor: (() => void) | null = null;

    initDatabase()
      .then(() => {
        setDbReady(true);
        // Start background network listener — fires syncPendingLogs()
        // automatically when the device goes from offline to online.
        stopMonitor = startNetworkMonitor();
      })
      .catch((err: unknown) => {
        setDbError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      if (stopMonitor) stopMonitor();
    };
  }, []);

  if (dbError) {
    return (
      <GestureHandlerRootView style={{ flex: 1 }}>
        <Text style={{ color: 'red', padding: 32 }}>DB Error: {dbError}</Text>
      </GestureHandlerRootView>
    );
  }

  if (!dbReady) {
    return (
      <GestureHandlerRootView style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" />
      </GestureHandlerRootView>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false }} />
    </GestureHandlerRootView>
  );
}
```

### What initDatabase() does

Creates three tables if they do not exist (`Personnel`, `AttendanceLogs`, `SchemaVersion`) and stamps schema version 1. It is idempotent — safe to call on every cold start.

---

## 5. Using useCameraPipeline for Enrollment

The pipeline hook requires two sub-hooks to be instantiated in the same component. Both are provided to `useCameraPipeline` as props.

### Complete Enrollment Screen

```tsx
import React, { useRef, useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Camera, CameraType } from 'expo-camera';
import WebView from 'react-native-webview';

import { useMediaPipe }       from '@hooks/useMediaPipe';
import { useFaceRecognition } from '@hooks/useFaceRecognition';
import { useCameraPipeline }  from '@hooks/useCameraPipeline';

export default function EnrollScreen() {
  const [permission, requestPermission] = Camera.useCameraPermissions();
  const cameraRef = useRef<Camera>(null);
  const frameTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Step 1: Instantiate sub-hooks
  const mediaPipe      = useMediaPipe();
  const faceRecognition = useFaceRecognition();

  // Step 2: Create the pipeline, passing sub-hooks as dependencies
  const pipeline = useCameraPipeline({ mediaPipe, faceRecognition });

  useEffect(() => {
    if (!permission?.granted) requestPermission();
  }, []);

  // Step 3: Watch for pipeline completion
  useEffect(() => {
    if (pipeline.phase === 'done') {
      stopCapture();
      if (pipeline.result?.passed) {
        console.log('Enrolled successfully:', pipeline.result.name);
      } else {
        console.warn('Enrolment failed:', pipeline.result?.failureReason);
      }
    }
  }, [pipeline.phase]);

  // Step 4: Start enrollment for a named person
  const startEnrollment = (name: string) => {
    // Optionally pass a pre-generated UUID as the second argument.
    // If omitted, a UUID is generated automatically.
    pipeline.startEnrollment(name);

    // Step 5: Feed frames into the pipeline at ~5 fps
    frameTimerRef.current = setInterval(async () => {
      if (!cameraRef.current) return;
      try {
        const photo = await cameraRef.current.takePictureAsync({
          base64: true,
          quality: 0.5,       // lower quality = smaller JPEG = faster bridge
        });
        if (photo.base64) {
          await pipeline.submitFrame(`data:image/jpeg;base64,${photo.base64}`);
        }
      } catch {
        // Per-frame errors are expected (focus, motion) — ignore and continue
      }
    }, 200);  // 200 ms interval = ~5 fps
  };

  const stopCapture = () => {
    if (frameTimerRef.current) {
      clearInterval(frameTimerRef.current);
      frameTimerRef.current = null;
    }
  };

  // Step 6: Render the hidden WebView alongside the camera
  return (
    <View style={{ flex: 1 }}>
      {permission?.granted && (
        <Camera ref={cameraRef} style={StyleSheet.absoluteFill} type={CameraType.front} />
      )}

      {/* Hidden WebView for MediaPipe — must be rendered even when not visible */}
      {mediaPipe.htmlUri && (
        <WebView
          ref={mediaPipe.webViewRef}
          source={{ uri: mediaPipe.htmlUri }}
          style={{ width: 1, height: 1, opacity: 0, position: 'absolute' }}
          onMessage={mediaPipe.onMessage}
          javaScriptEnabled
          originWhitelist={['*']}
          allowFileAccess={true}
          allowFileAccessFromFileURLs={true}
          allowUniversalAccessFromFileURLs={true}
          mixedContentMode="always"
          cacheEnabled={true}
          cacheMode="LOAD_CACHE_ELSE_NETWORK"
        />
      )}

      {/* Step 7: Display live feedback from the pipeline */}
      <View style={{ position: 'absolute', bottom: 40, left: 0, right: 0, alignItems: 'center' }}>
        <Text style={{ color: '#fff', fontSize: 16 }}>
          Phase: {pipeline.phase}
        </Text>
        <Text style={{ color: '#fff' }}>
          Blinks: {pipeline.blinkCount} / 2
        </Text>
        <Text style={{ color: '#fff' }}>
          Head in frame: {pipeline.headInFrame ? 'YES' : 'NO'}
        </Text>
        <Text style={{ color: '#fff' }}>
          BPM: {pipeline.currentBpm || 'reading...'}
        </Text>
        <Text style={{ color: '#fff' }}>
          Liveness: {pipeline.geometricScore.toFixed(2)} geo /
                    {pipeline.rPPGConfidence.toFixed(2)} rPPG
        </Text>
        {pipeline.result && (
          <Text style={{ color: pipeline.result.passed ? '#0f0' : '#f00', fontSize: 18 }}>
            {pipeline.result.passed
              ? `Enrolled: ${pipeline.result.name} (${pipeline.result.latencyMs} ms)`
              : `Failed: ${pipeline.result.failureReason}`}
          </Text>
        )}
      </View>
    </View>
  );
}
```

### Pipeline States During Enrollment

| `pipeline.phase` | Meaning |
|-----------------|---------|
| `'idle'` | Not started |
| `'detecting'` | Sending frame to MediaPipe, waiting for landmarks |
| `'liveness'` | Collecting geometric + rPPG data; not enough frames yet |
| `'recognizing'` | Liveness passed; generating and saving embedding |
| `'done'` | Complete; check `pipeline.result` |

### Resetting Between Sessions

Call `pipeline.reset()` to clear all state (blink history, rPPG buffer, embedding queue) and return to `'idle'`. Always call this before starting a new enrollment or verification session on the same screen instance.

---

## 6. Using useCameraPipeline for Verification

Verification requires the enrolled person's UUID and optionally their display name. Retrieve the UUID list from the vault before starting:

```tsx
import { getEnrolledPersonnel } from '@database/vault';

// In your component:
const [personnel, setPersonnel] = useState<{ id: string; name: string }[]>([]);

useEffect(() => {
  getEnrolledPersonnel().then(setPersonnel);
}, []);
```

### Starting Verification

```tsx
// Select a person from the list (e.g., via a FlatList)
const [selectedId, setSelectedId] = useState<string>('');
const [selectedName, setSelectedName] = useState<string>('');

// Start verification — pass both id and name
// The name is used for display in ResultCard only; matching uses the id.
const handleStartVerification = () => {
  pipeline.startVerification(selectedId, selectedName);
  // Then start the frame capture interval (same as enrollment)
};
```

### Handling the Result

```tsx
useEffect(() => {
  if (pipeline.phase !== 'done' || !pipeline.result) return;

  stopCapture();

  if (pipeline.result.passed) {
    // Attendance has already been logged automatically via logAttendance()
    // inside useCameraPipeline.handleVerification()
    console.log('Verified:', {
      name:       pipeline.result.name,
      score:      pipeline.result.confidence,
      bpm:        pipeline.result.bpm,
      latencyMs:  pipeline.result.latencyMs,
    });
  } else {
    console.log('Not verified:', pipeline.result.failureReason);
    // score < 0.30 -> "Face not recognised — try enrolling again"
    // score >= 0.30 but < threshold -> "Confidence below threshold"
  }
}, [pipeline.phase]);
```

### PipelineResult Shape

```typescript
interface PipelineResult {
  passed:        boolean;
  name?:         string;    // display name passed to startVerification()
  bpm?:          number;    // detected BPM (0 if rPPG not ready)
  confidence?:   number;    // cosine similarity score [0, 1]
  latencyMs?:    number;    // wall time from startVerification() to done
  failureReason?: string;   // human-readable if passed = false
}
```

---

## 7. Configuring AWS Sync

### Lambda Endpoint

Edit `src/config/constants.ts` and replace the placeholder with your deployed Lambda URL:

```typescript
export const SYNC = {
  S3_BUCKET:       'your-attendance-logs-bucket',
  LAMBDA_ENDPOINT: 'https://abc123.execute-api.ap-south-1.amazonaws.com/prod/sync',
  REGION:          'ap-south-1',
  TIMEOUT_MS:      30000,
} as const;
```

Also update `src/config/awsConfig.ts` if it contains additional endpoint or region configuration.

### Expected Lambda Contract

The Lambda receives a `POST` with `Content-Type: application/json`:

```json
{
  "bucket": "your-attendance-logs-bucket",
  "key": "prahari/logs/<device-id>/<timestamp>.json",
  "region": "ap-south-1"
}
```

The Lambda must return `HTTP 200` with:

```json
{
  "url": "https://your-attendance-logs-bucket.s3.ap-south-1.amazonaws.com/prahari/logs/...?X-Amz-Signature=..."
}
```

The `url` is a pre-signed S3 PUT URL. The app will PUT the encrypted log payload directly to S3 using this URL.

### Lambda Implementation Reference

```javascript
// handler.js (Node.js 18)
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const s3 = new S3Client({ region: process.env.REGION || 'ap-south-1' });

exports.handler = async (event) => {
  const body = JSON.parse(event.body || '{}');
  const { bucket, key, region } = body;

  // Add your device authorisation logic here
  // e.g., validate a device token from event.headers

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: 'application/octet-stream',
  });

  const url = await getSignedUrl(s3, command, { expiresIn: 60 });

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  };
};
```

### Local Development (Mock Server)

A local mock server is provided at `mock-server/index.js` for development without deploying AWS:

```bash
node mock-server/index.js
# Starts on http://localhost:3000
```

Point the app at the mock server by setting `LAMBDA_ENDPOINT` to your machine's local network address:

```typescript
LAMBDA_ENDPOINT: 'http://192.168.1.x:3000/sync',  // replace with your LAN IP
```

### Manual Sync Trigger

You can trigger a sync from any screen using `forceSyncNow()`:

```typescript
import { forceSyncNow } from '@services/networkMonitor';

const handleSyncPress = async () => {
  const { synced, failed } = await forceSyncNow();
  console.log(`Synced: ${synced}, Failed: ${failed}`);
};
```

---

## 8. Permission Setup in app.json

### Android Permissions

```json
{
  "expo": {
    "android": {
      "permissions": [
        "android.permission.CAMERA",
        "android.permission.RECORD_AUDIO",
        "android.permission.ACCESS_NETWORK_STATE",
        "android.permission.INTERNET",
        "android.permission.USE_BIOMETRIC"
      ]
    },
    "plugins": [
      [
        "expo-camera",
        {
          "cameraPermission": "PRAHARI needs camera access for face recognition and liveness detection."
        }
      ],
      "expo-secure-store",
      [
        "expo-build-properties",
        {
          "android": {
            "compileSdkVersion": 34,
            "targetSdkVersion": 34,
            "minSdkVersion": 26,
            "kotlinVersion": "1.8.0"
          }
        }
      ]
    ]
  }
}
```

`RECORD_AUDIO` is declared because expo-camera requires it on some Android versions even when audio recording is not used.

### iOS Info.plist Keys

```json
{
  "expo": {
    "ios": {
      "infoPlist": {
        "NSCameraUsageDescription": "PRAHARI needs camera access for face recognition and liveness detection.",
        "NSFaceIDUsageDescription": "PRAHARI uses Face ID for secure biometric vault access.",
        "NSMicrophoneUsageDescription": "PRAHARI may use audio for liveness detection.",
        "NSPhotoLibraryUsageDescription": "PRAHARI needs photo library access for enrollment testing."
      }
    }
  }
}
```

All four keys are required. The App Store review process rejects apps that use camera without a usage description.

### Runtime Permission Request

The permission request is handled by the expo-camera hook:

```tsx
import { Camera } from 'expo-camera';

const [permission, requestPermission] = Camera.useCameraPermissions();

useEffect(() => {
  if (!permission?.granted) requestPermission();
}, []);
```

Do not render the `<Camera>` component before `permission.granted` is true.

---

## 9. Troubleshooting

### MediaPipe WebView never becomes ready

**Symptom:** `mediaPipe.ready` stays `false`. `mediaPipe.loading` stays `true` indefinitely.

**Causes and fixes:**

| Cause | Fix |
|-------|-----|
| No internet on first launch | Connect to WiFi. The WASM must be downloaded once (~21 MB). |
| WebView `htmlUri` is null | Check that `assets/mediapipe_bridge.html` exists and Metro includes `.html` files in `assetExts`. |
| WebView network blocked by firewall | Allow outbound HTTPS to `cdn.jsdelivr.net` and `storage.googleapis.com`. |
| Simulator/emulator | WebView on iOS Simulator may not cache correctly. Always test on a physical device. |

### "No face landmarks detected" on every frame

**Symptom:** `mediaPipe.processFrame()` consistently returns `null`.

**Fixes:**
1. Ensure the face fills at least 20% of the frame area.
2. Improve lighting — the face must be evenly lit, avoid strong backlight.
3. Check that the front camera is selected (`type={CameraType.front}`).
4. Increase photo quality in `takePictureAsync` temporarily to `quality: 0.8` for diagnosis.

### Liveness gate never opens

**Symptom:** `pipeline.phase` cycles between `'detecting'` and `'liveness'` but never reaches `'recognizing'`.

**Geometric not passing (geometricScore < 0.7):**
- Score 0.3: only eyes open — look more directly at camera, blink more.
- Score 0.4: only head in frame — no blinks detected yet. Blink naturally twice within 5 s.
- Score 0.7: both eyes and head — rPPG is blocking; see below.

**rPPG not passing (rPPGConfidence < 0.5):**
- Move closer to the camera (cheek landmarks need to fill at least 40 pixels).
- Improve lighting — bright, even, natural or LED white.
- Hold still for at least 5 seconds without speaking or moving.
- Ensure no strong IR or coloured ambient light (flickers at 50/60 Hz look like an invalid heartbeat).

### "Face not recognised" after enrollment

**Symptom:** Verification fails with score < 0.85.

**Causes:**
- Enrollment and verification performed under different lighting conditions.
- Face angle changed significantly between enrollment and verification.
- Only one or two enrollment frames were captured (check `RECOGNITION.ENROLLMENT_FRAMES = 5`).

**Fix:** Delete the enrolled record and re-enroll under consistent lighting conditions with the face looking straight at the camera.

### Database error on startup

**Symptom:** App shows "Database Error" screen on launch.

**Fixes:**
1. Clear app data in device Settings -> Apps -> PRAHARI -> Storage -> Clear Data.
2. If the error recurs, check available device storage (SQLite cannot create the database file on a full disk).
3. On development builds, you can call `resetDatabase('DESTROY_ALL_DATA')` from a test screen.

### Sync fails silently

**Symptom:** Attendance logs accumulate with `synced = 0` and never upload.

**Diagnosis:**
```typescript
import { forceSyncNow } from '@services/networkMonitor';

// Call this from a button and log the result
const result = await forceSyncNow();
console.log(result);  // { synced: 0, failed: N }
```

**Causes:**
- `SYNC.LAMBDA_ENDPOINT` is still set to `'https://YOUR_LAMBDA_URL/sync'` (placeholder).
- Lambda is not deployed or the URL is incorrect.
- The device firewall blocks outbound HTTPS to the Lambda or S3 endpoint.
- The S3 bucket does not allow PUT from the pre-signed URL (check bucket policy).

### Metro bundler crash on `.task` file

**Symptom:** Metro throws "unknown extension .task" or similar.

**Fix:** Add `.task` to `assetExts` in `metro.config.js`:

```javascript
config.resolver.assetExts.push('task', 'html');
```

Then clear the Metro cache:

```bash
npx expo start --clear
```

### TypeScript: "Cannot find module '@hooks/...'"

**Symptom:** TS errors on all `@hooks`, `@utils`, etc. imports.

**Fix:** Verify both `babel.config.js` (module-resolver plugin) and `tsconfig.json` (paths) have matching aliases. Both files must be updated — Babel handles runtime resolution, TypeScript handles compile-time type checking.

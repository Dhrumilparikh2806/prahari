# PRAHARI — System Architecture

## Component Map

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  PRAHARI — Offline Biometric Attendance System                             │
│  React Native 0.73 · Expo 50 · TypeScript · expo-router                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   ┌───────────────────────────────────────────────────────────────────┐    │
│   │  SCREENS (app/)                                                   │    │
│   │  index · enroll · verify · dashboard · benchmark                 │    │
│   └──────────────────────────┬────────────────────────────────────────┘    │
│                              │ uses                                         │
│   ┌──────────────────────────▼────────────────────────────────────────┐    │
│   │  PIPELINE ORCHESTRATOR — useCameraPipeline.ts                    │    │
│   │  phase: idle → detecting → liveness → recognizing → done         │    │
│   └──┬─────────────┬─────────────────┬─────────────────────────────┘      │
│      │             │                 │                                      │
│      ▼             ▼                 ▼                                      │
│  ┌─────────┐ ┌──────────────┐ ┌──────────────────────────────────────┐    │
│  │MediaPipe│ │  Geometric   │ │  rPPG Heartbeat                     │    │
│  │WebView  │ │  Liveness +  │ │  useRemotePhotoplethysmography.ts   │    │
│  │Bridge   │ │  Challenge   │ │  Goertzel · cheek ROI · 60–120 BPM  │    │
│  │468-point│ │  useGeometric│ └──────────────────────────────────────┘    │
│  │landmarks│ │  Liveness.ts │                                              │
│  │         │ │  useLiveness │                                              │
│  │         │ │  Challenge.ts│                                              │
│  └────┬────┘ └──────┬───────┘                                             │
│       └─────────────┘                                                      │
│              │                                                              │
│              ▼                                                              │
│   ┌──────────────────────────┐                                             │
│   │  Face Recognition        │                                             │
│   │  useFaceRecognition.ts   │                                             │
│   │  128-dim landmark vector │                                             │
│   │  IOD-normalised · L2-norm│                                             │
│   └────────────┬─────────────┘                                             │
│                │                                                            │
│                ▼                                                            │
│   ┌─────────────────────────────────────────────────────────────────────┐  │
│   │  ZERO-KNOWLEDGE VAULT (src/database/)                              │  │
│   │  vault.js · schema.ts · attendance.ts                              │  │
│   │  XOR encryption · expo-secure-store key · SQLite persistence       │  │
│   └─────────────────────────┬───────────────────────────────────────────┘  │
│                             │ on reconnect                                  │
│                             ▼                                               │
│   ┌─────────────────────────────────────────────────────────────────────┐  │
│   │  OFFLINE SYNC (src/services/)                                      │  │
│   │  networkMonitor.ts → syncService.ts → Lambda → AWS S3             │  │
│   └─────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Enrollment Data Flow

```
User types name
      │
      ▼
Camera frame (200ms interval)
      │ base64 JPEG
      ▼
useMediaPipe → WebView → MediaPipe WASM → 468 landmarks
      │
      ├──▶ useGeometricLiveness  (EAR blink + head pose + smile)
      │        │
      │        ▼
      │    useLivenessChallenge  (random: blink / smile / turn)
      │
      ├──▶ useRemotePhotoplethysmography  (cheek RGB → Goertzel → BPM)
      │
      │    [all 4 gates pass]
      │
      ▼
useFaceRecognition → 128-dim embedding (×5 frames, averaged)
      │
      ▼
vault.saveBiometric(id, name, averaged_embedding)
  XOR-encrypt → SQLite Personnel table
```

## Verification Data Flow

```
Select personnel → startVerification(id, name)
      │
      ▼
[same pipeline — MediaPipe → liveness → challenge → rPPG]
      │ live 128-dim embedding
      ▼
vault.matchBiometric(id, live_embedding)
  decrypt stored → cosine_similarity → threshold 0.85
      │ match = true
      ▼
logAttendance(id, score, bpm) → SQLite (synced=0)
      │ (on network reconnect)
      ▼
syncService → encrypt batch → Lambda → S3 PUT
  markSynced → purgeSyncedLogs
```

---

## Security Threat Model

| Threat | Layer that catches it | Mechanism |
|---|---|---|
| Static photo | Geometric liveness | No blink → score < 0.7 |
| Screen video replay | rPPG | 60 Hz flicker outside 60–120 BPM band |
| Pre-recorded video | Challenge-response | Random prompt unpredictable |
| Silicone mask | rPPG | Blocks cheek microvascular signal |
| Stolen SQLite DB | Vault | XOR ciphertext only; key in hardware SE |
| Embedding dictionary | Vault | Threshold 0.85 + SecureStore key required |

---

## Module Dependency Tree

```
app/enroll.tsx  app/verify.tsx
        │               │
        └───────┬────────┘
                │
        useCameraPipeline.ts
                │
    ┌───────────┼────────────────────┐
    │           │                    │
useMediaPipe  useGeometricLiveness  useRemotePhotoplethysmography
              useLivenessChallenge
    │           │
    └───────────┘
                │
        useFaceRecognition
                │
        vault.js · attendance.ts · schema.ts
                │
        syncService.ts · networkMonitor.ts
```

---

## File Map

```
prahari-master/
├── app/
│   ├── _layout.tsx          DB init, network monitor start
│   ├── index.tsx            Home dashboard (stats + offline badge)
│   ├── enroll.tsx           Enrollment flow
│   ├── verify.tsx           Verification flow
│   ├── dashboard.tsx        Attendance log viewer
│   └── benchmark.tsx        Pipeline latency benchmark
│
├── src/
│   ├── hooks/
│   │   ├── useCameraPipeline.ts           Master pipeline orchestrator
│   │   ├── useMediaPipe.ts                WebView bridge (468 landmarks)
│   │   ├── useFaceRecognition.ts          128-dim landmark embedding
│   │   ├── useGeometricLiveness.ts        EAR + head pose + smile
│   │   ├── useLivenessChallenge.ts        Challenge-response system
│   │   └── useRemotePhotoplethysmography.ts  rPPG heartbeat
│   │
│   ├── services/
│   │   ├── syncService.ts                 S3 batch upload
│   │   └── networkMonitor.ts              NetInfo → sync trigger
│   │
│   ├── database/
│   │   ├── schema.ts                      SQLite init (Personnel + AttendanceLogs)
│   │   ├── vault.js                       Encrypted embedding CRUD
│   │   └── attendance.ts                  Log CRUD + pending count
│   │
│   ├── components/
│   │   ├── CameraOverlay.tsx              Face guide oval + instruction
│   │   ├── LivenessIndicator.tsx          Challenge banner + step tracker
│   │   ├── HeartbeatPulse.tsx             rPPG BPM display
│   │   └── ResultCard.tsx                 Pass/fail result screen
│   │
│   ├── config/
│   │   ├── constants.ts                   All ML thresholds + UI settings
│   │   └── awsConfig.ts                   S3 bucket + Lambda endpoint
│   │
│   └── utils/
│       ├── imageProcessing.ts             Frame pre-processing + embedding helpers
│       ├── math.js                        Cosine similarity
│       ├── liveness.js                    EAR helpers
│       └── rPPG.js                        Signal processing stubs
│
├── assets/
│   ├── mediapipe_bridge.html              WebView WASM host
│   └── models/                            Model files (download separately)
│
├── mock-server/
│   └── index.js                           Local S3 sync endpoint (dev)
│
└── docs/
    ├── TECHNICAL.md                       Full technical reference
    ├── INTEGRATION.md                     Datalake 3.0 integration guide
    └── ARCHITECTURE.md                    This file
```

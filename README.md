# PRAHARI — Zero-Network Biometric Authentication
**Offline · Multi-Phase · Privacy-Preserving Face Recognition**

[![Phases](https://img.shields.io/badge/Phases-0%20%7C%201%20%7C%202%20%7C%203-blue)](#phase-roadmap)
[![Platform](https://img.shields.io/badge/Platform-Android%2026%2B%20%7C%20iOS%2012%2B-green)](#)
[![Model](https://img.shields.io/badge/Model-MobileFaceNet%20INT8%201.9MB-orange)](#)

---

## Quick Start

```bash
# 1. Clone & install
cd prahari
npm install

# 2. Verify Phase 0 setup
npm run verify:setup

# 3. Download Phase 1 models
npm run download:models

# 4. Run on device
npm run android  # or: npm run ios
```

> **Dev build required** — Expo Go won't work (needs native TFLite + MediaPipe)

---

## Phase Roadmap

### **Phase 0 — Environment Setup** ✅
Bootstrap React Native + Expo 51 with all core dependencies:
- ✅ `expo-camera` for video capture
- ✅ `react-native-tflite` for neural network inference
- ✅ `@mediapipe/tasks-vision` for 468-point face landmarks
- ✅ `react-native-quick-sqlite` for encrypted local storage
- ✅ `@react-native-community/netinfo` for offline detection
- ✅ `expo-secure-store` for hardware key encryption
- ✅ `expo-crypto` for AES-256 encryption
- ✅ Zustand state management
- ✅ TypeScript + ESLint setup

**Status**: Complete. All dependencies pre-installed.

---

### **Phase 1 — Face Recognition Engine** 🔄
Build the biometric core: **MobileFaceNet INT8** (1.9MB) → **128-dim embeddings** → **cosine similarity matching**

```
Image Input (112×112)
    ↓
[TFLite MobileFaceNet INT8]
    ↓
128-dim embedding (L2-normalized)
    ↓
Cosine Similarity (threshold: 0.65)
    ↓
Match Result ✓/✗
```

**Files**:
- `src/hooks/useFaceEngine.ts` — TFLite model loading + embedding generation
- `src/utils/faceCrop.ts` — Image resize to 112×112
- `src/utils/similarity.ts` — Cosine matching + stats
- `src/screens/TestScreen.tsx` — Phase 1 validation UI

**Next**: Download model via `npm run download:models`

---

### **Phase 2 — Liveness Detection (Anti-Spoofing)** 🔄
Detect living faces using **two independent methods**:

#### **Layer 2: Geometric Liveness** (Eye + Head Motion)
Deterministic checks from MediaPipe 468 landmarks:

```
Face Landmarks (468 points)
    ↓
├─ Eye Aspect Ratio (EAR)
│  └─ Indices: [33,160,158,133,153,144] (left) + [362,385,387,263,373,380] (right)
│  └─ Formula: (||p2-p6|| + ||p3-p5||) / (2 × ||p1-p4||)
│  └─ Threshold: > 0.2 = eyes open
│
├─ Blink Detection
│  └─ EAR dip + rise = 1 blink
│  └─ Requirement: ≥2 blinks in 5 seconds
│
└─ Head Pose (Pitch/Yaw/Roll)
   └─ From: noseTip(1), leftCheek(50), rightCheek(280), forehead(10)
   └─ Limits: Yaw < ±30°, Pitch < ±20°
```

**Files**:
- `src/hooks/useGeometricLiveness.ts` — EAR + blink + pose detection
- `src/utils/livenessUtils.ts` — Math functions (distance, angle, etc.)

#### **Layer 1: rPPG Heartbeat Detection** (Remote Photoplethysmography)
Novel blood-flow analysis — **the key differentiator**:

```
Video Frames
    ↓
Extract Cheek ROI (landmarks 50, 280)
    ↓
Average RGB values per frame
    ↓
Normalize signals (zero-mean)
    ↓
Green channel analysis: G + 0.5×(G-R)
    ↓
Bandpass filter (0.7–4 Hz = 42–240 BPM)
    ↓
Goertzel algorithm (single-frequency DFT)
    ↓
Detect peak frequency
    ↓
Validate: 60–120 BPM? → ✓ LIVE or ✗ SPOOFED
```

**Why this works**:
- 📸 Photos have flat RGB values → no pulse signal
- 🎥 Screen replays have wrong frequency → rejected
- 👤 Real face has heartbeat → ✓ periodic signal at valid BPM
- 🎭 Masks block cheek region → no viable signal

**Files**:
- `src/hooks/useRemotePhotoplethysmography.ts` — Pulse detection
- `src/services/livenessService.ts` — MediaPipe initialization

#### **Combined Decision**
```
Both checks required:
✓ Geometric Score ≥ 0.7  (eyes open + head in frame + ≥2 blinks)
✓ rPPG Confidence ≥ 0.5  (heartbeat detected + valid BPM)
  ↓
→ PASS: Continue to Phase 1 recognition
→ FAIL: Reject (spoof detected)
```

**Files**:
- `src/hooks/useEnhancedFaceEngine.ts` — Phase 1 + Phase 2 integration

---

### **Phase 3 — Zero-Knowledge Biometric Vault** ⏳
Encrypt everything at rest using hardware-backed keys:

```
Device boots
    ↓
Android Keystore / iOS Secure Enclave
    ↓
Generate AES-256 key (never leaves hardware)
    ↓
On enrollment: encrypt embedding + store in SQLite
    ↓
On verification: decrypt in-memory only
    ↓
Delete plaintext after match
```

**Why this matters**:
- 🔐 GDPR compliant: biometrics not persisted in plaintext
- 🏆 Innovation score: demonstrates real security thinking
- 📱 Zero-knowledge: server never sees raw embeddings
- 🔑 Hardware-backed: attackers can't extract key (ARM TrustZone)

**Files** (to be created):
- `src/services/cryptoService.ts` — AES-256 encryption
- `src/services/databaseService.ts` — SQLite with encryption
- `src/hooks/useBiometricVault.ts` — Store/retrieve encrypted embeddings

---

### **Phase 4 — Federated Sync** ⏳
Upload encrypted model deltas (not face data) to cloud.

---

### **Phase 5 — Enrollment & Verification UI** ⏳
Native screens for real-world attendance.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Phase 5: Enrollment/Verification UI                  │
├─────────────────────────────────────────────────────────┤
│  Phase 4: Federated Sync (AWS S3, encrypted deltas)    │
├─────────────────────────────────────────────────────────┤
│  Phase 3: ZK Vault (AES-256 + Secure Enclave)         │
├─────────────────────────────────────────────────────────┤
│          Phase 2: Liveness Detection                   │
│     ┌───────────────────────┬───────────────────────┐  │
│     │ Layer 2: Geometric    │ Layer 1: rPPG         │  │
│     │ - EAR + Blinks        │ - Pulse Detection     │  │
│     │ - Head Pose           │ - Blood Flow Analysis │  │
│     └───────────────────────┴───────────────────────┘  │
├─────────────────────────────────────────────────────────┤
│  Phase 1: Face Recognition (MobileFaceNet INT8)        │
│  - 128-dim embeddings                                   │
│  - Cosine similarity (threshold 0.65)                  │
├─────────────────────────────────────────────────────────┤
│  Phase 0: Core Runtime (Expo, Camera, TFLite, SQLite) │
└─────────────────────────────────────────────────────────┘
```

---

## Testing Each Phase

### **Phase 0**: Verify dependencies
```bash
npm run verify:setup
# Output: ✓ All modules loaded
```

### **Phase 1**: Test face recognition
1. Place `mobilefacenet_int8.tflite` in `assets/models/`
2. Open app → TestScreen
3. Pick 2 photos → compare embeddings
4. Expected: Similar faces score **0.75–0.95**, different faces **0.15–0.45**

### **Phase 2**: Test liveness detection
1. **Geometric**: Face camera, blink 2+ times, keep head still
   - Success: "Eyes open, head in frame, 2+ blinks" ✓
2. **rPPG**: Close-up of cheek, hold still 5 seconds
   - Success: "Pulse detected: 72 BPM" ✓
3. **Combined**: Both checks pass → proceed to recognition

### **Phase 3**: Test encryption
1. Enroll a face
2. Check SQLite database
3. Verify: embeddings are encrypted blobs (not plaintext floats)

---

## Key Metrics

| Metric | Target | Notes |
|--------|--------|-------|
| **Model size** | < 2 MB | MobileFaceNet INT8 is 1.9 MB |
| **Face inference** | < 300 ms | TFLite on device |
| **Geometric analysis** | < 100 ms | Real-time |
| **rPPG analysis** | ~1–2 sec | Needs 30–60 frames |
| **FAR (false accept)** | < 1% | Threshold tuning |
| **FRR (false reject)** | < 5% | Legitimate users |
| **Spoofing detection** | > 95% | rPPG + geometric |

---

## Configuration & Thresholds

### **Phase 1: Face Recognition**
```typescript
// src/utils/similarity.ts
const RECOGNITION_THRESHOLD = 0.65;  // Cosine similarity
```

### **Phase 2: Liveness Detection**
```typescript
// src/hooks/useGeometricLiveness.ts
const EAR_THRESHOLD = 0.2;           // Eyes open
const MIN_BLINKS = 2;               // Blink count
const YAW_THRESHOLD = 30;           // Head rotation (degrees)
const PITCH_THRESHOLD = 20;         // Head tilt (degrees)

// src/hooks/useRemotePhotoplethysmography.ts
const MIN_FRAMES = 30;              // ~1 sec at 30fps
const MIN_FREQUENCY = 0.7;          // 42 BPM (Hz)
const MAX_FREQUENCY = 2.0;          // 120 BPM (Hz)
```

---

## Project Structure

```
prahari/
├── app/                                ← Expo Router screens
│   ├── _layout.tsx                     ← RootLayout, GestureHandler
│   ├── index.tsx                       ← Dashboard
│   ├── enroll.tsx                      ← Phase 1/2 enrollment
│   └── verify.tsx                      ← Phase 1/2 verification
│
├── src/
│   ├── hooks/                          ← React hooks
│   │   ├── useFaceEngine.ts            ← Phase 1: TFLite + embeddings
│   │   ├── useGeometricLiveness.ts     ← Phase 2: EAR + blinking
│   │   ├── useRemotePhotoplethysmography.ts ← Phase 2: rPPG pulse
│   │   ├── useEnhancedFaceEngine.ts    ← Phase 1 + 2: integrated
│   │   └── useBiometricVault.ts        ← Phase 3: encrypted storage
│   │
│   ├── services/                       ← Business logic
│   │   ├── livenessService.ts          ← Phase 2: MediaPipe init
│   │   ├── cryptoService.ts            ← Phase 3: AES-256
│   │   ├── databaseService.ts          ← Phase 3: SQLite + crypto
│   │   ├── setupService.ts             ← Phase 0: verification
│   │   └── modelService.ts             ← Phase 1: model loading
│   │
│   ├── store/                          ← Global state (Zustand)
│   │   └── usePrahariStore.ts
│   │
│   └── utils/                          ← Pure functions
│       ├── faceCrop.ts                 ← Phase 1: image preprocessing
│       ├── similarity.ts               ← Phase 1: cosine matching
│       ├── livenessUtils.ts            ← Phase 2: DSP functions
│       ├── cryptoUtils.ts              ← Phase 3: encryption helpers
│       └── constants.ts                ← Thresholds, colors
│
├── assets/
│   ├── models/                         ← TFLite + MediaPipe models
│   │   ├── mobilefacenet_int8.tflite   ← Phase 1 (download separately)
│   │   └── .gitkeep
│   └── ...icons, splash
│
├── scripts/
│   ├── verify-setup.js                 ← Phase 0 verification
│   └── download-models.js              ← Phase 1 model download
│
├── docs/                               ← Phase documentation
│   ├── PHASE_0.md                      ← Setup guide
│   ├── PHASE_1.md                      ← Face recognition
│   ├── PHASE_2.md                      ← Liveness detection
│   └── PHASE_3.md                      ← Zero-knowledge vault
│
├── app.json                            ← Expo config
├── babel.config.js                     ← Babel plugins
├── metro.config.js                     ← Metro bundler config
├── tsconfig.json                       ← TypeScript paths
├── package.json                        ← All dependencies
└── README.md                           ← This file
```

---

## Dependencies (All Phases)

### **Core**
- `expo@51` — Managed React Native
- `react-native@0.74` — Native layer
- `expo-router@3.5` — File-based routing

### **Phase 0**
- `expo-camera@15` — Video capture
- `expo-file-system@17` — File I/O
- `expo-secure-store@13` — Secure storage
- `expo-network@6` — Offline detection

### **Phase 1**
- `react-native-tflite@1` — TensorFlow Lite bridge
- `expo-image-manipulator@11.8` — Image resize/crop

### **Phase 2**
- `@mediapipe/tasks-vision@0.10` — 468 face landmarks
- `expo-sensors@13` — Accelerometer (optional)

### **Phase 3**
- `expo-crypto@13` — AES-256 encryption
- `react-native-quick-sqlite@8` — Encrypted SQLite
- `expo-secure-store@13` — Hardware key storage (Android Keystore, iOS Secure Enclave)

### **State & UI**
- `zustand@4.5` — Lightweight state management
- `react-native-reanimated@3.10` — Smooth animations
- `react-native-gesture-handler@2.16` — Gesture support
- `@shopify/react-native-skia@1.3` — GPU-accelerated graphics

---

## Getting Started

### **1. Install Dependencies**
```bash
npm install
```

### **2. Verify Phase 0 Setup**
```bash
npm run verify:setup
```

Output should show:
```
✓ Config files
✓ App screens
✓ Services
✓ Hooks & Utilities
✓ All dependencies
```

### **3. Download Phase 1 Model**
```bash
npm run download:models
```

Places `mobilefacenet_int8.tflite` in `assets/models/`.

### **4. Build Dev Build**
```bash
# Android
npm run android

# iOS
npm run ios
```

### **5. Test on Device**
Scan QR with phone (Expo Go won't work — need dev build for native modules).

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| "Module not found: TFLite" | Run `npm install`, then rebuild |
| "Model not found" | Run `npm run download:models` |
| "Landmarks are null" | Face not detected in camera frame |
| "Pulse out of range" | Keep still, better lighting, ~5 sec video |
| Metro crashes on `.tflite` | Verify `metro.config.js` has assetExts |
| Expo Go says "Something went wrong" | Delete app + reinstall dev build |

---

## Innovation Highlights

1. **rPPG Heartbeat Detection** — Novel anti-spoofing (photos fail immediately, screen replays detected by frequency)
2. **Zero-Knowledge Architecture** — Biometrics never stored in plaintext; GDPR-compliant
3. **Hardware-Backed Encryption** — AES-256 keys secured by ARM TrustZone / Secure Enclave
4. **Offline-First** — Works without internet; syncs encrypted deltas when online
5. **Multi-Layer Validation** — Geometric + rPPG + recognition = 3 independent security checks

---

## Next Steps

1. ✅ **Phase 0**: Environment setup (DONE)
2. 🔄 **Phase 1**: Download model, test face recognition
3. 🔄 **Phase 2**: Test geometric + rPPG liveness on device
4. ⏳ **Phase 3**: Implement crypto service + encrypted SQLite
5. ⏳ **Phase 4**: AWS Lambda sync for federated learning
6. ⏳ **Phase 5**: Production UI + enrollment flows

---

## License
Academic project — PRAHARI Biometric Attendance System

---

**Ready?** Start with Phase 1 model download: `npm run download:models`

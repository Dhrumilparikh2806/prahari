# HACKATHON 7.0 — Complete Checklist & Deliverables
**Project:** Offline Facial Recognition & Liveness Detection for React Native  
**Submission Deadline:** 05 June 2026  
**Total Marks:** 100

---

## ✅ MANDATORY DELIVERABLES (Must Submit All)

- [ ] Working React Native prototype — runs on Android AND iOS
- [ ] Offline face recognition — no internet needed at any point
- [ ] Liveness detection — blink, smile, or head turn challenge
- [ ] Anti-spoofing — must reject photo/screen attacks
- [ ] Local data storage — encrypted, persists between sessions
- [ ] Sync mechanism — auto-syncs to AWS when network returns
- [ ] Purge mechanism — local data wiped after successful sync
- [ ] Source code shared publicly (GitHub repo or zip)
- [ ] Presentation file (.pptx or .pdf)
- [ ] Technical documentation: model architecture + integration steps + benchmarks

---

## 🚫 TECHNICAL CONSTRAINTS (All Must Pass — Non-Negotiable)

- [ ] Framework: React Native only — cross-platform Android + iOS
- [ ] Model size ≤ 20 MB total (smaller scores better)
- [ ] Speed: full recognition + liveness < 1 second end-to-end
- [ ] No GPU required — standard mid-range CPU only
- [ ] Android 8.0+ (API 26+) supported
- [ ] iOS 12+ supported
- [ ] Works on devices with minimum 3 GB RAM
- [ ] Recognition accuracy > 95% (must be benchmarked and proven)
- [ ] Handles diverse Indian demographics accurately
- [ ] Works in harsh sunlight, low light, and shadow conditions
- [ ] Only open-source tech — zero paid or proprietary licenses

---

## 🏆 EVALUATION CRITERIA — What Judges Score (100 Marks)

### Innovation Level — 30 Marks
- [ ] Edge AI model is highly efficient for mobile (quantized / pruned)
- [ ] Compression technique achieves sub-20 MB total model size
- [ ] Liveness detection effectively prevents spoofing (photo/screen/mask)

### Feasibility — 30 Marks
- [ ] Easily integrates into existing Datalake 3.0 React Native architecture
- [ ] Proven < 1 second end-to-end on real mid-range hardware (benchmarked)

### Scalability & Sustainability — 20 Marks
- [ ] Sync/purge mechanism is reliable and handles edge cases
- [ ] Adapts to diverse demographics and lighting conditions

### Presentation & Documentation — 20 Marks
- [ ] Source code is clean, readable, and well-commented
- [ ] Integration guide is clear and complete
- [ ] Final pitch is confident and well-structured

---

## 🔨 BUILD CHECKLIST (Implementation — Recommended Order)

### Setup
- [ ] Init React Native project (bare workflow / Expo bare)
- [ ] Add `react-native-vision-camera` for live camera feed
- [ ] Add `react-native-fast-tflite` for on-device TFLite inference

### Face Recognition
- [ ] Bundle MobileFaceNet TFLite model (~1 MB) in app assets
- [ ] Bundle BlazeFace or ML Kit face detector TFLite (~1.5 MB)
- [ ] Build face detection pipeline: camera → detect bounding box
- [ ] Build face embedding pipeline: crop → normalize → MobileFaceNet → 128-D vector
- [ ] Implement cosine similarity matcher (threshold ≥ 0.6)
- [ ] Build enrollment screen: capture face → store encrypted embedding
- [ ] Build verification screen: live face → compare → accept/reject

### Liveness Detection
- [ ] Liveness: EAR (Eye Aspect Ratio) blink detector using face landmarks
- [ ] Liveness: head pose estimation → detect left/right turn
- [ ] Liveness: mouth curve ratio → smile detection
- [ ] Liveness challenge-response flow (random prompt → user action → verify)

### Local Storage
- [ ] Set up SQLite + SQLCipher for encrypted local storage
- [ ] Store: attendance records, face embeddings, sync status, timestamps

### Sync & Purge
- [ ] Implement NetInfo listener for connectivity detection
- [ ] Build sync queue: POST pending records to AWS API on reconnect
- [ ] Purge: delete local records after confirmed server acknowledgement

### Testing & Benchmarks
- [ ] Test on real Android mid-range device (3 GB RAM — no emulator)
- [ ] Test on iOS 12+ device or Xcode simulator
- [ ] Run benchmark: measure inference latency (target < 800 ms)
- [ ] Confirm total bundled model size < 20 MB
- [ ] Confirm recognition accuracy > 95% on test set

---

## 📄 DOCUMENTATION & PRESENTATION CHECKLIST

### Presentation Slides (8 minimum)
- [ ] Slide 1: Problem statement — why offline biometrics matter in zero-network zones
- [ ] Slide 2: Architecture overview — component/flow diagram
- [ ] Slide 3: Model choices — MobileFaceNet + BlazeFace + justification
- [ ] Slide 4: Liveness detection approach — how it prevents spoofing
- [ ] Slide 5: Sync & purge flow — diagram of offline → online lifecycle
- [ ] Slide 6: Performance benchmarks — latency, accuracy %, model size
- [ ] Slide 7: Integration guide — how to plug into existing Datalake 3.0 app
- [ ] Slide 8: Demo screenshots / screen recordings

### Code Documentation
- [ ] README: install steps, dependencies, run instructions
- [ ] Code comments on all critical functions (inference, liveness, sync)
- [ ] Architecture diagram (can be in README or docs folder)

---

## 📦 RECOMMENDED TECH STACK (All Open-Source, No Licenses)

| Component              | Library / Tool                        | Size    |
|------------------------|---------------------------------------|---------|
| Framework              | React Native (bare)                   | —       |
| Camera                 | react-native-vision-camera            | —       |
| TFLite Runtime         | react-native-fast-tflite              | ~3 MB   |
| Face Detection         | BlazeFace TFLite                      | ~0.5 MB |
| Face Recognition       | MobileFaceNet TFLite                  | ~1 MB   |
| Liveness Landmarks     | MediaPipe Face Mesh TFLite            | ~3 MB   |
| Local Storage          | react-native-quick-sqlite + SQLCipher | —       |
| Network Detection      | @react-native-community/netinfo       | —       |
| AWS Sync               | AWS SDK (REST calls or Amplify)       | —       |
| **Total model size**   |                                       | **~8 MB** |

---

## ⚡ PRIORITY ORDER (With ~24 Hours Left)

1. **Camera + face detection working** → proves the core pipeline exists  
2. **Liveness challenge-response** → biggest innovation marks (30 pts)  
3. **Benchmark screenshot** → proves < 1 sec, seals 30 feasibility marks  
4. **SQLite local storage** → proves offline capability  
5. **Stub the AWS sync** → document it even if partially implemented  
6. **8-slide presentation** → 20 free marks with clean slides  
7. **README + code comments** → final polish on documentation marks  

---

*Generated for Hackathon 7.0 | Submission closes 05.06.2026*
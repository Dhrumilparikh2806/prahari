/**
 * enroll.tsx — Face Enrollment Screen (expo-camera)
 *
 * Uses expo-camera (Expo first-party) instead of react-native-vision-camera
 * for guaranteed EAS build compatibility with Expo SDK 50.
 *
 * Flow:
 *   1. Enter personnel name
 *   2. Camera opens — face guide oval shown
 *   3. Liveness checks: blink × 2 → head straight → hold 2s → heartbeat
 *   4. 5 frames captured, landmark embeddings averaged
 *   5. Encrypted and saved to vault → success card
 */

import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  SafeAreaView, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Camera, CameraType } from 'expo-camera';
import WebView from 'react-native-webview';
import { useRouter } from 'expo-router';
import { useMediaPipe } from '@hooks/useMediaPipe';
import { useFaceRecognition } from '@hooks/useFaceRecognition';
import { useCameraPipeline } from '@hooks/useCameraPipeline';
import CameraOverlay from '@components/CameraOverlay';
import LivenessIndicator from '@components/LivenessIndicator';
import ResultCard from '@components/ResultCard';
import { UI, LIVENESS } from '@config/constants';

type ScreenState = 'name_entry' | 'scanning' | 'done';

export default function EnrollScreen() {
  const router = useRouter();

  const [permission, requestPermission] = Camera.useCameraPermissions();
  const cameraRef = useRef<Camera>(null);

  const [screenState, setScreenState] = useState<ScreenState>('name_entry');
  const [personnelName, setPersonnelName] = useState('');
  const [holdSeconds, setHoldSeconds] = useState(0);
  const holdTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const mediaPipe = useMediaPipe();
  const faceRecognition = useFaceRecognition();
  const pipeline = useCameraPipeline({ mediaPipe, faceRecognition });
  const frameIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Request permission on mount
  useEffect(() => {
    if (!permission?.granted) requestPermission();
  }, []);

  // Hold-still countdown
  useEffect(() => {
    if (screenState !== 'scanning') return;
    if (pipeline.headInFrame && pipeline.blinkCount >= LIVENESS.MIN_BLINKS) {
      if (!holdTimerRef.current) {
        holdTimerRef.current = setInterval(() => {
          setHoldSeconds(s => {
            if (s >= 2) { clearInterval(holdTimerRef.current!); holdTimerRef.current = null; return 2; }
            return s + 1;
          });
        }, 1000);
      }
    } else {
      if (holdTimerRef.current) { clearInterval(holdTimerRef.current); holdTimerRef.current = null; }
      setHoldSeconds(0);
    }
    return () => { if (holdTimerRef.current) clearInterval(holdTimerRef.current); };
  }, [pipeline.headInFrame, pipeline.blinkCount, screenState]);

  // Watch for completion
  useEffect(() => {
    if (pipeline.phase === 'done') { stopCapture(); setScreenState('done'); }
  }, [pipeline.phase]);

  const startCapture = (name: string) => {
    setScreenState('scanning');
    pipeline.startEnrollment(name);
    frameIntervalRef.current = setInterval(async () => {
      try {
        if (!cameraRef.current) return;
        const photo = await cameraRef.current.takePictureAsync({ base64: true, quality: 0.5 });
        if (photo.base64) {
          await pipeline.submitFrame(`data:image/jpeg;base64,${photo.base64}`);
        }
      } catch { /* ignore per-frame errors */ }
    }, 200);
  };

  const stopCapture = () => {
    if (frameIntervalRef.current) { clearInterval(frameIntervalRef.current); frameIntervalRef.current = null; }
  };

  const handleStartScan = () => {
    const name = personnelName.trim();
    if (name.length < 2) { Alert.alert('Name Required', 'Please enter the full name.'); return; }
    startCapture(name);
  };

  const handleRetry = () => {
    setHoldSeconds(0); pipeline.reset();
    setScreenState('scanning'); startCapture(personnelName.trim());
  };

  const getInstruction = () => {
    if (!mediaPipe.ready) return 'Initialising AI…';
    if (pipeline.blinkCount < LIVENESS.MIN_BLINKS) return 'Blink naturally twice';
    if (!pipeline.headInFrame) return 'Look straight at the camera';
    if (holdSeconds < 2) return `Hold still… ${2 - holdSeconds}s`;
    if (!pipeline.currentBpm) return 'Reading heartbeat…';
    return 'Capturing face data…';
  };

  // ── Name entry screen ──────────────────────────────────────────────────────

  if (screenState === 'name_entry') {
    return (
      <SafeAreaView style={styles.safe}>
        <KeyboardAvoidingView style={styles.nameContainer} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Enroll Personnel</Text>
          <Text style={styles.subtitle}>Enter the full name before scanning the face.</Text>
          <TextInput
            style={styles.input}
            placeholder="Full Name (e.g. Rajesh Kumar)"
            placeholderTextColor="#555"
            value={personnelName}
            onChangeText={setPersonnelName}
            autoCapitalize="words"
            returnKeyType="done"
            onSubmitEditing={handleStartScan}
            maxLength={60}
          />
          <TouchableOpacity
            style={[styles.startBtn, personnelName.trim().length < 2 && styles.startBtnOff]}
            onPress={handleStartScan}
            disabled={personnelName.trim().length < 2}
          >
            <Text style={styles.startBtnText}>Start Face Scan</Text>
          </TouchableOpacity>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  const livenessPass = pipeline.rPPGConfidence >= 0.5 && pipeline.geometricScore >= 0.7;

  return (
    <View style={styles.container}>
      {permission?.granted ? (
        <Camera
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          type={CameraType.front}
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.noCamera]}>
          <Text style={styles.noCameraText}>Camera permission required</Text>
        </View>
      )}

      {mediaPipe.htmlUri ? (
        <WebView
          ref={mediaPipe.webViewRef}
          source={{ uri: mediaPipe.htmlUri }}
          style={styles.hiddenWebView}
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
      ) : null}

      <CameraOverlay phase={pipeline.phase} landmarks={null} livenessPass={livenessPass} instruction={getInstruction()} />

      <View style={styles.livenessBox}>
        <LivenessIndicator
          blinkCount={pipeline.blinkCount}
          headInFrame={pipeline.headInFrame}
          holdComplete={holdSeconds >= 2}
          bpm={pipeline.currentBpm}
          heartbeatDetected={pipeline.rPPGConfidence >= 0.5}
        />
      </View>

      {screenState === 'done' && pipeline.result ? (
        <ResultCard result={pipeline.result} onRetry={handleRetry} onDone={() => router.back()} />
      ) : null}

      <SafeAreaView style={styles.topBar}>
        <TouchableOpacity style={styles.closeBtn} onPress={() => router.back()}>
          <Text style={styles.closeBtnText}>✕</Text>
        </TouchableOpacity>
        <Text style={styles.topBarTitle}>Enrolling: {personnelName}</Text>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: UI.BACKGROUND_COLOR },
  nameContainer: { flex: 1, paddingHorizontal: 28, paddingTop: 60 },
  backBtn: { marginBottom: 32 },
  backText: { color: UI.ACCENT_COLOR, fontSize: 16 },
  title: { fontSize: 28, fontWeight: '700', color: '#FFF', marginBottom: 8 },
  subtitle: { fontSize: 14, color: '#888', lineHeight: 20, marginBottom: 32 },
  input: {
    backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 14, fontSize: 16, color: '#FFF',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', marginBottom: 20,
  },
  startBtn: { backgroundColor: UI.ACCENT_COLOR, borderRadius: 12, paddingVertical: 16, alignItems: 'center' },
  startBtnOff: { opacity: 0.4 },
  startBtnText: { fontSize: 17, fontWeight: '700', color: '#000' },
  container: { flex: 1, backgroundColor: '#000' },
  noCamera: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#111' },
  noCameraText: { color: '#555', fontSize: 16 },
  hiddenWebView: { width: 1, height: 1, opacity: 0, position: 'absolute' },
  livenessBox: { position: 'absolute', bottom: 120, left: 0, right: 0 },
  topBar: {
    position: 'absolute', top: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingTop: 12, gap: 12,
  },
  closeBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  closeBtnText: { color: '#FFF', fontSize: 16 },
  topBarTitle: { color: '#FFF', fontSize: 15, fontWeight: '600', flex: 1 },
});

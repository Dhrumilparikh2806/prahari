/**
 * enroll.tsx — Face Enrollment Screen
 *
 * Guides a field officer through enrolling a new personnel member:
 *   1. Enter the personnel name.
 *   2. Camera opens with CameraOverlay showing the oval guide.
 *   3. LivenessIndicator walks through: blink → head straight → hold → heartbeat.
 *   4. Once liveness passes, 5 frames are silently captured.
 *   5. Embeddings from the 5 frames are averaged (noise reduction).
 *   6. Averaged embedding is AES-256 encrypted and saved to the SQLite vault.
 *   7. Success ResultCard shown with the enrolled name.
 *
 * Uses react-native-vision-camera v4 API:
 *   useCameraDevice('front') replaces the old useCameraDevices() object pattern.
 *   useCameraPermission() replaces Camera.requestCameraPermission().
 */

import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Camera, useCameraDevice, useCameraPermission } from 'react-native-vision-camera';
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

  // vision-camera v4 API
  const device = useCameraDevice('front');
  const { hasPermission, requestPermission } = useCameraPermission();
  const cameraRef = useRef<Camera>(null);

  const [screenState, setScreenState] = useState<ScreenState>('name_entry');
  const [personnelName, setPersonnelName] = useState('');

  // Hold-still 2-second countdown
  const [holdSeconds, setHoldSeconds] = useState(0);
  const holdTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const mediaPipe = useMediaPipe();
  const faceRecognition = useFaceRecognition();
  const pipeline = useCameraPipeline({ mediaPipe, faceRecognition });

  // Frame capture interval
  const frameIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Permissions ────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!hasPermission) requestPermission();
  }, []);

  // ── Hold-still timer ───────────────────────────────────────────────────────

  useEffect(() => {
    if (screenState !== 'scanning') return;

    if (pipeline.headInFrame && pipeline.blinkCount >= LIVENESS.MIN_BLINKS) {
      if (!holdTimerRef.current) {
        holdTimerRef.current = setInterval(() => {
          setHoldSeconds((s) => {
            if (s >= 2) {
              clearInterval(holdTimerRef.current!);
              holdTimerRef.current = null;
              return 2;
            }
            return s + 1;
          });
        }, 1000);
      }
    } else {
      if (holdTimerRef.current) {
        clearInterval(holdTimerRef.current);
        holdTimerRef.current = null;
      }
      setHoldSeconds(0);
    }

    return () => {
      if (holdTimerRef.current) clearInterval(holdTimerRef.current);
    };
  }, [pipeline.headInFrame, pipeline.blinkCount, screenState]);

  // ── Pipeline completion ────────────────────────────────────────────────────

  useEffect(() => {
    if (pipeline.phase === 'done') {
      stopCapture();
      setScreenState('done');
    }
  }, [pipeline.phase]);

  // ── Frame capture at 5 fps ─────────────────────────────────────────────────

  const startCapture = (name: string) => {
    setScreenState('scanning');
    pipeline.startEnrollment(name);

    frameIntervalRef.current = setInterval(async () => {
      try {
        if (!cameraRef.current) return;
        const photo = await cameraRef.current.takePhoto({ flash: 'off' });
        const uri = `file://${photo.path}`;
        const FileSystem = await import('expo-file-system');
        const base64 = await FileSystem.readAsStringAsync(uri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        await pipeline.submitFrame(`data:image/jpeg;base64,${base64}`);
      } catch { /* ignore per-frame errors */ }
    }, 200);
  };

  const stopCapture = () => {
    if (frameIntervalRef.current) {
      clearInterval(frameIntervalRef.current);
      frameIntervalRef.current = null;
    }
  };

  const handleStartScan = () => {
    const name = personnelName.trim();
    if (name.length < 2) {
      Alert.alert('Name Required', 'Please enter the personnel member\'s full name.');
      return;
    }
    startCapture(name);
  };

  const handleRetry = () => {
    setHoldSeconds(0);
    pipeline.reset();
    setScreenState('scanning');
    startCapture(personnelName.trim());
  };

  const handleDone = () => router.back();

  // ── Instruction text ───────────────────────────────────────────────────────

  const getInstruction = (): string => {
    if (!mediaPipe.ready || !faceRecognition.ready) return 'Initialising AI…';
    if (pipeline.blinkCount < LIVENESS.MIN_BLINKS) return 'Blink naturally twice';
    if (!pipeline.headInFrame) return 'Look straight at the camera';
    if (holdSeconds < 2) return `Hold still… ${2 - holdSeconds}s`;
    if (!pipeline.currentBpm) return 'Reading heartbeat…';
    if (pipeline.phase === 'recognizing') return 'Capturing face data…';
    return 'Almost done…';
  };

  // ── Name entry screen ──────────────────────────────────────────────────────

  if (screenState === 'name_entry') {
    return (
      <SafeAreaView style={styles.safeArea}>
        <KeyboardAvoidingView
          style={styles.nameContainer}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>

          <Text style={styles.title}>Enroll Personnel</Text>
          <Text style={styles.subtitle}>
            Enter the full name of the field worker before scanning their face.
          </Text>

          <TextInput
            style={styles.nameInput}
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
            style={[styles.startBtn, personnelName.trim().length < 2 && styles.startBtnDisabled]}
            onPress={handleStartScan}
            disabled={personnelName.trim().length < 2}
          >
            <Text style={styles.startBtnText}>Start Face Scan</Text>
          </TouchableOpacity>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // ── Camera scanning screen ─────────────────────────────────────────────────

  const livenessPass = pipeline.rPPGConfidence >= 0.5 && pipeline.geometricScore >= 0.7;

  return (
    <View style={styles.container}>
      {/* Camera feed */}
      {device && hasPermission ? (
        <Camera
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          device={device}
          isActive={screenState === 'scanning'}
          photo
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.noCamera]}>
          <Text style={styles.noCameraText}>
            {!hasPermission ? 'Camera permission required' : 'No front camera found'}
          </Text>
        </View>
      )}

      {/* Hidden MediaPipe WebView */}
      {mediaPipe.htmlUri ? (
        <WebView
          ref={mediaPipe.webViewRef}
          source={{ uri: mediaPipe.htmlUri }}
          style={styles.hiddenWebView}
          onMessage={mediaPipe.onMessage}
          javaScriptEnabled
          originWhitelist={['*']}
        />
      ) : null}

      {/* Oval overlay + instruction */}
      <CameraOverlay
        phase={pipeline.phase}
        landmarks={null}
        livenessPass={livenessPass}
        instruction={getInstruction()}
      />

      {/* 4-step liveness tracker */}
      <View style={styles.livenessBox}>
        <LivenessIndicator
          blinkCount={pipeline.blinkCount}
          headInFrame={pipeline.headInFrame}
          holdComplete={holdSeconds >= 2}
          bpm={pipeline.currentBpm}
          heartbeatDetected={pipeline.rPPGConfidence >= 0.5}
        />
      </View>

      {/* Result card */}
      {screenState === 'done' && pipeline.result ? (
        <ResultCard result={pipeline.result} onRetry={handleRetry} onDone={handleDone} />
      ) : null}

      {/* Top bar */}
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
  safeArea: { flex: 1, backgroundColor: UI.BACKGROUND_COLOR },
  nameContainer: { flex: 1, paddingHorizontal: 28, paddingTop: 60 },
  backBtn: { marginBottom: 32 },
  backText: { color: UI.ACCENT_COLOR, fontSize: 16 },
  title: { fontSize: 28, fontWeight: '700', color: '#FFF', marginBottom: 8 },
  subtitle: { fontSize: 14, color: '#888', lineHeight: 20, marginBottom: 32 },
  nameInput: {
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#FFF',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    marginBottom: 20,
  },
  startBtn: { backgroundColor: UI.ACCENT_COLOR, borderRadius: 12, paddingVertical: 16, alignItems: 'center' },
  startBtnDisabled: { opacity: 0.4 },
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
  closeBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center', justifyContent: 'center',
  },
  closeBtnText: { color: '#FFF', fontSize: 16 },
  topBarTitle: { color: '#FFF', fontSize: 15, fontWeight: '600', flex: 1 },
});

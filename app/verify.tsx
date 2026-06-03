/**
 * verify.tsx — Identity Verification Screen
 *
 * Primary demo screen for the NHAI Hackathon judges.
 *
 * Full pipeline:
 *   Camera frame → MediaPipe (468 landmarks)
 *     → Geometric liveness (EAR blink + head pose)
 *     → rPPG heartbeat (Goertzel BPM)
 *     → [both pass] → TFLite MobileFaceNet embedding
 *     → Vault match (cosine similarity ≥ 0.85)
 *     → ResultCard: name, BPM, confidence, latency
 *
 * Uses react-native-vision-camera v4 API:
 *   useCameraDevice('front') + useCameraPermission()
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ActivityIndicator,
  FlatList,
} from 'react-native';
import { Camera, useCameraDevice, useCameraPermission } from 'react-native-vision-camera';
import WebView from 'react-native-webview';
import { useRouter, useFocusEffect } from 'expo-router';
import { useMediaPipe } from '@hooks/useMediaPipe';
import { useFaceRecognition } from '@hooks/useFaceRecognition';
import { useCameraPipeline } from '@hooks/useCameraPipeline';
import CameraOverlay from '@components/CameraOverlay';
import LivenessIndicator from '@components/LivenessIndicator';
import HeartbeatPulse from '@components/HeartbeatPulse';
import ResultCard from '@components/ResultCard';
import { listEnrolled } from '@database/vault';
import { UI, LIVENESS, RPPG } from '@config/constants';

export default function VerifyScreen() {
  const router = useRouter();

  // vision-camera v4
  const device = useCameraDevice('front');
  const { hasPermission, requestPermission } = useCameraPermission();
  const cameraRef = useRef<Camera>(null);

  const [enrolledIds, setEnrolledIds] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loadingPersonnel, setLoadingPersonnel] = useState(true);

  const [holdSeconds, setHoldSeconds] = useState(0);
  const holdTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [isScanning, setIsScanning] = useState(false);

  const mediaPipe = useMediaPipe();
  const faceRecognition = useFaceRecognition();
  const pipeline = useCameraPipeline({ mediaPipe, faceRecognition });

  const frameIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Init ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!hasPermission) requestPermission();
  }, []);

  // Reload enrolled list each time screen gains focus
  useFocusEffect(
    useCallback(() => {
      loadEnrolled();
    }, [])
  );

  const loadEnrolled = async () => {
    try {
      const ids = await listEnrolled();
      setEnrolledIds(ids);
      if (ids.length > 0) setSelectedId(ids[0]);
    } catch (err) {
      console.error('[verify] loadEnrolled:', err);
    } finally {
      setLoadingPersonnel(false);
    }
  };

  // ── Hold-still timer ───────────────────────────────────────────────────────

  useEffect(() => {
    if (!isScanning) return;

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
  }, [pipeline.headInFrame, pipeline.blinkCount, isScanning]);

  // ── Pipeline completion ────────────────────────────────────────────────────

  useEffect(() => {
    if (pipeline.phase === 'done') stopCapture();
  }, [pipeline.phase]);

  // ── Frame capture ──────────────────────────────────────────────────────────

  const startCapture = () => {
    if (!selectedId) return;
    setIsScanning(true);
    pipeline.startVerification(selectedId);

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

  const handleRetry = () => {
    setHoldSeconds(0);
    pipeline.reset();
    setIsScanning(false);
    stopCapture();
  };

  const handleDone = () => router.back();

  // ── Instruction ────────────────────────────────────────────────────────────

  const getInstruction = (): string => {
    if (!isScanning) return 'Select a person below then tap Start Scan';
    if (!mediaPipe.ready) return 'Loading AI model…';
    if (pipeline.blinkCount < LIVENESS.MIN_BLINKS) return 'Blink twice naturally';
    if (!pipeline.headInFrame) return 'Look directly at the camera';
    if (holdSeconds < 2) return `Hold still… ${2 - holdSeconds}s`;
    if (!pipeline.currentBpm) return 'Reading heartbeat…';
    if (pipeline.phase === 'recognizing') return 'Matching identity…';
    return 'Processing…';
  };

  const livenessPass =
    pipeline.rPPGConfidence >= RPPG.CONFIDENCE_MIN &&
    pipeline.geometricScore >= LIVENESS.GEOMETRIC_SCORE_MIN;

  // ── Personnel selector (pre-scan) ──────────────────────────────────────────

  if (!isScanning && pipeline.phase !== 'done') {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.prescan}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>

          <Text style={styles.title}>Verify Identity</Text>
          <Text style={styles.subtitle}>
            Select the personnel member to verify, then tap Start Scan.
          </Text>

          {loadingPersonnel ? (
            <ActivityIndicator color={UI.ACCENT_COLOR} size="large" />
          ) : enrolledIds.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>No personnel enrolled yet.</Text>
              <TouchableOpacity onPress={() => router.push('/enroll')}>
                <Text style={styles.enrollLink}>Enroll someone first →</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <FlatList
              data={enrolledIds}
              keyExtractor={(id) => id}
              style={styles.list}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.row, selectedId === item && styles.rowSelected]}
                  onPress={() => setSelectedId(item)}
                >
                  <View style={[styles.radio, selectedId === item && styles.radioSelected]} />
                  <Text style={styles.rowText} numberOfLines={1}>{item}</Text>
                </TouchableOpacity>
              )}
            />
          )}

          <TouchableOpacity
            style={[
              styles.startBtn,
              (!selectedId || !mediaPipe.ready || !faceRecognition.ready) && styles.startBtnDisabled,
            ]}
            onPress={startCapture}
            disabled={!selectedId || !mediaPipe.ready || !faceRecognition.ready}
          >
            {!mediaPipe.ready || !faceRecognition.ready ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator color="#000" size="small" />
                <Text style={styles.startBtnText}>Loading AI…</Text>
              </View>
            ) : (
              <Text style={styles.startBtnText}>Start Scan</Text>
            )}
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── Scanning view ──────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>
      {device && hasPermission ? (
        <Camera
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          device={device}
          isActive={isScanning && pipeline.phase !== 'done'}
          photo
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.noCamera]}>
          <Text style={styles.noCameraText}>
            {!hasPermission ? 'Camera permission required' : 'No front camera found'}
          </Text>
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
        />
      ) : null}

      <CameraOverlay
        phase={pipeline.phase}
        landmarks={null}
        livenessPass={livenessPass}
        instruction={getInstruction()}
      />

      <View style={styles.livenessBox}>
        <LivenessIndicator
          blinkCount={pipeline.blinkCount}
          headInFrame={pipeline.headInFrame}
          holdComplete={holdSeconds >= 2}
          bpm={pipeline.currentBpm}
          heartbeatDetected={pipeline.rPPGConfidence >= RPPG.CONFIDENCE_MIN}
        />
      </View>

      <View style={styles.heartbeatBox}>
        <HeartbeatPulse
          bpm={pipeline.currentBpm}
          confidence={pipeline.rPPGConfidence}
          heartbeatDetected={pipeline.rPPGConfidence >= RPPG.CONFIDENCE_MIN}
          frameCount={pipeline.currentBpm > 0 ? RPPG.MIN_FRAMES : 0}
        />
      </View>

      {pipeline.phase === 'done' && pipeline.result ? (
        <ResultCard result={pipeline.result} onRetry={handleRetry} onDone={handleDone} />
      ) : null}

      <SafeAreaView style={styles.topBar}>
        <TouchableOpacity
          style={styles.closeBtn}
          onPress={() => { stopCapture(); router.back(); }}
        >
          <Text style={styles.closeBtnText}>✕</Text>
        </TouchableOpacity>
        <Text style={styles.topBarTitle}>Identity Verification</Text>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: UI.BACKGROUND_COLOR },
  prescan: { flex: 1, paddingHorizontal: 28, paddingTop: 60 },
  backBtn: { marginBottom: 32 },
  backText: { color: UI.ACCENT_COLOR, fontSize: 16 },
  title: { fontSize: 28, fontWeight: '700', color: '#FFF', marginBottom: 8 },
  subtitle: { fontSize: 14, color: '#888', lineHeight: 20, marginBottom: 24 },
  list: { flex: 1, marginBottom: 16 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 14, paddingHorizontal: 16, borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.05)', marginBottom: 8,
  },
  rowSelected: {
    backgroundColor: 'rgba(0,198,174,0.12)',
    borderWidth: 1, borderColor: UI.ACCENT_COLOR,
  },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: '#555' },
  radioSelected: { borderColor: UI.ACCENT_COLOR, backgroundColor: UI.ACCENT_COLOR },
  rowText: { color: '#FFF', fontSize: 14, flex: 1 },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  emptyText: { color: '#555', fontSize: 15 },
  enrollLink: { color: UI.ACCENT_COLOR, fontSize: 15, textDecorationLine: 'underline' },
  startBtn: {
    backgroundColor: UI.ACCENT_COLOR, borderRadius: 12,
    paddingVertical: 16, alignItems: 'center', marginBottom: 24,
  },
  startBtnDisabled: { opacity: 0.4 },
  startBtnText: { fontSize: 17, fontWeight: '700', color: '#000' },
  loadingRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  container: { flex: 1, backgroundColor: '#000' },
  noCamera: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#111' },
  noCameraText: { color: '#555', fontSize: 16 },
  hiddenWebView: { width: 1, height: 1, opacity: 0, position: 'absolute' },
  livenessBox: { position: 'absolute', bottom: 240, left: 0, right: 0 },
  heartbeatBox: { position: 'absolute', bottom: 120, left: 0, right: 0 },
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

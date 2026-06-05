/**
 * verify.tsx — Identity Verification Screen
 *
 * Shows enrolled personnel by NAME (not UUID) in the selector.
 * Uses getEnrolledPersonnel() which returns { id, name, enrolled_at }.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, SafeAreaView,
  ActivityIndicator, FlatList,
} from 'react-native';
import { Camera, CameraType } from 'expo-camera';
import { useRouter, useFocusEffect } from 'expo-router';
import { useMediaPipeContext } from '@context/MediaPipeContext';
import { useFaceRecognition } from '@hooks/useFaceRecognition';
import { useCameraPipeline } from '@hooks/useCameraPipeline';
import CameraOverlay from '@components/CameraOverlay';
import LivenessIndicator from '@components/LivenessIndicator';
import HeartbeatPulse from '@components/HeartbeatPulse';
import ResultCard from '@components/ResultCard';
import { getEnrolledPersonnel } from '@database/vault';
import { UI, LIVENESS, RPPG } from '@config/constants';

interface Personnel { id: string; name: string; enrolled_at: number; }

export default function VerifyScreen() {
  const router = useRouter();

  const [permission, requestPermission] = Camera.useCameraPermissions();
  const cameraRef = useRef<Camera>(null);

  const [personnel, setPersonnel] = useState<Personnel[]>([]);
  const [selectedPersonnel, setSelectedPersonnel] = useState<Personnel | null>(null);
  const [loadingPersonnel, setLoadingPersonnel] = useState(true);
  const [holdSeconds, setHoldSeconds] = useState(0);
  const holdTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [isScanning, setIsScanning] = useState(false);

  const mediaPipe = useMediaPipeContext();
  const faceRecognition = useFaceRecognition();
  const pipeline = useCameraPipeline({ mediaPipe, faceRecognition });
  const frameIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { if (!permission?.granted) requestPermission(); }, []);

  useFocusEffect(useCallback(() => { loadPersonnel(); }, []));

  const loadPersonnel = async () => {
    try {
      const list = await getEnrolledPersonnel() as Personnel[];
      setPersonnel(list);
      if (list.length > 0) setSelectedPersonnel(list[0]);
    } catch (e) { console.error('[verify] loadPersonnel:', e); }
    finally { setLoadingPersonnel(false); }
  };

  // Hold-still countdown
  useEffect(() => {
    if (!isScanning) return;
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
  }, [pipeline.headInFrame, pipeline.blinkCount, isScanning]);

  useEffect(() => { if (pipeline.phase === 'done') stopCapture(); }, [pipeline.phase]);

  const startCapture = () => {
    if (!selectedPersonnel) return;
    setIsScanning(true);
    pipeline.startVerification(selectedPersonnel.id, selectedPersonnel.name);
    frameIntervalRef.current = setInterval(async () => {
      try {
        if (!cameraRef.current) return;
        const photo = await cameraRef.current.takePictureAsync({ base64: true, quality: 0.5 });
        if (photo.base64) await pipeline.submitFrame(`data:image/jpeg;base64,${photo.base64}`);
      } catch { /* ignore */ }
    }, 200);
  };

  const stopCapture = () => {
    if (frameIntervalRef.current) { clearInterval(frameIntervalRef.current); frameIntervalRef.current = null; }
  };

  const handleRetry = () => {
    setHoldSeconds(0); pipeline.reset(); setIsScanning(false); stopCapture();
  };

  const getInstruction = () => {
    if (!isScanning) return 'Select a person then tap Start Scan';
    if (!mediaPipe.ready) return 'Loading AI…';
    if (pipeline.blinkCount < LIVENESS.MIN_BLINKS) return 'Blink twice naturally';
    if (!pipeline.headInFrame) return 'Look directly at the camera';
    if (holdSeconds < 2) return `Hold still… ${2 - holdSeconds}s`;
    if (!pipeline.currentBpm) return 'Reading heartbeat…';
    return 'Matching identity…';
  };

  const livenessPass = pipeline.rPPGConfidence >= RPPG.CONFIDENCE_MIN
    && pipeline.geometricScore >= LIVENESS.GEOMETRIC_SCORE_MIN;

  // ── Personnel selector ─────────────────────────────────────────────────────

  if (!isScanning && pipeline.phase !== 'done') {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.prescan}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Verify Identity</Text>
          <Text style={styles.subtitle}>Select personnel then tap Start Scan.</Text>

          {loadingPersonnel ? (
            <ActivityIndicator color={UI.ACCENT_COLOR} size="large" />
          ) : personnel.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>No personnel enrolled yet.</Text>
              <TouchableOpacity onPress={() => router.push('/enroll')}>
                <Text style={styles.enrollLink}>Enroll someone first →</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <FlatList
              data={personnel}
              keyExtractor={p => p.id}
              style={styles.list}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.row, selectedPersonnel?.id === item.id && styles.rowSelected]}
                  onPress={() => setSelectedPersonnel(item)}
                >
                  <View style={[styles.radio, selectedPersonnel?.id === item.id && styles.radioOn]} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowName}>{item.name}</Text>
                    <Text style={styles.rowId} numberOfLines={1}>ID: {item.id.slice(0, 12)}…</Text>
                  </View>
                </TouchableOpacity>
              )}
            />
          )}

          <TouchableOpacity
            style={[styles.startBtn, (!selectedPersonnel || !mediaPipe.ready) && styles.startBtnOff]}
            onPress={startCapture}
            disabled={!selectedPersonnel || !mediaPipe.ready}
          >
            {!mediaPipe.ready ? (
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                <ActivityIndicator color="#000" size="small" />
                <Text style={styles.startBtnText}>Loading AI…</Text>
              </View>
            ) : (
              <Text style={styles.startBtnText}>
                {selectedPersonnel ? `Verify: ${selectedPersonnel.name}` : 'Start Scan'}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── Scanning ───────────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>
      {permission?.granted ? (
        <Camera ref={cameraRef} style={StyleSheet.absoluteFill} type={CameraType.front} />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.noCamera]}>
          <Text style={styles.noCameraText}>Camera permission required</Text>
        </View>
      )}


      <CameraOverlay phase={pipeline.phase} landmarks={null} livenessPass={livenessPass} instruction={getInstruction()} />

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
        <ResultCard result={pipeline.result} onRetry={handleRetry} onDone={() => router.back()} />
      ) : null}

      <SafeAreaView style={styles.topBar}>
        <TouchableOpacity style={styles.closeBtn} onPress={() => { stopCapture(); router.back(); }}>
          <Text style={styles.closeBtnText}>✕</Text>
        </TouchableOpacity>
        <Text style={styles.topBarTitle}>
          Verifying: {selectedPersonnel?.name ?? ''}
        </Text>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: UI.BACKGROUND_COLOR },
  prescan: { flex: 1, paddingHorizontal: 28, paddingTop: 60 },
  backBtn: { marginBottom: 32 },
  backText: { color: UI.ACCENT_COLOR, fontSize: 16 },
  title: { fontSize: 28, fontWeight: '700', color: '#FFF', marginBottom: 8 },
  subtitle: { fontSize: 14, color: '#888', lineHeight: 20, marginBottom: 24 },
  list: { flex: 1, marginBottom: 16 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 12, paddingHorizontal: 16, borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.05)', marginBottom: 8,
  },
  rowSelected: { backgroundColor: 'rgba(0,198,174,0.12)', borderWidth: 1, borderColor: UI.ACCENT_COLOR },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: '#555' },
  radioOn: { borderColor: UI.ACCENT_COLOR, backgroundColor: UI.ACCENT_COLOR },
  rowName: { color: '#FFF', fontSize: 15, fontWeight: '600' },
  rowId: { color: '#555', fontSize: 11, marginTop: 2 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  emptyText: { color: '#555', fontSize: 15 },
  enrollLink: { color: UI.ACCENT_COLOR, fontSize: 15, textDecorationLine: 'underline' },
  startBtn: { backgroundColor: UI.ACCENT_COLOR, borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginBottom: 24 },
  startBtnOff: { opacity: 0.4 },
  startBtnText: { fontSize: 17, fontWeight: '700', color: '#000' },
  container: { flex: 1, backgroundColor: '#000' },
  noCamera: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#111' },
  noCameraText: { color: '#555', fontSize: 16 },
  livenessBox: { position: 'absolute', bottom: 240, left: 0, right: 0 },
  heartbeatBox: { position: 'absolute', bottom: 120, left: 0, right: 0 },
  topBar: {
    position: 'absolute', top: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingTop: 12, gap: 12,
  },
  closeBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  closeBtnText: { color: '#FFF', fontSize: 16 },
  topBarTitle: { color: '#FFF', fontSize: 15, fontWeight: '600', flex: 1 },
});

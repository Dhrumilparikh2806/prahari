import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  ActivityIndicator, FlatList, Modal, StatusBar,
} from 'react-native';
import { Camera, CameraType } from 'expo-camera';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMediaPipeContext } from '@context/MediaPipeContext';
import { useFaceRecognition } from '@hooks/useFaceRecognition';
import { useCameraPipeline } from '@hooks/useCameraPipeline';
import CameraOverlay from '@components/CameraOverlay';
import LivenessIndicator from '@components/LivenessIndicator';
import HeartbeatPulse from '@components/HeartbeatPulse';
import ResultCard from '@components/ResultCard';
import { getEnrolledPersonnel } from '@database/vault';
import { TERRA, LIVENESS, RPPG } from '@config/constants';

interface Personnel { id: string; name: string; enrolled_at: number; }

export default function VerifyScreen() {
  const [permission, requestPermission] = Camera.useCameraPermissions();
  const cameraRef = useRef<Camera>(null);
  const [personnel, setPersonnel] = useState<Personnel[]>([]);
  const [selectedPersonnel, setSelectedPersonnel] = useState<Personnel | null>(null);
  const [loadingPersonnel, setLoadingPersonnel] = useState(true);
  const [holdSeconds, setHoldSeconds] = useState(0);
  const holdTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [isScanning, setIsScanning] = useState(false);

  const topPad = StatusBar.currentHeight ?? 0;
  const insets = useSafeAreaInsets();

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
    } catch (e) { console.error(e); }
    finally { setLoadingPersonnel(false); }
  };

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
      } catch {}
    }, 200);
  };

  const stopCapture = () => {
    if (frameIntervalRef.current) { clearInterval(frameIntervalRef.current); frameIntervalRef.current = null; }
  };
  const handleRetry = () => { setHoldSeconds(0); pipeline.reset(); setIsScanning(false); stopCapture(); };
  const livenessPass = pipeline.rPPGConfidence >= RPPG.CONFIDENCE_MIN && pipeline.geometricScore >= LIVENESS.GEOMETRIC_SCORE_MIN;
  const onCloseScan = () => { stopCapture(); pipeline.reset(); setIsScanning(false); };

  const scanInstruction =
    pipeline.blinkCount < LIVENESS.MIN_BLINKS ? 'Blink twice naturally' :
    !pipeline.headInFrame ? 'Look directly at camera' :
    holdSeconds < 2 ? `Hold still… ${2 - holdSeconds}s` :
    !pipeline.currentBpm ? 'Reading heartbeat…' : 'Matching identity…';

  return (
    <>
      {/* ── Scan Modal ─────────────────────────────────────────────────────── */}
      <Modal
        visible={isScanning || pipeline.phase === 'done'}
        animationType="slide"
        statusBarTranslucent
        onRequestClose={onCloseScan}
      >
        <View style={styles.scanContainer}>
          {permission?.granted ? (
            <Camera ref={cameraRef} style={StyleSheet.absoluteFill} type={CameraType.front} />
          ) : null}
          <CameraOverlay
            phase={pipeline.phase}
            landmarks={null}
            livenessPass={livenessPass}
            instruction={scanInstruction}
          />
          <View style={styles.scanLiveness}>
            <LivenessIndicator
              blinkCount={pipeline.blinkCount}
              headInFrame={pipeline.headInFrame}
              holdComplete={holdSeconds >= 2}
              bpm={pipeline.currentBpm}
              heartbeatDetected={pipeline.rPPGConfidence >= RPPG.CONFIDENCE_MIN}
            />
          </View>
          <View style={styles.scanHeartbeat}>
            <HeartbeatPulse
              bpm={pipeline.currentBpm}
              confidence={pipeline.rPPGConfidence}
              heartbeatDetected={pipeline.rPPGConfidence >= RPPG.CONFIDENCE_MIN}
              frameCount={pipeline.currentBpm > 0 ? RPPG.MIN_FRAMES : 0}
            />
          </View>
          {pipeline.phase === 'done' && pipeline.result ? (
            <ResultCard
              result={pipeline.result}
              onRetry={handleRetry}
              onDone={() => { stopCapture(); pipeline.reset(); setIsScanning(false); }}
            />
          ) : null}
          <View style={[styles.scanTopBar, { paddingTop: insets.top + 12 }]}>
            <TouchableOpacity style={styles.closeBtn} onPress={onCloseScan}>
              <Text style={styles.closeBtnText}>✕</Text>
            </TouchableOpacity>
            <Text style={styles.scanTitle}>Verifying: {selectedPersonnel?.name}</Text>
          </View>
        </View>
      </Modal>

      {/* ── Main Screen ────────────────────────────────────────────────────── */}
      <View style={[styles.container, { paddingTop: topPad }]}>

        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.appName}>Prahari</Text>
            <Text style={styles.screenSub}>Identity Verification</Text>
          </View>
          <TouchableOpacity style={styles.settingsBtn}>
            <Text style={styles.settingsIcon}>⚙</Text>
          </TouchableOpacity>
        </View>

        {/* Content */}
        <View style={styles.content}>

          {loadingPersonnel ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator color={TERRA.PRIMARY} size="large" />
              <Text style={styles.loadingText}>Loading personnel…</Text>
            </View>
          ) : personnel.length === 0 ? (
            <View style={styles.emptyBox}>
              <View style={styles.emptyIconBg}>
                <Text style={styles.emptyIcon}>◉</Text>
              </View>
              <Text style={styles.emptyTitle}>No Personnel Enrolled</Text>
              <Text style={styles.emptySub}>Enroll field staff first before running verification.</Text>
            </View>
          ) : (
            <>
              {/* Selected officer */}
              {selectedPersonnel ? (
                <View style={styles.officerCard}>
                  <View style={styles.officerAvatar}>
                    <Text style={styles.officerAvatarText}>
                      {selectedPersonnel.name.charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <View style={styles.officerInfo}>
                    <Text style={styles.officerRoleLabel}>ASSIGNED OFFICER</Text>
                    <Text style={styles.officerName}>{selectedPersonnel.name}</Text>
                  </View>
                  <Text style={styles.chevron}>›</Text>
                </View>
              ) : null}

              {/* Personnel list */}
              <Text style={styles.sectionLabel}>SELECT OFFICER</Text>
              <FlatList
                data={personnel}
                keyExtractor={p => p.id}
                style={styles.list}
                renderItem={({ item }) => {
                  const active = selectedPersonnel?.id === item.id;
                  return (
                    <TouchableOpacity
                      style={[styles.personnelRow, active && styles.personnelRowActive]}
                      onPress={() => setSelectedPersonnel(item)}
                    >
                      <View style={[styles.radio, active && styles.radioActive]}>
                        {active && <View style={styles.radioDot} />}
                      </View>
                      <Text style={[styles.personnelName, active && styles.personnelNameActive]}>
                        {item.name}
                      </Text>
                    </TouchableOpacity>
                  );
                }}
              />
            </>
          )}

          {/* Scan area */}
          <View style={styles.scanArea}>
            <View style={styles.scanCircle}>
              <Text style={styles.scanCircleIcon}>◉</Text>
            </View>
            <Text style={styles.scanHint}>Position face in the camera frame</Text>
          </View>

          {/* CTA */}
          <TouchableOpacity
            style={[styles.startBtn, (!selectedPersonnel || !mediaPipe.ready) && styles.startBtnDisabled]}
            onPress={startCapture}
            disabled={!selectedPersonnel || !mediaPipe.ready}
          >
            {!mediaPipe.ready ? (
              <View style={styles.btnRow}>
                <ActivityIndicator color="#fff" size="small" />
                <Text style={styles.startBtnText}>Loading AI…</Text>
              </View>
            ) : (
              <Text style={styles.startBtnText}>Start Scan</Text>
            )}
          </TouchableOpacity>

          <Text style={styles.sessionToken}>SESSION · PR-8821-X9</Text>
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8f5f0' },

  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 12,
  },
  appName: { fontSize: 22, fontWeight: '700', color: '#1c2b26', letterSpacing: -0.3 },
  screenSub: { fontSize: 12, color: '#627068', marginTop: 2 },
  settingsBtn: { padding: 8, marginTop: 4 },
  settingsIcon: { fontSize: 19, color: '#627068' },

  content: { flex: 1, paddingHorizontal: 20, paddingBottom: 16 },

  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 },
  loadingText: { fontSize: 14, color: '#627068' },

  emptyBox: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  emptyIconBg: {
    width: 72, height: 72, borderRadius: 22,
    backgroundColor: '#eef4f0', alignItems: 'center', justifyContent: 'center', marginBottom: 4,
  },
  emptyIcon: { fontSize: 32, color: TERRA.PRIMARY },
  emptyTitle: { fontSize: 17, fontWeight: '600', color: '#1c2b26' },
  emptySub: { fontSize: 13, color: '#627068', textAlign: 'center', paddingHorizontal: 20 },

  officerCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16, padding: 16,
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginBottom: 20,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 8,
    elevation: 1, borderWidth: 1, borderColor: '#e8e2d9',
  },
  officerAvatar: {
    width: 46, height: 46, borderRadius: 14,
    backgroundColor: '#eef4f0', alignItems: 'center', justifyContent: 'center',
  },
  officerAvatarText: { fontSize: 20, fontWeight: '700', color: TERRA.PRIMARY },
  officerInfo: { flex: 1 },
  officerRoleLabel: { fontSize: 9, fontWeight: '700', color: '#c4854a', letterSpacing: 1 },
  officerName: { fontSize: 16, fontWeight: '600', color: '#1c2b26', marginTop: 1 },
  chevron: { fontSize: 22, color: '#9aaba4' },

  sectionLabel: { fontSize: 11, fontWeight: '600', color: '#9aaba4', letterSpacing: 1.2, marginBottom: 8 },
  list: { maxHeight: 130, marginBottom: 16 },
  personnelRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 10, paddingHorizontal: 14,
    borderRadius: 12, marginBottom: 4,
    backgroundColor: '#ffffff',
    borderWidth: 1, borderColor: '#e8e2d9',
  },
  personnelRowActive: { borderColor: TERRA.PRIMARY, backgroundColor: '#eef4f0' },
  radio: {
    width: 18, height: 18, borderRadius: 9,
    borderWidth: 2, borderColor: '#c8d8ce',
    alignItems: 'center', justifyContent: 'center',
  },
  radioActive: { borderColor: TERRA.PRIMARY },
  radioDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: TERRA.PRIMARY },
  personnelName: { fontSize: 14, fontWeight: '500', color: '#1c2b26' },
  personnelNameActive: { fontWeight: '600', color: TERRA.PRIMARY },

  scanArea: { alignItems: 'center', paddingVertical: 20, marginBottom: 16 },
  scanCircle: {
    width: 100, height: 100, borderRadius: 50,
    borderWidth: 2, borderColor: TERRA.PRIMARY,
    borderStyle: 'dashed',
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#eef4f0',
    marginBottom: 10,
  },
  scanCircleIcon: { fontSize: 40, color: TERRA.PRIMARY },
  scanHint: { fontSize: 13, color: '#627068' },

  startBtn: {
    backgroundColor: TERRA.PRIMARY, borderRadius: 14,
    paddingVertical: 17, alignItems: 'center', marginBottom: 12,
    shadowColor: TERRA.PRIMARY, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.22, shadowRadius: 10, elevation: 3,
  },
  startBtnDisabled: { opacity: 0.4, shadowOpacity: 0 },
  startBtnText: { fontSize: 15, fontWeight: '700', color: '#fff', letterSpacing: 0.5 },
  btnRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  sessionToken: { textAlign: 'center', fontSize: 10, color: '#9aaba4', letterSpacing: 1.5 },

  // Scan modal
  scanContainer: { flex: 1, backgroundColor: '#000' },
  scanLiveness: { position: 'absolute', bottom: 240, left: 0, right: 0 },
  scanHeartbeat: { position: 'absolute', bottom: 120, left: 0, right: 0 },
  scanTopBar: {
    position: 'absolute', top: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingBottom: 12, gap: 12,
  },
  closeBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center',
  },
  closeBtnText: { color: '#fff', fontSize: 16 },
  scanTitle: { color: '#fff', fontSize: 15, fontWeight: '700', flex: 1 },
});

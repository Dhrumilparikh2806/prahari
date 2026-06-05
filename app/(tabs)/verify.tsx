/**
 * (tabs)/verify.tsx — Verify Identity · Terra Theme
 *
 * Layout: Officer card + Sector card + biometric scan area + Start Scan CTA
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, SafeAreaView,
  ActivityIndicator, FlatList, StatusBar,
} from 'react-native';
import { Camera, CameraType } from 'expo-camera';
import WebView from 'react-native-webview';
import { useFocusEffect } from 'expo-router';
import { useMediaPipeContext } from '@context/MediaPipeContext';
import { useFaceRecognition } from '@hooks/useFaceRecognition';
import { useCameraPipeline } from '@hooks/useCameraPipeline';
import CameraOverlay from '@components/CameraOverlay';
import LivenessIndicator from '@components/LivenessIndicator';
import HeartbeatPulse from '@components/HeartbeatPulse';
import ResultCard from '@components/ResultCard';
import { getEnrolledPersonnel } from '@database/vault';
import { TERRA, FONTS, LIVENESS, RPPG } from '@config/constants';

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
      } catch { }
    }, 200);
  };

  const stopCapture = () => {
    if (frameIntervalRef.current) { clearInterval(frameIntervalRef.current); frameIntervalRef.current = null; }
  };
  const handleRetry = () => { setHoldSeconds(0); pipeline.reset(); setIsScanning(false); stopCapture(); };
  const livenessPass = pipeline.rPPGConfidence >= RPPG.CONFIDENCE_MIN && pipeline.geometricScore >= LIVENESS.GEOMETRIC_SCORE_MIN;

  // ── Camera scanning overlay ──────────────────────────────────────────────────

  if (isScanning || pipeline.phase === 'done') {
    return (
      <View style={styles.scanContainer}>
        <StatusBar barStyle="light-content" />
        {permission?.granted ? (
          <Camera ref={cameraRef} style={StyleSheet.absoluteFill} type={CameraType.front} />
        ) : null}
        <CameraOverlay phase={pipeline.phase} landmarks={null} livenessPass={livenessPass}
          instruction={pipeline.blinkCount < LIVENESS.MIN_BLINKS ? 'Blink twice naturally' :
            !pipeline.headInFrame ? 'Look directly at camera' :
            holdSeconds < 2 ? `Hold still… ${2 - holdSeconds}s` :
            !pipeline.currentBpm ? 'Reading heartbeat…' : 'Matching identity…'} />
        <View style={styles.scanLiveness}>
          <LivenessIndicator blinkCount={pipeline.blinkCount} headInFrame={pipeline.headInFrame}
            holdComplete={holdSeconds >= 2} bpm={pipeline.currentBpm}
            heartbeatDetected={pipeline.rPPGConfidence >= RPPG.CONFIDENCE_MIN} />
        </View>
        <View style={styles.scanHeartbeat}>
          <HeartbeatPulse bpm={pipeline.currentBpm} confidence={pipeline.rPPGConfidence}
            heartbeatDetected={pipeline.rPPGConfidence >= RPPG.CONFIDENCE_MIN}
            frameCount={pipeline.currentBpm > 0 ? RPPG.MIN_FRAMES : 0} />
        </View>
        {pipeline.phase === 'done' && pipeline.result ? (
          <ResultCard result={pipeline.result} onRetry={handleRetry} onDone={() => { stopCapture(); pipeline.reset(); setIsScanning(false); }} />
        ) : null}
        <SafeAreaView style={styles.scanTopBar}>
          <TouchableOpacity style={styles.closeBtn} onPress={() => { stopCapture(); pipeline.reset(); setIsScanning(false); }}>
            <Text style={styles.closeBtnText}>✕</Text>
          </TouchableOpacity>
          <Text style={styles.scanTitle}>Verifying: {selectedPersonnel?.name}</Text>
        </SafeAreaView>
      </View>
    );
  }

  // ── Personnel selector ────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" backgroundColor={TERRA.BACKGROUND} />

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.headerShield}>◈</Text>
          <Text style={styles.headerTitle}>Prahari</Text>
        </View>
        <TouchableOpacity style={styles.settingsBtn}>
          <Text style={styles.settingsIcon}>⚙</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.content}>
        <Text style={styles.screenTitle}>VERIFY IDENTITY</Text>
        <Text style={styles.screenSub}>Select personnel then tap Start Scan.</Text>

        {loadingPersonnel ? (
          <ActivityIndicator color={TERRA.PRIMARY} size="large" style={{ marginTop: 40 }} />
        ) : personnel.length === 0 ? (
          /* ── Awaiting Input state (no personnel) ── */
          <View style={styles.awaitingBox}>
            <View style={styles.fingerprintBox}>
              <Text style={styles.fingerprintIcon}>◉</Text>
              <Text style={styles.awaitingLabel}>AWAITING INPUT</Text>
            </View>
            <Text style={styles.awaitingHint}>No personnel enrolled yet</Text>
          </View>
        ) : (
          <>
            {/* Officer card */}
            {selectedPersonnel ? (
              <View style={styles.officerCard}>
                <View style={styles.officerAvatar}>
                  <Text style={styles.officerAvatarText}>
                    {selectedPersonnel.name.charAt(0).toUpperCase()}
                  </Text>
                </View>
                <View style={styles.officerInfo}>
                  <Text style={styles.officerRole}>Assigned Officer</Text>
                  <Text style={styles.officerName}>{selectedPersonnel.name}</Text>
                </View>
                <Text style={styles.chevron}>›</Text>
              </View>
            ) : null}

            {/* Sector card */}
            <View style={styles.sectorCard}>
              <Text style={styles.sectorIcon}>▦</Text>
              <View>
                <Text style={styles.sectorRole}>Sector</Text>
                <Text style={styles.sectorName}>Strategic Perimeter B-4</Text>
              </View>
            </View>

            {/* Personnel list */}
            <FlatList
              data={personnel}
              keyExtractor={p => p.id}
              style={styles.list}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.personnelRow, selectedPersonnel?.id === item.id && styles.personnelRowActive]}
                  onPress={() => setSelectedPersonnel(item)}
                >
                  <View style={[styles.radioCircle, selectedPersonnel?.id === item.id && styles.radioActive]} />
                  <Text style={styles.personnelName}>{item.name}</Text>
                </TouchableOpacity>
              )}
            />
          </>
        )}

        {/* Scan area */}
        <View style={styles.scanArea}>
          <View style={styles.fingerprintBox}>
            <Text style={styles.fingerprintIcon}>◉</Text>
            <Text style={styles.awaitingLabel}>AWAITING INPUT</Text>
          </View>
          <Text style={styles.scanHint}>Place finger on the illuminated area</Text>
        </View>

        {/* CTA */}
        <TouchableOpacity
          style={[styles.startBtn, (!selectedPersonnel || !mediaPipe.ready) && styles.startBtnOff]}
          onPress={startCapture}
          disabled={!selectedPersonnel || !mediaPipe.ready}
        >
          {!mediaPipe.ready ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator color={TERRA.WHITE} size="small" />
              <Text style={styles.startBtnText}>Loading AI…</Text>
            </View>
          ) : (
            <Text style={styles.startBtnText}>
              {selectedPersonnel ? `START SCAN` : 'START SCAN'}
            </Text>
          )}
        </TouchableOpacity>

        <Text style={styles.sessionToken}>SESSION TOKEN: PR-8821-X9</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: TERRA.BACKGROUND },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 12 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerShield: { fontSize: 20, color: TERRA.PRIMARY },
  headerTitle: { fontSize: 18, fontWeight: "700", color: TERRA.TEXT },
  settingsBtn: { padding: 8 },
  settingsIcon: { fontSize: 20, color: TERRA.TEXT_SECONDARY },
  content: { flex: 1, paddingHorizontal: 20, paddingBottom: 16 },
  screenTitle: { fontSize: 28, fontFamily: FONTS.HEADLINE, color: TERRA.TEXT, letterSpacing: 1, marginBottom: 4 },
  screenSub: { fontSize: 13, color: TERRA.TEXT_SECONDARY, marginBottom: 20 },

  officerCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: TERRA.CARD, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: TERRA.BORDER, marginBottom: 10,
  },
  officerAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: TERRA.SURFACE, alignItems: 'center', justifyContent: 'center' },
  officerAvatarText: { fontSize: 18, fontWeight: "700", color: TERRA.PRIMARY },
  officerInfo: { flex: 1 },
  officerRole: { fontSize: 10, fontWeight: "600", color: TERRA.AMBER, letterSpacing: 0.5 },
  officerName: { fontSize: 15, fontWeight: "700", color: TERRA.TEXT },
  chevron: { fontSize: 20, color: TERRA.TEXT_MUTED },

  sectorCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: TERRA.CARD, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: TERRA.BORDER, marginBottom: 16,
  },
  sectorIcon: { fontSize: 20, color: TERRA.AMBER },
  sectorRole: { fontSize: 10, fontWeight: "600", color: TERRA.TEXT_MUTED, letterSpacing: 0.5 },
  sectorName: { fontSize: 14, fontWeight: "700", color: TERRA.TEXT },

  list: { maxHeight: 120, marginBottom: 12 },
  personnelRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, marginBottom: 4 },
  personnelRowActive: { backgroundColor: TERRA.PRIMARY_LIGHT },
  radioCircle: { width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: TERRA.BORDER },
  radioActive: { borderColor: TERRA.PRIMARY, backgroundColor: TERRA.PRIMARY },
  personnelName: { fontSize: 14, fontWeight: "600", color: TERRA.TEXT },

  scanArea: { alignItems: 'center', paddingVertical: 16, marginBottom: 16 },
  fingerprintBox: {
    width: 140, height: 140, borderRadius: 16,
    borderWidth: 2, borderColor: TERRA.PRIMARY, borderStyle: 'dashed',
    alignItems: 'center', justifyContent: 'center', marginBottom: 8,
    backgroundColor: TERRA.PRIMARY_LIGHT,
  },
  fingerprintIcon: { fontSize: 48, color: TERRA.PRIMARY, marginBottom: 4 },
  awaitingLabel: { fontSize: 9, fontWeight: "700", color: TERRA.PRIMARY, letterSpacing: 2 },
  awaitingHint: { fontSize: 12, color: TERRA.TEXT_SECONDARY },
  scanHint: { fontSize: 12, color: TERRA.TEXT_SECONDARY },

  startBtn: { backgroundColor: TERRA.PRIMARY, borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginBottom: 10 },
  startBtnOff: { opacity: 0.4 },
  startBtnText: { fontSize: 15, fontWeight: "700", color: TERRA.WHITE, letterSpacing: 1.5 },
  loadingRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  sessionToken: { textAlign: 'center', fontSize: 10, color: TERRA.TEXT_MUTED, letterSpacing: 1 },
  awaitingBox: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },

  // Scan overlay
  scanContainer: { flex: 1, backgroundColor: '#000' },
  scanLiveness: { position: 'absolute', bottom: 240, left: 0, right: 0 },
  scanHeartbeat: { position: 'absolute', bottom: 120, left: 0, right: 0 },
  scanTopBar: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 12, gap: 12 },
  closeBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  closeBtnText: { color: '#FFF', fontSize: 16 },
  scanTitle: { color: '#FFF', fontSize: 15, fontWeight: "700", flex: 1 },
});

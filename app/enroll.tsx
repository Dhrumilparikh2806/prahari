/**
 * enroll.tsx — Enroll Personnel · Terra Theme
 *
 * Layout: Header + camera viewfinder with face overlay +
 *         Full Name input + Compliance Check + START FACE SCAN CTA
 */

import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  Alert, KeyboardAvoidingView, Platform,
  ScrollView, StatusBar, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Camera, CameraType } from 'expo-camera';
import { useRouter } from 'expo-router';
import { useMediaPipeContext } from '@context/MediaPipeContext';
import { useFaceRecognition } from '@hooks/useFaceRecognition';
import { useCameraPipeline } from '@hooks/useCameraPipeline';
import CameraOverlay from '@components/CameraOverlay';
import LivenessIndicator from '@components/LivenessIndicator';
import ResultCard from '@components/ResultCard';
import { TERRA, FONTS, LIVENESS } from '@config/constants';

type ScreenState = 'setup' | 'scanning' | 'done';

const COMPLIANCE_CHECKS = [
  'Official identification document present',
  'High-contrast ambient lighting environment',
  'Neutral facial expression required for scan',
];

export default function EnrollScreen() {
  const router = useRouter();
  const [permission, requestPermission] = Camera.useCameraPermissions();
  const cameraRef = useRef<Camera>(null);

  const [screenState, setScreenState] = useState<ScreenState>('setup');
  const [personnelName, setPersonnelName] = useState('');
  const [holdSeconds, setHoldSeconds] = useState(0);
  const holdTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const mediaPipe = useMediaPipeContext();
  const faceRecognition = useFaceRecognition();
  const pipeline = useCameraPipeline({ mediaPipe, faceRecognition });
  const frameIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { if (!permission?.granted) requestPermission(); }, []);

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
        if (photo.base64) await pipeline.submitFrame(`data:image/jpeg;base64,${photo.base64}`);
      } catch { }
    }, 200);
  };

  const stopCapture = () => {
    if (frameIntervalRef.current) { clearInterval(frameIntervalRef.current); frameIntervalRef.current = null; }
  };

  const handleStartScan = () => {
    const name = personnelName.trim();
    if (name.length < 2) { Alert.alert('Name Required', 'Enter the personnel\'s full name.'); return; }
    startCapture(name);
  };

  const handleRetry = () => {
    setHoldSeconds(0); pipeline.reset(); setScreenState('scanning'); startCapture(personnelName.trim());
  };

  const livenessPass = pipeline.rPPGConfidence >= 0.5 && pipeline.geometricScore >= 0.7;
  const isNameValid = personnelName.trim().length >= 2;

  const instr = !mediaPipe.ready ? 'Initialising AI…' :
    pipeline.blinkCount < LIVENESS.MIN_BLINKS ? 'Blink naturally twice' :
    !pipeline.headInFrame ? 'Look straight at the camera' :
    holdSeconds < 2 ? `Hold still… ${2 - holdSeconds}s` :
    !pipeline.currentBpm ? 'Reading heartbeat…' : 'Capturing face data…';

  const isInScan = screenState === 'scanning' || screenState === 'done';

  return (
    <>
      {/* ── Full-screen scanning Modal ─────────────────────────────────────── */}
      <Modal
        visible={isInScan}
        animationType="slide"
        statusBarTranslucent
        onRequestClose={() => { stopCapture(); router.back(); }}
      >
        <View style={styles.scanContainer}>
          <StatusBar barStyle="light-content" backgroundColor="#000" />
          {permission?.granted ? (
            <Camera ref={cameraRef} style={StyleSheet.absoluteFill} type={CameraType.front} />
          ) : null}
          <CameraOverlay phase={pipeline.phase} landmarks={null} livenessPass={livenessPass} instruction={instr} />
          <View style={styles.scanLiveness}>
            <LivenessIndicator blinkCount={pipeline.blinkCount} headInFrame={pipeline.headInFrame}
              holdComplete={holdSeconds >= 2} bpm={pipeline.currentBpm}
              heartbeatDetected={pipeline.rPPGConfidence >= 0.5} />
          </View>
          {screenState === 'done' && pipeline.result ? (
            <ResultCard result={pipeline.result} onRetry={handleRetry} onDone={() => router.back()} />
          ) : null}
          <SafeAreaView style={styles.scanTopBar} edges={['top']}>
            <TouchableOpacity style={styles.closeBtn} onPress={() => { stopCapture(); router.back(); }}>
              <Text style={styles.closeBtnText}>✕</Text>
            </TouchableOpacity>
            <Text style={styles.scanTopTitle}>Enrolling: {personnelName}</Text>
          </SafeAreaView>
        </View>
      </Modal>

      {/* ── Setup view ──────────────────────────────────────────────────────── */}
      <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

          <View style={styles.header}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
              <Text style={styles.backIcon}>‹</Text>
            </TouchableOpacity>
            <View style={styles.headerLeft}>
              <Text style={styles.headerShield}>◈</Text>
              <Text style={styles.headerTitle}>Prahari</Text>
            </View>
            <TouchableOpacity style={styles.settingsBtn}>
              <Text style={styles.settingsIcon}>⚙</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.screenTitle}>ENROLL PERSONNEL</Text>
          <Text style={styles.screenSub}>Enter the full name before scanning the face.</Text>

          <View style={styles.viewfinder}>
            {permission?.granted ? (
              <Camera ref={cameraRef} style={StyleSheet.absoluteFill} type={CameraType.front} />
            ) : (
              <View style={[StyleSheet.absoluteFill, styles.noCamera]}>
                <Text style={styles.noCameraText}>Camera</Text>
              </View>
            )}
            <View style={styles.faceGuide}>
              <View style={styles.faceCircle}>
                <Text style={styles.faceIcon}>◎</Text>
              </View>
            </View>
            <View style={styles.readyBanner}>
              <Text style={styles.readyText}>READY FOR CAPTURE</Text>
            </View>
          </View>

          <Text style={styles.fieldLabel}>FULL NAME</Text>
          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              placeholder="e.g. RA राजेश KUMAR"
              placeholderTextColor={TERRA.TEXT_MUTED}
              value={personnelName}
              onChangeText={setPersonnelName}
              autoCapitalize="words"
              returnKeyType="done"
              maxLength={60}
            />
            <TouchableOpacity style={styles.editBtn}>
              <Text style={styles.editIcon}>✎</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.complianceCard}>
            <View style={styles.complianceHeader}>
              <Text style={styles.complianceCheck}>✓</Text>
              <Text style={styles.complianceTitle}>Compliance Check</Text>
            </View>
            {COMPLIANCE_CHECKS.map((item, i) => (
              <View key={i} style={styles.complianceItem}>
                <Text style={styles.complianceItemIcon}>✓</Text>
                <Text style={styles.complianceItemText}>{item}</Text>
              </View>
            ))}
          </View>

          <TouchableOpacity
            style={[styles.startBtn, !isNameValid && styles.startBtnOff]}
            onPress={handleStartScan}
            disabled={!isNameValid}
          >
            <Text style={styles.startIcon}>◎</Text>
            <Text style={styles.startBtnText}>START FACE SCAN</Text>
          </TouchableOpacity>

          <View style={styles.footer}>
            <Text style={styles.footerText}>OPERATOR ID: PRH-9921-X</Text>
            <Text style={styles.footerText}>SYSTEM TIMESTAMP: {new Date().toISOString().slice(0, 16).replace('T', ' ')}</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: TERRA.BACKGROUND },
  content: { paddingHorizontal: 20, paddingBottom: 40 },

  header: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 8 },
  backBtn: { padding: 8 },
  backIcon: { fontSize: 24, color: TERRA.PRIMARY },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  headerShield: { fontSize: 20, color: TERRA.PRIMARY },
  headerTitle: { fontSize: 18, fontWeight: "700", color: TERRA.TEXT },
  settingsBtn: { padding: 8 },
  settingsIcon: { fontSize: 20, color: TERRA.TEXT_SECONDARY },

  screenTitle: { fontSize: 26, fontFamily: FONTS.HEADLINE, color: TERRA.TEXT, letterSpacing: 1, marginBottom: 4 },
  screenSub: { fontSize: 13, color: TERRA.TEXT_SECONDARY, marginBottom: 16 },

  // Viewfinder
  viewfinder: { height: 200, borderRadius: 16, overflow: 'hidden', backgroundColor: TERRA.SURFACE, marginBottom: 20, position: 'relative' },
  noCamera: { alignItems: 'center', justifyContent: 'center' },
  noCameraText: { fontSize: 14, color: TERRA.TEXT_MUTED },
  faceGuide: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  faceCircle: { width: 80, height: 80, borderRadius: 40, borderWidth: 2, borderColor: TERRA.PRIMARY, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(74,124,89,0.15)' },
  faceIcon: { fontSize: 32, color: TERRA.PRIMARY },
  readyBanner: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: TERRA.AMBER, paddingVertical: 8, alignItems: 'center' },
  readyText: { fontSize: 11, fontWeight: "700", color: TERRA.WHITE, letterSpacing: 2 },

  // Input
  fieldLabel: { fontSize: 10, fontWeight: "700", color: TERRA.PRIMARY, letterSpacing: 2, marginBottom: 8 },
  inputRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: TERRA.CARD, borderRadius: 10, borderWidth: 1, borderColor: TERRA.BORDER, paddingHorizontal: 14, marginBottom: 16 },
  input: { flex: 1, fontSize: 15, color: TERRA.TEXT, paddingVertical: 14 },
  editBtn: { padding: 8 },
  editIcon: { fontSize: 16, color: TERRA.TEXT_MUTED },

  // Compliance
  complianceCard: { backgroundColor: TERRA.CARD, borderRadius: 12, padding: 16, marginBottom: 20, borderWidth: 1, borderColor: TERRA.BORDER },
  complianceHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  complianceCheck: { fontSize: 18, color: TERRA.PRIMARY },
  complianceTitle: { fontSize: 15, fontWeight: "700", color: TERRA.TEXT },
  complianceItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 8 },
  complianceItemIcon: { fontSize: 13, color: TERRA.PRIMARY, marginTop: 1 },
  complianceItemText: { flex: 1, fontSize: 13, color: TERRA.TEXT_SECONDARY, lineHeight: 18 },

  // CTA
  startBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: TERRA.PRIMARY, borderRadius: 12, paddingVertical: 18, marginBottom: 16 },
  startBtnOff: { opacity: 0.4 },
  startIcon: { fontSize: 18, color: TERRA.WHITE },
  startBtnText: { fontSize: 15, fontWeight: "700", color: TERRA.WHITE, letterSpacing: 1.5 },

  // Footer
  footer: { flexDirection: 'row', justifyContent: 'space-between' },
  footerText: { fontSize: 9, color: TERRA.TEXT_MUTED },

  // Scanning overlay
  scanContainer: { flex: 1, backgroundColor: '#000' },
  scanLiveness: { position: 'absolute', bottom: 120, left: 0, right: 0 },
  scanTopBar: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 12, gap: 12 },
  closeBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  closeBtnText: { color: '#FFF', fontSize: 16 },
  scanTopTitle: { color: '#FFF', fontSize: 15, fontWeight: "700", flex: 1 },
});

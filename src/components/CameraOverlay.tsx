/**
 * CameraOverlay.tsx — Face Guide Frame + Landmark Visualisation
 *
 * Renders on top of the camera view to guide the user into position.
 * Uses pure React Native (no Skia dependency) for maximum compatibility:
 *   • Oval face guide built from two half-circles + a rectangle
 *   • Animated border colour: grey → white → green
 *   • Instruction text below the oval
 *   • 6 key landmark dots when landmarks are present
 *
 * Kept dependency-free (no @shopify/react-native-skia) so it works in every
 * Expo build profile including development builds.
 */

import React, { useEffect, useRef } from 'react';
import { StyleSheet, Text, View, Dimensions, Animated } from 'react-native';
import type { FaceLandmark } from '@hooks/useMediaPipe';
import type { PipelinePhase } from '@hooks/useCameraPipeline';
import { UI, LIVENESS } from '@config/constants';

// ─── Types ────────────────────────────────────────────────────────────────────

interface CameraOverlayProps {
  phase: PipelinePhase;
  landmarks: FaceLandmark[] | null;
  livenessPass: boolean;
  instruction: string;
  frameWidth?: number;
  frameHeight?: number;
}

// ─── Key landmark indices ─────────────────────────────────────────────────────

const KEY_LANDMARKS = [33, 263, 1, 61, 291, 152];

// ─── Dimensions ───────────────────────────────────────────────────────────────

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const OVAL_W = SCREEN_W * UI.OVAL_WIDTH_RATIO;
const OVAL_H = OVAL_W * 1.35;
const OVAL_X = (SCREEN_W - OVAL_W) / 2;
const OVAL_Y = SCREEN_H * UI.OVAL_TOP_RATIO;

const COLOR_IDLE     = '#555555';
const COLOR_DETECTED = '#FFFFFF';
const COLOR_LIVE     = '#00FF88';

// ─── Component ────────────────────────────────────────────────────────────────

const CameraOverlay: React.FC<CameraOverlayProps> = ({
  phase,
  landmarks,
  livenessPass,
  instruction,
}) => {
  const borderColorAnim = useRef(new Animated.Value(0)).current;

  // 0 = idle (grey), 1 = face detected (white), 2 = liveness pass (green)
  useEffect(() => {
    const toValue = livenessPass ? 2 : (phase === 'liveness' || phase === 'detecting') ? 1 : 0;
    Animated.timing(borderColorAnim, {
      toValue,
      duration: UI.STEP_ANIMATION_MS,
      useNativeDriver: false,
    }).start();
  }, [phase, livenessPass]);

  const borderColor = borderColorAnim.interpolate({
    inputRange: [0, 1, 2],
    outputRange: [COLOR_IDLE, COLOR_DETECTED, COLOR_LIVE],
  });

  // ── Landmark dots ──────────────────────────────────────────────────────────

  const renderLandmarks = () => {
    if (!landmarks) return null;
    return KEY_LANDMARKS.map((idx, i) => {
      const lm = landmarks[idx];
      if (!lm) return null;
      const dotX = OVAL_X + lm.x * OVAL_W - 4;
      const dotY = OVAL_Y + lm.y * OVAL_H - 4;
      return (
        <View
          key={i}
          style={[
            styles.landmarkDot,
            {
              left: dotX,
              top: dotY,
              backgroundColor: livenessPass ? COLOR_LIVE : '#00BFFF',
            },
          ]}
        />
      );
    });
  };

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {/* ── Dark overlay (4 panels around the oval) ── */}
      {/* Top panel */}
      <View style={[styles.panel, { top: 0, left: 0, right: 0, height: OVAL_Y }]} />
      {/* Bottom panel */}
      <View style={[styles.panel, { top: OVAL_Y + OVAL_H, left: 0, right: 0, bottom: 0 }]} />
      {/* Left panel */}
      <View style={[styles.panel, { top: OVAL_Y, left: 0, width: OVAL_X, height: OVAL_H }]} />
      {/* Right panel */}
      <View style={[styles.panel, { top: OVAL_Y, left: OVAL_X + OVAL_W, right: 0, height: OVAL_H }]} />

      {/* ── Oval border ── */}
      <Animated.View
        style={[
          styles.oval,
          {
            left: OVAL_X,
            top: OVAL_Y,
            width: OVAL_W,
            height: OVAL_H,
            borderColor,
          },
        ]}
      />

      {/* ── Landmark dots ── */}
      {renderLandmarks()}

      {/* ── Instruction text ── */}
      <View style={[styles.instructionBox, { top: OVAL_Y + OVAL_H + 24 }]}>
        <Text style={styles.instructionText}>{instruction}</Text>
      </View>

      {/* ── Top branding ── */}
      <View style={styles.topBar}>
        <Text style={styles.appName}>PRAHARI</Text>
        <View style={[
          styles.statusDot,
          { backgroundColor: livenessPass ? COLOR_LIVE : '#FFFFFF' },
        ]} />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  panel: {
    position: 'absolute',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  oval: {
    position: 'absolute',
    borderRadius: 999,
    borderWidth: 2.5,
  },
  landmarkDot: {
    position: 'absolute',
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  instructionBox: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  instructionText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '500',
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.9)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  topBar: {
    position: 'absolute',
    top: 52,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  appName: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 4,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});

export default CameraOverlay;

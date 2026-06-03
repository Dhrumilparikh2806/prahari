/**
 * HeartbeatPulse.tsx — Animated BPM Display Component
 *
 * Shows a beating heart icon that pulses at the detected BPM, a signal
 * strength bar, and a status label.
 *
 * States:
 *   collecting  — "Reading pulse..." spinner (fewer than MIN_FRAMES frames)
 *   detected    — "72 BPM — LIVE" with pulsing heart
 *   failed      — "No heartbeat — Spoof?" in red
 */

import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { UI, RPPG } from '@config/constants';

// ─── Types ────────────────────────────────────────────────────────────────────

interface HeartbeatPulseProps {
  /** Detected BPM (0 while collecting) */
  bpm: number;
  /** Signal confidence [0, 1] */
  confidence: number;
  /** True when heartbeatDetected = true from the rPPG hook */
  heartbeatDetected: boolean;
  /** Number of frames collected so far */
  frameCount: number;
}

// ─── Component ────────────────────────────────────────────────────────────────

const HeartbeatPulse: React.FC<HeartbeatPulseProps> = ({
  bpm,
  confidence,
  heartbeatDetected,
  frameCount,
}) => {
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const pulseRef = useRef<Animated.CompositeAnimation | null>(null);

  // Start / stop the heart pulse animation at the detected BPM
  useEffect(() => {
    if (pulseRef.current) {
      pulseRef.current.stop();
      pulseRef.current = null;
    }

    if (!heartbeatDetected || bpm <= 0) return;

    // BPM → interval in ms between beats
    const intervalMs = (60 / bpm) * 1000;

    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.4,
          duration: intervalMs * 0.2,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: intervalMs * 0.8,
          useNativeDriver: true,
        }),
      ])
    );

    pulseRef.current = pulse;
    pulse.start();

    return () => {
      pulse.stop();
      pulseAnim.setValue(1);
    };
  }, [bpm, heartbeatDetected]);

  // ── Spinner for collecting phase ───────────────────────────────────────────

  const isCollecting = frameCount < RPPG.MIN_FRAMES;
  const spinAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!isCollecting) return;

    const spin = Animated.loop(
      Animated.timing(spinAnim, {
        toValue: 1,
        duration: 1200,
        useNativeDriver: true,
      })
    );
    spin.start();
    return () => spin.stop();
  }, [isCollecting]);

  const spinRotation = spinAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  // ── Status text ────────────────────────────────────────────────────────────

  const getStatusLabel = () => {
    if (isCollecting) {
      const progress = Math.round((frameCount / RPPG.MIN_FRAMES) * 100);
      return `Reading pulse… ${progress}%`;
    }
    if (heartbeatDetected) return `${bpm} BPM — LIVE`;
    if (bpm > 0) return `${bpm} BPM — Verifying…`;
    return 'No heartbeat detected';
  };

  const statusColor = heartbeatDetected
    ? UI.ACCENT_COLOR
    : isCollecting
    ? '#FFFFFF'
    : '#FF4444';

  // ── Signal strength bar ────────────────────────────────────────────────────

  const barWidth = `${Math.round(Math.min(confidence, 1) * 100)}%`;

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        {/* Heart icon or spinner */}
        {isCollecting ? (
          <Animated.Text style={[styles.icon, { transform: [{ rotate: spinRotation }] }]}>
            ◌
          </Animated.Text>
        ) : (
          <Animated.Text
            style={[styles.icon, { transform: [{ scale: pulseAnim }] }]}
          >
            {heartbeatDetected ? '♥' : '♡'}
          </Animated.Text>
        )}

        {/* BPM label */}
        <Text style={[styles.statusLabel, { color: statusColor }]}>
          {getStatusLabel()}
        </Text>
      </View>

      {/* Signal strength bar */}
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: barWidth as any }]} />
      </View>

      <Text style={styles.barLabel}>Signal strength</Text>
    </View>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    backgroundColor: 'rgba(0,0,0,0.75)',
    borderRadius: 12,
    padding: 12,
    marginHorizontal: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  icon: {
    fontSize: 22,
    color: '#FF4D6D',
    marginRight: 10,
  },
  statusLabel: {
    fontSize: 15,
    fontWeight: '600',
    flex: 1,
  },
  barTrack: {
    height: 4,
    backgroundColor: '#333333',
    borderRadius: 2,
    overflow: 'hidden',
  },
  barFill: {
    height: 4,
    backgroundColor: UI.ACCENT_COLOR,
    borderRadius: 2,
  },
  barLabel: {
    color: '#666666',
    fontSize: 11,
    marginTop: 4,
  },
});

export default HeartbeatPulse;

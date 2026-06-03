/**
 * ResultCard.tsx — Full-Screen Pass / Fail Result Display
 *
 * Shown after the biometric pipeline completes (phase === 'done').
 *
 * Pass state:
 *   Green background, personnel name, confidence %, BPM, latency, timestamp.
 *
 * Fail state:
 *   Red background, failure reason (e.g., "Spoof detected — no heartbeat"),
 *   Retry button.
 *
 * The card slides in from the bottom using React Native's Animated API.
 */

import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  TouchableOpacity,
  Dimensions,
} from 'react-native';
import type { PipelineResult } from '@hooks/useCameraPipeline';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ResultCardProps {
  result: PipelineResult;
  /** Called when the user taps "Retry" on a failed result */
  onRetry: () => void;
  /** Called when the user taps "Done" on a success result */
  onDone: () => void;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SCREEN_H = Dimensions.get('window').height;

// ─── Metric Row ───────────────────────────────────────────────────────────────

const MetricRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <View style={styles.metricRow}>
    <Text style={styles.metricLabel}>{label}</Text>
    <Text style={styles.metricValue}>{value}</Text>
  </View>
);

// ─── Component ────────────────────────────────────────────────────────────────

const ResultCard: React.FC<ResultCardProps> = ({ result, onRetry, onDone }) => {
  const slideAnim = useRef(new Animated.Value(SCREEN_H)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(slideAnim, {
        toValue: 0,
        tension: 80,
        friction: 12,
        useNativeDriver: true,
      }),
      Animated.timing(opacityAnim, {
        toValue: 1,
        duration: 250,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  const backgroundColor = result.passed ? '#003D26' : '#3D0000';
  const accentColor = result.passed ? '#00FF88' : '#FF4444';

  // Format timestamp
  const timestamp = new Date().toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  return (
    <Animated.View
      style={[
        styles.overlay,
        { opacity: opacityAnim },
      ]}
    >
      <Animated.View
        style={[
          styles.card,
          { backgroundColor, transform: [{ translateY: slideAnim }] },
        ]}
      >
        {/* Status icon */}
        <Text style={[styles.statusIcon, { color: accentColor }]}>
          {result.passed ? '✓' : '✕'}
        </Text>

        {/* Status title */}
        <Text style={[styles.statusTitle, { color: accentColor }]}>
          {result.passed ? 'Identity Verified' : 'Verification Failed'}
        </Text>

        {/* Personnel name on pass */}
        {result.passed && result.name ? (
          <Text style={styles.personName}>{result.name}</Text>
        ) : null}

        {/* Failure reason */}
        {!result.passed && result.failureReason ? (
          <Text style={styles.failureReason}>{result.failureReason}</Text>
        ) : null}

        {/* Metrics grid */}
        <View style={styles.metricsContainer}>
          {result.confidence != null ? (
            <MetricRow
              label="Confidence"
              value={`${(result.confidence * 100).toFixed(1)}%`}
            />
          ) : null}
          {result.bpm != null && result.bpm > 0 ? (
            <MetricRow label="Heart Rate" value={`${result.bpm} BPM`} />
          ) : null}
          {result.latencyMs != null ? (
            <MetricRow label="Pipeline" value={`${result.latencyMs} ms`} />
          ) : null}
          <MetricRow label="Time" value={timestamp} />
        </View>

        {/* Anti-spoof note on fail */}
        {!result.passed && result.failureReason?.includes('heartbeat') ? (
          <View style={styles.spoofBadge}>
            <Text style={styles.spoofBadgeText}>
              ⚠ SPOOF DETECTED — Photo / Screen replay rejected
            </Text>
          </View>
        ) : null}

        {/* Action button */}
        <TouchableOpacity
          style={[styles.actionButton, { backgroundColor: accentColor }]}
          onPress={result.passed ? onDone : onRetry}
          activeOpacity={0.8}
        >
          <Text style={styles.actionButtonText}>
            {result.passed ? 'Done' : 'Retry'}
          </Text>
        </TouchableOpacity>
      </Animated.View>
    </Animated.View>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  card: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 28,
    paddingTop: 32,
    paddingBottom: 48,
    alignItems: 'center',
  },
  statusIcon: {
    fontSize: 56,
    fontWeight: '700',
    marginBottom: 8,
  },
  statusTitle: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 4,
    textAlign: 'center',
  },
  personName: {
    fontSize: 28,
    fontWeight: '300',
    color: '#FFFFFF',
    marginTop: 8,
    marginBottom: 4,
    textAlign: 'center',
  },
  failureReason: {
    fontSize: 15,
    color: '#FF8888',
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 22,
  },
  metricsContainer: {
    width: '100%',
    marginTop: 24,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: 12,
    padding: 16,
  },
  metricRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  metricLabel: {
    color: '#AAAAAA',
    fontSize: 14,
  },
  metricValue: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  spoofBadge: {
    marginTop: 16,
    backgroundColor: 'rgba(255,68,68,0.2)',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#FF4444',
  },
  spoofBadgeText: {
    color: '#FF8888',
    fontSize: 12,
    textAlign: 'center',
    fontWeight: '600',
  },
  actionButton: {
    marginTop: 28,
    paddingHorizontal: 48,
    paddingVertical: 14,
    borderRadius: 28,
    width: '100%',
    alignItems: 'center',
  },
  actionButtonText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#000000',
    letterSpacing: 0.5,
  },
});

export default ResultCard;

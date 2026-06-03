/**
 * LivenessIndicator.tsx — Step-by-Step Liveness Check Progress Tracker
 *
 * Shows four sequential liveness steps with animated checkmarks:
 *
 *   1. Blink twice          — blinks via EAR detection
 *   2. Head straight        — yaw/pitch within bounds
 *   3. Hold still 2s        — countdown timer once head is in frame
 *   4. Heartbeat reading    — rPPG BPM display
 *
 * Each step animates from grey → green with a checkmark when its condition
 * is satisfied.  The component is purely presentational — it receives state
 * from the parent screen and does not contain any detection logic.
 */

import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { UI } from '@config/constants';

// ─── Types ────────────────────────────────────────────────────────────────────

interface LivenessStep {
  label: string;
  subLabel?: string;
  done: boolean;
}

interface LivenessIndicatorProps {
  /** Number of blinks detected so far */
  blinkCount: number;
  /** True when head yaw/pitch is within bounds */
  headInFrame: boolean;
  /** True after 2 continuous seconds of head-in-frame */
  holdComplete: boolean;
  /** Detected BPM (0 while still collecting) */
  bpm: number;
  /** True when heartbeat has been confirmed */
  heartbeatDetected: boolean;
}

// ─── Step Row Component ───────────────────────────────────────────────────────

const StepRow: React.FC<{ step: LivenessStep; index: number }> = ({ step, index }) => {
  // Animated value for the green fill: 0 = grey, 1 = green
  const fillAnim = useRef(new Animated.Value(0)).current;
  const checkAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (step.done) {
      Animated.parallel([
        Animated.timing(fillAnim, {
          toValue: 1,
          duration: UI.STEP_ANIMATION_MS,
          useNativeDriver: false,
        }),
        Animated.spring(checkAnim, {
          toValue: 1,
          tension: 120,
          friction: 8,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.timing(fillAnim, {
        toValue: 0,
        duration: 150,
        useNativeDriver: false,
      }).start();
      checkAnim.setValue(0);
    }
  }, [step.done]);

  const circleColor = fillAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['#333333', UI.ACCENT_COLOR],
  });

  const borderColor = fillAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['#555555', UI.ACCENT_COLOR],
  });

  const checkScale = checkAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
  });

  return (
    <View style={styles.stepRow}>
      {/* Step number / checkmark circle */}
      <Animated.View style={[styles.stepCircle, { backgroundColor: circleColor, borderColor }]}>
        {step.done ? (
          <Animated.Text style={[styles.checkMark, { transform: [{ scale: checkScale }] }]}>
            ✓
          </Animated.Text>
        ) : (
          <Text style={styles.stepNumber}>{index + 1}</Text>
        )}
      </Animated.View>

      {/* Step text */}
      <View style={styles.stepTextContainer}>
        <Text style={[styles.stepLabel, step.done && styles.stepLabelDone]}>
          {step.label}
        </Text>
        {step.subLabel ? (
          <Text style={styles.stepSubLabel}>{step.subLabel}</Text>
        ) : null}
      </View>
    </View>
  );
};

// ─── Main Component ───────────────────────────────────────────────────────────

const LivenessIndicator: React.FC<LivenessIndicatorProps> = ({
  blinkCount,
  headInFrame,
  holdComplete,
  bpm,
  heartbeatDetected,
}) => {
  const steps: LivenessStep[] = [
    {
      label: `Blink twice (${Math.min(blinkCount, 2)}/2)`,
      done: blinkCount >= 2,
    },
    {
      label: 'Look straight at camera',
      subLabel: headInFrame ? 'Head position: OK' : 'Adjust your angle',
      done: headInFrame,
    },
    {
      label: 'Hold still for 2 seconds',
      done: holdComplete,
    },
    {
      label: heartbeatDetected
        ? `Heartbeat: ${bpm} BPM — LIVE`
        : bpm > 0
        ? `Reading pulse: ${bpm} BPM…`
        : 'Detecting heartbeat…',
      done: heartbeatDetected,
    },
  ];

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Liveness Check</Text>
      {steps.map((step, i) => (
        <StepRow key={i} step={step} index={i} />
      ))}
    </View>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    backgroundColor: 'rgba(0,0,0,0.75)',
    borderRadius: 16,
    padding: 16,
    marginHorizontal: 16,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 12,
    opacity: 0.6,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  stepCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  checkMark: {
    color: '#000000',
    fontSize: 14,
    fontWeight: '700',
  },
  stepNumber: {
    color: '#888888',
    fontSize: 12,
    fontWeight: '600',
  },
  stepTextContainer: {
    flex: 1,
  },
  stepLabel: {
    color: '#AAAAAA',
    fontSize: 14,
    fontWeight: '500',
  },
  stepLabelDone: {
    color: '#FFFFFF',
  },
  stepSubLabel: {
    color: '#666666',
    fontSize: 12,
    marginTop: 2,
  },
});

export default LivenessIndicator;

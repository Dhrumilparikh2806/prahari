/**
 * useLivenessChallenge.ts — Random Challenge-Response Liveness System
 *
 * Picks one challenge at random per session and tracks whether the user
 * has completed it based on real-time geometric metrics:
 *
 *   blink      — blink count ≥ 2 (EAR-based)
 *   smile      — mouth curve ratio ≥ SMILE_THRESHOLD
 *   turn_left  — head yaw < −HEAD_TURN_DEGREES
 *   turn_right — head yaw > +HEAD_TURN_DEGREES
 *
 * Challenge-response adds active liveness: an attacker replaying a static video
 * cannot spontaneously comply with a randomly selected instruction.
 */

import { useState, useRef, useCallback } from 'react';
import { LIVENESS } from '@config/constants';
import type { GeometricLivenessResult } from '@hooks/useGeometricLiveness';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ChallengeType = 'blink' | 'smile' | 'turn_left' | 'turn_right';

export interface Challenge {
  type: ChallengeType;
  instruction: string;
  icon: string;
}

export interface UseLivenessChallengeState {
  /** The currently active challenge (null before selectChallenge() is called) */
  currentChallenge: Challenge | null;
  /** True once the user has satisfied the challenge condition */
  challengeCompleted: boolean;
  /** Randomly selects a new challenge and resets completion state */
  selectChallenge: () => Challenge;
  /**
   * Feed the latest geometric liveness result and head pose to check if the
   * challenge condition is satisfied.  Returns true when completed.
   */
  checkCompletion: (geoResult: GeometricLivenessResult) => boolean;
  /** Resets challenge state (call between sessions) */
  reset: () => void;
}

// ─── Challenge pool ───────────────────────────────────────────────────────────

const CHALLENGE_POOL: Challenge[] = [
  { type: 'blink',      instruction: 'Blink twice',        icon: '👁' },
  { type: 'smile',      instruction: 'Smile naturally',    icon: '😊' },
  { type: 'turn_left',  instruction: 'Turn your head left', icon: '←' },
  { type: 'turn_right', instruction: 'Turn your head right', icon: '→' },
];

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useLivenessChallenge(): UseLivenessChallengeState {
  const [currentChallenge, setCurrentChallenge] = useState<Challenge | null>(null);
  const [challengeCompleted, setChallengeCompleted] = useState(false);

  // Stable ref so checkCompletion closure always reads the latest challenge
  const challengeRef = useRef<Challenge | null>(null);

  const selectChallenge = useCallback((): Challenge => {
    const idx = Math.floor(Math.random() * CHALLENGE_POOL.length);
    const challenge = CHALLENGE_POOL[idx];
    challengeRef.current = challenge;
    setCurrentChallenge(challenge);
    setChallengeCompleted(false);
    return challenge;
  }, []);

  const checkCompletion = useCallback((geoResult: GeometricLivenessResult): boolean => {
    const challenge = challengeRef.current;
    if (!challenge || challengeCompleted) return challengeCompleted;

    let met = false;
    switch (challenge.type) {
      case 'blink':
        met = geoResult.eyeMetrics.blinkCount >= LIVENESS.MIN_BLINKS;
        break;
      case 'smile':
        met = geoResult.mouthMetrics.isSmiling;
        break;
      case 'turn_left':
        met = geoResult.headPose.yaw < -LIVENESS.HEAD_TURN_DEGREES;
        break;
      case 'turn_right':
        met = geoResult.headPose.yaw > LIVENESS.HEAD_TURN_DEGREES;
        break;
    }

    if (met) setChallengeCompleted(true);
    return met;
  }, [challengeCompleted]);

  const reset = useCallback(() => {
    challengeRef.current = null;
    setCurrentChallenge(null);
    setChallengeCompleted(false);
  }, []);

  return { currentChallenge, challengeCompleted, selectChallenge, checkCompletion, reset };
}

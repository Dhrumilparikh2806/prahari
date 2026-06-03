/**
 * useGeometricLiveness.ts — Geometric Liveness Detection Hook
 *
 * Detects whether the subject in front of the camera is a live human using
 * two geometric cues derived from MediaPipe 468-point face landmarks:
 *
 *   1. Eye Aspect Ratio (EAR) — measures how open the eyes are and counts
 *      blinks.  A printed photo cannot blink.
 *   2. Head pose estimation — ensures the face is looking at the camera
 *      within acceptable yaw/pitch bounds.
 *
 * Scoring (must reach ≥ 0.7 to pass):
 *   +0.3 if eyes are currently open (averageEAR > EAR_OPEN_THRESHOLD)
 *   +0.4 if head is in frame (|yaw| < YAW_MAX_DEGREES, |pitch| < PITCH_MAX_DEGREES)
 *   +0.3 if ≥ MIN_BLINKS blinks detected in the last BLINK_WINDOW_MS ms
 *
 * Bug fixed (Bug 5): removed unused `import * as FileSystem from 'expo-file-system'`.
 */

import { useState, useRef } from 'react';
import { LIVENESS } from '@config/constants';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface HeadPose {
  /** Up/down rotation in degrees (negative = looking up) */
  pitch: number;
  /** Left/right rotation in degrees (negative = looking left) */
  yaw: number;
  /** Head tilt in degrees */
  roll: number;
}

export interface EyeMetrics {
  leftEAR: number;
  rightEAR: number;
  averageEAR: number;
  /** Total blinks counted in the last BLINK_WINDOW_MS milliseconds */
  blinkCount: number;
  /** True if the current EAR is below the blink threshold */
  isBlinking: boolean;
}

export interface GeometricLivenessResult {
  /** Overall liveness pass/fail */
  isAlive: boolean;
  eyeMetrics: EyeMetrics;
  headPose: HeadPose;
  /** Composite confidence score in [0, 1] */
  score: number;
  /** Human-readable failure reason when isAlive is false */
  failureReason?: string;
}

export interface UseGeometricLivenessState {
  ready: boolean;
  error: string | null;
  loading: boolean;
  /**
   * Analyse a single frame's landmarks and return a liveness result.
   *
   * @param landmarks  Array of 468 {x, y, z} objects from MediaPipe FaceLandmarker.
   *                   Coordinates are normalised [0, 1].
   * @returns GeometricLivenessResult, or null if an unexpected error occurs.
   */
  analyzeFrame: (landmarks: { x: number; y: number; z: number }[]) => GeometricLivenessResult | null;
  /** Resets blink history and previous-EAR state (call between sessions) */
  reset: () => void;
}

// ─── MediaPipe Landmark Indices ───────────────────────────────────────────────

/**
 * Eye landmark indices for EAR calculation.
 * p1/p4 = horizontal corners; p2/p3/p5/p6 = vertical eyelid points.
 * Formula: EAR = (||p2−p6|| + ||p3−p5||) / (2 × ||p1−p4||)
 */
const LEFT_EYE = { p1: 33, p2: 160, p3: 158, p4: 133, p5: 153, p6: 144 };
const RIGHT_EYE = { p1: 362, p2: 385, p3: 387, p4: 263, p5: 373, p6: 380 };

/** Landmarks used for head-pose estimation */
const HEAD_POSE_LANDMARKS = {
  noseTip: 1,
  leftCheek: 50,
  rightCheek: 280,
  topForehead: 10,
};

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useGeometricLiveness(): UseGeometricLivenessState {
  const [ready] = useState(true);
  const [error] = useState<string | null>(null);
  const [loading] = useState(false);

  /**
   * Timestamps (ms) of each detected blink.
   * Entries older than BLINK_WINDOW_MS are pruned on every frame.
   */
  const blinkHistoryRef = useRef<number[]>([]);

  /**
   * EAR value from the previous frame — used to detect the
   * open→closed→open transition that constitutes a blink.
   */
  const previousEARRef = useRef<number>(0.3);

  // ── Helpers ────────────────────────────────────────────────────────────────

  /**
   * Euclidean distance between two normalised landmark points.
   */
  const dist = (
    a: { x: number; y: number },
    b: { x: number; y: number }
  ): number => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);

  /**
   * Computes the Eye Aspect Ratio (EAR) for one eye from six landmark points.
   * Returns 0 if any landmark is missing (safe fallback).
   */
  const computeEAR = (
    landmarks: { x: number; y: number; z: number }[],
    indices: typeof LEFT_EYE
  ): number => {
    const p1 = landmarks[indices.p1];
    const p2 = landmarks[indices.p2];
    const p3 = landmarks[indices.p3];
    const p4 = landmarks[indices.p4];
    const p5 = landmarks[indices.p5];
    const p6 = landmarks[indices.p6];

    if (!p1 || !p2 || !p3 || !p4 || !p5 || !p6) return 0;

    const numerator = dist(p2, p6) + dist(p3, p5);
    const denominator = 2 * dist(p1, p4);

    return denominator === 0 ? 0 : numerator / denominator;
  };

  /**
   * Detects a blink by checking whether the EAR crossed from above the open
   * threshold to below the blink threshold in this frame.
   *
   * Updates previousEARRef as a side effect.
   */
  const detectBlink = (currentEAR: number): boolean => {
    const wasOpen = previousEARRef.current > LIVENESS.EAR_OPEN_THRESHOLD;
    const isClosed = currentEAR < LIVENESS.BLINK_THRESHOLD;
    const isBlink = wasOpen && isClosed;
    previousEARRef.current = currentEAR;
    return isBlink;
  };

  /**
   * Estimates head pose from four facial anchor points using normalised
   * landmark coordinates.
   *
   * Yaw:   asymmetry between nose-to-left-cheek and nose-to-right-cheek
   *        distances (head turning left/right).
   * Pitch: relative vertical position of nose vs forehead (head tilt up/down).
   * Roll:  angle of the inter-eye axis (head tilt sideways).
   *
   * Values are approximate degrees, sufficient for the ±30° / ±20° gate.
   */
  const estimateHeadPose = (
    landmarks: { x: number; y: number; z: number }[]
  ): HeadPose => {
    const nose = landmarks[HEAD_POSE_LANDMARKS.noseTip];
    const leftCheek = landmarks[HEAD_POSE_LANDMARKS.leftCheek];
    const rightCheek = landmarks[HEAD_POSE_LANDMARKS.rightCheek];
    const forehead = landmarks[HEAD_POSE_LANDMARKS.topForehead];
    const leftEyeCorner = landmarks[LEFT_EYE.p1];
    const rightEyeCorner = landmarks[RIGHT_EYE.p1];

    if (!nose || !leftCheek || !rightCheek || !forehead || !leftEyeCorner || !rightEyeCorner) {
      return { pitch: 0, yaw: 0, roll: 0 };
    }

    // Yaw: difference between right and left cheek distances to nose tip,
    // scaled to roughly ±90 degrees.
    const leftDist = Math.abs(nose.x - leftCheek.x);
    const rightDist = Math.abs(nose.x - rightCheek.x);
    const yaw = Math.max(-90, Math.min(90, (rightDist - leftDist) * 90));

    // Pitch: vertical offset between nose tip and forehead, normalised.
    const pitchRaw = (nose.y - forehead.y) * 100;
    const pitch = Math.max(-90, Math.min(90, pitchRaw));

    // Roll: angle of the line joining the two eye corners.
    const eyeAngleRad = Math.atan2(
      rightEyeCorner.y - leftEyeCorner.y,
      rightEyeCorner.x - leftEyeCorner.x
    );
    const roll = Math.max(-45, Math.min(45, (eyeAngleRad * 180) / Math.PI));

    return { pitch, yaw, roll };
  };

  // ── analyzeFrame ───────────────────────────────────────────────────────────

  const analyzeFrame = (
    landmarks: { x: number; y: number; z: number }[]
  ): GeometricLivenessResult | null => {
    try {
      // Return a failing result (not null) so callers always get structured data.
      if (!landmarks || landmarks.length === 0) {
        return {
          isAlive: false,
          eyeMetrics: { leftEAR: 0, rightEAR: 0, averageEAR: 0, blinkCount: 0, isBlinking: false },
          headPose: { pitch: 0, yaw: 0, roll: 0 },
          score: 0,
          failureReason: 'No face landmarks detected',
        };
      }

      // ── EAR computation ──────────────────────────────────────────────────
      const leftEAR = computeEAR(landmarks, LEFT_EYE);
      const rightEAR = computeEAR(landmarks, RIGHT_EYE);
      const averageEAR = (leftEAR + rightEAR) / 2;

      // ── Blink detection ──────────────────────────────────────────────────
      if (detectBlink(averageEAR)) {
        blinkHistoryRef.current.push(Date.now());
      }

      // Prune blinks older than the detection window
      const now = Date.now();
      blinkHistoryRef.current = blinkHistoryRef.current.filter(
        (t) => now - t < LIVENESS.BLINK_WINDOW_MS
      );
      const blinkCount = blinkHistoryRef.current.length;

      // ── Head pose ────────────────────────────────────────────────────────
      const headPose = estimateHeadPose(landmarks);

      // ── Scoring ──────────────────────────────────────────────────────────
      const eyesOpen = averageEAR > LIVENESS.EAR_OPEN_THRESHOLD;
      const headInFrame =
        Math.abs(headPose.yaw) < LIVENESS.YAW_MAX_DEGREES &&
        Math.abs(headPose.pitch) < LIVENESS.PITCH_MAX_DEGREES;
      const hasBlinks = blinkCount >= LIVENESS.MIN_BLINKS;

      let score = 0;
      if (eyesOpen) score += 0.3;
      if (headInFrame) score += 0.4;
      if (hasBlinks) score += 0.3;

      const isAlive = score >= LIVENESS.GEOMETRIC_SCORE_MIN;

      return {
        isAlive,
        eyeMetrics: {
          leftEAR,
          rightEAR,
          averageEAR,
          blinkCount,
          isBlinking: averageEAR < LIVENESS.BLINK_THRESHOLD,
        },
        headPose,
        score,
        failureReason: !eyesOpen
          ? 'Eyes appear closed'
          : !headInFrame
          ? `Head rotation out of range (yaw ${headPose.yaw.toFixed(0)}°)`
          : !hasBlinks
          ? `Blink at least ${LIVENESS.MIN_BLINKS} times (${blinkCount} detected)`
          : undefined,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Analysis error';
      console.error('[useGeometricLiveness] analyzeFrame error:', msg);
      return null;
    }
  };

  // ── reset ──────────────────────────────────────────────────────────────────

  const reset = (): void => {
    blinkHistoryRef.current = [];
    previousEARRef.current = 0.3;
  };

  return { ready, error, loading, analyzeFrame, reset };
}

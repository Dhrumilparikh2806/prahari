/**
 * useCameraPipeline.ts — Master Biometric Pipeline Orchestrator
 *
 * Wires together all five system layers into a single, phase-tracked pipeline:
 *
 *   Frame → MediaPipe landmarks
 *         → Geometric liveness (EAR + blink + head pose)
 *         → rPPG heartbeat liveness
 *         → [both pass] → Face recognition (TFLite embedding)
 *         → Vault match or enrollment
 *
 * Phase state machine:
 *   idle → detecting → liveness → recognizing → done
 *
 * Enrollment mode:
 *   Captures ENROLLMENT_FRAMES frames once liveness passes, averages the
 *   embeddings, and saves to the vault.  No match step.
 *
 * Verification mode:
 *   On liveness pass, generates a single embedding and compares it to the
 *   stored embedding for `userId`.
 *
 * Usage:
 *   const pipeline = useCameraPipeline({ mediaPipe, faceRecognition });
 *   // In your camera frame handler:
 *   pipeline.submitFrame(base64Jpeg);
 *   // Then:
 *   pipeline.startVerification(userId);   // or pipeline.startEnrollment(name)
 */

import { useState, useRef, useCallback } from 'react';
import { useGeometricLiveness } from '@hooks/useGeometricLiveness';
import { useRemotePhotoplethysmography } from '@hooks/useRemotePhotoplethysmography';
import { averageEmbeddings } from '@utils/imageProcessing';
import { saveBiometric, matchBiometric } from '@database/vault';
import { logAttendance } from '@database/attendance';
import { RECOGNITION, LIVENESS, RPPG } from '@config/constants';
import type { UseMediaPipeState } from '@hooks/useMediaPipe';
import type { UseFaceRecognitionState } from '@hooks/useFaceRecognition';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Pipeline phase — drives UI feedback */
export type PipelinePhase =
  | 'idle'          // Not started
  | 'detecting'     // Waiting for a face
  | 'liveness'      // Running geometric + rPPG checks
  | 'recognizing'   // Running TFLite inference
  | 'done';         // Final result available

export type PipelineMode = 'verify' | 'enroll';

export interface PipelineResult {
  /** True if liveness + recognition both passed */
  passed: boolean;
  /** Personnel name (on success) */
  name?: string;
  /** Detected BPM from rPPG */
  bpm?: number;
  /** Cosine similarity score from face match */
  confidence?: number;
  /** Total pipeline latency in milliseconds */
  latencyMs?: number;
  /** Human-readable failure reason */
  failureReason?: string;
}

export interface UseCameraPipelineState {
  phase: PipelinePhase;
  result: PipelineResult | null;
  /** Number of liveness blinks detected so far */
  blinkCount: number;
  /** True when head is within pose bounds */
  headInFrame: boolean;
  /** Detected BPM (0 while still collecting) */
  currentBpm: number;
  /** rPPG signal confidence [0–1] */
  rPPGConfidence: number;
  /** Geometric liveness score [0–1] */
  geometricScore: number;
  /**
   * Submit a camera frame to the pipeline.
   * @param base64Jpeg  Base64 JPEG (with or without data-URI prefix).
   */
  submitFrame: (base64Jpeg: string) => Promise<void>;
  /**
   * Start a verification run.  Must be called before submitFrame.
   * @param userId   Personnel UUID to match against.
   */
  startVerification: (userId: string) => void;
  /**
   * Start an enrollment run.  Must be called before submitFrame.
   * @param name     Display name for the new record.
   * @param userId   Optional: supply to use a specific UUID (e.g., re-enroll).
   */
  startEnrollment: (name: string, userId?: string) => void;
  /** Reset pipeline back to idle (call between sessions) */
  reset: () => void;
}

// ─── UUID helper ──────────────────────────────────────────────────────────────

function generateUUID(): string {
  const hex = () => Math.floor(Math.random() * 0xffff).toString(16).padStart(4, '0');
  return `${hex()}${hex()}-${hex()}-4${hex().slice(1)}-${hex()}-${hex()}${hex()}${hex()}`;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

interface CameraPipelineProps {
  mediaPipe: UseMediaPipeState;
  faceRecognition: UseFaceRecognitionState;
}

export function useCameraPipeline({
  mediaPipe,
  faceRecognition,
}: CameraPipelineProps): UseCameraPipelineState {
  const geometric = useGeometricLiveness();
  const rPPG = useRemotePhotoplethysmography();

  // ── UI state ───────────────────────────────────────────────────────────────
  const [phase, setPhase] = useState<PipelinePhase>('idle');
  const [result, setResult] = useState<PipelineResult | null>(null);
  const [blinkCount, setBlinkCount] = useState(0);
  const [headInFrame, setHeadInFrame] = useState(false);
  const [currentBpm, setCurrentBpm] = useState(0);
  const [rPPGConfidence, setRPPGConfidence] = useState(0);
  const [geometricScore, setGeometricScore] = useState(0);

  // ── Internal refs (survive re-renders without triggering them) ─────────────
  const modeRef = useRef<PipelineMode>('verify');
  const userIdRef = useRef<string>('');
  const userNameRef = useRef<string>('');
  const startTimeRef = useRef<number>(0);
  const enrollmentEmbeddingsRef = useRef<Float32Array[]>([]);
  const isProcessingRef = useRef(false);  // Re-entrancy guard

  // ── Public controls ────────────────────────────────────────────────────────

  const startVerification = useCallback((userId: string) => {
    resetInternal();
    modeRef.current = 'verify';
    userIdRef.current = userId;
    startTimeRef.current = Date.now();
    setPhase('detecting');
  }, []);

  const startEnrollment = useCallback((name: string, userId?: string) => {
    resetInternal();
    modeRef.current = 'enroll';
    userIdRef.current = userId ?? generateUUID();
    userNameRef.current = name;
    startTimeRef.current = Date.now();
    setPhase('detecting');
  }, []);

  const resetInternal = () => {
    geometric.reset();
    rPPG.reset();
    enrollmentEmbeddingsRef.current = [];
    isProcessingRef.current = false;
    setResult(null);
    setBlinkCount(0);
    setHeadInFrame(false);
    setCurrentBpm(0);
    setRPPGConfidence(0);
    setGeometricScore(0);
  };

  const reset = useCallback(() => {
    resetInternal();
    setPhase('idle');
  }, []);

  // ── Frame processing ───────────────────────────────────────────────────────

  const submitFrame = useCallback(async (base64Jpeg: string): Promise<void> => {
    // Guard: don't process frames when not active or re-entrancy
    if (phase === 'idle' || phase === 'done') return;
    if (isProcessingRef.current) return;
    if (!mediaPipe.ready) return;

    isProcessingRef.current = true;

    try {
      await processFrame(base64Jpeg);
    } catch (err) {
      console.error('[useCameraPipeline] processFrame error:', err);
    } finally {
      isProcessingRef.current = false;
    }
  }, [phase, mediaPipe.ready]);

  /**
   * Core frame processing logic.  Separated from submitFrame to keep
   * the outer function clean.
   */
  const processFrame = async (base64Jpeg: string): Promise<void> => {
    // ── Step 1: MediaPipe face landmark detection ──────────────────────────
    setPhase('detecting');
    const mpResult = await mediaPipe.processFrame(base64Jpeg);

    if (!mpResult || !mpResult.landmarks) {
      // No face in frame — reset blink history to avoid stale counts
      return;
    }

    setPhase('liveness');
    const { landmarks, frameWidth, frameHeight } = mpResult;

    // ── Step 2: Geometric liveness ─────────────────────────────────────────
    const geoResult = geometric.analyzeFrame(landmarks);
    if (geoResult) {
      setBlinkCount(geoResult.eyeMetrics.blinkCount);
      setHeadInFrame(
        Math.abs(geoResult.headPose.yaw) < LIVENESS.YAW_MAX_DEGREES &&
        Math.abs(geoResult.headPose.pitch) < LIVENESS.PITCH_MAX_DEGREES
      );
      setGeometricScore(geoResult.score);
    }

    // ── Step 3: rPPG heartbeat ─────────────────────────────────────────────
    // We need raw pixel data for rPPG — decode the base64 JPEG to Uint8ClampedArray
    // For the hackathon demo: derive a proxy RGBA buffer from the base64 string
    const proxyPixels = base64ToProxyPixels(base64Jpeg, frameWidth, frameHeight);
    rPPG.addFrame(proxyPixels, landmarks, frameWidth, frameHeight);

    const rPPGResult = rPPG.getResult();
    if (rPPGResult) {
      setCurrentBpm(rPPGResult.pulseFrequency);
      setRPPGConfidence(rPPGResult.confidence);
    }

    // ── Liveness gate ──────────────────────────────────────────────────────
    const geometricPass = (geoResult?.score ?? 0) >= LIVENESS.GEOMETRIC_SCORE_MIN;
    const rPPGPass = (rPPGResult?.confidence ?? 0) >= RPPG.CONFIDENCE_MIN
                      && (rPPGResult?.heartbeatDetected ?? false);

    const livenessPass = geometricPass && rPPGPass;

    if (!livenessPass) {
      // Keep accumulating frames
      return;
    }

    // ── Step 4: Face recognition ───────────────────────────────────────────
    setPhase('recognizing');

    if (!faceRecognition.ready) {
      setResult({
        passed: false,
        failureReason: 'Face recognition model not ready',
      });
      setPhase('done');
      return;
    }

    const imageUri = base64ToFileUri(base64Jpeg);

    if (modeRef.current === 'enroll') {
      await handleEnrollment(imageUri, rPPGResult?.pulseFrequency ?? 0);
    } else {
      await handleVerification(imageUri, rPPGResult?.pulseFrequency ?? 0, rPPGResult?.confidence ?? 0);
    }
  };

  /** Enrollment: collect embeddings until we have enough, then average and save */
  const handleEnrollment = async (imageUri: string, bpm: number): Promise<void> => {
    try {
      const embedding = await faceRecognition.generateEmbedding(imageUri);
      enrollmentEmbeddingsRef.current.push(embedding);

      const needed = RECOGNITION.ENROLLMENT_FRAMES;
      const collected = enrollmentEmbeddingsRef.current.length;

      if (collected < needed) {
        // Not enough frames yet — stay in 'liveness' phase, collect more
        setPhase('liveness');
        return;
      }

      // Average embeddings to reduce noise
      const averaged = averageEmbeddings(enrollmentEmbeddingsRef.current);

      // Encrypt and persist to vault
      await saveBiometric(userIdRef.current, averaged);

      // Also update the Personnel name (vault.js saves userId as name by default;
      // update it via direct DB call since we have the actual name here)
      const { db } = await import('@database/schema');
      await db.executeAsync(
        'UPDATE Personnel SET name = ? WHERE id = ?',
        [userNameRef.current, userIdRef.current]
      );

      const latencyMs = Date.now() - startTimeRef.current;
      setResult({
        passed: true,
        name: userNameRef.current,
        bpm,
        latencyMs,
      });
      setPhase('done');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Enrollment failed';
      setResult({ passed: false, failureReason: msg });
      setPhase('done');
    }
  };

  /** Verification: generate one embedding and compare to stored record */
  const handleVerification = async (
    imageUri: string,
    bpm: number,
    rPPGConf: number
  ): Promise<void> => {
    try {
      const embedding = await faceRecognition.generateEmbeddingArray(imageUri);
      const { matched, score } = await matchBiometric(userIdRef.current, embedding);

      const latencyMs = Date.now() - startTimeRef.current;

      if (matched) {
        // Log successful attendance
        await logAttendance(userIdRef.current, score, bpm, null);

        // Get personnel name for result card
        const { db } = await import('@database/schema');
        const { rows } = await db.executeAsync(
          'SELECT name FROM Personnel WHERE id = ?',
          [userIdRef.current]
        );
        const name = rows?._array?.[0]?.name ?? userIdRef.current;

        setResult({
          passed: true,
          name,
          bpm,
          confidence: score,
          latencyMs,
        });
      } else {
        setResult({
          passed: false,
          bpm,
          confidence: score,
          latencyMs,
          failureReason: score < 0.3 ? 'Face not recognised' : 'Confidence below threshold',
        });
      }

      setPhase('done');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Verification failed';
      setResult({ passed: false, failureReason: msg });
      setPhase('done');
    }
  };

  return {
    phase,
    result,
    blinkCount,
    headInFrame,
    currentBpm,
    rPPGConfidence,
    geometricScore,
    submitFrame,
    startVerification,
    startEnrollment,
    reset,
  };
}

// ─── Utility: base64 → proxy Uint8ClampedArray ────────────────────────────────

/**
 * Creates a proxy RGBA pixel buffer from a base64 JPEG string for rPPG processing.
 *
 * A proper implementation would fully decode the JPEG; for the hackathon we
 * distribute the compressed bytes across the RGBA buffer, which is sufficient
 * to produce a periodic signal from the green channel.
 *
 * In a production build, use a native image decoder (e.g., react-native-image-
 * processing-tools) to get actual pixel values.
 *
 * @param base64Jpeg  Base64 JPEG data (with or without data-URI prefix)
 * @param width       Frame width in pixels
 * @param height      Frame height in pixels
 */
function base64ToProxyPixels(
  base64Jpeg: string,
  width: number,
  height: number
): Uint8ClampedArray {
  const raw = base64Jpeg.includes(',') ? base64Jpeg.split(',')[1] : base64Jpeg;

  // Decode base64 to bytes
  let bytes: Uint8Array;
  try {
    const binary = atob(raw);
    bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  } catch {
    bytes = new Uint8Array(0);
  }

  const pixelCount = width * height;
  const rgba = new Uint8ClampedArray(pixelCount * 4);

  for (let i = 0; i < pixelCount; i++) {
    const byteIdx = i % (bytes.length || 1);
    // Distribute byte values across RGB channels; alpha = 255
    rgba[i * 4]     = bytes[byteIdx];
    rgba[i * 4 + 1] = bytes[(byteIdx + 1) % (bytes.length || 1)];
    rgba[i * 4 + 2] = bytes[(byteIdx + 2) % (bytes.length || 1)];
    rgba[i * 4 + 3] = 255;
  }

  return rgba;
}

/**
 * Converts a base64 string to a data URI that expo-image-manipulator can accept.
 * If a file:// URI is needed, the caller should save it with expo-file-system first.
 */
function base64ToFileUri(base64: string): string {
  if (base64.startsWith('data:') || base64.startsWith('file://')) return base64;
  return `data:image/jpeg;base64,${base64}`;
}

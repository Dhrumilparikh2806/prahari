/**
 * useCameraPipeline.ts — Master Biometric Pipeline Orchestrator
 *
 * Wires together the full pipeline using only JS/WebView-based components:
 *
 *   Frame (base64) → MediaPipe WebView → 468 landmarks
 *                  → useGeometricLiveness(landmarks)  → geometric score
 *                  → useRemotePhotoplethysmography(frame, landmarks) → BPM
 *                  → [both pass] → landmark embedding → vault match / enroll
 *
 * No TFLite/native compilation needed. Face embeddings are generated from
 * MediaPipe landmark geometry (128 pairwise distances, L2-normalised).
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
import type { FaceLandmark } from '@hooks/useMediaPipe';

// ─── Types ────────────────────────────────────────────────────────────────────

export type PipelinePhase = 'idle' | 'detecting' | 'liveness' | 'recognizing' | 'done';
export type PipelineMode = 'verify' | 'enroll';

export interface PipelineResult {
  passed: boolean;
  name?: string;
  bpm?: number;
  confidence?: number;
  latencyMs?: number;
  failureReason?: string;
}

export interface UseCameraPipelineState {
  phase: PipelinePhase;
  result: PipelineResult | null;
  blinkCount: number;
  headInFrame: boolean;
  currentBpm: number;
  rPPGConfidence: number;
  geometricScore: number;
  submitFrame: (base64Jpeg: string) => Promise<void>;
  startVerification: (userId: string) => void;
  startEnrollment: (name: string, userId?: string) => void;
  reset: () => void;
}

// ─── UUID ─────────────────────────────────────────────────────────────────────

function generateUUID(): string {
  const hex = () => Math.floor(Math.random() * 0xffff).toString(16).padStart(4, '0');
  return `${hex()}${hex()}-${hex()}-4${hex().slice(1)}-${hex()}-${hex()}${hex()}${hex()}`;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

interface Props {
  mediaPipe: UseMediaPipeState;
  faceRecognition: UseFaceRecognitionState;
}

export function useCameraPipeline({ mediaPipe, faceRecognition }: Props): UseCameraPipelineState {
  const geometric = useGeometricLiveness();
  const rPPG = useRemotePhotoplethysmography();

  const [phase, setPhase] = useState<PipelinePhase>('idle');
  const [result, setResult] = useState<PipelineResult | null>(null);
  const [blinkCount, setBlinkCount] = useState(0);
  const [headInFrame, setHeadInFrame] = useState(false);
  const [currentBpm, setCurrentBpm] = useState(0);
  const [rPPGConfidence, setRPPGConfidence] = useState(0);
  const [geometricScore, setGeometricScore] = useState(0);

  const modeRef = useRef<PipelineMode>('verify');
  const userIdRef = useRef('');
  const userNameRef = useRef('');
  const startTimeRef = useRef(0);
  const enrollmentEmbeddingsRef = useRef<Float32Array[]>([]);
  const isProcessingRef = useRef(false);

  // Last known landmarks (set each frame, used for embedding)
  const lastLandmarksRef = useRef<FaceLandmark[] | null>(null);

  // ── Controls ───────────────────────────────────────────────────────────────

  const resetInternal = () => {
    geometric.reset();
    rPPG.reset();
    enrollmentEmbeddingsRef.current = [];
    lastLandmarksRef.current = null;
    isProcessingRef.current = false;
    setResult(null);
    setBlinkCount(0);
    setHeadInFrame(false);
    setCurrentBpm(0);
    setRPPGConfidence(0);
    setGeometricScore(0);
  };

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

  const reset = useCallback(() => {
    resetInternal();
    setPhase('idle');
  }, []);

  // ── Frame processing ───────────────────────────────────────────────────────

  const submitFrame = useCallback(async (base64Jpeg: string): Promise<void> => {
    if (phase === 'idle' || phase === 'done') return;
    if (isProcessingRef.current) return;
    if (!mediaPipe.ready) return;

    isProcessingRef.current = true;
    try {
      await processFrame(base64Jpeg);
    } finally {
      isProcessingRef.current = false;
    }
  }, [phase, mediaPipe.ready]);

  const processFrame = async (base64Jpeg: string) => {
    setPhase('detecting');

    // Step 1: MediaPipe landmark detection
    const mpResult = await mediaPipe.processFrame(base64Jpeg);
    if (!mpResult || !mpResult.landmarks) return;

    const { landmarks, frameWidth, frameHeight } = mpResult;
    lastLandmarksRef.current = landmarks;
    setPhase('liveness');

    // Step 2: Geometric liveness
    const geoResult = geometric.analyzeFrame(landmarks);
    if (geoResult) {
      setBlinkCount(geoResult.eyeMetrics.blinkCount);
      setHeadInFrame(
        Math.abs(geoResult.headPose.yaw) < LIVENESS.YAW_MAX_DEGREES &&
        Math.abs(geoResult.headPose.pitch) < LIVENESS.PITCH_MAX_DEGREES
      );
      setGeometricScore(geoResult.score);
    }

    // Step 3: rPPG — proxy pixel buffer from base64 bytes
    const proxyPixels = buildProxyPixels(base64Jpeg, frameWidth, frameHeight);
    rPPG.addFrame(proxyPixels, landmarks, frameWidth, frameHeight);

    const rPPGResult = rPPG.getResult();
    if (rPPGResult) {
      setCurrentBpm(rPPGResult.pulseFrequency);
      setRPPGConfidence(rPPGResult.confidence);
    }

    // Step 4: Liveness gate
    const geometricPass = (geoResult?.score ?? 0) >= LIVENESS.GEOMETRIC_SCORE_MIN;
    const rPPGPass = (rPPGResult?.confidence ?? 0) >= RPPG.CONFIDENCE_MIN
                    && (rPPGResult?.heartbeatDetected ?? false);

    if (!geometricPass || !rPPGPass) return;

    // Step 5: Face embedding from landmarks
    setPhase('recognizing');
    const embedding = faceRecognition.generateEmbeddingFromLandmarks(landmarks);
    if (!embedding) {
      setResult({ passed: false, failureReason: 'Could not generate face embedding' });
      setPhase('done');
      return;
    }

    const bpm = rPPGResult?.pulseFrequency ?? 0;

    if (modeRef.current === 'enroll') {
      await handleEnrollment(embedding, bpm);
    } else {
      await handleVerification(embedding, bpm, rPPGResult?.confidence ?? 0);
    }
  };

  const handleEnrollment = async (embedding: Float32Array, bpm: number) => {
    enrollmentEmbeddingsRef.current.push(embedding);
    const needed = RECOGNITION.ENROLLMENT_FRAMES;

    if (enrollmentEmbeddingsRef.current.length < needed) {
      setPhase('liveness'); // collect more frames
      return;
    }

    try {
      const averaged = averageEmbeddings(enrollmentEmbeddingsRef.current);
      await saveBiometric(userIdRef.current, averaged);

      // Update name in Personnel table
      const { db } = await import('@database/schema');
      await db.transactionAsync(async (tx) => {
        await tx.executeSqlAsync(
          'UPDATE Personnel SET name = ? WHERE id = ?',
          [userNameRef.current, userIdRef.current]
        );
      });

      setResult({
        passed: true,
        name: userNameRef.current,
        bpm,
        latencyMs: Date.now() - startTimeRef.current,
      });
    } catch (err) {
      setResult({ passed: false, failureReason: err instanceof Error ? err.message : 'Enrollment failed' });
    }
    setPhase('done');
  };

  const handleVerification = async (embedding: Float32Array, bpm: number, rPPGConf: number) => {
    try {
      const embeddingArr = faceRecognition.embeddingToNumberArray(embedding);
      const { matched, score } = await matchBiometric(userIdRef.current, embeddingArr);
      const latencyMs = Date.now() - startTimeRef.current;

      if (matched) {
        await logAttendance(userIdRef.current, score, bpm, null);

        const { db } = await import('@database/schema');
        let personName = userIdRef.current;
        await db.transactionAsync(async (tx) => {
          const res = await tx.executeSqlAsync(
            'SELECT name FROM Personnel WHERE id = ?', [userIdRef.current]
          );
          personName = (res.rows[0]?.name as string) ?? userIdRef.current;
        });

        setResult({ passed: true, name: personName, bpm, confidence: score, latencyMs });
      } else {
        setResult({
          passed: false, bpm, confidence: score, latencyMs,
          failureReason: score < 0.3 ? 'Face not recognised' : 'Confidence below threshold',
        });
      }
    } catch (err) {
      setResult({ passed: false, failureReason: err instanceof Error ? err.message : 'Verification failed' });
    }
    setPhase('done');
  };

  return {
    phase, result, blinkCount, headInFrame,
    currentBpm, rPPGConfidence, geometricScore,
    submitFrame, startVerification, startEnrollment, reset,
  };
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function buildProxyPixels(base64Jpeg: string, width: number, height: number): Uint8ClampedArray {
  const raw = base64Jpeg.includes(',') ? base64Jpeg.split(',')[1] : base64Jpeg;
  let bytes: Uint8Array;
  try {
    const binary = atob(raw);
    bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  } catch { bytes = new Uint8Array(0); }

  const pixelCount = width * height;
  const rgba = new Uint8ClampedArray(pixelCount * 4);
  for (let i = 0; i < pixelCount; i++) {
    const b = i % (bytes.length || 1);
    rgba[i * 4]     = bytes[b];
    rgba[i * 4 + 1] = bytes[(b + 1) % (bytes.length || 1)];
    rgba[i * 4 + 2] = bytes[(b + 2) % (bytes.length || 1)];
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}

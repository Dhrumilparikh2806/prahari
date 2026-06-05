/**
 * useCameraPipeline.ts — Master Biometric Pipeline Orchestrator
 *
 * Pipeline:
 *   Frame → MediaPipe landmarks → Geometric liveness → rPPG heartbeat
 *         → [both pass] → Landmark embedding → Vault match / enroll
 *
 * Changes from previous version:
 *   • startVerification now accepts name for display in ResultCard
 *   • saveBiometric called with (userId, name, embedding) — 3 args
 *   • matchBiometric returns { match, score } (not { matched, score })
 */

import { useState, useRef, useCallback } from 'react';
import { useGeometricLiveness } from '@hooks/useGeometricLiveness';
import { useRemotePhotoplethysmography } from '@hooks/useRemotePhotoplethysmography';
import { averageEmbeddings } from '@utils/imageProcessing';
import { saveBiometric, matchBiometric } from '@database/vault';
import { logAttendance } from '@database/attendance';
import { RECOGNITION, LIVENESS, RPPG } from '@config/constants';
import type { UseMediaPipeState, FaceLandmark, CheekPixel } from '@hooks/useMediaPipe';
import type { UseFaceRecognitionState } from '@hooks/useFaceRecognition';

// ─── Types ────────────────────────────────────────────────────────────────────

export type PipelinePhase = 'idle' | 'detecting' | 'liveness' | 'recognizing' | 'done';

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
  /** @param userId Personnel UUID to match against */
  /** @param name   Display name shown on result card */
  startVerification: (userId: string, name?: string) => void;
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

  const modeRef = useRef<'verify' | 'enroll'>('verify');
  const userIdRef = useRef('');
  const userNameRef = useRef('');
  const startTimeRef = useRef(0);
  const enrollEmbeddingsRef = useRef<Float32Array[]>([]);
  const isProcessingRef = useRef(false);
  const lastLandmarksRef = useRef<FaceLandmark[] | null>(null);

  // ── Controls ───────────────────────────────────────────────────────────────

  const resetInternal = () => {
    geometric.reset();
    rPPG.reset();
    enrollEmbeddingsRef.current = [];
    lastLandmarksRef.current = null;
    isProcessingRef.current = false;
    setResult(null);
    setBlinkCount(0);
    setHeadInFrame(false);
    setCurrentBpm(0);
    setRPPGConfidence(0);
    setGeometricScore(0);
  };

  const startVerification = useCallback((userId: string, name = '') => {
    resetInternal();
    modeRef.current = 'verify';
    userIdRef.current = userId;
    userNameRef.current = name;
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

    // Step 3: rPPG — use real cheek pixel averages extracted by the bridge canvas
    const realPixels = buildRealPixelBuffer(mpResult.cheekPixels, frameWidth, frameHeight);
    rPPG.addFrame(realPixels, landmarks, frameWidth, frameHeight);
    const rPPGResult = rPPG.getResult();
    if (rPPGResult) {
      setCurrentBpm(rPPGResult.pulseFrequency);
      setRPPGConfidence(rPPGResult.confidence);
    }

    // Step 4: Liveness gate
    const geoPass = (geoResult?.score ?? 0) >= LIVENESS.GEOMETRIC_SCORE_MIN;
    const rPPGPass = (rPPGResult?.confidence ?? 0) >= RPPG.CONFIDENCE_MIN
                    && (rPPGResult?.heartbeatDetected ?? false);

    if (!geoPass || !rPPGPass) return;

    // Step 5: Face embedding from landmarks
    setPhase('recognizing');
    const embedding = faceRecognition.generateEmbeddingFromLandmarks(landmarks);
    if (!embedding) {
      setResult({ passed: false, failureReason: 'Could not generate face embedding — ensure face is visible' });
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
    enrollEmbeddingsRef.current.push(embedding);
    if (enrollEmbeddingsRef.current.length < RECOGNITION.ENROLLMENT_FRAMES) {
      setPhase('liveness'); // collect more frames
      return;
    }

    try {
      const averaged = averageEmbeddings(enrollEmbeddingsRef.current);
      // saveBiometric now takes (userId, name, embedding) — 3 args
      const ok = await saveBiometric(userIdRef.current, userNameRef.current, averaged);
      if (!ok) throw new Error('saveBiometric returned false');

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
      // matchBiometric returns { match, score } (not { matched, score })
      const { match, score } = await matchBiometric(userIdRef.current, embeddingArr) as { match: boolean; score: number };
      const latencyMs = Date.now() - startTimeRef.current;

      if (match) {
        await logAttendance(userIdRef.current, score, bpm, null);
        setResult({
          passed: true,
          name: userNameRef.current,
          bpm,
          confidence: score,
          latencyMs,
        });
      } else {
        setResult({
          passed: false, bpm, confidence: score, latencyMs,
          failureReason: score < 0.3 ? 'Face not recognised — try enrolling again' : 'Confidence below threshold',
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

// ─── Real pixel buffer from bridge cheek samples ─────────────────────────────
// Converts the average cheek RGB values returned by the MediaPipe bridge canvas
// into the RGBA buffer format expected by useRemotePhotoplethysmography.
// Each cheek average is placed at the correct landmark pixel position so the
// rPPG hook's sampleCheekPatch() call returns the real skin colour.

function buildRealPixelBuffer(
  cheekPixels: CheekPixel[],
  width: number,
  height: number
): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(width * height * 4);
  // Fill with a neutral mid-grey base (avoids zero-signal on sparse buffers)
  rgba.fill(128);
  for (let a = 3; a < rgba.length; a += 4) rgba[a] = 255;

  if (!cheekPixels || cheekPixels.length === 0) return rgba;

  // Place each cheek sample at its approximate landmark pixel position.
  // Landmark 50 ≈ (0.25, 0.55), Landmark 280 ≈ (0.75, 0.55) in normalised coords.
  const positions = [
    { nx: 0.25, ny: 0.55 },
    { nx: 0.75, ny: 0.55 },
  ];

  const PATCH_R = 20;
  cheekPixels.forEach((pixel, ci) => {
    const pos = positions[ci];
    if (!pos) return;
    const cx = Math.floor(pos.nx * width);
    const cy = Math.floor(pos.ny * height);
    for (let dx = -PATCH_R; dx <= PATCH_R; dx++) {
      for (let dy = -PATCH_R; dy <= PATCH_R; dy++) {
        if (dx * dx + dy * dy > PATCH_R * PATCH_R) continue;
        const px = cx + dx;
        const py = cy + dy;
        if (px < 0 || px >= width || py < 0 || py >= height) continue;
        const idx = (py * width + px) * 4;
        rgba[idx]     = Math.round(pixel.r);
        rgba[idx + 1] = Math.round(pixel.g);
        rgba[idx + 2] = Math.round(pixel.b);
        rgba[idx + 3] = 255;
      }
    }
  });

  return rgba;
}

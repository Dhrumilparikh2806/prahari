/**
 * useRemotePhotoplethysmography.ts — rPPG Heartbeat Liveness Detection Hook
 *
 * Detects a real human pulse by analysing subtle, periodic colour changes in
 * the cheek skin region caused by blood flowing through capillaries.
 *
 * Algorithm:
 *   1. For each camera frame, extract average RGB from two cheek patches
 *      (MediaPipe landmarks 50 and 280).
 *   2. Accumulate a sliding window of up to WINDOW_SIZE frames (~5 s at 30 fps).
 *   3. Once MIN_FRAMES are collected, normalise the green-channel signal and
 *      apply the Goertzel algorithm to identify the dominant frequency in the
 *      valid heart-rate band (MIN_FREQ_HZ – MAX_FREQ_HZ).
 *   4. If a peak frequency in the 60–120 BPM range is found with sufficient
 *      magnitude, heartbeatDetected = true.
 *
 * Anti-spoofing logic:
 *   • Printed photos → flat RGB across all frames → no periodic signal.
 *   • Screen replays → periodic flicker at power-line / refresh frequency
 *     (50/60 Hz), which is outside the valid BPM band.
 *   • Real people → heartbeat-driven periodic signal in the 60–120 BPM band.
 *
 * Bug fixed (Bug 6): extractSkinColor previously hard-coded 480 × 640 as frame
 * dimensions.  frameWidth and frameHeight are now explicit parameters of addFrame
 * so callers can pass the actual camera frame resolution at runtime.
 */

import { useState, useRef } from 'react';
import { RPPG } from '@config/constants';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface rPPGResult {
  /** True when a pulse in the 60–120 BPM range is detected with confidence > CONFIDENCE_MIN */
  heartbeatDetected: boolean;
  /** Detected pulse rate in beats per minute */
  pulseFrequency: number;
  /** Signal confidence in [0, 1] */
  confidence: number;
  /** True if pulseFrequency is in the valid human range (60–120 BPM) */
  isValid: boolean;
  /** Normalised signal magnitude in [0, 1] */
  signalStrength: number;
  /** Human-readable failure reason when heartbeatDetected is false */
  failureReason?: string;
}

export interface UseRemotePhotoplethysmographyState {
  ready: boolean;
  error: string | null;
  loading: boolean;
  /**
   * Feed a single camera frame into the rPPG buffer.
   *
   * @param imageData   Raw RGBA pixel buffer for the current frame.
   * @param landmarks   Array of 468 {x, y, z} normalised points from MediaPipe.
   * @param frameWidth  Width of the frame in pixels (used for pixel indexing).
   * @param frameHeight Height of the frame in pixels (used for bounds checking).
   */
  addFrame: (
    imageData: Uint8ClampedArray,
    landmarks: { x: number; y: number; z: number }[],
    frameWidth: number,
    frameHeight: number
  ) => void;
  /** Returns the current rPPG analysis result, or null if not enough frames yet. */
  getResult: () => rPPGResult | null;
  /** True after the first valid frame has been received */
  isRecording: boolean;
  /** Total number of frames received since the last reset */
  frameCount: number;
  /** Resets the frame buffer and all state (call between sessions) */
  reset: () => void;
}

// ─── Internal constants ───────────────────────────────────────────────────────

/** Radius of the circular cheek-patch sample (pixels) */
const CHEEK_RADIUS = 20;

/** MediaPipe landmark indices for the two cheek regions */
const CHEEK_LANDMARKS = [50, 280];

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useRemotePhotoplethysmography(): UseRemotePhotoplethysmographyState {
  const [ready] = useState(true);
  const [error] = useState<string | null>(null);
  const [loading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [frameCount, setFrameCount] = useState(0);

  /** Sliding window of per-frame average RGB values */
  const rgbSignalRef = useRef<{ r: number[]; g: number[]; b: number[] }>({
    r: [],
    g: [],
    b: [],
  });

  // ── Helpers ────────────────────────────────────────────────────────────────

  /**
   * Samples average RGB from a circular patch centred on a landmark.
   * frameWidth and frameHeight are passed explicitly to avoid hard-coded dims.
   */
  const sampleCheekPatch = (
    imageData: Uint8ClampedArray,
    landmarkX: number,     // normalised [0, 1]
    landmarkY: number,     // normalised [0, 1]
    frameWidth: number,
    frameHeight: number
  ): { r: number; g: number; b: number } | null => {
    // Convert normalised landmark to pixel coordinates
    const cx = Math.floor(landmarkX * frameWidth);
    const cy = Math.floor(landmarkY * frameHeight);

    let r = 0, g = 0, b = 0, count = 0;

    for (let dx = -CHEEK_RADIUS; dx <= CHEEK_RADIUS; dx++) {
      for (let dy = -CHEEK_RADIUS; dy <= CHEEK_RADIUS; dy++) {
        // Circular mask — skip corners
        if (dx * dx + dy * dy > CHEEK_RADIUS * CHEEK_RADIUS) continue;

        const px = cx + dx;
        const py = cy + dy;

        // Bounds check using runtime dimensions (not hard-coded)
        if (px < 0 || px >= frameWidth || py < 0 || py >= frameHeight) continue;

        const idx = (py * frameWidth + px) * 4;
        const alpha = imageData[idx + 3];

        // Skip fully transparent pixels
        if (alpha <= 128) continue;

        r += imageData[idx];
        g += imageData[idx + 1];
        b += imageData[idx + 2];
        count++;
      }
    }

    return count === 0 ? null : { r: r / count, g: g / count, b: b / count };
  };

  /**
   * Extracts average skin colour from both cheek regions and returns their mean.
   */
  const extractSkinColor = (
    imageData: Uint8ClampedArray,
    landmarks: { x: number; y: number; z: number }[],
    frameWidth: number,
    frameHeight: number
  ): { r: number; g: number; b: number } | null => {
    if (!landmarks || landmarks.length === 0) return null;

    let totalR = 0, totalG = 0, totalB = 0, validCheeks = 0;

    for (const idx of CHEEK_LANDMARKS) {
      const lm = landmarks[idx];
      if (!lm) continue;

      const patch = sampleCheekPatch(imageData, lm.x, lm.y, frameWidth, frameHeight);
      if (!patch) continue;

      totalR += patch.r;
      totalG += patch.g;
      totalB += patch.b;
      validCheeks++;
    }

    if (validCheeks === 0) return null;
    return { r: totalR / validCheeks, g: totalG / validCheeks, b: totalB / validCheeks };
  };

  /**
   * Z-score normalises a signal to zero-mean, unit variance.
   * Returns an array of zeros if the signal has no variance (e.g., static image).
   */
  const normalize = (signal: number[]): number[] => {
    if (signal.length === 0) return [];
    const mean = signal.reduce((a, x) => a + x, 0) / signal.length;
    const variance = signal.reduce((a, x) => a + (x - mean) ** 2, 0) / signal.length;
    const stdDev = Math.sqrt(variance);
    if (stdDev === 0) return signal.map(() => 0);
    return signal.map((x) => (x - mean) / stdDev);
  };

  /**
   * Goertzel algorithm — efficient single-frequency DFT magnitude.
   *
   * Far cheaper than a full FFT when we only need magnitude at specific
   * frequencies (one per BPM step).  O(N) per frequency query vs O(N log N)
   * for a full FFT sweep.
   *
   * @param signal      Normalised time-domain signal
   * @param frequency   Target frequency in Hz
   * @param sampleRate  Signal sample rate in Hz (frames per second)
   * @returns Normalised magnitude at the target frequency
   */
  const goertzelMagnitude = (signal: number[], frequency: number, sampleRate: number): number => {
    const N = signal.length;
    const k = (frequency * N) / sampleRate;
    const w = (2 * Math.PI * k) / N;
    const cosW = Math.cos(w);
    const sinW = Math.sin(w);
    const alpha = 2 * cosW;

    let s0 = 0, s1 = 0, s2 = 0;
    for (let i = 0; i < N; i++) {
      s0 = signal[i] + alpha * s1 - s2;
      s2 = s1;
      s1 = s0;
    }

    const real = s1 - s2 * cosW;
    const imag = s2 * sinW;
    return Math.sqrt(real * real + imag * imag) / N;
  };

  /**
   * Scans the valid heart-rate frequency band and returns the peak frequency
   * and its magnitude.
   */
  const detectPulseFrequency = (
    signal: number[]
  ): { frequency: number; magnitude: number } => {
    if (signal.length < RPPG.MIN_FRAMES) return { frequency: 0, magnitude: 0 };

    let maxMagnitude = 0;
    let maxFrequency = 0;

    // Step through valid heart-rate range at 0.01 Hz resolution
    for (let freq = RPPG.MIN_FREQ_HZ; freq <= RPPG.MAX_FREQ_HZ; freq += 0.01) {
      const magnitude = goertzelMagnitude(signal, freq, RPPG.FPS);
      if (magnitude > maxMagnitude) {
        maxMagnitude = magnitude;
        maxFrequency = freq;
      }
    }

    return {
      frequency: maxFrequency * 60, // Hz → BPM
      magnitude: maxMagnitude,
    };
  };

  // ── Public API ─────────────────────────────────────────────────────────────

  const addFrame = (
    imageData: Uint8ClampedArray,
    landmarks: { x: number; y: number; z: number }[],
    frameWidth: number,
    frameHeight: number
  ): void => {
    if (!isRecording) setIsRecording(true);

    const skinColor = extractSkinColor(imageData, landmarks, frameWidth, frameHeight);
    if (!skinColor) return;

    const sig = rgbSignalRef.current;
    sig.r.push(skinColor.r);
    sig.g.push(skinColor.g);
    sig.b.push(skinColor.b);

    // Enforce sliding window — drop oldest frame when full
    if (sig.r.length > RPPG.WINDOW_SIZE) {
      sig.r.shift();
      sig.g.shift();
      sig.b.shift();
    }

    setFrameCount((prev) => prev + 1);
  };

  const getResult = (): rPPGResult | null => {
    const { r, g, b } = rgbSignalRef.current;

    if (r.length < RPPG.MIN_FRAMES) {
      return {
        heartbeatDetected: false,
        pulseFrequency: 0,
        confidence: 0,
        isValid: false,
        signalStrength: 0,
        failureReason: `Collecting signal: ${r.length}/${RPPG.MIN_FRAMES} frames`,
      };
    }

    // Normalise channels
    const rNorm = normalize(r);
    const gNorm = normalize(g);

    // Combine channels: green dominates rPPG; (G − R) further isolates
    // the pulsatile component by cancelling specular reflections.
    const combined = gNorm.map((gv, i) => gv + 0.5 * (gv - rNorm[i]));

    const { frequency, magnitude } = detectPulseFrequency(combined);

    const isValid = frequency >= RPPG.MIN_BPM && frequency <= RPPG.MAX_BPM;
    const heartbeatDetected = isValid && magnitude > 0.1;
    const confidence = Math.min(1, magnitude * 2);

    return {
      heartbeatDetected,
      pulseFrequency: Math.round(frequency),
      confidence,
      isValid,
      signalStrength: magnitude,
      failureReason: heartbeatDetected
        ? undefined
        : isValid
        ? 'Signal too weak — ensure good lighting and hold still'
        : `Pulse out of range: ${Math.round(frequency)} BPM (expected 60–120)`,
    };
  };

  const reset = (): void => {
    rgbSignalRef.current = { r: [], g: [], b: [] };
    setFrameCount(0);
    setIsRecording(false);
  };

  return { ready, error, loading, addFrame, getResult, isRecording, frameCount, reset };
}

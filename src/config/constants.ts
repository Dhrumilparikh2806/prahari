/**
 * constants.ts — Central Configuration for PRAHARI
 *
 * All tunable thresholds, model parameters, and runtime settings live here.
 * Importing from a single file makes it easy to adjust values before a demo
 * without hunting through every hook and component.
 *
 * Naming convention:
 *   MODEL_PATHS   — asset paths for ML model files
 *   RECOGNITION   — face recognition (TFLite MobileFaceNet) settings
 *   LIVENESS      — geometric liveness (EAR + head pose) settings
 *   RPPG          — remote photoplethysmography (heartbeat) settings
 *   VAULT         — biometric storage encryption settings
 *   SYNC          — AWS S3 attendance sync settings
 */

// ─── Model File Paths ─────────────────────────────────────────────────────────

/**
 * Relative paths from the assets/ directory.
 * These files must be present before building — see Section 4 of build.md.
 */
export const MODEL_PATHS = {
  /** MobileFaceNet INT8 quantized TFLite model (~1.9 MB) */
  mobileFaceNet: 'models/mobilefacenet_int8.tflite',
  /** MediaPipe FaceLandmarker task bundle (~3.2 MB) */
  faceLandmarker: 'models/face_landmarker.task',
} as const;

// ─── Face Recognition ─────────────────────────────────────────────────────────

export const RECOGNITION = {
  /**
   * Minimum cosine similarity to accept a match during identity verification.
   * MobileFaceNet produces embeddings where same-person pairs score > 0.7
   * and different-person pairs score < 0.5 under typical lighting.
   */
  SIMILARITY_THRESHOLD: 0.65,

  /** Dimensionality of the face embedding output vector */
  EMBEDDING_DIM: 128,

  /** Width and height of the model's expected input image (pixels) */
  INPUT_SIZE: 112,

  /**
   * Pixel normalisation constants for MobileFaceNet.
   * Pixel value → (pixel − MEAN) / STD → range approximately [−1, 1]
   */
  MEAN: 127.5,
  STD: 128.0,

  /**
   * Number of frames to capture and average during enrollment.
   * Averaging reduces per-frame noise in the embedding.
   */
  ENROLLMENT_FRAMES: 5,

  /**
   * Maximum time allowed for the full pipeline to return a result (ms).
   * Drives the UX timer and benchmark pass/fail gate.
   */
  PIPELINE_TIMEOUT_MS: 800,
} as const;

// ─── Geometric Liveness ───────────────────────────────────────────────────────

export const LIVENESS = {
  /**
   * EAR value above which the eye is considered open.
   * Typical range: 0.25 (slightly sleepy) → 0.40 (wide open).
   */
  EAR_OPEN_THRESHOLD: 0.20,

  /**
   * EAR value below which the eye is considered closed (blink detected).
   * A deliberate blink drops EAR to ~0.05.
   */
  BLINK_THRESHOLD: 0.15,

  /** Minimum blinks required within BLINK_WINDOW_MS to pass liveness */
  MIN_BLINKS: 2,

  /** Rolling window for blink counting (milliseconds) */
  BLINK_WINDOW_MS: 5000,

  /**
   * Maximum allowed yaw angle (degrees).
   * Yaw > 30° means the user is looking sharply to one side.
   */
  YAW_MAX_DEGREES: 30,

  /**
   * Maximum allowed pitch angle (degrees).
   * Pitch > 20° means the user is looking too far up or down.
   */
  PITCH_MAX_DEGREES: 20,

  /**
   * Composite score threshold to declare the geometric liveness check passed.
   * Score is the sum of three 0/1 gates (eyes open, head in frame, blinks).
   */
  GEOMETRIC_SCORE_MIN: 0.7,
} as const;

// ─── rPPG Heartbeat Detection ─────────────────────────────────────────────────

export const RPPG = {
  /**
   * Minimum frames before analysis is attempted.
   * At 30 fps, 30 frames ≈ 1 second of signal.
   */
  MIN_FRAMES: 30,

  /**
   * Sliding window size (frames).
   * At 30 fps, 150 frames ≈ 5 seconds — long enough to detect resting HR.
   */
  WINDOW_SIZE: 150,

  /** Lower valid BPM bound for human resting heart rate */
  MIN_BPM: 60,

  /** Upper valid BPM bound for human resting heart rate */
  MAX_BPM: 120,

  /** Frequency equivalent of MIN_BPM in Hz (60 BPM / 60 s = 1.0 Hz, but we
   *  allow lower to catch bradycardia: 42 BPM → 0.7 Hz) */
  MIN_FREQ_HZ: 0.7,

  /** Frequency equivalent of MAX_BPM in Hz (120 BPM / 60 s = 2.0 Hz) */
  MAX_FREQ_HZ: 2.0,

  /** Camera capture frame rate (frames per second) */
  FPS: 30,

  /**
   * Minimum Goertzel magnitude for heartbeatDetected = true.
   * Signals below this threshold are treated as noise (e.g., static photos).
   */
  CONFIDENCE_MIN: 0.5,
} as const;

// ─── Zero-Knowledge Vault ─────────────────────────────────────────────────────

export const VAULT = {
  /**
   * SecureStore key under which the AES master key is persisted.
   * The V1 suffix allows future key rotation without breaking old installs.
   */
  KEY_ALIAS: 'PRAHARI_AES_KEY_V1',

  /**
   * Minimum cosine similarity for a stored embedding to match a live one
   * during verification.  Higher than RECOGNITION.SIMILARITY_THRESHOLD
   * because the stored embedding was averaged over multiple enrollment frames.
   */
  MATCH_THRESHOLD: 0.85,
} as const;

// ─── AWS Sync ─────────────────────────────────────────────────────────────────

export const SYNC = {
  /** S3 bucket that stores encrypted attendance log bundles */
  S3_BUCKET: 'prahari-attendance-logs',

  /**
   * Lambda endpoint that validates the device token and returns a pre-signed
   * S3 PUT URL.  Replace with your deployed Lambda URL before demo.
   */
  LAMBDA_ENDPOINT: 'https://YOUR_LAMBDA_URL/sync',

  /** AWS region where the bucket and Lambda are deployed */
  REGION: 'ap-south-1',

  /**
   * How long to wait for a sync response before giving up (ms).
   * Keeps the app responsive on flaky field networks.
   */
  TIMEOUT_MS: 30000,
} as const;

// ─── UI / UX ──────────────────────────────────────────────────────────────────

export const UI = {
  /** Primary brand colour used across screens */
  ACCENT_COLOR: '#00C6AE',

  /** Background colour for all screens */
  BACKGROUND_COLOR: '#0A0A0A',

  /** Text colour for body copy */
  TEXT_COLOR: '#FFFFFF',

  /** Oval face guide: fraction of screen width */
  OVAL_WIDTH_RATIO: 0.6,

  /** Oval face guide: vertical position (fraction from top) */
  OVAL_TOP_RATIO: 0.15,

  /** Duration of liveness step transition animation (ms) */
  STEP_ANIMATION_MS: 300,
} as const;

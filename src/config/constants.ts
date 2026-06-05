/**
 * constants.ts — PRAHARI Design Tokens & Configuration
 *
 * Design system: Terra — "Rooted Warmth"
 * Earthy, organic, human. Forest green primary, warm cream background.
 */

// ─── Terra Design Tokens ──────────────────────────────────────────────────────

export const TERRA = {
  /** Warm cream — main app background, never sterile white */
  BACKGROUND: '#faf6f0',
  /** Slightly darker cream — card backgrounds */
  CARD: '#f0e9df',
  /** Surface — inputs, secondary cards */
  SURFACE: '#e8ddd0',
  /** Forest green — primary actions, active states, navigation */
  PRIMARY: '#4a7c59',
  /** Light green — tinted backgrounds behind primary elements */
  PRIMARY_LIGHT: '#e8f0eb',
  /** Warm amber — highlights, accents, badges */
  AMBER: '#705c30',
  /** Amber tinted background */
  AMBER_LIGHT: '#f5edd8',
  /** Main text — dark earthy, never pure black */
  TEXT: '#2E3230',
  /** Secondary text — muted earthy */
  TEXT_SECONDARY: '#6b7c76',
  /** Tertiary / placeholder text */
  TEXT_MUTED: '#9aaba5',
  /** Card border — very subtle */
  BORDER: 'rgba(46,50,48,0.10)',
  /** Divider lines */
  DIVIDER: 'rgba(46,50,48,0.06)',
  /** Success green (same as primary) */
  SUCCESS: '#4a7c59',
  /** Error red — earthy, not neon */
  ERROR: '#9b3a2c',
  /** White */
  WHITE: '#ffffff',
  /** Shadow — warm, not pure grey */
  SHADOW: 'rgba(46,50,48,0.08)',
} as const;

// ─── Typography ───────────────────────────────────────────────────────────────

export const FONTS = {
  /**
   * System serif — similar warmth to Literata, zero download needed.
   * Android uses "serif" (Noto Serif), iOS uses "Georgia".
   */
  HEADLINE: 'Georgia',
  HEADLINE_SEMI: 'Georgia',
  /** Body — system default sans (friendly, readable) */
  BODY: 'System',
  BODY_MEDIUM: 'System',
  BODY_BOLD: 'System',
  SERIF_FALLBACK: 'Georgia',
  SANS_FALLBACK: 'System',
} as const;

// ─── Legacy UI tokens (used by older components) ──────────────────────────────

export const UI = {
  ACCENT_COLOR: TERRA.PRIMARY,
  BACKGROUND_COLOR: TERRA.BACKGROUND,
  TEXT_COLOR: TERRA.TEXT,
  OVAL_WIDTH_RATIO: 0.6,
  OVAL_TOP_RATIO: 0.15,
  STEP_ANIMATION_MS: 300,
} as const;

// ─── Model Paths ──────────────────────────────────────────────────────────────

export const MODEL_PATHS = {
  mobileFaceNet: 'models/mobilefacenet_int8.tflite',
  faceLandmarker: 'models/face_landmarker.task',
} as const;

// ─── Face Recognition ─────────────────────────────────────────────────────────

export const RECOGNITION = {
  SIMILARITY_THRESHOLD: 0.65,
  EMBEDDING_DIM: 128,
  INPUT_SIZE: 112,
  MEAN: 127.5,
  STD: 128.0,
  ENROLLMENT_FRAMES: 5,
  PIPELINE_TIMEOUT_MS: 800,
} as const;

// ─── Liveness Detection ───────────────────────────────────────────────────────

export const LIVENESS = {
  EAR_OPEN_THRESHOLD: 0.20,
  BLINK_THRESHOLD: 0.15,
  MIN_BLINKS: 2,
  BLINK_WINDOW_MS: 5000,
  YAW_MAX_DEGREES: 30,
  PITCH_MAX_DEGREES: 20,
  GEOMETRIC_SCORE_MIN: 0.7,
} as const;

// ─── rPPG ─────────────────────────────────────────────────────────────────────

export const RPPG = {
  MIN_FRAMES: 30,
  WINDOW_SIZE: 150,
  MIN_BPM: 60,
  MAX_BPM: 120,
  MIN_FREQ_HZ: 0.7,
  MAX_FREQ_HZ: 2.0,
  FPS: 30,
  CONFIDENCE_MIN: 0.5,
} as const;

// ─── Vault ────────────────────────────────────────────────────────────────────

export const VAULT = {
  KEY_ALIAS: 'PRAHARI_AES_KEY_V1',
  MATCH_THRESHOLD: 0.85,
} as const;

// ─── Sync ─────────────────────────────────────────────────────────────────────

export const SYNC = {
  S3_BUCKET: 'prahari-attendance-logs',
  LAMBDA_ENDPOINT: 'https://YOUR_LAMBDA_URL/sync',
  REGION: 'ap-south-1',
  TIMEOUT_MS: 30000,
} as const;

/**
 * liveness.test.ts — Unit tests for EAR (Eye Aspect Ratio) calculation
 * Run: npm test
 */

import { calculateEAR } from '../utils/liveness';

// Build a 468-point landmark array, patching specific indices
function makeLandmarks(overrides: Record<number, { x: number; y: number }>) {
  const lms = Array(468).fill(null).map(() => ({ x: 0.5, y: 0.5 }));
  for (const [idx, val] of Object.entries(overrides)) {
    lms[Number(idx)] = val;
  }
  return lms;
}

describe('calculateEAR (left eye: indices 33,160,158,133,153,144)', () => {
  it('returns high EAR (> 0.20) for open eye', () => {
    // Open eye: large vertical distances, normal horizontal
    const lms = makeLandmarks({
      33:  { x: 0.30, y: 0.50 }, // p1 inner corner
      160: { x: 0.35, y: 0.44 }, // p2 top-inner (far above centre)
      158: { x: 0.45, y: 0.44 }, // p3 top-outer
      133: { x: 0.50, y: 0.50 }, // p4 outer corner
      153: { x: 0.45, y: 0.56 }, // p5 bottom-outer
      144: { x: 0.35, y: 0.56 }, // p6 bottom-inner
    });
    const ear = calculateEAR(lms);
    expect(ear).toBeGreaterThan(0.20);
  });

  it('returns low EAR (< 0.15) for closed eye', () => {
    // Closed eye: vertical distances nearly zero
    const lms = makeLandmarks({
      33:  { x: 0.30, y: 0.50 },
      160: { x: 0.35, y: 0.499 },
      158: { x: 0.45, y: 0.499 },
      133: { x: 0.50, y: 0.50 },
      153: { x: 0.45, y: 0.501 },
      144: { x: 0.35, y: 0.501 },
    });
    const ear = calculateEAR(lms);
    expect(ear).toBeLessThan(0.15);
  });

  it('returns falsy when all landmarks collapse to the same point (degenerate)', () => {
    const lms = makeLandmarks({
      33: { x: 0.5, y: 0.5 }, 160: { x: 0.5, y: 0.5 },
      158: { x: 0.5, y: 0.5 }, 133: { x: 0.5, y: 0.5 },
      153: { x: 0.5, y: 0.5 }, 144: { x: 0.5, y: 0.5 },
    });
    // 0/0 = NaN which is falsy — both NaN and 0 indicate "no valid eye detected"
    expect(calculateEAR(lms) || 0).toBe(0);
  });
});

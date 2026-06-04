/**
 * math.test.ts — Unit tests for cosineSimilarity
 * Run: npm test
 */

import { cosineSimilarity } from '../utils/math';

describe('cosineSimilarity', () => {
  it('identical vectors score 1.0', () => {
    const v = [1, 0, 0, 1, 0];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0);
  });

  it('opposite vectors score -1.0', () => {
    const a = [1, 0];
    const b = [-1, 0];
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1.0);
  });

  it('orthogonal vectors score 0.0', () => {
    const a = [1, 0];
    const b = [0, 1];
    expect(cosineSimilarity(a, b)).toBeCloseTo(0.0);
  });

  it('zero vectors return 0', () => {
    expect(cosineSimilarity([0, 0], [0, 0])).toBe(0);
  });

  it('similar 128-dim embeddings score above 0.95', () => {
    const base = Array(128).fill(0).map((_, i) => Math.sin(i * 0.1));
    // Add very small noise
    const similar = base.map(v => v + (0.01 * Math.sin(v)));
    expect(cosineSimilarity(base, similar)).toBeGreaterThan(0.95);
  });

  it('different 128-dim embeddings score below 0.5', () => {
    const a = Array(128).fill(0).map((_, i) => Math.sin(i));
    const b = Array(128).fill(0).map((_, i) => Math.cos(i * 2 + Math.PI));
    expect(cosineSimilarity(a, b)).toBeLessThan(0.5);
  });
});

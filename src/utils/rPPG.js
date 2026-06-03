/**
 * rPPG.js — Remote Photoplethysmography Utilities
 *
 * Provides a pixel-level green-channel extraction helper used by
 * useRemotePhotoplethysmography to sample the cheek region from raw
 * RGBA frame data.
 *
 * Bug fixed (Bug 4): frameWidth was previously referenced as a free variable
 * inside extractGreenChannel.  It is now an explicit parameter so callers can
 * pass the actual frame width at runtime.
 */

/**
 * Computes the average green-channel value for all pixels inside a rectangular
 * Region of Interest (ROI).
 *
 * The frame pixel data is assumed to be a flat Uint8ClampedArray in RGBA order
 * (4 bytes per pixel), as returned by a canvas 2D context or camera frame
 * processor.
 *
 * @param {Uint8ClampedArray} framePixels  Raw RGBA pixel buffer
 * @param {{ startX: number, startY: number, endX: number, endY: number }} roi
 *   Bounding rectangle (pixel coordinates, inclusive of start, exclusive of end)
 * @param {number} frameWidth  Width of the full frame in pixels (required to
 *   compute the flat-array index for each (x, y) position)
 * @returns {number}  Average green value in [0, 255], or 0 if ROI is empty
 */
export const extractGreenChannel = (framePixels, roi, frameWidth) => {
  let greenSum = 0;
  let pixelCount = 0;

  for (let i = roi.startY; i < roi.endY; i++) {
    for (let j = roi.startX; j < roi.endX; j++) {
      // RGBA flat index: each pixel occupies 4 consecutive bytes
      const index = (i * frameWidth + j) * 4;
      greenSum += framePixels[index + 1]; // index + 1 → green channel
      pixelCount++;
    }
  }

  return pixelCount === 0 ? 0 : greenSum / pixelCount;
};

/**
 * Convenience wrapper: extracts the average RGB (not just green) across a
 * circular patch of radius `radius` pixels centred on (cx, cy).
 *
 * Used by useRemotePhotoplethysmography to sample both cheek landmarks.
 *
 * @param {Uint8ClampedArray} framePixels  Raw RGBA pixel buffer
 * @param {number} cx           Centre X in pixels
 * @param {number} cy           Centre Y in pixels
 * @param {number} radius       Patch radius in pixels
 * @param {number} frameWidth   Frame width in pixels
 * @param {number} frameHeight  Frame height in pixels
 * @returns {{ r: number, g: number, b: number } | null}
 *   Per-channel averages, or null if no pixels could be sampled
 */
export const extractPatchRGB = (framePixels, cx, cy, radius, frameWidth, frameHeight) => {
  let r = 0, g = 0, b = 0, count = 0;

  for (let dx = -radius; dx <= radius; dx++) {
    for (let dy = -radius; dy <= radius; dy++) {
      // Circular mask
      if (dx * dx + dy * dy > radius * radius) continue;

      const px = cx + dx;
      const py = cy + dy;

      // Bounds check
      if (px < 0 || px >= frameWidth || py < 0 || py >= frameHeight) continue;

      const idx = (py * frameWidth + px) * 4;
      const alpha = framePixels[idx + 3];

      // Skip transparent pixels
      if (alpha <= 128) continue;

      r += framePixels[idx];
      g += framePixels[idx + 1];
      b += framePixels[idx + 2];
      count++;
    }
  }

  if (count === 0) return null;
  return { r: r / count, g: g / count, b: b / count };
};

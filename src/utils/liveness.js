// Calculates Eye Aspect Ratio (EAR) for blink detection
export const calculateEAR = (landmarks) => {
  // Assuming landmarks array from MediaPipe Face Mesh
  // Left eye indices: 33, 160, 158, 133, 153, 144
  const p1 = landmarks[33];
  const p2 = landmarks[160];
  const p3 = landmarks[158];
  const p4 = landmarks[133];
  const p5 = landmarks[153];
  const p6 = landmarks[144];

  // Euclidean distances
  const vertical1 = Math.hypot(p2.x - p6.x, p2.y - p6.y);
  const vertical2 = Math.hypot(p3.x - p5.x, p3.y - p5.y);
  const horizontal = Math.hypot(p1.x - p4.x, p1.y - p4.y);

  return (vertical1 + vertical2) / (2.0 * horizontal);
};
// Trigger blink if EAR drops below ~0.20

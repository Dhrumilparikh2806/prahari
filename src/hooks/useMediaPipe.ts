/**
 * useMediaPipe.ts — Offline-Capable MediaPipe FaceLandmarker Bridge
 *
 * Offline strategy: WebView HTTP cache (Android system WebView / Chromium).
 * Bridge HTML is inlined as a string so no file:// URI is needed — this is
 * critical on Android where <script type="module"> imports are blocked from
 * file:// origins. Using { html, baseUrl: CDN } makes the page appear to
 * come from the CDN origin, allowing ES module imports to work.
 */

import { useState, useRef, useCallback } from 'react';

// ─── Inline bridge HTML ───────────────────────────────────────────────────────
// Embedded as a string so the WebView can be loaded with baseUrl pointing at
// the CDN — this is the only way ES module imports work on Android WebView
// (file:// origin blocks cross-origin ES module imports).

const BRIDGE_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>body{margin:0;background:transparent;}canvas,img{display:none;}</style>
</head>
<body>
<canvas id="c"></canvas>
<img id="img">
<script type="module">
import { FaceLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/vision_bundle.mjs";

let faceLandmarker = null;
let isReady = false;

function post(data) {
  if (window.ReactNativeWebView) {
    window.ReactNativeWebView.postMessage(JSON.stringify(data));
  }
}

const timeout = setTimeout(() => {
  if (!isReady) post({ type: 'ERROR', message: 'AI model load timeout. Connect to WiFi for first launch, then it works offline.' });
}, 90000);

async function init() {
  try {
    post({ type: "LOG", message: "Loading WASM..." });
    // Try Metro dev server first (local, fast), then CDN fallback
    const wasmUrls = [
      "http://127.0.0.1:8081/assets/./assets/wasm",
      "http://127.0.0.1:8082/assets/./assets/wasm",
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm",
      "https://unpkg.com/@mediapipe/tasks-vision@0.10.0/wasm",
    ];
    let vision = null;
    for (const url of wasmUrls) {
      try {
        post({ type: "LOG", message: "Trying WASM: " + url });
        vision = await FilesetResolver.forVisionTasks(url);
        post({ type: "LOG", message: "WASM loaded from: " + url });
        break;
      } catch(e) {
        post({ type: "LOG", message: "Failed: " + url });
      }
    }
    if (!vision) throw new Error("All WASM sources failed");

    post({ type: "LOG", message: "Loading model..." });
    // Try Metro dev server first (model file is in assets/models/), then CDN fallback
    const modelUrls = [
      "http://127.0.0.1:8081/assets/./assets/models/face_landmarker.task",
      "http://127.0.0.1:8082/assets/./assets/models/face_landmarker.task",
      "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm/face_landmarker.task",
    ];

    let lastErr;
    for (const modelUrl of modelUrls) {
      try {
        faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: modelUrl, delegate: "CPU" },
          outputFaceBlendshapes: false,
          outputFacialTransformationMatrixes: false,
          runningMode: "IMAGE",
          numFaces: 1
        });
        post({ type: "LOG", message: "Model loaded from: " + modelUrl });
        break;
      } catch (e) {
        lastErr = e;
        post({ type: "LOG", message: "Model URL failed: " + modelUrl });
      }
    }

    if (!faceLandmarker) throw lastErr;

    clearTimeout(timeout);
    isReady = true;
    post({ type: "READY" });
  } catch (err) {
    clearTimeout(timeout);
    post({ type: "ERROR", message: "Init failed: " + String(err) });
  }
}

async function processFrame(imageBase64, seq) {
  if (!isReady || !faceLandmarker) return;
  try {
    const canvas = document.getElementById("c");
    const ctx    = canvas.getContext("2d");
    const img    = document.getElementById("img");

    await new Promise((resolve, reject) => {
      img.onload  = resolve;
      img.onerror = reject;
      img.src = imageBase64.startsWith("data:") ? imageBase64
              : "data:image/jpeg;base64," + imageBase64;
    });

    canvas.width  = img.naturalWidth;
    canvas.height = img.naturalHeight;
    ctx.drawImage(img, 0, 0);

    const result = faceLandmarker.detect(canvas);

    if (!result || !result.faceLandmarks || !result.faceLandmarks.length) {
      post({ type: "NO_FACE", seq });
      return;
    }

    const landmarks = result.faceLandmarks[0].map(
      lm => ({ x: lm.x, y: lm.y, z: lm.z || 0 })
    );

    // Extract real cheek pixel averages for rPPG (landmarks 50 = left cheek, 280 = right cheek)
    const cheekPixels = [];
    const CHEEK_R = 12;
    for (const lmIdx of [50, 280]) {
      const lm = landmarks[lmIdx];
      if (!lm) continue;
      const cx = Math.floor(lm.x * canvas.width);
      const cy = Math.floor(lm.y * canvas.height);
      const x = Math.max(0, cx - CHEEK_R);
      const y = Math.max(0, cy - CHEEK_R);
      const w = Math.min(canvas.width - x, CHEEK_R * 2);
      const h = Math.min(canvas.height - y, CHEEK_R * 2);
      if (w <= 0 || h <= 0) continue;
      try {
        const patch = ctx.getImageData(x, y, w, h).data;
        let r = 0, g = 0, b = 0, n = 0;
        for (let i = 0; i < patch.length; i += 4) {
          r += patch[i]; g += patch[i+1]; b += patch[i+2]; n++;
        }
        if (n > 0) cheekPixels.push({ r: r/n, g: g/n, b: b/n });
      } catch(e) {}
    }

    post({ type: "LANDMARKS", landmarks, count: landmarks.length,
           frameWidth: canvas.width, frameHeight: canvas.height,
           cheekPixels, seq });
  } catch (err) {
    post({ type: "ERROR", message: "Frame error: " + String(err) });
  }
}

window.addEventListener("message", (e) => {
  let msg; try { msg = JSON.parse(e.data); } catch { return; }
  if (msg.type === "PROCESS_FRAME") processFrame(msg.imageBase64, msg.seq || 0);
});
document.addEventListener("message", (e) => {
  window.dispatchEvent(new MessageEvent("message", { data: e.data }));
});

init();
<\/script>
</body>
</html>`;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FaceLandmark { x: number; y: number; z: number; }

export interface CheekPixel { r: number; g: number; b: number; }

export interface MediaPipeResult {
  landmarks: FaceLandmark[] | null;
  frameWidth: number;
  frameHeight: number;
  /** Average RGB from left + right cheek patches — used by rPPG */
  cheekPixels: CheekPixel[];
}

export interface UseMediaPipeState {
  ready: boolean;
  loading: boolean;
  error: string | null;
  webViewRef: React.RefObject<any>;
  /** Inline HTML string — use as WebView source={{ html, baseUrl: CDN }} */
  htmlSource: string;
  onMessage: (event: { nativeEvent: { data: string } }) => void;
  processFrame: (imageBase64: string, timeoutMs?: number) => Promise<MediaPipeResult | null>;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useMediaPipe(): UseMediaPipeState {
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // htmlSource is always available synchronously — no async asset loading needed
  const htmlSource = BRIDGE_HTML;

  const webViewRef = useRef<any>(null);
  const frameSeqRef = useRef(0);
  const pendingRef = useRef<Map<number, {
    resolve: (r: MediaPipeResult | null) => void;
    timer: ReturnType<typeof setTimeout>;
  }>>(new Map());

  // ── Message handler ────────────────────────────────────────────────────────

  const onMessage = useCallback((event: { nativeEvent: { data: string } }) => {
    let msg: Record<string, unknown>;
    try { msg = JSON.parse(event.nativeEvent.data); } catch { return; }

    switch (msg.type) {
      case 'READY':
        setReady(true);
        setLoading(false);
        break;

      case 'LANDMARKS': {
        const seq = (msg.seq as number) ?? -1;
        resolvePending(seq, {
          landmarks: msg.landmarks as FaceLandmark[],
          frameWidth:  (msg.frameWidth  as number) ?? 480,
          frameHeight: (msg.frameHeight as number) ?? 640,
          cheekPixels: (msg.cheekPixels as CheekPixel[]) ?? [],
        });
        break;
      }

      case 'NO_FACE':
        resolvePending((msg.seq as number) ?? -1, null);
        break;

      case 'ERROR':
        console.warn('[useMediaPipe] Bridge error:', msg.message);
        if (!ready) { setError(msg.message as string); setLoading(false); }
        for (const [key, p] of pendingRef.current) {
          clearTimeout(p.timer); p.resolve(null); pendingRef.current.delete(key);
        }
        break;
    }
  }, [ready]);

  function resolvePending(seq: number, result: MediaPipeResult | null) {
    const p = pendingRef.current.get(seq);
    if (p) {
      clearTimeout(p.timer); pendingRef.current.delete(seq); p.resolve(result);
      return;
    }
    const first = pendingRef.current.entries().next().value;
    if (first) {
      const [key, pend] = first;
      clearTimeout(pend.timer); pendingRef.current.delete(key); pend.resolve(result);
    }
  }

  // ── processFrame ──────────────────────────────────────────────────────────

  const processFrame = useCallback(async (
    imageBase64: string,
    timeoutMs = 3000
  ): Promise<MediaPipeResult | null> => {
    if (!ready || !webViewRef.current) return null;
    const seq = ++frameSeqRef.current;

    return new Promise<MediaPipeResult | null>((resolve) => {
      const timer = setTimeout(() => {
        pendingRef.current.delete(seq);
        resolve(null);
      }, timeoutMs);
      pendingRef.current.set(seq, { resolve, timer });
      webViewRef.current.postMessage(
        JSON.stringify({ type: 'PROCESS_FRAME', imageBase64, seq })
      );
    });
  }, [ready]);

  return { ready, loading, error, webViewRef, htmlSource, onMessage, processFrame };
}

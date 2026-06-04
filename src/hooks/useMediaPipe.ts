/**
 * useMediaPipe.ts — MediaPipe FaceLandmarker WebView Bridge
 *
 * Passes the bridge HTML as an inline string (source={{ html }}) instead of
 * a file:// URI. This avoids Android's ERR_ACCESS_DENIED on local file access
 * and works on all Android API levels without extra WebView permissions.
 *
 * MediaPipe WASM is still loaded from CDN (requires internet on first load,
 * then cached by the WebView).
 */

import { useState, useRef, useCallback } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FaceLandmark {
  x: number;
  y: number;
  z: number;
}

export interface MediaPipeResult {
  landmarks: FaceLandmark[] | null;
  frameWidth: number;
  frameHeight: number;
}

export interface UseMediaPipeState {
  ready: boolean;
  loading: boolean;
  error: string | null;
  webViewRef: React.RefObject<any>;
  /** Pass to WebView source prop: source={mediaPipe.htmlSource} */
  htmlSource: { html: string; baseUrl: string } | null;
  /** @deprecated Use htmlSource instead of htmlUri */
  htmlUri: string | null;
  onMessage: (event: { nativeEvent: { data: string } }) => void;
  processFrame: (imageBase64: string, timeoutMs?: number) => Promise<MediaPipeResult | null>;
}

// ─── Bridge HTML (inline — avoids file:// access denied) ─────────────────────

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
// ES module import — vision_bundle.mjs exports FaceLandmarker and FilesetResolver
import { FaceLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/vision_bundle.mjs";

let faceLandmarker = null;
let isReady = false;

function post(data) {
  if (window.ReactNativeWebView) {
    window.ReactNativeWebView.postMessage(JSON.stringify(data));
  }
}

async function init() {
  try {
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm"
    );

    faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
        delegate: "CPU"
      },
      outputFaceBlendshapes: false,
      outputFacialTransformationMatrixes: false,
      runningMode: "IMAGE",
      numFaces: 1
    });

    isReady = true;
    post({ type: "READY" });
  } catch (err) {
    post({ type: "ERROR", message: "Init failed: " + String(err) });
  }
}

// Auto-timeout: if CDN takes >60s, report error so UI doesn't freeze
setTimeout(() => {
  if (!isReady) post({ type: "ERROR", message: "MediaPipe load timeout — check internet connection" });
}, 60000);

async function processFrame(imageBase64, seq) {
  if (!isReady || !faceLandmarker) return;
  try {
    const canvas = document.getElementById("c");
    const ctx = canvas.getContext("2d");
    const img = document.getElementById("img");

    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = imageBase64.startsWith("data:") ? imageBase64 : "data:image/jpeg;base64," + imageBase64;
    });

    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    ctx.drawImage(img, 0, 0);

    const result = faceLandmarker.detect(canvas);

    if (!result?.faceLandmarks?.length) {
      post({ type: "NO_FACE", seq });
      return;
    }

    const landmarks = result.faceLandmarks[0].map(lm => ({ x: lm.x, y: lm.y, z: lm.z || 0 }));
    post({ type: "LANDMARKS", landmarks, count: landmarks.length, frameWidth: canvas.width, frameHeight: canvas.height, seq });
  } catch (err) {
    post({ type: "ERROR", message: "Frame error: " + String(err) });
  }
}

// Listen from React Native
window.addEventListener("message", (event) => {
  let msg;
  try { msg = JSON.parse(event.data); } catch { return; }
  if (msg.type === "PROCESS_FRAME") processFrame(msg.imageBase64, msg.seq || 0);
});
document.addEventListener("message", (event) => {
  window.dispatchEvent(new MessageEvent("message", { data: event.data }));
});

init();
</script>
</body>
</html>`;

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useMediaPipe(): UseMediaPipeState {
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const webViewRef = useRef<any>(null);
  const frameSeqRef = useRef(0);
  const pendingRef = useRef<Map<number, {
    resolve: (r: MediaPipeResult | null) => void;
    timer: ReturnType<typeof setTimeout>;
  }>>(new Map());

  // Inline HTML source — no file:// needed
  const htmlSource = {
    html: BRIDGE_HTML,
    baseUrl: 'https://cdn.jsdelivr.net',  // allows CDN requests
  };

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
          frameWidth: (msg.frameWidth as number) ?? 480,
          frameHeight: (msg.frameHeight as number) ?? 640,
        });
        break;
      }

      case 'NO_FACE':
        resolvePending((msg.seq as number) ?? -1, null);
        break;

      case 'ERROR':
        console.warn('[useMediaPipe]', msg.message);
        if (!ready) {
          setError(msg.message as string);
          setLoading(false);
        }
        for (const [key, p] of pendingRef.current) {
          clearTimeout(p.timer);
          p.resolve(null);
          pendingRef.current.delete(key);
        }
        break;
    }
  }, [ready]);

  function resolvePending(seq: number, result: MediaPipeResult | null) {
    const p = pendingRef.current.get(seq);
    if (p) {
      clearTimeout(p.timer);
      pendingRef.current.delete(seq);
      p.resolve(result);
      return;
    }
    const first = pendingRef.current.entries().next().value;
    if (first) {
      const [key, pend] = first;
      clearTimeout(pend.timer);
      pendingRef.current.delete(key);
      pend.resolve(result);
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
      webViewRef.current.postMessage(JSON.stringify({
        type: 'PROCESS_FRAME',
        imageBase64,
        seq,
      }));
    });
  }, [ready]);

  return {
    ready,
    loading,
    error,
    webViewRef,
    htmlSource,
    htmlUri: null,  // kept for backwards compat — use htmlSource now
    onMessage,
    processFrame,
  };
}

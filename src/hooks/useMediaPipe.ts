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
<script>
'use strict';
var faceLandmarker = null;
var isReady = false;

function post(data) {
  if (window.ReactNativeWebView) {
    window.ReactNativeWebView.postMessage(JSON.stringify(data));
  }
}

async function init() {
  try {
    await new Promise(function(resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/vision_bundle.js';
      s.onload = resolve;
      s.onerror = function(e) { reject(new Error('CDN load failed: ' + e)); };
      document.head.appendChild(s);
    });

    var FilesetResolver = window.FilesetResolver;
    var FaceLandmarker = window.FaceLandmarker;

    if (!FilesetResolver || !FaceLandmarker) {
      throw new Error('MediaPipe classes not found');
    }

    var vision = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm'
    );

    faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
        delegate: 'CPU'
      },
      outputFaceBlendshapes: false,
      outputFacialTransformationMatrixes: false,
      runningMode: 'IMAGE',
      numFaces: 1
    });

    isReady = true;
    post({ type: 'READY' });
  } catch (err) {
    post({ type: 'ERROR', message: 'Init failed: ' + String(err) });
  }
}

async function processFrame(imageBase64, seq) {
  if (!isReady || !faceLandmarker) {
    post({ type: 'ERROR', message: 'Not ready' });
    return;
  }
  try {
    var canvas = document.getElementById('c');
    var ctx = canvas.getContext('2d');
    var img = document.getElementById('img');

    await new Promise(function(resolve, reject) {
      img.onload = resolve;
      img.onerror = reject;
      img.src = imageBase64.startsWith('data:') ? imageBase64 : 'data:image/jpeg;base64,' + imageBase64;
    });

    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    ctx.drawImage(img, 0, 0);

    var result = faceLandmarker.detect(canvas);

    if (!result || !result.faceLandmarks || result.faceLandmarks.length === 0) {
      post({ type: 'NO_FACE', seq: seq });
      return;
    }

    var landmarks = result.faceLandmarks[0].map(function(lm) {
      return { x: lm.x, y: lm.y, z: lm.z || 0 };
    });

    post({
      type: 'LANDMARKS',
      landmarks: landmarks,
      count: landmarks.length,
      frameWidth: canvas.width,
      frameHeight: canvas.height,
      seq: seq
    });
  } catch (err) {
    post({ type: 'ERROR', message: 'Frame error: ' + String(err) });
  }
}

window.addEventListener('message', function(event) {
  var msg;
  try { msg = JSON.parse(event.data); } catch (_) { return; }
  if (msg.type === 'PROCESS_FRAME') {
    processFrame(msg.imageBase64, msg.seq || 0);
  }
});

document.addEventListener('message', function(event) {
  window.dispatchEvent(new MessageEvent('message', { data: event.data }));
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

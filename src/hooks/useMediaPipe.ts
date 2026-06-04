/**
 * useMediaPipe.ts — MediaPipe FaceLandmarker WebView Bridge Hook
 *
 * The bridge HTML (assets/mediapipe_bridge.html) auto-initialises FaceLandmarker
 * from CDN when the WebView loads — no INIT message needed from this side.
 *
 * Protocol:
 *   RN → WebView:  { type: 'PROCESS_FRAME', imageBase64, seq }
 *   WebView → RN:  { type: 'READY' }
 *                  { type: 'LANDMARKS', landmarks, frameWidth, frameHeight, seq }
 *                  { type: 'NO_FACE', seq }
 *                  { type: 'ERROR', message }
 */

import { useState, useRef, useCallback } from 'react';
import { Asset } from 'expo-asset';

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
  htmlUri: string | null;
  onMessage: (event: { nativeEvent: { data: string } }) => void;
  processFrame: (imageBase64: string, timeoutMs?: number) => Promise<MediaPipeResult | null>;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useMediaPipe(): UseMediaPipeState {
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [htmlUri, setHtmlUri] = useState<string | null>(null);

  const webViewRef = useRef<any>(null);
  const frameSeqRef = useRef(0);
  const pendingRef = useRef<Map<number, {
    resolve: (r: MediaPipeResult | null) => void;
    timer: ReturnType<typeof setTimeout>;
  }>>(new Map());

  // Load HTML asset on first render (once)
  const loadStartedRef = useRef(false);
  if (!loadStartedRef.current) {
    loadStartedRef.current = true;
    (async () => {
      try {
        const asset = Asset.fromModule(require('../../assets/mediapipe_bridge.html'));
        await asset.downloadAsync();
        if (asset.localUri) setHtmlUri(asset.localUri);
        else throw new Error('Could not resolve mediapipe_bridge.html local URI');
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'HTML asset load failed';
        setError(msg);
        setLoading(false);
      }
    })();
  }

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

      case 'NO_FACE': {
        const seq = (msg.seq as number) ?? -1;
        resolvePending(seq, null);
        break;
      }

      case 'ERROR':
        console.warn('[useMediaPipe]', msg.message);
        if (!ready) {
          setError(msg.message as string);
          setLoading(false);
        }
        // Reject all pending frames on error
        for (const [key, p] of pendingRef.current) {
          clearTimeout(p.timer);
          p.resolve(null);
          pendingRef.current.delete(key);
        }
        break;

      default:
        break;
    }
  }, [ready]);

  function resolvePending(seq: number, result: MediaPipeResult | null) {
    // Try exact seq match first
    const p = pendingRef.current.get(seq);
    if (p) {
      clearTimeout(p.timer);
      pendingRef.current.delete(seq);
      p.resolve(result);
      return;
    }
    // Fallback: resolve oldest pending (seq=-1 or bridge doesn't echo seq)
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
        resolve(null); // timeout → treat as no face
      }, timeoutMs);

      pendingRef.current.set(seq, { resolve, timer });

      webViewRef.current.postMessage(JSON.stringify({
        type: 'PROCESS_FRAME',
        imageBase64,
        seq,
      }));
    });
  }, [ready]);

  return { ready, loading, error, webViewRef, htmlUri, onMessage, processFrame };
}

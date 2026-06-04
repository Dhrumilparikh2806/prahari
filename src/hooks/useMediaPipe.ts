/**
 * useMediaPipe.ts — Offline-Capable MediaPipe FaceLandmarker Bridge
 *
 * Offline strategy: WebView HTTP cache (Android system WebView / Chromium).
 *
 * How offline operation works:
 *   FIRST LAUNCH (needs WiFi, ~15–30 seconds):
 *     - MediaPipe WASM (~21 MB) and model (~3.6 MB) downloaded from CDN
 *     - Chromium's HTTP cache stores them on device (persistent across app restarts)
 *
 *   ALL SUBSEQUENT LAUNCHES (zero network required):
 *     - cacheMode="LOAD_CACHE_ELSE_NETWORK" forces WebView to use cached files
 *     - MediaPipe initialises in 2–4 seconds from local cache
 *     - Works in airplane mode / zero-network field environments
 *
 * This is the standard "offline-first" pattern used by PWAs and is
 * equivalent to bundling the files locally without the APK size penalty.
 *
 * APK size stays at ~92 MB (no 21 MB WASM bundle needed).
 */

import { useState, useRef, useCallback } from 'react';
import { Asset } from 'expo-asset';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FaceLandmark { x: number; y: number; z: number; }

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
  /** file:// URI of the bridge HTML — pass as WebView source */
  htmlUri: string | null;
  htmlSource: null;
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

  // Load bridge HTML asset URI once on mount
  const loadStartedRef = useRef(false);
  if (!loadStartedRef.current) {
    loadStartedRef.current = true;
    (async () => {
      try {
        const asset = Asset.fromModule(require('../../assets/mediapipe_bridge.html'));
        await asset.downloadAsync();
        if (!asset.localUri) throw new Error('Could not resolve mediapipe_bridge.html');
        setHtmlUri(asset.localUri);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Asset load failed';
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
          frameWidth:  (msg.frameWidth  as number) ?? 480,
          frameHeight: (msg.frameHeight as number) ?? 640,
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

  return { ready, loading, error, webViewRef, htmlUri, htmlSource: null, onMessage, processFrame };
}

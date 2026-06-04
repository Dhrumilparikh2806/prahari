/**
 * useMediaPipe.ts — 100% OFFLINE MediaPipe FaceLandmarker Bridge
 *
 * All MediaPipe assets (WASM runtime + face landmark model) are bundled
 * inside the APK and loaded from the Android asset file system.
 * NO internet connection required — works in zero-network environments.
 *
 * How offline loading works:
 *   1. assets/mediapipe_bridge.html is bundled by Expo's asset system.
 *   2. expo-asset resolves it to a local file:// URI on the device.
 *   3. The WebView loads the HTML from file:// with file access enabled.
 *   4. The HTML loads WASM and model from sibling paths (./mediapipe_wasm/)
 *      which are also in the APK's android_asset/ directory.
 *   5. MediaPipe initialises entirely from local files — no CDN call.
 *
 * WebView permissions needed for file:// access:
 *   allowFileAccess={true}
 *   allowFileAccessFromFileURLs={true}
 *   allowUniversalAccessFromFileURLs={true}
 *
 * These are set in enroll.tsx and verify.tsx on the <WebView> component.
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
  /** URI to pass as WebView source — load the bridge HTML from local assets */
  htmlUri: string | null;
  onMessage: (event: { nativeEvent: { data: string } }) => void;
  processFrame: (imageBase64: string, timeoutMs?: number) => Promise<MediaPipeResult | null>;
  /** @deprecated Use htmlUri with file:// loading instead */
  htmlSource: null;
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

  // Load the bridge HTML from local assets once
  const loadStartedRef = useRef(false);
  if (!loadStartedRef.current) {
    loadStartedRef.current = true;
    (async () => {
      try {
        // This resolves to a file:// URI on the device filesystem.
        // For Android release builds, the file lives in the APK's assets/
        // directory and is extracted to the app's data directory by expo-asset.
        const asset = Asset.fromModule(
          require('../../assets/mediapipe_bridge.html')
        );
        await asset.downloadAsync();

        if (!asset.localUri) throw new Error('Could not resolve mediapipe_bridge.html');
        setHtmlUri(asset.localUri);
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
          frameWidth:  (msg.frameWidth  as number) ?? 480,
          frameHeight: (msg.frameHeight as number) ?? 640,
        });
        break;
      }

      case 'NO_FACE':
        resolvePending((msg.seq as number) ?? -1, null);
        break;

      case 'ERROR':
        console.warn('[useMediaPipe]', msg.message);
        if (!ready) { setError(msg.message as string); setLoading(false); }
        for (const [key, p] of pendingRef.current) {
          clearTimeout(p.timer); p.resolve(null); pendingRef.current.delete(key);
        }
        break;
    }
  }, [ready]);

  function resolvePending(seq: number, result: MediaPipeResult | null) {
    const p = pendingRef.current.get(seq);
    if (p) { clearTimeout(p.timer); pendingRef.current.delete(seq); p.resolve(result); return; }
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
      webViewRef.current.postMessage(JSON.stringify({ type: 'PROCESS_FRAME', imageBase64, seq }));
    });
  }, [ready]);

  return { ready, loading, error, webViewRef, htmlUri, htmlSource: null, onMessage, processFrame };
}

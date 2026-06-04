/**
 * useMediaPipe.ts — 100% OFFLINE MediaPipe FaceLandmarker Bridge
 *
 * Offline strategy:
 *   1. All MediaPipe assets are bundled inside the APK via Metro's asset system.
 *   2. On first launch, we use expo-file-system to copy them from their hashed
 *      Expo asset paths into a predictable directory:
 *        FileSystem.cacheDirectory + 'mediapipe/'
 *   3. The WebView bridge HTML is placed at:
 *        cacheDirectory/mediapipe/mediapipe_bridge.html
 *   4. The bridge loads WASM and model from relative paths:
 *        ./vision_wasm_internal.wasm  (etc.)
 *        ./models/face_landmarker.task
 *   5. NO internet required — loads entirely from device storage.
 *
 * Subsequent launches skip the copy step (files already in cache).
 */

import { useState, useRef, useCallback } from 'react';
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system';

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
  htmlUri: string | null;
  htmlSource: null;
  onMessage: (event: { nativeEvent: { data: string } }) => void;
  processFrame: (imageBase64: string, timeoutMs?: number) => Promise<MediaPipeResult | null>;
}

// ─── Asset manifest ───────────────────────────────────────────────────────────

// All MediaPipe files bundled in the APK.  Each entry maps to a fixed filename
// in the cacheDirectory/mediapipe/ directory that the bridge HTML references.
const MEDIAPIPE_ASSETS = [
  { require: () => require('../../assets/mediapipe_wasm/vision_bundle.mjs'),              dest: 'vision_bundle.mjs' },
  { require: () => require('../../assets/mediapipe_wasm/vision_wasm_internal.js'),        dest: 'vision_wasm_internal.js' },
  { require: () => require('../../assets/mediapipe_wasm/vision_wasm_internal.wasm'),      dest: 'vision_wasm_internal.wasm' },
  { require: () => require('../../assets/mediapipe_wasm/vision_wasm_nosimd_internal.js'), dest: 'vision_wasm_nosimd_internal.js' },
  { require: () => require('../../assets/mediapipe_wasm/vision_wasm_nosimd_internal.wasm'), dest: 'vision_wasm_nosimd_internal.wasm' },
  { require: () => require('../../assets/models/face_landmarker.task'),                   dest: 'models/face_landmarker.task' },
  { require: () => require('../../assets/mediapipe_bridge.html'),                         dest: 'mediapipe_bridge.html' },
] as const;

const CACHE_DIR = `${FileSystem.cacheDirectory}mediapipe/`;

// ─── Setup: copy assets to predictable paths ──────────────────────────────────

async function setupOfflineAssets(): Promise<string> {
  // Create the cache directory and models subdirectory
  await FileSystem.makeDirectoryAsync(`${CACHE_DIR}models/`, { intermediates: true });

  for (const entry of MEDIAPIPE_ASSETS) {
    const destPath = `${CACHE_DIR}${entry.dest}`;

    // Skip if already copied (avoids re-copying on every launch)
    const info = await FileSystem.getInfoAsync(destPath);
    if (info.exists) continue;

    // Download asset to get its local Expo URI, then copy to fixed path
    const asset = Asset.fromModule(entry.require());
    await asset.downloadAsync();

    if (!asset.localUri) throw new Error(`Failed to download asset: ${entry.dest}`);

    await FileSystem.copyAsync({ from: asset.localUri, to: destPath });
  }

  return `${CACHE_DIR}mediapipe_bridge.html`;
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

  // Run asset setup once on mount
  const setupDoneRef = useRef(false);
  if (!setupDoneRef.current) {
    setupDoneRef.current = true;
    setupOfflineAssets()
      .then((uri) => setHtmlUri(uri))
      .catch((err) => {
        const msg = err instanceof Error ? err.message : 'Asset setup failed';
        console.error('[useMediaPipe] setup failed:', msg);
        setError(msg);
        setLoading(false);
      });
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

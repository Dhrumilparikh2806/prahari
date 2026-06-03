/**
 * useMediaPipe.ts — MediaPipe FaceLandmarker WebView Bridge Hook
 *
 * @mediapipe/tasks-vision is a web-only library.  It requires a browser DOM,
 * a WebAssembly context, and IndexedDB — none of which are available in React
 * Native's Hermes/JSC runtime.
 *
 * Solution: run MediaPipe inside a hidden <WebView> that hosts a local HTML
 * page (assets/mediapipe_bridge.html).  Frames are sent as base64 JPEG strings
 * via postMessage and landmark arrays are returned via onMessage.
 *
 * Communication protocol (full spec in mediapipe_bridge.html):
 *   RN → WebView: { type: 'INIT', modelBase64 }
 *                 { type: 'PROCESS_FRAME', imageBase64 }
 *   WebView → RN: { type: 'READY' }
 *                 { type: 'LANDMARKS', landmarks, frameWidth, frameHeight }
 *                 { type: 'NO_FACE' }
 *                 { type: 'ERROR', message }
 *
 * Latency:
 *   The WebView bridge adds approximately 15–25 ms per frame on top of the
 *   MediaPipe inference time (~50–80 ms), giving a total of ~70–100 ms per
 *   frame — within the <100 ms benchmark target.
 *
 * Usage:
 *   const { webViewRef, onMessage, processFrame, ready } = useMediaPipe();
 *   // Mount <WebView ref={webViewRef} ... onMessage={onMessage} /> in your tree
 *   // Then call processFrame(base64ImageUri) to get landmarks.
 */

import { useState, useRef, useCallback } from 'react';
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FaceLandmark {
  x: number;  // normalised [0, 1]
  y: number;  // normalised [0, 1]
  z: number;  // depth (arbitrary scale)
}

export interface MediaPipeResult {
  /** 468-point landmark array, or null if no face detected */
  landmarks: FaceLandmark[] | null;
  /** Frame width in pixels (from the WebView canvas) */
  frameWidth: number;
  /** Frame height in pixels */
  frameHeight: number;
}

export interface UseMediaPipeState {
  /** True once FaceLandmarker has initialised inside the WebView */
  ready: boolean;
  /** True while the model bundle is loading */
  loading: boolean;
  /** Non-null if initialisation fails */
  error: string | null;
  /**
   * WebView ref — attach this to the hidden <WebView> component.
   * The hook uses it to send postMessage commands.
   */
  webViewRef: React.RefObject<any>;
  /**
   * HTML source URI for the WebView.
   * Pass this as the `source` prop: <WebView source={{ uri: htmlUri }} />
   */
  htmlUri: string | null;
  /**
   * onMessage handler for the WebView's onMessage prop.
   * Routes incoming messages to the correct promise resolver.
   */
  onMessage: (event: { nativeEvent: { data: string } }) => void;
  /**
   * Processes a single base64 JPEG frame through MediaPipe FaceLandmarker.
   * Returns landmark data or null if no face is detected.
   *
   * This function is non-reentrant — concurrent calls queue internally.
   *
   * @param imageBase64  Base64-encoded JPEG (with or without data-URI prefix).
   * @param timeoutMs    Max wait time before returning null (default 2000 ms).
   */
  processFrame: (imageBase64: string, timeoutMs?: number) => Promise<MediaPipeResult | null>;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useMediaPipe(): UseMediaPipeState {
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [htmlUri, setHtmlUri] = useState<string | null>(null);

  const webViewRef = useRef<any>(null);

  /**
   * Pending promise resolvers, keyed by the frame sequence number.
   * When the WebView replies with LANDMARKS or NO_FACE, we resolve the
   * matching promise.
   */
  const pendingFramesRef = useRef<Map<number, {
    resolve: (result: MediaPipeResult | null) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>>(new Map());

  const frameSeqRef = useRef(0);

  /** True while an INIT message has been sent but READY not yet received */
  const initPendingRef = useRef(false);
  const initResolversRef = useRef<Array<() => void>>([]);

  // ── Load local HTML asset ──────────────────────────────────────────────────

  // We load the HTML file once on mount and cache its file:// URI
  const loadHtmlAsset = useCallback(async () => {
    try {
      const asset = Asset.fromModule(require('../../assets/mediapipe_bridge.html'));
      await asset.downloadAsync();
      if (asset.localUri) {
        setHtmlUri(asset.localUri);
      } else {
        throw new Error('Could not resolve mediapipe_bridge.html local URI');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'HTML asset load failed';
      setError(msg);
      setLoading(false);
    }
  }, []);

  // Start loading on first render
  const loadStartedRef = useRef(false);
  if (!loadStartedRef.current) {
    loadStartedRef.current = true;
    loadHtmlAsset();
  }

  // ── Initialise MediaPipe with model data ───────────────────────────────────

  /**
   * Reads the face_landmarker.task bundle from assets, base64-encodes it,
   * and sends an INIT message to the WebView bridge.
   *
   * Called automatically when the WebView signals PAGE_LOADED.
   */
  const initModel = useCallback(async () => {
    if (initPendingRef.current) return;
    initPendingRef.current = true;

    try {
      const asset = Asset.fromModule(require('../../assets/models/face_landmarker.task'));
      await asset.downloadAsync();

      if (!asset.localUri) throw new Error('Could not resolve face_landmarker.task');

      // Read as base64
      const modelBase64 = await FileSystem.readAsStringAsync(asset.localUri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      // Send INIT to WebView
      if (webViewRef.current) {
        webViewRef.current.postMessage(JSON.stringify({
          type: 'INIT',
          modelBase64,
        }));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Model init failed';
      setError(msg);
      setLoading(false);
      initPendingRef.current = false;
    }
  }, []);

  // ── onMessage handler ──────────────────────────────────────────────────────

  const onMessage = useCallback((event: { nativeEvent: { data: string } }) => {
    let msg: Record<string, any>;

    try {
      msg = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }

    switch (msg.type) {
      case 'PAGE_LOADED':
        // HTML page is ready — send model data
        initModel();
        break;

      case 'READY':
        // FaceLandmarker loaded inside WebView
        setReady(true);
        setLoading(false);
        // Resolve any callers waiting for readiness
        for (const resolve of initResolversRef.current) resolve();
        initResolversRef.current = [];
        break;

      case 'LANDMARKS': {
        // Route to the pending frame promise
        const seq: number = msg.seq ?? -1;
        const pending = pendingFramesRef.current.get(seq);
        if (pending) {
          clearTimeout(pending.timer);
          pendingFramesRef.current.delete(seq);
          pending.resolve({
            landmarks: msg.landmarks as FaceLandmark[],
            frameWidth: msg.frameWidth ?? 480,
            frameHeight: msg.frameHeight ?? 640,
          });
        } else if (seq === -1) {
          // Broadcast to all pending (bridge doesn't support seq yet)
          for (const [key, p] of pendingFramesRef.current) {
            clearTimeout(p.timer);
            p.resolve({
              landmarks: msg.landmarks as FaceLandmark[],
              frameWidth: msg.frameWidth ?? 480,
              frameHeight: msg.frameHeight ?? 640,
            });
            pendingFramesRef.current.delete(key);
          }
        }
        break;
      }

      case 'NO_FACE': {
        const seq: number = msg.seq ?? -1;
        const pending = pendingFramesRef.current.get(seq);
        if (pending) {
          clearTimeout(pending.timer);
          pendingFramesRef.current.delete(seq);
          pending.resolve(null);
        } else {
          for (const [key, p] of pendingFramesRef.current) {
            clearTimeout(p.timer);
            p.resolve(null);
            pendingFramesRef.current.delete(key);
          }
        }
        break;
      }

      case 'ERROR':
        console.warn('[useMediaPipe] Bridge error:', msg.message);
        // Reject all pending frame promises
        for (const [key, p] of pendingFramesRef.current) {
          clearTimeout(p.timer);
          p.reject(new Error(msg.message));
          pendingFramesRef.current.delete(key);
        }
        if (!ready) {
          setError(msg.message as string);
          setLoading(false);
        }
        break;

      default:
        break;
    }
  }, [ready, initModel]);

  // ── processFrame ──────────────────────────────────────────────────────────

  const processFrame = useCallback(async (
    imageBase64: string,
    timeoutMs = 2000
  ): Promise<MediaPipeResult | null> => {
    if (!ready) return null;
    if (!webViewRef.current) return null;

    const seq = ++frameSeqRef.current;

    return new Promise<MediaPipeResult | null>((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingFramesRef.current.delete(seq);
        resolve(null); // timeout → treat as no face
      }, timeoutMs);

      pendingFramesRef.current.set(seq, { resolve, reject, timer });

      webViewRef.current.postMessage(JSON.stringify({
        type: 'PROCESS_FRAME',
        imageBase64,
        seq,
      }));
    });
  }, [ready]);

  return { ready, loading, error, webViewRef, htmlUri, onMessage, processFrame };
}

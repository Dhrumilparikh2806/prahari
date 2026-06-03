/**
 * useFaceRecognition.ts — TFLite MobileFaceNet Inference Hook
 *
 * Uses react-native-fast-tflite (mrousavy) which exposes a JSI-based TFLite
 * runtime.  The actual API:
 *
 *   const model = await loadTensorflowModel(require('../../assets/models/mobilefacenet_int8.tflite'))
 *   const [output] = await model.run([inputFloat32Array])
 *   // output is a Float32Array of 128 values
 *
 * Pipeline:
 *   imageUri
 *     → preprocessForMobileFaceNet()  (resize 112×112, normalise [-1,1])
 *     → model.run([tensor])           (TFLite INT8 inference)
 *     → l2Normalize(output[0])        (unit-norm embedding)
 *     → return Float32Array[128]
 */

import { useState, useEffect, useRef } from 'react';
import { preprocessForMobileFaceNet, l2Normalize, embeddingToArray } from '@utils/imageProcessing';
import { RECOGNITION } from '@config/constants';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface UseFaceRecognitionState {
  ready: boolean;
  loading: boolean;
  error: string | null;
  /** Returns a 128-dim L2-normalised Float32Array from a local image URI. */
  generateEmbedding: (imageUri: string) => Promise<Float32Array>;
  /** Convenience wrapper returning a plain number[]. */
  generateEmbeddingArray: (imageUri: string) => Promise<number[]>;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useFaceRecognition(): UseFaceRecognitionState {
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Holds the loaded TensorflowModel instance
  const modelRef = useRef<{ run: (inputs: Float32Array[]) => Promise<Float32Array[]> } | null>(null);

  // ── Load model on mount ────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        // react-native-fast-tflite installs a global __loadTensorflowModel via JSI.
        // We use require() so Metro bundles the .tflite file into the app.
        const { loadTensorflowModel } = await import('react-native-fast-tflite');

        const model = await loadTensorflowModel(
          // The asset is resolved by Metro at build time.
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          require('../../assets/models/mobilefacenet_int8.tflite')
        );

        if (!cancelled) {
          // Wrap the model in a simple adapter that matches our internal API
          modelRef.current = {
            run: async (inputs: Float32Array[]) => {
              const outputs = await model.run(inputs);
              // outputs is TypedArray[] — cast to Float32Array[]
              return outputs as Float32Array[];
            },
          };
          setReady(true);
        }
      } catch (err) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : 'Failed to load TFLite model';
          console.error('[useFaceRecognition] load error:', msg);
          setError(msg);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  // ── Inference ──────────────────────────────────────────────────────────────

  const generateEmbedding = async (imageUri: string): Promise<Float32Array> => {
    if (!ready || !modelRef.current) {
      throw new Error('[useFaceRecognition] Model not ready');
    }

    // Preprocess: resize to 112×112, normalise pixels to [-1, 1]
    const inputTensor = await preprocessForMobileFaceNet(imageUri);

    // Run inference — model.run() expects an array of typed arrays (one per input tensor)
    const outputs = await modelRef.current.run([inputTensor]);

    // MobileFaceNet has a single output tensor of shape [1, 128]
    const rawOutput = outputs[0];
    if (!rawOutput) {
      throw new Error('[useFaceRecognition] Model returned no output');
    }

    // Convert to plain number[] for l2Normalize
    const outputArr = Array.from(rawOutput);

    // Dequantize if output is INT8 (values outside [-1, 1])
    const maxAbs = Math.max(...outputArr.map(Math.abs));
    const floatArr = maxAbs > 1.5
      ? outputArr.map((v) => v / 128.0)   // INT8 → float
      : outputArr;

    return l2Normalize(floatArr);
  };

  const generateEmbeddingArray = async (imageUri: string): Promise<number[]> => {
    const emb = await generateEmbedding(imageUri);
    return embeddingToArray(emb);
  };

  return { ready, loading, error, generateEmbedding, generateEmbeddingArray };
}

/**
 * MediaPipeContext — Singleton WebView bridge shared across all screens.
 *
 * MediaPipe WASM takes 15–60s to download on first launch. By mounting the
 * WebView in the root layout (not per-screen), it initialises ONCE on app
 * start and stays alive across screen navigations.
 */

import React, { createContext, useContext } from 'react';
import type { UseMediaPipeState } from '@hooks/useMediaPipe';

const MediaPipeContext = createContext<UseMediaPipeState | null>(null);

export const MediaPipeProvider = MediaPipeContext.Provider;

export function useMediaPipeContext(): UseMediaPipeState {
  const ctx = useContext(MediaPipeContext);
  if (!ctx) throw new Error('useMediaPipeContext: must be inside MediaPipeProvider');
  return ctx;
}

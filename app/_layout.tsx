/**
 * _layout.tsx — Root Navigation Layout
 *
 * Responsibilities:
 *   1. Wrap app in GestureHandlerRootView (required by react-native-gesture-handler).
 *   2. Initialise SQLite database — shows error screen if it fails.
 *   3. Start network monitor for background S3 sync on reconnect.
 *   4. Render Stack navigator (dark theme).
 */

import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Stack } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';
import WebView from 'react-native-webview';
import { initDatabase } from '@database/schema';
import { startNetworkMonitor } from '@services/networkMonitor';
import { useMediaPipe } from '@hooks/useMediaPipe';
import { MediaPipeProvider } from '@context/MediaPipeContext';
import { UI } from '@config/constants';

export default function RootLayout() {
  const [dbReady, setDbReady] = useState(false);
  const [dbError, setDbError] = useState<string | null>(null);

  // MediaPipe lives here — persists across all screen navigations
  const mediaPipe = useMediaPipe();

  useEffect(() => {
    let stopMonitor: (() => void) | null = null;

    // initDatabase() is awaited fully — no silent swallow
    initDatabase()
      .then(() => {
        setDbReady(true);
        stopMonitor = startNetworkMonitor();
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[_layout] Database init error:', msg);
        setDbError(msg);
      });

    return () => {
      if (stopMonitor) stopMonitor();
    };
  }, []);

  // ── Error state ──────────────────────────────────────────────────────────────

  if (dbError) {
    return (
      <GestureHandlerRootView style={styles.errorContainer}>
        <Text style={styles.errorTitle}>Database Error</Text>
        <Text style={styles.errorMsg}>{dbError}</Text>
        <Text style={styles.errorHint}>
          Force-close the app and reopen. If this persists, clear app data in Settings.
        </Text>
        <TouchableOpacity
          style={styles.retryBtn}
          onPress={() => {
            setDbError(null);
            initDatabase()
              .then(() => setDbReady(true))
              .catch((e: unknown) => setDbError(e instanceof Error ? e.message : String(e)));
          }}
        >
          <Text style={styles.retryBtnText}>Retry</Text>
        </TouchableOpacity>
      </GestureHandlerRootView>
    );
  }

  // ── Loading state ────────────────────────────────────────────────────────────

  if (!dbReady) {
    return (
      <GestureHandlerRootView style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={UI.ACCENT_COLOR} />
        <Text style={styles.loadingText}>Initialising…</Text>
      </GestureHandlerRootView>
    );
  }

  // ── Main app ─────────────────────────────────────────────────────────────────

  return (
    <MediaPipeProvider value={mediaPipe}>
    <GestureHandlerRootView style={styles.root}>
      <StatusBar style="light" />
      {/* Hidden persistent WebView — loads MediaPipe WASM once on app start */}
      {mediaPipe.htmlUri ? (
        <WebView
          ref={mediaPipe.webViewRef}
          source={{ uri: mediaPipe.htmlUri }}
          style={styles.hiddenWebView}
          onMessage={mediaPipe.onMessage}
          javaScriptEnabled
          originWhitelist={['*']}
          allowFileAccess={true}
          allowFileAccessFromFileURLs={true}
          allowUniversalAccessFromFileURLs={true}
          mixedContentMode="always"
          cacheEnabled={true}
          cacheMode="LOAD_CACHE_ELSE_NETWORK"
        />
      ) : null}
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: UI.BACKGROUND_COLOR },
          animation: 'fade',
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="enroll" />
        <Stack.Screen name="verify" />
        <Stack.Screen name="dashboard" />
        <Stack.Screen name="benchmark" />
      </Stack>
    </GestureHandlerRootView>
    </MediaPipeProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: UI.BACKGROUND_COLOR },
  hiddenWebView: { width: 1, height: 1, opacity: 0, position: 'absolute' },
  loadingContainer: {
    flex: 1, backgroundColor: UI.BACKGROUND_COLOR,
    alignItems: 'center', justifyContent: 'center', gap: 16,
  },
  loadingText: { color: '#666', fontSize: 14 },
  errorContainer: {
    flex: 1, backgroundColor: '#0A0000',
    alignItems: 'center', justifyContent: 'center', padding: 32,
  },
  errorTitle: { color: '#FF4444', fontSize: 20, fontWeight: '700', marginBottom: 12 },
  errorMsg: { color: '#FF8888', fontSize: 14, textAlign: 'center', marginBottom: 12 },
  errorHint: { color: '#666', fontSize: 13, textAlign: 'center', marginBottom: 28 },
  retryBtn: {
    backgroundColor: UI.ACCENT_COLOR, borderRadius: 10,
    paddingHorizontal: 32, paddingVertical: 12,
  },
  retryBtnText: { color: '#000', fontSize: 16, fontWeight: '700' },
});

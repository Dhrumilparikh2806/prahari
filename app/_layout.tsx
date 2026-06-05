import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, StatusBar } from 'react-native';
import { Stack } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import WebView from 'react-native-webview';
import { initDatabase } from '@database/schema';
import { startNetworkMonitor } from '@services/networkMonitor';
import { useMediaPipe } from '@hooks/useMediaPipe';
import { MediaPipeProvider } from '@context/MediaPipeContext';
import { TERRA } from '@config/constants';

export default function RootLayout() {
  const [dbReady, setDbReady] = useState(false);
  const [dbError, setDbError] = useState<string | null>(null);
  const mediaPipe = useMediaPipe();

  useEffect(() => {
    let stopMonitor: (() => void) | null = null;
    initDatabase()
      .then(() => {
        setDbReady(true);
        stopMonitor = startNetworkMonitor();
      })
      .catch((err: unknown) => {
        setDbError(err instanceof Error ? err.message : String(err));
      });
    return () => { if (stopMonitor) stopMonitor(); };
  }, []);

  if (dbError) {
    return (
      <GestureHandlerRootView style={styles.errorContainer}>
        <Text style={styles.errorTitle}>Startup Error</Text>
        <Text style={styles.errorMsg}>{dbError}</Text>
        <TouchableOpacity style={styles.retryBtn}
          onPress={() => { setDbError(null); initDatabase().then(() => setDbReady(true)).catch((e: unknown) => setDbError(String(e))); }}>
          <Text style={styles.retryBtnText}>Retry</Text>
        </TouchableOpacity>
      </GestureHandlerRootView>
    );
  }

  if (!dbReady) {
    return (
      <GestureHandlerRootView style={styles.loadingContainer}>
        <StatusBar barStyle="dark-content" backgroundColor={TERRA.BACKGROUND} />
        <Text style={styles.loadingShield}>◈</Text>
        <Text style={styles.loadingName}>Prahari</Text>
        <ActivityIndicator size="large" color={TERRA.PRIMARY} style={{ marginTop: 32 }} />
        <Text style={styles.loadingText}>Loading…</Text>
      </GestureHandlerRootView>
    );
  }

  return (
    <MediaPipeProvider value={mediaPipe}>
      <GestureHandlerRootView style={styles.root}>
        <StatusBar barStyle="dark-content" backgroundColor={TERRA.BACKGROUND} />
        <WebView
          ref={mediaPipe.webViewRef}
          source={{ html: mediaPipe.htmlSource, baseUrl: 'https://cdn.jsdelivr.net' }}
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
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="enroll" options={{ headerShown: false, animation: 'slide_from_bottom', presentation: 'modal' }} />
        </Stack>
      </GestureHandlerRootView>
    </MediaPipeProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: TERRA.BACKGROUND },
  hiddenWebView: { width: 1, height: 1, opacity: 0, position: 'absolute' },
  loadingContainer: { flex: 1, backgroundColor: TERRA.BACKGROUND, alignItems: 'center', justifyContent: 'center' },
  loadingShield: { fontSize: 40, color: TERRA.PRIMARY },
  loadingName: { fontSize: 24, fontWeight: '700', color: TERRA.TEXT, letterSpacing: 4, fontFamily: 'Georgia' },
  loadingText: { marginTop: 16, fontSize: 13, color: TERRA.TEXT_MUTED },
  errorContainer: { flex: 1, backgroundColor: TERRA.BACKGROUND, alignItems: 'center', justifyContent: 'center', padding: 32 },
  errorTitle: { fontSize: 20, fontWeight: '700', color: TERRA.ERROR, marginBottom: 12 },
  errorMsg: { fontSize: 13, color: TERRA.TEXT_SECONDARY, textAlign: 'center', marginBottom: 28 },
  retryBtn: { backgroundColor: TERRA.PRIMARY, borderRadius: 10, paddingHorizontal: 32, paddingVertical: 12 },
  retryBtnText: { color: TERRA.WHITE, fontSize: 16, fontWeight: '700' },
});

/**
 * _layout.tsx — Root Navigation Layout
 *
 * Entry point for Expo Router.  Responsibilities:
 *   1. Wrap the entire app in GestureHandlerRootView (required by
 *      react-native-gesture-handler — must be the outermost wrapper).
 *   2. Initialise the SQLite database (schema.ts) on first mount.
 *   3. Start the network monitor that triggers S3 sync on reconnect.
 *   4. Render the Stack navigator with a dark theme.
 *
 * Screen order in Stack:
 *   index       → Landing / home
 *   enroll      → Face enrollment flow
 *   verify      → Identity verification flow
 *   dashboard   → Attendance log viewer
 *   benchmark   → Latency test screen
 */

import { useEffect, useState } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { Stack } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';
import { initDatabase } from '@database/schema';
import { startNetworkMonitor } from '@services/networkMonitor';
import { UI } from '@config/constants';

export default function RootLayout() {
  const [dbReady, setDbReady] = useState(false);

  useEffect(() => {
    let stopMonitor: (() => void) | null = null;

    async function bootstrap() {
      try {
        // Initialise SQLite tables (creates them on first run, runs migrations)
        await initDatabase();
      } catch (err) {
        // Non-fatal: the app can run without the DB for most interactions;
        // enrollment and verification will fail gracefully.
        console.error('[_layout] Database init error:', err);
      }

      setDbReady(true);

      // Start listening for network state changes to trigger background sync
      stopMonitor = startNetworkMonitor();
    }

    bootstrap();

    return () => {
      // Unsubscribe from network listener on unmount
      if (stopMonitor) stopMonitor();
    };
  }, []);

  // Show a full-screen loader while the database initialises (typically <200ms)
  if (!dbReady) {
    return (
      <GestureHandlerRootView style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={UI.ACCENT_COLOR} />
      </GestureHandlerRootView>
    );
  }

  return (
    <GestureHandlerRootView style={styles.root}>
      <StatusBar style="light" />
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
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: UI.BACKGROUND_COLOR,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: UI.BACKGROUND_COLOR,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

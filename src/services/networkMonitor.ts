/**
 * networkMonitor.ts — Network State Listener + Sync Trigger
 *
 * Listens for transitions from offline → online using @react-native-community/netinfo
 * and fires syncPendingLogs() on reconnect.  The sync is "fire and forget" —
 * the monitor does not await the result.
 *
 * Usage:
 *   // In app/_layout.tsx useEffect:
 *   const stop = startNetworkMonitor();
 *   return () => stop(); // cleanup on unmount
 *
 * Debounce:
 *   Mobile devices often flicker between states during handovers.  We debounce
 *   the online event by 3 seconds to avoid hammering the sync endpoint during
 *   brief signal restoration.
 */

import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import { syncPendingLogs } from '@services/syncService';

// ─── State ────────────────────────────────────────────────────────────────────

/** True when the device has confirmed internet connectivity */
let _isConnected = false;

/** Debounce timer handle */
let _debounceTimer: ReturnType<typeof setTimeout> | null = null;

/** Debounce delay before triggering a sync after going online (ms) */
const RECONNECT_DEBOUNCE_MS = 3000;

// ─── Listener ─────────────────────────────────────────────────────────────────

/**
 * Starts the network state listener.
 *
 * @returns An unsubscribe function — call it when the app unmounts or when you
 *          want to stop monitoring.
 */
export function startNetworkMonitor(): () => void {
  const unsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
    const nowConnected = !!(state.isConnected && state.isInternetReachable);

    if (nowConnected && !_isConnected) {
      // Transition: offline → online
      handleReconnect();
    }

    _isConnected = nowConnected;
  });

  return () => {
    // Cancel any pending debounce
    if (_debounceTimer) {
      clearTimeout(_debounceTimer);
      _debounceTimer = null;
    }
    unsubscribe();
  };
}

// ─── Reconnect handler ─────────────────────────────────────────────────────────

/**
 * Called when the device transitions from offline to online.
 * Debounces by RECONNECT_DEBOUNCE_MS before firing the sync to avoid
 * false-positive triggers during network handovers.
 */
function handleReconnect(): void {
  // Cancel any previously pending debounce
  if (_debounceTimer) {
    clearTimeout(_debounceTimer);
  }

  _debounceTimer = setTimeout(() => {
    _debounceTimer = null;
    triggerSync();
  }, RECONNECT_DEBOUNCE_MS);
}

/**
 * Fires the sync in the background.  Errors are caught and logged — the app
 * must remain functional even if sync fails.
 */
async function triggerSync(): Promise<void> {
  try {
    const result = await syncPendingLogs();
    if (result.synced > 0) {
      console.log(`[networkMonitor] Synced ${result.synced} attendance log(s) to S3`);
    }
    if (result.failed > 0) {
      console.warn(`[networkMonitor] ${result.failed} log(s) failed to sync — will retry on next reconnect`);
    }
  } catch (err) {
    // Sync errors must never crash the app
    console.error('[networkMonitor] Sync error:', err);
  }
}

/**
 * Returns the current network connectivity status.
 * Useful for the home screen offline badge.
 *
 * @returns True if the device currently has confirmed internet access.
 */
export function isCurrentlyConnected(): boolean {
  return _isConnected;
}

/**
 * Manually triggers a sync attempt.
 * Can be called from the dashboard's "Sync Now" button.
 */
export async function forceSyncNow(): Promise<{ synced: number; failed: number }> {
  return syncPendingLogs();
}

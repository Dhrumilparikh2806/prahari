/**
 * dashboard.tsx — Attendance Log Dashboard
 *
 * Displays recent attendance verification events in reverse chronological order.
 * Shows sync status for each entry and provides a manual "Sync Now" button.
 *
 * Columns shown per entry:
 *   • Personnel ID (truncated)
 *   • Verification timestamp
 *   • Confidence score
 *   • Detected BPM
 *   • Sync status badge (green = synced, orange = pending)
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { getRecentLogs, getPendingCount, AttendanceLog } from '@database/attendance';
import { forceSyncNow } from '@services/networkMonitor';
import { UI } from '@config/constants';

// ─── Log Row ──────────────────────────────────────────────────────────────────

const LogRow: React.FC<{ log: AttendanceLog }> = ({ log }) => {
  const date = new Date(log.timestamp);
  const timeStr = date.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const dateStr = date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

  return (
    <View style={styles.logRow}>
      {/* Left: personnel info */}
      <View style={styles.logLeft}>
        <Text style={styles.logPersonnel} numberOfLines={1}>
          {log.personnelId.slice(0, 16)}…
        </Text>
        <Text style={styles.logDateTime}>{dateStr} · {timeStr}</Text>
      </View>

      {/* Centre: metrics */}
      <View style={styles.logMetrics}>
        <Text style={styles.metricValue}>
          {log.confidence > 0 ? `${(log.confidence * 100).toFixed(0)}%` : '—'}
        </Text>
        <Text style={styles.metricLabel}>conf</Text>
      </View>
      <View style={styles.logMetrics}>
        <Text style={styles.metricValue}>
          {log.bpm > 0 ? `${log.bpm}` : '—'}
        </Text>
        <Text style={styles.metricLabel}>BPM</Text>
      </View>

      {/* Right: sync badge */}
      <View style={[
        styles.syncBadge,
        { backgroundColor: log.synced ? 'rgba(0,255,136,0.15)' : 'rgba(255,170,0,0.15)' },
      ]}>
        <Text style={[
          styles.syncBadgeText,
          { color: log.synced ? '#00FF88' : '#FFAA00' },
        ]}>
          {log.synced ? '✓' : '…'}
        </Text>
      </View>
    </View>
  );
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function DashboardScreen() {
  const router = useRouter();
  const [logs, setLogs] = useState<AttendanceLog[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [recentLogs, pending] = await Promise.all([
        getRecentLogs(100),
        getPendingCount(),
      ]);
      setLogs(recentLogs);
      setPendingCount(pending);
    } catch (err) {
      console.error('[dashboard] Load error:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Reload whenever the screen comes into focus (e.g., returning from verify)
  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      loadData();
    }, [loadData])
  );

  const handleRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  const handleSyncNow = async () => {
    setSyncing(true);
    try {
      const result = await forceSyncNow();
      if (result.synced > 0) {
        await loadData();
      }
    } finally {
      setSyncing(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Attendance Log</Text>
        {pendingCount > 0 ? (
          <TouchableOpacity style={styles.syncButton} onPress={handleSyncNow} disabled={syncing}>
            {syncing ? (
              <ActivityIndicator size="small" color="#000" />
            ) : (
              <Text style={styles.syncButtonText}>Sync {pendingCount}</Text>
            )}
          </TouchableOpacity>
        ) : (
          <View style={styles.allSyncedBadge}>
            <Text style={styles.allSyncedText}>✓ Synced</Text>
          </View>
        )}
      </View>

      {/* Stats row */}
      <View style={styles.statsRow}>
        <View style={styles.statCell}>
          <Text style={styles.statValue}>{logs.length}</Text>
          <Text style={styles.statLabel}>Total Records</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statCell}>
          <Text style={[styles.statValue, pendingCount > 0 && { color: '#FFAA00' }]}>
            {pendingCount}
          </Text>
          <Text style={styles.statLabel}>Pending Sync</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statCell}>
          <Text style={[styles.statValue, { color: UI.ACCENT_COLOR }]}>
            {logs.filter((l) => l.synced).length}
          </Text>
          <Text style={styles.statLabel}>Synced</Text>
        </View>
      </View>

      {/* Column headers */}
      <View style={styles.columnHeader}>
        <Text style={[styles.colLabel, { flex: 1.5 }]}>Personnel</Text>
        <Text style={styles.colLabel}>Conf</Text>
        <Text style={styles.colLabel}>BPM</Text>
        <Text style={styles.colLabel}>Sync</Text>
      </View>

      {/* Log list */}
      {loading ? (
        <ActivityIndicator style={styles.loader} color={UI.ACCENT_COLOR} size="large" />
      ) : (
        <FlatList
          data={logs}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <LogRow log={item} />}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={UI.ACCENT_COLOR}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>No attendance records yet.</Text>
              <Text style={styles.emptySubtext}>
                Complete a verification to create the first entry.
              </Text>
            </View>
          }
          contentContainerStyle={logs.length === 0 && styles.emptyList}
        />
      )}
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: UI.BACKGROUND_COLOR },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    gap: 12,
  },
  backText: { color: UI.ACCENT_COLOR, fontSize: 16 },
  headerTitle: { flex: 1, color: '#FFFFFF', fontSize: 18, fontWeight: '700' },
  syncButton: {
    backgroundColor: UI.ACCENT_COLOR,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 6,
    minWidth: 70,
    alignItems: 'center',
  },
  syncButtonText: { color: '#000000', fontSize: 13, fontWeight: '700' },
  allSyncedBadge: {
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: 'rgba(0,255,136,0.1)',
  },
  allSyncedText: { color: '#00FF88', fontSize: 12, fontWeight: '600' },
  statsRow: {
    flexDirection: 'row',
    marginHorizontal: 20,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  statCell: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 24, fontWeight: '700', color: '#FFFFFF' },
  statLabel: { fontSize: 11, color: '#666666', marginTop: 2 },
  statDivider: { width: 1, backgroundColor: 'rgba(255,255,255,0.1)' },
  columnHeader: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  colLabel: { color: '#555555', fontSize: 11, fontWeight: '600', width: 48, textAlign: 'center' },
  logRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.06)',
    gap: 8,
  },
  logLeft: { flex: 1.5 },
  logPersonnel: { color: '#FFFFFF', fontSize: 13, fontWeight: '500' },
  logDateTime: { color: '#555555', fontSize: 11, marginTop: 2 },
  logMetrics: { width: 48, alignItems: 'center' },
  metricValue: { color: '#FFFFFF', fontSize: 13, fontWeight: '600' },
  metricLabel: { color: '#555555', fontSize: 10 },
  syncBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  syncBadgeText: { fontSize: 14, fontWeight: '700' },
  loader: { marginTop: 60 },
  emptyContainer: { alignItems: 'center', paddingTop: 80, paddingHorizontal: 40 },
  emptyText: { color: '#555555', fontSize: 16, marginBottom: 8 },
  emptySubtext: { color: '#333333', fontSize: 13, textAlign: 'center' },
  emptyList: { flex: 1 },
});

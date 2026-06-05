import React, { useCallback, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  FlatList, ActivityIndicator, RefreshControl, StatusBar,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { getRecentLogs, getPendingCount, markSynced, purgeSyncedLogs, AttendanceLog } from '@database/attendance';
import { TERRA } from '@config/constants';

export default function DashboardScreen() {
  const topPad = StatusBar.currentHeight ?? 0;
  const [logs, setLogs] = useState<AttendanceLog[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useFocusEffect(useCallback(() => { loadData(); }, []));

  const loadData = async () => {
    try {
      const [recentLogs, pending] = await Promise.all([getRecentLogs(100), getPendingCount()]);
      setLogs(recentLogs);
      setPendingCount(pending);
    } catch {}
    finally { setLoading(false); setRefreshing(false); }
  };

  const handleRefresh = () => { setRefreshing(true); loadData(); };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const pending = logs.filter(l => !l.synced).map(l => l.id);
      if (pending.length > 0) { await markSynced(pending); await purgeSyncedLogs(); await loadData(); }
    } finally { setSyncing(false); }
  };

  const totalRecords = logs.length;
  const syncedCount = logs.filter(l => l.synced).length;

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>

      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.appName}>Prahari</Text>
          <Text style={styles.screenSub}>Attendance Logs</Text>
        </View>
        <TouchableOpacity
          style={[styles.syncBtn, syncing && styles.syncBtnDisabled]}
          onPress={handleSync}
          disabled={syncing}
        >
          {syncing ? (
            <ActivityIndicator size="small" color={TERRA.PRIMARY} />
          ) : (
            <Text style={styles.syncBtnText}>{pendingCount === 0 ? '✓ Synced' : `↻ Sync ${pendingCount}`}</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Stats row */}
      <View style={styles.statsRow}>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{totalRecords}</Text>
          <Text style={styles.statLabel}>Total</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Text style={[styles.statValue, pendingCount > 0 && styles.statAmber]}>{pendingCount}</Text>
          <Text style={styles.statLabel}>Pending</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Text style={[styles.statValue, { color: TERRA.PRIMARY }]}>{syncedCount}</Text>
          <Text style={styles.statLabel}>Synced</Text>
        </View>
      </View>

      {/* Table header */}
      <View style={styles.tableHeader}>
        <Text style={[styles.colLabel, { flex: 2 }]}>PERSONNEL</Text>
        <Text style={styles.colLabel}>CONF</Text>
        <Text style={styles.colLabel}>BPM</Text>
        <Text style={styles.colLabel}>SY</Text>
      </View>

      {/* Content */}
      {loading ? (
        <View style={styles.stateBox}>
          <ActivityIndicator color={TERRA.PRIMARY} size="large" />
          <Text style={styles.stateText}>Loading records…</Text>
        </View>
      ) : logs.length === 0 ? (
        <View style={styles.stateBox}>
          <View style={styles.stateIconBg}>
            <Text style={styles.stateIcon}>▦</Text>
          </View>
          <Text style={styles.stateTitle}>No Records Yet</Text>
          <Text style={styles.stateSub}>Complete a verification to create the first entry.</Text>
        </View>
      ) : (
        <FlatList
          data={logs}
          keyExtractor={l => l.id}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={TERRA.PRIMARY} />
          }
          renderItem={({ item }) => (
            <View style={styles.row}>
              <View style={{ flex: 2 }}>
                <Text style={styles.rowName} numberOfLines={1}>
                  {item.personnelId.slice(0, 14)}…
                </Text>
                <Text style={styles.rowTime}>
                  {new Date(item.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                </Text>
              </View>
              <Text style={styles.rowCell}>
                {item.confidence > 0 ? `${(item.confidence * 100).toFixed(0)}%` : '—'}
              </Text>
              <Text style={styles.rowCell}>{item.bpm > 0 ? item.bpm : '—'}</Text>
              <Text style={[styles.rowCell, { color: item.synced ? TERRA.PRIMARY : '#c4854a' }]}>
                {item.synced ? '✓' : '…'}
              </Text>
            </View>
          )}
        />
      )}

      {/* Footer */}
      <View style={styles.footer}>
        <View style={styles.footerDot} />
        <Text style={styles.footerText}>SYSTEM_ID: PRH-0882-QX · STORAGE: 4.2.0</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8f5f0' },

  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 12,
  },
  appName: { fontSize: 22, fontWeight: '700', color: '#1c2b26', letterSpacing: -0.3 },
  screenSub: { fontSize: 12, color: '#627068', marginTop: 2 },
  syncBtn: {
    paddingHorizontal: 14, paddingVertical: 7,
    borderRadius: 20, borderWidth: 1.5, borderColor: TERRA.PRIMARY,
    flexDirection: 'row', alignItems: 'center', gap: 6,
  },
  syncBtnDisabled: { opacity: 0.5 },
  syncBtnText: { fontSize: 12, fontWeight: '600', color: TERRA.PRIMARY },

  statsRow: {
    flexDirection: 'row',
    backgroundColor: '#ffffff',
    marginHorizontal: 20,
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
    borderWidth: 1,
    borderColor: '#e8e2d9',
  },
  statItem: { flex: 1, alignItems: 'center', gap: 3 },
  statValue: { fontSize: 26, fontWeight: '700', color: '#1c2b26', letterSpacing: -0.5 },
  statAmber: { color: '#c4854a' },
  statLabel: { fontSize: 11, color: '#9aaba4', fontWeight: '500' },
  statDivider: { width: 1, height: 28, backgroundColor: '#e8e2d9' },

  tableHeader: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderBottomWidth: 1.5,
    borderBottomColor: TERRA.PRIMARY,
    marginBottom: 2,
  },
  colLabel: { width: 48, fontSize: 10, fontWeight: '700', color: TERRA.PRIMARY, letterSpacing: 0.8 },

  stateBox: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  stateIconBg: {
    width: 64, height: 64, borderRadius: 18,
    backgroundColor: '#eef4f0', alignItems: 'center', justifyContent: 'center', marginBottom: 4,
  },
  stateIcon: { fontSize: 28, color: TERRA.PRIMARY },
  stateText: { fontSize: 14, color: '#627068' },
  stateTitle: { fontSize: 16, fontWeight: '600', color: '#1c2b26' },
  stateSub: { fontSize: 13, color: '#627068', textAlign: 'center', paddingHorizontal: 24 },

  listContent: { paddingHorizontal: 20 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#ede8e0',
  },
  rowName: { fontSize: 13, fontWeight: '600', color: '#1c2b26' },
  rowTime: { fontSize: 10, color: '#9aaba4', marginTop: 2 },
  rowCell: { width: 48, fontSize: 12, fontWeight: '600', color: '#627068' },

  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingVertical: 10,
  },
  footerDot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: '#c8ddd0' },
  footerText: { fontSize: 10, color: '#9aaba4', letterSpacing: 0.3 },
});

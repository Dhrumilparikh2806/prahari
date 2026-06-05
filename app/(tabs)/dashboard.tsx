/**
 * (tabs)/dashboard.tsx — Attendance Log · Terra Theme
 *
 * Layout: Header + 3 separate stat cards + tabbed table + fetching state
 */

import React, { useCallback, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  FlatList, ActivityIndicator, RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { getRecentLogs, getPendingCount, markSynced, purgeSyncedLogs, AttendanceLog } from '@database/attendance';
import { TERRA, FONTS } from '@config/constants';

export default function DashboardScreen() {
  const insets = useSafeAreaInsets();
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
    } catch { }
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
    <View style={[styles.safe, { paddingTop: insets.top }]}>

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.headerShield}>◈</Text>
          <Text style={styles.headerTitle}>Prahari</Text>
        </View>
        <TouchableOpacity style={styles.syncedBadge} onPress={handleSync} disabled={syncing}>
          {syncing ? <ActivityIndicator size="small" color={TERRA.PRIMARY} /> : (
            <Text style={styles.syncedText}>{pendingCount === 0 ? 'SYNCED' : `SYNC ${pendingCount}`}</Text>
          )}
        </TouchableOpacity>
        <TouchableOpacity style={styles.settingsBtn}>
          <Text style={styles.settingsIcon}>⚙</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.content}>
        {/* Title row */}
        <View style={styles.titleRow}>
          <View>
            <Text style={styles.repoLabel}>DATA REPOSITORY</Text>
            <Text style={styles.screenTitle}>ATTENDANCE{'\n'}LOG</Text>
          </View>
          <TouchableOpacity style={styles.refreshBtn} onPress={handleRefresh}>
            <Text style={styles.refreshIcon}>↻</Text>
            <Text style={styles.refreshLabel}>REFRESH{'\n'}LOGS</Text>
          </TouchableOpacity>
        </View>

        {/* 3 separate stat cards */}
        <View style={styles.statCard}>
          <Text style={styles.statCardLabel}>TOTAL RECORDS</Text>
          <Text style={styles.statCardValue}>{totalRecords}</Text>
          <Text style={styles.statCardUnit}>entries</Text>
        </View>

        <View style={styles.statCard}>
          <Text style={styles.statCardLabel}>PENDING SYNC</Text>
          <Text style={[styles.statCardValue, pendingCount > 0 && { color: TERRA.AMBER }]}>
            {pendingCount}
          </Text>
          <Text style={styles.statCardUnit}>waiting</Text>
        </View>

        <View style={styles.statCard}>
          <Text style={styles.statCardLabel}>SYNCED</Text>
          <Text style={[styles.statCardValue, { color: TERRA.PRIMARY }]}>{syncedCount}</Text>
          <Text style={styles.statCardUnit}>verified</Text>
        </View>

        {/* Column headers */}
        <View style={styles.tableHeader}>
          <Text style={[styles.colHeader, { flex: 2 }]}>PERSONNEL</Text>
          <Text style={styles.colHeader}>CONF</Text>
          <Text style={styles.colHeader}>BPM</Text>
          <Text style={styles.colHeader}>SY</Text>
        </View>

        {/* Content */}
        {loading ? (
          <View style={styles.fetchingBox}>
            <Text style={styles.fetchingIcon}>🗄</Text>
            <Text style={styles.fetchingTitle}>FETCHING LOG DATA…</Text>
            <Text style={styles.fetchingBody}>Reading protected local attendance records.</Text>
          </View>
        ) : logs.length === 0 ? (
          <View style={styles.fetchingBox}>
            <Text style={styles.fetchingIcon}>🗄</Text>
            <Text style={styles.fetchingTitle}>NO RECORDS YET</Text>
            <Text style={styles.fetchingBody}>Complete a verification to create the first entry.</Text>
          </View>
        ) : (
          <FlatList
            data={logs}
            keyExtractor={l => l.id}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={TERRA.PRIMARY} />}
            renderItem={({ item }) => (
              <View style={styles.tableRow}>
                <View style={{ flex: 2 }}>
                  <Text style={styles.rowName} numberOfLines={1}>{item.personnelId.slice(0, 12)}…</Text>
                  <Text style={styles.rowTime}>{new Date(item.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</Text>
                </View>
                <Text style={styles.rowCell}>{item.confidence > 0 ? `${(item.confidence * 100).toFixed(0)}%` : '—'}</Text>
                <Text style={styles.rowCell}>{item.bpm > 0 ? item.bpm : '—'}</Text>
                <Text style={[styles.rowCell, { color: item.synced ? TERRA.PRIMARY : TERRA.AMBER }]}>
                  {item.synced ? '✓' : '…'}
                </Text>
              </View>
            )}
          />
        )}

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>SYSTEM_ID: PRH-0882-QX</Text>
          <Text style={styles.footerText}>STORAGE_IDX: 4.2.0</Text>
        </View>
        <View style={styles.liveRow}>
          <View style={styles.liveDot} />
          <Text style={styles.liveText}>LIVE CONNECTION</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: TERRA.BACKGROUND },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12, gap: 8 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  headerShield: { fontSize: 20, color: TERRA.PRIMARY },
  headerTitle: { fontSize: 18, fontWeight: "700", color: TERRA.TEXT },
  syncedBadge: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: TERRA.PRIMARY },
  syncedText: { fontSize: 11, fontWeight: "700", color: TERRA.PRIMARY, letterSpacing: 0.5 },
  settingsBtn: { padding: 8 },
  settingsIcon: { fontSize: 20, color: TERRA.TEXT_SECONDARY },
  content: { flex: 1, paddingHorizontal: 20 },

  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 },
  repoLabel: { fontSize: 10, fontWeight: "700", color: TERRA.PRIMARY, letterSpacing: 2, marginBottom: 4 },
  screenTitle: { fontSize: 28, fontFamily: FONTS.HEADLINE, color: TERRA.TEXT, lineHeight: 32 },
  refreshBtn: { backgroundColor: TERRA.CARD, borderRadius: 12, padding: 12, alignItems: 'center', borderWidth: 1, borderColor: TERRA.BORDER },
  refreshIcon: { fontSize: 18, color: TERRA.PRIMARY, marginBottom: 2 },
  refreshLabel: { fontSize: 9, fontWeight: "700", color: TERRA.TEXT_SECONDARY, letterSpacing: 1, textAlign: 'center' },

  statCard: { backgroundColor: TERRA.CARD, borderRadius: 12, padding: 16, marginBottom: 10, borderWidth: 1, borderColor: TERRA.BORDER },
  statCardLabel: { fontSize: 10, fontWeight: "700", color: TERRA.TEXT_MUTED, letterSpacing: 1.5, marginBottom: 4 },
  statCardValue: { fontSize: 36, fontFamily: FONTS.HEADLINE, color: TERRA.TEXT, lineHeight: 40 },
  statCardUnit: { fontSize: 11, color: TERRA.TEXT_MUTED },

  tableHeader: { flexDirection: 'row', paddingVertical: 8, borderBottomWidth: 2, borderBottomColor: TERRA.PRIMARY, marginBottom: 4 },
  colHeader: { width: 48, fontSize: 10, fontWeight: "700", color: TERRA.PRIMARY, letterSpacing: 0.5 },

  tableRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: TERRA.DIVIDER },
  rowName: { fontSize: 13, fontWeight: "600", color: TERRA.TEXT },
  rowTime: { fontSize: 10, color: TERRA.TEXT_MUTED },
  rowCell: { width: 48, fontSize: 12, fontWeight: "600", color: TERRA.TEXT_SECONDARY },

  fetchingBox: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 40, backgroundColor: TERRA.CARD, borderRadius: 12, borderWidth: 1, borderColor: TERRA.BORDER, marginTop: 8 },
  fetchingIcon: { fontSize: 36, marginBottom: 12 },
  fetchingTitle: { fontSize: 14, fontWeight: "700", color: TERRA.TEXT, letterSpacing: 1, marginBottom: 8 },
  fetchingBody: { fontSize: 12, color: TERRA.TEXT_SECONDARY, textAlign: 'center', paddingHorizontal: 20 },

  footer: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 12 },
  footerText: { fontSize: 9, color: TERRA.TEXT_MUTED, letterSpacing: 0.5 },
  liveRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 8 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: TERRA.PRIMARY },
  liveText: { fontSize: 10, fontWeight: "700", color: TERRA.PRIMARY, letterSpacing: 1 },
});

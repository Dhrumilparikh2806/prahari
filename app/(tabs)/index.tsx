import React, { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  ScrollView, StatusBar,
} from 'react-native';
import { useRouter } from 'expo-router';
import { getPendingCount, getRecentLogs } from '@database/attendance';
import { TERRA } from '@config/constants';

export default function HomeScreen() {
  const router = useRouter();
  const topPad = StatusBar.currentHeight ?? 0;
  const [pendingCount, setPendingCount] = useState(0);
  const [totalRecords, setTotalRecords] = useState(0);

  useEffect(() => {
    (async () => {
      try {
        const [pending, logs] = await Promise.all([
          getPendingCount(),
          getRecentLogs(9999),
        ]);
        setPendingCount(pending);
        setTotalRecords(logs.length);
      } catch {}
    })();
  }, []);

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <View>
          <Text style={styles.appName}>Prahari</Text>
          <View style={styles.statusRow}>
            <View style={styles.statusDot} />
            <Text style={styles.statusText}>Operational</Text>
          </View>
        </View>
        <TouchableOpacity style={styles.settingsBtn}>
          <Text style={styles.settingsIcon}>⚙</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Hero ── */}
        <View style={styles.heroSection}>
          <Text style={styles.heroTitle}>Biometric{'\n'}Authentication</Text>
          <Text style={styles.heroSub}>NHAI Field Personnel · Offline Mode</Text>
        </View>

        {/* ── Actions ── */}
        <Text style={styles.sectionLabel}>QUICK ACTIONS</Text>

        <TouchableOpacity
          style={styles.primaryCard}
          onPress={() => router.push('/(tabs)/verify')}
          activeOpacity={0.88}
        >
          <View style={styles.primaryCardTop}>
            <View style={styles.cardIconBg}>
              <Text style={styles.cardIconText}>◎</Text>
            </View>
            <View style={styles.cardBadge}>
              <Text style={styles.cardBadgeText}>BIOMETRIC</Text>
            </View>
          </View>
          <Text style={styles.primaryCardTitle}>Verify Identity</Text>
          <Text style={styles.primaryCardSub}>Face detection + liveness check</Text>
          <Text style={styles.primaryCardArrow}>→</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.secondaryCard}
          onPress={() => router.push('/enroll')}
          activeOpacity={0.88}
        >
          <View style={styles.secondaryLeft}>
            <Text style={styles.secondaryIcon}>＋</Text>
          </View>
          <View style={styles.secondaryBody}>
            <Text style={styles.secondaryTitle}>Enroll Personnel</Text>
            <Text style={styles.secondarySub}>Onboard field staff securely</Text>
          </View>
          <Text style={styles.secondaryChevron}>›</Text>
        </TouchableOpacity>

        {/* ── Stats ── */}
        <Text style={styles.sectionLabel}>DATABASE</Text>

        <View style={styles.statsCard}>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{totalRecords}</Text>
            <Text style={styles.statLabel}>Records</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={[styles.statValue, pendingCount > 0 && styles.statAmber]}>
              {pendingCount}
            </Text>
            <Text style={styles.statLabel}>Pending</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <View style={styles.syncChip}>
              <Text style={styles.syncChipText}>{pendingCount === 0 ? '✓' : '↻'}</Text>
            </View>
            <Text style={styles.statLabel}>{pendingCount === 0 ? 'Synced' : 'Sync'}</Text>
          </View>
        </View>

        {/* ── Footer ── */}
        <View style={styles.footer}>
          <View style={styles.footerDot} />
          <Text style={styles.footerText}>Protocol v2.4 · Zero-network Mode Active</Text>
        </View>
      </ScrollView>
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
    paddingBottom: 4,
  },
  appName: { fontSize: 22, fontWeight: '700', color: '#1c2b26', letterSpacing: -0.3 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3 },
  statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: TERRA.PRIMARY },
  statusText: { fontSize: 12, color: TERRA.PRIMARY, fontWeight: '500' },
  settingsBtn: { padding: 8, marginTop: 4 },
  settingsIcon: { fontSize: 19, color: '#627068' },

  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 28 },

  heroSection: { paddingTop: 16, paddingBottom: 22 },
  heroTitle: {
    fontSize: 34,
    fontWeight: '700',
    color: '#1c2b26',
    letterSpacing: -0.8,
    lineHeight: 40,
  },
  heroSub: { fontSize: 13, color: '#627068', marginTop: 7, letterSpacing: 0.1 },

  sectionLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#9aaba4',
    letterSpacing: 1.2,
    marginBottom: 10,
  },

  primaryCard: {
    backgroundColor: TERRA.PRIMARY,
    borderRadius: 20,
    padding: 20,
    marginBottom: 10,
    shadowColor: TERRA.PRIMARY,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.28,
    shadowRadius: 14,
    elevation: 5,
  },
  primaryCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  cardIconBg: {
    width: 42,
    height: 42,
    borderRadius: 13,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardIconText: { fontSize: 20, color: '#fff' },
  cardBadge: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 7,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  cardBadgeText: { fontSize: 9, fontWeight: '700', color: '#fff', letterSpacing: 1.2 },
  primaryCardTitle: { fontSize: 21, fontWeight: '700', color: '#fff', letterSpacing: -0.3 },
  primaryCardSub: { fontSize: 13, color: 'rgba(255,255,255,0.68)', marginTop: 3 },
  primaryCardArrow: { fontSize: 20, color: 'rgba(255,255,255,0.7)', marginTop: 14, textAlign: 'right' },

  secondaryCard: {
    backgroundColor: '#ffffff',
    borderRadius: 18,
    padding: 16,
    marginBottom: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 1,
    borderWidth: 1,
    borderColor: '#e8e2d9',
  },
  secondaryLeft: {
    width: 44,
    height: 44,
    borderRadius: 13,
    backgroundColor: '#eef4f0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryIcon: { fontSize: 22, color: TERRA.PRIMARY, lineHeight: 26 },
  secondaryBody: { flex: 1 },
  secondaryTitle: { fontSize: 15, fontWeight: '600', color: '#1c2b26' },
  secondarySub: { fontSize: 12, color: '#627068', marginTop: 2 },
  secondaryChevron: { fontSize: 24, color: '#9aaba4' },

  statsCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 18,
    marginBottom: 18,
    flexDirection: 'row',
    alignItems: 'center',
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
  syncChip: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#eef4f0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  syncChipText: { fontSize: 13, color: TERRA.PRIMARY, fontWeight: '700' },

  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingTop: 4 },
  footerDot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: '#c8ddd0' },
  footerText: { fontSize: 11, color: '#9aaba4', letterSpacing: 0.2 },
});

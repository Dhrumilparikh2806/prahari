/**
 * (tabs)/index.tsx — PRAHARI Home Screen · Terra Theme
 * Fixed: content fills full screen, no empty top half
 */

import React, { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { getPendingCount, getRecentLogs } from '@database/attendance';
import { TERRA, FONTS } from '@config/constants';

export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
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
      } catch { }
    })();
  }, []);

  const lastSyncText = pendingCount === 0 ? 'Up to date' : `${pendingCount} pending`;

  return (
    <View style={[styles.safe, { paddingTop: insets.top }]}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Header ── */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={styles.headerShield}>◈</Text>
            <Text style={styles.headerTitle}>Prahari</Text>
          </View>
          <TouchableOpacity style={styles.settingsBtn}>
            <Text style={styles.settingsIcon}>⚙</Text>
          </TouchableOpacity>
        </View>

        {/* ── Logo + Wordmark ── */}
        <View style={styles.brandSection}>
          <View style={styles.logoBadge}>
            <Text style={styles.logoEye}>◉</Text>
            <Text style={styles.logoLabel}>TERRA</Text>
          </View>
          <Text style={styles.wordmark}>PRAHARI</Text>
          <Text style={styles.tagline}>OFFLINE BIOMETRIC AUTHENTICATION</Text>
          <Text style={styles.subTagline}>
            NHAI FIELD PERSONNEL · ZERO NETWORK REQUIRED
          </Text>
        </View>

        {/* ── Verify Identity Card ── */}
        <TouchableOpacity
          style={styles.primaryCard}
          onPress={() => router.push('/(tabs)/verify')}
          activeOpacity={0.88}
        >
          <View style={styles.cardIconRow}>
            <View style={styles.cardIconBg}><Text style={styles.cardIcon}>◎</Text></View>
            <View style={styles.cardCheckBg}><Text style={styles.cardCheck}>✓</Text></View>
          </View>
          <Text style={styles.primaryCardTitle}>VERIFY IDENTITY</Text>
          <Text style={styles.primaryCardSub}>Face and liveness matching</Text>
        </TouchableOpacity>

        {/* ── Enroll Card ── */}
        <TouchableOpacity
          style={styles.secondaryCard}
          onPress={() => router.push('/enroll')}
          activeOpacity={0.88}
        >
          <Text style={styles.secondaryCardIcon}>👤</Text>
          <Text style={styles.secondaryCardTitle}>ENROLL NEW PERSONNEL</Text>
          <Text style={styles.secondaryCardSub}>Onboard field staff securely</Text>
        </TouchableOpacity>

        {/* ── Stats Row ── */}
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>LOCAL DATABASE</Text>
            <Text style={styles.statValue}>
              {totalRecords >= 1000 ? `${(totalRecords/1000).toFixed(1)}K` : totalRecords.toString()}
            </Text>
            <Text style={styles.statUnit}>entries</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>LAST SYNC</Text>
            <View style={styles.syncRow}>
              <Text style={styles.syncIcon}>↻</Text>
              <Text style={styles.statValue}>{lastSyncText}</Text>
            </View>
            <Text style={styles.statUnit}>NHAI Regional HQ Server</Text>
          </View>
        </View>

        {/* ── Protocol Banner ── */}
        <View style={styles.protocolBanner}>
          <Text style={styles.protocolIcon}>◈</Text>
          <View style={styles.protocolText}>
            <Text style={styles.protocolTitle}>PROTOCOL V2.4 ACTIVE</Text>
            <Text style={styles.protocolBody}>
              Protecting local biometric records during tunnel and highway
              attendance checks with limited connectivity.
            </Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: TERRA.BACKGROUND },
  scroll: { flex: 1 },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 32,
  },

  header: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', paddingTop: 8, paddingBottom: 16,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerShield: { fontSize: 20, color: TERRA.PRIMARY },
  headerTitle: { fontSize: 18, fontWeight: '700', color: TERRA.TEXT },
  settingsBtn: { padding: 8 },
  settingsIcon: { fontSize: 20, color: TERRA.TEXT_SECONDARY },

  brandSection: { alignItems: 'center', paddingVertical: 16, marginBottom: 4 },
  logoBadge: {
    width: 76, height: 76, borderRadius: 14,
    backgroundColor: TERRA.PRIMARY_LIGHT,
    borderWidth: 2, borderColor: TERRA.PRIMARY,
    alignItems: 'center', justifyContent: 'center', marginBottom: 10,
  },
  logoEye: { fontSize: 26, color: TERRA.PRIMARY },
  logoLabel: { fontSize: 8, fontWeight: '700', color: TERRA.PRIMARY, letterSpacing: 2 },
  wordmark: { fontSize: 30, fontFamily: FONTS.HEADLINE, color: TERRA.TEXT, letterSpacing: 6, marginBottom: 4 },
  tagline: { fontSize: 10, fontWeight: '600', color: TERRA.TEXT_SECONDARY, letterSpacing: 1.5 },
  subTagline: { fontSize: 9, color: TERRA.TEXT_MUTED, letterSpacing: 1, marginTop: 4, textAlign: 'center' },

  primaryCard: {
    backgroundColor: TERRA.PRIMARY, borderRadius: 16, padding: 20, marginBottom: 10,
  },
  cardIconRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  cardIconBg: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  cardIcon: { fontSize: 16, color: TERRA.WHITE },
  cardCheckBg: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  cardCheck: { fontSize: 16, color: TERRA.WHITE },
  primaryCardTitle: { fontSize: 19, fontFamily: FONTS.HEADLINE, color: TERRA.WHITE, letterSpacing: 1, marginBottom: 3 },
  primaryCardSub: { fontSize: 13, color: 'rgba(255,255,255,0.75)' },

  secondaryCard: {
    backgroundColor: TERRA.CARD, borderRadius: 16, padding: 18, marginBottom: 14,
    borderWidth: 1, borderColor: TERRA.BORDER,
  },
  secondaryCardIcon: { fontSize: 18, marginBottom: 6, color: TERRA.TEXT_SECONDARY },
  secondaryCardTitle: { fontSize: 15, fontFamily: FONTS.HEADLINE, color: TERRA.TEXT, letterSpacing: 0.5, marginBottom: 3 },
  secondaryCardSub: { fontSize: 13, color: TERRA.TEXT_SECONDARY },

  statsRow: {
    flexDirection: 'row', backgroundColor: TERRA.CARD, borderRadius: 12,
    padding: 14, marginBottom: 10, borderWidth: 1, borderColor: TERRA.BORDER,
  },
  statCard: { flex: 1 },
  statDivider: { width: 1, backgroundColor: TERRA.BORDER, marginHorizontal: 14 },
  statLabel: { fontSize: 8, fontWeight: '700', color: TERRA.TEXT_MUTED, letterSpacing: 1.5, marginBottom: 4 },
  statValue: { fontSize: 20, fontFamily: FONTS.HEADLINE, color: TERRA.TEXT },
  statUnit: { fontSize: 9, color: TERRA.TEXT_MUTED, marginTop: 2 },
  syncRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  syncIcon: { fontSize: 12, color: TERRA.PRIMARY },

  protocolBanner: {
    flexDirection: 'row', gap: 10,
    backgroundColor: TERRA.CARD, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: TERRA.BORDER,
  },
  protocolIcon: { fontSize: 16, color: TERRA.PRIMARY, marginTop: 2 },
  protocolText: { flex: 1 },
  protocolTitle: { fontSize: 10, fontWeight: '700', color: TERRA.PRIMARY, letterSpacing: 1, marginBottom: 4 },
  protocolBody: { fontSize: 12, color: TERRA.TEXT_SECONDARY, lineHeight: 17 },
});

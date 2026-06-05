/**
 * index.tsx — PRAHARI Landing / Home Screen
 *
 * The first screen users see.  Provides:
 *   • PRAHARI branding (name + tagline)
 *   • "Verify Identity" primary CTA → /verify
 *   • "Enroll New Personnel" secondary CTA → /enroll
 *   • Offline status badge (green dot = no network needed, pulsing = syncing)
 *   • Count of unsynced attendance logs pending S3 upload
 *   • Navigation shortcut to /dashboard and /benchmark
 */

import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  SafeAreaView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { getPendingCount } from '@database/attendance';
import { UI } from '@config/constants';

// ─── Component ────────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const router = useRouter();
  const [pendingCount, setPendingCount] = useState(0);
  const [isSyncing] = useState(false); // Updated by networkMonitor via Zustand in production

  // Pulse animation for the offline badge dot
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    // Load pending sync count on mount and after returning from other screens
    loadPendingCount();

    // Pulsing animation for the status dot
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.5, duration: 800, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
      ])
    );
    if (isSyncing) pulse.start();
    return () => pulse.stop();
  }, [isSyncing]);

  const loadPendingCount = async () => {
    try {
      const count = await getPendingCount();
      setPendingCount(count);
    } catch {
      // Non-fatal — DB may not be initialised yet
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>

        {/* ── Header ── */}
        <View style={styles.header}>
          {/* Offline status badge */}
          <View style={styles.statusBadge}>
            <Animated.View
              style={[
                styles.statusDot,
                { transform: [{ scale: isSyncing ? pulseAnim : new Animated.Value(1) }] },
                { backgroundColor: isSyncing ? '#FFAA00' : UI.ACCENT_COLOR },
              ]}
            />
            <Text style={styles.statusLabel}>
              {isSyncing ? 'Syncing…' : 'Offline Ready'}
            </Text>
          </View>

          {/* Pending sync badge */}
          {pendingCount > 0 ? (
            <TouchableOpacity
              style={styles.pendingBadge}
              onPress={() => router.push('/dashboard')}
            >
              <Text style={styles.pendingBadgeText}>{pendingCount} pending sync</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {/* ── Branding ── */}
        <View style={styles.branding}>
          {/* Logo mark */}
          <View style={styles.logoMark}>
            <Text style={styles.logoMarkText}>P</Text>
          </View>

          <Text style={styles.appName}>PRAHARI</Text>
          <Text style={styles.tagline}>
            Offline Biometric Authentication
          </Text>
          <Text style={styles.subTagline}>
            NHAI Field Personnel · Zero Network Required
          </Text>
        </View>

        {/* ── Feature pills ── */}
        <View style={styles.pillsRow}>
          {['rPPG Heartbeat', 'Face AI', 'AES-256'].map((label) => (
            <View key={label} style={styles.pill}>
              <Text style={styles.pillText}>{label}</Text>
            </View>
          ))}
        </View>

        {/* ── Primary CTA ── */}
        <TouchableOpacity
          style={styles.primaryButton}
          onPress={() => router.push('/verify')}
          activeOpacity={0.85}
        >
          <Text style={styles.primaryButtonText}>Verify Identity</Text>
        </TouchableOpacity>

        {/* ── Secondary CTA ── */}
        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={() => router.push('/enroll')}
          activeOpacity={0.85}
        >
          <Text style={styles.secondaryButtonText}>Enroll New Personnel</Text>
        </TouchableOpacity>

        {/* ── Utility links ── */}
        <View style={styles.linksRow}>
          <TouchableOpacity onPress={() => router.push('/dashboard')}>
            <Text style={styles.linkText}>Attendance Log</Text>
          </TouchableOpacity>
          <Text style={styles.linkDivider}>·</Text>
          <TouchableOpacity onPress={() => router.push('/benchmark')}>
            <Text style={styles.linkText}>Benchmarks</Text>
          </TouchableOpacity>
        </View>

        {/* ── Footer ── */}
        <Text style={styles.footer}>NHAI Innovation Hackathon 7.0</Text>
      </View>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: UI.BACKGROUND_COLOR,
  },
  container: {
    flex: 1,
    paddingHorizontal: 28,
    paddingVertical: 24,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusLabel: {
    color: '#AAAAAA',
    fontSize: 12,
    fontWeight: '500',
  },
  pendingBadge: {
    backgroundColor: 'rgba(255,170,0,0.15)',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#FFAA0055',
  },
  pendingBadgeText: {
    color: '#FFAA00',
    fontSize: 11,
    fontWeight: '600',
  },
  branding: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 20,
    maxHeight: 400,  // prevents text from being centered in a 1900px void on large screens
  },
  logoMark: {
    width: 80,
    height: 80,
    borderRadius: 24,
    backgroundColor: UI.ACCENT_COLOR,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  logoMarkText: {
    fontSize: 40,
    fontWeight: '800',
    color: '#000000',
  },
  appName: {
    fontSize: 40,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 8,
    marginBottom: 8,
  },
  tagline: {
    fontSize: 16,
    color: UI.ACCENT_COLOR,
    fontWeight: '500',
    marginBottom: 6,
  },
  subTagline: {
    fontSize: 13,
    color: '#666666',
    textAlign: 'center',
  },
  pillsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 40,
    flexWrap: 'wrap',
  },
  pill: {
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 6,
    backgroundColor: 'rgba(0,198,174,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(0,198,174,0.3)',
  },
  pillText: {
    color: UI.ACCENT_COLOR,
    fontSize: 12,
    fontWeight: '600',
  },
  primaryButton: {
    backgroundColor: UI.ACCENT_COLOR,
    borderRadius: 14,
    paddingVertical: 18,
    alignItems: 'center',
    marginBottom: 12,
  },
  primaryButtonText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#000000',
    letterSpacing: 0.5,
  },
  secondaryButton: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 14,
    paddingVertical: 18,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    marginBottom: 24,
  },
  secondaryButtonText: {
    fontSize: 17,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  linksRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
    marginBottom: 24,
  },
  linkText: {
    color: '#666666',
    fontSize: 14,
    textDecorationLine: 'underline',
  },
  linkDivider: {
    color: '#444444',
  },
  footer: {
    textAlign: 'center',
    color: '#333333',
    fontSize: 11,
    letterSpacing: 1,
  },
});

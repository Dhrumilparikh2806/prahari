/**
 * (tabs)/_layout.tsx — Terra Bottom Tab Navigator
 *
 * Tabs: Home · Verify · Logs · Stats
 * Design: Terra theme — cream background, forest green active state
 */

import { Tabs } from 'expo-router';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { TERRA, FONTS } from '@config/constants';

// ─── Tab icon SVG-style shapes using Text ────────────────────────────────────

const ICONS: Record<string, { active: string; inactive: string }> = {
  index:     { active: '⌂',  inactive: '⌂'  },
  verify:    { active: '◎',  inactive: '◎'  },
  dashboard: { active: '▦',  inactive: '▦'  },
  benchmark: { active: '↗',  inactive: '↗'  },
};

const LABELS: Record<string, string> = {
  index:     'Home',
  verify:    'Verify',
  dashboard: 'Logs',
  benchmark: 'Stats',
};

// ─── Custom tab bar ───────────────────────────────────────────────────────────

function TerraTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  return (
    <View style={styles.tabBar}>
      {state.routes.map((route, index) => {
        const isFocused = state.index === index;
        const label = LABELS[route.name] ?? route.name;
        const icon = ICONS[route.name];

        const onPress = () => {
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!isFocused && !event.defaultPrevented) navigation.navigate(route.name);
        };

        return (
          <TouchableOpacity
            key={route.key}
            style={styles.tabItem}
            onPress={onPress}
            activeOpacity={0.7}
          >
            <View style={[styles.iconWrap, isFocused && styles.iconWrapActive]}>
              <Text style={[styles.iconText, isFocused && styles.iconTextActive]}>
                {icon?.active ?? '●'}
              </Text>
            </View>
            <Text style={[styles.tabLabel, isFocused && styles.tabLabelActive]}>
              {label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// ─── Layout ───────────────────────────────────────────────────────────────────

export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <TerraTabBar {...props} />}
      screenOptions={{ headerShown: false }}
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="verify" />
      <Tabs.Screen name="dashboard" />
      <Tabs.Screen name="benchmark" />
    </Tabs>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  tabBar: {
    flexDirection: 'row',
    backgroundColor: TERRA.BACKGROUND,
    borderTopWidth: 1,
    borderTopColor: TERRA.BORDER,
    paddingBottom: 20,
    paddingTop: 10,
    paddingHorizontal: 8,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  iconWrap: {
    width: 40,
    height: 32,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrapActive: {
    backgroundColor: TERRA.PRIMARY,
  },
  iconText: {
    fontSize: 18,
    color: TERRA.TEXT_SECONDARY,
  },
  iconTextActive: {
    color: TERRA.WHITE,
  },
  tabLabel: {
    fontSize: 11,
    fontFamily: FONTS.BODY,
    color: TERRA.TEXT_SECONDARY,
  },
  tabLabelActive: {
    color: TERRA.PRIMARY,
    fontFamily: FONTS.BODY_MEDIUM,
  },
});

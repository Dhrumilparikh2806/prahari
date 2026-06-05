import { Tabs } from 'expo-router';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { TERRA } from '@config/constants';

const ICONS: Record<string, string> = {
  index:     '⌂',
  verify:    '◎',
  dashboard: '≡',
  benchmark: '↗',
};

const LABELS: Record<string, string> = {
  index:     'Home',
  verify:    'Verify',
  dashboard: 'Logs',
  benchmark: 'Stats',
};

function MinimalTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.tabBar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      {state.routes.map((route, index) => {
        const isFocused = state.index === index;
        const label = LABELS[route.name] ?? route.name;
        const icon = ICONS[route.name] ?? '●';

        const onPress = () => {
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!isFocused && !event.defaultPrevented) navigation.navigate(route.name);
        };

        return (
          <TouchableOpacity key={route.key} style={styles.tabItem} onPress={onPress} activeOpacity={0.6}>
            <Text style={[styles.tabIcon, isFocused && styles.tabIconActive]}>{icon}</Text>
            <Text style={[styles.tabLabel, isFocused && styles.tabLabelActive]}>{label}</Text>
            {isFocused && <View style={styles.activeBar} />}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <MinimalTabBar {...props} />}
      screenOptions={{ headerShown: false }}
    >
      <Tabs.Screen name="index"     options={{ headerShown: false }} />
      <Tabs.Screen name="verify"    options={{ headerShown: false }} />
      <Tabs.Screen name="dashboard" options={{ headerShown: false }} />
      <Tabs.Screen name="benchmark" options={{ headerShown: false }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#e8e2d9',
    paddingTop: 6,
    paddingHorizontal: 4,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 4,
    gap: 2,
    position: 'relative',
  },
  tabIcon: {
    fontSize: 20,
    color: '#9aaba4',
  },
  tabIconActive: {
    color: TERRA.PRIMARY,
  },
  tabLabel: {
    fontSize: 10,
    fontWeight: '500',
    color: '#9aaba4',
    letterSpacing: 0.2,
  },
  tabLabelActive: {
    color: TERRA.PRIMARY,
    fontWeight: '600',
  },
  activeBar: {
    position: 'absolute',
    top: -6,
    width: 20,
    height: 2,
    borderRadius: 1,
    backgroundColor: TERRA.PRIMARY,
  },
});

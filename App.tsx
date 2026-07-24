// App.tsx
// Platform split is invisible here: './core/StoreProvider' resolves to
// StoreProvider.native.tsx on iOS/Android and StoreProvider.web.tsx on web.
//
// Navigation: each tab now has its own Stack, supporting drill-down -
// Dashboard: DashboardHome -> StockDetail -> StockInBucket
// Buckets:   BucketsHome -> BucketDetail -> StockInBucket
// Settings:  SettingsHome -> About / Contact / TermsOfUse / PrivacyPolicy / BucketStrategyInfo
// StockInBucketScreen (and BucketStrategyInfoScreen) are shared, registered
// in more than one stack, since they're reachable from more than one path.
//
// Theming: ThemeProvider (./core/ThemeContext) sits inside StoreProvider
// (it persists the appearance choice via useStore()) and wraps everything
// else, so navTheme/stackScreenOptions/tab bar colors below are all
// computed from the live theme rather than the static light palette.

import React, { useCallback, useMemo, useState } from 'react';
import { View, ActivityIndicator, Pressable, useWindowDimensions, Platform, Appearance } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer, DefaultTheme, useNavigationContainerRef } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useFonts, Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from '@expo-google-fonts/inter';
import { JetBrainsMono_500Medium, JetBrainsMono_600SemiBold, JetBrainsMono_700Bold } from '@expo-google-fonts/jetbrains-mono';

import { StoreProvider } from './core/StoreProvider';
import { ThemeProvider, useTheme } from './core/ThemeContext';
import { AuthProvider } from './core/AuthProvider';
import { AlertHost } from './core/alert';
import { lightColors, darkColors, fonts, layout, ThemeColors } from './core/theme';
import SidebarNav, { SidebarItem } from './screens/components/SidebarNav';
import DashboardScreen from './screens/DashboardScreen';
import BucketsScreen from './screens/BucketsScreen';
import ImportScreen from './screens/ImportScreen';
import SettingsScreen from './screens/SettingsScreen';
import AccountScreen from './screens/AccountScreen';
import BucketDetailScreen from './screens/BucketDetailScreen';
import StockDetailScreen from './screens/StockDetailScreen';
import StockInBucketScreen from './screens/StockInBucketScreen';
import SearchStockScreen from './screens/SearchStockScreen';
import EditBucketScreen from './screens/EditBucketScreen';
import BucketStrategyInfoScreen from './screens/BucketStrategyInfoScreen';
import AboutScreen from './screens/AboutScreen';
import ContactScreen from './screens/ContactScreen';
import TermsOfUseScreen from './screens/TermsOfUseScreen';
import PrivacyPolicyScreen from './screens/PrivacyPolicyScreen';
import MonthlyDividendIncomeScreen from './screens/MonthlyDividendIncomeScreen';
import WatchListScreen from './screens/WatchListScreen';
import { DashboardStackParamList, BucketsStackParamList, SettingsStackParamList, WatchListStackParamList } from './core/navigationTypes';

// Bottom tabs (phone/narrow web) vs. left sidebar (wide web) both draw from
// this one list so the two nav UIs can never drift out of sync.
const TAB_ITEMS: SidebarItem[] = [
  { key: 'Dashboard', label: 'Dashboard', icon: 'grid-outline' },
  { key: 'Buckets', label: 'Buckets', icon: 'file-tray-stacked-outline' },
  { key: 'WatchList', label: 'Watch List', icon: 'eye-outline' },
  { key: 'Import', label: 'Import', icon: 'cloud-upload-outline' },
  { key: 'Settings', label: 'Settings', icon: 'settings-outline' },
];

const Tab = createBottomTabNavigator();
const DashboardStack = createNativeStackNavigator<DashboardStackParamList>();
const BucketsStack = createNativeStackNavigator<BucketsStackParamList>();
const WatchListStack = createNativeStackNavigator<WatchListStackParamList>();
const SettingsStack = createNativeStackNavigator<SettingsStackParamList>();

function DashboardStackNavigator({ stackScreenOptions, colors }: { stackScreenOptions: object; colors: ThemeColors }) {
  return (
    <DashboardStack.Navigator screenOptions={stackScreenOptions}>
      <DashboardStack.Screen
        name="DashboardHome"
        component={DashboardScreen}
        options={({ navigation }) => ({
          title: 'Dashboard',
          headerRight: () => (
            <Pressable onPress={() => navigation.navigate('SearchStock')} hitSlop={10} style={{ marginRight: 4 }}>
              <Ionicons name="search-outline" size={22} color={colors.onSurface} />
            </Pressable>
          ),
        })}
      />
      <DashboardStack.Screen
        name="StockDetail"
        component={StockDetailScreen}
        options={({ route }: any) => ({ title: route.params?.ticker ?? 'Stock' })}
      />
      <DashboardStack.Screen
        name="StockInBucket"
        component={StockInBucketScreen}
        options={({ route }: any) => ({ title: `${route.params?.ticker} · ${route.params?.bucket}` })}
      />
      <DashboardStack.Screen
        name="SearchStock"
        component={SearchStockScreen}
        options={{ title: 'Search Stocks' }}
      />
      <DashboardStack.Screen
        name="MonthlyDividendIncome"
        component={MonthlyDividendIncomeScreen}
        options={({ route }: any) => ({ title: route.params?.bucket ? `Dividends · ${route.params.bucket}` : 'Monthly Dividend Income' })}
      />
    </DashboardStack.Navigator>
  );
}

function BucketsStackNavigator({ stackScreenOptions }: { stackScreenOptions: object }) {
  return (
    <BucketsStack.Navigator screenOptions={stackScreenOptions}>
      <BucketsStack.Screen name="BucketsHome" component={BucketsScreen} options={{ title: 'Buckets' }} />
      <BucketsStack.Screen
        name="BucketDetail"
        component={BucketDetailScreen}
        options={({ route }: any) => ({ title: route.params?.bucket ?? 'Bucket' })}
      />
      <BucketsStack.Screen
        name="StockDetail"
        component={StockDetailScreen}
        options={({ route }: any) => ({ title: route.params?.ticker ?? 'Stock' })}
      />
      <BucketsStack.Screen
        name="StockInBucket"
        component={StockInBucketScreen}
        options={({ route }: any) => ({ title: `${route.params?.ticker} · ${route.params?.bucket}` })}
      />
      <BucketsStack.Screen
        name="EditBucket"
        component={EditBucketScreen}
        options={{ title: 'Edit Bucket' }}
      />
      <BucketsStack.Screen
        name="BucketStrategyInfo"
        component={BucketStrategyInfoScreen}
        options={{ title: 'Why Multiple Buckets?' }}
      />
      <BucketsStack.Screen
        name="MonthlyDividendIncome"
        component={MonthlyDividendIncomeScreen}
        options={({ route }: any) => ({ title: route.params?.bucket ? `Dividends · ${route.params.bucket}` : 'Monthly Dividend Income' })}
      />
    </BucketsStack.Navigator>
  );
}

function WatchListStackNavigator({ stackScreenOptions, colors }: { stackScreenOptions: object; colors: ThemeColors }) {
  return (
    <WatchListStack.Navigator screenOptions={stackScreenOptions}>
      <WatchListStack.Screen
        name="WatchListHome"
        component={WatchListScreen}
        options={({ navigation }) => ({
          title: 'Watch List',
          headerRight: () => (
            <Pressable onPress={() => navigation.navigate('SearchStock')} hitSlop={10} style={{ marginRight: 4 }}>
              <Ionicons name="search-outline" size={22} color={colors.onSurface} />
            </Pressable>
          ),
        })}
      />
      <WatchListStack.Screen
        name="StockDetail"
        component={StockDetailScreen}
        options={({ route }: any) => ({ title: route.params?.ticker ?? 'Stock' })}
      />
      <WatchListStack.Screen
        name="StockInBucket"
        component={StockInBucketScreen}
        options={({ route }: any) => ({ title: `${route.params?.ticker} · ${route.params?.bucket}` })}
      />
      <WatchListStack.Screen
        name="SearchStock"
        component={SearchStockScreen}
        options={{ title: 'Search Stocks' }}
      />
    </WatchListStack.Navigator>
  );
}

function SettingsStackNavigator({ stackScreenOptions }: { stackScreenOptions: object }) {
  return (
    <SettingsStack.Navigator screenOptions={stackScreenOptions}>
      <SettingsStack.Screen name="SettingsHome" component={SettingsScreen} options={{ title: 'Settings' }} />
      <SettingsStack.Screen name="Account" component={AccountScreen} options={{ title: 'Account' }} />
      <SettingsStack.Screen name="BucketStrategyInfo" component={BucketStrategyInfoScreen} options={{ title: 'Bucket Strategy' }} />
      <SettingsStack.Screen name="About" component={AboutScreen} options={{ title: 'About' }} />
      <SettingsStack.Screen name="Contact" component={ContactScreen} options={{ title: 'Contact' }} />
      <SettingsStack.Screen name="TermsOfUse" component={TermsOfUseScreen} options={{ title: 'Terms of Use' }} />
      <SettingsStack.Screen name="PrivacyPolicy" component={PrivacyPolicyScreen} options={{ title: 'Privacy Policy' }} />
    </SettingsStack.Navigator>
  );
}

function AppShell() {
  const { colors, isDark } = useTheme();
  const { width } = useWindowDimensions();
  const isWideWeb = Platform.OS === 'web' && width >= layout.wideBreakpoint;
  const navigationRef = useNavigationContainerRef();
  const [activeRoute, setActiveRoute] = useState('Dashboard');

  // The sidebar lives outside the Tab.Navigator tree (beside it, not inside
  // it), so it has no useNavigation()/useRoute() of its own - drive it off
  // the container ref instead. getRootState() (rather than
  // getCurrentRoute()) on purpose: that always gives the top-level tab even
  // when several screens deep in a stack, e.g. Dashboard > StockDetail
  // should still highlight "Dashboard", not "StockDetail".
  const syncActiveRoute = useCallback(() => {
    const state = navigationRef.getRootState();
    const topRoute = state?.routes[state.index];
    if (topRoute) setActiveRoute(topRoute.name);
  }, [navigationRef]);

  const handleSidebarNavigate = useCallback((key: string) => {
    if (navigationRef.isReady()) {
      navigationRef.navigate(key as never);
    }
  }, [navigationRef]);

  const navTheme = useMemo(() => ({
    ...DefaultTheme,
    dark: isDark,
    colors: {
      ...DefaultTheme.colors,
      background: colors.background,
      card: colors.surface,
      text: colors.onSurface,
      border: colors.outlineVariant,
      primary: colors.primary,
    },
  }), [colors, isDark]);

  const stackScreenOptions = useMemo(() => ({
    headerStyle: { backgroundColor: colors.surface },
    headerTintColor: colors.onSurface,
    headerTitleStyle: { fontFamily: fonts.bodySemiBold },
    headerShadowVisible: false,
  }), [colors]);

  return (
    <NavigationContainer
      ref={navigationRef}
      theme={navTheme}
      onReady={syncActiveRoute}
      onStateChange={syncActiveRoute}
    >
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <View style={{ flex: 1, flexDirection: isWideWeb ? 'row' : 'column', backgroundColor: colors.background }}>
        {isWideWeb && (
          <SidebarNav items={TAB_ITEMS} activeKey={activeRoute} onNavigate={handleSidebarNavigate} />
        )}
        <View style={{ flex: 1 }}>
          <Tab.Navigator
            screenOptions={({ route }) => ({
              headerShown: false,
              // The sidebar replaces this entirely on wide web rather than
              // running side-by-side with it - two nav UIs driving the same
              // state would be redundant chrome, not "more responsive".
              tabBarStyle: isWideWeb
                ? { display: 'none' }
                : { backgroundColor: colors.surface, borderTopColor: colors.outlineVariant },
              tabBarActiveTintColor: colors.primary,
              tabBarInactiveTintColor: colors.onSurfaceVariant,
              tabBarLabelStyle: { fontFamily: fonts.bodyMedium, fontSize: 11 },
              tabBarIcon: ({ color, size }) => {
                const icon = TAB_ITEMS.find((t) => t.key === route.name)?.icon ?? 'ellipse-outline';
                return <Ionicons name={icon} size={size} color={color} />;
              },
            })}
          >
            <Tab.Screen name="Dashboard">
              {() => <DashboardStackNavigator stackScreenOptions={stackScreenOptions} colors={colors} />}
            </Tab.Screen>
            <Tab.Screen name="Buckets">
              {() => <BucketsStackNavigator stackScreenOptions={stackScreenOptions} />}
            </Tab.Screen>
            <Tab.Screen name="WatchList">
              {() => <WatchListStackNavigator stackScreenOptions={stackScreenOptions} colors={colors} />}
            </Tab.Screen>
            <Tab.Screen name="Import" component={ImportScreen} />
            <Tab.Screen name="Settings">
              {() => <SettingsStackNavigator stackScreenOptions={stackScreenOptions} />}
            </Tab.Screen>
          </Tab.Navigator>
        </View>
      </View>
      <AlertHost />
    </NavigationContainer>
  );
}

export default function App() {
  const [fontsLoaded] = useFonts({
    Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold,
    JetBrainsMono_500Medium, JetBrainsMono_600SemiBold, JetBrainsMono_700Bold,
  });

  if (!fontsLoaded) {
    // Too early for ThemeProvider (it lives inside StoreProvider below) -
    // just match the OS scheme directly for this one splash frame so it
    // doesn't flash light before settling into a saved dark preference.
    const splash = Appearance.getColorScheme() === 'dark' ? darkColors : lightColors;
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: splash.background }}>
        <ActivityIndicator color={splash.primary} />
      </View>
    );
  }

  return (
    <StoreProvider>
      <ThemeProvider>
        <AuthProvider>
          <AppShell />
        </AuthProvider>
      </ThemeProvider>
    </StoreProvider>
  );
}

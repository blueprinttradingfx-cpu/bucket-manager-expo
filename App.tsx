// App.tsx
// Platform split is invisible here: './core/StoreProvider' resolves to
// StoreProvider.native.tsx on iOS/Android and StoreProvider.web.tsx on web.
//
// Navigation: each tab now has its own Stack, supporting drill-down -
// Dashboard: DashboardHome -> StockDetail -> StockInBucket
// Buckets:   BucketsHome -> BucketDetail -> StockInBucket
// StockInBucketScreen is shared, registered in both stacks, since it's
// reachable from either drill-down path.

import React from 'react';
import { View, ActivityIndicator, Pressable } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useFonts, Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from '@expo-google-fonts/inter';
import { JetBrainsMono_500Medium, JetBrainsMono_600SemiBold, JetBrainsMono_700Bold } from '@expo-google-fonts/jetbrains-mono';

import { StoreProvider } from './core/StoreProvider';
import { AlertHost } from './core/alert';
import { colors, fonts } from './core/theme';
import DashboardScreen from './screens/DashboardScreen';
import BucketsScreen from './screens/BucketsScreen';
import ImportScreen from './screens/ImportScreen';
import BucketDetailScreen from './screens/BucketDetailScreen';
import StockDetailScreen from './screens/StockDetailScreen';
import StockInBucketScreen from './screens/StockInBucketScreen';
import SearchStockScreen from './screens/SearchStockScreen';
import EditBucketScreen from './screens/EditBucketScreen';
import { DashboardStackParamList, BucketsStackParamList } from './core/navigationTypes';

const Tab = createBottomTabNavigator();
const DashboardStack = createNativeStackNavigator<DashboardStackParamList>();
const BucketsStack = createNativeStackNavigator<BucketsStackParamList>();

const navTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: colors.background,
    card: colors.surface,
    text: colors.onSurface,
    border: colors.outlineVariant,
    primary: colors.primary,
  },
};

const stackScreenOptions = {
  headerStyle: { backgroundColor: colors.surface },
  headerTintColor: colors.onSurface,
  headerTitleStyle: { fontFamily: fonts.bodySemiBold },
  headerShadowVisible: false,
};

function DashboardStackNavigator() {
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
    </DashboardStack.Navigator>
  );
}

function BucketsStackNavigator() {
  return (
    <BucketsStack.Navigator screenOptions={stackScreenOptions}>
      <BucketsStack.Screen name="BucketsHome" component={BucketsScreen} options={{ title: 'Buckets' }} />
      <BucketsStack.Screen
        name="BucketDetail"
        component={BucketDetailScreen}
        options={({ route }: any) => ({ title: route.params?.bucket ?? 'Bucket' })}
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
    </BucketsStack.Navigator>
  );
}

export default function App() {
  const [fontsLoaded] = useFonts({
    Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold,
    JetBrainsMono_500Medium, JetBrainsMono_600SemiBold, JetBrainsMono_700Bold,
  });

  if (!fontsLoaded) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <StoreProvider>
      <NavigationContainer theme={navTheme}>
        <StatusBar style="dark" />
        <Tab.Navigator
          screenOptions={({ route }) => ({
            headerShown: false,
            tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.outlineVariant },
            tabBarActiveTintColor: colors.primary,
            tabBarInactiveTintColor: colors.onSurfaceVariant,
            tabBarLabelStyle: { fontFamily: fonts.bodyMedium, fontSize: 11 },
            tabBarIcon: ({ color, size }) => {
              const icons: Record<string, keyof typeof Ionicons.glyphMap> = {
                Dashboard: 'grid-outline',
                Buckets: 'file-tray-stacked-outline',
                Import: 'cloud-upload-outline',
              };
              return <Ionicons name={icons[route.name]} size={size} color={color} />;
            },
          })}
        >
          <Tab.Screen name="Dashboard" component={DashboardStackNavigator} />
          <Tab.Screen name="Buckets" component={BucketsStackNavigator} />
          <Tab.Screen name="Import" component={ImportScreen} />
        </Tab.Navigator>
        <AlertHost />
      </NavigationContainer>
    </StoreProvider>
  );
}

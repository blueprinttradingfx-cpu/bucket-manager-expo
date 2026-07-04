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
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';

import { StoreProvider } from './core/StoreProvider';
import DashboardScreen from './screens/DashboardScreen';
import BucketsScreen from './screens/BucketsScreen';
import ImportScreen from './screens/ImportScreen';
import BucketDetailScreen from './screens/BucketDetailScreen';
import StockDetailScreen from './screens/StockDetailScreen';
import StockInBucketScreen from './screens/StockInBucketScreen';
import { DashboardStackParamList, BucketsStackParamList } from './core/navigationTypes';

const Tab = createBottomTabNavigator();
const DashboardStack = createNativeStackNavigator<DashboardStackParamList>();
const BucketsStack = createNativeStackNavigator<BucketsStackParamList>();

const stackScreenOptions = {
  headerStyle: { backgroundColor: '#0f172a' },
  headerTintColor: '#f1f5f9',
  headerShadowVisible: false,
};

function DashboardStackNavigator() {
  return (
    <DashboardStack.Navigator screenOptions={stackScreenOptions}>
      <DashboardStack.Screen name="DashboardHome" component={DashboardScreen} options={{ title: 'Dashboard' }} />
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
    </BucketsStack.Navigator>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <NavigationContainer>
        <StatusBar style="light" />
        <Tab.Navigator
          screenOptions={({ route }) => ({
            headerShown: false,
            tabBarStyle: { backgroundColor: '#0f172a', borderTopColor: '#1e293b' },
            tabBarActiveTintColor: '#38bdf8',
            tabBarInactiveTintColor: '#64748b',
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
      </NavigationContainer>
    </StoreProvider>
  );
}

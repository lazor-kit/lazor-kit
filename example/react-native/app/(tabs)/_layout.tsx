import { Ionicons } from '@expo/vector-icons';
// import { useLazorWallet } from 'sdk';
import { Tabs } from 'expo-router';

function TabBarIcon(props: {
  name: React.ComponentProps<typeof Ionicons>['name'];
  color: string;
}) {
  return <Ionicons size={24} style={{ marginBottom: -3 }} {...props} />;
}

export default function TabLayout() {
  // const { pubkey } = useLazorWallet();

  // // If not connected, redirect to index
  // if (!pubkey) {
  //   return <Redirect href="/" />;
  // }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#6366f1',
        tabBarInactiveTintColor: '#64748b',
        tabBarStyle: {
          backgroundColor: '#fff',
          borderTopWidth: 1,
          borderTopColor: '#e5e7eb',
          paddingBottom: 8,
          paddingTop: 8,
          height: 88,
        },
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '500',
        },
      }}
    >
      <Tabs.Screen
        name='index'
        options={{
          title: 'Home',
          tabBarIcon: ({ color }) => <TabBarIcon name='home' color={color} />,
        }}
      />
      <Tabs.Screen
        name='portfolio'
        options={{
          title: 'Portfolio',
          tabBarIcon: ({ color }) => (
            <TabBarIcon name='pie-chart' color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name='transfer'
        options={{
          title: 'Transfer',
          tabBarIcon: ({ color }) => (
            <TabBarIcon name='swap-horizontal' color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name='settings'
        options={{
          title: 'Settings',
          tabBarIcon: ({ color }) => (
            <TabBarIcon name='settings' color={color} />
          ),
        }}
      />
    </Tabs>
  );
}

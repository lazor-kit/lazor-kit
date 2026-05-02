"use client"

import { useState } from "react"
import { View, Text, StyleSheet, TouchableOpacity, Switch, ScrollView, SafeAreaView, Alert } from "react-native"
import { Ionicons } from "@expo/vector-icons"

export default function SettingsScreen() {
  const [notifications, setNotifications] = useState(true)
  const [biometric, setBiometric] = useState(false)
  const [darkMode, setDarkMode] = useState(false)

  const handleBackup = () => {
    Alert.alert("Backup Wallet", "Backup functionality would be implemented here")
  }

  const handleSecurity = () => {
    Alert.alert("Security Settings", "Security settings would be implemented here")
  }

  const handleSupport = () => {
    Alert.alert("Support", "Support functionality would be implemented here")
  }

  const handleAbout = () => {
    Alert.alert("About", "Lazor Wallet v1.0.0\nYour Gateway to Solana")
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <Text style={styles.title}>Settings</Text>
          <Text style={styles.subtitle}>Customize your wallet experience</Text>
        </View>

        {/* Preferences Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Preferences</Text>

          <View style={styles.settingItem}>
            <View style={styles.settingInfo}>
              <Ionicons name="notifications-outline" size={24} color="#6366f1" />
              <View style={styles.settingText}>
                <Text style={styles.settingTitle}>Push Notifications</Text>
                <Text style={styles.settingDescription}>Receive transaction alerts</Text>
              </View>
            </View>
            <Switch
              value={notifications}
              onValueChange={setNotifications}
              trackColor={{ false: "#d1d5db", true: "#6366f1" }}
            />
          </View>

          <View style={styles.settingItem}>
            <View style={styles.settingInfo}>
              <Ionicons name="finger-print-outline" size={24} color="#6366f1" />
              <View style={styles.settingText}>
                <Text style={styles.settingTitle}>Biometric Authentication</Text>
                <Text style={styles.settingDescription}>Use fingerprint or Face ID</Text>
              </View>
            </View>
            <Switch value={biometric} onValueChange={setBiometric} trackColor={{ false: "#d1d5db", true: "#6366f1" }} />
          </View>

          <View style={styles.settingItem}>
            <View style={styles.settingInfo}>
              <Ionicons name="moon-outline" size={24} color="#6366f1" />
              <View style={styles.settingText}>
                <Text style={styles.settingTitle}>Dark Mode</Text>
                <Text style={styles.settingDescription}>Switch to dark theme</Text>
              </View>
            </View>
            <Switch value={darkMode} onValueChange={setDarkMode} trackColor={{ false: "#d1d5db", true: "#6366f1" }} />
          </View>
        </View>

        {/* Security Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Security</Text>

          <TouchableOpacity style={styles.settingItem} onPress={handleBackup}>
            <View style={styles.settingInfo}>
              <Ionicons name="cloud-upload-outline" size={24} color="#6366f1" />
              <View style={styles.settingText}>
                <Text style={styles.settingTitle}>Backup Wallet</Text>
                <Text style={styles.settingDescription}>Save your recovery phrase</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward-outline" size={20} color="#64748b" />
          </TouchableOpacity>

          <TouchableOpacity style={styles.settingItem} onPress={handleSecurity}>
            <View style={styles.settingInfo}>
              <Ionicons name="shield-checkmark-outline" size={24} color="#6366f1" />
              <View style={styles.settingText}>
                <Text style={styles.settingTitle}>Security Settings</Text>
                <Text style={styles.settingDescription}>Manage your security options</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward-outline" size={20} color="#64748b" />
          </TouchableOpacity>
        </View>

        {/* Support Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Support</Text>

          <TouchableOpacity style={styles.settingItem} onPress={handleSupport}>
            <View style={styles.settingInfo}>
              <Ionicons name="help-circle-outline" size={24} color="#6366f1" />
              <View style={styles.settingText}>
                <Text style={styles.settingTitle}>Help & Support</Text>
                <Text style={styles.settingDescription}>Get help with your wallet</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward-outline" size={20} color="#64748b" />
          </TouchableOpacity>

          <TouchableOpacity style={styles.settingItem} onPress={handleAbout}>
            <View style={styles.settingInfo}>
              <Ionicons name="information-circle-outline" size={24} color="#6366f1" />
              <View style={styles.settingText}>
                <Text style={styles.settingTitle}>About</Text>
                <Text style={styles.settingDescription}>App version and info</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward-outline" size={20} color="#64748b" />
          </TouchableOpacity>
        </View>

        {/* Network Status */}
        <View style={styles.networkCard}>
          <View style={styles.networkHeader}>
            <Ionicons name="globe-outline" size={20} color="#10b981" />
            <Text style={styles.networkTitle}>Network Status</Text>
          </View>
          <Text style={styles.networkStatus}>Connected to Solana Mainnet</Text>
          <View style={styles.networkStats}>
            <View style={styles.statItem}>
              <Text style={styles.statLabel}>Block Height</Text>
              <Text style={styles.statValue}>245,678,901</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statLabel}>TPS</Text>
              <Text style={styles.statValue}>2,847</Text>
            </View>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f8fafc",
  },
  scrollContent: {
    padding: 16,
  },
  header: {
    marginBottom: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#1e293b",
  },
  subtitle: {
    fontSize: 16,
    color: "#64748b",
    marginTop: 4,
  },
  section: {
    backgroundColor: "#fff",
    borderRadius: 12,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#374151",
    padding: 16,
    paddingBottom: 8,
  },
  settingItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#f1f5f9",
  },
  settingInfo: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  settingText: {
    marginLeft: 12,
    flex: 1,
  },
  settingTitle: {
    fontSize: 16,
    fontWeight: "500",
    color: "#1e293b",
  },
  settingDescription: {
    fontSize: 14,
    color: "#64748b",
    marginTop: 2,
  },
  networkCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  networkHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  networkTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1e293b",
    marginLeft: 8,
  },
  networkStatus: {
    fontSize: 14,
    color: "#10b981",
    marginBottom: 16,
  },
  networkStats: {
    flexDirection: "row",
    justifyContent: "space-around",
  },
  statItem: {
    alignItems: "center",
  },
  statLabel: {
    fontSize: 12,
    color: "#64748b",
    marginBottom: 4,
  },
  statValue: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1e293b",
  },
})

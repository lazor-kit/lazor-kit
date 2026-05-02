import { View, Text, StyleSheet, ScrollView, SafeAreaView } from "react-native"
import { Ionicons } from "@expo/vector-icons"

export default function PortfolioScreen() {
  const portfolioData = [
    { token: "SOL", amount: 12.5847, value: 1238.45, change: "+5.2%", positive: true },
    { token: "USDC", amount: 250.0, value: 250.0, change: "0.0%", positive: true },
    { token: "RAY", amount: 45.32, value: 89.64, change: "-2.1%", positive: false },
  ]

  const totalValue = portfolioData.reduce((sum, item) => sum + item.value, 0)

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <Text style={styles.title}>Portfolio Overview</Text>
          <Text style={styles.subtitle}>Track your crypto investments</Text>
        </View>

        <View style={styles.totalCard}>
          <Text style={styles.totalLabel}>Total Portfolio Value</Text>
          <Text style={styles.totalValue}>${totalValue.toFixed(2)}</Text>
          <View style={styles.changeContainer}>
            <Ionicons name="trending-up-outline" size={16} color="#10b981" />
            <Text style={styles.changeText}>+3.4% (24h)</Text>
          </View>
        </View>

        <View style={styles.portfolioCard}>
          <Text style={styles.portfolioTitle}>Holdings</Text>
          {portfolioData.map((item, index) => (
            <View key={index} style={styles.portfolioItem}>
              <View style={styles.tokenInfo}>
                <View style={styles.tokenIcon}>
                  <Text style={styles.tokenSymbol}>{item.token}</Text>
                </View>
                <View>
                  <Text style={styles.tokenName}>{item.token}</Text>
                  <Text style={styles.tokenAmount}>{item.amount}</Text>
                </View>
              </View>
              <View style={styles.valueInfo}>
                <Text style={styles.tokenValue}>${item.value.toFixed(2)}</Text>
                <Text style={[styles.tokenChange, { color: item.positive ? "#10b981" : "#ef4444" }]}>
                  {item.change}
                </Text>
              </View>
            </View>
          ))}
        </View>

        <View style={styles.chartCard}>
          <Text style={styles.chartTitle}>Price Chart</Text>
          <View style={styles.chartPlaceholder}>
            <Ionicons name="analytics-outline" size={48} color="#64748b" />
            <Text style={styles.chartText}>Chart visualization would go here</Text>
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
  totalCard: {
    backgroundColor: "#6366f1",
    borderRadius: 16,
    padding: 24,
    alignItems: "center",
    marginBottom: 16,
  },
  totalLabel: {
    color: "#e0e7ff",
    fontSize: 16,
    marginBottom: 8,
  },
  totalValue: {
    color: "#fff",
    fontSize: 32,
    fontWeight: "bold",
    marginBottom: 8,
  },
  changeContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  changeText: {
    color: "#10b981",
    fontSize: 16,
    fontWeight: "500",
  },
  portfolioCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  portfolioTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#1e293b",
    marginBottom: 16,
  },
  portfolioItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f1f5f9",
  },
  tokenInfo: {
    flexDirection: "row",
    alignItems: "center",
  },
  tokenIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#6366f1",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  tokenSymbol: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "bold",
  },
  tokenName: {
    fontSize: 16,
    fontWeight: "500",
    color: "#1e293b",
  },
  tokenAmount: {
    fontSize: 14,
    color: "#64748b",
  },
  valueInfo: {
    alignItems: "flex-end",
  },
  tokenValue: {
    fontSize: 16,
    fontWeight: "500",
    color: "#1e293b",
  },
  tokenChange: {
    fontSize: 14,
    fontWeight: "500",
  },
  chartCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  chartTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#1e293b",
    marginBottom: 16,
  },
  chartPlaceholder: {
    height: 200,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f8fafc",
    borderRadius: 8,
  },
  chartText: {
    fontSize: 16,
    color: "#64748b",
    marginTop: 8,
  },
})

import { View, Text, TextInput, StyleSheet } from "react-native"

interface ThresholdInputProps {
  value: number
  onChange: (value: number) => void
  membersCount: number
  error?: string
}

export default function ThresholdInput({ value, onChange, membersCount, error }: ThresholdInputProps) {
  const handleChange = (text: string) => {
    const numValue = Number.parseInt(text, 10)
    if (!isNaN(numValue) && numValue >= 0) {
      onChange(numValue)
    } else if (text === "") {
      onChange(0)
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.label}>Threshold *</Text>
      <TextInput
        style={[styles.input, error && styles.inputError]}
        value={value.toString()}
        onChangeText={handleChange}
        placeholder="2"
        placeholderTextColor="#9CA3AF"
        keyboardType="numeric"
        accessibilityLabel="Threshold input"
      />
      <Text style={styles.helperText}>Must be ≤ members count ({membersCount})</Text>
      {error && <Text style={styles.errorText}>{error}</Text>}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 20,
  },
  label: {
    fontSize: 16,
    fontWeight: "600",
    color: "#374151",
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: "#D1D5DB",
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    backgroundColor: "#FFFFFF",
    color: "#111827",
  },
  inputError: {
    borderColor: "#EF4444",
  },
  helperText: {
    color: "#6B7280",
    fontSize: 14,
    marginTop: 4,
  },
  errorText: {
    color: "#EF4444",
    fontSize: 14,
    marginTop: 4,
  },
})

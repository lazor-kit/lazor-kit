import {
  View,
  TextInput,
  TouchableOpacity,
  Text,
  StyleSheet,
} from 'react-native';

interface MemberRowProps {
  value: string;
  onChange: (value: string) => void;
  onRemove: () => void;
  error?: string;
  canRemove: boolean;
  placeholder: string;
}

export default function MemberRow({
  value,
  onChange,
  onRemove,
  error,
  canRemove,
  placeholder,
}: MemberRowProps) {
  return (
    <View style={styles.container}>
      <View style={styles.inputContainer}>
        <TextInput
          style={[styles.input, error && styles.inputError]}
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor='#9CA3AF'
          accessibilityLabel={placeholder}
          autoCapitalize='none'
          autoCorrect={false}
        />
        {canRemove && (
          <TouchableOpacity
            style={styles.removeButton}
            onPress={onRemove}
            accessibilityLabel='Remove member'
            accessibilityRole='button'
          >
            <Text style={styles.removeButtonText}>×</Text>
          </TouchableOpacity>
        )}
      </View>
      {error && <Text style={styles.errorText}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 12,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    backgroundColor: '#FFFFFF',
    color: '#111827',
    fontFamily: 'monospace',
  },
  inputError: {
    borderColor: '#EF4444',
  },
  removeButton: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeButtonText: {
    color: '#EF4444',
    fontSize: 20,
    fontWeight: '600',
  },
  errorText: {
    color: '#EF4444',
    fontSize: 12,
    marginTop: 4,
    marginLeft: 4,
  },
});

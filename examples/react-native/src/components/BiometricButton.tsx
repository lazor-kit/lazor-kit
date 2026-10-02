import React from 'react';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';
import { useBiometric } from '../hooks/useBiometric';

interface BiometricButtonProps {
  onAuthenticate: () => void;
  label?: string;
}

export const BiometricButton: React.FC<BiometricButtonProps> = ({
  onAuthenticate,
  label,
}) => {
  const { isAvailable, biometricType, authenticate } = useBiometric();

  if (!isAvailable) {
    return null;
  }

  const handlePress = async () => {
    const success = await authenticate();
    if (success) {
      onAuthenticate();
    }
  };

  const getIcon = () => {
    switch (biometricType) {
      case 'FaceID':
        return '🔐';
      case 'TouchID':
        return '👆';
      default:
        return '🔓';
    }
  };

  return (
    <TouchableOpacity style={styles.button} onPress={handlePress}>
      <Text style={styles.icon}>{getIcon()}</Text>
      <Text style={styles.text}>
        {label || `Login with ${biometricType}`}
      </Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#007AFF',
    padding: 15,
    borderRadius: 10,
  },
  icon: {
    fontSize: 24,
    marginRight: 10,
  },
  text: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
});

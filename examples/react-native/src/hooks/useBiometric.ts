import { useState, useEffect } from 'react';
import * as LocalAuthentication from 'expo-local-authentication';

export const useBiometric = () => {
  const [isAvailable, setIsAvailable] = useState(false);
  const [biometricType, setBiometricType] = useState<string>('');

  useEffect(() => {
    checkBiometricAvailability();
  }, []);

  const checkBiometricAvailability = async () => {
    try {
      const compatible = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      setIsAvailable(compatible && enrolled);

      const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
      if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
        setBiometricType('FaceID');
      } else if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
        setBiometricType('TouchID');
      } else {
        setBiometricType('Biometric');
      }
    } catch (error) {
      console.error('Failed to check biometric availability:', error);
      setIsAvailable(false);
    }
  };

  const authenticate = async (): Promise<boolean> => {
    if (!isAvailable) {
      return false;
    }

    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Authenticate to continue',
        fallbackLabel: 'Use Passcode',
        cancelLabel: 'Cancel',
        disableDeviceFallback: false,
      });

      return result.success;
    } catch (error) {
      console.error('Biometric auth failed:', error);
      return false;
    }
  };

  return {
    isAvailable,
    biometricType,
    authenticate,
  };
};

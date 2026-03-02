# 生物识别认证教程

学习如何在 React Native 应用中集成 FaceID/TouchID 生物识别。

---

## 为什么使用生物识别？

- 🚀 **快速登录**：无需输入密码
- 🔒 **更安全**：基于硬件的安全芯片
- 😊 **更好的 UX**：一键验证

---

## 第一步：安装依赖

```bash
npx expo install expo-local-authentication
```

---

## 第二步：创建生物识别 Hook

创建 `src/hooks/useBiometric.ts`：

```typescript
import { useState, useEffect } from 'react';
import * as LocalAuthentication from 'expo-local-authentication';

export const useBiometric = () => {
  const [isAvailable, setIsAvailable] = useState(false);
  const [biometricType, setBiometricType] = useState<string>('');

  useEffect(() => {
    checkBiometricAvailability();
  }, []);

  const checkBiometricAvailability = async () => {
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
```

---

## 第三步：创建生物识别按钮

创建 `src/components/BiometricButton.tsx`：

```typescript
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
    marginVertical: 10,
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
```

---

## 第四步：集成到登录界面

更新 `src/screens/LoginScreen.tsx`：

```typescript
import React, { useState } from 'react';
import { View, Button, Text, Alert } from 'react-native';
import { useLazorkit } from '../providers/LazorkitProvider';
import { BiometricButton } from '../components/BiometricButton';

export const LoginScreen: React.FC = () => {
  const { connect, isConnected, publicKey } = useLazorkit();
  const [loading, setLoading] = useState(false);

  const handlePasskeyLogin = async () => {
    setLoading(true);
    try {
      await connect();
      Alert.alert('Success', 'Logged in with Passkey!');
    } catch (error) {
      Alert.alert('Error', 'Failed to login');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handleBiometricLogin = async () => {
    // Biometric auth already succeeded, now connect
    setLoading(true);
    try {
      await connect();
      Alert.alert('Success', 'Welcome back!');
    } catch (error) {
      Alert.alert('Error', 'Failed to login');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  if (isConnected) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Welcome!</Text>
        <Text style={styles.address}>
          {publicKey?.slice(0, 8)}...{publicKey?.slice(-8)}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Lazorkit Mobile</Text>
      
      {/* Biometric Login (if available) */}
      <BiometricButton 
        onAuthenticate={handleBiometricLogin}
        label="Quick Login"
      />
      
      {/* Passkey Login (fallback) */}
      <Button
        title={loading ? 'Connecting...' : 'Login with Passkey'}
        onPress={handlePasskeyLogin}
        disabled={loading}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  title: {
    fontSize: 24,
    marginBottom: 20,
    fontWeight: 'bold',
  },
  address: {
    fontSize: 16,
    fontFamily: 'monospace',
    marginTop: 10,
  },
});
```

---

## 配置权限

### iOS (ios/YourApp/Info.plist)

```xml
<key>NSFaceIDUsageDescription</key>
<string>We use Face ID for secure login</string>
```

### Android (app.json)

```json
{
  "expo": {
    "android": {
      "permissions": ["USE_BIOMETRIC", "USE_FINGERPRINT"]
    }
  }
}
```

---

## 工作流程

```
1. 用户打开 App
2. 检测生物识别可用性
3. 显示"Quick Login"按钮
4. 用户点击按钮
5. 系统弹出 FaceID/TouchID 验证
6. 验证成功 → 自动连接钱包
```

---

## 安全最佳实践

✅ **永远不要存储私钥**：使用 Passkey 派生
✅ **生物识别只是第一步**：结合 Passkey 双重验证
✅ **设置超时**：一段时间后要求重新验证
✅ **提供 fallback**：允许使用 Passkey 登录

---

## 测试

1. 在真机上运行（模拟器不支持生物识别）
2. 点击"Quick Login"按钮
3. 执行 FaceID/TouchID
4. 成功后自动登录

---

## 下一步

- 查看 [完整代码](https://github.com/yourusername/lazorkit-mobile)
- 阅读 [Lazorkit 文档](https://docs.lazorkit.com/)
- 加入 [Telegram 社区](https://t.me/lazorkit)

---

**教程作者**: Dead Lobster (死龍蝦)
**最后更新**: 2026-03-02

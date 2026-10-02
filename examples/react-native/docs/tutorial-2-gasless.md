# Gasless 交易教程

学习如何在 Lazorkit 中实现无 Gas 费用的 Solana 交易。

---

## 概念

传统 Solana 交易需要支付 GAS（SOL）。Lazorkit 通过**智能钱包**和**Paymaster**机制，让用户无需持有 SOL 也能发送交易。

---

## 第一步：创建转账组件

创建 `src/components/GaslessTransfer.tsx`：

```typescript
import React, { useState } from 'react';
import { View, TextInput, Button, Text, Alert } from 'react-native';
import { useLazorkit } from '../providers/LazorkitProvider';
import { PublicKey, Transaction } from '@solana/web3.js';

interface GaslessTransferProps {
  onComplete?: (signature: string) => void;
}

export const GaslessTransfer: React.FC<GaslessTransferProps> = ({ onComplete }) => {
  const { adapter, publicKey } = useLazorkit();
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);

  const handleTransfer = async () => {
    if (!adapter || !publicKey) {
      Alert.alert('Error', 'Please connect wallet first');
      return;
    }

    if (!recipient || !amount) {
      Alert.alert('Error', 'Please enter recipient and amount');
      return;
    }

    setLoading(true);
    try {
      // Create transfer transaction
      const recipientPubkey = new PublicKey(recipient);
      const lamports = Math.floor(parseFloat(amount) * 1_000_000_000); // SOL to lamports

      // Use Lazorkit's gasless send method
      const signature = await adapter.sendTransaction(
        async (transaction: Transaction) => {
          // Your transaction logic here
          return transaction;
        },
        {
          // Paymaster will handle gas fees
          skipPreflight: false,
        }
      );

      Alert.alert('Success', `Transfer complete!\nSignature: ${signature}`);
      onComplete?.(signature);
    } catch (error) {
      console.error('Transfer failed:', error);
      Alert.alert('Error', 'Transfer failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={{ padding: 20 }}>
      <Text style={{ fontSize: 18, marginBottom: 10 }}>Gasless Transfer</Text>
      
      <TextInput
        placeholder="Recipient address"
        value={recipient}
        onChangeText={setRecipient}
        style={{
          borderWidth: 1,
          borderColor: '#ccc',
          padding: 10,
          marginBottom: 10,
          borderRadius: 5,
        }}
      />
      
      <TextInput
        placeholder="Amount (SOL)"
        value={amount}
        onChangeText={setAmount}
        keyboardType="decimal-pad"
        style={{
          borderWidth: 1,
          borderColor: '#ccc',
          padding: 10,
          marginBottom: 10,
          borderRadius: 5,
        }}
      />
      
      <Button
        title={loading ? 'Sending...' : 'Send (Gasless)'}
        onPress={handleTransfer}
        disabled={loading || !publicKey}
      />
    </View>
  );
};
```

---

## 第二步：创建发送界面

创建 `src/screens/SendScreen.tsx`：

```typescript
import React from 'react';
import { View, ScrollView, Text } from 'react-native';
import { GaslessTransfer } from '../components/GaslessTransfer';
import { useLazorkit } from '../providers/LazorkitProvider';

export const SendScreen: React.FC = () => {
  const { publicKey, isConnected } = useLazorkit();

  if (!isConnected) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <Text>Please login first</Text>
      </View>
    );
  }

  return (
    <ScrollView style={{ flex: 1 }}>
      <View style={{ padding: 20 }}>
        <Text style={{ fontSize: 24, fontWeight: 'bold', marginBottom: 10 }}>
          Send SOL
        </Text>
        
        <Text style={{ marginBottom: 20, color: '#666' }}>
          No gas fees required! Powered by Lazorkit.
        </Text>
        
        <GaslessTransfer
          onComplete={(signature) => {
            console.log('Transaction signature:', signature);
          }}
        />
      </View>
    </ScrollView>
  );
};
```

---

## 第三步：集成到主应用

更新 `App.tsx` 添加导航：

```typescript
import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { LazorkitProvider } from './src/providers/LazorkitProvider';
import { LoginScreen } from './src/screens/LoginScreen';
import { SendScreen } from './src/screens/SendScreen';

const Tab = createBottomTabNavigator();

function MainApp() {
  return (
    <Tab.Navigator>
      <Tab.Screen name="Home" component={LoginScreen} />
      <Tab.Screen name="Send" component={SendScreen} />
    </Tab.Navigator>
  );
}

export default function App() {
  return (
    <LazorkitProvider>
      <NavigationContainer>
        <MainApp />
      </NavigationContainer>
    </LazorkitProvider>
  );
}
```

---

## 工作原理

```
User → DApp → Lazorkit SDK → Paymaster → Solana
         ↓                      ↓
    Sign with Passkey    Pay GAS fees
```

1. **用户签名**：使用 Passkey 签名交易
2. **Paymaster 验证**：Lazorkit 的 Paymaster 验证签名
3. **代付 Gas**：Paymaster 支付交易费用
4. **上链确认**：交易在 Solana 上确认

---

## 支持的交易类型

- ✅ SOL 转账
- ✅ SPL Token 转账
- ✅ 智能合约调用
- ✅ NFT 交易

---

## 限制

- 每日免费交易额度有限
- 需要网络连接
- 仅支持 Solana Devnet/Mainnet

---

## 测试

1. 登录钱包
2. 切换到 "Send" 标签
3. 输入测试地址：`DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK`
4. 输入金额：`0.001`
5. 点击 "Send (Gasless)"
6. 确认交易

---

## 下一步

- 学习 [Biometric Authentication](./tutorial-3-biometric.md)
- 查看 [完整代码示例](https://github.com/yourusername/lazorkit-mobile)

---

**教程作者**: Dead Lobster (死龍蝦)
**最后更新**: 2026-03-02

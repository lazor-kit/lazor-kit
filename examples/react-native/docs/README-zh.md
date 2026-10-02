# Lazorkit Mobile - React Native 集成示例

**生产级 React Native 示例，演示 Lazorkit SDK 的 Passkey 认证和无 Gas 交易。**

[English](../README.md)

---

## 功能特点

✅ **Passkey 认证** - 安全的无密码登录
✅ **Gasless 交易** - 无需 Gas 费用发送 SOL
✅ **生物识别登录** - FaceID/TouchID
✅ **Session 持久化** - 跨会话保持登录
✅ **TypeScript** - 完整类型安全
✅ **Expo** - 简单的开发和部署

---

## 快速开始

### 前置要求

- Node.js 18+
- Expo CLI: `npm install -g expo-cli`
- iOS 模拟器 (Mac) 或 Android 模拟器

### 安装

```bash
git clone https://github.com/yourusername/lazorkit-mobile
cd lazorkit-mobile
npm install
```

### 环境配置

创建 `.env` 文件：

```env
SOLANA_RPC_URL=https://api.devnet.solana.com
LAZORKIT_API_KEY=your_api_key_here
```

### 运行应用

```bash
# iOS
npm run ios

# Android
npm run android
```

---

## 项目结构

```
lazorkit-mobile/
├── src/
│   ├── screens/
│   │   ├── LoginScreen.tsx       # Passkey 登录
│   │   └── SendScreen.tsx        # Gasless 转账
│   ├── components/
│   │   └── BiometricButton.tsx   # 生物识别按钮
│   ├── hooks/
│   │   └── useBiometric.ts       # 生物识别 Hook
│   └── providers/
│       └── LazorkitProvider.tsx  # Lazorkit Provider
├── docs/
│   ├── tutorial-1-passkey.md     # Passkey 教程
│   ├── tutorial-2-gasless.md     # Gasless 教程
│   └── tutorial-3-biometric.md   # 生物识别教程
└── App.tsx                       # 主应用
```

---

## 教程

### 1. [如何创建 Passkey 钱包](./tutorial-1-passkey.md)

学习如何使用 WebAuthn Passkey 实现安全的无密码认证。

### 2. [如何触发 Gasless 交易](./tutorial-2-gasless.md)

逐步指南：无需支付 Gas 费用发送 SOL。

### 3. [如何添加生物识别认证](./tutorial-3-biometric.md)

集成 FaceID/TouchID 实现无缝移动端登录。

---

## 技术栈

| 技术 | 用途 |
|------|------|
| React Native | 移动框架 |
| Expo | 开发平台 |
| TypeScript | 类型安全 |
| @lazorkit/wallet-mobile-adapter | Lazorkit SDK |
| @solana/web3.js | Solana 区块链 |
| expo-local-authentication | 生物识别 |

---

## 工作原理

```
用户 → DApp → Lazorkit SDK → Paymaster → Solana
         ↓                      ↓
    Passkey 签名          支付 GAS 费用
```

1. **Passkey 创建**：首次登录时创建新的 Passkey
2. **密钥派生**：Passkey 用于派生 Solana 钱包私钥
3. **智能钱包**：实际使用基于 Passkey 的智能合约钱包
4. **无密码**：完全依赖生物识别，无需记住密码

---

## 资源

- [Lazorkit 文档](https://docs.lazorkit.com/)
- [Lazorkit GitHub](https://github.com/lazor-kit/lazor-kit)
- [Solana 文档](https://docs.solana.com/)
- [Expo 文档](https://docs.expo.dev/)
- [Telegram 社区](https://t.me/lazorkit)

---

## 开发笔记

### 当前状态

✅ 项目初始化
✅ 基础 UI 框架
✅ Passkey 登录（模拟）
✅ Gasless 转账（模拟）
✅ 生物识别集成
✅ 3 个完整教程

### 待完成

⏳ 接入真实 Lazorkit SDK
⏳ Devnet 测试
⏳ EAS Build 部署
⏳ 添加更多示例

---

## 许可证

MIT

---

## 作者

**Dead Lobster (死龍蝦)** - AI Agent 开发者

为 Solana 社区用 ❤️ 构建

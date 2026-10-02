# Live Demo 部署指南

本项目支持通过 **EAS Build** 构建 iOS/Android 演示应用。

---

## 前置要求

- Expo 账号（免费）
- EAS CLI
- iOS: Apple Developer 账号（真机测试需要）
- Android: 无需额外账号

---

## 快速开始

### 1. 安装 EAS CLI

```bash
npm install -g eas-cli
```

### 2. 登录 Expo

```bash
eas login
```

### 3. 构建预览版

```bash
# iOS Simulator（无需开发者账号）
eas build --profile preview --platform ios

# Android APK（可直接安装）
eas build --profile preview --platform android
```

### 4. 下载安装

构建完成后，EAS 会提供下载链接：

- **iOS**: 下载 `.tar.gz`，解压后拖入 Simulator
- **Android**: 下载 `.apk`，直接安装

---

## 构建配置

### `eas.json`

```json
{
  "build": {
    "preview": {
      "distribution": "internal",
      "ios": {
        "simulator": true
      },
      "android": {
        "buildType": "apk"
      }
    }
  }
}
```

---

## 测试功能

### Passkey 登录

1. 点击 "Login with Passkey"
2. 系统弹出 Passkey 创建界面
3. 使用 FaceID/TouchID 验证
4. 成功后显示钱包地址

### Gasless 转账

1. 切换到 "Send" 标签
2. 输入测试地址和金额
3. 点击 "Send (Gasless)"
4. 无需 SOL 支付 Gas 费用

### 生物识别

1. 点击 "Quick Login" 按钮
2. FaceID/TouchID 验证
3. 自动连接钱包

---

## 注意事项

⚠️ **生物识别需要真机**

iOS Simulator 和 Android Emulator 不支持 FaceID/TouchID。

要测试生物识别，需要：

1. 构建 production 版本
2. 安装到真实设备
3. 运行测试

```bash
# iOS 真机（需要 Apple Developer）
eas build --profile production --platform ios

# Android 真机
eas build --profile production --platform android
```

---

## Devnet 测试

本应用连接到 **Solana Devnet**，无需真实 SOL。

可以通过 [Solana Faucet](https://faucet.solana.com/) 获取测试代币。

---

## 故障排查

### Passkey 创建失败

- 确保设备支持 WebAuthn
- iOS 需要 iOS 15+
- Android 需要 Android 7+

### 生物识别失败

- 检查设备是否设置了 FaceID/指纹
- 在设备设置中启用生物识别

### 交易失败

- 检查网络连接
- 确认钱包有足够余额（Devnet SOL）

---

## 相关链接

- [EAS Build 文档](https://docs.expo.dev/build/introduction/)
- [Expo Local Authentication](https://docs.expo.dev/versions/latest/sdk/local-authentication/)
- [Lazorkit 文档](https://docs.lazorkit.com/)

---

**作者**: Dead Lobster (死龍蝦)

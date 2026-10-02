# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.2.x   | :white_check_mark: |
| < 1.2   | :x:                |

## Reporting a Vulnerability

We take security vulnerabilities seriously. If you discover a security issue, please follow these steps:

### 1. **DO NOT** create a public GitHub issue
Creating a public issue could expose users to the vulnerability before it's fixed.

### 2. Report privately
Send an email to **security@lazor.sh** with the following information:

- **Subject**: `[SECURITY] Vulnerability in @lazorkit/wallet-mobile-adapter`
- **Description**: Detailed description of the vulnerability
- **Steps to reproduce**: Clear steps to reproduce the issue
- **Impact**: Potential impact on users
- **Suggested fix**: If you have a suggested solution

### 3. What happens next
- We will acknowledge receipt within 24 hours
- We will investigate and provide updates
- We will work on a fix and coordinate disclosure
- We will credit you in the security advisory (if desired)

## Security Considerations

### WebAuthn/Passkey Security
This SDK handles WebAuthn authentication which involves:
- Biometric authentication (Face ID, Touch ID, fingerprint)
- Private key generation and storage
- Cryptographic signatures

**Best practices:**
- Always use HTTPS in production
- Verify the authenticity of service URLs
- Implement proper error handling
- Never log sensitive authentication data

### Smart Wallet Security
The SDK creates and manages smart wallets on Solana:
- Smart contract wallet creation
- Transaction signing and execution
- Fee sponsorship through paymaster

**Best practices:**
- Verify smart contract addresses
- Use trusted RPC endpoints
- Implement transaction confirmation checks
- Monitor for suspicious activity

### Data Storage Security
The SDK keeps in AsyncStorage, which is not encrypted, only data that is not
secret:
- The connected wallet's public record (addresses, the passkey's public key and
  credential id)
- Configuration data
- Each passkey's transaction state (the slot of its last transaction, and a
  send whose outcome is not known yet)

It never stores a session key, or an Ed25519 key added with
`addAuthorityEd25519`: your app generates those and keeps them.

**Best practices:**
- Keep session keys in the OS keystore (expo-secure-store, with
  `WHEN_UNLOCKED_THIS_DEVICE_ONLY`), never in AsyncStorage. See the README,
  "Session keys"
- Delete a session key once its session is revoked or has expired
- Clear sensitive data on logout

## Security Checklist for Users

Before using this SDK in production:

- [ ] Verify package authenticity: `npm audit` and check package signatures
- [ ] Review source code: Ensure no malicious code is present
- [ ] Use HTTPS: WebAuthn requires secure connections
- [ ] Implement proper error handling: Don't expose sensitive information
- [ ] Use environment variables: Don't hardcode sensitive URLs
- [ ] Enable debug mode only in development
- [ ] Implement proper logout: Clear sensitive data
- [ ] Monitor for updates: Keep the package updated
- [ ] Test thoroughly: Verify all wallet operations work correctly
- [ ] Have a security incident response plan

## Known Security Features

### Built-in Protections
- **Type Safety**: Full TypeScript support prevents type-related vulnerabilities
- **Error Boundaries**: Proper error handling prevents crashes
- **Input Validation**: All inputs are validated before processing
- **Storage**: AsyncStorage holds nothing secret; session keys stay with your app (see the README, "Session keys")
- **HTTPS Enforcement**: WebAuthn operations require secure connections

### Security Audits
- Regular dependency updates
- Automated security scanning
- Manual code reviews
- Third-party security assessments (planned)

## Contact Information

- **Security Email**: security@lazor.sh
- **General Support**: support@lazor.sh
- **Website**: https://lazor.sh
- **GitHub**: https://github.com/lazorkit/wallet-mobile-adapter

## Responsible Disclosure Timeline

- **Day 0**: Vulnerability reported
- **Day 1**: Acknowledgment and initial assessment
- **Day 7**: Status update and timeline
- **Day 30**: Fix development and testing
- **Day 45**: Patch release and disclosure

*Timeline may vary based on vulnerability complexity and severity.*

## Bug Bounty

We currently do not have a formal bug bounty program, but we do appreciate security researchers who responsibly disclose vulnerabilities. Contributors may be acknowledged in our security advisories and documentation.

---

**Remember**: Security is everyone's responsibility. If you see something, say something! 
# Security Policy

## Supported versions and reporting a vulnerability

The repository's [SECURITY.md](https://github.com/lazor-kit/lazor-kit/blob/main/SECURITY.md)
is the policy for this package: which versions are supported, how to report a vulnerability
privately, what to expect, and the audit status of the LazorKit programs. Do not open a public
GitHub issue for a security issue.

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

### Audit status
See [SECURITY.md › Audit status](https://github.com/lazor-kit/lazor-kit/blob/main/SECURITY.md#audit-status).

---

**Remember**: Security is everyone's responsibility. If you see something, say something! 
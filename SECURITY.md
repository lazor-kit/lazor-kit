# Security policy

This policy covers the packages published from this repository,
[`@lazorkit/wallet`](packages/react) and
[`@lazorkit/wallet-mobile-adapter`](packages/react-native), and the rest of the code in it.
The on-chain programs and the protocol SDKs (`@lazorkit/sdk-legacy`, `@lazorkit/sdk`) live in
[`lazor-kit/lazorkit-protocol`](https://github.com/lazor-kit/lazorkit-protocol), which has its
own `SECURITY.md`. If you are not sure where an issue belongs, report it here.

## Supported versions

LazorKit supports the current major version of each package and the previous one. When a new
major version is released as stable, the previous major gets security fixes for 6 months.
Older versions are not supported. The full policy is on
[Support policy](https://docs.lazorkit.com/support-policy).

| Package | Version | Supported |
| ------- | ------- | --------- |
| `@lazorkit/wallet` | 4.x (pre-release, npm `next`) | Yes: the current major. Fixes land here first. Pre-releases may change before 4.0.0 is stable. |
| | 3.x (npm `latest`) | Yes. Once 4.0.0 is stable: security fixes only, for 6 months after its release. |
| | < 3.0 | No |
| `@lazorkit/wallet-mobile-adapter` | 3.x (pre-release, npm `next`) | Yes: the current major. Fixes land here first. Pre-releases may change before 3.0.0 is stable. |
| | 2.x (npm `latest`) | Yes. Once 3.0.0 is stable: security fixes only, for 6 months after its release. |
| | < 2.0 | No |

A release that targets a program that has been closed cannot be fixed by an update of its
own. Those releases, and which SDK versions work with which program, are listed on
[Versions & compatibility](https://docs.lazorkit.com/versions).

## Reporting a vulnerability

Do not open a public issue, pull request or discussion for a security issue. Report it
privately:

- through GitHub's private vulnerability reporting:
  [Report a vulnerability](https://github.com/lazor-kit/lazor-kit/security/advisories/new)
  (the **Security** tab of this repository);
- or by contacting **[SECURITY CONTACT]**.

Include what you can of:

- the affected package and version (or commit), and the network (mainnet, devnet, local);
- what an attacker can do, and what they need (a malicious app, a malicious page, a
  compromised relayer, access to the device);
- steps or code to reproduce it;
- a suggested fix, if you have one.

Do not test against wallets or funds that are not yours, and do not publish details until a
fix is released or we have agreed on a date.

## What to expect

- **Acknowledgement** within 48 hours.
- **Initial assessment** within 7 days: whether we can reproduce it, its severity, and which
  versions are affected.
- **A fix and disclosure** targeted within 30 days, sooner for an issue that puts funds at
  risk. If it takes longer, we tell you why and when to expect it.
- Updates while we work on it, and a say in the disclosure date.
- Credit in the GitHub security advisory, if you want it.

Fixes are released for every supported version (see above), and the advisory names the
fixed versions.

## Audit status

The LazorKit programs have not been externally audited. What has been reviewed, and how, is on
[Versions & compatibility](https://docs.lazorkit.com/versions#audit-status).

---
"@lazorkit/wallet": patch
---

Point the default paymaster at `https://kora.devnet.lazorkit.com`. The previous default, `https://lazorkit-paymaster.onrender.com`, has been suspended and answers every request with 503, so an app that did not pass its own `paymasterConfig.paymasterUrl` had no working fee sponsorship and the failure looked like a network error. Apps that already set `paymasterUrl` are unaffected.

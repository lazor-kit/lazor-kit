// Compiled by test/types.test.cjs against the built declarations: each call
// after a `// @ts-expect-error` line must fail to compile. If `role` became
// optional again, the directive would be unused, which is itself an error.
import type { PublicKey } from '@solana/web3.js';
import { ROLE_ADMIN, ROLE_SPENDER, useWallet, useWalletStore } from '../../dist/index';

declare const key: PublicKey;
declare const wallet: ReturnType<typeof useWallet>;
const store = useWalletStore.getState();
const options = { redirectUrl: 'app://callback' };
const policy = new Uint8Array(8);

// `role` is required, on the hook and on the store.
// @ts-expect-error role is required
void wallet.addAuthorityEd25519({ newEd25519Pubkey: key, policy }, options);
// @ts-expect-error role is required
void store.addAuthorityEd25519({ newEd25519Pubkey: key, unrestricted: true }, options);

// With one, it compiles.
void wallet.addAuthorityEd25519({ newEd25519Pubkey: key, role: ROLE_SPENDER, policy }, options);
void store.addAuthorityEd25519({ newEd25519Pubkey: key, role: ROLE_ADMIN }, options);

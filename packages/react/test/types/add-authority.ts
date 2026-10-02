// Compiled by test/types.test.mjs against the built declarations: each line
// marked @ts-expect-error must fail to compile. If `role` became optional
// again, the directive would be unused, which is itself an error.
import { ROLE_ADMIN, ROLE_SPENDER, serializeActions, useWallet, useWalletStore } from '../../dist/index';

declare const wallet: ReturnType<typeof useWallet>;
const store = useWalletStore.getState();
const policy = serializeActions([]);

// `role` is required, on the hook and on the store.
// @ts-expect-error role is required
void wallet.addAuthority({ policy });
// @ts-expect-error a payload with a role is required
void wallet.addAuthority();
// @ts-expect-error role is required
void store.addAuthority({ unrestricted: true });
// @ts-expect-error a payload with a role is required
void store.addAuthority();

// With one, it compiles.
void wallet.addAuthority({ role: ROLE_SPENDER, policy });
void wallet.addAuthority({ role: ROLE_ADMIN, onSuccess: (authorityPda: string, publicKey: string) => void [authorityPda, publicKey] });
void store.addAuthority({ role: ROLE_SPENDER, policy });

// disconnect takes keepSessionKeys.
void wallet.disconnect({ keepSessionKeys: true });
void store.disconnect({ keepSessionKeys: false, onSuccess: () => {} });

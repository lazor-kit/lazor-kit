// Compiled by test/types.test.mjs against the built declarations: each line
// marked @ts-expect-error must fail to compile (D1: no default mode; D3:
// Embedded needs rpId and appName; portal takes neither, nor confirm).
import type { LazorkitProviderProps, LazorkitClientConfig } from '../../dist/index';

const children = null;

// @ts-expect-error mode is required
const noMode: LazorkitProviderProps = { children, rpcUrl: 'https://api.devnet.solana.com' };
// @ts-expect-error embedded needs rpId
const noRpId: LazorkitProviderProps = { children, mode: 'embedded', appName: 'App' };
// @ts-expect-error embedded needs appName
const noAppName: LazorkitProviderProps = { children, mode: 'embedded', rpId: 'app.example.com' };
// @ts-expect-error portal takes no rpId
const portalRpId: LazorkitProviderProps = { children, mode: 'portal', rpId: 'app.example.com' };
// @ts-expect-error confirm is Embedded only
const portalConfirm: LazorkitClientConfig = { mode: 'portal', confirm: false };

// These compile.
const embedded: LazorkitProviderProps = { children, mode: 'embedded', rpId: 'app.example.com', appName: 'App', confirm: false };
const portal: LazorkitProviderProps = { children, mode: 'portal', portalUrl: 'https://portal.lazor.sh' };
const client: LazorkitClientConfig = { mode: 'embedded', rpId: 'localhost', appName: 'App', cluster: 'devnet' };

void [noMode, noRpId, noAppName, portalRpId, portalConfirm, embedded, portal, client];

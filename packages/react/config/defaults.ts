export const DEFAULTS = {
  PORTAL_URL: 'https://portal.lazor.sh',
  PAYMASTER_URL: 'https://lazorkit-paymaster.onrender.com',
  RPC_ENDPOINT: 'https://api.devnet.solana.com',
  /** Session keys expire after this many slots (~5h at 400ms/slot) if `expiresInSlots` isn't provided. */
  SESSION_EXPIRY_SLOTS: 50_000n,
  /** Deferred-execution TX1 authorize-to-execute window, in slots (~2m). */
  DEFERRED_EXPIRY_SLOTS: 300,
} as const;

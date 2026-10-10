export const DEFAULTS = {
  PORTAL_URL: 'https://portal.lazor.sh',
  PAYMASTER_URL: 'https://kora.devnet.lazorkit.com',
  RPC_ENDPOINT: 'https://api.devnet.solana.com',
  /**
   * How long a session lasts when `createSession` is given no expiry: 5 hours
   * of the cluster clock. (Releases that measured sessions in slots used
   * 50,000 slots, about 5.5 hours on mainnet and 3 on devnet.)
   */
  SESSION_EXPIRY_SECONDS: 18_000,
  /**
   * Deferred execution: how many slots after TX1 (Authorize) the program still
   * accepts TX2, when the caller passes no `expiryOffset`. A slot has no fixed
   * length (devnet ran near 230 ms in September 2026, mainnet near 400 ms), so
   * this is sized from the wallet's own budget, about 3.5 minutes between
   * TX1 landing and TX2 being sent: 1500 slots is 5 minutes at 200 ms a slot.
   * The program accepts 10 to 9000.
   */
  DEFERRED_EXPIRY_SLOTS: 1_500,
} as const;

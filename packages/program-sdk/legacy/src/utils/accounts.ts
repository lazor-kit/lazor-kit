/**
 * Hand-written account deserializers for LazorKit on-chain accounts.
 * Replaces Solita-generated account classes.
 */
import { Connection, PublicKey } from '@solana/web3.js';

// ─── Authority Account ───────────────────────────────────────────────

/**
 * AuthorityAccountHeader layout (48 bytes):
 * [discriminator: u8][authorityType: u8][role: u8][bump: u8]
 * [version: u8][padding: 3 bytes][counter: u32 LE][padding: 4 bytes]
 * [wallet: Pubkey(32)]
 */
export interface AuthorityAccountData {
  discriminator: number;
  authorityType: number;
  role: number;
  bump: number;
  version: number;
  counter: number;
  wallet: PublicKey;
}

export class AuthorityAccount implements AuthorityAccountData {
  constructor(
    public readonly discriminator: number,
    public readonly authorityType: number,
    public readonly role: number,
    public readonly bump: number,
    public readonly version: number,
    public readonly counter: number,
    public readonly wallet: PublicKey,
  ) {}

  static fromBuffer(data: Buffer): AuthorityAccount {
    if (data.length < 48) throw new Error('Authority account data too short');
    const discriminator = data[0];
    const authorityType = data[1];
    const role = data[2];
    const bump = data[3];
    const version = data[4];
    // padding: 3 bytes (5..8)
    const counter = data.readUInt32LE(8);
    // padding: 4 bytes (12..16)
    const wallet = new PublicKey(data.subarray(16, 48));
    return new AuthorityAccount(discriminator, authorityType, role, bump, version, counter, wallet);
  }

  static async fromAccountAddress(
    connection: Connection,
    address: PublicKey,
  ): Promise<AuthorityAccount> {
    const info = await connection.getAccountInfo(address);
    if (!info || !info.data) throw new Error(`Authority account not found: ${address.toBase58()}`);
    return AuthorityAccount.fromBuffer(info.data);
  }
}

// ─── Session Account ─────────────────────────────────────────────────

/**
 * SessionAccount layout (80 bytes fixed header + optional actions):
 * [discriminator: u8][bump: u8][version: u8][padding: 5 bytes]
 * [wallet: Pubkey(32)][sessionKey: Pubkey(32)][expiresAt: u64 LE]
 */
export interface SessionAccountData {
  discriminator: number;
  bump: number;
  version: number;
  wallet: PublicKey;
  sessionKey: PublicKey;
  expiresAt: bigint;
}

export class SessionAccount implements SessionAccountData {
  constructor(
    public readonly discriminator: number,
    public readonly bump: number,
    public readonly version: number,
    public readonly wallet: PublicKey,
    public readonly sessionKey: PublicKey,
    public readonly expiresAt: bigint,
  ) {}

  static fromBuffer(data: Buffer): SessionAccount {
    if (data.length < 80) throw new Error('Session account data too short');
    const discriminator = data[0];
    const bump = data[1];
    const version = data[2];
    const wallet = new PublicKey(data.subarray(8, 40));
    const sessionKey = new PublicKey(data.subarray(40, 72));
    const expiresAt = data.readBigUInt64LE(72);
    return new SessionAccount(discriminator, bump, version, wallet, sessionKey, expiresAt);
  }

  static async fromAccountAddress(
    connection: Connection,
    address: PublicKey,
  ): Promise<SessionAccount> {
    const info = await connection.getAccountInfo(address);
    if (!info || !info.data) throw new Error(`Session account not found: ${address.toBase58()}`);
    return SessionAccount.fromBuffer(info.data);
  }
}

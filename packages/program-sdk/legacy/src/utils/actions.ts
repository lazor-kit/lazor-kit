/**
 * Session action types and serialization for LazorKit session permissions.
 *
 * Actions are optional permission rules attached to sessions at creation time.
 * They are immutable — once set, they cannot be changed. To change permissions,
 * revoke the session and create a new one.
 *
 * @example
 * ```typescript
 * import { Actions, serializeActions } from '@lazorkit/sdk-legacy';
 *
 * const actions = [
 *   Actions.solRecurringLimit({ limit: 1_000_000_000n, window: 216_000n }),
 *   Actions.programWhitelist(JUPITER_PROGRAM_ID),
 *   Actions.solMaxPerTx(500_000_000n),
 * ];
 * ```
 */
import { PublicKey } from '@solana/web3.js';

// ─── Action Type IDs (must match program/src/state/action.rs) ────────

export enum SessionActionType {
  SolLimit = 1,
  SolRecurringLimit = 2,
  SolMaxPerTx = 3,
  TokenLimit = 4,
  TokenRecurringLimit = 5,
  TokenMaxPerTx = 6,
  ProgramWhitelist = 10,
  ProgramBlacklist = 11,
}

// ─── Action Data Types ───────────────────────────────────────────────

export interface SolLimitAction {
  type: SessionActionType.SolLimit;
  /** Lifetime SOL spending cap in lamports */
  remaining: bigint;
  /** Optional per-action expiry (slot). 0 = inherit session expiry. */
  expiresAt?: bigint;
}

export interface SolRecurringLimitAction {
  type: SessionActionType.SolRecurringLimit;
  /** Max lamports per window */
  limit: bigint;
  /** Window size in slots */
  window: bigint;
  /** Optional per-action expiry (slot). 0 = inherit session expiry. */
  expiresAt?: bigint;
}

export interface SolMaxPerTxAction {
  type: SessionActionType.SolMaxPerTx;
  /** Max lamports per single execute */
  max: bigint;
  expiresAt?: bigint;
}

export interface TokenLimitAction {
  type: SessionActionType.TokenLimit;
  /** SPL token mint */
  mint: PublicKey;
  /** Lifetime token spending cap (in token base units) */
  remaining: bigint;
  expiresAt?: bigint;
}

export interface TokenRecurringLimitAction {
  type: SessionActionType.TokenRecurringLimit;
  mint: PublicKey;
  /** Max tokens per window */
  limit: bigint;
  /** Window size in slots */
  window: bigint;
  expiresAt?: bigint;
}

export interface TokenMaxPerTxAction {
  type: SessionActionType.TokenMaxPerTx;
  mint: PublicKey;
  /** Max tokens per single execute */
  max: bigint;
  expiresAt?: bigint;
}

export interface ProgramWhitelistAction {
  type: SessionActionType.ProgramWhitelist;
  /** Program ID to allow */
  programId: PublicKey;
  expiresAt?: bigint;
}

export interface ProgramBlacklistAction {
  type: SessionActionType.ProgramBlacklist;
  /** Program ID to block */
  programId: PublicKey;
  expiresAt?: bigint;
}

/** Union of all session action types */
export type SessionAction =
  | SolLimitAction
  | SolRecurringLimitAction
  | SolMaxPerTxAction
  | TokenLimitAction
  | TokenRecurringLimitAction
  | TokenMaxPerTxAction
  | ProgramWhitelistAction
  | ProgramBlacklistAction;

// ─── Builder Helpers ─────────────────────────────────────────────────

export const Actions = {
  /** Lifetime SOL spending cap */
  solLimit: (remaining: bigint, expiresAt?: bigint): SolLimitAction => ({
    type: SessionActionType.SolLimit,
    remaining,
    expiresAt,
  }),

  /** SOL spending cap per time window */
  solRecurringLimit: (params: {
    limit: bigint;
    window: bigint;
    expiresAt?: bigint;
  }): SolRecurringLimitAction => ({
    type: SessionActionType.SolRecurringLimit,
    ...params,
  }),

  /** Max SOL per single execute */
  solMaxPerTx: (max: bigint, expiresAt?: bigint): SolMaxPerTxAction => ({
    type: SessionActionType.SolMaxPerTx,
    max,
    expiresAt,
  }),

  /** Lifetime token spending cap per mint */
  tokenLimit: (params: {
    mint: PublicKey;
    remaining: bigint;
    expiresAt?: bigint;
  }): TokenLimitAction => ({
    type: SessionActionType.TokenLimit,
    ...params,
  }),

  /** Token spending cap per time window per mint */
  tokenRecurringLimit: (params: {
    mint: PublicKey;
    limit: bigint;
    window: bigint;
    expiresAt?: bigint;
  }): TokenRecurringLimitAction => ({
    type: SessionActionType.TokenRecurringLimit,
    ...params,
  }),

  /** Max tokens per single execute per mint */
  tokenMaxPerTx: (params: {
    mint: PublicKey;
    max: bigint;
    expiresAt?: bigint;
  }): TokenMaxPerTxAction => ({
    type: SessionActionType.TokenMaxPerTx,
    ...params,
  }),

  /** Allow CPI only to this program (repeatable) */
  programWhitelist: (
    programId: PublicKey,
    expiresAt?: bigint,
  ): ProgramWhitelistAction => ({
    type: SessionActionType.ProgramWhitelist,
    programId,
    expiresAt,
  }),

  /** Block CPI to this program (repeatable) */
  programBlacklist: (
    programId: PublicKey,
    expiresAt?: bigint,
  ): ProgramBlacklistAction => ({
    type: SessionActionType.ProgramBlacklist,
    programId,
    expiresAt,
  }),
};

// ─── Serialization ───────────────────────────────────────────────────

/** Action header: [type: u8][data_len: u16 LE][expires_at: u64 LE] = 11 bytes */
const ACTION_HEADER_SIZE = 11;

function writeU64LE(buf: Uint8Array, offset: number, value: bigint): void {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  view.setBigUint64(offset, value, true);
}

function writeU16LE(buf: Uint8Array, offset: number, value: number): void {
  buf[offset] = value & 0xff;
  buf[offset + 1] = (value >> 8) & 0xff;
}

function serializeActionData(action: SessionAction): Uint8Array {
  switch (action.type) {
    case SessionActionType.SolLimit: {
      const buf = new Uint8Array(8);
      writeU64LE(buf, 0, action.remaining);
      return buf;
    }
    case SessionActionType.SolRecurringLimit: {
      const buf = new Uint8Array(32);
      writeU64LE(buf, 0, action.limit);
      writeU64LE(buf, 8, 0n); // spent = 0
      writeU64LE(buf, 16, action.window);
      writeU64LE(buf, 24, 0n); // last_reset = 0
      return buf;
    }
    case SessionActionType.SolMaxPerTx: {
      const buf = new Uint8Array(8);
      writeU64LE(buf, 0, action.max);
      return buf;
    }
    case SessionActionType.TokenLimit: {
      const buf = new Uint8Array(40);
      buf.set(action.mint.toBytes(), 0);
      writeU64LE(buf, 32, action.remaining);
      return buf;
    }
    case SessionActionType.TokenRecurringLimit: {
      const buf = new Uint8Array(64);
      buf.set(action.mint.toBytes(), 0);
      writeU64LE(buf, 32, action.limit);
      writeU64LE(buf, 40, 0n); // spent = 0
      writeU64LE(buf, 48, action.window);
      writeU64LE(buf, 56, 0n); // last_reset = 0
      return buf;
    }
    case SessionActionType.TokenMaxPerTx: {
      const buf = new Uint8Array(40);
      buf.set(action.mint.toBytes(), 0);
      writeU64LE(buf, 32, action.max);
      return buf;
    }
    case SessionActionType.ProgramWhitelist: {
      return new Uint8Array(action.programId.toBytes());
    }
    case SessionActionType.ProgramBlacklist: {
      return new Uint8Array(action.programId.toBytes());
    }
  }
}

/**
 * Serialize an array of SessionActions into the flat byte buffer format
 * expected by the program.
 *
 * Each action: [type: u8][data_len: u16 LE][expires_at: u64 LE][data...]
 */
export function serializeActions(actions: SessionAction[]): Uint8Array {
  if (actions.length === 0) return new Uint8Array(0);

  const parts: Uint8Array[] = [];
  for (const action of actions) {
    const data = serializeActionData(action);
    const header = new Uint8Array(ACTION_HEADER_SIZE);
    header[0] = action.type;
    writeU16LE(header, 1, data.length);
    writeU64LE(header, 3, action.expiresAt ?? 0n);
    parts.push(header);
    parts.push(data);
  }

  const totalLen = parts.reduce((sum, p) => sum + p.length, 0);
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

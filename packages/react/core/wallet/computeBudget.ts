/**
 * `transactionOptions.computeUnitLimit`: a `SetComputeUnitLimit` instruction
 * put first in the transaction, before the secp256r1 precompile.
 *
 * Placement matters: LazorKit reads the passkey signature from the
 * instruction right before its own (`current_index - 1`), so a ComputeBudget
 * instruction between the precompile and the LazorKit instruction fails with
 * InvalidInstruction (3003). First is safe: it shifts both. It is not part of
 * what the passkey signs, so it is added after the approval.
 *
 * No limit is set unless the app asks for one. Without one the runtime
 * reserves 200,000 CU per instruction (about 400,000 for a passkey send, which
 * uses about 15,000–30,000). That costs nothing today: no LazorKit send carries
 * a compute-unit price, so no priority fee is charged on the reservation. An
 * app that knows its instructions' cost can pass a limit (measured × 1.15 is
 * a sane margin) to make the transaction cheaper to schedule.
 *
 * This file is the same in @lazorkit/wallet (core/wallet/computeBudget.ts) and
 * @lazorkit/wallet-mobile-adapter (src/core/wallet/computeBudget.ts),
 * indentation aside.
 */
import { ComputeBudgetProgram, type TransactionInstruction } from '@solana/web3.js';

/** The most compute units a transaction may ask for. */
export const MAX_COMPUTE_UNIT_LIMIT = 1_400_000;

/**
 * Throws, before anything is prompted or sent, unless `limit` is absent (or
 * 0, which means "not set", as before) or a whole number from 1 to
 * `MAX_COMPUTE_UNIT_LIMIT`.
 */
export function checkComputeUnitLimit(limit: number | undefined | null): void {
    if (limit === undefined || limit === null || limit === 0) return;
    if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > MAX_COMPUTE_UNIT_LIMIT) {
        throw new Error(
            `transactionOptions.computeUnitLimit must be a whole number from 1 to ${MAX_COMPUTE_UNIT_LIMIT}, not ${String(limit)}. ` +
                'Nothing was signed or sent.',
        );
    }
}

/** `instructions`, with `SetComputeUnitLimit(limit)` first when a limit is set. */
export function withComputeUnitLimit(
    instructions: TransactionInstruction[],
    limit: number | undefined | null,
): TransactionInstruction[] {
    checkComputeUnitLimit(limit);
    if (!limit) return instructions;
    return [ComputeBudgetProgram.setComputeUnitLimit({ units: limit }), ...instructions];
}

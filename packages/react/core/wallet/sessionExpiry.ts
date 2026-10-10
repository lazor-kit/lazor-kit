/**
 * When a session ends.
 *
 * LazorKit v2 measures a session's expiry in Unix seconds of the cluster
 * clock (the Clock sysvar): CreateSession accepts an `expiresAt` after the
 * cluster's time and at most 30 days (`MAX_SESSION_SECONDS`) ahead of it, and
 * refuses anything else with 3008. The portal shows that time to the user
 * ("until about 6:50 PM"), so it is computed here from the cluster clock, not
 * from this device's.
 *
 * v1 wallets keep v1's rule: the expiry is the last slot the session signs in.
 */
import type { Connection } from '@solana/web3.js';
import { MAX_SESSION_SECONDS, type LazorKitClient, type ProtocolVersion } from '../program';
import { DEFAULTS } from '../../config';

/**
 * 2020-01-01 in Unix seconds. An expiry below it is a slot: what v1 wrote,
 * and what v2 wrote before it measured sessions in seconds.
 */
export const MIN_UNIX_SECONDS = 1_577_836_800n;

/** How many recent performance samples (a minute each) the slot time is measured over. */
const SLOT_SAMPLES = 10;

/** The longest a session may be asked for in slots before it is refused (30 days at 100 ms a slot). */
const MAX_SESSION_SLOTS = 25_920_000n;

let warnedSlots = false;

/**
 * The cluster's measured time per slot, in seconds, over its last ten minutes
 * of performance samples. Throws when the RPC gives no usable sample.
 */
export async function measuredSecondsPerSlot(connection: Connection): Promise<number> {
    let samples: { numSlots: number; samplePeriodSecs: number }[];
    try {
        samples = await connection.getRecentPerformanceSamples(SLOT_SAMPLES);
    } catch (error) {
        throw new Error(
            `The cluster's slot time could not be read (getRecentPerformanceSamples failed: ${String(
                (error as Error)?.message ?? error,
            )}), so expiresInSlots cannot be converted to seconds. Pass expiresInSeconds instead.`,
        );
    }
    let slots = 0;
    let seconds = 0;
    for (const sample of samples ?? []) {
        if (sample && sample.numSlots > 0 && sample.samplePeriodSecs > 0) {
            slots += sample.numSlots;
            seconds += sample.samplePeriodSecs;
        }
    }
    if (slots === 0 || seconds === 0) {
        throw new Error(
            "The cluster's slot time could not be measured (no performance samples), so expiresInSlots " +
                'cannot be converted to seconds. Pass expiresInSeconds instead.',
        );
    }
    return seconds / slots;
}

/** `value` as a whole number of seconds (a bigint), or a TypeError naming `what`. */
function wholeSeconds(what: string, value: number | bigint): bigint {
    if (typeof value === 'bigint') return value;
    if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
        throw new TypeError(`${what} must be a whole number of seconds; got ${String(value)}`);
    }
    return BigInt(value);
}

export interface SessionExpiryInput {
    readonly expiresInSeconds?: number | bigint;
    readonly expiresAt?: number | bigint;
    /** @deprecated converted with the measured slot time. */
    readonly expiresInSlots?: bigint;
}

/**
 * The `expiresAt` to sign for a new session of a wallet on `version`: Unix
 * seconds for v2, a slot for v1. Checked against the cluster clock before
 * anything is prompted; the program would refuse the same values (3008).
 */
export async function sessionExpiresAt(params: {
    connection: Connection;
    client: LazorKitClient;
    version: ProtocolVersion;
    input: SessionExpiryInput;
}): Promise<bigint> {
    const { connection, client, version, input } = params;
    const given = (['expiresInSeconds', 'expiresAt', 'expiresInSlots'] as const).filter((k) => input[k] !== undefined);
    if (given.length > 1) {
        throw new TypeError(`createSession takes one of expiresInSeconds, expiresAt and expiresInSlots; got ${given.join(' and ')}`);
    }

    let seconds: bigint | undefined;
    if (input.expiresInSlots !== undefined) {
        if (!warnedSlots) {
            warnedSlots = true;
            console.warn(
                '[LazorKit] createSession({ expiresInSlots }) is deprecated: sessions expire by the cluster clock. ' +
                    'It is converted with the measured slot time; pass expiresInSeconds instead.',
            );
        }
        const slots = input.expiresInSlots;
        if (typeof slots !== 'bigint' || slots <= 0n || slots > MAX_SESSION_SLOTS) {
            throw new RangeError(`expiresInSlots must be a bigint from 1 to ${MAX_SESSION_SLOTS}; got ${String(slots)}`);
        }
        if (version === 1) return BigInt(await connection.getSlot()) + slots;
        seconds = BigInt(Math.ceil(Number(slots) * (await measuredSecondsPerSlot(connection))));
    } else if (input.expiresAt === undefined) {
        seconds = wholeSeconds('expiresInSeconds', input.expiresInSeconds ?? DEFAULTS.SESSION_EXPIRY_SECONDS);
        if (seconds <= 0n || seconds > MAX_SESSION_SECONDS) {
            throw new RangeError(
                `expiresInSeconds must be more than 0 and at most ${MAX_SESSION_SECONDS} (30 days); got ${seconds}`,
            );
        }
    }

    if (version === 1) {
        // v1 counts slots: convert the time with the measured slot time.
        const secondsPerSlot = await measuredSecondsPerSlot(connection);
        const slot = BigInt(await connection.getSlot());
        if (seconds === undefined) {
            const at = wholeSeconds('expiresAt', input.expiresAt!);
            const now = BigInt(Math.floor(Date.now() / 1000));
            if (at <= now) throw new RangeError(`expiresAt ${at} is not in the future`);
            seconds = at - now;
        }
        return slot + BigInt(Math.ceil(Number(seconds) / secondsPerSlot));
    }

    const clock = await client.getClusterTime();
    if (seconds !== undefined) {
        if (seconds > MAX_SESSION_SECONDS) {
            throw new RangeError(
                `expiresInSlots converts to ${seconds} seconds at the measured slot time, more than the 30 days ` +
                    `(${MAX_SESSION_SECONDS} s) a session may last. Pass expiresInSeconds.`,
            );
        }
        return clock.unixTimestamp + seconds;
    }
    const at = wholeSeconds('expiresAt', input.expiresAt!);
    if (at < MIN_UNIX_SECONDS) {
        throw new RangeError(`expiresAt ${at} is not a Unix time in seconds (it looks like a slot)`);
    }
    if (at <= clock.unixTimestamp || at > clock.unixTimestamp + MAX_SESSION_SECONDS) {
        throw new RangeError(
            `expiresAt ${at} must be after the cluster's time (${clock.unixTimestamp}) and at most 30 days ahead of it`,
        );
    }
    return at;
}

/** Whether a session's expiry, as stored, is a slot rather than a Unix time. */
export function expiryIsSlot(expiresAt: bigint): boolean {
    return expiresAt < MIN_UNIX_SECONDS;
}

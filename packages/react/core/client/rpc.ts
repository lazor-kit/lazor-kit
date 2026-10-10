/**
 * Embedded mode reads the chain from the app's own RPC, which on a public
 * endpoint answers bursts with HTTP 429. web3.js retries four times over about
 * 7 s; this waits a little longer first (`Retry-After` when the node gives
 * one), five times, so a connect or a send on a public RPC does not fail on a
 * rate limit. Any other answer is passed on as it is.
 */
const MAX_RETRIES = 5;

export const rateLimitedFetch: typeof fetch = async (input, init) => {
    for (let attempt = 0; ; attempt++) {
        const response = await fetch(input, init);
        if (response.status !== 429 || attempt >= MAX_RETRIES) return response;
        const after = Number(response.headers?.get?.('retry-after'));
        const wait = Number.isFinite(after) && after > 0 ? after * 1000 : Math.min(8000, 1000 * 2 ** attempt);
        await new Promise((resolve) => setTimeout(resolve, wait));
    }
};

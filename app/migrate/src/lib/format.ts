export const formatSol = (lamports: number): string =>
  `${(lamports / 1_000_000_000).toLocaleString(undefined, { maximumFractionDigits: 9 })} SOL`;

/** Raw token amount. Decimals live on the mint, which this page does not fetch. */
export const formatTokenAmount = (amount: bigint): string => amount.toLocaleString();

export const short = (address: string): string => `${address.slice(0, 4)}…${address.slice(-4)}`;

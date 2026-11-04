export type Clock = () => bigint;

export const NS_PER_MS = 1_000_000n;
export const NS_PER_HOUR = 3_600_000_000_000n;
export const NS_PER_DAY = 24n * NS_PER_HOUR;

export const systemClock: Clock = () => BigInt(Date.now()) * NS_PER_MS;

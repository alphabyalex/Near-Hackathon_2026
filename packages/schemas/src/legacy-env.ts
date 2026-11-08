/**
 * Env vars were renamed from REDLINE_* to WARDLINE_* (and VITE_REDLINE_* to VITE_WARDLINE_*).
 * Existing .env files and deploy scripts keep working: the new name is read first, then the old one,
 * with one deprecation warning per process. Values are never printed.
 */

type Env = Record<string, string | undefined>;

const LEGACY = /^(VITE_)?REDLINE_(.+)$/;
const CURRENT = /^(VITE_)?WARDLINE_(.+)$/;

let warned = false;
const legacySeen = new Set<string>();

function warnOnce(names: string[], warn: (message: string) => void): void {
  for (const name of names) legacySeen.add(name);
  if (warned || names.length === 0) return;
  warned = true;
  warn(`Deprecated env var name(s): ${[...legacySeen].sort().join(", ")}. Rename the REDLINE_ prefix to WARDLINE_. The old names stop working in a later release.`);
}

const processEnv = (): Env => (globalThis as { process?: { env?: Env } }).process?.env ?? {};
const defaultWarn = (message: string): void => console.warn(message);

/** The old name for a WARDLINE_ variable, or null if `name` is not one. */
export function legacyEnvName(name: string): string | null {
  const m = CURRENT.exec(name);
  return m ? `${m[1] ?? ""}REDLINE_${m[2]}` : null;
}

/** Reads WARDLINE_X, falling back to REDLINE_X with a one-time warning. */
export function readEnv(name: string, env: Env = processEnv(), warn = defaultWarn): string | undefined {
  if (env[name] !== undefined) return env[name];
  const legacy = legacyEnvName(name);
  if (legacy === null || env[legacy] === undefined) return undefined;
  warnOnce([legacy], warn);
  return env[legacy];
}

/**
 * Copies every REDLINE_X into WARDLINE_X where the new name is unset, so code that reads
 * process.env.WARDLINE_X directly sees the old value. Call once at process start, after any .env
 * file is loaded. Returns the old names it copied.
 */
export function applyLegacyEnv(env: Env = processEnv(), warn = defaultWarn): string[] {
  const copied: string[] = [];
  for (const key of Object.keys(env)) {
    const m = LEGACY.exec(key);
    if (!m) continue;
    const current = `${m[1] ?? ""}WARDLINE_${m[2]}`;
    if (env[current] === undefined) {
      env[current] = env[key];
      copied.push(key);
    }
  }
  warnOnce(copied, warn);
  return copied;
}

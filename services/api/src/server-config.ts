import type { OwnerAuthConfig } from "./auth.js";

export interface ServerConfig {
  port: number;
  host: string;
  /** Set when owner routes get their own port instead of /owner on the main one. */
  ownerPort: number | null;
  ownerHost: string;
}

const LOCALHOST = "127.0.0.1";
const ALL_INTERFACES = "0.0.0.0";

/**
 * Localhost unless REDLINE_BIND_PUBLIC=true (main app) or REDLINE_OWNER_BIND_PUBLIC=true (owner
 * port). Refuses a publicly reachable owner app with auth off or no owner listed.
 */
export function serverConfigFromEnv(env: NodeJS.ProcessEnv, auth: OwnerAuthConfig): ServerConfig {
  const port = Number(env.API_PORT ?? 8787);
  const ownerPort = env.REDLINE_OWNER_PORT ? Number(env.REDLINE_OWNER_PORT) : null;
  const host = env.REDLINE_BIND_PUBLIC === "true" ? ALL_INTERFACES : LOCALHOST;
  const ownerHost = ownerPort === null ? host : env.REDLINE_OWNER_BIND_PUBLIC === "true" ? ALL_INTERFACES : LOCALHOST;
  if (!Number.isInteger(port) || (ownerPort !== null && !Number.isInteger(ownerPort))) throw new Error("API_PORT and REDLINE_OWNER_PORT must be port numbers.");
  if (ownerPort !== null && ownerPort === port) throw new Error("REDLINE_OWNER_PORT must differ from API_PORT.");
  if (ownerHost !== LOCALHOST && !auth.enabled) throw new Error("REDLINE_OWNER_AUTH=off is only allowed while owner routes bind to localhost.");
  if (auth.enabled && auth.owners.size === 0 && auth.approvers.size === 0 && ownerHost !== LOCALHOST) {
    throw new Error("Owner routes are public but REDLINE_OWNER_ACCOUNTS and REDLINE_APPROVER_ACCOUNTS are empty.");
  }
  return { port, host, ownerPort, ownerHost };
}

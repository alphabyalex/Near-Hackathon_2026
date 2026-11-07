import { lookup as dnsLookup } from "node:dns";
import { request } from "node:https";
import { BlockList, type LookupFunction } from "node:net";

const MAX_BYTES = 256 * 1024;
const TIMEOUT_MS = 6_000;

export type WellKnownFetcher = (domain: string, path: string) => Promise<{ status: number; body: Uint8Array }>;

const blocked = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blocked.addSubnet(address, prefix, "ipv4");
}
for (const [address, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["100::", 64],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blocked.addSubnet(address, prefix, "ipv6");
}

/** BlockList also applies the IPv4 rules to IPv4-mapped IPv6 addresses. */
export const isPublicAddress = (address: string, family: number): boolean => !blocked.check(address, family === 6 ? "ipv6" : "ipv4");

/**
 * Resolves the name and refuses private addresses at connect time, so DNS rebinding cannot reach
 * internal services through POST /v1/vendors/verify.
 */
const publicOnlyLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) {
      callback(error, "", 4);
      return;
    }
    const list = addresses as { address: string; family: number }[];
    if (list.length === 0 || !list.every((a) => isPublicAddress(a.address, a.family))) {
      callback(Object.assign(new Error("This domain resolves to a private address."), { code: "EBLOCKED" }), "", 4);
      return;
    }
    if (options.all) {
      callback(null, list);
      return;
    }
    const first = list[0] as { address: string; family: number };
    callback(null, first.address, first.family);
  });
};

/** HTTPS GET of a fixed path on an already-validated domain. No redirects, a size cap and a timeout. */
export const fetchWellKnown: WellKnownFetcher = (domain, path) =>
  new Promise((resolve, reject) => {
    const req = request({ host: domain, path, method: "GET", lookup: publicOnlyLookup, timeout: TIMEOUT_MS, headers: { accept: "application/json" } }, (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BYTES) {
          req.destroy(new Error("The file is too large."));
          return;
        }
        chunks.push(chunk);
      });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: new Uint8Array(Buffer.concat(chunks)) }));
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error("The request timed out.")));
    req.on("error", reject);
    req.end();
  });

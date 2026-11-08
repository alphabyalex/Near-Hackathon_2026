import { createRedline, verifyReceipt, type PayeeRequest, type PayeeResult } from "@redline/sdk";
import { API_BASE } from "../config";

/** The hosted SDK, pointed at this site's API. */
export const redline = createRedline({ mode: "hosted", baseUrl: API_BASE });

export const ATTESTOR_PATH = "/.well-known/redline-attestor.json";

/** The receipt-signing key the API publishes. Fetched fresh, never taken from the receipt itself. */
export async function attestorKey(): Promise<string> {
  const res = await fetch(`${API_BASE}${ATTESTOR_PATH}`);
  if (!res.ok) throw new Error(`The attestor key answered ${res.status}.`);
  const body = (await res.json()) as { public_key?: unknown };
  if (typeof body.public_key !== "string") throw new Error("The attestor file has no public key.");
  return body.public_key;
}

/** Runs the SDK's verifyReceipt in the browser, against the published key and the exact request sent. */
export async function verifyInBrowser(result: PayeeResult, request: PayeeRequest): Promise<{ valid: boolean; key: string }> {
  const key = await attestorKey();
  return { valid: verifyReceipt(result, key, { request }), key };
}

export const errorText = (error: unknown): string => (error instanceof Error ? error.message : "The request failed.");

import { base58 } from "@scure/base";

/** Phantom's injected provider. */
interface PhantomProvider {
  isPhantom?: boolean;
  connect(): Promise<{ publicKey: { toString(): string } }>;
  signMessage(message: Uint8Array, display?: "utf8" | "hex"): Promise<{ signature: Uint8Array }>;
}

declare global {
  interface Window {
    phantom?: { solana?: PhantomProvider };
  }
}

const provider = (): PhantomProvider | null => (typeof window !== "undefined" && window.phantom?.solana?.isPhantom ? window.phantom.solana : null);

export const hasPhantom = (): boolean => provider() !== null;

export async function connectSolana(cluster: string): Promise<{ caip10: string; address: string }> {
  const phantom = provider();
  if (!phantom) throw new Error("Phantom was not found in this browser.");
  const { publicKey } = await phantom.connect();
  const address = publicKey.toString();
  return { caip10: `solana:${cluster}:${address}`, address };
}

/** signMessage over the UTF-8 message. The signature goes in the file as base58. */
export async function signSolana(message: string): Promise<string> {
  const phantom = provider();
  if (!phantom) throw new Error("Phantom was not found in this browser.");
  const { signature } = await phantom.signMessage(new TextEncoder().encode(message), "utf8");
  return base58.encode(signature);
}

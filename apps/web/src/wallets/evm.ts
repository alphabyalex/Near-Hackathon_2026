/** An injected EIP-1193 wallet: MetaMask, Rabby, Coinbase Wallet and the like. */

interface Eip1193 {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

declare global {
  interface Window {
    ethereum?: Eip1193;
  }
}

export const hasEvmWallet = (): boolean => typeof window !== "undefined" && typeof window.ethereum?.request === "function";

const utf8Hex = (text: string): string => `0x${Array.from(new TextEncoder().encode(text), (b) => b.toString(16).padStart(2, "0")).join("")}`;

/** The connected address as CAIP-10, using the chain the wallet is on. */
export async function connectEvm(): Promise<{ caip10: string; address: string }> {
  const eth = window.ethereum;
  if (!eth) throw new Error("No EVM wallet found in this browser.");
  const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
  const address = accounts[0];
  if (!address) throw new Error("The wallet shared no account.");
  const chainId = Number.parseInt(String(await eth.request({ method: "eth_chainId" })), 16);
  if (!Number.isSafeInteger(chainId)) throw new Error("The wallet reported no chain.");
  return { caip10: `eip155:${chainId}:${address.toLowerCase()}`, address };
}

/** EIP-191 personal_sign over the UTF-8 message. */
export async function signEvm(address: string, message: string): Promise<string> {
  const eth = window.ethereum;
  if (!eth) throw new Error("No EVM wallet found in this browser.");
  const signature = await eth.request({ method: "personal_sign", params: [utf8Hex(message), address] });
  if (typeof signature !== "string") throw new Error("The wallet did not return a signature.");
  return signature;
}

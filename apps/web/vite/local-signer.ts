/**
 * The local test signer in the web app: on only in the dev server, bound to 127.0.0.1, on NEAR testnet,
 * with VITE_WARDLINE_LOCAL_SIGNER=1. vite.config.ts refuses to start or build otherwise, and the code
 * that uses it is behind import.meta.env.DEV, so a production build never contains it.
 */
export interface LocalSignerContext {
  flag: string | undefined;
  command: "serve" | "build";
  host: string | boolean | undefined;
  network: string | undefined;
}

/** Throws why the local test signer cannot run here; returns whether it is on. */
export function checkLocalSigner(ctx: LocalSignerContext): boolean {
  if (ctx.flag !== "1") return false;
  if (ctx.command === "build") throw new Error("VITE_WARDLINE_LOCAL_SIGNER=1 is for the local dev server only; unset it to build.");
  if (ctx.host !== "127.0.0.1") throw new Error(`VITE_WARDLINE_LOCAL_SIGNER=1 needs the dev server bound to 127.0.0.1, not ${String(ctx.host)}.`);
  if ((ctx.network ?? "testnet") !== "testnet") throw new Error(`VITE_WARDLINE_LOCAL_SIGNER=1 is for NEAR testnet only, not ${ctx.network}.`);
  return true;
}

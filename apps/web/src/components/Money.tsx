import { createContext, useContext } from "react";
import type { TokenInfo } from "@wardline/schemas";
import { formatAtomic } from "../format";

export const TokenContext = createContext<TokenInfo | null>(null);

/** The dashboard header names the token, so rows show only the number. */
export function Money({ atomic }: { atomic: string }) {
  const token = useContext(TokenContext);
  if (!token) return <span className="num">{atomic} atomic units</span>;
  return <span className="num">{formatAtomic(atomic, token.decimals)}</span>;
}

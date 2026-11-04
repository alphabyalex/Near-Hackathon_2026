import { createContext, useContext } from "react";
import type { TokenInfo } from "@spendgym/schemas";
import { formatAtomic } from "../format";

export const TokenContext = createContext<TokenInfo | null>(null);

/** Every balance carries its token name and network. */
export function Money({ atomic }: { atomic: string }) {
  const token = useContext(TokenContext);
  if (!token) return <span className="money">{atomic} atomic units</span>;
  return (
    <span className="money">
      <span className="money-value">
        {formatAtomic(atomic, token.decimals)} {token.symbol}
      </span>{" "}
      <span className="money-meta">on {token.network}</span>
    </span>
  );
}

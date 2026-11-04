import type { ReactNode } from "react";

/** Dotted underline that becomes a solid red line on hover. */
export function TextLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a className="link" href={href}>
      {children}
    </a>
  );
}

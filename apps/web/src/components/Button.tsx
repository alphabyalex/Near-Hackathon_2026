import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonProps = { href?: string; small?: boolean; children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>;

/** Black square block. A red line draws along the bottom on hover. */
export function Button({ href, small = false, children, ...rest }: ButtonProps) {
  const className = small ? "btn sm" : "btn";
  if (href) {
    return (
      <a className={className} href={href}>
        {children}
      </a>
    );
  }
  return (
    <button type="button" className={className} {...rest}>
      {children}
    </button>
  );
}

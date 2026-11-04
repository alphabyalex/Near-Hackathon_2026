export interface TabItem {
  href: string;
  label: string;
  current: boolean;
}

/** Plain text tabs. The active one has a red underline. */
export function Tabs({ label, items }: { label: string; items: readonly TabItem[] }) {
  return (
    <nav className="tabs" aria-label={label}>
      {items.map((item) => (
        <a key={item.href} href={item.href} {...(item.current ? { "aria-current": "page" as const } : {})}>
          {item.label}
        </a>
      ))}
    </nav>
  );
}

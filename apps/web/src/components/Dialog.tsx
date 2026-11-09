import { useEffect, useId, useRef, type ReactNode } from "react";
import { JOIN } from "../brand";

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** A modal dialog: focus moves in and is trapped, Escape and the backdrop close it, and focus returns to the opener. */
export function Dialog({ title, onClose, children, testId }: { title: string; onClose: () => void; children: ReactNode; testId?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const first = box.current?.querySelector<HTMLElement>("input,select,button:not(.dlg-x)") ?? box.current;
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close.current();
        return;
      }
      if (e.key !== "Tab" || !box.current) return;
      const items = [...box.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (items.length === 0) return;
      const firstItem = items[0]!;
      const lastItem = items[items.length - 1]!;
      if (e.shiftKey && document.activeElement === firstItem) {
        e.preventDefault();
        lastItem.focus();
      } else if (!e.shiftKey && document.activeElement === lastItem) {
        e.preventDefault();
        firstItem.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const hiddenElements: HTMLElement[] = [];
    let current: HTMLElement | null = box.current?.closest(".dlg-back") ?? null;
    while (current && current !== document.body) {
      const parent: HTMLElement | null = current.parentElement;
      if (parent) {
        for (let i = 0; i < parent.children.length; i++) {
          const child = parent.children[i];
          if (child !== current && child instanceof HTMLElement && !child.hasAttribute("aria-hidden")) {
            child.setAttribute("aria-hidden", "true");
            child.setAttribute("inert", "");
            hiddenElements.push(child);
          }
        }
      }
      current = parent;
    }

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      for (const el of hiddenElements) {
        el.removeAttribute("aria-hidden");
        el.removeAttribute("inert");
      }
      opener?.focus?.();
    };
  }, []);

  return (
    <div className="dlg-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dlg" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={box} tabIndex={-1} data-testid={testId}>
        <div className="dlg-head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="dlg-x" onClick={onClose} aria-label={JOIN.close}>
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
              <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

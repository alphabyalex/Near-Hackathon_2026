import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { JOIN } from "../brand";

/**
 * Safari does not focus a button when it is clicked, so remember the last control a pointer pressed:
 * focus returns there when a dialog closes. This listens to presses only, never to movement.
 */
let lastPressed: HTMLElement | null = null;
if (typeof document !== "undefined") {
  const remember = (e: Event) => {
    const hit = (e.target as HTMLElement | null)?.closest?.("button,a[href],input,select,[tabindex]:not([tabindex=\"-1\"])");
    if (hit) lastPressed = hit as HTMLElement;
  };
  document.addEventListener("pointerdown", remember, true);
  document.addEventListener("mousedown", remember, true);
}

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Where an anchored panel sits: just under its button, right edges aligned, never off screen. */
function useAnchor(anchor: HTMLElement | null | undefined): CSSProperties | undefined {
  const [style, setStyle] = useState<CSSProperties>();
  useLayoutEffect(() => {
    if (!anchor) return;
    const place = () => {
      const r = anchor.getBoundingClientRect();
      setStyle({ "--pop-top": `${Math.round(r.bottom + 8)}px`, "--pop-right": `${Math.max(16, Math.round(window.innerWidth - r.right))}px` } as CSSProperties);
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [anchor]);
  return style;
}

/**
 * A modal dialog: focus moves in and is trapped, Escape and the backdrop close it, and focus returns to the opener.
 * It renders on <body>: inside the sticky header (backdrop-filter) a fixed backdrop would be sized to the header.
 * With an anchor it is a panel under that button on wide screens and a bottom sheet on phones.
 */
export function Dialog({ title, onClose, children, testId, anchor }: { title: string; onClose: () => void; children: ReactNode; testId?: string; anchor?: HTMLElement | null | undefined }) {
  const pop = useAnchor(anchor);
  const box = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const active = document.activeElement as HTMLElement | null;
    // In Safari a click focuses the nearest tabindex=-1 container, not the button: prefer the pressed control then.
    const opener = active && active !== document.body && active.getAttribute("tabindex") !== "-1" ? active : (lastPressed ?? active);
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

  return createPortal(
    <div className={anchor ? "dlg-back pop" : "dlg-back"} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={anchor ? "dlg pop" : "dlg"} style={pop} role="dialog" aria-modal="true" aria-labelledby={titleId} ref={box} tabIndex={-1} data-testid={testId}>
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
    </div>,
    document.body,
  );
}

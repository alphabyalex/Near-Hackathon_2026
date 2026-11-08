import { useEffect, useRef, useState } from "react";
import { CONNECT } from "../brand";

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Older browsers and some embedded frames refuse the clipboard API.
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
}

/** Code with a copy button. The label names what is being copied, for screen readers. */
export function CodeBlock({ code, label, language }: { code: string; label: string; language?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);
  const copy = async () => {
    await copyText(code);
    setCopied(true);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1600);
  };
  return (
    <div className="codeblock">
      <div className="cb-bar">
        <span>{language ?? ""}</span>
        <button type="button" className="cb-copy" onClick={() => void copy()} aria-label={`${CONNECT.copy} ${label}`}>
          {copied ? CONNECT.copied : CONNECT.copy}
        </button>
      </div>
      <pre tabIndex={0} aria-label={label}>
        <code>{code}</code>
      </pre>
      <span className="sr-only" role="status">
        {copied ? `${label} ${CONNECT.copied.toLowerCase()}` : ""}
      </span>
    </div>
  );
}

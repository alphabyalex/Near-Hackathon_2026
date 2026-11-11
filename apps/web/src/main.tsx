// First: settings that must be in place before any module parses data.
import "./zod-config";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./theme/tokens.css";
import "./theme/base.css";
import "./theme/site.css";
import "./theme/ai.css";
import "./v2/v2.css";
import { trackInputModality } from "./modality";

trackInputModality();

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Staying connected: once the page is idle, restore the wallet NEAR Connect remembers (no reconnect).
const whenIdle = (fn: () => void) => ("requestIdleCallback" in window ? window.requestIdleCallback(fn, { timeout: 3000 }) : setTimeout(fn, 1200));
try {
  if (window.localStorage.getItem("selected-wallet") || window.localStorage.getItem("wardline.connected")) {
    whenIdle(() => void import("./wallets/near").then((m) => m.restoreNearConnection()));
  }
} catch {
  // Storage blocked: nothing to restore.
}

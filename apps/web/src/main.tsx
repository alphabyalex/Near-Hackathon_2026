// First: settings that must be in place before any module parses data.
import "./zod-config";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./theme/tokens.css";
import "./theme/base.css";
import "./theme/site.css";
import "./theme/ai.css";
import { trackInputModality } from "./modality";

trackInputModality();

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

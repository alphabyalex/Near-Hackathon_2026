/**
 * Text fields match :focus-visible even on a mouse click, so the red ring would show for clicks.
 * This marks the page while the keyboard is in use, and the CSS shows the ring on fields only then.
 */
export function trackInputModality(): void {
  const root = document.documentElement;
  window.addEventListener("keydown", (event) => {
    if (event.key === "Tab" || event.key.startsWith("Arrow")) root.dataset.kbd = "1";
  }, true);
  window.addEventListener("pointerdown", () => delete root.dataset.kbd, true);
}

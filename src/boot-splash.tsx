import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { PaigeCommandMark } from "./components/brand/PaigeCommandMark";
import { mountApplicationLoadFailure } from "./lib/mountApplicationLoadFailure";

export type PaigeBootTheme = "light" | "dark";

export function resolvePaigeBootTheme(
  readStoredTheme: () => string | null = () => localStorage.getItem("theme"),
  prefersDark: () => boolean = () => window.matchMedia("(prefers-color-scheme: dark)").matches,
): PaigeBootTheme {
  let requestedTheme: string | null = null;
  try {
    requestedTheme = readStoredTheme();
  } catch {
    // Storage is optional; the system preference remains available as a fallback.
  }
  if (requestedTheme === "light" || requestedTheme === "dark") return requestedTheme;
  try {
    return prefersDark() ? "dark" : "light";
  } catch {
    // The splash cover is dark, so Obsidian is the safest final fallback.
    return "dark";
  }
}

let splashMarkRoot: Root | null = null;

export function mountPaigeBootSplash(
  host: HTMLElement | null = document.getElementById("paige-splash-mark"),
  theme: PaigeBootTheme = resolvePaigeBootTheme(),
): boolean {
  if (!host || splashMarkRoot) return false;
  host.dataset.theme = theme;
  splashMarkRoot = createRoot(host);
  flushSync(() => {
    splashMarkRoot?.render(<PaigeCommandMark className="psx-command-mark" animated label={null} />);
  });
  return true;
}

export function unmountPaigeBootSplash() {
  splashMarkRoot?.unmount();
  splashMarkRoot = null;
}

// This is a separate Vite entry in index.html, ahead of the full application entry. It paints the
// shared canonical mark while the larger route graph is still loading; booking pages synchronously
// remove the host before this module runs and therefore retain their neutral cover.
mountPaigeBootSplash();
window.addEventListener("paige:boot-splash-unmount", unmountPaigeBootSplash, { once: true });

// Start the full application only after the boot mark has been synchronously painted. Keeping
// this dynamic is what prevents Rollup from making the 1 MB application graph a prerequisite
// for the early mark on production cold loads.
if (document.getElementById("root")) {
  void import("./main.tsx").catch(mountApplicationLoadFailure);
}

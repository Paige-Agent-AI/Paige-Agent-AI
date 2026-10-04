import React from "react";
import { createRoot } from "react-dom/client";
import { HelmetProvider } from "react-helmet-async";
import App from "./App.tsx";
import "./index.css";
import { initObservability } from "./lib/observability";

// Initialize Sentry + PostHog as early as possible (no-ops when env keys missing).
// /render-frame is a machine surface (paige-browser screenshots of draft pages): no visitor to observe,
// and a draft's content must not leave the frame through analytics. Plausible, the one third-party
// script index.html loads, is skipped on the same route by its loader there.
if (!/^\/(?:invoice|render-frame)\/?$/i.test(window.location.pathname)) initObservability();



// ---------------------------------------------------------------------------
// Service worker hygiene
// ---------------------------------------------------------------------------
// We removed the VitePWA / workbox precaching because it was serving stale
// builds to users after we published updates. The push-notification SW
// (/public/sw.js) is registered on demand by usePushNotifications and does
// not cache app assets — but any user who visited the site BEFORE this
// change still has the old workbox service worker installed in their browser
// and will keep seeing the cached old build.
//
// On every load we:
//   1. In preview/iframe contexts: unregister ALL service workers (avoids
//      cached chunk errors in the editor).
//   2. On the live site: unregister any service worker whose script URL is
//      NOT our hand-written /sw.js (i.e. workbox leftovers), and purge all
//      Cache Storage entries that workbox created (their names start with
//      "workbox-", "supabase-cache", or contain "precache").

const isInIframe = (() => {
  try { return window.self !== window.top; } catch { return true; }
})();
const isPreviewHost =
  window.location.hostname.includes("id-preview--") ||
  window.location.hostname.endsWith(".vercel.app");

async function cleanupServiceWorkers() {
  if (!("serviceWorker" in navigator)) return;
  // Tracks whether we removed a stale worker/cache. If we did, this page was
  // very likely served STALE by that old worker — so force one reload to pull
  // the current build. Guarded so it can only happen once per tab.
  let removedStale = false;

  try {
    const regs = await navigator.serviceWorker.getRegistrations();

    for (const reg of regs) {
      const scriptUrl =
        reg.active?.scriptURL ||
        reg.installing?.scriptURL ||
        reg.waiting?.scriptURL ||
        "";

      if (isPreviewHost || isInIframe) {
        // Preview: unregister everything.
        await reg.unregister();
        removedStale = true;
        continue;
      }

      // Live: keep only our hand-written push SW (/sw.js at the root).
      // Anything else (workbox precache, vite-plugin-pwa) gets unregistered.
      const isOurPushSW = /\/sw\.js(\?|$)/.test(scriptUrl);
      if (!isOurPushSW) {
        await reg.unregister();
        removedStale = true;
      }
    }
  } catch (e) {
    // best-effort cleanup; never break app startup
    console.warn("[sw-cleanup] failed:", e);
  }

  // Purge stale Cache Storage entries left behind by workbox.
  try {
    if ("caches" in window) {
      const names = await caches.keys();
      const stale = names.filter(
        (n) => n.startsWith("workbox-") || n.includes("precache") || n === "supabase-cache",
      );
      if (stale.length) removedStale = true;
      await Promise.all(stale.map((n) => caches.delete(n)));
    }
  } catch (e) {
    console.warn("[sw-cleanup] cache purge failed:", e);
  }

  // Force returning visitors off a stale build — exactly once per tab.
  try {
    if (removedStale && !isPreviewHost && !isInIframe && !sessionStorage.getItem("__paige_forced_reload__")) {
      sessionStorage.setItem("__paige_forced_reload__", "1");
      location.reload();
    }
  } catch {
    /* ignore */
  }
}

cleanupServiceWorkers();

// Clear the stale-chunk reload guard once the app successfully boots, so the
// auto-reload recovery can run again on the next deploy.
window.addEventListener("load", () => {
  try { sessionStorage.removeItem("__chunk_reload__"); } catch { /* ignore */ }
});

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <HelmetProvider>
      <App />
      {/*
        Post-hydration marker (Task #126, owner-ruled 2026-08-12). This element exists ONLY in
        the React tree — never in index.html's static no-JS skeleton — so it appears in the DOM
        only after React has mounted. Paige's `verify_deployed_surface` skill waits on
        `[data-app-ready]` (not on `h1`, which the static skeleton also has), so a headless
        self-verify resolves against POST-HYDRATION content and can never read the pre-render
        skeleton by mistake. Keep this attribute name stable and DO NOT add it to index.html;
        the `lint:skeleton` guard enforces the skeleton stays free of product content.
      */}
      <div data-app-ready hidden aria-hidden="true" />
    </HelmetProvider>
  </React.StrictMode>
);

// ---------------------------------------------------------------------------
// Cinematic splash dismissal
// ---------------------------------------------------------------------------
// The splash (#paige-splash in index.html) paints before React boots so there
// is no white flash. Once the app has committed its first frame, hold the
// splash a short beat so it reads as a deliberate open, then fade it out.
function dismissPaigeSplash() {
  const el = document.getElementById("paige-splash");
  if (!el) return;
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  el.classList.add("paige-splash--done");
  if (reducedMotion) {
    window.dispatchEvent(new Event("paige:boot-splash-unmount"));
    el.remove();
    return;
  }
  window.setTimeout(() => {
    window.dispatchEvent(new Event("paige:boot-splash-unmount"));
    el.remove();
  }, 700);
}
const splashHoldMs = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? 0 : 550;
requestAnimationFrame(() =>
  requestAnimationFrame(() => window.setTimeout(dismissPaigeSplash, splashHoldMs)),
);

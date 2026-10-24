import { useCallback, useEffect, useState } from "react";
import { hasUnsavedWork } from "@/hooks/useBeforeUnloadGuard";

export type CustomerUpdateManifest = {
  schemaVersion: 1;
  releaseName: string;
  version: string;
  date: string;
  customerOutcome: string;
  whatChanged: string;
  whoCanUseIt: string;
  ownerAction: string;
  status: Array<"LIVE" | "PARTIAL" | "UNAVAILABLE" | "PROOF OWED">;
  knownLimitations: string;
  safeNextStep: string;
};

type DeployedVersion = {
  buildId: string;
  customerUpdate: CustomerUpdateManifest | null;
};

const POLL_INTERVAL_MS = 4 * 60 * 1000;
const RELOAD_BREADCRUMB_KEY = "__paige_update_reload__";
const RELEASE_BREADCRUMB_KEY = "__paige_customer_update__";
const ALLOWED_STATUSES = new Set(["LIVE", "PARTIAL", "UNAVAILABLE", "PROOF OWED"]);
const TECHNICAL_COPY = /\b(?:commit|sha|deployment(?:\s+id)?|migration|edge\s+function|vercel|supabase|github|provider(?:\s+name|\s+id)?|dpl_[a-z0-9_-]+)\b|\b[0-9a-f]{40}\b/i;

function isText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function parseCustomerUpdate(value: unknown): CustomerUpdateManifest | null {
  if (!value || typeof value !== "object") return null;
  const update = value as Record<string, unknown>;
  const fields = ["releaseName", "version", "date", "customerOutcome", "whatChanged", "whoCanUseIt", "ownerAction", "knownLimitations", "safeNextStep"];
  if (update.schemaVersion !== 1 || fields.some((field) => !isText(update[field]))) return null;
  if (fields.some((field) => TECHNICAL_COPY.test(String(update[field])))) return null;
  if (!Array.isArray(update.status) || update.status.length === 0 || update.status.some((status) => typeof status !== "string" || !ALLOWED_STATUSES.has(status))) return null;
  return update as CustomerUpdateManifest;
}

async function fetchDeployedVersion(signal?: AbortSignal): Promise<DeployedVersion | null> {
  try {
    const response = await fetch(`/version.json?t=${Date.now()}`, { cache: "no-store", signal });
    if (!response.ok) return null;
    const json = (await response.json()) as Record<string, unknown>;
    const buildId = typeof json.buildId === "string" ? json.buildId.trim() : "";
    if (!buildId) return null;
    return { buildId, customerUpdate: parseCustomerUpdate(json.customerUpdate) };
  } catch {
    return null;
  }
}

export function canReloadWithoutLosingWork(): boolean {
  return !hasUnsavedWork();
}

export function usePlatformUpdate(): {
  updateAvailable: boolean;
  customerUpdate: CustomerUpdateManifest | null;
  recentRelease: CustomerUpdateManifest | null;
  reload: () => boolean;
  dismiss: () => void;
} {
  const [detected, setDetected] = useState<DeployedVersion | null>(null);
  const [dismissedId, setDismissedId] = useState<string | null>(null);
  const [recentRelease, setRecentRelease] = useState<CustomerUpdateManifest | null>(null);
  const ownBuildId = typeof __BUILD_ID__ !== "undefined" ? __BUILD_ID__ : "";
  const updateAvailable = !!detected && detected.buildId !== ownBuildId && detected.buildId !== dismissedId;

  useEffect(() => {
    if (!import.meta.env.PROD) return;
    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | undefined;
    const controllers = new Set<AbortController>();

    const check = async () => {
      if (!ownBuildId || (typeof document !== "undefined" && document.hidden)) return;
      const controller = new AbortController();
      controllers.add(controller);
      const deployed = await fetchDeployedVersion(controller.signal);
      controllers.delete(controller);
      if (cancelled || !deployed) return;
      if (deployed.buildId === ownBuildId) {
        try {
          const pending = parseCustomerUpdate(JSON.parse(sessionStorage.getItem(RELEASE_BREADCRUMB_KEY) || "null"));
          if (pending && deployed.customerUpdate && pending.version === deployed.customerUpdate.version && pending.date === deployed.customerUpdate.date) {
            setRecentRelease(deployed.customerUpdate);
          }
          sessionStorage.removeItem(RELEASE_BREADCRUMB_KEY);
        } catch {
          sessionStorage.removeItem(RELEASE_BREADCRUMB_KEY);
        }
      } else {
        setDetected((current) => current?.buildId === deployed.buildId ? current : deployed);
      }
    };

    const start = () => {
      if (intervalId === undefined) intervalId = setInterval(check, POLL_INTERVAL_MS);
    };
    const stop = () => {
      if (intervalId !== undefined) clearInterval(intervalId);
      intervalId = undefined;
    };
    const onVisibility = () => document.hidden ? stop() : (start(), void check());
    const onFocus = () => void check();
    // A long-lived tab may lose a lazy screen after a release. Recheck the same
    // version source and offer the existing explicit, unsaved-work-safe reload.
    // Do not suppress the import error, invent a build, or reload automatically.
    const onPreloadError = () => {
      setDismissedId(null);
      void check();
    };
    let serviceWorker: ServiceWorkerContainer | undefined;
    const hadController = typeof navigator !== "undefined" && "serviceWorker" in navigator && !!navigator.serviceWorker.controller;
    const onControllerChange = () => {
      if (!cancelled && hadController) setDetected({ buildId: `sw:${Date.now()}`, customerUpdate: null });
    };
    if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
      serviceWorker = navigator.serviceWorker;
      serviceWorker.addEventListener("controllerchange", onControllerChange);
    }

    void check();
    start();
    window.addEventListener("focus", onFocus);
    window.addEventListener("vite:preloadError", onPreloadError);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      stop();
      controllers.forEach((controller) => controller.abort());
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("vite:preloadError", onPreloadError);
      document.removeEventListener("visibilitychange", onVisibility);
      serviceWorker?.removeEventListener("controllerchange", onControllerChange);
    };
  }, [ownBuildId]);

  const dismiss = useCallback(() => {
    if (updateAvailable) setDismissedId(detected?.buildId ?? null);
    setRecentRelease(null);
  }, [detected?.buildId, updateAvailable]);

  const reload = useCallback(() => {
    if (!updateAvailable || !canReloadWithoutLosingWork()) return false;
    try {
      const last = Number(sessionStorage.getItem(RELOAD_BREADCRUMB_KEY));
      if (last && Date.now() - last < 10_000) return false;
      sessionStorage.setItem(RELOAD_BREADCRUMB_KEY, String(Date.now()));
      if (detected?.customerUpdate) sessionStorage.setItem(RELEASE_BREADCRUMB_KEY, JSON.stringify(detected.customerUpdate));
      else sessionStorage.removeItem(RELEASE_BREADCRUMB_KEY);
    } catch {
      /* Storage is optional; the explicit user action may still proceed. */
    }
    const doReload = () => window.location.reload();
    if (typeof caches !== "undefined") {
      caches.keys().then((names) => Promise.all(names.map((name) => caches.delete(name)))).catch(() => undefined).finally(doReload);
    } else {
      doReload();
    }
    return true;
  }, [detected?.customerUpdate, updateAvailable]);

  return {
    updateAvailable,
    customerUpdate: updateAvailable ? detected?.customerUpdate ?? null : null,
    recentRelease,
    reload,
    dismiss,
  };
}

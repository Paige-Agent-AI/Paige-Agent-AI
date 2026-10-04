import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// /render-frame shows unpublished drafts to paige-browser. A draft's content must not leave the frame
// through Sentry/PostHog, and there is no visitor to observe — the bootstrap skips telemetry, the
// same way it does for the bearer /invoice route.
const telemetry = vi.hoisted(() => ({ sentry: vi.fn(), posthog: vi.fn(), render: vi.fn() }));
vi.mock("@sentry/react", () => ({ init: telemetry.sentry }));
vi.mock("posthog-js", () => ({ default: { init: telemetry.posthog } }));
vi.mock("react-dom/client", () => ({ createRoot: () => ({ render: telemetry.render }) }));
vi.mock("../App.tsx", () => ({ default: () => null }));
vi.mock("react-helmet-async", () => ({ HelmetProvider: () => null }));

describe("render-frame bootstrap", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv("VITE_SENTRY_DSN", "https://example.test/1");
    vi.stubEnv("VITE_POSTHOG_KEY", "configured-fixture-key");
    vi.stubGlobal("requestAnimationFrame", vi.fn());
    document.body.innerHTML = '<div id="root"></div>';
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    window.history.replaceState(null, "", "/");
  });

  it.each(["/render-frame", "/render-frame/", "/RENDER-FRAME"])("never initializes telemetry on %s", async (path) => {
    window.history.replaceState(null, "", path);
    await import("../main.tsx");
    expect(telemetry.render).toHaveBeenCalledOnce();
    expect(telemetry.sentry).not.toHaveBeenCalled();
    expect(telemetry.posthog).not.toHaveBeenCalled();
  });

  it("does not widen the exemption to look-alike paths", async () => {
    window.history.replaceState(null, "", "/render-frame-x");
    await import("../main.tsx");
    expect(telemetry.sentry).toHaveBeenCalledOnce();
  });
});

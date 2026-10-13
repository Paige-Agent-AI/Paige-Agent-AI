import { afterEach, describe, expect, it, vi } from "vitest";

const posthogInit = vi.fn();
const sentryInit = vi.fn();
vi.mock("posthog-js", () => ({ default: { init: posthogInit, identify: vi.fn(), reset: vi.fn() } }));
vi.mock("@sentry/react", () => ({ init: sentryInit, setUser: vi.fn() }));

// initObservability runs once per page, so each case loads a fresh module.
async function load() {
  vi.resetModules();
  return import("./observability");
}

describe("initObservability", () => {
  afterEach(() => { vi.unstubAllEnvs(); posthogInit.mockClear(); sentryInit.mockClear(); });

  it("starts product analytics and error reporting on Paige's own pages", async () => {
    vi.stubEnv("VITE_POSTHOG_KEY", "phc_test");
    vi.stubEnv("VITE_SENTRY_DSN", "https://key@example.invalid/1");
    (await load()).initObservability();
    expect(posthogInit).toHaveBeenCalledTimes(1);
    expect(sentryInit).toHaveBeenCalledTimes(1);
  });

  it("keeps product analytics off, error reporting on, for a form on a business's own website", async () => {
    vi.stubEnv("VITE_POSTHOG_KEY", "phc_test");
    vi.stubEnv("VITE_SENTRY_DSN", "https://key@example.invalid/1");
    (await load()).initObservability({ productAnalytics: false });
    expect(posthogInit).not.toHaveBeenCalled();
    expect(sentryInit).toHaveBeenCalledTimes(1);
  });
});

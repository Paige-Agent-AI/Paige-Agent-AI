import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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

// The Plausible loader is inline in index.html (it runs before any app code). Run that exact script
// text and see whether it adds a plausible.io script — the draft payload must never sit beside one.
describe("index.html Plausible loader", () => {
  const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8");
  const loader = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).find((js) => js.includes("plausible.io/js/script.js"));
  const plausibleTags = () => [...document.head.querySelectorAll("script[src]")].filter((s) => (s as HTMLScriptElement).src.includes("plausible.io"));
  afterEach(() => {
    plausibleTags().forEach((s) => s.remove());
    window.history.replaceState(null, "", "/");
  });

  it("is the only way Plausible loads — no static plausible.io tag remains", () => {
    expect(loader).toBeTruthy();
    expect(html).not.toMatch(/<script[^>]*src="https:\/\/plausible\.io/);
  });

  it.each(["/render-frame", "/render-frame/", "/RENDER-FRAME", "/render-frame/anything"])("adds no Plausible script on %s", (path) => {
    window.history.replaceState(null, "", path);
    new Function(loader!)();
    expect(plausibleTags()).toEqual([]);
  });

  it.each(["/", "/p/northwind/home", "/render-frame-x"])("still loads Plausible on %s", (path) => {
    window.history.replaceState(null, "", path);
    new Function(loader!)();
    const tags = plausibleTags() as HTMLScriptElement[];
    expect(tags.map((t) => t.src)).toEqual(["https://plausible.io/js/script.js", "https://plausible.io/js/pa-6X7R-SykdBdjPO8QpOaQD.js"]);
    expect(tags[0].getAttribute("data-domain")).toBe("paigeagent.ai");
  });
});

/**
 * PR9 — a failed screen download costs exactly one screen.
 *
 * The owner-ordered recovery contract: Chat and navigation survive any lazy
 * screen's failed download, and the person gets useful recovery (Try again for a
 * fresh import attempt; Reload for a browser that cached the rejection). And the
 * layering rule: a DOWNLOAD failure belongs to this boundary; a RENDER error
 * inside an already-loaded screen still belongs to the shell's existing
 * SoloScreenBoundary ("Page unavailable") — this boundary must not eat it.
 */
import { act, Component } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScreenLoadBoundary } from "./SoloApp";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });

const render = async (node: React.ReactNode) => { await act(async () => { root.render(node); }); };
const buttons = () => Array.from(host.querySelectorAll("button")).map((b) => b.textContent?.trim());

describe("ScreenLoadBoundary (PR9 failed-download recovery)", () => {
  it("a chunk-download failure shows honest recovery with Try again and Reload, and recovers on retry", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const boom = () => { throw new TypeError("Failed to fetch dynamically imported module: settings-abc.js"); };
    // Fails on first render, healthy on the second — the retry path a transient
    // download failure takes.
    let fail = true;
    const Screen = () => { if (fail) boom(); return <p data-loaded>Loaded settings</p>; };
    await render(<ScreenLoadBoundary resetKey="/x"><Screen /></ScreenLoadBoundary>);
    expect(host.textContent).toContain("This view could not open.");
    expect(host.textContent).toContain("PAIGE, Chat and navigation still work");
    expect(buttons()).toEqual(["Try again", "Reload PAIGE"]);
    expect(errorSpy).toHaveBeenCalled();

    fail = false;
    await act(async () => { host.querySelectorAll("button")[0].click(); });
    expect(host.querySelector("[data-loaded]")?.textContent).toBe("Loaded settings");
  });

  it("a render error inside a loaded screen is NOT mislabeled a download failure — it propagates to the shell boundary", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    // Outer boundary stands in for SoloScreenBoundary and MUST WRAP
    // ScreenLoadBoundary — with the nesting inverted (outer as the child), the
    // closest-boundary rule would hand the error to the stand-in directly and the
    // test would pass even with ScreenLoadBoundary deleted (round-2 review catch).
    class Outer extends Component<{ children?: React.ReactNode }, { caught: unknown }> {
      state: { caught: unknown } = { caught: null };
      static getDerivedStateFromError(error: unknown) { return { caught: error }; }
      render() { return this.state.caught ? <p data-outer-boundary>outer boundary</p> : this.props.children; }
    }
    const Screen = () => { throw new Error("a render bug inside a loaded screen"); };
    await render(
      <Outer>
        <ScreenLoadBoundary resetKey="/x"><Screen /></ScreenLoadBoundary>
      </Outer>,
    );
    expect(host.querySelector("[data-outer-boundary]")).toBeTruthy();
    expect(host.textContent).not.toContain("This view could not open.");
    expect(host.textContent).not.toContain("Reload PAIGE");
  });

  it("Reload PAIGE reloads the app (the cached-rejection remedy)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });
    const Screen = () => { throw new TypeError("Importing a module script failed."); };
    await render(<ScreenLoadBoundary resetKey="/x"><Screen /></ScreenLoadBoundary>);
    await act(async () => { Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "Reload PAIGE")!.click(); });
    expect(reload).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  it("a failed screen resets when navigation changes the resetKey", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    let fail = true;
    const Screen = () => { if (fail) throw new TypeError("error loading dynamically imported module"); return <p data-loaded>ok</p>; };
    const App = ({ path }: { path: string }) => (
      <ScreenLoadBoundary resetKey={path}><Screen /></ScreenLoadBoundary>
    );
    await render(<App path="/a" />);
    expect(host.textContent).toContain("This view could not open.");
    fail = false;
    // Navigating to another screen (and back) is itself a retry path.
    await render(<App path="/b" />);
    await render(<App path="/a" />);
    expect(host.querySelector("[data-loaded]")).toBeTruthy();
  });
});

  // EXP04 finding b0d8f65d (2026-10-28): after a deployment retires the old
  // hashed asset, "Try again" re-attempts the SAME cached-dead URL and fails —
  // the person must be moved to the recovery that actually works. First failure
  // keeps both actions (may be transient); a FAILED Try again switches the card
  // to the stale-deployment truth with Reload as the only/primary action and the
  // honest draft-survives-reload note.
  it("a failed Try again converts the card to the stale-deployment recovery (EXP04 sequence)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    let fail = true;
    const Screen = () => { if (fail) throw new TypeError("Failed to fetch dynamically imported module: clients-dead.js"); return <p data-loaded>ok</p>; };
    const App = ({ path }: { path: string }) => (
      <ScreenLoadBoundary resetKey={path}><Screen /></ScreenLoadBoundary>
    );
    await render(<App path="/a" />);
    // First failure: both actions, original honest copy.
    expect(host.textContent).toContain("This view could not open.");
    expect(buttons()).toEqual(["Try again", "Reload PAIGE"]);

    // Try again → the module cache still points at the dead URL → fails again.
    await act(async () => { host.querySelectorAll("button")[0].click(); });
    expect(host.textContent).toContain("PAIGE has been updated.");
    expect(host.textContent).toContain("Reload to continue");
    expect(host.textContent).toContain("unsent PAIGE message is kept");
    // Try again is GONE — reload is the one recovery that works for a stale asset.
    expect(buttons()).toEqual(["Reload PAIGE"]);

    // Recovery via reload is the primary action; navigation reset still restores.
    fail = false;
    await render(<App path="/b" />);
    await render(<App path="/a" />);
    expect(host.querySelector("[data-loaded]")).toBeTruthy();
  });

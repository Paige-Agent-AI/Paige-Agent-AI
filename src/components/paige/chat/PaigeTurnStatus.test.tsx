// C3a — the status line on a PAIGE answer: disclosure semantics, the 8-row fold, motion fallbacks,
// one announcement per change of state, and the token discipline (no gold anywhere on this watch
// surface — gold is spent on the act alone, §11).
import { act } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PaigeTurnFooter, PaigeTurnStatus } from "./PaigeTurnStatus";
import type { TurnRow, TurnView } from "@/lib/paige-stream";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLElement;
let root: Root;
let reduce = false;
let phone = false;
beforeEach(() => {
  reduce = false;
  phone = false;
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: q.includes("prefers-reduced-motion") ? reduce : q.includes("max-width: 639px") ? phone : false,
    media: q, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {},
  }));
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const rows = (n: number, last: TurnRow["status"] = "done"): TurnRow[] =>
  Array.from({ length: n }, (_, i) => ({ id: `r${i}`, label: `Step ${i + 1}`, group: "owner" as const, status: i === n - 1 ? last : "done" }));
const view = (over: Partial<TurnView> = {}): TurnView => ({
  kind: "done", glyph: "check", text: "What PAIGE did · 3 steps", elapsed: 14_000, steps: null,
  rows: rows(3), footer: null, announce: "Done", ...over,
});
const render = async (el: JSX.Element) => { await act(async () => { root.render(el); }); };
const line = () => host.querySelector<HTMLElement>("[data-paige-turn-line]")!;
const toggle = () => host.querySelector<HTMLButtonElement>("[data-paige-turn-line] button[aria-controls]")!;

describe("PaigeTurnStatus", () => {
  it("is a real disclosure: aria-expanded/aria-controls, Enter and Space toggle", async () => {
    await render(<PaigeTurnStatus view={view()} idBase="m1" />);
    const btn = toggle();
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    const panel = document.getElementById(btn.getAttribute("aria-controls")!)!;
    expect(panel).not.toBeNull();
    await act(async () => { btn.click(); });
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    // A native <button> turns Enter and Space into a click; prove it is one.
    expect(btn.tagName).toBe("BUTTON");
    expect(btn.getAttribute("type")).toBe("button");
    expect(line().textContent).toContain("What PAIGE did · 3 steps");
    expect(line().textContent).toContain("14s");
  });

  it("folds after 8 rows, then shows them all on request", async () => {
    await render(<PaigeTurnStatus view={view({ rows: rows(11), text: "Reached the limit for one answer", kind: "warn", glyph: "triangle" })} idBase="m2" defaultOpen />);
    expect(host.querySelectorAll("[data-paige-turn-step]")).toHaveLength(8);
    const more = Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "Show all 11 steps")!;
    await act(async () => { more.click(); });
    expect(host.querySelectorAll("[data-paige-turn-step]")).toHaveLength(11);
  });

  it("never folds to hide a single row: 9 rows show in full, 10 fold to 8", async () => {
    await render(<PaigeTurnStatus view={view({ rows: rows(9) })} idBase="m2b" defaultOpen />);
    expect(host.querySelectorAll("[data-paige-turn-step]")).toHaveLength(9);
    expect(Array.from(host.querySelectorAll("button")).some((b) => /^Show all/.test(b.textContent ?? ""))).toBe(false);
    await render(<PaigeTurnStatus view={view({ rows: rows(10) })} idBase="m2b" defaultOpen />);
    expect(host.querySelectorAll("[data-paige-turn-step]")).toHaveLength(8);
    expect(Array.from(host.querySelectorAll("button")).some((b) => b.textContent === "Show all 10 steps")).toBe(true);
  });

  it("tells its host before the trace grows, so the transcript can hold the line in view", async () => {
    const onTraceToggle = vi.fn();
    await render(<PaigeTurnStatus view={view()} idBase="m2c" onTraceToggle={onTraceToggle} />);
    await act(async () => { toggle().click(); });
    expect(onTraceToggle).toHaveBeenCalledTimes(1);
    expect(onTraceToggle.mock.calls[0][0]).toBe(line());
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
  });

  it("on a phone the trace is a sheet in the shell's theme, and the button points at nothing absent", async () => {
    phone = true;
    const shell = document.createElement("div");
    shell.setAttribute("data-pg", "dark");
    host.remove();
    shell.appendChild(host);
    document.body.appendChild(shell);
    await render(<PaigeTurnStatus view={view()} idBase="m2d" />);
    const btn = host.querySelector<HTMLButtonElement>("[data-paige-turn-line] button")!;
    expect(btn.getAttribute("aria-haspopup")).toBe("dialog");
    expect(btn.hasAttribute("aria-controls")).toBe(false);
    await act(async () => { btn.click(); });
    await act(async () => { await Promise.resolve(); });
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(shell.contains(dialog)).toBe(false);
    expect(dialog.getAttribute("data-pg")).toBe("dark");
    expect(dialog.querySelectorAll("[data-paige-turn-step]")).toHaveLength(3);
    await act(async () => root.unmount());
    root = createRoot(host);
    shell.remove();
    document.body.appendChild(host);
  });

  it("a line with no steps is plain text, not a button", async () => {
    await render(<PaigeTurnStatus view={view({ rows: [], kind: "held", glyph: "lock", text: "Held back after a final check", elapsed: null })} idBase="m3" />);
    expect(toggle()).toBeNull();
    expect(line().textContent).toContain("Held back after a final check");
  });

  it("working lines sweep; under reduced motion there is no sweep and no ticking seconds", async () => {
    vi.useFakeTimers();
    const live = view({ kind: "work", glyph: "dot", text: "Reviewing your pipeline", elapsed: "live", steps: 2, rows: rows(2, "running") });
    await render(<PaigeTurnStatus view={live} idBase="m4" startedAt={Date.now() - 7_000} />);
    expect(line().dataset.motion).toBe("full");
    expect(line().querySelector("[data-sweep]")).not.toBeNull();
    expect(line().textContent).toContain("7s · 2 steps");
    await act(async () => { vi.advanceTimersByTime(2_000); });
    expect(line().textContent).toContain("9s · 2 steps");

    await act(async () => root.unmount());
    root = createRoot(host);
    reduce = true;
    await render(<PaigeTurnStatus view={live} idBase="m4" startedAt={Date.now() - 7_000} />);
    expect(line().dataset.motion).toBe("reduce");
    expect(line().querySelector("[data-sweep]")).toBeNull();
    expect(line().textContent).not.toMatch(/\d+s/);
    expect(line().textContent).toContain("2 steps");
  });

  it("with a shared clock it keeps no clock of its own", async () => {
    vi.useFakeTimers();
    const live = view({ kind: "work", glyph: "dot", text: "Reviewing your pipeline", elapsed: "live", steps: 2, rows: rows(2, "running") });
    const start = Date.now();
    const spy = vi.spyOn(window, "setInterval");
    await render(<PaigeTurnStatus view={live} idBase="m4b" startedAt={start} now={start + 3_000} />);
    expect(spy).not.toHaveBeenCalled();
    expect(line().textContent).toContain("3s · 2 steps");
    await act(async () => { vi.advanceTimersByTime(5_000); });
    expect(line().textContent).toContain("3s · 2 steps");
    spy.mockRestore();
  });

  it("announces once per change of state — never per step, never per second", async () => {
    vi.useFakeTimers();
    const say = () => host.querySelector('[data-paige-turn-announcer]')?.textContent ?? "";
    const working = (label: string, n: number) => view({ kind: "work", glyph: "dot", text: label, elapsed: "live", rows: rows(n, "running"), announce: "PAIGE is working" });
    await render(<PaigeTurnStatus view={working("Looking", 1)} idBase="m5" startedAt={Date.now()} announce />);
    await act(async () => { vi.advanceTimersByTime(50); });
    expect(say()).toBe("PAIGE is working");
    await render(<PaigeTurnStatus view={working("Reviewing", 2)} idBase="m5" startedAt={Date.now()} announce />);
    // A new step is not a new state: the region is not cleared and re-spoken.
    expect(say()).toBe("PAIGE is working");
    await act(async () => { vi.advanceTimersByTime(3_000); });
    expect(say()).toBe("PAIGE is working");
    await render(<PaigeTurnStatus view={view({ announce: "Done" })} idBase="m5" announce />);
    await act(async () => { vi.advanceTimersByTime(50); });
    expect(say()).toBe("Done");
    // An answer that is not the live one never speaks.
    await act(async () => root.unmount());
    root = createRoot(host);
    await render(<PaigeTurnStatus view={view()} idBase="m6" />);
    expect(host.querySelector('[data-paige-turn-announcer]')).toBeNull();
  });

  it("the footer offers what exists and focuses itself after Stop", async () => {
    const onAskAgain = vi.fn();
    const onSee = vi.fn();
    await render(
      <PaigeTurnFooter
        footer={{ text: "Stopped showing this answer. PAIGE may still finish work that had already started.", actions: ["see", "askAgain"] }}
        onAskAgain={onAskAgain}
        onSee={onSee}
        focusOnMount
      />,
    );
    const foot = host.querySelector<HTMLElement>("[data-paige-turn-footer]")!;
    expect(document.activeElement).toBe(foot);
    const labels = Array.from(foot.querySelectorAll("button")).map((b) => b.textContent);
    expect(labels).toEqual(["See what finished", "Ask again"]);
    await act(async () => { foot.querySelectorAll("button")[1].click(); });
    expect(onAskAgain).toHaveBeenCalledTimes(1);
  });

  it("spends no gold: every colour is a theme token, and warnings are ink plus a triangle", () => {
    const tsx = readFileSync(resolve(process.cwd(), "src/components/paige/chat/PaigeTurnStatus.tsx"), "utf8");
    const css = readFileSync(resolve(process.cwd(), "src/components/paige/chat/paige-turn-status.css"), "utf8");
    const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const src of [code(tsx), code(css)]) {
      expect(src).not.toMatch(/gold|--accent\b|--warning|#[0-9a-f]{3,8}\b|rgba?\(/i);
    }
    expect(css).toMatch(/--primary/);
    expect(css).toMatch(/--success/);
    expect(css).toMatch(/--destructive/);
    expect(css).toMatch(/prefers-reduced-motion|data-motion="reduce"/);
  });
});

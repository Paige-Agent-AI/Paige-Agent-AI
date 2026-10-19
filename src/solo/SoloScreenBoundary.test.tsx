import React, { act, lazy, Suspense, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SoloScreenBoundary } from "./SoloScreenBoundary";
import { useBeforeUnloadGuard, hasUnsavedWork } from "@/hooks/useBeforeUnloadGuard";

describe("SOLO departmental render recovery", () => {
  function Paige() {
    const [draft, setDraft] = useState("Protected local draft");
    useBeforeUnloadGuard(Boolean(draft));
    return <aside aria-label="PAIGE"><input aria-label="Draft" value={draft} onChange={e => setDraft(e.target.value)} /></aside>;
  }
  let root: Root | null = null;
  let host: HTMLDivElement | null = null;
  afterEach(() => {
    if (root) act(() => root?.unmount());
    host?.remove(); root = null; host = null;
    vi.restoreAllMocks();
  });
  const mount = async (screen: React.ReactNode, epoch = "test-actor:test-tenant-a:/clients/conversations", resetKey?: string) => {
    if (!host) { host = document.createElement("div"); document.body.append(host); root = createRoot(host); }
    // Stable sibling type, just as SoloApp renders PAIGE outside the screen host.
    await act(async () => root?.render(<><nav>Existing navigation</nav><main><SoloScreenBoundary key={epoch} resetKey={resetKey}><Suspense fallback="Opening page">{screen}</Suspense></SoloScreenBoundary></main><Paige /><div aria-label="Application update">Existing update surface</div></>));
    return { host: host! };
  };

  it("contains a real rejected lazy import and retains navigation, PAIGE and unsaved work", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    let reject!: (error: Error) => void;
    const Failed = lazy(() => new Promise<{ default: React.ComponentType }>((_resolve, decline) => { reject = decline; }));
    const { host } = await mount(<Failed />);
    expect(host.textContent).toContain("Opening page");
    const editor = host.querySelector("input");
    const beforeUnload = vi.fn(); window.addEventListener("beforeunload", beforeUnload);
    try {
      await act(async () => reject(new TypeError("Failed to fetch dynamically imported module: https://example.test/assets/private-screen.js")));
      expect(host.querySelector("[role=alert]")?.textContent).toContain("This page couldn’t open");
      expect(host.querySelector("nav")?.textContent).toBe("Existing navigation");
      expect(host.querySelector("input")).toBe(editor);
      expect(editor?.value).toBe("Protected local draft");
      expect(hasUnsavedWork()).toBe(true);
      expect(host.querySelector('[aria-label="Application update"]')).not.toBeNull();
      expect(host.textContent).not.toMatch(/private-screen|example\.test|TypeError/);
      expect(host.querySelector("button")).toBeNull();
      expect(beforeUnload).not.toHaveBeenCalled();
    } finally { window.removeEventListener("beforeunload", beforeUnload); }
  });

  it.each(["test-actor:test-tenant-a:/operations", "other-actor:test-tenant-b:/clients/conversations"])("resets failed screen state on the explicit route or identity epoch %s", async epoch => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    function Failed(): React.ReactNode { throw new Error("Private failed content"); }
    await mount(<Failed />);
    expect(host?.querySelector("[role=alert]")).not.toBeNull();
    await mount(<p>Current scoped page</p>, epoch);
    expect(host?.querySelector("[role=alert]")).toBeNull();
    expect(host?.textContent).toContain("Current scoped page");
    expect(host?.textContent).not.toContain("Private failed content");
  });

  it("leaves a successful screen and its native controls intact", async () => {
    const save = vi.fn();
    const { host } = await mount(<button onClick={save}>Native page control</button>);
    expect(host.querySelector("[role=alert]")).toBeNull();
    act(() => host.querySelector("button")?.click());
    expect(save).toHaveBeenCalledOnce();
  });

  it("retains a healthy native subtree and input when only the reset path changes", async () => {
    function Native() { return <input aria-label="Native detail" defaultValue="Original" />; }
    await mount(<Native />, "actor:tenant:operations", "/operations/work");
    const input = host!.querySelector<HTMLInputElement>('[aria-label="Native detail"]')!;
    input.value = "Unsaved native value"; input.focus();
    await mount(<Native />, "actor:tenant:operations", "/operations/capacity");
    expect(host!.querySelector('[aria-label="Native detail"]')).toBe(input);
    expect(input.value).toBe("Unsaved native value"); expect(document.activeElement).toBe(input);
  });

  it("recovers a failed stable boundary on a new reset path without exposing the private error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    function Failed(): React.ReactNode { throw new Error("Private native failure"); }
    await mount(<Failed />, "actor:tenant:operations", "/operations/work");
    expect(host!.querySelector('[role="alert"]')).toBeTruthy();
    await mount(<p>Current native view</p>, "actor:tenant:operations", "/operations/capacity");
    expect(host!.querySelector('[role="alert"]')).toBeNull(); expect(host!.textContent).toContain("Current native view");
    expect(host!.textContent).not.toContain("Private native failure");
  });
});

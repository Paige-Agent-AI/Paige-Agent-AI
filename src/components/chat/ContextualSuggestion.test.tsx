// @vitest-environment jsdom
import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ContextualSuggestion } from "./ContextualSuggestion";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "light" }) }));
let host: HTMLDivElement, root: Root, wide: boolean, change: (() => void) | null;
let page = false;
const closeFallback = vi.fn();
beforeEach(() => {
  closeFallback.mockClear();
  wide = true; change = null; page = false;
  vi.stubGlobal("matchMedia", () => ({ get matches() { return wide; }, addEventListener: (_: string, fn: () => void) => { change = fn; }, removeEventListener: () => { change = null; } }));
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
function Probe() {
  const [open, setOpen] = useState(false);
  return <ContextualSuggestion open={open} onOpenChange={setOpen} sidePanel={!page} trigger={<button type="button">Inspect recorded work</button>} title="Work awaiting review" description="Choose an original source to inspect." onCloseAutoFocus={closeFallback}><button type="button">Read original item</button></ContextualSuggestion>;
}
function render() { act(() => root.render(<Probe />)); }
function open() { const trigger = host.querySelector("button")!; trigger.focus(); act(() => trigger.click()); }
it("stays compact until explicitly opened and supplies readable labelled wide content", () => {
  render(); expect(document.querySelector('[role="dialog"]')).toBeNull(); open();
  const panel = document.querySelector('[role="dialog"]')!;
  expect(panel.classList.contains('csu-sheet')).toBe(false);
  expect(panel.textContent).toContain("Work awaiting review");
  expect(panel.textContent).toContain("Read original item");
  expect(panel.getAttribute('aria-labelledby')).toBeTruthy();
  expect(panel.getAttribute('data-pg')).toBe('light');
});
it("uses the existing shared Dialog on a narrow viewport", () => {
  wide = false; render(); open();
  expect(document.querySelector('[role="dialog"]')?.classList.contains('csu-sheet')).toBe(true);
});
it("uses a readable Dialog for a full-page consumer even on wide screens", () => {
  page = true; render(); open();
  expect(document.querySelector('[role="dialog"]')?.classList.contains('csu-sheet')).toBe(true);
});
it("keeps one open overview when the original responsive boundary changes", () => {
  render(); open(); wide = false; act(() => change?.());
  expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  expect(document.querySelector('[role="dialog"]')?.classList.contains('csu-sheet')).toBe(true);
  expect(document.body.textContent).toContain("Read original item");
});
it("closes through its explicit wide close control without invoking its source content", () => {
  render(); open(); const close = document.querySelector('[aria-label="Close suggestions"]') as HTMLButtonElement;
  act(() => close.click()); expect(document.querySelector('[role="dialog"]')).toBeNull();
});
it("honours the caller's focus fallback when the open presentation itself retires", async () => {
  render(); open();
  await act(async () => { await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); });
  closeFallback.mockClear();
  act(() => root.render(<button type="button">Other context</button>));
  await act(async () => { await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); });
  expect(closeFallback).toHaveBeenCalledOnce();
});

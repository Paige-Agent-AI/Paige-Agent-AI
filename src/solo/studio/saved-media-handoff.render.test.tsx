// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StudioSavedMediaHandoff } from "./saved-media-handoff";
import { parseStudioSavedMediaHandoff } from "./saved-media-handoff";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const testState = vi.hoisted(() => ({
  invoke: vi.fn(),
  listSessions: vi.fn(),
  scope: { activeTenantId: "", activeUserId: "synthetic-member", loading: false, accountContextLoading: false },
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: testState.invoke } } }));
vi.mock("@/hooks/useTenantContext", () => ({ useTenantContext: () => testState.scope }));
vi.mock("../publish-piece", () => ({ PublishPiece: ({ piece }: { piece: { id: string } }) => <div data-original-piece={piece.id}>Post composer</div> }));
vi.mock("./StudioHome", () => ({ StudioHome: () => null, StudioRail: () => null }));
vi.mock("./StudioSession", () => ({ StudioSession: () => null }));
vi.mock("./MediaTools", () => ({ MediaTools: () => null }));
vi.mock("./studio-data", () => ({ listSessions: testState.listSessions, plainError: () => "Error" }));

const { VibeStudio } = await import("../vibe");
const tenant = "10000000-0000-4000-8000-000000000001";
const other = "10000000-0000-4000-8000-000000000002";
const id = "20000000-0000-4000-8000-000000000001";
const expected: StudioSavedMediaHandoff = { source: "marketing_content", id, expectedTenantId: tenant, kind: "image" };
const url = "https://test-project.supabase.co/storage/v1/object/public/paige-generated/original";
const result = (kind: StudioSavedMediaHandoff["kind"]) => ({ error: null, data: {
  ok: true, tenant_id: tenant, piece: { id, kind, status: "draft", title: "Original file", image_url: url, updated_at: "2026-11-22T17:00:00Z" },
} });

let host: HTMLDivElement;
let root: Root;
let back: ReturnType<typeof vi.fn>;
function render(asset: StudioSavedMediaHandoff = expected) {
  act(() => { root.render(<VibeStudio onBack={back} savedMedia={asset} />); });
}

beforeEach(() => {
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  testState.invoke.mockReset();
  testState.listSessions.mockReset();
  testState.scope.activeTenantId = tenant;
  back = vi.fn();
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe("Content opens the original saved media in Vibe Studio", () => {
  it.each([["image", "img"], ["video", "video"]] as const)("checks the original %s and then mounts the existing post composer", async (kind, selector) => {
    testState.invoke.mockResolvedValue(result(kind));
    render({ ...expected, kind });
    expect(host.querySelector('[role="status"]')?.textContent).toContain("original saved file");
    expect(host.querySelector("[data-original-piece]")).toBeNull();
    await act(async () => {});
    expect(testState.invoke).toHaveBeenCalledExactlyOnceWith("social-publish-command", { body: {
      action: "preview_media", expected_tenant_id: tenant, content_id: id, kind,
    } });
    expect(testState.listSessions).not.toHaveBeenCalled();
    expect(host.querySelector(selector)?.getAttribute("src")).toBe(url);
    expect(host.querySelector("[data-original-piece]")?.getAttribute("data-original-piece")).toBe(id);
    act(() => { host.querySelector(selector)?.dispatchEvent(new Event("error")); });
    expect(host.querySelector('[role="alert"]')?.textContent).toMatch(/check the original file/);
    expect(host.querySelector("[data-original-piece]")).toBeNull();
  });

  it("refuses a foreign response or changed workspace and never shows the prior file", async () => {
    const foreign = result("image");
    foreign.data.tenant_id = other;
    testState.invoke.mockResolvedValue(foreign);
    render();
    await act(async () => {});
    expect(host.querySelector("img")).toBeNull();
    expect(host.querySelector('[role="alert"]')).toBeTruthy();

    testState.scope.activeTenantId = other;
    render();
    expect(testState.invoke).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[role="alert"]')?.textContent).toMatch(/workspace changed/);
  });

  it("focuses Back to Content and consumes Escape before the underlying drawer", async () => {
    const background = vi.fn();
    window.addEventListener("keydown", background);
    try {
      testState.invoke.mockResolvedValue({ error: new Error("unavailable"), data: null });
      render();
      await act(async () => {});
      const button = host.querySelector("[data-studio-handoff-back]");
      expect(document.activeElement).toBe(button);
      act(() => { button?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
      expect(back).toHaveBeenCalledOnce();
      expect(background).not.toHaveBeenCalled();
    } finally { window.removeEventListener("keydown", background); }
  });

  it("admits only an original library reference and drops sender-provided metadata", () => {
    expect(parseStudioSavedMediaHandoff({ ...expected, url })).toEqual(expected);
    expect(parseStudioSavedMediaHandoff({ ...expected, source: "stream" })).toBeNull();
    expect(parseStudioSavedMediaHandoff({ ...expected, kind: "document" })).toBeNull();
    expect(parseStudioSavedMediaHandoff({ ...expected, id: url })).toBeNull();
  });
});

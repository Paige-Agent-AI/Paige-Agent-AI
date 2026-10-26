// EXP06 PR5 — the media block's truthful states. A page's video source the page cannot show
// (an embed URL the id-parser cannot read, or a dead PAIGE-hosted mp4) must SAY so, never render
// as an unexplained black box; a well-formed provider embed keeps its sandboxed iframe and the
// provider keeps its own private/deleted/expired truth inside it.
// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GrowthBlocks } from "@/components/growth/GrowthBlocks";
import type { GrowthBlock } from "@/lib/growth";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The public page renderer reaches no database from a media block; the double proves it.
const db = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (name: string) => { db.calls.push(`from(${name})`); return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) }; },
    rpc: (name: string) => { db.calls.push(`rpc(${name})`); return { then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(ok) }; },
    functions: { invoke: (name: string) => { db.calls.push(`invoke(${name})`); return Promise.resolve({ data: null, error: null }); } },
    auth: { getSession: async () => ({ data: { session: null } }) },
  },
}));

let host: HTMLDivElement;
let root: Root | null = null;

function render(blocks: GrowthBlock[]) {
  root = createRoot(host);
  act(() => { root!.render(<GrowthBlocks blocks={blocks} theme={null as never} tenantId="t-1" />); });
}

beforeEach(() => { db.calls = []; host = document.createElement("div"); document.body.appendChild(host); });
afterEach(() => { if (root) act(() => root.unmount()); root = null; host.remove(); });

describe("media block — truthful states", () => {
  it("a well-formed YouTube embed renders the sandboxed nocookie iframe", () => {
    render([{ type: "media", provider: "youtube", url: "https://www.youtube.com/watch?v=abc123XYZ-4", title: "Workshop replay" }]);
    const frame = host.querySelector("iframe");
    expect(frame?.getAttribute("src")).toBe("https://www.youtube-nocookie.com/embed/abc123XYZ-4");
    expect(frame?.getAttribute("sandbox")).toContain("allow-scripts");
    expect(frame?.getAttribute("referrerPolicy")).toBe("strict-origin-when-cross-origin");
    expect(frame?.getAttribute("title")).toBe("Workshop replay");
    expect(host.textContent).not.toContain("isn’t available");
  });

  it("Vimeo and Loom parse to their player embeds", () => {
    render([
      { type: "media", provider: "vimeo", url: "https://vimeo.com/1234567" },
      { type: "media", provider: "loom", url: "https://www.loom.com/share/abcdef0123" },
    ]);
    const srcs = [...host.querySelectorAll("iframe")].map((f) => f.getAttribute("src"));
    expect(srcs).toContain("https://player.vimeo.com/video/1234567");
    expect(srcs).toContain("https://www.loom.com/embed/abcdef0123");
  });

  it("an https URL the parser cannot read says so — never a black box", () => {
    // The server's save check accepts any https URL for the provider; this one carries no video id.
    render([{ type: "media", provider: "youtube", url: "https://example.com/not-a-video", title: "Keynote" }]);
    expect(host.querySelector("iframe")).toBeNull();
    const status = host.querySelector('[role="status"]');
    expect(status?.textContent).toContain("This video isn’t available right now.");
  });

  it("a PAIGE-hosted mp4 plays natively until the file fails, then says so", () => {
    render([{ type: "media", provider: "mp4", url: "https://paigeagent.ai/storage/v1/object/public/media/wrong.mp4" }]);
    const video = host.querySelector("video");
    expect(video?.getAttribute("src")).toContain("wrong.mp4");
    expect(video?.hasAttribute("controls")).toBe(true);
    expect(video?.hasAttribute("autoplay")).toBe(false);
    // The file is not there: the element's own error surfaces as the same honest sentence.
    act(() => { video!.dispatchEvent(new Event("error")); });
    expect(host.querySelector("video")).toBeNull();
    expect(host.querySelector('[role="status"]')?.textContent).toContain("This video isn’t available right now.");
  });

  it("no media path touches a database", () => {
    render([{ type: "media", provider: "youtube", url: "https://youtu.be/abc123XYZ-4" }]);
    expect(db.calls).toEqual([]);
  });
});

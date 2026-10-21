// @vitest-environment jsdom
//
// §39 fold (PR #1008) — a wide GFM table is a common Paige output, and the dedicated chat transcript
// now hides its own horizontal overflow (overflow-x-hidden). Without a per-table scroll wrapper that
// would clip the rightmost columns unreachably. This proves, against the REAL rendered DOM, that a
// markdown table is wrapped in an overflow-x-auto container so it self-scrolls (reachable, never
// clipped). jsdom does no layout, but it builds the real element tree — enough to lock the wrapper
// contract; the pixel-level scroll proof at each viewport is Proof Owed in the UI evidence record.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, it, expect } from "vitest";
import { MarkdownMessage } from "./MarkdownMessage";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const TABLE_MD = `| Name | Email | Phone | Status |
| --- | --- | --- | --- |
| A very long unbreakable-name-token | someone@example.com | 555-555-5555 | active |`;

async function render(content: string, verifiedAppPaths?: readonly string[]): Promise<{ host: HTMLElement; unmount: () => void }> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<MarkdownMessage content={content} verifiedAppPaths={verifiedAppPaths} />);
  });
  return {
    host,
    unmount: () => {
      act(() => root.unmount());
      host.remove();
    },
  };
}

describe("MarkdownMessage — wide tables self-scroll, never clipped", () => {
  it("renders a GFM table wrapped in an overflow-x-auto container", async () => {
    const { host, unmount } = await render(TABLE_MD);
    const table = host.querySelector("table");
    expect(table).toBeTruthy();
    const wrapper = table!.parentElement as HTMLElement;
    expect(wrapper.tagName).toBe("DIV");
    expect(wrapper.className).toMatch(/overflow-x-auto/);
    expect(wrapper.className).toMatch(/max-w-full/);
    unmount();
  });

  it("plain prose renders without a table wrapper (no false structure)", async () => {
    const { host, unmount } = await render("Just a normal sentence with a long-unbreakable-token.");
    expect(host.querySelector("table")).toBeNull();
    expect(host.querySelector("div.overflow-x-auto")).toBeNull();
    unmount();
  });
});

describe("scoped workspace Markdown navigation", () => {
  const current = "/solo/7001/clients/conversations";

  it.each([
    "/app/conversations", "https://paigeagent.ai/app/conversations", "//app.paigeagent.ai/app/conversations",
    "https://www.paigeagent.ai/app/conversations", "https://paigeagent.ai./app/conversations",
    "/solo/7002/clients/conversations", "https://paigeagent.ai/solo/7002/clients/conversations",
    "/operator/fleet", "/admin", "https://paigeagent.ai:444/solo/7001/clients/conversations",
    "https://user@paigeagent.ai/solo/7001/clients/conversations", "http://paigeagent.ai/solo/7001/clients/conversations",
    `${current}?person=unverified`,
  ])("keeps an unverified app destination as text: %s", async href => {
    const { host, unmount } = await render(`[Open Conversations](${href})`, [current]);
    expect(host.querySelector("a")).toBeNull();
    expect(host.textContent).toBe("Open Conversations");
    unmount();
  });

  it.each([current, `https://paigeagent.ai${current}`, `https://app.paigeagent.ai${current}`, `//paigeagent.ai${current}`])(
    "retains only the exact resolved current-account target: %s", async href => {
      const { host, unmount } = await render(`[Open Conversations](${href})`, [current]);
      expect(host.querySelector("a")?.getAttribute("href")).toBe(current);
      expect(host.querySelector("a")?.getAttribute("rel")).toBe("noopener noreferrer");
      unmount();
    });

  it("does not infer a destination from valid-looking prose without a native reference", async () => {
    const { host, unmount } = await render(`[Open Conversations](${current})`, []);
    expect(host.querySelector("a")).toBeNull();
    unmount();
  });

  it.each(["https://paigeagent.ai/", "https://www.paigeagent.ai/about", "https://paigeagent.ai/blog/evidence", "/privacy"])(
    "preserves a public citation through the existing host-router contract: %s", async href => {
      const { host, unmount } = await render(`[Public source](${href})`, []);
      expect(host.querySelector("a")?.getAttribute("href")).toBe(href);
      unmount();
    });

  it("preserves external citations, text formatting and the existing non-workspace renderer", async () => {
    const { host, unmount } = await render("[**Source**](https://example.org/research?q=1#evidence)", []);
    expect(host.querySelector("a")?.getAttribute("href")).toBe("https://example.org/research?q=1#evidence");
    expect(host.querySelector("a strong")?.textContent).toBe("Source");
    unmount();
    const legacy = await render("[Existing link](/app/conversations)");
    expect(legacy.host.querySelector("a")?.getAttribute("href")).toBe("/app/conversations");
    legacy.unmount();
  });
});

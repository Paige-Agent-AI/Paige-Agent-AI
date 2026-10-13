import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EmbedCode } from "./EmbedCode";
import { embedSnippet } from "./embed-code";

describe("embedSnippet", () => {
  it("is one tag: this app's loader, the form's id and its name as the frame's label", () => {
    expect(embedSnippet("https://paigeagent.ai", "0b8f1a2e-1111-4222-8333-444455556666", "Spring consult"))
      .toBe('<script src="https://paigeagent.ai/embed.js" data-form="0b8f1a2e-1111-4222-8333-444455556666" data-title="Spring consult" async></script>');
  });
  it("cannot be broken out of by a form's name", () => {
    const code = embedSnippet("https://paigeagent.ai", "0b8f1a2e-1111-4222-8333-444455556666", `"><img src=x onerror=alert(1)>`);
    expect(code).not.toContain('"><img');
    expect(code).toContain("&quot;&gt;&lt;img");
  });
  it("leaves the label out when the form has no name", () => {
    expect(embedSnippet("https://paigeagent.ai", "id", "  ")).not.toContain("data-title");
  });
});

describe("EmbedCode", () => {
  let root: Root | null = null;
  let host: HTMLDivElement | null = null;
  afterEach(() => { act(() => root?.unmount()); host?.remove(); root = null; host = null; vi.restoreAllMocks(); });
  const render = async () => {
    host = document.createElement("div"); document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => { root!.render(<EmbedCode formId="f-1" formName="Spring consult"/>); });
    return host;
  };

  it("copies the code and says where to paste it", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const node = await render();
    expect(node.querySelector("h3")?.textContent).toBe("Put it on your website");
    await act(async () => { (node.querySelector("button") as HTMLButtonElement).click(); });
    expect(writeText).toHaveBeenCalledWith(`<script src="${window.location.origin}/embed.js" data-form="f-1" data-title="Spring consult" async></script>`);
    expect(node.querySelector("button")?.textContent).toBe("Copied");
    expect(node.querySelector("[role=status]")?.textContent).toBe("Paste it into your site's page editor.");
  });

  it("selects the code for the owner when the browser refuses the clipboard", async () => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) }, configurable: true });
    const node = await render();
    await act(async () => { (node.querySelector("button") as HTMLButtonElement).click(); });
    expect(node.querySelector("[role=status]")?.textContent).toContain("Your browser didn't allow copying");
    expect(window.getSelection()?.toString()).toContain("embed.js");
  });

  it("tells the owner what unpublishing does to the copy on their site", async () => {
    const node = await render();
    expect(node.textContent).toContain("If you unpublish the form, your site shows that it isn't available.");
  });
});

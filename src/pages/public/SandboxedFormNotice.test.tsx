import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SandboxedFormNotice } from "./SandboxedFormNotice";

// A form page in a sandbox that hides its origin: the visitor gets the form's own address, never a blank page.
describe("SandboxedFormNotice", () => {
  let root: Root | null = null;
  let host: HTMLDivElement | null = null;
  afterEach(() => { act(() => root?.unmount()); host?.remove(); root = null; host = null; vi.restoreAllMocks(); window.history.replaceState(null, "", "/"); });
  const render = async (framed: boolean) => {
    window.history.replaceState(null, "", "/form/f-1?embed=1&theme=dark&utm_campaign=spring");
    vi.spyOn(window, "parent", "get").mockReturnValue((framed ? {} : window) as Window);
    host = document.createElement("div"); document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => { root!.render(<SandboxedFormNotice />); });
    return host;
  };
  const address = `${window.location.origin}/form/f-1?utm_campaign=spring`;

  it("shows the form's own address (campaign tags kept, embedded look dropped) with Copy address", async () => {
    const node = await render(false);
    expect(node.querySelector("h1")?.textContent).toBe("This form opens on its own page");
    expect(node.querySelector("p.font-mono")?.textContent).toBe(address);
    expect([...node.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Copy address"]);
  });

  it("offers Open the form only inside a frame (a tab opened from a sandbox is still sandboxed)", async () => {
    const tab = await render(false);
    expect(tab.querySelector("a")).toBeNull();
    expect(tab.textContent).toContain("Copy its address into a new browser tab.");
    expect(tab.textContent).not.toContain("Open it");
    act(() => root?.unmount()); host?.remove();
    const framed = await render(true);
    const link = framed.querySelector("a") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe(address);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(framed.textContent).toContain("Open it, or copy its address");
  });

  it("copies the address, and selects it when the browser refuses the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    let node = await render(false);
    await act(async () => { (node.querySelector("button") as HTMLButtonElement).click(); });
    expect(writeText).toHaveBeenCalledWith(address);
    expect(node.textContent).toContain("Paste it into a new browser tab.");
    act(() => root?.unmount()); host?.remove();
    Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn().mockRejectedValue(new Error("sandboxed")) }, configurable: true });
    node = await render(false);
    await act(async () => { (node.querySelector("button") as HTMLButtonElement).click(); });
    expect(window.getSelection()?.toString()).toBe(address);
    expect(node.textContent).toContain("The address is selected");
  });
});

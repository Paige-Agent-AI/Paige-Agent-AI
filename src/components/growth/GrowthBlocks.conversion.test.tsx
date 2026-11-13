import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GrowthBlocks, type GrowthBlocksProps } from "./GrowthBlocks";
import type { GrowthBlock } from "@/lib/growth";
import type { ConversionDestination } from "../../../supabase/functions/_shared/growth/conversion-destination";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const db = vi.hoisted(() => ({ rpc: vi.fn(), invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  rpc: db.rpc, functions: { invoke: db.invoke },
  auth: { getSession: async () => ({ data: { session: null } }) },
} }));
const FORM_ID = "df2fd426-a23b-4b91-9dc8-123456789abc";
const JOTFORM = "https://form.jotform.com/123456789012345";
let host: HTMLDivElement;
let root: Root;
const conversion = (destination: ConversionDestination) => ({ type: "conversion", title: "Next step", destination }) as GrowthBlock;
async function render(destination: ConversionDestination, preview = false) {
  await act(async () => root.render(<GrowthBlocks {...({ tenantId: "test-tenant-studio", preview } as Partial<GrowthBlocksProps>)} blocks={[conversion(destination)]} />));
}
function click(label: string) {
  const button = Array.from(host.querySelectorAll("button")).find((node) => node.textContent?.includes(label));
  expect(button).toBeTruthy();
  act(() => button!.click());
}
beforeEach(() => {
  db.rpc.mockReset().mockResolvedValue({ data: [], error: null });
  db.invoke.mockReset();
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe("conversion renderer — original resources and explicit activation", () => {
  it("resolves a native form through original GrowthFormEmbed/public RPC", async () => {
    db.rpc.mockResolvedValue({ data: [{ id: FORM_ID, name: "Public intake", schema_json: { sections: [{ title: "Contact", fields: [{ key: "email", type: "email", label: "Email", required: true }] }] }, success_action_json: { message: "Thank you" } }], error: null });
    await render({ kind: "native_form", formId: FORM_ID });
    expect(db.rpc).toHaveBeenCalledWith("growth_public_form", { p_form_id: FORM_ID });
    expect(host.textContent).toContain("Public intake");
    expect(host.querySelector('input[type="email"]')).toBeTruthy();
    expect(db.invoke).not.toHaveBeenCalled();
  });
  it("reports unavailable native forms from the original resolver", async () => {
    await render({ kind: "native_form", formId: FORM_ID });
    expect(host.querySelector('[role="status"]')?.textContent).toContain("This form is unavailable.");
    expect(host.querySelector("form")).toBeNull();
  });
  it("hands native booking to the original public route without a scheduler", async () => {
    await render({ kind: "native_booking", slug: "discovery-call" });
    expect(host.querySelector("a")?.getAttribute("href")).toBe("/book/discovery-call");
    expect(db.rpc).not.toHaveBeenCalled();
    expect(db.invoke).not.toHaveBeenCalled();
  });
  it("keeps an external link safe and inert until the visitor follows it", async () => {
    await render({ kind: "external_form", mode: "link", url: JOTFORM, provider: "jotform" });
    const link = host.querySelector("a");
    expect(link?.getAttribute("href")).toBe(JOTFORM);
    expect(link?.getAttribute("rel")).toContain("noreferrer");
    expect(host.querySelector("iframe")).toBeNull();
    expect(db.rpc).not.toHaveBeenCalled();
    expect(db.invoke).not.toHaveBeenCalled();
  });
  it("loads a sandboxed external iframe only after a visitor click, and closes it", async () => {
    await render({ kind: "external_form", mode: "embed", url: JOTFORM, provider: "jotform" });
    expect(host.querySelector("iframe")).toBeNull();
    click("Load form");
    const frame = host.querySelector("iframe");
    expect(frame?.getAttribute("src")).toBe(JOTFORM);
    expect(frame?.getAttribute("sandbox")).toContain("allow-forms");
    expect(frame?.getAttribute("sandbox")).not.toContain("allow-top-navigation");
    expect(frame?.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(frame?.getAttribute("title")).toBe("Next step");
    expect(frame?.hasAttribute("srcdoc")).toBe(false);
    expect(host.querySelector("button")?.getAttribute("aria-expanded")).toBe("true");
    click("Close form");
    expect(host.querySelector("iframe")).toBeNull();
  });
  it("does not carry activation across a changed destination", async () => {
    await render({ kind: "external_form", mode: "embed", url: JOTFORM, provider: "jotform" });
    click("Load form");
    await render({ kind: "external_booking", mode: "embed", url: "https://calendly.com/example-studio/discovery", provider: "calendly" });
    expect(host.querySelector("iframe")).toBeNull();
    click("Load booking");
    expect(host.querySelector("iframe")?.getAttribute("src")).toBe("https://calendly.com/example-studio/discovery");
  });
  it("always offers a safe recovery link without inferring provider availability", async () => {
    await render({ kind: "external_form", mode: "embed", url: JOTFORM, provider: "jotform" });
    click("Load form");
    expect(host.querySelector("a")?.getAttribute("href")).toBe(JOTFORM);
    expect(host.querySelector("a")?.textContent).toContain("new tab");
  });
  it.each([
    { kind: "native_form", formId: FORM_ID },
    { kind: "native_booking", slug: "discovery" },
    { kind: "external_form", mode: "embed", url: JOTFORM, provider: "jotform" },
  ] as ConversionDestination[])("keeps Studio preview nonexecuting with a tenant context: %j", async (destination) => {
    await render(destination, true);
    expect(host.querySelector("iframe,form,a[href]")).toBeNull();
    expect(host.textContent).toContain("Preview");
    expect(db.rpc).not.toHaveBeenCalled();
    expect(db.invoke).not.toHaveBeenCalled();
  });
  it.each([
    { kind: "external_form", mode: "embed", url: "https://example.com/form", provider: "jotform" },
    { kind: "external_form", mode: "link", url: "javascript:bad()", provider: "other" },
    { kind: "external_form", mode: "embed", url: JOTFORM + "?token=secret-value", provider: "jotform" },
  ] as ConversionDestination[])("refuses malformed stored destinations without leaking their input", async (destination) => {
    await render(destination);
    expect(host.querySelector("iframe,a[href],form")).toBeNull();
    expect(host.textContent).toContain("This destination is unavailable.");
    expect(host.textContent).not.toContain("secret-value");
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it("keeps arbitrary raw HTML out of the rich-text renderer", async () => {
    await act(async () => root.render(<GrowthBlocks blocks={[{ type: "rich_text", html: '<p>Copy</p><form><input></form><iframe src="https://example.com"></iframe><script>bad()</script>' }]} />));
    expect(host.textContent).toContain("Copy");
    expect(host.querySelector("iframe,script,form")).toBeNull();
  });
});

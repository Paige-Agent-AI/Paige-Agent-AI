import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StudioBusinessContextPanel } from "./StudioBusinessContextPanel";
import { projectStudioBusinessContext } from "./business-context";

const confirmed = { source: "owner_confirmed", confidence: "confirmed" };
function projection() {
  return projectStudioBusinessContext({ expectedTenantId: "test-tenant-context", target: { kind: "workspace" }, readStatus: "available", context: {
    tenantId: "test-tenant-context", contextRevision: 3, brief: {
      publicName: "Test Workshop", offers: "A planning workshop", idealCustomer: "Independent consultants",
      brandVoice: "Clear and grounded", doNotAssume: "Never promise revenue", serviceArea: "Online",
      provenance: Object.fromEntries(["publicName", "offers", "idealCustomer", "brandVoice", "doNotAssume", "serviceArea"].map((field) => [field, confirmed])),
    },
  }, publicBrand: { tenantId: "test-tenant-context", target: { kind: "workspace" }, readStatus: "available", values: { primary_color: "#123456" } } });
}

let host: HTMLDivElement;
let root: Root;
beforeEach(() => { host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
const label = (name: string) => [...host.querySelectorAll("label")].find((node) => node.textContent === name)!;
const field = (name: string) => document.getElementById(label(name).htmlFor) as HTMLInputElement;
function change(node: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(node, value);
    node.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("Studio project context panel", () => {
  it("shows sourced facts, private guidance and observed branding without claiming persistence", () => {
    act(() => root.render(<StudioBusinessContextPanel projection={projection()} onChange={vi.fn()} onTargetChange={vi.fn()} />));
    expect(host.querySelector("summary")?.textContent).toContain("Test Workshop");
    expect(host.textContent).toContain("Confirmed in Setup");
    expect(host.textContent).toContain("Observed public brand");
    expect(host.textContent).toContain("Private guidance");
    expect(host.textContent).toContain("Never promise revenue");
    expect(field("Business name").value).toBe("Test Workshop");
    expect(host.textContent).not.toMatch(/saved to this project|publication approved/i);
  });

  it("emits only project edits and preserves other controlled edits and incomplete input", () => {
    const source = projection(); const before = JSON.stringify(source); const onChange = vi.fn();
    act(() => root.render(<StudioBusinessContextPanel projection={source} projectValues={{ offers: "Project offer", primaryColor: "#1" }} onChange={onChange} onTargetChange={vi.fn()} />));
    expect(field("Primary color").value).toBe("#1");
    change(field("Business name"), "Project Workshop");
    expect(onChange).toHaveBeenLastCalledWith({ offers: "Project offer", primaryColor: "#1", publicName: "Project Workshop" });
    expect(JSON.stringify(source)).toBe(before);
  });

  it("reports target selection alone and never treats its label as verified source context", () => {
    const onTargetChange = vi.fn(); const onChange = vi.fn();
    const source = projectStudioBusinessContext({ expectedTenantId: "test-tenant-context", target: { kind: "client", reference: "test-client", label: "Selected client brand" }, readStatus: "available", context: {}, projectValues: { publicName: "Entered client name" } });
    act(() => root.render(<StudioBusinessContextPanel projection={source} onChange={onChange} onTargetChange={onTargetChange} />));
    expect(host.querySelector("summary")?.textContent).toContain("Selected client brand");
    expect(host.textContent).toContain("Workspace context is not used");
    expect(field("Business name").value).toBe("Entered client name");
    const custom = [...host.querySelectorAll("button")].find((button) => button.textContent === "Custom")!;
    act(() => custom.click());
    expect(onTargetChange).toHaveBeenCalledWith("custom");
    expect(onChange).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain("Test Workshop");
  });

  it("keeps unavailable facts empty, labels every editable field and has an explicit reset", () => {
    const onChange = vi.fn();
    const source = projectStudioBusinessContext({ expectedTenantId: "test-tenant-context", target: { kind: "custom", reference: "test-custom" }, readStatus: "unavailable", context: null, projectValues: { offers: "Project offer" } });
    act(() => root.render(<StudioBusinessContextPanel projection={source} onChange={onChange} onTargetChange={vi.fn()} />));
    expect(field("Business name").value).toBe("");
    expect(host.textContent).toContain("Not provided");
    for (const input of host.querySelectorAll("input")) expect(host.querySelector(`label[for="${input.id}"]`)).not.toBeNull();
    const reset = [...host.querySelectorAll("button")].find((button) => button.textContent === "Clear project edits")!;
    act(() => reset.click());
    expect(onChange).toHaveBeenCalledWith({});
  });

  it("refuses edits while disabled without adding an independent save or approval action", () => {
    const onChange = vi.fn(); const onTargetChange = vi.fn();
    act(() => root.render(<StudioBusinessContextPanel projection={projection()} disabled onChange={onChange} onTargetChange={onTargetChange} />));
    for (const node of host.querySelectorAll<HTMLInputElement | HTMLButtonElement>("input, button")) expect(node.disabled).toBe(true);
    expect(host.textContent).not.toMatch(/save context|publish|approve/i);
  });

  it("clears previous workspace facts from the same controls when the target projection changes", () => {
    const props = { onChange: vi.fn(), onTargetChange: vi.fn() };
    act(() => root.render(<StudioBusinessContextPanel projection={projection()} {...props} />));
    expect(field("Business name").value).toBe("Test Workshop");
    const next = projectStudioBusinessContext({ expectedTenantId: "test-tenant-context", target: { kind: "custom", reference: "new-brand" }, readStatus: "available", context: null });
    act(() => root.render(<StudioBusinessContextPanel projection={next} {...props} />));
    expect(field("Business name").value).toBe("");
    expect(field("Primary color").value).toBe("");
    expect(host.textContent).not.toContain("Test Workshop");
    expect(props.onChange).not.toHaveBeenCalled();
  });
});

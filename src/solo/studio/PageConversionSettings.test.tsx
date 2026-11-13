import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PageConversionSettings, type PageConversionSettingsProps } from "./PageConversionSettings";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const FORM_ID = "df2fd426-a23b-4b91-9dc8-123456789abc";
const OTHER_FORM_ID = "df2fd426-a23b-4b91-9dc8-123456789abd";
const JOTFORM = "https://form.jotform.com/123456789012345";
let root: Root;
let host: HTMLDivElement;
let props: PageConversionSettingsProps;
async function render(overrides: Partial<PageConversionSettingsProps> = {}) {
  props = { ...props, ...overrides };
  await act(async () => root.render(<PageConversionSettings {...props} />));
}
function control(label: string) {
  const element = Array.from(host.querySelectorAll("label")).find((node) => node.textContent === label);
  expect(element, `visible label ${label}`).toBeTruthy();
  const input = document.getElementById(element!.htmlFor) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
  expect(input, `associated control ${label}`).toBeTruthy();
  return input;
}
async function enter(label: string, value: string) {
  const input = control(label);
  const prototype = input instanceof HTMLSelectElement ? HTMLSelectElement.prototype
    : input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}
async function click(text: string) {
  const button = Array.from(host.querySelectorAll("button")).find((node) => node.textContent === text);
  expect(button, `button ${text}`).toBeTruthy();
  await act(async () => button!.click());
}
async function mode(value: "link" | "embed") {
  await act(async () => (host.querySelector(`input[type="radio"][value="${value}"]`) as HTMLInputElement).click());
}
beforeEach(() => {
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  props = { forms: [{ id: FORM_ID, title: "Inquiry form" }], bookingLinks: [{ slug: "discovery-call", title: "Discovery call" }], onSave: vi.fn(), onClose: vi.fn() };
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); });

describe("page conversion settings — canonical draft editing", () => {
  it("shows the actual legacy form being replaced and requires an explicit new destination", async () => {
    await render({ legacyForm: { slug: "original-signup", title: "Original signup" } });
    expect(host.textContent).toContain("Current saved form: Original signup");
    await click("Save conversion");
    expect(props.onSave).not.toHaveBeenCalled();
    await enter("Destination", "native_booking");
    await enter("PAIGE booking link", "discovery-call");
    await click("Save conversion");
    expect(props.onSave).toHaveBeenCalledWith({ type: "conversion", destination: { kind: "native_booking", slug: "discovery-call" }, label: "Open booking" });
  });
  it("preserves edited input while a build disables settings without claiming a conversion save", async () => {
    await render(); await enter("PAIGE form", FORM_ID);
    await render({ disabled: true });
    expect(control("Destination").disabled).toBe(true);
    expect(control("PAIGE form").disabled).toBe(true);
    expect(host.textContent).not.toContain("Saving…");
    await click("Save conversion"); expect(props.onSave).not.toHaveBeenCalled();
    await render({ disabled: false });
    expect(control("PAIGE form").value).toBe(FORM_ID);
    await click("Save conversion"); expect(props.onSave).toHaveBeenCalledTimes(1);
  });
  it("requires an explicit native choice from the caller's scoped options", async () => {
    await render();
    expect(control("PAIGE form").value).toBe("");
    await click("Save conversion");
    expect(props.onSave).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Choose a PAIGE form");
    await enter("PAIGE form", FORM_ID);
    await enter("Section title", "  Tell us more  ");
    await click("Save conversion");
    expect(props.onSave).toHaveBeenCalledWith({ type: "conversion", destination: { kind: "native_form", formId: FORM_ID }, title: "Tell us more" });
  });
  it("preserves native form submission wording by hiding the generic action-label control", async () => {
    await render({ value: { type: "conversion", destination: { kind: "native_form", formId: FORM_ID }, label: "Old generic label" } });
    expect(host.textContent).not.toContain("Button label");
    expect(host.textContent).toContain("existing fields and submission settings");
    await click("Save conversion");
    expect(props.onSave).toHaveBeenCalledWith({ type: "conversion", destination: { kind: "native_form", formId: FORM_ID } });
  });
  it("does not accept a formerly selected native ID absent from current options", async () => {
    await render({ value: { type: "conversion", destination: { kind: "native_form", formId: OTHER_FORM_ID } } });
    await click("Save conversion");
    expect(props.onSave).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("currently available");
  });
  it("uses an original booking option and an intentional handoff label", async () => {
    await render();
    await enter("Destination", "native_booking");
    await enter("PAIGE booking link", "discovery-call");
    await click("Save conversion");
    expect(props.onSave).toHaveBeenCalledWith({ type: "conversion", destination: { kind: "native_booking", slug: "discovery-call" }, label: "Open booking" });
  });
  it("refuses a booking selection removed from the caller's current scope", async () => {
    await render({ value: { type: "conversion", destination: { kind: "native_booking", slug: "former-link" } } });
    await click("Save conversion");
    expect(props.onSave).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("not currently available");
  });
  it.each([
    ["loading", "Loading your forms"], ["unavailable", "could not be loaded"], ["ready", "No native forms to select"],
  ] as const)("distinguishes %s native-list state", async (formsStatus, text) => {
    await render({ forms: [], formsStatus });
    expect(host.textContent).toContain(text);
    await click("Save conversion");
    expect(props.onSave).not.toHaveBeenCalled();
  });
  it("does not label a stored resource unavailable while its option list is loading", async () => {
    await render({ value: { type: "conversion", destination: { kind: "native_form", formId: FORM_ID } }, forms: [], formsStatus: "loading" });
    expect(control("PAIGE form").value).toBe(FORM_ID);
    expect(host.textContent).toContain("Current form selection");
    expect(host.textContent).not.toContain("form unavailable");
  });
  it("normalizes supported pasted HTML without storing or executing it", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    const markup = `<iframe src="${JOTFORM}" onload="bad()"></iframe><script>window.bad=true</script>`;
    await render();
    await enter("Destination", "external_form");
    await mode("embed");
    await enter("Public URL or embed code", markup);
    await enter("Description", "  Your next step  ");
    await click("Save conversion");
    expect(props.onSave).toHaveBeenCalledWith({ type: "conversion", destination: { kind: "external_form", mode: "embed", url: JOTFORM, provider: "jotform" }, description: "Your next step", label: "Load form" });
    expect((control("Public URL or embed code") as HTMLTextAreaElement).value).toBe(markup);
    expect(host.querySelector("iframe,script")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(props.onSave).mock.calls)).not.toMatch(/<iframe|onload|window.bad/);
  });
  it("retains unsupported embed input and switches to a safe link only on explicit action", async () => {
    const url = "https://forms.example.com/intake";
    await render(); await enter("Destination", "external_form"); await mode("embed");
    await enter("Public URL or embed code", url); await click("Save conversion");
    expect(props.onSave).not.toHaveBeenCalled();
    expect((host.querySelector('input[value="embed"]') as HTMLInputElement).checked).toBe(true);
    expect(control("Public URL or embed code").value).toBe(url);
    expect(document.activeElement).toBe(control("Public URL or embed code"));
    await click("Use a link instead");
    expect(props.onSave).not.toHaveBeenCalled();
    expect(control("Public URL or embed code").value).toBe(url);
    expect((host.querySelector('input[value="link"]') as HTMLInputElement).checked).toBe(true);
    await click("Save conversion");
    expect(props.onSave).toHaveBeenCalledWith({ type: "conversion", destination: { kind: "external_form", mode: "link", url, provider: "other" }, label: "Open form" });
  });
  it.each([
    "https://localhost/intake", JOTFORM + "?token=secret-value",
    '<iframe src="https://forms.example.com/intake"></iframe>',
  ])("never offers unsafe or unsupported HTML a link fallback: %s", async (input) => {
    await render(); await enter("Destination", "external_form"); await mode("embed");
    await enter("Public URL or embed code", input); await click("Save conversion");
    expect(props.onSave).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain("Use a link instead");
    expect(host.querySelector("iframe,script")).toBeNull();
    expect(control("Public URL or embed code").value).toBe(input);
  });
  it("keeps form and booking kind validation distinct", async () => {
    await render(); await enter("Destination", "external_booking"); await mode("embed");
    await enter("Public URL or embed code", JOTFORM); await click("Save conversion");
    expect(props.onSave).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("external form");
  });
  it("retains custom copy across type and mode changes", async () => {
    await render(); await enter("Destination", "external_form");
    await enter("Button label", "Read and continue"); await enter("Section title", "Your next step");
    await mode("embed"); await enter("Public URL or embed code", JOTFORM); await click("Save conversion");
    expect(props.onSave).toHaveBeenCalledWith(expect.objectContaining({ title: "Your next step", label: "Read and continue" }));
  });
  it("preserves edits through parent saving/error updates", async () => {
    await render(); await enter("Destination", "external_form"); await enter("Public URL or embed code", JOTFORM);
    await enter("Section title", "Still here");
    await render({ saving: true });
    expect((control("Public URL or embed code") as HTMLTextAreaElement).disabled).toBe(true);
    expect(control("Section title").value).toBe("Still here");
    await render({ saving: false, error: "The page changed. Review and try again." });
    expect(control("Public URL or embed code").value).toBe(JOTFORM);
    expect(control("Section title").value).toBe("Still here");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("The page changed");
  });
  it("recovers a rejected save without clearing input or leaking the thrown diagnostic", async () => {
    await render({ onSave: vi.fn().mockRejectedValue(new Error("private-diagnostic")) });
    await enter("Destination", "external_form"); await enter("Public URL or embed code", JOTFORM); await click("Save conversion");
    expect(control("Public URL or embed code").value).toBe(JOTFORM);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Try again");
    expect(host.textContent).not.toContain("private-diagnostic");
  });
  it("prevents duplicate saves and offers Close while the caller is saving", async () => {
    let complete!: () => void;
    await render({ onSave: vi.fn(() => new Promise<void>((resolve) => { complete = resolve; })) });
    await enter("PAIGE form", FORM_ID);
    const save = Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "Save conversion")!;
    await act(async () => { save.click(); save.click(); });
    expect(props.onSave).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("Saving…");
    await click("Close");
    expect(props.onClose).toHaveBeenCalledOnce();
    await act(async () => complete());
    expect(host.textContent).not.toContain("Saved.");
  });
  it("uses visible labels, mode grouping and associated validation", async () => {
    await render(); await enter("Destination", "external_form"); await enter("Public URL or embed code", "javascript:bad()"); await click("Save conversion");
    for (const element of Array.from(host.querySelectorAll("input,select,textarea"))) {
      expect((element as HTMLInputElement).labels?.length).toBeGreaterThan(0);
    }
    expect(host.querySelector("fieldset legend")?.textContent).toBe("On the page");
    const input = control("Public URL or embed code");
    expect(input.required).toBe(true);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(input.getAttribute("aria-describedby")!.split(" ").at(-1)!)).not.toBeNull();
    expect(host.querySelector('[role="alert"]')?.id).toBe(input.getAttribute("aria-describedby")!.split(" ").at(-1));
  });
  it("provides Close and Cancel exits without saving", async () => {
    await render();
    await act(async () => (host.querySelector('[aria-label="Close conversion settings"]') as HTMLButtonElement).click());
    await click("Cancel");
    expect(props.onClose).toHaveBeenCalledTimes(2);
    expect(props.onSave).not.toHaveBeenCalled();
  });
});

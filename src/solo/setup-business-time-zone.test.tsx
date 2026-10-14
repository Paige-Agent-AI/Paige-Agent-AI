import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Experience 04 E4-S2: the owner sets the business time zone in Setup, confirms the exact zone, and
// the value is called saved only after the database reads it back. The Supabase client is the double;
// the component, hook and parsing are real.
const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...args: unknown[]) => rpc(...args) } }));
const theme = { resolved: "dark" as string | undefined };
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: theme.resolved }) }));

import { BusinessTimeZoneSetting, zoneMatch } from "./setup-business-time-zone";
import { placeName } from "./data/useBusinessTimeZone";

const TENANT = "tenant-a";
const zoneRow = (over: Record<string, unknown> = {}) => ({ state: "missing", zone: null, set_at: null, local_date: null, can_set: true, ...over });
const ok = (data: unknown) => Promise.resolve({ data, error: null });
const fail = (code: string) => Promise.resolve({ data: null, error: { code, message: "server text never shown" } });

let host: HTMLDivElement;
let root: Root;
const flush = () => act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); });
const text = () => document.body.textContent ?? "";
const buttons = () => Array.from(document.body.querySelectorAll("button"));
const button = (label: RegExp) => buttons().find((b) => label.test(b.textContent?.trim() ?? "")) as HTMLButtonElement | undefined;
const click = async (el: Element | undefined) => {
  expect(el, "element to click").toBeTruthy();
  await act(async () => { (el as HTMLElement).click(); });
  await flush();
};
async function mount(tenantId: string | null = TENANT) {
  await act(async () => { root.render(<BusinessTimeZoneSetting tenantId={tenantId}/>); });
  await flush();
}
async function choose(search: string, option: RegExp) {
  await click(button(/^(Set time zone|Change)/));
  const input = document.body.querySelector('input[placeholder="Find a city or time zone"]') as HTMLInputElement;
  expect(input, "picker search").toBeTruthy();
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, search);
  await act(async () => { input.dispatchEvent(new Event("input", { bubbles: true })); });
  await flush();
  const item = Array.from(document.body.querySelectorAll('[cmdk-item]')).find((el) => option.test(el.textContent ?? ""));
  await click(item);
}
const confirmGroup = () => document.body.querySelector('[role="group"][aria-labelledby="setup-tz-confirm-title"]');

beforeEach(() => {
  rpc.mockReset();
  // cmdk and Radix need these in jsdom.
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= () => {};
  host = document.createElement("div");
  host.setAttribute("data-pg", "dark");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
});

describe("Setup › Business time zone", () => {
  it("lets the owner set it: pick, confirm the exact zone, save, then read back", async () => {
    rpc.mockImplementation((name: string, args: Record<string, unknown>) => {
      if (name === "read_business_time_zone") return rpc.mock.calls.some(([n]) => n === "set_business_time_zone")
        ? ok(zoneRow({ state: "configured", zone: "America/Chicago", set_at: "2026-10-13T01:00:00Z", local_date: "2026-10-12" }))
        : ok(zoneRow());
      if (name === "set_business_time_zone") return ok({ time_zone: args._time_zone, receipt_id: "r1" });
      return fail("XX000");
    });
    await mount();
    expect(text()).toContain("Not set");
    expect(text()).toContain("Due and overdue payment dates are on hold");

    await choose("Chicago", /^Chicago/);
    const confirm = confirmGroup();
    expect(confirm?.textContent).toMatch(/Save .* — America\/Chicago\?/);
    expect(confirm?.textContent).toContain("Messages to customers keep following each customer’s own verified time zone");
    // Keyboard focus follows the task to the confirmation instead of falling to the page.
    expect(document.activeElement?.id).toBe("setup-tz-confirm-title");
    // Nothing is written until the owner confirms.
    expect(rpc.mock.calls.some(([n]) => n === "set_business_time_zone")).toBe(false);

    await click(button(/^Save time zone$/));
    expect(text()).toContain("Saved and read back from your business record: America/Chicago");
    expect(document.activeElement?.textContent).toContain("Saved and read back");
    expect(rpc.mock.calls.map(([n, a]) => [n, a])).toEqual([
      ["read_business_time_zone", { _expected_tenant_id: TENANT }],
      ["set_business_time_zone", { _expected_tenant_id: TENANT, _time_zone: "America/Chicago" }],
      ["read_business_time_zone", { _expected_tenant_id: TENANT }],
    ]);
    expect(text()).toMatch(/America\/Chicago · .* there now/);
    expect(button(/^Change/)).toBeTruthy();
  });

  it.each(["light", "dark"])("carries the %s theme onto the portaled picker", async (resolved) => {
    theme.resolved = resolved;
    rpc.mockImplementation(() => ok(zoneRow()));
    await mount();
    await click(button(/^Set time zone/));
    expect(document.body.querySelector(".setup-tz__picker")?.getAttribute("data-pg")).toBe(resolved);
    theme.resolved = "dark";
  });

  it("never reports a save the database does not read back", async () => {
    rpc.mockImplementation((name: string) => name === "set_business_time_zone"
      ? ok({ time_zone: "America/Chicago", receipt_id: "r1" })
      : ok(zoneRow()));
    await mount();
    await choose("Chicago", /^Chicago/);
    await click(button(/^Save time zone$/));
    expect(text()).toContain("The save could not be confirmed by reading it back");
    expect(text()).not.toContain("Saved and read back");
    expect(text()).toContain("Not set");
  });

  it("never reports a save when the read back shows a different zone", async () => {
    rpc.mockImplementation((name: string) => {
      if (name === "set_business_time_zone") return ok({ time_zone: "America/Chicago", receipt_id: "r1" });
      return rpc.mock.calls.some(([n]) => n === "set_business_time_zone")
        ? ok(zoneRow({ state: "configured", zone: "America/Denver", local_date: "2026-10-12" }))
        : ok(zoneRow());
    });
    await mount();
    await choose("Chicago", /^Chicago/);
    await click(button(/^Save time zone$/));
    expect(text()).toContain("The save could not be confirmed by reading it back");
    expect(text()).not.toContain("Saved and read back");
  });

  it("says nothing in the new workspace about a save that answered after the switch", async () => {
    let finish: (v: unknown) => void = () => {};
    rpc.mockImplementation((name: string) => name === "set_business_time_zone"
      ? new Promise((resolve) => { finish = resolve; })
      : ok(zoneRow()));
    await mount();
    await choose("Chicago", /^Chicago/);
    await act(async () => { button(/^Save time zone$/)!.click(); });
    await mount("tenant-b");
    await act(async () => { finish({ data: null, error: { code: "XX000" } }); });
    await flush();
    expect(text()).not.toContain("could not be saved");
    expect(text()).not.toContain("Saved and read back");
    expect(text()).toContain("Not set");
  });

  it("asks for the workspace instead of flashing a refusal when there is none", async () => {
    await mount(null);
    expect(text()).toContain("Open this business’s workspace to see its time zone.");
    expect(text()).not.toContain("Only the business owner");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("tells the owner when the server refuses, without relaying its text", async () => {
    rpc.mockImplementation((name: string) => name === "set_business_time_zone" ? fail("42501") : ok(zoneRow()));
    await mount();
    await choose("Denver", /^Denver/);
    await click(button(/^Save time zone$/));
    expect(text()).toContain("Only the business owner can change the business time zone");
    expect(text()).not.toContain("server text never shown");
  });

  it("cancel discards the choice and writes nothing", async () => {
    rpc.mockImplementation(() => ok(zoneRow()));
    await mount();
    await choose("Phoenix", /^Phoenix/);
    expect(confirmGroup()).toBeTruthy();
    await click(button(/^Cancel$/));
    expect(confirmGroup()).toBeNull();
    expect(rpc.mock.calls.every(([n]) => n === "read_business_time_zone")).toBe(true);
  });

  it("shows an admin the business zone read-only", async () => {
    rpc.mockImplementation(() => ok(zoneRow({ state: "configured", zone: "America/New_York", local_date: "2026-10-12", can_set: false })));
    await mount();
    expect(text()).toMatch(/America\/New_York · .* there now/);
    expect(text()).toContain("Only the business owner can change this.");
    expect(button(/^(Set time zone|Change)/)).toBeUndefined();
  });

  it("says plainly when a stored zone is not recognised", async () => {
    rpc.mockImplementation(() => ok(zoneRow({ state: "invalid" })));
    await mount();
    expect(text()).toContain("Saved time zone not recognised");
    expect(button(/^Set time zone/)).toBeTruthy();
  });

  it("explains a refused read, and offers retry on a failed one", async () => {
    rpc.mockImplementationOnce(() => fail("42501"));
    await mount();
    expect(text()).toContain("Only the business owner or an admin can see the business time zone");

    rpc.mockReset();
    rpc.mockImplementationOnce(() => fail("57014")).mockImplementation(() => ok(zoneRow()));
    await mount("tenant-b");
    expect(text()).toContain("could not be read. Nothing was changed.");
    await click(button(/^Retry$/));
    expect(text()).toContain("Not set");
  });

  it("drops a half-made choice and re-reads when the workspace changes", async () => {
    rpc.mockImplementation(() => ok(zoneRow()));
    await mount();
    await choose("Chicago", /^Chicago/);
    expect(confirmGroup()).toBeTruthy();
    await mount("tenant-b");
    expect(confirmGroup()).toBeNull();
    expect(rpc).toHaveBeenLastCalledWith("read_business_time_zone", { _expected_tenant_id: "tenant-b" });
  });

  it("matches whole words, so typing a city never highlights an unrelated zone", () => {
    // The default fuzzy match scored "Denver" against "Coordinated Universal Time" (letters in order),
    // so Enter picked UTC. Word matching hides it and ranks the place first.
    expect(zoneMatch("UTC|Coordinated Universal Time|GMT", "Denver")).toBe(0);
    expect(zoneMatch("America/Denver|Denver|Mountain Time", "Denver")).toBe(1);
    expect(zoneMatch("America/Denver|Denver|Mountain Time", "mountain")).toBe(0.8);
    expect(zoneMatch("America/Argentina/Buenos_Aires|Buenos Aires, Argentina|Argentina Time", "buenos ai")).toBe(1);
    expect(zoneMatch("America/North_Dakota/New_Salem|New Salem, North Dakota|Central Time", "dakota")).toBe(0.8);
    expect(zoneMatch("Europe/London|London|United Kingdom Time", "ondo")).toBe(0.4);
    expect(zoneMatch("Europe/London|London|United Kingdom Time", "")).toBe(1);
  });

  it("names places the way people say them", () => {
    expect(placeName("America/Chicago")).toBe("Chicago");
    expect(placeName("America/Argentina/Buenos_Aires")).toBe("Buenos Aires, Argentina");
    expect(placeName("UTC")).toBe("Coordinated Universal Time");
  });
});

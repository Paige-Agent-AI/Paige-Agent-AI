import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PREF_CONTACT, PREF_TENANT, ownerStatePayload, prefCard, prefUpdates } from "@/test/fixtures/clientPortalPreferences";
import { ownerSetBy } from "./clientCommunicationRows";

const f = vi.hoisted(() => ({ tenant: "e0960000-0000-4000-8000-00000000b001" as string | null, loading: false }));
const rpc = vi.fn();
vi.mock("@/hooks/useTenantContext", () => ({ useTenantContext: () => ({ activeTenantId: f.tenant, accountContextLoading: f.loading }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...args: unknown[]) => rpc(...args), from: () => { throw new Error("no raw table access"); } } }));
const { ClientCommunicationState } = await import("./ClientCommunicationState");
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root, host: HTMLDivElement;
async function flush() { await act(async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); }); }
async function mount(answer: { data: unknown; error: unknown } | Promise<never>, account: string | null = "42") {
  rpc.mockReturnValue(answer instanceof Promise ? answer : Promise.resolve(answer));
  act(() => root.render(<MemoryRouter><ClientCommunicationState contactId={PREF_CONTACT} clientName="Jordan Rivera" account={account} /></MemoryRouter>));
  await flush();
}
const rows = () => Object.fromEntries(Array.from(host.querySelectorAll(".trc-reach-row")).map(r => [r.querySelector("dt")!.textContent, r.querySelector("dd")!.textContent]));

beforeEach(() => { f.tenant = PREF_TENANT; f.loading = false; rpc.mockReset(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe("How {client} can be reached — the owner's read-only view", () => {
  it("reads the one derivation for this workspace and client, and shows every row", async () => {
    await mount({ data: ownerStatePayload({
      email: prefCard("off", { set_by: "you", set_at: "2026-10-12T15:00:00Z" }),
      sms: prefCard("on", { set_by: "reply", set_at: "2026-10-10T15:00:00Z" }),
      updates: prefUpdates("subscribed", { set_by: "you", set_at: "2026-10-09T15:00:00Z" }),
      data_sharing: { allowed: true, updated_at: "2026-10-08T15:00:00Z" },
      do_not_contact: true, dnd_active: true,
    }), error: null });
    expect(rpc).toHaveBeenCalledWith("read_client_communication_state", { _expected_tenant_id: PREF_TENANT, _contact_id: PREF_CONTACT });
    expect(host.querySelector("h3")?.textContent).toBe("How Jordan Rivera can be reached");
    expect(rows()).toEqual({
      Email: "OffSet by the client · Oct 12, 2026",
      Texts: "OnSet by their START reply · Oct 10, 2026",
      "Updates and offers": "SubscribedSet by the client · Oct 9, 2026",
      "Shared Paige context": "Allowed by the client · it has no effect yetOct 8, 2026",
      Portal: "Joined",
      "Do not contact (marketing)": "On · left out of marketing email",
      "Do not disturb": "On · Paige holds emails and texts while the hold lasts",
    });
  });

  // E09 Slice 7 round 2 (compliance 2): joined is the login link; a paused client keeps it, an ended one lost it.
  it.each([
    ["open", true, "Joined"],
    ["paused", true, "Joined · access paused, so they can’t open the portal"],
    ["ended", false, "Access ended · they need a new invitation to come back"],
    ["not_joined", false, "Not joined yet"],
  ] as const)("names portal access %s truthfully", async (portal_access, portal_joined, text) => {
    await mount({ data: ownerStatePayload({ portal_joined, portal_access }), error: null });
    expect(rows().Portal).toBe(text);
  });
  it("still reads an answer from before the access state existed", async () => {
    const { portal_access: _drop, ...older } = ownerStatePayload({ portal_joined: false }) as Record<string, unknown>;
    void _drop;
    await mount({ data: older, error: null });
    expect(rows().Portal).toBe("Not joined yet");
  });

  // E09 Slice 7 round 3 (low): a Pause or Restore on the record re-reads, so the Portal row follows it in the same session.
  it("reads again when the record's access state changes, and shows the new Portal row", async () => {
    rpc.mockReturnValue(Promise.resolve({ data: ownerStatePayload(), error: null }));
    act(() => root.render(<MemoryRouter><ClientCommunicationState contactId={PREF_CONTACT} clientName="Jordan Rivera" account="42" accessState="open" /></MemoryRouter>));
    await flush();
    expect(rows().Portal).toBe("Joined");
    rpc.mockReturnValue(Promise.resolve({ data: ownerStatePayload({ portal_access: "paused" }), error: null }));
    act(() => root.render(<MemoryRouter><ClientCommunicationState contactId={PREF_CONTACT} clientName="Jordan Rivera" account="42" accessState="paused" /></MemoryRouter>));
    await flush();
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rows().Portal).toBe("Joined · access paused, so they can’t open the portal");
    act(() => root.render(<MemoryRouter><ClientCommunicationState contactId={PREF_CONTACT} clientName="Jordan Rivera" account="42" accessState="paused" /></MemoryRouter>));
    await flush();
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("is read-only: no switch, no checkbox, and it points the one staff control to Conversations", async () => {
    await mount({ data: ownerStatePayload(), error: null });
    expect(host.querySelector('[role="switch"], input, [role="checkbox"]')).toBeNull();
    const foot = host.querySelector(".trc-reach-foot p")!.textContent;
    expect(foot).toBe("What Jordan turns off stays off until they turn it back on. Texts come on only from a START reply, a sign-up form, or consent your business records itself, which shows as Set by your business. You can pause email or texts in Conversations, and lift any pause Jordan didn’t set.");
    expect(host.querySelector("a")?.getAttribute("href")).toBe(`/solo/42/clients/conversations?contact=${PREF_CONTACT}`);
    expect(host.innerHTML).not.toMatch(/\bgold\b/);
  });

  it("names who held it, never as the client's choice when the business made it", async () => {
    await mount({ data: ownerStatePayload({ email: prefCard("off", { set_by: "business" }), sms: prefCard("not_set"), portal_joined: false }), error: null });
    expect(rows().Email).toBe("PausedSet by your business");
    expect(rows().Texts).toBe("Not set up · no START reply on record, so texts are held");
    expect(rows().Portal).toBe("Not joined yet");
    expect(host.querySelector('[data-paused] svg')).toBeTruthy();
  });

  it("business-recorded consent reads Set by your business on every channel (D7)", async () => {
    await mount({ data: ownerStatePayload({
      sms: prefCard("on", { set_by: "business", set_at: "2026-10-10T15:00:00Z" }),
      updates: prefUpdates("subscribed", { set_by: "business", set_at: "2026-10-09T15:00:00Z" }),
      email: prefCard("off", { set_by: "business", set_at: "2026-10-08T15:00:00Z" }),
    }), error: null });
    expect(rows().Texts).toBe("OnSet by your business · Oct 10, 2026");
    expect(rows()["Updates and offers"]).toBe("SubscribedSet by your business · Oct 9, 2026");
    expect(rows().Email).toBe("PausedSet by your business · Oct 8, 2026");
  });

  it("a spam report reads as the client's own, and only they can lift it (integrator default (owner may overrule))", async () => {
    await mount({ data: ownerStatePayload({ email: prefCard("off", { set_by: "reported", set_at: "2026-10-03T15:00:00Z", can_turn_off: false }) }), error: null });
    expect(rows().Email).toBe("Off · they reported email as spamOct 3, 2026Only they can turn it back on.");
    expect(host.textContent).not.toMatch(/delivery/);
  });

  it.each([
    ["you", "off", "the client"], ["business", "off", "your business"], ["reported", "off", "their spam report"], ["reply", "on", "their START reply"], ["reply", "off", "their STOP reply"],
    ["unsubscribe_link", "off", "their unsubscribe link"], ["delivery", "off", "delivery failures"], ["form", "on", "a sign-up form"], [null, "on", null],
  ] as const)("set by %s (%s) reads as %s", (by, state, text) => {
    expect(ownerSetBy(by, state)).toBe(text);
  });

  it("a refusal says who can see it; a failed read offers a retry and never shows a state", async () => {
    await mount({ data: null, error: { code: "42501", message: "Client unavailable" } });
    expect(host.textContent).toContain("Only the business owner or an admin can see how Jordan Rivera can be reached.");
    expect(host.querySelector(".trc-reach-row")).toBeNull();
    act(() => root.unmount()); root = createRoot(host);
    await mount({ data: null, error: { code: "PGRST000", message: "network" } });
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("We couldn’t check how Jordan Rivera can be reached.");
    rpc.mockReturnValue(Promise.resolve({ data: ownerStatePayload(), error: null }));
    const retry = Array.from(host.querySelectorAll("button")).find(b => b.textContent === "Try again")!;
    act(() => retry.click()); await flush();
    expect(rows().Email).toBe("On");
  });

  it.each([
    ["another client", { contact_id: "e0960000-0000-4000-8000-00000000d002" }],
    ["another business", { tenant_id: "e0960000-0000-4000-8000-00000000b002" }],
    ["a widened answer", { address: "jordan@example.test" }],
  ])("refuses an answer about %s", async (_label, over) => {
    await mount({ data: ownerStatePayload(over), error: null });
    expect(host.querySelector(".trc-reach-row")).toBeNull();
    expect(host.textContent).not.toContain("jordan@example.test");
  });

  it("no workspace, no read", async () => {
    f.tenant = null;
    await mount({ data: ownerStatePayload(), error: null });
    expect(rpc).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Open a business workspace");
  });

  it("loading shows a skeleton with a status line", async () => {
    await mount(new Promise<never>(() => {}));
    expect(host.querySelector(".trc-reach-skeleton")).toBeTruthy();
    expect(host.textContent).toContain("Checking how Jordan Rivera can be reached…");
  });
});

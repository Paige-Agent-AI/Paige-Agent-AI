import React, { act } from "react";
import { readFileSync } from "node:fs";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RelationshipPerson } from "./useTenantRelationshipsData";

/**
 * E09 Slice 7 — the portal card on the Solo client record. What these cases protect:
 *   - the owner sees the server's state, never a painted guess: success is reported only after a
 *     fresh read says so (§70.1);
 *   - a reason is required to pause or end, and the note is the owner's own (never model-supplied);
 *   - Restore is the one gold act (§11); Pause and End are not;
 *   - a stale version, a concurrent change (40P01) and a refusal each say what happened in words.
 */
const f = vi.hoisted(() => ({
  rpc: vi.fn(),
  getSession: vi.fn(),
  invalidate: vi.fn(),
  invitations: [] as Array<Record<string, unknown>>,
  context: { activeTenantId: "test-tenant-a", activeUserId: "test-owner-a", activeTenant: { name: "Test Studio" } as { name: string } | null },
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => f.rpc(...a), auth: { getSession: () => f.getSession() } } }));
vi.mock("@/hooks/useTenantContext", () => ({ useTenantContext: () => f.context }));
vi.mock("./usePortalInvitations", () => ({ usePortalInvitations: () => ({ data: f.invitations, isLoading: false, isError: false, invalidate: () => Promise.resolve() }) }));
vi.mock("./PortalConfigurationGate", () => ({ PortalConfigurationGate: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("./PortalInvitationManager", () => ({
  PortalInvitationManager: ({ person, latest }: { person: RelationshipPerson; latest?: { id: string } }) => <div data-invitation-manager={person.id} data-linked={String(person.linkedUserId)} data-latest={latest?.id ?? "none"} />,
}));
import { ClientPortalAccess } from "./ClientPortalAccess";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const person = { id: "test-contact-a", name: "Jordan Test", email: "jordan@tests.invalid", linkedUserId: "test-customer-a", status: "active", doNotContact: false, portalAccess: "open" } as unknown as RelationshipPerson;
const read = (over: Record<string, unknown> = {}) => ({
  state: "open", joined: true, since: null, changed_by_name: null, reason: null, note: null,
  invitation: { status: "accepted" }, can: { pause: true, restore: false, end: true, invite: false }, restore_blocked_by: null, ...over,
});
const paused = read({ state: "paused", since: "2026-10-18T12:00:00Z", changed_by_name: "Test Owner", reason: "payment", note: "Waiting on the October invoice",
  can: { pause: false, restore: true, end: true, invite: false } });
const ended = read({ state: "ended", joined: false, since: "2026-10-18T12:00:00Z", changed_by_name: "Test Owner", reason: "engagement_ended",
  invitation: { status: "accepted" }, can: { pause: false, restore: false, end: false, invite: true } });

let host: HTMLDivElement, root: Root;
let reads: unknown[];
let writer: () => Promise<unknown>;
const onAccessChange = vi.fn();
const flush = () => act(async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); });
const show = async (p: RelationshipPerson = person) => {
  await act(async () => root.render(<ClientPortalAccess person={p} onAccessChange={onAccessChange} onOpenPortal={() => {}} onChanged={f.invalidate} />));
  await flush();
};
const button = (name: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === name);
const click = async (name: string) => { const b = button(name); expect(b, name).toBeTruthy(); await act(async () => b!.click()); await flush(); };
const choose = async (label: string) => {
  const radio = [...host.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find((r) => r.getAttribute("aria-label") === label || r.parentElement?.textContent?.includes(label));
  expect(radio, label).toBeTruthy();
  await act(async () => radio!.click()); await flush();
};
const writes = () => f.rpc.mock.calls.filter(([name]) => name === "set_client_portal_access");

beforeEach(() => {
  vi.clearAllMocks();
  f.invitations = [];
  f.context = { activeTenantId: "test-tenant-a", activeUserId: "test-owner-a", activeTenant: { name: "Test Studio" } };
  reads = [read()];
  writer = () => Promise.resolve({ data: { ok: true, replayed: false }, error: null });
  f.getSession.mockResolvedValue({ data: { session: { user: { id: "test-owner-a" } } }, error: null });
  f.rpc.mockImplementation((name: string) => {
    if (name === "read_client_portal_access") {
      const next = reads.length > 1 ? reads.shift() : reads[0];
      if (next instanceof Promise) return next;
      if (next && typeof next === "object" && "raw" in next) return Promise.resolve((next as { raw: unknown }).raw);
      return Promise.resolve({ data: next, error: null });
    }
    if (name === "set_client_portal_access") return writer();
    return Promise.resolve({ data: null, error: null });
  });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe("Portal access card on the client record", () => {
  it("reads this contact in the current workspace and offers Pause and End to a joined client", async () => {
    await show();
    expect(f.rpc).toHaveBeenCalledWith("read_client_portal_access", { _expected_tenant_id: "test-tenant-a", _contact_id: "test-contact-a" });
    expect(host.textContent).toContain("Jordan can open your portal");
    expect(button("Pause access")).toBeTruthy();
    expect(button("End access")).toBeTruthy();
    expect(host.querySelectorAll("[data-gold]")).toHaveLength(0);
  });

  it("requires a reason to pause, then writes the exact request with the version it read", async () => {
    reads = [read({ since: "2026-10-01T00:00:00Z" }), paused];
    await show();
    await click("Pause access");
    expect(host.textContent).toContain("Pause Jordan Test’s portal access?");
    expect(host.textContent).toContain("Emails and texts you send them aren’t affected");
    expect(host.textContent).toContain("Only your team sees this");
    expect(button("Pause access")?.disabled).toBe(true);
    await choose("Payment");
    const note = host.querySelector<HTMLTextAreaElement>("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(note, "  Waiting on the October invoice  ");
      note.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click("Pause access");
    expect(writes()).toHaveLength(1);
    expect(writes()[0][1]).toEqual({
      p_expected_actor_id: "test-owner-a", p_expected_tenant_id: "test-tenant-a", p_contact_id: "test-contact-a",
      p_action: "pause", p_reason: "payment", p_note: "Waiting on the October invoice", p_expected_changed_at: "2026-10-01T00:00:00Z",
    });
    expect(host.textContent).toContain("Access paused");
    expect(host.textContent).toContain("Paused. Jordan will see that their access is paused the next time they open your portal.");
    expect(onAccessChange).toHaveBeenLastCalledWith("paused", true);
    expect(f.invalidate).toHaveBeenCalled();
  });

  it("never reports success before the fresh read returns", async () => {
    let release!: (v: unknown) => void;
    reads = [read(), new Promise((r) => { release = r; })];
    await show();
    await click("Pause access"); await choose("Payment"); await click("Pause access");
    expect(writes()).toHaveLength(1);
    expect(host.textContent).not.toContain("Paused. Jordan");
    expect(host.textContent).not.toContain("Access paused");
    await act(async () => release({ data: paused, error: null })); await flush();
    expect(host.textContent).toContain("Paused. Jordan");
  });

  it("a write acknowledged but not reflected in the fresh read is reported as unconfirmed", async () => {
    reads = [read(), read()];
    await show();
    await click("Pause access"); await choose("Payment"); await click("Pause access");
    expect(host.textContent).not.toContain("Paused. Jordan");
    expect(host.textContent).toContain("We couldn’t confirm whether that changed");
  });

  it("a stale version says what happened and refreshes to the current state", async () => {
    reads = [read(), paused];
    writer = () => Promise.resolve({ data: { ok: false, error: "ACCESS_CHANGED" }, error: null });
    await show();
    await click("Pause access"); await choose("Payment"); await click("Pause access");
    expect(host.textContent).toContain("This changed since you opened it");
    expect(host.textContent).toContain("Access paused");
  });

  it("a concurrent invitation acceptance (40P01) is a change, not a raw error", async () => {
    reads = [read(), read()];
    writer = () => Promise.resolve({ data: null, error: { code: "40P01", message: "deadlock detected PRIVATE" } });
    await show();
    await click("End access"); await choose("Our work together has ended"); await click("End access");
    expect(host.textContent).toContain("This changed since you opened it");
    expect(host.textContent).not.toContain("PRIVATE");
  });

  it("End names what the team stops seeing and that a new invitation brings them back", async () => {
    await show();
    await click("End access");
    expect(host.textContent).toContain("To bring them back you’ll send a new invitation");
    expect(host.textContent).toContain("Anything they connected under their own login stops showing here until they rejoin");
    expect(host.textContent).toContain("Their history stays on this contact");
    expect(host.textContent).not.toContain("Nothing is deleted");
  });

  it("a paused client shows when, by whom and why, with Restore as the only gold act", async () => {
    reads = [paused];
    await show();
    expect(host.textContent).toContain("Access paused");
    expect(host.textContent).toContain("Test Owner");
    expect(host.textContent).toContain("Payment");
    expect(host.textContent).toContain("Waiting on the October invoice");
    const gold = host.querySelectorAll("[data-gold]");
    expect(gold).toHaveLength(1);
    expect(gold[0].textContent?.trim()).toBe("Restore access");
    expect(button("End access")).toBeTruthy();
    expect(button("Pause access")).toBeFalsy();
  });

  it("restore takes no reason and reads back open", async () => {
    reads = [paused, read({ since: "2026-10-19T00:00:00Z" })];
    await show();
    await click("Restore access");
    expect(host.querySelectorAll('[role="radio"]')).toHaveLength(0);
    await click("Restore access");
    expect(writes()[0][1]).toMatchObject({ p_action: "restore", p_reason: null, p_note: null, p_expected_changed_at: "2026-10-18T12:00:00Z" });
    expect(host.textContent).toContain("Restored. Jordan can open your portal again.");
    expect(onAccessChange).toHaveBeenLastCalledWith("open", true);
  });

  it("restore blocked by an inactive record says why and offers no Restore", async () => {
    reads = [read({ ...paused, can: { pause: false, restore: false, end: true, invite: false }, restore_blocked_by: "contact_inactive" })];
    await show();
    expect(host.textContent).toContain("record isn’t active");
    expect(button("Restore access")?.disabled ?? true).toBe(true);
  });

  it("an ended client is invited again through the existing invitation manager, unlinked", async () => {
    reads = [ended];
    await show({ ...person, linkedUserId: "stale-roster-link" } as RelationshipPerson);
    expect(host.textContent).toContain("Access ended");
    expect(host.textContent).toContain("Our work together has ended");
    expect(host.querySelector("[data-invitation-manager]")).toBeNull();
    await click("Invite again");
    const manager = host.querySelector("[data-invitation-manager]")!;
    expect(manager.getAttribute("data-invitation-manager")).toBe("test-contact-a");
    expect(manager.getAttribute("data-linked")).toBe("null");
    expect(host.textContent).toContain("they’ll see your earlier messages and shared work");
  });

  it("a refused read (another role) offers no controls", async () => {
    reads = [{ raw: { data: null, error: { code: "42501" } } }];
    await show();
    expect(host.textContent).toContain("Only the business owner or an admin");
    expect(button("Pause access")).toBeFalsy();
    expect(button("End access")).toBeFalsy();
  });

  it("an unreadable read offers a retry and no controls", async () => {
    reads = [{ raw: { data: { state: "open" }, error: null } }];
    await show();
    expect(host.textContent).toContain("couldn’t check");
    expect(button("Try again")).toBeTruthy();
    expect(button("Pause access")).toBeFalsy();
  });

  it("an account change before the write sends nothing", async () => {
    f.getSession.mockResolvedValue({ data: { session: { user: { id: "someone-else" } } }, error: null });
    await show();
    await click("Pause access"); await choose("Payment"); await click("Pause access");
    expect(writes()).toHaveLength(0);
    expect(host.textContent).toContain("Your account changed");
  });

  it("a client who has not joined is pointed at the invitation home, with no access controls", async () => {
    reads = [read({ joined: false, invitation: { status: "pending" }, can: { pause: false, restore: false, end: false, invite: false } })];
    await show({ ...person, linkedUserId: null } as RelationshipPerson);
    expect(host.textContent).toContain("hasn’t joined your portal yet");
    expect(button("Pause access")).toBeFalsy();
    expect(button("Open Portal invitations")).toBeTruthy();
  });

  // Round-2 review 9: the invitation they joined with is spent. Under "Access ended", "Latest
  // invitation: accepted" contradicted the state above it, so only a still-relevant one is passed.
  it("Invite again never shows the spent joining invitation as the latest one", async () => {
    f.invitations = [
      { id: "inv-joined", contact_id: "test-contact-a", last_used_at: "2026-10-02T00:00:00Z", revoked_at: null, expires_at: "2026-11-01T00:00:00Z" },
    ];
    reads = [ended];
    await show();
    await click("Invite again");
    expect(host.querySelector("[data-invitation-manager]")?.getAttribute("data-latest")).toBe("none");
    f.invitations = [...f.invitations, { id: "inv-new", contact_id: "test-contact-a", last_used_at: null, revoked_at: null, expires_at: "2026-11-20T00:00:00Z" }];
    await show();
    expect(host.querySelector("[data-invitation-manager]")?.getAttribute("data-latest")).toBe("inv-new");
  });

  // Round-2 review 13: copy says only what is true.
  it("End's success offers another invitation only when one is allowed", async () => {
    reads = [read(), { ...ended, can: { pause: false, restore: false, end: false, invite: false } }];
    await show();
    await click("End access");
    await choose("Our work together has ended");
    const confirm = [...host.querySelectorAll<HTMLButtonElement>(".trc-access-confirm button")].find((b) => b.textContent?.trim() === "End access")!;
    await act(async () => confirm.click()); await flush();
    expect(host.textContent).toContain("Ended. Jordan will see that their access has ended.");
    expect(host.textContent).not.toMatch(/invite them again/i);
  });

  it("the paused summary says when the client finds out, and the chip is not the warning amber", async () => {
    reads = [paused];
    await show();
    expect(host.textContent).toContain("When Jordan opens your portal, they see that their access is paused.");
    const chip = host.querySelector('.trc-access-state[data-state="paused"]')!;
    expect(chip.querySelector("svg")).not.toBeNull();
  });

  it("figures are tabular only on the date, so the reason, the note and the hint read as prose (compliance r2 gap 4)", async () => {
    reads = [paused];
    await show();
    const values = [...host.querySelectorAll(".trc-access-facts dd")];
    const dated = values.filter((dd) => dd.hasAttribute("data-date"));
    expect(dated).toHaveLength(1);
    expect(dated[0].previousElementSibling?.textContent).toBe("Paused");
    expect(values.find((dd) => dd.textContent === "Payment")?.hasAttribute("data-date")).toBe(false);
    // jsdom does not apply the stylesheet, so the rules are read from it: prose overrides the shell
    // root's inherited tabular-nums, and only the dated value turns it back on.
    const css = readFileSync("src/components/tenant-relationships/client-portal-access.css", "utf8");
    const rule = (selector: string) => css.match(new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{([^}]*)\\}`))?.[1] ?? "";
    expect(rule(".trc-access")).toMatch(/font-variant-numeric: normal/);
    expect(rule(".trc-access-facts dd")).toMatch(/font-variant-numeric: normal/);
    expect(rule(".trc-access-facts dd[data-date]")).toMatch(/font-variant-numeric: tabular-nums/);
    expect(rule(".trc-access-field p")).toMatch(/font-variant-numeric: normal/);
    expect(css.match(/tabular-nums/g)).toHaveLength(1);
  });
});

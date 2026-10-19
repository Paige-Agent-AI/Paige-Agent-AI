import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));
import { readFileSync } from "node:fs";
import {
  customerAccessCopy, fetchWithheldCustomerAccess, impersonationAccessRefusal, portalAccessConfirmCopy, readCustomerPortalAccess,
  readOwnerPortalAccess, setPortalAccess, IMPERSONATION_ACCESS_ENDED, IMPERSONATION_ACCESS_PAUSED,
} from "./client-portal-access";
import { portalAccessClientLabel, portalAccessClientName, portalAccessConfirmSummary } from "../../supabase/functions/_shared/client-portal-access";

const owner = { state: "paused", joined: true, since: "2026-10-18T12:00:00Z", changed_by_name: "Test Owner", reason: "payment", note: "n",
  invitation: { status: "accepted" }, can: { pause: false, restore: true, end: true, invite: false }, restore_blocked_by: null };
beforeEach(() => rpc.mockReset());

describe("client portal access contract (E09 Slice 7)", () => {
  it("reads the owner projection and refuses one whose state and link disagree", () => {
    expect(readOwnerPortalAccess(owner)?.state).toBe("paused");
    expect(readOwnerPortalAccess({ ...owner, joined: false })).toBeNull();
    expect(readOwnerPortalAccess({ ...owner, state: "ended", joined: true })).toBeNull();
    expect(readOwnerPortalAccess({ ...owner, reason: "secret_internal" })).toBeNull();
    expect(readOwnerPortalAccess({ ...owner, since: "not a date" })).toBeNull();
  });

  it("the customer read keeps the business's public presentation only — never a reason or a note", () => {
    const read = readCustomerPortalAccess({ state: "paused", business: { name: " Test Studio ", logo_url: "" }, since: null, reason: "payment", note: "private" });
    expect(read).toEqual({ state: "paused", businessName: "Test Studio", logoUrl: null, logoDarkUrl: null, since: null });
    expect(readCustomerPortalAccess({ state: "paused", business: { name: "" } })).toBeNull();
    expect(readCustomerPortalAccess({ state: "suspended" })).toBeNull();
  });

  it("treats a reader that does not exist yet as nothing withheld, and any other failure as unknown", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "PGRST202" } });
    await expect(fetchWithheldCustomerAccess()).resolves.toBeNull();
    rpc.mockResolvedValue({ data: null, error: { code: "500" } });
    await expect(fetchWithheldCustomerAccess()).rejects.toThrow();
    rpc.mockResolvedValue({ data: { state: "paused" }, error: null });
    await expect(fetchWithheldCustomerAccess()).rejects.toThrow();
    rpc.mockResolvedValue({ data: { state: "open" }, error: null });
    await expect(fetchWithheldCustomerAccess()).resolves.toBeNull();
  });

  it("the writer sends no reason or note on restore, trims the note, and maps a lock conflict to a change", async () => {
    rpc.mockResolvedValue({ data: { ok: true, replayed: true }, error: null });
    await expect(setPortalAccess({ actorId: "a", tenantId: "t", contactId: "c", action: "restore", reason: "payment", note: "x", expectedChangedAt: null }))
      .resolves.toMatchObject({ ok: true, replayed: true, code: null });
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_action: "restore", p_reason: null, p_note: null });
    await setPortalAccess({ actorId: "a", tenantId: "t", contactId: "c", action: "pause", reason: "payment", note: "   ", expectedChangedAt: null });
    expect(rpc.mock.calls[1][1]).toMatchObject({ p_reason: "payment", p_note: null });
    for (const code of ["40P01", "55P03"]) {
      rpc.mockResolvedValue({ data: null, error: { code } });
      await expect(setPortalAccess({ actorId: "a", tenantId: "t", contactId: "c", action: "end", reason: "other", note: null, expectedChangedAt: null }))
        .resolves.toMatchObject({ ok: false, code: "ACCESS_CHANGED" });
    }
    rpc.mockResolvedValue({ data: { ok: false, error: "SOMETHING_NEW" }, error: null });
    await expect(setPortalAccess({ actorId: "a", tenantId: "t", contactId: "c", action: "end", reason: "other", note: null, expectedChangedAt: null }))
      .resolves.toMatchObject({ ok: false, code: "UNCONFIRMED" });
  });

  it("says nothing it can't stand behind (review MEDIUM-7)", () => {
    const all = [...(["pause", "end", "restore"] as const).flatMap((a) => portalAccessConfirmCopy(a, "Jordan Test", "Test Studio").lines),
      customerAccessCopy("paused", "Test Studio").body, customerAccessCopy("ended", "Test Studio").body].join(" ");
    expect(all).not.toMatch(/Nothing is deleted|every read|documents are kept/i);
    expect(customerAccessCopy("paused", "Test Studio").body).toContain("Your portal messages and files are kept.");
    // Restore can be refused (an inactive or merged record, an inactive business), so never "at any time".
    expect(all).not.toMatch(/at any time/i);
    expect(portalAccessConfirmCopy("pause", "Jordan Test", "Test Studio").lines[0]).toContain("You can restore it later.");
  });

  // Round 3 (security 1): pause and end revoke a signing link the portal issued (S7-D1), and that link had
  // replaced the emailed one — so "agreements stay as they are" alone would leave the owner never resending.
  it("pause and end name the signing link they stop, and tell the owner to resend it; restore does not", () => {
    const line = "A signing link they opened from your portal stops working; resend it if they still need to sign.";
    for (const action of ["pause", "end"] as const) expect(portalAccessConfirmCopy(action, "Jordan Test", "Test Studio").lines).toContain(line);
    expect(portalAccessConfirmCopy("restore", "Jordan Test", "Test Studio").lines.join(" ")).not.toMatch(/signing link/);
  });

  it("reads the writer's restore blocker, which it names `reason` (20271111010000)", async () => {
    rpc.mockResolvedValue({ data: { ok: false, error: "ACCESS_RESTORE_UNAVAILABLE", reason: "contact_merged" }, error: null });
    await expect(setPortalAccess({ actorId: "a", tenantId: "t", contactId: "c", action: "restore", reason: null, note: null, expectedChangedAt: null }))
      .resolves.toMatchObject({ ok: false, code: "ACCESS_RESTORE_UNAVAILABLE", restoreBlockedBy: "contact_merged" });
  });

  // Round-2 review: the chat approval card is the highest-risk card in this family. It names the
  // client and the reason being approved, and claims neither "nothing is deleted" nor "one click".
  it("the chat approval card names the client and the reason, and overclaims nothing", () => {
    const contact = "e0938000-0000-0000-0000-000000000001";
    const end = portalAccessConfirmSummary({ contact_id: contact, action: "end", reason: "engagement_ended" }, "Jordan Rivera");
    expect(end).toContain("End Jordan Rivera's portal access.");
    expect(end).toContain("Reason: Our work together has ended (only your team sees it).");
    const pause = portalAccessConfirmSummary({ contact_id: contact, action: "pause", reason: "payment" }, "Sam Okafor");
    expect(pause).toContain("Pause Sam Okafor's portal access.");
    expect(pause).toContain("Reason: Payment");
    const restore = portalAccessConfirmSummary({ contact_id: contact, action: "restore" }, "Sam Okafor");
    expect(restore).toBe("Restore Sam Okafor's portal access. They can open your portal again. They won't be emailed.");
    // No name resolved: the card says "this client" rather than inventing one.
    expect(portalAccessConfirmSummary({ contact_id: contact, action: "end", reason: "other" })).toContain("End this client's portal access.");
    for (const line of [end, pause, restore]) expect(line).not.toMatch(/one click|nothing is deleted|exactly as/i);
  });

  it("Paige's tool descriptions make no deletion or one-click claim", () => {
    const spine = readFileSync("supabase/functions/_shared/paige-spine/domains/client_portal.ts", "utf8");
    expect(spine).not.toMatch(/Nothing is deleted|one click|exactly as they left it/);
  });

  it("the card's name comes from the contact row on the caller's own session, scoped to the workspace", async () => {
    const eq = vi.fn(() => chain);
    const chain = { select: vi.fn(() => chain), eq, maybeSingle: vi.fn(async () => ({ data: { first_name: " Jordan ", last_name: "Rivera", entity_name: null }, error: null })) };
    const client = { from: vi.fn(() => chain) };
    const tenant = "e0928000-0000-0000-0000-000000000001", contact = "e0938000-0000-0000-0000-000000000001";
    await expect(portalAccessClientName(client, tenant, contact)).resolves.toBe("Jordan Rivera");
    expect(eq).toHaveBeenCalledWith("tenant_id", tenant);
    await expect(portalAccessClientName(client, tenant, "not-a-uuid")).resolves.toBeNull();
    expect(portalAccessClientLabel({ first_name: null, last_name: null, entity_name: "Northwind Studio" })).toBe("Northwind Studio");
  });

  it("impersonation names a paused or ended client using the server's exact messages (pinned to the migration)", () => {
    const migration = readFileSync("supabase/migrations/20271111010000_e09_customer_portal_access.sql", "utf8");
    expect(migration).toContain(`RAISE EXCEPTION '${IMPERSONATION_ACCESS_ENDED}'`);
    expect(migration).toContain(`RAISE EXCEPTION '${IMPERSONATION_ACCESS_PAUSED}'`);
    expect(impersonationAccessRefusal(`ERROR: ${IMPERSONATION_ACCESS_ENDED}`)).toContain("has ended");
    expect(impersonationAccessRefusal(IMPERSONATION_ACCESS_PAUSED)).toContain("is paused");
    expect(impersonationAccessRefusal("Client has not accepted their invite yet.")).toBeNull();
  });

  it("restore copy does not promise everything is exactly as before (review 13)", () => {
    expect(portalAccessConfirmCopy("restore", "Jordan Rivera", "Northwind Studio").lines.join(" ")).not.toMatch(/exactly as/);
  });

  it("the customer page never points to a contact channel it doesn't show (review 11)", () => {
    expect(customerAccessCopy("paused", "Northwind Studio").body).not.toMatch(/directly/);
  });
});

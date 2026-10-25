import { describe, expect, it } from "vitest";
import { classifyPresence } from "./useSocialCommand";

/**
 * The presence classification, tested as a function rather than grepped as a string.
 *
 * WHY THIS FILE EXISTS. `useSocialCommand` had no executed test at all — the contract suite reads
 * it as source text and asserts with regexes — so `unreadable`, the entire basis of the
 * `handlesUnknown` chain and of two §13 fixes, could be reverted to `refused` and break nothing.
 * The §39 peer-gate proved exactly that. A guard that cannot fail is not a guard, so the decision
 * moved into a pure function and the assertions moved onto its output.
 *
 * The shapes below are the ones `get_social_presence_evidence` actually returns
 * (`supabase/migrations/20261210000000_a_business_can_record_the_accounts_it_posts_from.sql`):
 * one row per network, refused together rather than per-network, with three distinct reasons.
 */
const row = (over: Record<string, unknown> = {}) => ({
  network: "instagram", status: "on_record", handle: "@acme", reason: null, tenant_id: "t1", as_of: null,
  connection_status: null, connection_label: null, connection_verified_at: null, connection_profiles: null, ...over,
} as never);

const refusedRows = (reason: string) =>
  ["instagram", "facebook", "linkedin", "youtube", "tiktok", "x"].map((network) =>
    row({ network, status: "unavailable", handle: null, reason }));

describe("classifyPresence — a response that carries no answer is not an answer of none", () => {
  it("reads real rows as accounts on record", () => {
    const out = classifyPresence([row(), row({ network: "linkedin", handle: "acme-co" })]);
    expect(out.handles.map((h) => h.handle)).toEqual(["@acme", "acme-co"]);
    expect(out.refused).toBe(false);
    expect(out.unreadable).toBe(false);
  });

  /**
   * THE COMBINATION NO TEST REACHED. Every earlier test set `notPermitted` and `handlesUnknown`
   * together — i.e. only the refusal that already worked. `refused` is a STRICT SUBSET of
   * `unreadable`, and the two refusals in the gap were rendering "No account is on record".
   */
  it.each([
    ["not permitted for this account", true],
    ["workspace record not readable", false],
    ["workspace not resolved", false],
  ])("treats the %s refusal as unread (refused=%s)", (reason, expectedRefused) => {
    const out = classifyPresence(refusedRows(reason as string));
    expect(out.unreadable, `${reason} must be unreadable`).toBe(true);
    expect(out.refused, `${reason} refused flag`).toBe(expectedRefused);
    expect(out.handles).toEqual([]);
  });

  // EXP07 row 9 — the readiness columns classify from the same rows.
  it("carries each network's connection readiness, translated never", () => {
    const out = classifyPresence([
      row({ connection_status: "connected", connection_label: "Main", connection_verified_at: "2026-10-20T10:00:00Z", connection_profiles: 1 }),
      row({ network: "x", handle: "@acme", connection_status: "needs_reauth", connection_label: null, connection_verified_at: null, connection_profiles: null }),
      row({ network: "facebook", handle: "acme", connection_status: null, connection_label: null, connection_verified_at: null, connection_profiles: null }),
    ]);
    expect(out.connections).toHaveLength(2);
    expect(out.connections[0]).toMatchObject({ network: "instagram", status: "connected", label: "Main", profiles: 1 });
    expect(out.connections[1]).toMatchObject({ network: "x", status: "needs_reauth", label: null, profiles: 1 });
  });

  it("an unread read yields no readiness either — never guessed from a handle", () => {
    const out = classifyPresence(refusedRows("workspace record not readable"));
    expect(out.connections).toEqual([]);
    const out2 = classifyPresence([]);
    expect(out2.connections).toEqual([]);
  });

  it("an unknown status string is dropped, not guessed", () => {
    const out = classifyPresence([row({ connection_status: "half-connected" })]);
    expect(out.connections).toEqual([]);
  });

  it("every refusal is unreadable, so the subset can never be the wider gate", () => {
    for (const reason of ["not permitted for this account", "workspace record not readable", "workspace not resolved"]) {
      const out = classifyPresence(refusedRows(reason));
      // The property the Channels panel depends on: refused ⊆ unreadable, never the reverse.
      expect(out.refused && !out.unreadable).toBe(false);
    }
  });

  it("treats a response with NO rows as unread, not as an empty workspace", () => {
    // The call site coerces a non-array body to []. Failing the other way said "No account is on
    // record" about a body nobody could parse — the opposite default from `campaignsUnknown`.
    const out = classifyPresence([]);
    expect(out.unreadable).toBe(true);
    expect(out.refused).toBe(false);
    expect(out.handles).toEqual([]);
  });

  it("a workspace that genuinely has no accounts is NOT unread", () => {
    // The honest empty: the read succeeded and every network came back with nothing recorded.
    const out = classifyPresence(
      ["instagram", "facebook"].map((network) => row({ network, status: "not_recorded", handle: null })),
    );
    expect(out.unreadable).toBe(false);
    expect(out.refused).toBe(false);
    expect(out.handles).toEqual([]);
  });

  it("drops a blank handle rather than recording an empty account", () => {
    expect(classifyPresence([row({ handle: "   " })]).handles).toEqual([]);
  });
});

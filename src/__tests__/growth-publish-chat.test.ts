// @vitest-environment node
// Chat's three publish tools are SELECTION ONLY: they hand the act to the one publish door
// (growth-publish-command) and run no RPC of their own. A first call becomes the door's card; an
// approved card sends the STORED artifact id and the fingerprint back to the door, which alone claims.
import { describe, expect, it } from "vitest";
import { dispatchGrowthPublishChat, GROWTH_PUBLISH_DOOR_TOOL_NAMES } from "../../supabase/functions/_shared/growth-publish-chat.ts";
import { classifyStudioRun, DOOR_FILED_STUDIO_TOOLS, STUDIO_RECEIPT_KEYS } from "../../supabase/functions/_shared/studio-run-outcome.ts";
import { classifySpentApproval } from "../../supabase/functions/_shared/approval-outcome.ts";

const TENANT = "11111111-1111-4111-8111-111111111111";
const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PAGE = "33333333-3333-4333-8333-333333333333";
const OTHER = "77777777-7777-4777-8777-777777777777";
const FP = "0123456789abcdef";

function deps(opts: { rows?: Array<Record<string, unknown>>; lookupError?: boolean; answer?: { data: unknown; error: unknown } | (() => never) }) {
  const invoked: Array<Record<string, unknown>> = [];
  const filters: unknown[][] = [];
  const q: Record<string, unknown> = {};
  for (const op of ["eq", "in", "is", "not", "gt"]) q[op] = (...a: unknown[]) => { filters.push([op, ...a]); return q; };
  q.limit = async () => ({ data: opts.lookupError ? null : opts.rows ?? [], error: opts.lookupError ? { message: "down" } : null });
  return {
    invoked, filters,
    d: {
      admin: { from: () => ({ select: () => q as never }) },
      invoke: async (body: Record<string, unknown>) => {
        invoked.push(body);
        if (typeof opts.answer === "function") opts.answer();
        return (opts.answer as { data: unknown; error: unknown }) ?? { data: null, error: null };
      },
    },
  };
}
const ctx = (over: Record<string, unknown> = {}) => ({ tenantId: TENANT, userId: USER, toolName: "growth_page_publish", args: { page_id: PAGE }, approved: new Set<string>(), sameToolCalls: 1, ...over });
const httpError = (body: unknown) => ({ data: null, error: { name: "FunctionsHttpError", context: { json: async () => body } } });

describe("chat publish → the one door", () => {
  it("covers exactly the three chat publish tools, and the chat files no receipt for them", () => {
    expect([...GROWTH_PUBLISH_DOOR_TOOL_NAMES].sort()).toEqual(["growth_form_publish", "growth_funnel_publish", "growth_page_publish"]);
    expect([...DOOR_FILED_STUDIO_TOOLS].sort()).toEqual([...GROWTH_PUBLISH_DOOR_TOOL_NAMES].sort());
  });

  it("a first call asks the door and turns its 202 into the Needs-your-OK card", async () => {
    const t = deps({ answer: { data: { ok: false, approval_required: true, fingerprint: FP, summary: 'Publish the page "Spring offer" at /p/acme/spring-offer.', preview: { kind: "page" } }, error: null } });
    const r = await dispatchGrowthPublishChat(ctx(), t.d);
    expect(t.invoked).toEqual([{ action: "publish", kind: "page", id: PAGE, expected_tenant_id: TENANT, chat_attempt: true }]);
    expect(r.content).toMatchObject({ success: false, needs_confirm: true, confirm_fingerprint: FP, confirm_summary: expect.stringContaining("Spring offer") });
    expect(r.spent).toBeUndefined();
  });

  it("an approved card sends the STORED id and the fingerprint, even when the model re-emits a different id", async () => {
    const t = deps({ rows: [{ fingerprint: FP, args: { action: "publish", kind: "page", id: PAGE, expected_tenant_id: TENANT, approval_subject: `publish:page:${PAGE}` } }],
      answer: { data: { ok: true, id: PAGE, status: "published", published_at: "2026-10-04T10:00:00Z", url: "/p/acme/spring-offer" }, error: null } });
    const r = await dispatchGrowthPublishChat(ctx({ args: { page_id: OTHER, confirm: true }, approved: new Set([FP]) }), t.d);
    expect(t.invoked).toEqual([{ action: "publish", kind: "page", id: PAGE, expected_tenant_id: TENANT, chat_attempt: true, approved_fingerprint: FP }]);
    expect(r).toMatchObject({ spent: FP, tokens: [FP], content: { success: true, url: "/p/acme/spring-offer", page_id: PAGE } });
    expect(classifySpentApproval(JSON.stringify(r.content)).outcome).toBe("ran");
    // The lookup is scoped to this person, workspace, act, and the door's thread-less live proposals.
    expect(t.filters).toEqual(expect.arrayContaining([["eq", "tenant_id", TENANT], ["eq", "user_id", USER], ["eq", "tool_name", "growth_page_publish"], ["is", "thread_id", null], ["is", "consumed_at", null]]));
  });

  it("two live approvals and two calls: ambiguous, nothing sent", async () => {
    const row = (fp: string, id: string) => ({ fingerprint: fp, args: { action: "publish", kind: "page", id, expected_tenant_id: TENANT, approval_subject: `publish:page:${id}` } });
    const t = deps({ rows: [row(FP, PAGE), row("fedcba9876543210", OTHER)] });
    const r = await dispatchGrowthPublishChat(ctx({ args: { page_id: "88888888-8888-4888-8888-888888888888" }, approved: new Set([FP, "fedcba9876543210"]), sameToolCalls: 2 }), t.d);
    expect(r.refusal).toBe("ambiguous");
    expect(t.invoked).toHaveLength(0);
  });

  it("a stored proposal from another act or workspace is unclaimable", async () => {
    const t = deps({ rows: [{ fingerprint: FP, args: { action: "unpublish", kind: "page", id: PAGE, expected_tenant_id: TENANT, approval_subject: `publish:page:${PAGE}` } }] });
    expect((await dispatchGrowthPublishChat(ctx({ approved: new Set([FP]) }), t.d)).refusal).toBe("unclaimable");
    expect(t.invoked).toHaveLength(0);
  });

  it("an approval lookup that fails refuses honestly and sends nothing", async () => {
    const t = deps({ lookupError: true });
    expect((await dispatchGrowthPublishChat(ctx({ approved: new Set([FP]) }), t.d)).refusal).toBe("lookup_failed");
    expect(t.invoked).toHaveLength(0);
  });

  it("an answer that never came back is unknown, and the card says so", async () => {
    const t = deps({ answer: () => { throw new Error("fetch failed"); } });
    const r = await dispatchGrowthPublishChat(ctx(), t.d);
    expect(r.content).toMatchObject({ success: false, outcome_unknown: true });
    expect(classifySpentApproval(JSON.stringify(r.content)).outcome).toBe("unconfirmed");
  });

  it("a door refusal is not-applied; unverified stays unknown; not-ready names what is missing", async () => {
    const refused = await dispatchGrowthPublishChat(ctx(), deps({ answer: httpError({ ok: false, refused: true, error: "Page not found in this tenant." }) }).d);
    expect(refused.content).toMatchObject({ success: false, not_applied: true, error: "Page not found in this tenant." });
    expect(classifySpentApproval(JSON.stringify(refused.content)).outcome).toBe("not_run");
    const unverified = await dispatchGrowthPublishChat(ctx(), deps({ answer: { data: { ok: false, outcome: "unverified", status: "published" }, error: null } }).d);
    expect(unverified.content).toMatchObject({ success: false, outcome: "unverified" });
    expect(classifySpentApproval(JSON.stringify(unverified.content)).outcome).toBe("unconfirmed");
    const notReady = await dispatchGrowthPublishChat(ctx(), deps({ answer: { data: { ok: false, outcome: "not_ready", approval_required: true, error: "It isn't ready yet.",
      preview: { checks: [{ key: "has_sections", label: "The page is empty", ok: false, blocking: true }, { key: "x", label: "warn", ok: false, blocking: false }] } }, error: null } }).d);
    expect(notReady.content).toMatchObject({ success: false, not_applied: true, missing: ["The page is empty"] });
    const off = await dispatchGrowthPublishChat(ctx(), deps({ answer: httpError({ ok: false, disabled: true, error: "Publishing is switched off." }) }).d);
    expect(off.content).toMatchObject({ disabled: true });
  });

  it("a malformed id never reaches the door", async () => {
    const t = deps({});
    const r = await dispatchGrowthPublishChat(ctx({ args: { page_id: "33333333" } }), t.d);
    expect(r.content).toMatchObject({ refused_before_run: true, field: "page_id" });
    expect(t.invoked).toHaveLength(0);
  });

  it("the five door-only keys receipt under their own names", () => {
    for (const k of ["growth_page_unpublish", "growth_form_unpublish", "growth_funnel_unpublish", "studio_image_publish", "studio_image_unpublish"]) {
      expect(STUDIO_RECEIPT_KEYS.get(k)).toBe(k);
      expect(classifyStudioRun({ capability: k, result: { success: true } })).toEqual({ key: k, outcome: "capability_succeeded" });
    }
  });
});

// paige-action-worker — drafting one claimed action, driven against a fake orchestrator and a fake
// RPC client. Nothing here reaches a network or a database.
//   node --test supabase/functions/paige-action-worker/draft.test.ts   (Node 24; Node 22 needs
//   --experimental-strip-types)
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type ClaimedAction, draftClaimedAction, EMPTY_EMAIL_DRAFT_ERROR, isEmailSendKind, MISSING_INTENT_ERROR,
  shapeEmailDraft,
} from "./draft.ts";

const T = "10000000-0000-4000-8000-000000000001";
const ACT = "40000000-0000-4000-8000-000000000001";
const C = "30000000-0000-4000-8000-000000000001";
const INV = "60000000-0000-4000-8000-000000000001";
// The seeded send_via_approval kinds (20260714092000 + the action-bus seeds).
const SEND_KINDS = new Set(["owner.lead_followup", "client.followup", "owner.followup_email", "owner.sms_nudge"]);

type Obj = Record<string, unknown>;

function leadFollowup(over: Partial<ClaimedAction> = {}): ClaimedAction {
  return {
    id: ACT, tenant_id: T, action_kind: "owner.lead_followup", contact_id: C, conversation_id: null,
    title: "Follow up with Dana", summary: "New lead from the Strategy form",
    payload: {
      submission_id: "s-1", form_id: "f-1", source: "growth_form",
      draft_input: {
        intent: "Thank them for reaching out and offer a short call",
        key_points: ["They asked about onboarding"], tone: "warm", length: "short", recipient_name: "Dana",
      },
    },
    draft_subagent_slug: "email-composer",
    ...over,
  };
}

/** The email-composer's real success shape (subagent-email-composer/index.ts), with a recipient echo. */
function composerResult(draft: Obj = {}): Obj {
  return {
    ok: true, subagent: "email-composer", summary: "Composed warm email (short) for Dana.",
    draft: {
      subject: "Great to meet you, Dana",
      body_html: "<p>Hi Dana,</p>\n<p>Thanks for reaching out.</p>",
      body_text: "Hi Dana,\n\nThanks for reaching out.",
      tone_used: "warm", length: "short", word_count: 6,
      ...draft,
    },
    recipient: { contact_id: C, name: "Dana", email: "dana@example.test" },
    to: "attacker@example.test",
    compliance_verdict: "approved", requires_approval: false,
  };
}

function harness(orch: { httpOk?: boolean; status?: number; body?: unknown } | Error, advanceError: string | null = null) {
  const invokes: Obj[] = [];
  const rpcs: Array<{ fn: string; args: Obj }> = [];
  const deps = {
    invoke: async (request: Obj) => {
      invokes.push(request);
      if (orch instanceof Error) throw orch;
      return { httpOk: orch.httpOk ?? true, status: orch.status ?? 200, body: orch.body };
    },
    rpc: async (fn: string, args: Obj) => {
      rpcs.push({ fn, args });
      return { error: fn === "advance_action" && advanceError ? { message: advanceError } : null };
    },
  };
  return { deps, invokes, rpcs };
}

const ok = (result: unknown) => ({ httpOk: true, status: 200, body: { ok: true, invocation_id: INV, result } });

describe("owner.lead_followup — the email contract", () => {
  it("stores {channel:'email', subject, body(html), body_text, raw} and advances to drafted", async () => {
    const h = harness(ok(composerResult()));
    const out = await draftClaimedAction(h.deps, leadFollowup(), SEND_KINDS);
    assert.deepEqual(out, { kind: "drafted", invocationId: INV });
    assert.deepEqual(h.rpcs.map((r) => r.fn), ["advance_action"]);
    const args = h.rpcs[0]!.args;
    assert.equal(args.p_action_id, ACT);
    assert.equal(args.p_tenant_id, T);
    assert.equal(args.p_to_status, "drafted");
    assert.equal(args.p_invocation_id, INV);
    const dc = args.p_draft_content as Obj;
    assert.equal(dc.channel, "email");
    assert.equal(dc.subject, "Great to meet you, Dana");
    assert.equal(dc.body, "<p>Hi Dana,</p>\n<p>Thanks for reaching out.</p>");
    assert.equal(dc.body_text, "Hi Dana,\n\nThanks for reaching out.");
    assert.deepEqual(Object.keys(dc).sort(), ["body", "body_text", "channel", "raw", "subject"]);
  });

  it("never carries a recipient from the drafting output — not at the top, not in raw", async () => {
    const h = harness(ok(composerResult({ to: "model-picked@example.test", cc: "x@example.test" })));
    await draftClaimedAction(h.deps, leadFollowup(), SEND_KINDS);
    const dc = h.rpcs[0]!.args.p_draft_content as Obj;
    const raw = dc.raw as Obj;
    assert.equal("to" in dc, false);
    assert.equal("recipient" in dc, false);
    assert.equal("to" in raw, false);
    assert.equal("recipient" in raw, false);
    assert.equal("to" in (raw.draft as Obj), false);
    assert.equal("cc" in (raw.draft as Obj), false);
    assert.equal(JSON.stringify(dc).includes("@example.test"), false);
    // The rest of the composer's answer is kept for the record.
    assert.equal(raw.compliance_verdict, "approved");
    assert.equal((raw.draft as Obj).subject, "Great to meet you, Dana");
  });

  it("passes the filing's draft_input to the composer, with the tenant from the claimed row", async () => {
    const h = harness(ok(composerResult()));
    await draftClaimedAction(h.deps, leadFollowup(), SEND_KINDS);
    assert.equal(h.invokes.length, 1);
    const req = h.invokes[0]!;
    assert.equal(req.action, "tool_invoke");
    assert.equal(req.slug, "email-composer");
    assert.equal(req.tenant_id, T);
    const input = req.input as Obj;
    assert.equal(input.intent, "Thank them for reaching out and offer a short call");
    assert.deepEqual(input.key_points, ["They asked about onboarding"]);
    assert.equal(input.tone, "warm");
    assert.equal(input.length, "short");
    assert.equal(input.recipient_name, "Dana");
    assert.equal(input.contact_id, C);
    assert.deepEqual(req.context, { contact_id: C, conversation_id: null });
  });

  it("fails before invoking when draft_input has no intent", async () => {
    for (const payload of [{ source: "growth_form" }, { draft_input: { intent: "   " } }, null]) {
      const h = harness(ok(composerResult()));
      const out = await draftClaimedAction(h.deps, leadFollowup({ payload }), SEND_KINDS);
      assert.deepEqual(out, { kind: "failed", stage: "preflight", error: MISSING_INTENT_ERROR });
      assert.equal(h.invokes.length, 0);
      assert.deepEqual(h.rpcs, [{ fn: "fail_action", args: { p_action_id: ACT, p_error: MISSING_INTENT_ERROR } }]);
    }
  });

  it("an empty draft is failed honestly and never reaches approvals", async () => {
    const empties: unknown[] = [
      composerResult({ subject: "Hi", body_html: "", body_text: "" }),
      composerResult({ subject: "", body_html: "<p>x</p>", body_text: "x" }),
      { ok: true, draft: {} },
      { ok: true },
      { ok: false, error: "compliance_blocked", draft: { subject: "s", body_html: "<p>b</p>" } },
      "just a string",
      null,
    ];
    for (const result of empties) {
      const h = harness(ok(result));
      const out = await draftClaimedAction(h.deps, leadFollowup(), SEND_KINDS);
      assert.deepEqual(out, { kind: "failed", stage: "draft", error: EMPTY_EMAIL_DRAFT_ERROR }, JSON.stringify(result));
      assert.deepEqual(h.rpcs.map((r) => r.fn), ["fail_action"]);
      assert.equal(h.rpcs[0]!.args.p_error, EMPTY_EMAIL_DRAFT_ERROR);
    }
  });

  it("a failed invoke is failed with the specialist's error, unchanged from before", async () => {
    const h = harness({ httpOk: false, status: 422, body: { ok: false, error: "compliance_blocked" } });
    const out = await draftClaimedAction(h.deps, leadFollowup(), SEND_KINDS);
    const msg = "invoke email-composer failed (422): compliance_blocked";
    assert.deepEqual(out, { kind: "failed", stage: "invoke", error: msg });
    assert.deepEqual(h.rpcs, [{ fn: "fail_action", args: { p_action_id: ACT, p_error: msg } }]);
  });

  it("an advance error fails the action with the reason", async () => {
    const h = harness(ok(composerResult()), "ACTION_TENANT_MISMATCH");
    const out = await draftClaimedAction(h.deps, leadFollowup(), SEND_KINDS);
    assert.deepEqual(out, { kind: "failed", stage: "advance", error: "ACTION_TENANT_MISMATCH" });
    assert.deepEqual(h.rpcs.map((r) => r.fn), ["advance_action", "fail_action"]);
    assert.equal(h.rpcs[1]!.args.p_error, "advance failed: ACTION_TENANT_MISMATCH");
  });

  it("a thrown invoke propagates to the caller (index.ts fails it in its catch)", async () => {
    const h = harness(new Error("The signal has been aborted"));
    await assert.rejects(draftClaimedAction(h.deps, leadFollowup(), SEND_KINDS), /aborted/);
    assert.equal(h.rpcs.length, 0);
  });
});

describe("shapeEmailDraft — the shapes a specialist may return", () => {
  it("a flat {subject, body} in text becomes escaped HTML paragraphs", () => {
    const d = shapeEmailDraft({ subject: "Hello", body: "Hi <Dana> & team,\nline two\n\nSecond para" })!;
    assert.equal(d.body, "<p>Hi &lt;Dana&gt; &amp; team,<br>line two</p>\n<p>Second para</p>");
    assert.equal(d.body_text, "Hi <Dana> & team,\nline two\n\nSecond para");
  });

  it("a flat HTML body is kept and given a text twin", () => {
    const d = shapeEmailDraft({ subject: "Hello", body: "<p>One</p><p>Two &amp; three</p>" })!;
    assert.equal(d.body, "<p>One</p><p>Two &amp; three</p>");
    assert.equal(d.body_text, "One\n\nTwo & three");
  });

  it("the composer's plain format (empty body_html) still yields an HTML body", () => {
    const d = shapeEmailDraft({ ok: true, draft: { subject: "S", body_html: "", body_text: "Plain body" } })!;
    assert.equal(d.body, "<p>Plain body</p>");
    assert.equal(d.body_text, "Plain body");
  });
});

describe("every other kind is drafted exactly as before", () => {
  it("a non-send kind stores the specialist's result as returned, with no intent requirement", async () => {
    const result = { ok: true, draft: { subject: "", body_html: "" }, to: "kept-as-returned@example.test" };
    const h = harness(ok(result));
    const out = await draftClaimedAction(h.deps, leadFollowup({ action_kind: "client.portal_welcome", payload: {} }), SEND_KINDS);
    assert.deepEqual(out, { kind: "drafted", invocationId: INV });
    assert.deepEqual(h.rpcs[0]!.args.p_draft_content, result);
  });

  it("a non-object result is wrapped as {content}", async () => {
    const h = harness(ok("plain words"));
    await draftClaimedAction(h.deps, leadFollowup({ action_kind: "owner.content_draft", payload: null }), SEND_KINDS);
    assert.deepEqual(h.rpcs[0]!.args.p_draft_content, { content: "plain words" });
  });

  it("an SMS send kind is never relabelled an email (execute-approval sends it by SMS category)", async () => {
    const result = { ok: true, draft: { subject: "S", body_html: "<p>b</p>", body_text: "b" } };
    const h = harness(ok(result));
    const out = await draftClaimedAction(h.deps, leadFollowup({ action_kind: "owner.sms_nudge", payload: {} }), SEND_KINDS);
    assert.deepEqual(out, { kind: "drafted", invocationId: INV });
    assert.deepEqual(h.rpcs[0]!.args.p_draft_content, result);
    assert.equal(isEmailSendKind(SEND_KINDS, "owner.sms_nudge"), false);
    assert.equal(isEmailSendKind(SEND_KINDS, "owner.lead_followup"), true);
    assert.equal(isEmailSendKind(SEND_KINDS, "client.portal_welcome"), false);
  });
});

describe("index.ts wiring", () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "index.ts"), "utf8");
  it("reads the send_via_approval kinds before claiming, and fails closed if it cannot", () => {
    const lookup = src.indexOf('.eq("executor", "send_via_approval")');
    const claim = src.indexOf('admin.rpc("claim_filed_actions"');
    assert.ok(lookup > 0 && claim > 0 && lookup < claim);
    assert.match(src, /if \(kindsErr\) return json\(\{ error: "kinds_lookup_failed"/);
  });
  it("drafts every claimed action through draftClaimedAction with that set", () => {
    assert.match(src, /draftClaimedAction\(\{[\s\S]*\}, a, sendViaApprovalKinds\)/);
    assert.equal(src.includes('admin.rpc("advance_action"'), false, "advance_action belongs to draft.ts only");
  });
});

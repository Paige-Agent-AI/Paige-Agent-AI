// email-campaign-worker (E1): the pure decisions, then the real handler with its ports faked.
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import {
  mapSendResult,
  planEnvelope,
  renderCampaignEmail,
  type Envelope,
} from "../../supabase/functions/email-campaign-worker/logic";

const totals = (over: Partial<Envelope["totals"]> = {}) => ({
  total: 3, planned: 0, sending: 0, sent: 3, failed: 0, outcome_unknown: 0, skipped: 0, cancelled: 0, ...over,
});
const env = (over: Partial<Envelope> = {}): Envelope => ({
  version_id: "v1", tenant_id: "t1", campaign_id: "c1", campaign_status: "sending", blocked_reason: null,
  work_id: "w1", work_key: "k1", work_status: "claimed", is_current: true, version_state: "approved",
  approved_by: "u1", totals: totals(), ...over,
});

describe("renderCampaignEmail", () => {
  it("adds the business, its postal address and a visible unsubscribe link, escaping both", () => {
    const html = renderCampaignEmail({ bodyHtml: "<p>Hi</p>", preheader: "Spring <news>", businessName: "A&B Co", postalAddress: "1 Main St, Austin" });
    expect(html.startsWith('<div style="display:none')).toBe(true);
    expect(html).toContain("Spring &lt;news&gt;");
    expect(html).toContain("<p>Hi</p>");
    expect(html).toContain("A&amp;B Co<br>1 Main St, Austin");
    expect(html).toContain('href="{{unsubscribe_url}}"');
  });
  it("strips HTML comments so a body cannot swallow the footer", () => {
    const html = renderCampaignEmail({ bodyHtml: "<p>Hi</p><!-- hide everything after", postalAddress: "1 Main St" });
    expect(html).not.toContain("<!--");
    expect(html).toContain("1 Main St");
    expect(html).toContain('href="{{unsubscribe_url}}"');
  });
  it("closes what the body leaves open, so the footer is never inside a link, a list or bold", () => {
    const html = renderCampaignEmail({ bodyHtml: "<div><ul><li>one<b>bold <a href=\"https://x.example\">link", postalAddress: "1 Main St" });
    expect(html).toContain('link</a></b></li></ul></div><div style="margin-top:32px');
  });
  it("drops elements that hide or swallow what follows them, even left open", () => {
    for (const bodyHtml of [
      "<p>a</p><style>div{display:none}</style>",
      "<p>a</p><textarea>everything after",
      "<p>a</p><title>x",
      "<p>a</p><script>alert(1)</script>",
      "<p>a</p><noscript>",
      "<p>a</p><template>",
      "<p>a</p><plaintext>",
      "<link rel=\"stylesheet\" href=\"https://x.example/hide.css\"><p>a</p>",
    ]) {
      const html = renderCampaignEmail({ bodyHtml, postalAddress: "1 Main St" });
      expect(html).not.toMatch(/<(style|textarea|title|script|noscript|template|plaintext|link)\b/i);
      expect(html).toContain("<p>a</p>");
      expect(html).toContain('href="{{unsubscribe_url}}"');
    }
  });
  it("writes a stray or unfinished tag out as text instead of letting it eat the footer", () => {
    const html = renderCampaignEmail({ bodyHtml: '<p>a < b</p><a href="x>broken', postalAddress: "1 Main St" });
    expect(html).toContain("<p>a &lt; b</p>&lt;a href=");
    expect(html).toContain('<a href="{{unsubscribe_url}}"');
  });
  it("leaves well-formed email untouched", () => {
    const body = '<h2 style="x">Hi</h2><p>One<br>two</p><img src="https://x.example/a.png" alt=""><ul><li>a</li></ul>';
    expect(renderCampaignEmail({ bodyHtml: body, postalAddress: "1 Main St" }).startsWith(body)).toBe(true);
  });
  it("omits the preheader block when there is none", () => {
    expect(renderCampaignEmail({ bodyHtml: "<p>x</p>", postalAddress: "1 Main St" }).startsWith("<p>x</p>")).toBe(true);
  });
});

describe("mapSendResult", () => {
  it("sent carries the provider id and message id", () => {
    expect(mapSendResult(200, { status: "sent", outcome: "sent", vendor_message_id: "re_1", message_id: "m1" }))
      .toEqual({ outcome: "sent", providerMessageId: "re_1", messageId: "m1" });
  });
  it("a pre-send refusal is a skip with its reason", () => {
    expect(mapSendResult(200, { status: "failed", outcome: "blocked_suppressed", reason: "suppressed" }))
      .toMatchObject({ outcome: "skipped", skipReason: "suppressed" });
    expect(mapSendResult(200, { outcome: "blocked_unsubscribe_unavailable" })).toMatchObject({ skipReason: "unsubscribe_unavailable" });
  });
  it("a connector refusal or provider rejection is failed", () => {
    expect(mapSendResult(409, { error: "connector_not_active" })).toMatchObject({ outcome: "failed", error: "connector_not_active" });
    expect(mapSendResult(200, { status: "failed", outcome: "failed", error: "resend_422" })).toMatchObject({ outcome: "failed" });
  });
  it("a pre-send hold that send-message handed back is deferred until it ends", () => {
    expect(mapSendResult(200, { status: "failed", outcome: "queued_quiet_hours", deferred: true, scheduled_for: "2026-10-05T13:00:00Z", reason: "quiet hours" }))
      .toEqual({ outcome: "deferred", notBefore: "2026-10-05T13:00:00Z", error: "quiet hours" });
  });
  it("anything that may have reached the provider is outcome_unknown, never failed", () => {
    expect(mapSendResult(null, null, "send_timeout").outcome).toBe("outcome_unknown");
    expect(mapSendResult(500, { error: "boom" }).outcome).toBe("outcome_unknown");
    expect(mapSendResult(200, { outcome: "queued_quiet_hours" }).outcome).toBe("outcome_unknown");
    expect(mapSendResult(200, "not json").outcome).toBe("outcome_unknown");
  });
});

describe("planEnvelope", () => {
  it("a sending campaign keeps its envelope alive", () => {
    expect(planEnvelope(env())).toEqual({ steps: [], heartbeat: true });
  });
  it("an expired envelope of a sending campaign is reclaimed as a reconciliation", () => {
    expect(planEnvelope(env({ work_status: "expired" })).steps).toEqual([{ status: "claimed", reconciled: true }]);
  });
  it("a blocked campaign blocks the envelope with its reason and reports it once", () => {
    const p = planEnvelope(env({ campaign_status: "blocked", blocked_reason: "sender_needs_attention" }));
    expect(p.steps).toEqual([expect.objectContaining({ status: "blocked", blockedReason: "sender_needs_attention", errorCode: "sender_needs_attention" })]);
    expect(p.rail?.outcome).toBe("capability_refused");
    expect(planEnvelope(env({ work_status: "blocked", campaign_status: "blocked", blocked_reason: "x" })).steps).toEqual([]);
  });
  it("a sent version with any send succeeds with the recipient totals as readback", () => {
    const p = planEnvelope(env({ campaign_status: "partially_completed", version_state: "sent", totals: totals({ sent: 2, outcome_unknown: 1 }) }));
    expect(p.steps[0]).toMatchObject({ status: "succeeded", terminalOutcome: { verified_readback: true }, safeSummary: "Sent 2 of 3, 1 not confirmed." });
    expect(p.rail?.outcome).toBe("capability_succeeded");
  });
  it("a sent version where nothing was sent fails", () => {
    const p = planEnvelope(env({ campaign_status: "failed", version_state: "sent", totals: totals({ sent: 0, failed: 3 }) }));
    expect(p.steps[0]).toMatchObject({ status: "failed", errorCode: "nothing_sent" });
    expect(p.rail?.outcome).toBe("capability_failed");
  });
  it("a cancelled campaign cancels the envelope without a Rail event", () => {
    const p = planEnvelope(env({ campaign_status: "cancelled" }));
    expect(p.steps[0].status).toBe("cancelled");
    expect(p.rail).toBeUndefined();
  });
  it("a blocked envelope reopens before it can succeed", () => {
    const p = planEnvelope(env({ work_status: "blocked", campaign_status: "completed", version_state: "sent" }));
    expect(p.steps.map((s) => s.status)).toEqual(["claimed", "succeeded"]);
  });
});

// ── The real handler ──────────────────────────────────────────────────────────────────────────
const state = vi.hoisted(() => ({
  rpc: vi.fn(),
  authorized: true,
  rail: vi.fn(),
  handler: null as null | ((r: Request) => Promise<Response>),
}));
vi.mock("../../supabase/functions/_shared/systems-check-http.ts", () => ({
  adminClient: () => ({ rpc: state.rpc }),
  isAuthorizedInternalCaller: async () => state.authorized,
  corsHeaders: {},
  json: (status: number, body: unknown) => new Response(JSON.stringify(body), { status }),
}));
vi.mock("../../supabase/functions/_shared/capability-record.ts", () => ({
  recordCapabilityRun: state.rail,
  stableRunId: async (parts: string[]) => parts.join("|"),
}));

const claim = {
  campaign: { id: "c1", tenant_id: "t1", version_id: "v1", approved_by: "u1" },
  content: { subject: "Spring", preheader: "", body_html: "<p>Hi</p>" },
  sender: { mode: "managed", from_address: "acme@mail.paigeagent.ai" },
  postal_address: "1 Main St", business_name: "Acme",
  recipients: [
    { id: "r1", client_id: "k1", email: "one@example.test" },
    { id: "r2", client_id: "k2", email: "two@example.test" },
  ],
};

describe("email-campaign-worker handler", () => {
  let sends: Array<Record<string, unknown>> = [];
  beforeEach(async () => {
    vi.resetModules();
    state.rpc.mockReset();
    state.rail.mockReset();
    state.authorized = true;
    sends = [];
    vi.stubGlobal("Deno", {
      env: { get: (k: string) => (k === "SUPABASE_URL" ? "https://db.example.test" : "local-test-only") },
      serve: (h: typeof state.handler) => { state.handler = h; },
    });
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      sends.push(body);
      if (body.to === "two@example.test") throw new Error("socket hang up");
      return new Response(JSON.stringify({ status: "sent", outcome: "sent", vendor_message_id: "re_1", message_id: "m1" }), { status: 200 });
    });
    const path = "../../supabase/functions/email-campaign-worker/index.ts";
    await import(/* @vite-ignore */ path);
  });
  afterEach(() => vi.unstubAllGlobals());
  const post = () => state.handler!(new Request("https://worker.invalid", { method: "POST", body: "{}" }));

  it("refuses an untrusted caller before touching anything", async () => {
    state.authorized = false;
    expect((await post()).status).toBe(401);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("sends each leased recipient through send-message in marketing mode and records the honest outcome", async () => {
    let claims = 0;
    state.rpc.mockImplementation(async (name: string) => {
      if (name === "email_campaign_dispatch_claim") return { data: claims++ === 0 ? claim : { campaign: null }, error: null };
      if (name === "email_campaign_dispatch_begin") return { data: true, error: null };
      if (name === "email_campaign_dispatch_open_envelopes") return { data: [], error: null };
      return { data: { settled: false }, error: null };
    });
    const res = await (await post()).json();
    expect(sends).toHaveLength(2);
    for (const s of sends) {
      expect(s).toMatchObject({ channel: "email", subject: "Spring", marketing: true });
      expect(String(s.body)).toContain('href="{{unsubscribe_url}}"');
      expect(s.connector_id).toBeUndefined();
    }
    expect(sends.map((s) => s.idempotency_key).sort()).toEqual(["ecr:r1", "ecr:r2"]);
    const records = state.rpc.mock.calls.filter(([n]) => n === "email_campaign_dispatch_record").map(([, a]) => a);
    expect(records).toEqual(expect.arrayContaining([
      expect.objectContaining({ p_recipient_id: "r1", p_outcome: "sent", p_provider_message_id: "re_1", p_message_id: "m1" }),
      expect.objectContaining({ p_recipient_id: "r2", p_outcome: "outcome_unknown" }),
    ]));
    expect(res).toMatchObject({ batches: 1, sent: 1, outcome_unknown: 1 });
    expect(state.rpc.mock.calls.map(([n]) => n)).toContain("email_campaign_dispatch_open");
  });

  it("sends through the approved connector only when the version selected one", async () => {
    let claims = 0;
    state.rpc.mockImplementation(async (name: string) => {
      if (name === "email_campaign_dispatch_claim") {
        return { data: claims++ === 0 ? { ...claim, sender: { mode: "connector", connector_id: "conn-1" }, recipients: [claim.recipients[0]] } : { campaign: null }, error: null };
      }
      if (name === "email_campaign_dispatch_begin") return { data: true, error: null };
      if (name === "email_campaign_dispatch_open_envelopes") return { data: [], error: null };
      return { data: null, error: null };
    });
    await post();
    expect(sends[0].connector_id).toBe("conn-1");
  });

  it("does not spin on a campaign waiting for the daily ceiling, and moves past a blocked one", async () => {
    const seq = [
      { campaign: { ...claim.campaign, id: "cB" }, blocked: "sender_needs_attention", recipients: [] },
      { campaign: claim.campaign, waiting: "daily_cap", recipients: [] },
      claim,
    ];
    state.rpc.mockImplementation(async (name: string) => {
      if (name === "email_campaign_dispatch_claim") return { data: seq.shift() ?? { campaign: null }, error: null };
      if (name === "email_campaign_dispatch_open_envelopes") return { data: [], error: null };
      return { data: null, error: null };
    });
    const res = await (await post()).json();
    expect(state.rpc.mock.calls.filter(([n]) => n === "email_campaign_dispatch_claim")).toHaveLength(2);
    expect(sends).toHaveLength(0);
    expect(res.notes).toEqual([{ campaign_id: "cB", blocked: "sender_needs_attention" }, { campaign_id: "c1", waiting: "daily_cap" }]);
  });

  it("does not send to a recipient whose campaign was cancelled after the batch was leased", async () => {
    let claims = 0;
    state.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
      if (name === "email_campaign_dispatch_claim") return { data: claims++ === 0 ? claim : { campaign: null }, error: null };
      if (name === "email_campaign_dispatch_begin") return { data: args.p_recipient_id === "r1", error: null };
      if (name === "email_campaign_dispatch_open_envelopes") return { data: [], error: null };
      return { data: null, error: null };
    });
    const res = await (await post()).json();
    expect(sends.map((x) => x.to)).toEqual(["one@example.test"]);
    expect(res.stopped).toBe(1);
  });

  it("puts a recipient back in the queue when the begin check itself fails", async () => {
    let claims = 0;
    state.rpc.mockImplementation(async (name: string) => {
      if (name === "email_campaign_dispatch_claim") return { data: claims++ === 0 ? { ...claim, recipients: [claim.recipients[0]] } : { campaign: null }, error: null };
      if (name === "email_campaign_dispatch_begin") return { data: null, error: { message: "connection reset" } };
      if (name === "email_campaign_dispatch_open_envelopes") return { data: [], error: null };
      return { data: null, error: null };
    });
    await post();
    expect(sends).toHaveLength(0);
    const rec = state.rpc.mock.calls.find(([n]) => n === "email_campaign_dispatch_record")![1];
    expect(rec).toMatchObject({ p_recipient_id: "r1", p_outcome: "deferred" });
  });

  it("closes a finished campaign's envelope with readback and one Rail event", async () => {
    state.rpc.mockImplementation(async (name: string) => {
      if (name === "email_campaign_dispatch_claim") return { data: { campaign: null }, error: null };
      if (name === "email_campaign_dispatch_open_envelopes") {
        return { data: [env({ campaign_status: "sending", totals: totals({ sent: 2, outcome_unknown: 1 }) })], error: null };
      }
      if (name === "email_campaign_dispatch_settle") return { data: { settled: true, status: "partially_completed" }, error: null };
      return { data: null, error: null };
    });
    await post();
    const t = state.rpc.mock.calls.find(([n]) => n === "transition_paige_durable_work")![1];
    expect(t).toMatchObject({ _work_id: "w1", _server_idempotency_key: "k1", _new_status: "succeeded", _reconciled: false });
    expect(t._terminal_outcome).toMatchObject({ verified_readback: true, campaign_status: "partially_completed" });
    expect(state.rail).toHaveBeenCalledTimes(1);
    expect(state.rail.mock.calls[0][1]).toMatchObject({ tenantId: "t1", actorId: "u1", capabilityKey: "marketing_email_campaign", outcome: "capability_succeeded" });
  });

  it("heartbeats an envelope whose campaign is still sending", async () => {
    state.rpc.mockImplementation(async (name: string) => {
      if (name === "email_campaign_dispatch_claim") return { data: { campaign: null }, error: null };
      if (name === "email_campaign_dispatch_open_envelopes") return { data: [env({ totals: totals({ planned: 5, sent: 0 }) })], error: null };
      return { data: null, error: null };
    });
    await post();
    expect(state.rpc.mock.calls.map(([n]) => n)).toContain("heartbeat_paige_durable_work");
    expect(state.rpc.mock.calls.map(([n]) => n)).not.toContain("transition_paige_durable_work");
    expect(state.rail).not.toHaveBeenCalled();
  });
});

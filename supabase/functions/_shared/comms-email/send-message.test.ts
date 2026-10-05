// INT-328 — the comms.email_send branch of the REAL send-message handler.
//
// Mirrors _shared/sales-invoice-delivery/send-message.test.ts: the actual handler source is
// transpiled and executed with only its imports and the network substituted. The registered
// email adapter is the REAL one from send-message (captured through registerOutboundAdapter),
// so the Resend request it builds — Idempotency-Key, abort signal — is the request under test.
import { readFileSync } from "node:fs";
import { transpileModule, ModuleKind, ScriptTarget } from "typescript";
import { describe, it, expect } from "vitest";

const OP = "22222222-2222-4222-8222-222222222222";
const MSG = "33333333-3333-4333-8333-333333333333";
const TENANT = "44444444-4444-4444-8444-444444444444";
const CONTACT = "55555555-5555-4555-8555-555555555555";
const CONNECTOR = "66666666-6666-4666-8666-666666666666";
const ACTOR = "77777777-7777-4777-8777-777777777777";
const OTHER = "88888888-8888-4888-8888-888888888888";
const RESEND_KEY = "re_secret_key_do_not_leak";
const PROVIDER_ID = "re_provider_receipt_123";

const binding = {
  operation_id: OP, tenant_id: TENANT, actor_user_id: ACTOR, contact_id: CONTACT,
  recipient: "client@example.test", connector_id: CONNECTOR, from_address: "owner@business.test",
  provider: "resend", subject: "Checking in", body_text: "Hi there", body_html: "<p>Hi there</p>",
  content_digest: "b".repeat(64), state: "prepared", attempts: 0,
};

const raw = readFileSync("supabase/functions/send-message/index.ts", "utf8").replace(/^import[\s\S]*?;\r?\n/gm, "");
const compiled = transpileModule(raw, { compilerOptions: { module: ModuleKind.None, target: ScriptTarget.ES2022 } }).outputText;

type Fetch = "ok" | "reject422" | "status500" | "status429" | "status409" | "throw" | "hang" | "no_id";
interface Options {
  fetch?: Fetch;
  preSend?: { proceed: boolean; outcome: string; reason?: string | null; queueUntil?: string | null };
  claim?: { data: unknown; error: unknown };
  finalizeError?: boolean;
  provider?: string;
  fireTimeout?: boolean;
  bindingOverride?: Record<string, unknown>;
  draftStatus?: string;
  contactEmails?: string[];
  eligible?: boolean;
  // The database's own binding state when finalize runs, if it differs from the read snapshot
  // (another request claimed in between). Defaults to the snapshot.
  dbState?: string;
}

function setup(options: Options = {}) {
  const b = { ...binding, provider: options.provider ?? "resend", ...options.bindingOverride };
  const writes: { table: string; op: string; value: unknown }[] = [];
  const logs: unknown[] = [];
  const rpcCalls: { name: string; args: Record<string, unknown> }[] = [];
  const fetchCalls: { url: string; init: RequestInit }[] = [];
  // The database binding as finalize_comms_email_send sees it (claim moves it to dispatching).
  const db = { state: options.dbState ?? (b.state as string), attempts: Number(b.attempts ?? 0) };
  const timeouts: number[] = [];
  const adapters: Record<string, { send: (...a: unknown[]) => Promise<unknown> }> = {};
  let handler: (req: Request) => Promise<Response>;

  const admin = {
    auth: { getUser: async () => ({ data: { user: { id: ACTOR } } }) },
    from: (table: string) => {
      let mode: "select" | "update" | "insert" | "upsert" = "select";
      const q: Record<string, (...args: unknown[]) => unknown> = {};
      for (const m of ["eq", "is", "in", "not", "neq", "order"]) q[m] = () => q;
      q.select = () => q;
      q.insert = (v: unknown) => { mode = "insert"; writes.push({ table, op: "insert", value: v }); return q; };
      q.upsert = (v: unknown) => { mode = "upsert"; writes.push({ table, op: "upsert", value: v }); return q; };
      q.update = (v: unknown) => { mode = "update"; writes.push({ table, op: "update", value: v }); return q; };
      const result = () => {
        if (mode !== "select") return { data: { id: table === "messages" ? MSG : "row-id" }, error: null };
        if (table === "messages") {
          return { data: { tenant_id: TENANT, status: options.draftStatus ?? "draft", connector_id: CONNECTOR, contact_id: CONTACT, thread_key: `contact:${TENANT}:${CONTACT}`, channel_type: "email", meta: { source: "comms-email-command", comms_email_binding: b } }, error: null };
        }
        if (table === "clients") return { data: { tenant_id: TENANT, emails: options.contactEmails ?? ["Client@Example.test"] }, error: null };
        if (table === "channel_connectors") {
          return { data: { tenant_id: TENANT, status: "active", active: true, channel_type: "email", provider: options.provider ?? "resend", from_address: "owner@business.test", from_name: "Owner Co", reply_to: null, credentials_vault_ref: null, config: null }, error: null };
        }
        if (table === "email_unsubscribe_tokens") return { data: null, error: null };
        return { data: null, error: null };
      };
      q.maybeSingle = async () => result();
      q.single = q.maybeSingle;
      q.then = (resolve: (v: unknown) => unknown, reject: (r: unknown) => unknown) => Promise.resolve(result()).then(resolve, reject);
      return q;
    },
    rpc: async (name: string, args: Record<string, unknown> = {}) => {
      rpcCalls.push({ name, args });
      if (name === "read_comms_email_send_binding") return { data: { ...b, message_id: MSG, tenant_id: TENANT, channel_type: "email", message_status: options.draftStatus ?? "draft", eligible: options.eligible ?? true }, error: null };
      if (name === "claim_comms_email_send") {
        const claimed = options.claim ?? { data: { state: "dispatching", attempts: 1 }, error: null };
        const d = claimed.data as { state?: string; attempts?: number } | null;
        if (d?.state === "dispatching") { db.state = "dispatching"; db.attempts = Number(d.attempts); }
        return claimed;
      }
      if (name === "finalize_comms_email_send") {
        if (options.finalizeError) return { data: null, error: { code: "40001", message: "conflict" } };
        // The migration's rule: 'prepared' only for an unclaimed refused/failed; 'dispatching' only
        // for the attempt holding the claim, never 'refused'.
        const attempt = args._claimed_attempt ?? null;
        const allowed = (db.state === "prepared" && attempt === null && (args._outcome === "failed" || args._outcome === "refused"))
          || (db.state === "dispatching" && args._outcome !== "refused" && attempt !== null && attempt === db.attempts);
        if (!allowed) return { data: null, error: { code: "42501", message: "COMMS_EMAIL_NOT_CLAIMED" } };
        db.state = args._outcome as string;
        return { data: { ok: true, outcome: args._outcome, message_id: MSG, provider_receipt_available: !!args._provider_message_id }, error: null };
      }
      if (name === "has_role") return { data: true, error: null };
      if (name === "current_user_tenant_id") return { data: TENANT, error: null };
      if (name === "is_platform_owner") return { data: false, error: null };
      return { data: null, error: null };
    },
  };

  const fetchMock = (url: string, init: RequestInit = {}) => {
    fetchCalls.push({ url, init });
    const mode = options.fetch ?? "ok";
    const json = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
    if (mode === "ok") return json(200, { id: PROVIDER_ID });
    if (mode === "no_id") return json(200, {});
    if (mode === "reject422") return json(422, { message: "provider says secret-detail about the key" });
    if (mode === "status500") return json(500, { message: "provider exploded" });
    if (mode === "status429") return json(429, { message: "slow down" });
    if (mode === "status409") return json(409, { message: "idempotency in flight" });
    if (mode === "throw") return Promise.reject(new TypeError(`network down near ${RESEND_KEY}`));
    return new Promise<Response>((_, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    });
  };

  const scope = {
    PAIGE_APP_ORIGIN: "https://app.example.test",
    Deno: {
      env: { get: (k: string) => (k === "SUPABASE_SERVICE_ROLE_KEY" ? "internal" : k === "RESEND_API_KEY" ? RESEND_KEY : k === "SUPABASE_URL" ? "https://proj.example.test" : "configured") },
      serve: (fn: typeof handler) => { handler = fn; },
    },
    createClient: () => admin,
    registerOutboundAdapter: (a: { channel_type: string; send: (...x: unknown[]) => Promise<unknown> }) => { adapters[a.channel_type] = a; },
    getOutboundAdapter: (channel: string) => adapters[channel],
    buildListUnsubscribeHeaders: () => ({}),
    runPreSend: async () => options.preSend ?? { proceed: true, outcome: "proceed" },
    CLIENT_CONTACT_METHODS_EMBED: "client_contact_methods",
    clientAddresses: (row: { emails?: string[] }) => ({ emails: row.emails ?? [], phones: [] }),
    // Never reached on the comms path; present so a stray reach fails loudly instead of silently.
    readInvoiceDeliveryReadiness: async () => { throw new Error("invoice readiness reached on comms path"); },
    parseDeliveryBinding: () => { throw new Error("invoice binding parser reached on comms path"); },
    fetch: fetchMock,
    setTimeout: (fn: () => void, ms: number) => { timeouts.push(ms); if (options.fireTimeout && ms === 20_000) queueMicrotask(fn); return timeouts.length; },
    clearTimeout: () => {},
    console: { warn: (...v: unknown[]) => logs.push(v), error: (...v: unknown[]) => logs.push(v), log: (...v: unknown[]) => logs.push(v) },
  };
  new Function(...Object.keys(scope), compiled)(...Object.values(scope));

  const request = async (extra: Record<string, unknown> = {}, bearer = "internal") => {
    const res = await handler!(new Request("https://example.test/send-message", {
      method: "POST",
      headers: { Authorization: `Bearer ${bearer}` },
      body: JSON.stringify({
        channel: "email", to: b.recipient, contact_id: CONTACT, connector_id: CONNECTOR, message_id: MSG,
        subject: b.subject, body: b.body_html, comms_email_operation_id: OP, idempotency_key: `comms-email:${OP}`,
        ...extra,
      }),
    }));
    return { status: res.status, body: await res.json() as Record<string, unknown> };
  };
  const names = () => rpcCalls.map((c) => c.name);
  const finalizeCalls = () => rpcCalls.filter((c) => c.name === "finalize_comms_email_send").map((c) => c.args);
  return { request, writes, logs, rpcCalls, fetchCalls, timeouts, names, finalizeCalls, db };
}

const leaks = (s: ReturnType<typeof setup>, response: unknown) => JSON.stringify(response);

describe("send-message comms_email path (real handler source, network substituted only)", () => {
  it("provider id → provider_accepted, finalized once, Idempotency-Key and abort signal on the Resend call", async () => {
    const s = setup();
    const r = await s.request();
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, outcome: "provider_accepted", message_id: MSG, delivery_confirmed: false });
    expect(s.fetchCalls).toHaveLength(1);
    const headers = s.fetchCalls[0].init.headers as Record<string, string>;
    expect(headers["Idempotency-Key"]).toBe(`comms-email:${OP}`);
    expect(s.fetchCalls[0].init.signal).toBeInstanceOf(AbortSignal);
    expect(s.timeouts).toContain(20_000);
    expect(s.rpcCalls.find((c) => c.name === "claim_comms_email_send")?.args).toEqual({ _message_id: MSG, _operation_id: OP, _reconcile: false });
    expect(s.finalizeCalls()).toEqual([{ _message_id: MSG, _operation_id: OP, _outcome: "provider_accepted", _provider_message_id: PROVIDER_ID, _reason: null, _claimed_attempt: 1 }]);
    // No second messages row, and finalize (not the generic write) owns the prepared row's status.
    expect(s.writes.filter((w) => w.table === "messages")).toEqual([]);
    expect(leaks(s, r.body)).not.toContain(PROVIDER_ID);
    expect(leaks(s, r.body)).not.toContain(RESEND_KEY);
  });

  it("the idempotency key is the operation's, never a caller-supplied one", async () => {
    const s = setup();
    await s.request({ idempotency_key: "attacker-chosen-key" });
    expect((s.fetchCalls[0].init.headers as Record<string, string>)["Idempotency-Key"]).toBe(`comms-email:${OP}`);
  });

  it("rejects altered recipient / subject / body / contact / connector before claim or provider", async () => {
    for (const extra of [
      { to: "someone-else@example.test" },
      { subject: "Changed subject" },
      { body: "<p>altered</p>" },
      { contact_id: OTHER },
      { connector_id: OTHER },
      { comms_email_operation_id: OTHER },
      { channel: "sms" },
    ]) {
      const s = setup();
      const r = await s.request(extra);
      expect(r.status, JSON.stringify(extra)).toBeGreaterThanOrEqual(400);
      expect(s.fetchCalls, JSON.stringify(extra)).toHaveLength(0);
      expect(s.names(), JSON.stringify(extra)).not.toContain("claim_comms_email_send");
      expect(s.names(), JSON.stringify(extra)).not.toContain("finalize_comms_email_send");
    }
    const s = setup();
    const r = await s.request({ subject: "Changed subject" });
    expect(r).toMatchObject({ status: 409, body: { error: "comms_email_binding_invalid" } });
  });

  it("rejects a non-internal caller, and a governed draft sent without its operation id", async () => {
    const user = setup();
    const r = await user.request({}, "user-jwt");
    expect(r).toMatchObject({ status: 403, body: { error: "comms_email_binding_required" } });
    expect(user.fetchCalls).toHaveLength(0);
    expect(user.names()).not.toContain("read_comms_email_send_binding");
    // Approve-draft style send of the prepared row (no op id) — internal and user alike.
    // Internal: the pre-existing drainer guard refuses a non-queued row first; user JWT: the comms gate.
    for (const [bearer, status, error] of [["internal", 409, "scheduled_message_not_releasable"], ["user-jwt", 403, "comms_email_binding_required"]] as const) {
      const s = setup();
      const res = await s.request({ comms_email_operation_id: undefined, idempotency_key: undefined }, bearer);
      expect(res.status, bearer).toBe(status);
      expect(res.body.error, bearer).toBe(error);
      expect(s.fetchCalls, bearer).toHaveLength(0);
      expect(s.names(), bearer).not.toContain("claim_comms_email_send");
    }
  });

  it("refuses shapes that may not ride the comms_email path", async () => {
    for (const extra of [
      { marketing: true },
      { scheduled_for: "2099-01-01T00:00:00Z" },
      { attachments: [{ url: `${TENANT}/a.pdf` }] },
      { invoice_delivery_operation_id: OP },
      { comms_email_reconcile: "yes" },
      { comms_email_operation_id: "not-a-uuid" },
      { message_id: undefined },
    ]) {
      const s = setup();
      const r = await s.request(extra);
      expect(r.status, JSON.stringify(extra)).toBeGreaterThanOrEqual(400);
      expect(r.status, JSON.stringify(extra)).toBeLessThan(500);
      expect(s.fetchCalls).toHaveLength(0);
      expect(s.names()).not.toContain("claim_comms_email_send");
    }
    const s = setup();
    expect((await s.request({ marketing: true })).body.error).toBe("comms_email_send_shape_invalid");
  });

  it("suppressed contact → refused with the pre-send reason; provider and claim never reached", async () => {
    const s = setup({ preSend: { proceed: false, outcome: "blocked_suppressed", reason: "recipient unsubscribed" } });
    const r = await s.request();
    expect(r.body).toMatchObject({ ok: false, outcome: "refused", reason: "blocked_suppressed", message_id: MSG, delivery_confirmed: false });
    expect(s.fetchCalls).toHaveLength(0);
    expect(s.names()).not.toContain("claim_comms_email_send");
    expect(s.finalizeCalls()).toEqual([{ _message_id: MSG, _operation_id: OP, _outcome: "refused", _provider_message_id: null, _reason: "blocked_suppressed", _claimed_attempt: null }]);
    expect(s.writes.filter((w) => w.table === "messages")).toEqual([]);
  });

  it("quiet hours / tenant DND never queue a comms email — refused, nothing scheduled", async () => {
    for (const outcome of ["queued_quiet_hours", "queued_tenant_dnd"]) {
      const s = setup({ preSend: { proceed: false, outcome, reason: "later", queueUntil: "2099-01-01T08:00:00Z" } });
      const r = await s.request();
      expect(r.body).toMatchObject({ ok: false, outcome: "refused", reason: outcome });
      expect(s.fetchCalls).toHaveLength(0);
      expect(JSON.stringify(s.writes)).not.toContain("queued");
      expect(JSON.stringify(s.writes)).not.toContain("2099-01-01T08:00:00Z");
      expect(s.finalizeCalls()[0]).toMatchObject({ _outcome: "refused", _reason: outcome });
    }
  });

  it("recipient no longer on the contact → refused RECIPIENT_CHANGED, never sent", async () => {
    const s = setup({ contactEmails: ["new-address@example.test"] });
    const r = await s.request();
    expect(r.body).toMatchObject({ ok: false, outcome: "refused", reason: "RECIPIENT_CHANGED" });
    expect(s.fetchCalls).toHaveLength(0);
    // The binding keeps lowercase code-shaped reasons only (finalize_comms_email_send's own filter).
    expect(s.finalizeCalls()[0]).toMatchObject({ _outcome: "refused", _reason: "recipient_changed" });
  });

  it("provider timeout (20 s) → unknown; the request is aborted, finalize records unknown", async () => {
    const s = setup({ fetch: "hang", fireTimeout: true });
    const r = await s.request();
    expect(r.body).toMatchObject({ ok: false, outcome: "unknown", message_id: MSG, delivery_confirmed: false });
    expect(s.timeouts).toContain(20_000);
    expect(s.fetchCalls[0].init.signal?.aborted).toBe(true);
    expect(s.finalizeCalls()).toEqual([expect.objectContaining({ _outcome: "unknown", _provider_message_id: null })]);
  });

  it("losing claim never calls the provider and never finalizes another attempt", async () => {
    for (const claim of [{ data: { state: "provider_accepted", attempts: 1 }, error: null }, { data: null, error: { code: "40001" } }]) {
      const s = setup({ claim });
      const r = await s.request();
      expect(r.status).toBe(409);
      expect(r.body).toMatchObject({ ok: false, outcome: "outcome_unknown", code: "COMMS_EMAIL_NOT_CLAIMABLE" });
      expect(s.fetchCalls).toHaveLength(0);
      expect(s.names()).not.toContain("finalize_comms_email_send");
    }
  });

  it("definitive 4xx rejection → failed; 5xx / 429 / 409 / network throw / missing receipt → unknown", async () => {
    const cases: [Fetch, string][] = [["reject422", "failed"], ["status500", "unknown"], ["status429", "unknown"], ["status409", "unknown"], ["throw", "unknown"], ["no_id", "unknown"]];
    for (const [fetch, outcome] of cases) {
      const s = setup({ fetch });
      const r = await s.request();
      expect(r.body.outcome, fetch).toBe(outcome);
      expect(r.body.ok, fetch).toBe(false);
      expect(s.finalizeCalls()[0]?._outcome, fetch).toBe(outcome);
      const text = JSON.stringify(r.body);
      for (const secret of [RESEND_KEY, "secret-detail", "provider exploded", "network down", "slow down"]) expect(text, fetch).not.toContain(secret);
      // Durable audit text is a code, not the provider's words.
      expect(JSON.stringify(s.writes), fetch).not.toContain(RESEND_KEY);
      expect(JSON.stringify(s.writes), fetch).not.toContain("secret-detail");
    }
  });

  it("finalize without a receipt → outcome_unknown, never a claimed success", async () => {
    const s = setup({ finalizeError: true });
    const r = await s.request();
    expect(r.body).toMatchObject({ ok: false, outcome: "outcome_unknown", delivery_confirmed: false });
  });

  it("reconcile flag reaches the claim; a non-prepared row is not re-dispatched by the dedupe guard", async () => {
    const s = setup({ bindingOverride: { state: "unknown" } });
    const r = await s.request({ comms_email_reconcile: true });
    expect(s.rpcCalls.find((c) => c.name === "claim_comms_email_send")?.args).toEqual({ _message_id: MSG, _operation_id: OP, _reconcile: true });
    expect(r.body.outcome).toBe("provider_accepted");
    const sent = setup({ draftStatus: "sent" });
    const res = await sent.request();
    expect(res.body).toMatchObject({ ok: false, outcome: "outcome_unknown", code: "COMMS_EMAIL_NOT_CLAIMABLE" });
    expect(sent.fetchCalls).toHaveLength(0);
  });

  it("a reconcile that hits a pre-send block does not try to finalize a non-prepared operation", async () => {
    const s = setup({ bindingOverride: { state: "unknown" }, preSend: { proceed: false, outcome: "blocked_suppressed" } });
    const r = await s.request({ comms_email_reconcile: true });
    expect(r.body).toMatchObject({ ok: false, outcome: "outcome_unknown" });
    expect(s.fetchCalls).toHaveLength(0);
    expect(s.names()).not.toContain("finalize_comms_email_send");
  });

  it("a binding the read RPC no longer finds eligible is refused before claim, never sent", async () => {
    const s = setup({ eligible: false });
    const r = await s.request();
    expect(r.body).toMatchObject({ ok: false, outcome: "refused", reason: "SEND_NO_LONGER_ELIGIBLE" });
    expect(s.fetchCalls).toHaveLength(0);
    expect(s.names()).not.toContain("claim_comms_email_send");
    expect(s.finalizeCalls()).toEqual([{ _message_id: MSG, _operation_id: OP, _outcome: "refused", _provider_message_id: null, _reason: "send_no_longer_eligible", _claimed_attempt: null }]);
  });

  it("changed sender on the connector → refused SENDER_CHANGED", async () => {
    const s = setup({ bindingOverride: { from_address: "someone-else@business.test" } });
    const r = await s.request();
    expect(r.body).toMatchObject({ ok: false, outcome: "refused", reason: "SENDER_CHANGED" });
    expect(s.fetchCalls).toHaveLength(0);
  });

  // ── verifier #1: the finalize race. Request A claimed and is calling the provider; request B for
  // the same operation is refused before any claim. B must never record "Not sent" over A's send.
  it("race: an unclaimed refusal on an operation another attempt is dispatching never finalizes", async () => {
    for (const preSend of [
      { proceed: false, outcome: "blocked_suppressed" },
      { proceed: false, outcome: "error" },
    ]) {
      const s = setup({ bindingOverride: { state: "dispatching", attempts: 1 }, preSend });
      const r = await s.request();
      expect(r.status, preSend.outcome).toBe(409);
      expect(r.body, preSend.outcome).toMatchObject({ ok: false, outcome: "outcome_unknown", code: "COMMS_EMAIL_NOT_CLAIMABLE" });
      expect(r.body.outcome, preSend.outcome).not.toBe("refused");
      expect(s.names(), preSend.outcome).not.toContain("finalize_comms_email_send");
      expect(s.names(), preSend.outcome).not.toContain("claim_comms_email_send");
      expect(s.fetchCalls, preSend.outcome).toHaveLength(0);
      expect(s.db.state, preSend.outcome).toBe("dispatching");
    }
  });

  it("race: a snapshot that still read 'prepared' cannot refuse over a claim taken since — the database refuses it", async () => {
    const s = setup({ dbState: "dispatching", preSend: { proceed: false, outcome: "blocked_suppressed" } });
    const r = await s.request();
    // The unclaimed request asked as an unclaimed caller (no attempt), and the database said no.
    expect(s.finalizeCalls()).toEqual([expect.objectContaining({ _outcome: "refused", _claimed_attempt: null })]);
    expect(r.body).toMatchObject({ ok: false, outcome: "outcome_unknown" });
    expect(s.db.state).toBe("dispatching");
    expect(s.fetchCalls).toHaveLength(0);
  });

  it("the claimant finalizes with the attempt number its own claim returned", async () => {
    const s = setup({ bindingOverride: { state: "unknown", attempts: 2 }, claim: { data: { state: "dispatching", attempts: 3 }, error: null } });
    const r = await s.request({ comms_email_reconcile: true });
    expect(r.body.outcome).toBe("provider_accepted");
    expect(s.finalizeCalls()).toEqual([expect.objectContaining({ _outcome: "provider_accepted", _claimed_attempt: 3 })]);
  });

  it("a claim reply without a whole attempt number is not a claim: no provider call, no finalize", async () => {
    for (const data of [{ state: "dispatching" }, { state: "dispatching", attempts: "1" }, { state: "dispatching", attempts: 0 }]) {
      const s = setup({ claim: { data, error: null } });
      const r = await s.request();
      expect(r.body, JSON.stringify(data)).toMatchObject({ ok: false, outcome: "outcome_unknown", code: "COMMS_EMAIL_NOT_CLAIMABLE" });
      expect(s.fetchCalls, JSON.stringify(data)).toHaveLength(0);
      expect(s.names(), JSON.stringify(data)).not.toContain("finalize_comms_email_send");
    }
  });

  it("legacy email sends are untouched: no abort signal, no 20 s deadline, no forced key", async () => {
    const s = setup();
    const r = await s.request({ comms_email_operation_id: undefined, idempotency_key: undefined, message_id: undefined }, "user-jwt");
    expect(r.body.status).toBe("sent");
    expect(s.fetchCalls).toHaveLength(1);
    expect("signal" in s.fetchCalls[0].init).toBe(false);
    expect((s.fetchCalls[0].init.headers as Record<string, string>)["Idempotency-Key"]).toBeUndefined();
    expect(s.timeouts).not.toContain(20_000);
    expect(s.names()).not.toContain("claim_comms_email_send");
  });
});

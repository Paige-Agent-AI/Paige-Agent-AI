// @vitest-environment node
// paige-media approval — the REAL handler, run against an in-memory store (v2b).
//
// EVIDENCE CLASS (§32): behavioural handler proof. The production `paige-media/index.ts` source is
// transpiled and executed; only the network/runtime boundaries are substituted (serve, the two
// Supabase clients, the fal adapter, config/accrual reads, the credit ledger). The approval module
// (`_shared/media-provider/approval.ts`), the ONE fingerprint home, the budget/approval policy and
// the receipt writer all run for real. The store double enforces the canonical rules that matter
// here: the live-row uniqueness predicate of paige_pending_confirmations, Postgres NULL semantics
// on `neq`, jsonb containment, and compare-and-set updates.
//
// What it pins (owner ruling 2026-10-04 — "Requester approves, any admin can decline"):
//   - a blocked submit mints ONE server-issued, thread-less proposal addressed to the requester;
//   - approve refuses without / with a wrong fingerprint, refuses a non-requester outright, claims
//     once for the requester and dispatches, and a replay is refused;
//   - any admin's decline retires the proposal, files ONE capability_refused receipt, and the
//     requester can no longer approve;
//   - the fingerprint is shown to the requester only.
import { readFileSync } from "node:fs";
import { transpileModule, ModuleKind, ScriptTarget } from "typescript";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as approval from "../../supabase/functions/_shared/media-provider/approval";
import { recordCapabilityRun, stableRunId } from "../../supabase/functions/_shared/capability-record";
import { decideMediaBudget, decidePlatformSpendGuard, resolveApprovalPolicy } from "../../supabase/functions/_shared/media-provider/budget";
import { estimateCredits } from "../../supabase/functions/_shared/media-provider/credits";

const TENANT = "10000000-0000-4000-8000-000000000001";
const REQUESTER = "20000000-0000-4000-8000-000000000001";
const OTHER_ADMIN = "20000000-0000-4000-8000-000000000002";
const USERS: Record<string, string> = { "Bearer requester": REQUESTER, "Bearer other-admin": OTHER_ADMIN };

type Row = Record<string, unknown>;
type Filter = (r: Row) => boolean;

/** An in-memory PostgREST-shaped store with the semantics this seam relies on. */
class Store {
  tables: Record<string, Row[]> = { paige_media_jobs: [], paige_pending_confirmations: [], profiles: [], studio_sessions: [], marketing_content: [] };
  rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  failUpdatesOn: string | null = null;
  ceiling?: number;
  seq = 0;
  from(table: string) { return new Query(this, table); }
  async rpc(name: string, args: Record<string, unknown>) {
    this.rpcCalls.push({ name, args });
    if (name === "media_video_completed_today") return { data: 0, error: null };
    return { data: true, error: null };
  }
  receipts() { return this.rpcCalls.filter((c) => c.name === "record_capability_run"); }
  proposals() { return this.tables.paige_pending_confirmations; }
  job(id: string) { return this.tables.paige_media_jobs.find((j) => j.id === id)!; }
}

const tsOf = (v: unknown) => (typeof v === "string" ? Date.parse(v) : NaN);

class Query implements PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }> {
  private op: "select" | "insert" | "update" = "select";
  private payload: Row | Row[] | null = null;
  private filters: Filter[] = [];
  private ordering: { col: string; asc: boolean } | null = null;
  private lim: number | null = null;
  constructor(private store: Store, private table: string) {}
  select() { return this; }
  insert(p: Row | Row[]) { this.op = "insert"; this.payload = p; return this; }
  update(p: Row) { this.op = "update"; this.payload = p; return this; }
  eq(c: string, v: unknown) { this.filters.push((r) => r[c] != null && r[c] === v); return this; }
  neq(c: string, v: unknown) { this.filters.push((r) => r[c] != null && r[c] !== v); return this; }
  is(c: string, v: null) { this.filters.push((r) => (v === null ? r[c] == null : r[c] === v)); return this; }
  not(c: string, op: string, v: unknown) {
    if (op === "is" && v === null) this.filters.push((r) => r[c] != null);
    else if (op === "in") {
      const list = String(v).replace(/[()]/g, "").split(",");
      this.filters.push((r) => r[c] != null && !list.includes(String(r[c])));
    } else throw new Error(`unsupported not(${op})`);
    return this;
  }
  in(c: string, list: unknown[]) { this.filters.push((r) => list.includes(r[c])); return this; }
  gt(c: string, v: string) { this.filters.push((r) => tsOf(r[c]) > tsOf(v)); return this; }
  lte(c: string, v: string) { this.filters.push((r) => tsOf(r[c]) <= tsOf(v)); return this; }
  contains(c: string, obj: Row) {
    this.filters.push((r) => {
      const v = r[c] as Row | null;
      return !!v && Object.entries(obj).every(([k, x]) => v[k] === x);
    });
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }) { this.ordering = { col, asc: opts?.ascending !== false }; return this; }
  limit(n: number) { this.lim = n; return this; }

  private rows() { return this.store.tables[this.table] ??= []; }
  private exec(): { data: Row[] | null; error: { code?: string; message?: string } | null } {
    const rows = this.rows();
    if (this.op === "insert") {
      const incoming = (Array.isArray(this.payload) ? this.payload : [this.payload!]).map((r) => ({ ...r }));
      for (const r of incoming) {
        r.id ??= `00000000-0000-4000-8000-${String(++this.store.seq).padStart(12, "0")}`;
        r.created_at ??= new Date().toISOString();
        if (this.table === "paige_pending_confirmations") {
          r.expires_at ??= new Date(Date.now() + 30 * 60_000).toISOString();
          r.consumed_at ??= null;
          const clash = rows.some((x) => x.user_id === r.user_id && x.fingerprint === r.fingerprint && x.consumed_at == null && x.server_issued_at != null);
          if (clash && r.server_issued_at != null) return { data: null, error: { code: "23505", message: "duplicate key" } };
        }
        if (this.table === "paige_media_jobs" && rows.some((x) => x.idempotency_key === r.idempotency_key)) {
          return { data: null, error: { code: "23505", message: "duplicate key" } };
        }
        rows.push(r);
      }
      return { data: incoming, error: null };
    }
    let hit = rows.filter((r) => this.filters.every((f) => f(r)));
    if (this.op === "update") {
      if (this.store.failUpdatesOn === this.table) return { data: null, error: { message: "store down" } };
      for (const r of hit) Object.assign(r, this.payload);
      return { data: hit.map((r) => ({ ...r })), error: null };
    }
    if (this.ordering) {
      const { col, asc } = this.ordering;
      hit = [...hit].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : 1) * (asc ? 1 : -1));
    }
    if (this.lim != null) hit = hit.slice(0, this.lim);
    return { data: hit.map((r) => ({ ...r })), error: null };
  }
  async maybeSingle() {
    const { data, error } = this.exec();
    if (error) return { data: null, error };
    if (data!.length > 1) return { data: null, error: { code: "PGRST116", message: "multiple rows" } };
    return { data: data![0] ?? null, error: null };
  }
  async single() {
    const { data, error } = this.exec();
    if (error) return { data: null, error };
    if (data!.length !== 1) return { data: null, error: { code: "PGRST116", message: "not one row" } };
    return { data: data![0], error: null };
  }
  then<A, B>(ok?: (v: { data: unknown; error: { code?: string; message?: string } | null }) => A, bad?: (e: unknown) => B) {
    return Promise.resolve(this.exec()).then(ok, bad);
  }
}

const CATALOG = [
  { id: "fal-std", label: "Standard", mode: "image", tier: "standard", estCostPerUnitUsd: 0.03, unit: "image" },
  { id: "fal-premium", label: "Premium", mode: "image", tier: "premium", estCostPerUnitUsd: 0.12, unit: "image" },
  { id: "fal-video", label: "Video", mode: "video", tier: "standard", estCostPerUnitUsd: 0.2, unit: "second" },
] as const;

const rawSource = readFileSync("supabase/functions/paige-media/index.ts", "utf8");
// Strip every import statement (single- or multi-line); their bindings are injected below.
const source = rawSource.replace(/^import\s[\s\S]*?from\s+"[^"]+";\r?\n/gm, "");
const compiled = transpileModule(source, { compilerOptions: { module: ModuleKind.None, target: ScriptTarget.ES2022 } }).outputText;

function harness() {
  const store = new Store();
  let handler!: (req: Request) => Promise<Response>;
  const submit = vi.fn(async () => ({ providerRequestId: `req-${store.seq + 1}` }));
  const falAdapter = {
    name: "fal",
    isConfigured: () => true,
    getCapabilities: () => ({ provider: "fal", execution: "async", configured: true, models: CATALOG }),
    estimateCost: ({ model, videoSeconds }: { model: string; videoSeconds?: number }) => {
      const m = CATALOG.find((x) => x.id === model);
      if (!m) return null;
      return { estimatedCostUsd: m.unit === "second" ? m.estCostPerUnitUsd * (videoSeconds ?? 5) : m.estCostPerUnitUsd, basis: "test table", unit: m.unit };
    },
    submit,
    cancel: vi.fn(async () => undefined),
    getLicenseClass: () => ({ licenseClass: "commercial", commercialUse: "yes", disclosure: "test" }),
    getRetentionPolicy: () => ({ policy: "test", copyDeadline: "1h" }),
  };
  const authedFor = (authorization: string) => ({
    auth: { getUser: async () => ({ data: { user: USERS[authorization] ? { id: USERS[authorization] } : null }, error: null }) },
    rpc: async (name: string) => ({ data: name === "current_user_tenant_id" ? TENANT : name === "is_tenant_admin" ? true : null, error: null }),
  });
  const scope: Record<string, unknown> = {
    Deno: { env: { get: (k: string) => k } },
    serve: (fn: typeof handler) => { handler = fn; },
    createClient: (_url: string, key: string, opts?: { global?: { headers?: { Authorization?: string } } }) =>
      key === "SUPABASE_ANON_KEY" ? authedFor(opts?.global?.headers?.Authorization ?? "") : store,
    recordCapabilityRun,
    getMediaAdapter: (name: string) => (name === "fal" ? falAdapter : null),
    allMediaAdapters: () => [falAdapter],
    falAdapter,
    selectMediaModel: () => null,
    loadMediaConfig: async () => ({ dailyCeilingUsd: 50, videoEnabled: true, videoDailyLimit: 3, providerCeilingUsd: 100, draftAllowanceUsd: 0.05, platformSpendCeilingUsd: 500, creditUsd: 0.01 }),
    resolveMediaCeiling: async () => store.ceiling ?? 50,
    MEDIA_CREDIT_PACKS: [],
    decideMediaBudget,
    decidePlatformSpendGuard,
    readMediaAccrual: async () => 0,
    readPlatformMediaAccrual: async () => 0,
    resolveApprovalPolicy,
    estimateCredits,
    holdMediaCredits: async () => ({ ok: true }),
    releaseMediaCredits: async () => ({ ok: true }),
    failMediaJob: async () => undefined,
    linkStudioArtifact: async () => undefined,
    NeedsConfigError: class NeedsConfigError extends Error {},
    stableRunId,
    claimMediaProposal: approval.claimMediaProposal,
    issueMediaProposal: approval.issueMediaProposal,
    mediaApprovalView: approval.mediaApprovalView,
    REQUESTER_ONLY_MESSAGE: approval.REQUESTER_ONLY_MESSAGE,
    retireMediaProposals: approval.retireMediaProposals,
  };
  new Function(...Object.keys(scope), compiled)(...Object.values(scope));
  const call = async (as: "requester" | "other-admin", body: Record<string, unknown>) => {
    const res = await handler(new Request("https://edge.test/paige-media", {
      method: "POST",
      headers: { Authorization: `Bearer ${as}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }));
    return { status: res.status, body: await res.json() as Record<string, any> };
  };
  return { store, call, submit };
}

async function submitPremium(h: ReturnType<typeof harness>, requestId = "request-0001") {
  return h.call("requester", { action: "submit", prompt: "A bold hero visual for the spring offer", model: "fal-premium", request_id: requestId });
}

describe("paige-media approval runs on the canonical proposal store", () => {
  let h: ReturnType<typeof harness>;
  beforeEach(() => { h = harness(); });

  it("a blocked submit mints ONE server-issued, thread-less proposal addressed to the requester", async () => {
    const res = await submitPremium(h);
    expect(res.status).toBe(200);
    expect(res.body.awaiting_approval).toBe(true);
    const job = h.store.job(res.body.job.id);
    expect(job).toMatchObject({ state: "blocked", approval_state: "pending", actor_id: REQUESTER });

    expect(h.store.proposals()).toHaveLength(1);
    const p = h.store.proposals()[0];
    expect(p).toMatchObject({
      user_id: REQUESTER, tenant_id: TENANT, thread_id: null, scoped_client_id: null,
      tool_name: "vibe_media_image", consumed_at: null,
      args: { job_id: job.id, mode: "image", model: "fal-premium", estimated_cost_usd: 0.12 },
    });
    expect(p.server_issued_at).toEqual(expect.any(String));
    expect(p.issued_in_request).toEqual(expect.any(String));
    expect(String(p.summary)).toContain("$0.12");
    // The proposal lives exactly as long as the job may wait (the sweeper's 7 days).
    expect(tsOf(p.expires_at) - tsOf(job.created_at)).toBe(approval.MEDIA_APPROVAL_LIFETIME_MS);
    // The fingerprint returned is the one stored, from the ONE fingerprint home.
    expect(res.body.approval).toMatchObject({ requested_by_you: true, fingerprint: p.fingerprint });
    expect(p.fingerprint).toBe(await approval.mediaApprovalFingerprint(job as never));
  });

  it("a submit within the draft allowance mints nothing and dispatches", async () => {
    const res = await h.call("requester", { action: "submit", prompt: "A quick square draft", model: "fal-std", request_id: "request-std-1" });
    expect(res.body.awaiting_approval).toBeUndefined();
    expect(h.store.proposals()).toHaveLength(0);
    expect(h.submit).toHaveBeenCalledTimes(1);
  });

  it("approve without a fingerprint is refused, and nothing is spent or consumed", async () => {
    const { body } = await submitPremium(h);
    const res = await h.call("requester", { action: "approve", job_id: body.job.id });
    expect(res.status).toBe(400);
    expect(res.body.approval_required).toBe(true);
    expect(h.store.job(body.job.id).approval_state).toBe("pending");
    expect(h.store.proposals()[0].consumed_at).toBeNull();
    expect(h.submit).not.toHaveBeenCalled();
  });

  it("approve with a wrong fingerprint is refused, and nothing is spent or consumed", async () => {
    const { body } = await submitPremium(h);
    const res = await h.call("requester", { action: "approve", job_id: body.job.id, approved_fingerprint: "0123456789abcdef" });
    expect(res.status).toBe(409);
    expect(res.body.approval_stale).toBe(true);
    expect(h.store.job(body.job.id).approval_state).toBe("pending");
    expect(h.store.proposals()[0].consumed_at).toBeNull();
    expect(h.submit).not.toHaveBeenCalled();
  });

  it("another admin cannot approve — even holding the right fingerprint — and is told they can decline", async () => {
    const { body } = await submitPremium(h);
    const res = await h.call("other-admin", { action: "approve", job_id: body.job.id, approved_fingerprint: body.approval.fingerprint });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ requester_only: true, error: "Only the person who asked for this image can approve its cost. You can decline it." });
    expect(h.store.proposals()[0].consumed_at).toBeNull();
    expect(h.store.job(body.job.id).approval_state).toBe("pending");
    expect(h.submit).not.toHaveBeenCalled();
  });

  it("the requester's approval claims the proposal once and dispatches; a replay is refused", async () => {
    const { body } = await submitPremium(h);
    const fp = body.approval.fingerprint;
    const ok = await h.call("requester", { action: "approve", job_id: body.job.id, approved_fingerprint: fp });
    expect(ok.status).toBe(200);
    expect(ok.body.dispatched).toBe(true);
    expect(h.store.proposals()[0].consumed_at).toEqual(expect.any(String));
    expect(h.store.job(body.job.id)).toMatchObject({ approval_state: "approved", state: "submitted" });
    expect(h.submit).toHaveBeenCalledTimes(1);

    const replay = await h.call("requester", { action: "approve", job_id: body.job.id, approved_fingerprint: fp });
    expect(replay.status).toBe(409);
    expect(h.submit).toHaveBeenCalledTimes(1);

    // Single use is the STORE's property, not just the job's: force the job back to pending and
    // the spent fingerprint still redeems nothing.
    Object.assign(h.store.job(body.job.id), { state: "blocked", approval_state: "pending" });
    const forced = await approval.claimMediaProposal(h.store as never, { job: h.store.job(body.job.id) as never, callerId: REQUESTER, tenantId: TENANT, fingerprint: fp, requestNonce: "later" });
    expect(forced).toBe("not_claimable");
    // Approving files nothing extra — the render's own outcome receipt covers it.
    expect(h.store.receipts()).toHaveLength(0);
  });

  it("a budget refusal at approval time does not spend the person's approval", async () => {
    const { body } = await submitPremium(h);
    h.store.ceiling = 0.01;
    const res = await h.call("requester", { action: "approve", job_id: body.job.id, approved_fingerprint: body.approval.fingerprint });
    expect(res.status).toBe(429);
    expect(h.store.proposals()[0].consumed_at).toBeNull();
    expect(h.submit).not.toHaveBeenCalled();
  });

  it("an expired proposal is refused", async () => {
    const { body } = await submitPremium(h);
    h.store.proposals()[0].expires_at = new Date(Date.now() - 1000).toISOString();
    const res = await h.call("requester", { action: "approve", job_id: body.job.id, approved_fingerprint: body.approval.fingerprint });
    expect(res.status).toBe(409);
    expect(h.submit).not.toHaveBeenCalled();
  });

  it("any admin can decline: the proposal is retired, ONE refusal receipt is filed, and the requester can no longer approve", async () => {
    const { body } = await submitPremium(h);
    const fp = body.approval.fingerprint;
    const declined = await h.call("other-admin", { action: "reject", job_id: body.job.id });
    expect(declined.status).toBe(200);
    expect(declined.body.declined).toBe(true);
    expect(h.store.job(body.job.id)).toMatchObject({ approval_state: "rejected", state: "cancelled" });
    expect(h.store.proposals()[0].consumed_at).toEqual(expect.any(String));

    const receipts = h.store.receipts();
    expect(receipts).toHaveLength(1);
    expect(receipts[0].args).toMatchObject({
      _tenant_id: TENANT, _actor_id: OTHER_ADMIN, _capability_key: "vibe_media_image", _outcome: "capability_refused",
      _run_id: await stableRunId(["vibe-media-declined", TENANT, body.job.id]),
      _detail: { declined_by_owner: true, declined_by_requester: false, job_id: body.job.id },
    });

    const late = await h.call("requester", { action: "approve", job_id: body.job.id, approved_fingerprint: fp });
    expect(late.status).toBe(409);
    expect(h.submit).not.toHaveBeenCalled();
    // A second decline, and a cancel, find nothing to decide and file nothing more.
    expect((await h.call("requester", { action: "reject", job_id: body.job.id })).status).toBe(409);
    expect((await h.call("other-admin", { action: "cancel", job_id: body.job.id })).body.already_terminal).toBe(true);
    expect(h.store.receipts()).toHaveLength(1);
  });

  it("cancelling a job that is waiting for approval is a decline, filed under the same once-per-job run id", async () => {
    const { body } = await submitPremium(h);
    const res = await h.call("other-admin", { action: "cancel", job_id: body.job.id });
    expect(res.body.declined).toBe(true);
    expect(h.store.proposals()[0].consumed_at).toEqual(expect.any(String));
    expect(h.store.receipts()).toHaveLength(1);
    expect(h.store.receipts()[0].args._run_id).toBe(await stableRunId(["vibe-media-declined", TENANT, body.job.id]));
  });

  it("the fingerprint goes to the requester only; everyone else sees who asked", async () => {
    h.store.tables.profiles.push({ user_id: REQUESTER, full_name: "Dana Reyes" });
    const { body } = await submitPremium(h);
    const mine = await h.call("requester", { action: "list" });
    expect(mine.body.jobs[0].approval).toMatchObject({ requested_by_you: true, fingerprint: body.approval.fingerprint });
    const theirs = await h.call("other-admin", { action: "list" });
    expect(theirs.body.jobs[0].approval).toEqual({ requested_by_you: false, requester_name: "Dana Reyes" });
    const status = await h.call("other-admin", { action: "status", job_id: body.job.id });
    expect(status.body.approval.fingerprint).toBeUndefined();
    // Reading never mints a second proposal.
    expect(h.store.proposals()).toHaveLength(1);
  });

  it("a job waiting from before v2b gets its proposal on the requester's next read, and can then be approved", async () => {
    const { body } = await submitPremium(h);
    h.store.tables.paige_pending_confirmations = []; // as if it was submitted before proposals existed
    const read = await h.call("requester", { action: "status", job_id: body.job.id });
    expect(read.body.approval.fingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(h.store.proposals()).toHaveLength(1);
    const ok = await h.call("requester", { action: "approve", job_id: body.job.id, approved_fingerprint: read.body.approval.fingerprint });
    expect(ok.body.dispatched).toBe(true);
  });

  it("a video waits on a vibe_media_video proposal, and the refusal names a video", async () => {
    const res = await h.call("requester", { action: "submit", prompt: "A five second pan across the offer", model: "fal-video", video_seconds: 5, request_id: "request-video" });
    expect(h.store.proposals()[0].tool_name).toBe("vibe_media_video");
    const refused = await h.call("other-admin", { action: "approve", job_id: res.body.job.id, approved_fingerprint: res.body.approval.fingerprint });
    expect(refused.body.error).toBe("Only the person who asked for this video can approve its cost. You can decline it.");
  });

  it("a replayed submit returns the same job and the same live proposal", async () => {
    const first = await submitPremium(h, "request-replay");
    const again = await submitPremium(h, "request-replay");
    expect(again.body.idempotent_replay).toBe(true);
    expect(again.body.approval.fingerprint).toBe(first.body.approval.fingerprint);
    expect(h.store.proposals()).toHaveLength(1);
  });
});

describe("approval module — properties the handler leans on", () => {
  it("a proposal cannot be redeemed by the request that minted it", async () => {
    const store = new Store();
    const job = { id: "job-1", tenant_id: TENANT, actor_id: REQUESTER, mode: "image", model: "fal-premium", estimated_cost_usd: 0.12, created_at: new Date().toISOString() };
    const issued = await approval.issueMediaProposal(store as never, job, "nonce-A");
    expect(issued.ok).toBe(true);
    const fp = (issued as { proposal: { fingerprint: string } }).proposal.fingerprint;
    expect(await approval.claimMediaProposal(store as never, { job, callerId: REQUESTER, tenantId: TENANT, fingerprint: fp, requestNonce: "nonce-A" })).toBe("not_claimable");
    expect(await approval.claimMediaProposal(store as never, { job, callerId: REQUESTER, tenantId: TENANT, fingerprint: fp, requestNonce: "nonce-B" })).toBe("claimed");
  });

  it("a proposal whose stored estimate no longer matches the job approves nothing", async () => {
    const store = new Store();
    const job = { id: "job-2", tenant_id: TENANT, actor_id: REQUESTER, mode: "image", model: "fal-premium", estimated_cost_usd: 0.12, created_at: new Date().toISOString() };
    const issued = await approval.issueMediaProposal(store as never, job, "nonce-A");
    const fp = (issued as { proposal: { fingerprint: string } }).proposal.fingerprint;
    expect(await approval.claimMediaProposal(store as never, { job: { ...job, estimated_cost_usd: 0.5 }, callerId: REQUESTER, tenantId: TENANT, fingerprint: fp, requestNonce: "nonce-B" })).toBe("not_claimable");
  });

  it("a job past its lifetime gets no proposal", async () => {
    const store = new Store();
    const old = new Date(Date.now() - approval.MEDIA_APPROVAL_LIFETIME_MS - 1000).toISOString();
    const res = await approval.issueMediaProposal(store as never, { id: "job-3", tenant_id: TENANT, actor_id: REQUESTER, mode: "image", model: "m", estimated_cost_usd: 1, created_at: old }, "n");
    expect(res).toEqual({ ok: false, reason: "expired" });
    expect(store.proposals()).toHaveLength(0);
  });
});

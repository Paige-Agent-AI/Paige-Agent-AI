import { decideDeclaredOrdinaryCapability } from "../capability-kit/decision.ts";
import { confirmFingerprint } from "../confirm-fingerprint.ts";
import { WEEKLY_COMMITMENT_DRAFT_CAPABILITY } from "../paige-spine/domains/automations.ts";
import { bindWeeklyControlForReview, parseWeeklyControlIntent } from "./weekly-commitment-control-input.ts";

type Result = { data: unknown; error: unknown };
type Caller = { auth: { getUser(): PromiseLike<{ data: { user: { id: string } | null }; error: unknown }> };
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<Result> };
type StoreRow = { id?: unknown; args?: unknown; consumed_at?: unknown; expires_at?: unknown };
type StoreError = { code?: string } | null;
type StoreQuery = PromiseLike<{ data: StoreRow[] | null; error: StoreError }> & {
  select(columns: string): StoreQuery; eq(column: string, value: unknown): StoreQuery;
  is(column: string, value: null): StoreQuery; not(column: string, operator: string, value: null): StoreQuery;
  order(column: string, options: { ascending: boolean }): StoreQuery; limit(count: number): StoreQuery;
  gt(column: string, value: string): StoreQuery; lte(column: string, value: string): StoreQuery;
  insert(value: Record<string, unknown>): StoreQuery; update(value: Record<string, unknown>): StoreQuery;
  maybeSingle(): PromiseLike<{ data: StoreRow | null; error: StoreError }>;
};
// Only the incumbent store's actual query surface; no untyped SDK execution seam.
type Admin = { from(table: string): unknown; rpc(name: string, args?: Record<string, unknown>): PromiseLike<Result> };
type Deps = { caller: (authorization: string) => Caller; admin: Admin; uuid?: () => string; now?: () => number };
const KEY = "weekly_commitment_draft";
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && Object.keys(v).every(k => keys.includes(k));
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-paige-expected-tenant" };
const response = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const fail = (status: number, code: string) => response(status, { ok: false, phase: "unavailable", code });

/** E5 domain adapter over the existing store, Kit, owner RPC and native process/Rail.
 * No Chat tool admission, provider, scheduler, action loop or separate authority/ledger.
 * approvedConfirmations is the incumbent surface-owned HTTP field, never model input.
 * A confirmation ID is a selector only. SQL atomically claims its trusted stored call;
 * Kit then decides that call, and a fixed SQL wrapper writes definition + receipt.
 */
export function createWeeklyDraftCommand(deps: Deps) {
  // Supabase's base builder and selected builder have different static types.
  // Keep that SDK cast here; all returned data is still narrowed before use.
  const store = () => deps.admin.from("paige_pending_confirmations") as StoreQuery;
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    if (req.method !== "POST") return fail(405, "METHOD_NOT_ALLOWED");
    try {
      const authorization = req.headers.get("authorization") ?? "";
      if (!/^Bearer \S+$/i.test(authorization)) return fail(401, "AUTHENTICATION_REQUIRED");
      const caller = deps.caller(authorization);
      const auth = await caller.auth.getUser();
      const actor = !auth.error ? auth.data.user?.id : null;
      if (!actor || !UUID.test(actor)) return fail(401, "AUTHENTICATION_REQUIRED");
      const tenantRead = await caller.rpc("current_user_tenant_id");
      const tenant = !tenantRead.error && typeof tenantRead.data === "string" ? tenantRead.data : null;
      if (!tenant || !UUID.test(tenant)) return fail(403, "OWNER_SCOPE_REQUIRED");
      // A captured surface address is a constraint, never authority. Refuse stale
      // pre-switch UI even if the JWT now resolves a different legitimate workspace.
      if (req.headers.get("x-paige-expected-tenant") !== tenant) return fail(409, "SCOPE_CHANGED");
      const current = async () => {
        const t = await caller.rpc("current_user_tenant_id");
        if (t.error || t.data !== tenant) return false;
        const owner = await caller.rpc("weekly_commitment_owner", { _tenant: tenant, _actor: actor });
        return !owner.error && owner.data === true;
      };
      if (!(await current())) return fail(403, "OWNER_SCOPE_REQUIRED");
      const text = await req.text();
      if (new TextEncoder().encode(text).length > 8192) return fail(413, "REQUEST_TOO_LARGE");
      let body: unknown;
      try { body = JSON.parse(text); } catch { return fail(400, "INVALID_REQUEST"); }
      if (!object(body) || typeof body.action !== "string") return fail(400, "INVALID_REQUEST");
      const operation = body.action;
      const allowed = operation === "prepare" ? ["action", "draft"] : operation === "pending" ? ["action"]
        : operation === "status" ? ["action", "confirmation_id"] : ["commit", "decline"].includes(operation)
        ? ["action", "confirmation_id", operation === "commit" ? "approvedConfirmations" : "declinedConfirmations"] : null;
      if (!allowed || !exact(body, allowed)) return fail(400, "INVALID_REQUEST");
      if (operation !== "prepare" && operation !== "pending" && (typeof body.confirmation_id !== "string" || !UUID.test(body.confirmation_id))) {
        return fail(400, "INVALID_REQUEST");
      }
      const read = async (id: string) => {
        const r = await caller.rpc("read_weekly_commitment_draft", { _confirmation_id: id });
        return !r.error && object(r.data) && r.data.ok === true ? r.data : null;
      };
      const scoped = (query: StoreQuery) => query.eq("user_id", actor).eq("tenant_id", tenant)
        .eq("tool_name", KEY).is("thread_id", null).is("scoped_client_id", null)
        .not("server_issued_at", "is", null).not("issued_in_request", "is", null);
      const finish = async (state: unknown, status = 200) => await current() ? response(status, state) : fail(409, "SCOPE_CHANGED");
      const lookup = async (fingerprint: string) => {
        const r = await caller.rpc("list_weekly_commitment_drafts", { _fingerprint: fingerprint });
        if (r.error || !object(r.data) || r.data.ok !== true || !Array.isArray(r.data.requests) || r.data.requests.length > 1) return { error: true, state: null };
        const state = r.data.requests[0];
        if (state !== undefined && (!object(state) || state.ok !== true || state.tenant_id !== tenant || state.actor_id !== actor)) return { error: true, state: null };
        return { error: false, state: object(state) ? state : null };
      };
      if (operation === "pending") {
        const r = await caller.rpc("list_weekly_commitment_drafts", { _fingerprint: null });
        return !r.error && object(r.data) && r.data.ok === true ? await finish(r.data) : fail(503, "DRAFT_STATUS_UNAVAILABLE");
      }
      if (operation === "status") {
        const state = await read(String(body.confirmation_id));
        return state ? await finish(state) : fail(503, "DRAFT_STATUS_UNAVAILABLE");
      }
      const nonce = (deps.uuid ?? (() => crypto.randomUUID()))();
      if (!UUID.test(nonce)) return fail(503, "REQUEST_IDENTITY_UNAVAILABLE");
      const laneResult = await caller.rpc("resolve_tool_autonomy", { _tenant_id: tenant, _tool_key: KEY });
      const lane = !laneResult.error && ["confirm", "auto", "off"].includes(String(laneResult.data)) ? String(laneResult.data) : "off";
      const decide = (args: Record<string, unknown>, claimed?: Record<string, unknown>) => decideDeclaredOrdinaryCapability(
        WEEKLY_COMMITMENT_DRAFT_CAPABILITY, {
          caller: { authenticated: true, userId: actor, tenantId: tenant, tenantSource: "server", principal: "person", door: "other",
            access: { allowed: true, reason: "Current active owner verified by canonical owner RPC; native write rechecks it." } },
          capability: { id: KEY, effect: "mutate", availability: "live", outcomeChannel: "record_capability_run" },
          // This bounded act requires confirmation even when the current Trust lane permits auto.
          approval: { autonomyLane: lane === "auto" ? "confirm" : lane === "confirm" ? "confirm" : "off",
            ...(claimed ? { claimedArgs: claimed, claimedFor: KEY } : {}) }, requestArgs: args,
        });
      if (operation === "prepare") {
        const intent = parseWeeklyControlIntent("draft", body.draft);
        const binding = intent ? bindWeeklyControlForReview("draft", intent, { requestId: nonce }) : null;
        if (!binding || !intent || !("name" in intent) || !("weekday" in intent)) return fail(400, "INVALID_DRAFT");
        if (decide(binding.args).kind !== "propose") return fail(403, "DRAFT_AUTHORITY_HELD");
        const schedule = await deps.admin.rpc("weekly_commitment_schedule", { _weekday: intent.weekday, _local_time: intent.local_time, _timezone: intent.timezone });
        if (schedule.error) return fail(400, "INVALID_SCHEDULE");
        const fingerprint = await confirmFingerprint(KEY, { ...binding.args, scope_tenant_id: tenant });
        const prior = await lookup(fingerprint);
        if (prior.error) return fail(503, "CONFIRMATION_STORE_UNAVAILABLE");
        const now = (deps.now ?? Date.now)();
        if (prior.state) {
          const state = prior.state, d = state.draft;
          if (typeof state.confirmation_id !== "string" || !UUID.test(state.confirmation_id) || !object(d)) return fail(503, "CONFIRMATION_STORE_UNAVAILABLE");
          if (["name", "weekday", "local_time", "timezone"].some(k => d[k] !== intent[k as keyof typeof intent])) return fail(409, "PROPOSAL_CONFLICT");
          if (!["expired", "declined"].includes(String(state.phase))) return await finish(state);
          if (!(await current())) return fail(409, "SCOPE_CHANGED");
          const retired = await scoped(store().update({ consumed_at: new Date(now).toISOString() }))
            .eq("id", state.confirmation_id).is("consumed_at", null).lte("expires_at", new Date(now).toISOString());
          if (retired.error) return fail(503, "CONFIRMATION_STORE_UNAVAILABLE");
        }
        if (!(await current())) return fail(409, "SCOPE_CHANGED");
        const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
        const summary = `Save “${intent.name}” as an unapproved draft: every ${days[intent.weekday - 1]} at ${intent.local_time} in ${intent.timezone}. Scope: your outstanding personal Planning commitments. No recurrence, task changes or provider sends are authorized.`;
        const issued = await store().insert({ user_id: actor, tenant_id: tenant,
          tool_name: KEY, thread_id: null, scoped_client_id: null, fingerprint, args: binding.args, summary,
          issued_in_request: nonce, server_issued_at: new Date(now).toISOString(), expires_at: new Date(now + 600000).toISOString() })
          .select("id").maybeSingle();
        let id = issued.data?.id;
        if (issued.error?.code === "23505") {
          const winner = await lookup(fingerprint);
          if (winner.error) return fail(503, "CONFIRMATION_STORE_UNAVAILABLE");
          id = winner.state?.confirmation_id;
        } else if (issued.error) return fail(503, "CONFIRMATION_STORE_UNAVAILABLE");
        if (typeof id !== "string" || !UUID.test(id)) return fail(503, "CONFIRMATION_STORE_UNAVAILABLE");
        const state = await read(id);
        const storedDraft = state?.draft;
        if (state && (!object(storedDraft) || ["name", "weekday", "local_time", "timezone"].some(k => storedDraft[k] !== intent[k as keyof typeof intent]))) {
          return fail(409, "PROPOSAL_CONFLICT");
        }
        return state ? await finish(state, 202) : fail(503, "DRAFT_STATUS_UNAVAILABLE");
      }
      const tokens = operation === "commit" ? body.approvedConfirmations : body.declinedConfirmations;
      if (!Array.isArray(tokens) || tokens.length !== 1 || typeof tokens[0] !== "string"
        || !/^[0-9a-f]{16}:[0-9a-f-]{36}$/.test(tokens[0])) return fail(400, "SURFACE_CONFIRMATION_REQUIRED");
      if (!(await current())) return fail(409, "SCOPE_CHANGED");
      if (operation === "decline") {
        const declined = await caller.rpc("decline_weekly_commitment_draft", { _confirmation_id: body.confirmation_id, _declined_token: tokens[0] });
        return !declined.error ? await finish(declined.data) : fail(503, "DECLINE_UNCONFIRMED");
      }
      // Only the existing SQL atomic claim supplies claimedArgs. Never synthesize it
      // from model/body arguments or from a status read of an unconsumed proposal.
      if (decide({}).kind === "refuse") return fail(403, "DRAFT_AUTHORITY_HELD");
      const claim = await caller.rpc("claim_weekly_commitment_draft", { _confirmation_id: body.confirmation_id,
        _approved_token: tokens[0], _request_nonce: nonce });
      if (claim.error || !object(claim.data)) return fail(503, "CLAIM_UNCONFIRMED");
      if (claim.data.claimed !== true) return await finish(claim.data.state ?? { ok: false, phase: "unknown" });
      if (claim.data.actor_id !== actor || claim.data.tenant_id !== tenant || claim.data.confirmation_id !== body.confirmation_id || !object(claim.data.args)) {
        return fail(503, "CLAIM_UNCONFIRMED");
      }
      if (!(await current())) return fail(409, "SCOPE_CHANGED");
      const decision = decide(claim.data.args, claim.data.args);
      if (decision.kind !== "execute") return fail(403, "DRAFT_AUTHORITY_HELD");
      const saved = await caller.rpc("commit_weekly_commitment_draft", { _confirmation_id: body.confirmation_id,
        _request_nonce: nonce, _expected_args: decision.args });
      // A lost/failed write response is not permission to try a new request. The
      // original canonical proposal remains inspectable after reload/session changes.
      if (saved.error) {
        const reconciled = await read(String(body.confirmation_id));
        return await finish(reconciled ?? { ok: false, phase: "unknown", confirmation_id: body.confirmation_id, code: "SAVE_UNCONFIRMED" });
      }
      return await finish(saved.data);
    } catch { return fail(503, "WEEKLY_DRAFT_UNAVAILABLE"); }
  };
}

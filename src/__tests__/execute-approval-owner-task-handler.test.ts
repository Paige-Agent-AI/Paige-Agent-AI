// @vitest-environment node
// Actual HTTP handler + actual workspace-authority/action-email modules. SDK,
// Layer-C executor/Gateway and transport ports are protected fixtures, not native
// SQL, Auth/RLS, provider, deployment or customer execution proof.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it } from "vitest";

type Row = Record<string, unknown>;
const A = "11111111-1111-4111-8111-111111111111";
const T = "22222222-2222-4222-8222-222222222222";
const U = "33333333-3333-4333-8333-333333333333";
const P = "44444444-4444-4444-8444-444444444444";
const E = "55555555-5555-4555-8555-555555555555";
const ACT = "66666666-6666-4666-8666-666666666666";
const L = "77777777-7777-4777-8777-777777777777";
const PROCESS = "88888888-8888-4888-8888-888888888888";
const FAKE = "99999999-9999-4999-8999-999999999999";
type Options = {
  admin?: boolean; seat?: string | null; active?: string; inactive?: boolean;
  mutate?: (tables: Record<string, Row[]>) => void;
  ledgerError?: boolean; companionError?: boolean; duplicate?: boolean; authorityError?: boolean;
  switchAt?: "send-check" | "claim"; revokeAtClaim?: boolean; loseActorAtClaim?: boolean;
  claimLost?: boolean; claimHeld?: boolean; canonicalChangedAtClaim?: boolean; replaceClaimAtClaim?: boolean;
  decideAtClaim?: boolean; replaceClaimAtResult?: boolean; stampError?: boolean;
  result?: Row; legacy?: boolean; kind?: string; sendKind?: string; actorMissing?: boolean;
};
function fixture(o: Options = {}) {
  let active = o.active ?? T, seat = o.seat === undefined ? "owner" : o.seat;
  let actor: string | null = o.actorMissing ? null : A;
  const kind = o.kind ?? "owner.task";
  const metadata = { source: "paige_orchestration", event_id: E, act_id: ACT,
    act_execution_id: L, automation_id: PROCESS, capability_id: kind, snapshot_args: { title: "Review contact" } };
  const tables: Record<string, Row[]> = {
    paige_pending_approvals: [{ id: P, source: "paige_orchestration", tenant_id: T, status: "pending",
      type: "other", category: kind, metadata, claimed_at: o.claimHeld ? "2026-10-16T00:00:00Z" : null }],
    paige_act_executions: [{ id: L, event_id: E, act_id: ACT, automation_id: PROCESS, tenant_id: T,
      capability_key: kind, adapter_kind: "native", effective_lane: "confirm", detail: {
        owner_task_source: { v: 1 }, owner_task_approval: { summary: "Review contact" } } }],
    paige_actions: [], paige_action_kinds: [],
  };
  if (o.legacy) Object.assign(tables.paige_pending_approvals[0], { source: "paige_mcp", category: "other", metadata: {} });
  if (o.sendKind) {
    tables.paige_actions.push({ id: FAKE, approval_id: P, tenant_id: T, action_kind: o.sendKind });
    tables.paige_action_kinds.push({ slug: o.sendKind, executor: "send_via_approval" });
  }
  o.mutate?.(tables);
  const writes: Array<{ table: string; patch: Row }> = [], delegates: Row[] = [], rpcCalls: string[] = [], fetches: string[] = [];
  const value = (r: Row, key: string) => key.includes("->>")
    ? (r[key.split("->>")[0]] as Row)?.[key.split("->>")[1]] : r[key];
  const client = {
    auth: { getUser: async () => ({ data: { user: actor ? { id: actor } : null }, error: null }) },
    rpc: async (name: string) => {
      rpcCalls.push(name);
      if (name === "has_role") return { data: o.admin === true, error: null };
      if (name === "is_platform_owner" || name === "agency_can_manage_child") return { data: false, error: null };
      if (name === "current_user_tenant_id") return { data: active, error: null };
      if (name === "is_tenant_admin_as") return { data: !o.inactive && ["owner", "admin"].includes(seat ?? ""), error: o.authorityError ? { message: "unavailable" } : null };
      if (name === "email_campaign_approve" || name === "email_sequence_approve") return { data: { scheduled: true }, error: null };
      throw Error(`Unexpected RPC ${name}`);
    },
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = []; let patch: Row | null = null, lim = Infinity;
      const exec = (single = false) => {
        if (table === "paige_act_executions" && o.ledgerError) return { data: null, error: { message: "fixture unavailable" } };
        if (table === "paige_pending_approvals" && filters.length > 1 && !patch && o.companionError) return { data: null, error: { message: "fixture unavailable" } };
        if (table === "paige_pending_approvals" && patch?.status === "approved" && o.stampError) return { data: null, error: { message: "fixture unavailable" } };
        if (table === "paige_actions" && o.switchAt === "send-check") active = U;
        let rows = table === "user_roles" ? (o.admin ? [{ user_id: A, role: "admin" }] : [])
          : table === "tenant_members" ? (seat && !o.inactive ? [{ user_id: A, tenant_id: T, role: seat, status: "active" }] : []) : tables[table] ?? [];
        rows = rows.filter(r => filters.every(f => f(r))).slice(0, lim);
        if (patch) {
          if (rows.length) writes.push({ table, patch });
          rows.forEach(r => Object.assign(r, patch));
          if (patch.claimed_at) {
            if (o.switchAt === "claim") active = U;
            if (o.revokeAtClaim) seat = "member";
            if (o.loseActorAtClaim) actor = null;
            if (o.canonicalChangedAtClaim) tables.paige_act_executions[0].act_id = FAKE;
            if (o.replaceClaimAtClaim) Object.assign(tables.paige_pending_approvals[0], { claimed_at: "2026-10-16T00:00:00Z", reviewed_by_user_id: FAKE });
            if (o.decideAtClaim) tables.paige_pending_approvals[0].status = "declined";
            if (o.claimLost) return { data: null, error: { message: "fixture lost acknowledgement" } };
          }
        } else if (o.duplicate && table === "paige_pending_approvals" && filters.length > 1) rows = [...rows, ...rows];
        return { data: single ? rows[0] ? structuredClone(rows[0]) : null : structuredClone(rows), error: null };
      };
      const q = {
        select: () => q, update: (v: Row) => { patch = v; return q; },
        eq: (k: string, v: unknown) => { filters.push(r => value(r, k) === v); return q; },
        is: (k: string, v: unknown) => { filters.push(r => (value(r, k) ?? null) === v); return q; },
        in: (k: string, v: unknown[]) => { filters.push(r => v.includes(value(r, k))); return q; },
        limit: (n: number) => { lim = n; return q; },
        maybeSingle: async () => exec(true),
        then: (yes: (v: unknown) => unknown) => Promise.resolve(exec()).then(yes),
      }; return q;
    },
  };
  let handler: (req: Request) => Promise<Response>;
  function load(file: string): Row {
    const mod = { exports: {} as Row };
    const source = ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: file,
    }).outputText;
    runInNewContext(source, { module: mod, exports: mod.exports, Response, Request, Date, URL,
      Deno: { env: { get: () => "fixture-only" }, serve: (fn: typeof handler) => { handler = fn; } },
      fetch: async (url: string) => { fetches.push(url); return Response.json({ status: "sent", audit_id: FAKE }); },
      require: (s: string) => {
        if (s.startsWith("https:")) return { createClient: () => client };
        if (s.endsWith("paige-spine/registry.ts")) return { PAIGE_SPINE_CAPABILITIES: [] };
        if (s.endsWith("approve-executor.ts")) return {
          executeApprovedLayerCAct: async (input: Row) => {
            delegates.push(input);
            if (o.replaceClaimAtResult) Object.assign(tables.paige_pending_approvals[0], { claimed_at: "2026-10-16T00:00:00Z", reviewed_by_user_id: FAKE });
            return o.result ?? { ok: true, executed: true, outcome: "executed" };
          },
          approvalRefusalMessage: () => "This step remains unconfirmed.",
        };
        if (s.endsWith("contact-methods.ts")) return { CLIENT_CONTACT_METHODS_EMBED: "id", clientAddresses: () => ({}) };
        return load(resolve(dirname(file), s));
      },
    }, { filename: file }); return mod.exports;
  }
  load(resolve("supabase/functions/execute-approval/index.ts"));
  return { writes, delegates, rpcCalls, fetches, tables, async run(id = P) {
    const response = await handler!(new Request("https://fixture.invalid", { method: "POST", headers: { Authorization: "Bearer fixture" }, body: JSON.stringify({ approval_id: id }) }));
    return { status: response.status, body: await response.json() };
  } };
}

describe("execute-approval canonical owner.task door", () => {
  for (const seat of ["owner", "admin"]) it(`ordinary ${seat} without a global role reaches only the canonical held task`, async () => {
    const f = fixture({ seat }); const r = await f.run();
    expect(r).toMatchObject({ status: 200, body: { executed: true } });
    expect(f.delegates).toHaveLength(1); expect(f.delegates[0]).toMatchObject({ eventId: E, actId: ACT, approverUserId: A, expectedTenantId: T });
    expect(f.fetches).toHaveLength(0);
  });
  it("a canonical task stays on Layer C despite legacy campaign/email-shaped decoration", async () => {
    const f = fixture({ mutate: t => {
      const row = t.paige_pending_approvals[0]; row.type = "campaign_send"; row.category = "followup";
      row.draft_content = { channel: "email", to: "fixture@example.invalid", body: "Fixture only" };
      Object.assign(row.metadata as Row, { email_campaign_version_id: FAKE, email_sequence_version_id: FAKE });
    } });
    expect((await f.run()).body.executed).toBe(true); expect(f.delegates).toHaveLength(1); expect(f.fetches).toHaveLength(0);
    expect(f.rpcCalls).not.toContain("email_campaign_approve"); expect(f.rpcCalls).not.toContain("email_sequence_approve");
  });
  for (const admin of [false, true]) for (const mode of ["source", "metadata-source", "impostor", "ledger-id", "ledger-tenant", "capability", "automation"] as const) {
    it(`refuses ${mode} mismatch before any claim or effect (legacy admin=${admin})`, async () => {
      const f = fixture({ admin, mutate: t => {
        const row = t.paige_pending_approvals[0], meta = row.metadata as Row;
        if (mode === "source") row.source = "paige_mcp";
        if (mode === "metadata-source") meta.source = "paige_mcp";
        if (mode === "impostor") t.paige_pending_approvals.push({ ...structuredClone(row), id: FAKE, source: "paige_mcp" });
        if (mode === "ledger-id") meta.act_execution_id = FAKE;
        if (mode === "ledger-tenant") t.paige_act_executions[0].tenant_id = U;
        if (mode === "capability") meta.capability_id = "other.kind";
        if (mode === "automation") meta.automation_id = FAKE;
      } });
      expect((await f.run(mode === "impostor" ? FAKE : P)).status).toBeGreaterThanOrEqual(400);
      expect(f.writes).toHaveLength(0); expect(f.delegates).toHaveLength(0); expect(f.fetches).toHaveLength(0);
    });
  }
  for (const fault of ["ledgerError", "companionError", "duplicate"] as const) it(`fails closed on canonical ${fault}`, async () => {
    const f = fixture({ admin: true, [fault]: true }); expect((await f.run()).status).toBeGreaterThanOrEqual(400);
    expect(f.writes).toHaveLength(0); expect(f.delegates).toHaveLength(0);
  });
  for (const mode of ["legacy-source", "missing-binding", "wrong-adapter", "wrong-lane", "no-ledger", "duplicate-ledger"] as const) {
    it(`refuses unproven native task ${mode} before claim`, async () => {
      const f = fixture({ mutate: t => {
        const ledger = t.paige_act_executions[0];
        if (mode === "legacy-source") ledger.detail = { owner_task_approval: {} };
        if (mode === "missing-binding") ledger.detail = { owner_task_source: { v: 1 } };
        if (mode === "wrong-adapter") ledger.adapter_kind = "n8n";
        if (mode === "wrong-lane") ledger.effective_lane = "auto";
        if (mode === "no-ledger") t.paige_act_executions = [];
        if (mode === "duplicate-ledger") t.paige_act_executions.push(structuredClone(ledger));
      } });
      expect((await f.run()).status).toBe(403); expect(f.writes).toHaveLength(0); expect(f.delegates).toHaveLength(0);
    });
  }
  for (const o of [{ seat: "member" }, { seat: null }, { inactive: true }, { active: U }, { actorMissing: true }, { authorityError: true }, { admin: true, seat: "member" }, { admin: true, active: U }]) {
    it(`refuses current task authority ${JSON.stringify(o)}`, async () => {
      const f = fixture(o); expect((await f.run()).status).toBeGreaterThanOrEqual(400); expect(f.writes).toHaveLength(0); expect(f.delegates).toHaveLength(0);
    });
  }
  for (const o of [{ switchAt: "send-check" }, { switchAt: "claim" }, { revokeAtClaim: true }, { loseActorAtClaim: true }, { canonicalChangedAtClaim: true }, { decideAtClaim: true }] as Options[]) {
    it(`retires changed authority/identity before Layer-C ${JSON.stringify(o)}`, async () => {
      const f = fixture(o); expect((await f.run()).status).toBeGreaterThanOrEqual(400); expect(f.delegates).toHaveLength(0); expect(f.fetches).toHaveLength(0);
    });
  }
  it("does not redeem or clear a replaced approval claim", async () => {
    const f = fixture({ replaceClaimAtClaim: true }); expect((await f.run()).status).toBe(409);
    expect(f.delegates).toHaveLength(0); expect(f.tables.paige_pending_approvals[0].reviewed_by_user_id).toBe(FAKE);
    expect(f.tables.paige_pending_approvals[0].claimed_at).toBe("2026-10-16T00:00:00Z");
    expect(f.writes.filter(w => w.patch.claimed_at === null)).toHaveLength(0);
  });
  it("does not execute twice on an already-held claim", async () => {
    const f = fixture({ claimHeld: true }); expect((await f.run()).body).toMatchObject({ executed: false, already: "in_progress" });
    expect(f.writes).toHaveLength(0); expect(f.delegates).toHaveLength(0);
  });
  it("keeps the canonical task's decided response idempotent", async () => {
    const f = fixture({ mutate: t => { t.paige_pending_approvals[0].status = "approved"; } });
    expect((await f.run()).body).toMatchObject({ executed: false, already: "approved" }); expect(f.writes).toHaveLength(0); expect(f.delegates).toHaveLength(0);
  });
  it("does not guess that an uncertain claim failed or delegate/retry it", async () => {
    const f = fixture({ claimLost: true }); expect((await f.run()).status).toBe(503); expect(f.delegates).toHaveLength(0);
    expect(f.writes.filter(w => w.patch.claimed_at === null)).toHaveLength(0);
  });
  for (const result of [{ ok: false, executed: false, outcome: "approval_pending", reason: "governed_capability_not_for_tier" }, { ok: false, executed: false, outcome: "ambiguous", reason: "reconcile_unconfirmed" }, { ok: false, executed: false, outcome: "unknown", reason: "ledger_read_error" }, { ok: false, executed: false, outcome: "accepted_for_execution", reason: "context_locked" }]) {
    it(`preserves nonterminal Layer-C ${result.reason} without marking approved`, async () => {
      const f = fixture({ result }); expect((await f.run()).body).toMatchObject({ ok: false, executed: false, act_outcome: result.outcome });
      expect(f.tables.paige_pending_approvals[0].status).toBe("pending"); expect(f.tables.paige_pending_approvals[0].claimed_at).toBeNull(); expect(f.fetches).toHaveLength(0);
    });
  }
  it("a nonterminal request cannot release a replacement claim", async () => {
    const f = fixture({ replaceClaimAtResult: true, result: { ok: false, executed: false, outcome: "ambiguous" } }); await f.run();
    expect(f.tables.paige_pending_approvals[0].reviewed_by_user_id).toBe(FAKE);
    expect(f.writes.filter(w => w.patch.claimed_at === null)).toHaveLength(0);
  });
  for (const o of [{ stampError: true }, { replaceClaimAtResult: true }]) it(`reports the real terminal result without falsely confirming its receipt ${JSON.stringify(o)}`, async () => {
    const f = fixture(o); expect(await f.run()).toMatchObject({ status: 503, body: { executed: true, act_outcome: "executed", error: "approval_receipt_unconfirmed" } });
    expect(f.delegates).toHaveLength(1); expect(f.tables.paige_pending_approvals[0].status).toBe("pending");
    if (o.stampError) expect(f.tables.paige_pending_approvals[0].claimed_at).toBeNull();
    else expect(f.tables.paige_pending_approvals[0].reviewed_by_user_id).toBe(FAKE);
  });
  it("does not open unrelated legacy approvals to an ordinary owner", async () => {
    const f = fixture({ legacy: true }); expect((await f.run()).status).toBe(403); expect(f.writes).toHaveLength(0);
  });
  it("does not open another native kind to an ordinary owner", async () => {
    const f = fixture({ kind: "crm.advance_journey_stage" }); expect((await f.run()).status).toBe(403); expect(f.writes).toHaveLength(0);
  });
  it("preserves global-admin unrelated acknowledgement admission", async () => {
    const f = fixture({ admin: true, legacy: true }); expect((await f.run()).body).toMatchObject({ executed: false, acknowledged: true }); expect(f.delegates).toHaveLength(0);
  });
  it("preserves legacy global-admin canonical native admission", async () => {
    const f = fixture({ admin: true, kind: "crm.advance_journey_stage", seat: "member" }); expect((await f.run()).body.executed).toBe(true); expect(f.delegates).toHaveLength(1);
  });
  it("preserves global-admin cross-tenant refusal on an unrelated approval", async () => {
    const f = fixture({ admin: true, legacy: true, mutate: t => { t.paige_pending_approvals[0].tenant_id = U; } });
    expect((await f.run()).status).toBe(403); expect(f.writes).toHaveLength(0);
  });
  for (const series of [false, true]) it(`preserves legacy global-admin ${series ? "series" : "campaign"} admission without opening it to ordinary owners`, async () => {
    const mutate = (t: Record<string, Row[]>) => Object.assign(t.paige_pending_approvals[0], {
      type: "campaign_send", metadata: { [series ? "email_sequence_version_id" : "email_campaign_version_id"]: FAKE },
    });
    const f = fixture({ admin: true, legacy: true, mutate });
    expect((await f.run()).body).toMatchObject({ executed: false, scheduled: true }); expect(f.delegates).toHaveLength(0); expect(f.fetches).toHaveLength(0);
    expect(f.rpcCalls).toContain(series ? "email_sequence_approve" : "email_campaign_approve");
    const owner = fixture({ legacy: true, mutate }); expect((await owner.run()).status).toBe(403); expect(owner.writes).toHaveLength(0);
  });
  for (const sendKind of ["client.followup", "owner.lead_followup", "owner.followup_email", "owner.sms_nudge", "comms-draft-reply", "sales.work_followup", "finance.retainer_reminder", "social.post_publish"]) {
    it(`preserves preclaim outbound refusal for ${sendKind}`, async () => {
      const f = fixture({ admin: true, legacy: true, sendKind }); expect((await f.run())).toMatchObject({ status: 409, body: { error: "send_requires_review" } });
      expect(f.writes).toHaveLength(0); expect(f.delegates).toHaveLength(0); expect(f.fetches).toHaveLength(0);
    });
  }
  it("also refuses a send-kind backreference on an otherwise canonical owner task before claim", async () => {
    const f = fixture({ sendKind: "client.followup" }); expect((await f.run()).status).toBe(409); expect(f.writes).toHaveLength(0); expect(f.delegates).toHaveLength(0);
  });
});

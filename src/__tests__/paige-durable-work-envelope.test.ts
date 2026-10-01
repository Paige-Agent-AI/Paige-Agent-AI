import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DURABLE_JOB_STATES } from "../../supabase/functions/_shared/durable-job/mod.ts";

const sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20270417000000_paige_durable_work_envelope.sql"),
  "utf8",
).toLowerCase();

const correlatedTables = [
  "paige_workflow_runs",
  "paige_skill_runs",
  "business_verification_runs",
  "security_canary_runs",
  "paige_readiness_scan_runs",
  "research_runs",
  "paige_eval_run",
  "paige_systems_check_run",
  "paige_authority_act_runs",
  "paige_media_jobs",
  "paige_social_jobs",
  "paige_act_executions",
];

describe("canonical PAIGE durable-work envelope", () => {
  it("creates one cross-capability work-identity table with the adopted state vocabulary", () => {
    expect(sql.match(/create table public\.paige_durable_work\s*\(/g)).toHaveLength(1);
    expect(DURABLE_JOB_STATES).toEqual([
      "claimed",
      "succeeded",
      "failed",
      "blocked",
      "cancelled",
      "expired",
      "outcome_unknown",
    ]);
    for (const state of DURABLE_JOB_STATES) expect(sql).toContain(`'${state}'`);
  });

  it("mints the dispatch key server-side and folds a repeated intent onto the same row", () => {
    const createBody = sql.slice(
      sql.indexOf("create or replace function public.create_paige_durable_work"),
      sql.indexOf("create or replace function public.heartbeat_paige_durable_work"),
    );
    expect(createBody).toContain("'paige-work:' || gen_random_uuid()::text");
    expect(createBody).toContain("on conflict (tenant_id, initiating_user_id, intent_id) do nothing");
    expect(createBody).toContain("durable_work_intent_replay_mismatch");
    expect(createBody).not.toContain("_server_idempotency_key text");
  });

  it("binds tenant, initiating user, thread, authority context, and scope epoch", () => {
    expect(sql).toContain("m.tenant_id = _tenant_id");
    expect(sql).toContain("m.user_id = _initiating_user_id");
    expect(sql).toContain("t.tenant_id = _tenant_id");
    expect(sql).toContain("t.caller_user_id = _initiating_user_id");
    expect(sql).toContain("_authority_context->>'tenant_id' is distinct from _tenant_id::text");
    expect(sql).toContain("_authority_context->>'actor_user_id' is distinct from _initiating_user_id::text");
    expect(sql).toContain("durable_work_identity_immutable");
  });

  it("fails closed on blind retries and unverified success", () => {
    expect(sql).toContain("durable_work_reconciliation_required");
    expect(sql).toContain("durable_work_attempt_ceiling");
    expect(sql).toContain("durable_work_terminal_immutable");
    expect(sql).toContain("durable_work_success_requires_readback");
    expect(sql).toContain("_terminal_outcome->>'verified_readback'");
  });

  it("keeps raw rows server-only and exposes an allowlisted authenticated read", () => {
    expect(sql).toContain("revoke all on table public.paige_durable_work from public, anon, authenticated, service_role");
    expect(sql).not.toContain("grant select, insert, update on table public.paige_durable_work");
    expect(sql).toContain("create or replace function public.get_paige_durable_work");
    const readBody = sql.slice(sql.indexOf("create or replace function public.get_paige_durable_work"));
    expect(readBody).not.toContain("w.authority_context");
    expect(readBody).not.toContain("w.idempotency_key");
    expect(readBody).not.toContain("w.terminal_outcome");
    expect(readBody).toContain("m.status = 'active'");
  });

  it("adds only nullable correlation references to every existing run/job substrate", () => {
    for (const table of correlatedTables) {
      expect(sql).toContain(
        `alter table public.${table} add column if not exists work_id uuid references public.paige_durable_work(id) on delete restrict`,
      );
    }
  });
});

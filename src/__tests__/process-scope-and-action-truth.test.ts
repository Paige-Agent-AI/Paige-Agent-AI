// @vitest-environment node
//
// INT-298 / INT-342 MBC 6a — a form-started process runs only for its form or campaign, and a campaign step's
// outcome only stands on a proven finish. Behaviour is proven against the production-schema clone by
// supabase/tests/process_scope_and_action_truth.sql (database-contract job). This keeps the shape a regression
// would break silently, and proves the dispatcher's own evaluator honours the scope conditions the database
// writes — the engine is not changed by this slice, so it must already match them.
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { evaluateConditions } from "../../supabase/functions/_shared/paige-orchestration/decide.ts";

const mig = readFileSync("supabase/migrations/20271022100000_int298_process_scope_and_action_truth.sql", "utf8");
const proof = readFileSync("supabase/tests/process_scope_and_action_truth.sql", "utf8");
const workflow = readFileSync(".github/workflows/paige-spine-contract.yml", "utf8");

const section = (start: string, end: string) => mig.slice(mig.indexOf(start), mig.indexOf(end, mig.indexOf(start)));
const producer = section("CREATE OR REPLACE FUNCTION public.trg_growth_submission_emit_form_submitted", "$function$;");
const scopeOf = section("CREATE OR REPLACE FUNCTION public._process_form_scope", "REVOKE ALL ON FUNCTION public._process_form_scope");
const guard = section("CREATE OR REPLACE FUNCTION public._automation_form_scope_guard", "REVOKE ALL ON FUNCTION public._automation_form_scope_guard");
const writer = section("CREATE OR REPLACE FUNCTION public.configure_campaign_brief_actions", "REVOKE ALL ON FUNCTION public.configure_campaign_brief_actions");
const read = section("CREATE OR REPLACE FUNCTION public.get_campaign_brief_actions", "REVOKE ALL ON FUNCTION public.get_campaign_brief_actions");

const FORM = "a2980600-0000-4000-8000-0000000000f1";
const OTHER_FORM = "a2980600-0000-4000-8000-0000000000f2";
const CAMPAIGN = "a2980600-0000-4000-8000-0000000000b1";
const facts = (payload: Record<string, unknown>) => ({
  event_key: "form.submitted", subject_table: "clients", subject_id: "c1", payload,
});

describe("the dispatcher honours the scope conditions as written", () => {
  it("a form scope runs for that form and no other", () => {
    const cond = [{ field: "payload.form_id", op: "eq", value: FORM }];
    expect(evaluateConditions(cond, facts({ form_id: FORM, campaign_brief_ids: [] })).matched).toBe(true);
    expect(evaluateConditions(cond, facts({ form_id: OTHER_FORM, campaign_brief_ids: [] })).matched).toBe(false);
  });

  it("several forms run for any of them", () => {
    const cond = [{ field: "payload.form_id", op: "in", value: [FORM, OTHER_FORM] }];
    expect(evaluateConditions(cond, facts({ form_id: OTHER_FORM })).matched).toBe(true);
    expect(evaluateConditions(cond, facts({ form_id: "elsewhere" })).matched).toBe(false);
  });

  it("a campaign scope runs for a form in that campaign, not for a form outside it", () => {
    const cond = [{ field: "payload.campaign_brief_ids", op: "contains", value: CAMPAIGN }];
    expect(evaluateConditions(cond, facts({ form_id: FORM, campaign_brief_ids: [CAMPAIGN] })).matched).toBe(true);
    expect(evaluateConditions(cond, facts({ form_id: OTHER_FORM, campaign_brief_ids: [] })).matched).toBe(false);
    // An event from before this slice carries no list at all: it must not match a campaign scope.
    expect(evaluateConditions(cond, facts({ form_id: FORM })).matched).toBe(false);
  });

  it("other conditions still apply beside the scope", () => {
    const cond = [
      { field: "payload.source", op: "eq", value: "public" },
      { field: "payload.form_id", op: "eq", value: FORM },
    ];
    expect(evaluateConditions(cond, facts({ form_id: FORM, source: "external:test" })).matched).toBe(false);
  });
});

describe("the event names its campaigns", () => {
  it("the payload adds the live campaigns the form is attached to, and nothing private", () => {
    expect(producer).toContain("'campaign_brief_ids', coalesce(_briefs, '[]'::jsonb)");
    expect(producer).toContain("l.asset_kind = 'form' AND l.asset_id = NEW.form_id");
    expect(producer).toContain("b.lifecycle_status <> 'archived'");
    for (const forbidden of ["payload_json", "consent_json", "NEW.ip", "user_agent", "referrer", "funnel_session_id"]) {
      expect(producer).not.toContain(forbidden);
    }
  });
});

describe("a form-started process names its form or campaign before it runs", () => {
  it("refuses to go live unscoped, on every write", () => {
    expect(guard).toContain("IF NEW.state = 'live' AND _scope IS NULL THEN");
  });

  it("accepts exactly one scope, naming only the process's own workspace", () => {
    expect(scopeOf).toContain("IF _n > 1 THEN RAISE EXCEPTION 'PROCESS_SCOPE_INVALID'");
    expect(scopeOf).toContain("f.tenant_id = _tenant");
    expect(scopeOf).toContain("b.tenant_id = _tenant");
  });

  it("stores ids exactly as the event carries them, since the dispatcher compares strictly", () => {
    expect(scopeOf).toContain("(v #>> '{}')::uuid::text <> (v #>> '{}')");
    const seam = section("CREATE OR REPLACE FUNCTION public.configure_process_scope", "REVOKE ALL ON FUNCTION public.configure_process_scope");
    expect(seam).toContain("((_scope->>'formId')::uuid)::text");
    expect(seam).toContain("((_scope->>'briefId')::uuid)::text");
    // And a non-canonical spelling would indeed never match a submission in the engine.
    expect(evaluateConditions([{ field: "payload.form_id", op: "eq", value: FORM.toUpperCase() }], facts({ form_id: FORM })).matched).toBe(false);
  });

  it("never refuses switching a process off, so the brake works even over a stale scope", () => {
    expect(guard).toMatch(/IF TG_OP = 'UPDATE' AND NEW\.state <> 'live' AND NEW\.conditions IS NOT DISTINCT FROM OLD\.conditions[\s\S]*RETURN NEW;/);
    expect(mig).toContain("BEFORE INSERT OR UPDATE OF state, conditions, trigger_key, tenant_id ON public.paige_automations");
  });

  it("the seam is owner/admin, tenant from auth, and audited", () => {
    const seam = section("CREATE OR REPLACE FUNCTION public.configure_process_scope", "REVOKE ALL ON FUNCTION public.configure_process_scope");
    expect(seam).toContain("_tenant uuid := public.current_user_tenant_id()");
    expect(seam).toContain("public.is_tenant_admin(_tenant)");
    expect(seam).toContain("'process.scope'");
    expect(mig).toContain("REVOKE ALL ON FUNCTION public.configure_process_scope(uuid,jsonb,text) FROM PUBLIC, anon, service_role");
  });
});

describe("a recorded step is never shown as an evaluated success", () => {
  it("takes no outcome, and no judgement, unless its finish is proven or it failed", () => {
    expect(writer).toContain("IF _status = 'done' AND NOT _proven THEN RAISE EXCEPTION 'CAMPAIGN_ACTION_NOT_PROVEN'");
    expect(writer).toContain("IF _status IS NULL OR (_status = 'done' AND NOT _proven) OR _status NOT IN ('done','failed') THEN");
  });

  it("reads observed/evaluated only over a proven finish or a failure, and hides a planted outcome", () => {
    expect(read).toContain("WHEN x.evaluated_at IS NOT NULL AND x.finish_counts THEN 'evaluated'");
    expect(read).toContain("WHEN x.observed_at IS NOT NULL AND x.finish_counts THEN 'outcome_observed'");
    expect(read).toContain("'observed_result', CASE WHEN x.finish_counts THEN x.observed_result END");
  });

  it("answers a concurrent link to the same campaign as already linked", () => {
    expect(writer).toMatch(/EXCEPTION WHEN unique_violation THEN[\s\S]*'already_linked'[\s\S]*CAMPAIGN_ACTION_IN_OTHER_CAMPAIGN/);
  });

  it("names a refusal by the action bus as the bus's, and leaves file_action itself unchanged", () => {
    expect(writer).toContain("EXCEPTION WHEN insufficient_privilege THEN");
    expect(writer).toContain("'CAMPAIGN_ACTION_BUS_REFUSED'");
    expect(mig).not.toMatch(/CREATE OR REPLACE FUNCTION public\.file_action/);
  });
});

describe("the proof runs in CI", () => {
  it("the database-contract workflow runs the rolled-back proof", () => {
    expect(workflow).toContain("supabase/tests/process_scope_and_action_truth.sql");
    expect(proof).toMatch(/^BEGIN;/m);
    expect(proof.trimEnd().endsWith("ROLLBACK;")).toBe(true);
  });
});

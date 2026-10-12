// @vitest-environment node
//
// INT-298 / INT-342 MBC 5 — the Marketing Action contract. Behaviour is proven against the
// production-schema clone by supabase/tests/campaign_brief_actions.sql (database-contract job). This
// contract keeps the shape a regression would break silently: the action stays the bus's own row, planning
// files it through file_action at confirm, the lifecycle is derived on read, and outcomes follow a finish.
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

const mig = readFileSync("supabase/migrations/20271021200000_int298_campaign_brief_actions.sql", "utf8");
const proof = readFileSync("supabase/tests/campaign_brief_actions.sql", "utf8");
const workflow = readFileSync(".github/workflows/paige-spine-contract.yml", "utf8");

const section = (start: string, end: string) => mig.slice(mig.indexOf(start), mig.indexOf(end, mig.indexOf(start)));
const writer = section("CREATE OR REPLACE FUNCTION public.configure_campaign_brief_actions", "REVOKE ALL ON FUNCTION public.configure_campaign_brief_actions");
const read = section("CREATE OR REPLACE FUNCTION public.get_campaign_brief_actions", "REVOKE ALL ON FUNCTION public.get_campaign_brief_actions");

describe("the action is the bus's own record", () => {
  it("links to paige_actions rather than keeping a second status", () => {
    expect(mig).toContain("action_id uuid NOT NULL UNIQUE REFERENCES public.paige_actions(id) ON DELETE CASCADE");
    expect(mig).not.toMatch(/campaign_brief_actions\s*\([^;]*\bstatus text/s);
  });

  it("adds one platform kind that waits for approval and drafts nothing", () => {
    expect(mig).toMatch(/'marketing\.campaign_action', NULL, 'Carry out a campaign step'/);
    expect(mig).toMatch(/'marketing', 'marketing', 'record_only', true, 'cs_draft', NULL, 'confirm'/);
  });
});

describe("the writer", () => {
  it("re-resolves the tenant from auth and requires an owner or admin seat", () => {
    expect(writer).toContain("_tenant = public.current_user_tenant_id()");
    expect(writer).toContain("public.is_tenant_admin(_tenant)");
  });

  it("files a planned step through file_action and asks for confirm", () => {
    expect(writer).toMatch(/public\.file_action\('marketing\.campaign_action'[\s\S]*_tenant, 'confirm'\)/);
    expect(writer).not.toMatch(/INSERT INTO public\.paige_actions/);
    expect(writer).not.toMatch(/advance_action|paige_pending_approvals/);
  });

  it("offers no command that sends, publishes or advances", () => {
    expect(writer).toContain("_action NOT IN ('plan_action','link_action','unlink_action','record_outcome','evaluate_outcome')");
  });

  it("records an outcome only after a finish, and an evaluation only after an outcome", () => {
    expect(writer).toContain("IF _status NOT IN ('done','failed') THEN RAISE EXCEPTION 'CAMPAIGN_ACTION_NOT_FINISHED'");
    expect(writer).toContain("IF _link.observed_at IS NULL THEN RAISE EXCEPTION 'CAMPAIGN_ACTION_NO_OUTCOME'");
    expect(mig).toContain("CHECK (evaluated_at IS NULL OR observed_at IS NOT NULL)");
  });

  it("is idempotent through the brief's own ledger and audited", () => {
    expect(writer).toContain("hashtextextended('campaign_brief_command:'||_tenant::text||':'||_idempotency_key, 0)");
    expect(writer).toContain("md5('campaign_brief_actions:'");
    expect(writer).toContain("'campaign_brief.actions'");
  });

  it("is callable by signed-in users only", () => {
    expect(mig).toContain("REVOKE ALL ON FUNCTION public.configure_campaign_brief_actions(uuid,jsonb,text,text) FROM PUBLIC, anon, service_role");
  });
});

describe("the read derives the lifecycle from the action's own status", () => {
  it("maps every bus status, in order, and observed/evaluated last", () => {
    const order = [
      "'evaluated'", "'outcome_observed'", "'planned'", "'prepared'", "'approval_required'", "'scheduled'",
      "'approved'", "'unknown'", "'executing'", "'completed'", "'failed'", "'blocked'", "'stopped'",
    ];
    const at = order.map((s) => read.indexOf(`THEN ${s}`) >= 0 ? read.indexOf(`THEN ${s}`) : read.indexOf(`ELSE ${s}`));
    expect(at.every((i) => i > 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it("reads unknown from the run's durable work, never from a guess", () => {
    expect(read).toContain("WHEN x.status='executing' AND x.work_status='outcome_unknown' THEN 'unknown'");
    expect(read).toContain("LEFT JOIN public.paige_durable_work w ON w.id=r.work_id AND w.tenant_id=_tenant");
  });

  it("says what a finish rests on", () => {
    expect(read).toMatch(/'basis', CASE[\s\S]*'workflow_run'[\s\S]*'approval'[\s\S]*'recorded'/);
  });

  it("keeps titles, summaries, approvals and errors from members", () => {
    for (const field of ["'title', CASE WHEN _admin", "'summary', CASE WHEN _admin", "'approval_id', CASE WHEN _admin", "'error', CASE WHEN _admin"]) {
      expect(read).toContain(field);
    }
  });
});

describe("the proof runs in CI", () => {
  it("the database-contract workflow runs the rolled-back proof", () => {
    expect(workflow).toContain("supabase/tests/campaign_brief_actions.sql");
    expect(proof).toMatch(/^BEGIN;/m);
    expect(proof.trimEnd().endsWith("ROLLBACK;")).toBe(true);
  });
});

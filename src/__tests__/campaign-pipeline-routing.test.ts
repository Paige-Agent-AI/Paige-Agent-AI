// @vitest-environment node
//
// Experience 03 (Grow My Business) S1b — a form with no route of its own files its leads into its campaign's
// pipeline. The behaviour is proven against the rebuilt database by supabase/tests/campaign_pipeline_routing.sql
// (database-contract job). This contract keeps what a later edit could break silently: ONE definition of the
// rule shared by the filing, the metric and the screens' read; the order (own route, campaign, default); the
// carried functions changing only where marked; and CI running the proof.
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

const mig = readFileSync("supabase/migrations/20271026100000_exp03_campaign_pipeline_routing.sql", "utf8");
const prior = readFileSync("supabase/migrations/20271021042001_ads_intake_default_pipeline_and_lead_funnel.sql", "utf8");
const proof = readFileSync("supabase/tests/campaign_pipeline_routing.sql", "utf8");
const workflow = readFileSync(".github/workflows/paige-spine-contract.yml", "utf8");
const processor = readFileSync("supabase/functions/growth-process-submission/index.ts", "utf8");

const between = (src: string, start: string, end: string) => src.slice(src.indexOf(start), src.indexOf(end));
const rule = between(mig, "CREATE OR REPLACE FUNCTION public._growth_form_campaign_route", "REVOKE ALL ON FUNCTION public._growth_form_campaign_route");
const filing = between(mig, "CREATE OR REPLACE FUNCTION public.growth_attach_submission_default_deal", "REVOKE ALL ON FUNCTION public.growth_attach_submission_default_deal");
const priorFiling = between(prior, "CREATE OR REPLACE FUNCTION public.growth_attach_submission_default_deal", "REVOKE ALL ON FUNCTION public.growth_attach_submission_default_deal");
const bundle = between(mig, "CREATE OR REPLACE FUNCTION public._marketing_metric_bundle", "REVOKE ALL ON FUNCTION public._marketing_metric_bundle");
const priorBundle = between(prior, "CREATE OR REPLACE FUNCTION public._marketing_metric_bundle", "REVOKE ALL ON FUNCTION public._marketing_metric_bundle");
const read = between(mig, "CREATE OR REPLACE FUNCTION public.get_form_campaign_routes", "REVOKE ALL ON FUNCTION public.get_form_campaign_routes");

describe("one rule, used everywhere a form's destination is decided or stated", () => {
  it("keys on the form's non-archived campaign links, and only when there is exactly one", () => {
    expect(rule).toContain("l.asset_kind='form' AND l.asset_id=p_form_id");
    expect(rule).toContain("b.lifecycle_status<>'archived'");
    expect(rule).toContain("WHERE (SELECT count(*) FROM linked)=1");
  });

  it("follows only a pipeline of the same business that is not archived and has an open, non-archived stage", () => {
    expect(rule).toContain("p.tenant_id=p_tenant_id AND p.lifecycle_status<>'archived'");
    expect(rule).toContain("s.tenant_id=p_tenant_id AND s.stage_type='open' AND s.archived_at IS NULL");
    expect(rule).toContain("ORDER BY s.order_index, s.id LIMIT 1");
  });

  it("is read by the filing, the metric and the screens' read — and by nothing with a grant", () => {
    expect(filing).toContain("public._growth_form_campaign_route(sub.tenant_id, form.id)");
    expect(bundle).toContain("public._growth_form_campaign_route(p_tenant_id,f.id)");
    expect(read).toContain("public._growth_form_campaign_route(_tenant, f.id)");
    expect(mig).toContain("REVOKE ALL ON FUNCTION public._growth_form_campaign_route(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;");
    expect(mig).not.toMatch(/GRANT EXECUTE ON FUNCTION public\._growth_form_campaign_route/);
  });
});

describe("the order is own route, then campaign, then default", () => {
  it("the filing still refuses a form that routes its own deals, before choosing any pipeline", () => {
    expect(filing.indexOf("FORM_DEAL_ROUTE_INVALID")).toBeGreaterThan(0);
    expect(filing.indexOf("FORM_DEAL_ROUTE_INVALID")).toBeLessThan(filing.indexOf("_growth_form_campaign_route"));
  });

  it("tries the campaign's pipeline before the default, and falls through to the default when it cannot take the lead", () => {
    expect(filing.indexOf("_growth_form_campaign_route")).toBeLessThan(filing.indexOf("WHERE tenant_id=sub.tenant_id AND is_default"));
    expect(filing).toContain("IF stage IS NULL THEN pipeline:=NULL; campaign:=NULL; END IF;");
  });

  it("changes the carried filing function only where marked", () => {
    // Everything before the pipeline choice is the prior body, line for line.
    const head = (src: string) => src.slice(src.indexOf("BEGIN"), src.indexOf("-- Previously committed identity wins"));
    expect(head(filing)).toBe(head(priorFiling));
    const tail = (src: string) => src.slice(src.indexOf("  SELECT * INTO deal FROM public.deals\n   WHERE tenant_id=sub.tenant_id AND pipeline_id=pipeline"), src.indexOf("  UPDATE public.growth_form_submissions SET deal_id"));
    expect(tail(filing)).toBe(tail(priorFiling));
  });

  it("changes the carried metric only in the unrouted branch", () => {
    const strip = (src: string) => src
      .replace(/\n {5}-- 20271026100000[^\n]*\n {5}--[^\n]*\n {5}OR EXISTS\(SELECT 1 FROM public\._growth_form_campaign_route\(p_tenant_id,f\.id\)\)/, "")
      .replace(/ {3}definition:='Live forms whose leads reach no pipeline[^\n]*\n {3}formula:='COUNT\(live forms WHERE NOT[^\n]*/, "");
    expect(strip(bundle)).toBe(strip(priorBundle));
    expect(strip(bundle)).not.toBe(bundle);
  });
});

describe("what is not changed", () => {
  it("leaves the processor as is: it already hands every unrouted form's lead to the filing function", () => {
    expect(processor).toContain('admin.rpc("growth_attach_submission_default_deal"');
  });

  it("changes no table, column or policy, and no Sales table", () => {
    expect(mig).not.toMatch(/\b(CREATE|ALTER|DROP) TABLE\b|\bADD COLUMN\b|\bCREATE POLICY\b|\bALTER POLICY\b/i);
  });

  it("keeps the screens' read to the caller's own business, for signed-in callers only", () => {
    expect(read).toContain("NOT (public.is_platform_owner() OR _tenant = public.current_user_tenant_id())");
    expect(mig).toContain("REVOKE ALL ON FUNCTION public.get_form_campaign_routes(uuid) FROM PUBLIC, anon, service_role;");
    expect(mig).toContain("GRANT EXECUTE ON FUNCTION public.get_form_campaign_routes(uuid) TO authenticated;");
  });
});

describe("CI runs the proof", () => {
  it("runs the rolled-back proof in the database-contract job", () => {
    expect(workflow).toContain("supabase/tests/campaign_pipeline_routing.sql");
    expect(proof).toContain("ROLLBACK;");
    expect(proof).toContain("two campaigns → no campaign route, never guessed");
    expect(proof).toContain("a pipeline of another workspace is never followed");
  });
});

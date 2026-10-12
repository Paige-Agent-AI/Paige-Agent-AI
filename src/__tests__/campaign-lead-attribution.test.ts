// @vitest-environment node
//
// Experience 03 (Grow My Business) S1 — a lead carries the campaign it came from. The behaviour is proven
// against the rebuilt database by supabase/tests/campaign_lead_attribution.sql (database-contract job). This
// contract keeps what a later edit could break silently: the stamp using the platform's two existing
// definitions (so it never disagrees with Analytics or the form.submitted payload), the decision order, the
// stamp staying fixed after capture, the read withholding names from members, and CI running the proof.
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

const mig = readFileSync("supabase/migrations/20271025100000_exp03_campaign_lead_attribution.sql", "utf8");
const proof = readFileSync("supabase/tests/campaign_lead_attribution.sql", "utf8");
const workflow = readFileSync(".github/workflows/paige-spine-contract.yml", "utf8");
const metric = readFileSync("supabase/migrations/20271021042001_ads_intake_default_pipeline_and_lead_funnel.sql", "utf8");
const formEvent = readFileSync("supabase/migrations/20271022100000_int298_process_scope_and_action_truth.sql", "utf8");

const between = (src: string, start: string, end: string) => src.slice(src.indexOf(start), src.indexOf(end));
const stamp = between(mig, "CREATE OR REPLACE FUNCTION public.growth_submission_stamp_campaign()", "REVOKE ALL ON FUNCTION public.growth_submission_stamp_campaign()");
const read = between(mig, "CREATE OR REPLACE FUNCTION public.get_campaign_brief_leads", "REVOKE ALL ON FUNCTION public.get_campaign_brief_leads");

describe("the stamp uses the platform's existing definitions", () => {
  it("matches a campaign tag exactly as marketing.leads.by_campaign_tag does", () => {
    expect(metric).toContain("lower(public._marketing_metric_text(b.short_ref,120))");
    expect(stamp).toContain("lower(public._marketing_metric_text(NEW.utm_json ->> 'utm_campaign', 120))");
    expect(stamp).toContain("lower(public._marketing_metric_text(b.short_ref, 120)) = _tag");
    // A tag several campaigns share names none, as the metric excludes it.
    expect(stamp).toContain("IF cardinality(_tagged) > 1 THEN _tagged := '{}'; END IF;");
    // Only a string tag is matched, as the metric reads only string tags.
    expect(stamp).toContain("jsonb_typeof(NEW.utm_json -> 'utm_campaign') = 'string'");
  });

  it("reads a form's campaigns exactly as the form.submitted payload does (non-archived, same workspace)", () => {
    expect(formEvent).toContain("b.lifecycle_status <> 'archived'");
    expect(stamp).toContain("b.tenant_id = NEW.tenant_id AND b.lifecycle_status <> 'archived'");
    expect(stamp).toContain("l.asset_kind = 'form' AND l.asset_id = NEW.form_id");
  });

  it("decides in the documented order and never guesses", () => {
    const order = ["'form_and_tag'", "'form_link'", "'campaign_tag'", "'none'", "'ambiguous'"].map((k) => stamp.indexOf(k));
    expect(order.every((at) => at > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(stamp).toMatch(/ELSE\s+NEW\.campaign_brief_id := NULL;\s+NEW\.campaign_attribution := 'ambiguous';/);
  });

  it("is set at insert by a trigger, whatever the writer sent, and fixed afterwards", () => {
    expect(mig).toContain("BEFORE INSERT OR UPDATE OF campaign_brief_id, campaign_attribution ON public.growth_form_submissions");
    expect(stamp).toContain("SUBMISSION_ATTRIBUTION_IMMUTABLE");
    // Only a deleted campaign (ON DELETE SET NULL) may clear it: a NULL is refused while the campaign exists,
    // because the table's tenant update policy lets any member UPDATE the row (§39 finding on #2068).
    expect(stamp).toContain("OR EXISTS (SELECT 1 FROM public.campaign_briefs b WHERE b.id = OLD.campaign_brief_id)");
    expect(mig).toContain("REFERENCES public.campaign_briefs(id) ON DELETE SET NULL");
    expect(mig).toMatch(/CREATE INDEX IF NOT EXISTS growth_form_submissions_campaign_fk\s+ON public\.growth_form_submissions \(campaign_brief_id\)/);
  });

  it("changes no Sales table: deals, contacts and pipelines are untouched", () => {
    expect(mig).not.toMatch(/ALTER TABLE public\.(deals|clients|pipelines|pipeline_stages)/);
    expect(mig).not.toMatch(/(INSERT INTO|UPDATE|DELETE FROM) public\.(deals|clients|pipelines)/);
  });

  it("is callable by no API role", () => {
    expect(mig).toContain("REVOKE ALL ON FUNCTION public.growth_submission_stamp_campaign() FROM PUBLIC, anon, authenticated, service_role");
    expect(stamp).toContain("SET search_path = ''");
  });
});

describe("the campaign's leads read", () => {
  it("serves only the caller's own workspace and is not anonymous", () => {
    expect(read).toContain("_tenant = public.current_user_tenant_id()");
    expect(read).toContain("CAMPAIGN_BRIEF_FORBIDDEN");
    expect(read).toContain("b.id = _brief_id AND b.tenant_id = _tenant");
    expect(mig).toContain("REVOKE ALL ON FUNCTION public.get_campaign_brief_leads(uuid, uuid) FROM PUBLIC, anon, service_role");
    expect(mig).toContain("GRANT EXECUTE ON FUNCTION public.get_campaign_brief_leads(uuid, uuid) TO authenticated");
  });

  it("withholds names and record ids from members on this read, as campaign assets and steps do", () => {
    for (const field of ["contact_id", "contact_name", "deal_id", "deal_title"]) {
      expect(read).toMatch(new RegExp(`'${field}', CASE WHEN _admin THEN`));
    }
  });

  it("joins every record inside the workspace", () => {
    for (const join of ["d.tenant_id = _tenant", "p.tenant_id = _tenant", "st.tenant_id = _tenant", "c.tenant_id = _tenant", "f.tenant_id = _tenant"]) {
      expect(read).toContain(join);
    }
  });

  it("tells the owner about leads it could not credit instead of undercounting quietly", () => {
    expect(read).toContain("'ambiguous_on_campaign_forms'");
    expect(read).toContain("'truncated'");
  });
});

describe("the proof runs", () => {
  it("is a step of the database-contract job", () => {
    expect(workflow).toContain("-f supabase/tests/campaign_lead_attribution.sql");
  });

  it("covers every decision, the immutable stamp, the real intake writer, the member view and the refusals", () => {
    for (const label of [
      "→ form_and_tag", "→ form_link", "→ campaign_tag", "→ ambiguous, no campaign chosen", "→ ambiguous, never guessed",
      "→ none", "A''s is never chosen", "replaced by the decision", "cannot be changed after capture",
      "growth_attach_submission_default_deal", "a member never sees names or ids", "naming another workspace is refused",
      "anon cannot read", "a deleted campaign leaves the method",
      "a member cannot clear a lead''s campaign", "a member cannot rewrite how a lead was credited", "a tag shared by two campaigns names neither",
    ]) {
      expect(proof).toContain(label);
    }
    expect(proof.trimEnd().endsWith("ROLLBACK;")).toBe(true);
  });
});

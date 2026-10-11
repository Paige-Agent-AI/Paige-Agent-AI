// @vitest-environment node
//
// INT-298 / INT-342 MBC 4a — `form.submitted` on the native event bus. The behaviour is proven against the
// production-schema clone by supabase/tests/form_submitted_native_event.sql (database-contract job). This
// contract keeps the shape a regression would break silently: the catalogue row, the one producer, the
// payload staying ids-and-tags only, and the existing dispatcher accepting the event unchanged.
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

const mig = readFileSync("supabase/migrations/20271020000030_int298_form_submitted_native_event.sql", "utf8");
const proof = readFileSync("supabase/tests/form_submitted_native_event.sql", "utf8");
const workflow = readFileSync(".github/workflows/paige-spine-contract.yml", "utf8");
const processor = readFileSync("supabase/functions/growth-process-submission/index.ts", "utf8");
const subjectTenant = readFileSync("supabase/functions/_shared/paige-orchestration/subject-tenant.ts", "utf8");

const fnBody = mig.slice(
  mig.indexOf("CREATE OR REPLACE FUNCTION public.trg_growth_submission_emit_form_submitted"),
  mig.indexOf("REVOKE ALL ON FUNCTION public.trg_growth_submission_emit_form_submitted"),
);

describe("form.submitted — the catalogue row", () => {
  it("is a live trigger in the existing §67 catalogue, so a process can start from it", () => {
    expect(mig).toContain("INSERT INTO public.paige_automation_triggers");
    expect(mig).toMatch(/'form\.submitted',\s*'Someone fills in a form',\s*'forms'[^;]*true,\s*NULL\)/s);
    expect(mig).toContain("ON CONFLICT (key) DO NOTHING");
  });
});

describe("the producer", () => {
  it("fires on insert with a contact and on the processor's contact pin, never on other updates", () => {
    expect(mig).toContain("AFTER INSERT OR UPDATE OF contact_id ON public.growth_form_submissions");
    expect(fnBody).toContain("NEW.contact_id IS NULL OR (TG_OP = 'UPDATE' AND OLD.contact_id IS NOT NULL)");
  });

  it("is once per submission: the dedup key is the submission id alone", () => {
    expect(fnBody).toContain("'form.submitted:' || NEW.id::text");
    expect(fnBody).toContain("ON CONFLICT (dedup_key) DO NOTHING");
  });

  it("only delivers a contact of the submission's own workspace (§9)", () => {
    expect(fnBody).toMatch(/c\.id = NEW\.contact_id AND c\.tenant_id = NEW\.tenant_id/);
  });

  it("subjects the event to the contact, which the dispatcher's tenant check already supports", () => {
    expect(fnBody).toContain("'form.submitted', NEW.tenant_id, 'clients', NEW.contact_id");
    expect(subjectTenant).toContain("clients");
  });

  it("carries ids and link tags only, never the form's answers or the visitor's network details", () => {
    for (const key of ["submission_id", "form_id", "contact_id", "source", "utm_source", "utm_campaign", "funnel_session_id", "submitted_at"]) {
      expect(fnBody).toContain(`'${key}'`);
    }
    for (const forbidden of ["payload_json", "consent_json", "NEW.ip", "user_agent", "referrer"]) {
      expect(fnBody).not.toContain(forbidden);
    }
  });

  it("is a transactional outbox like contact.created: no exception handler swallows the event write", () => {
    expect(fnBody).not.toMatch(/EXCEPTION\s+WHEN/);
    expect(fnBody).toContain("PERFORM public.paige_fire_event_processor(_event_id, NEW.tenant_id)");
  });

  it("is not callable by app roles", () => {
    expect(mig).toContain("REVOKE ALL ON FUNCTION public.trg_growth_submission_emit_form_submitted() FROM PUBLIC, anon, authenticated");
    expect(fnBody).toContain("SET search_path TO 'public'");
  });
});

describe("the contact pin this producer relies on", () => {
  it("growth-process-submission still pins contact_id once, only when unset", () => {
    expect(processor).toMatch(/\.update\(\{ contact_id: contactId \}\)[\s\S]{0,200}\.is\("contact_id", null\)/);
  });
});

describe("the proof runs in CI", () => {
  it("the database-contract workflow runs the rolled-back proof", () => {
    expect(workflow).toContain("supabase/tests/form_submitted_native_event.sql");
    expect(proof).toMatch(/^BEGIN;/m);
    expect(proof.trimEnd().endsWith("ROLLBACK;")).toBe(true);
  });
});

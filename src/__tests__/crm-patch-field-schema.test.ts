/**
 * The CRM patch schema agrees with the database that enforces it.
 *
 * THE INCIDENT, on production 2026-09-25. The owner asked Paige in live Solo chat to add a contact
 * — John Coleman, at a heating and cooling company, with a Chicago street address — and pressed
 * Approve. The approval was claimed correctly. Then the executor threw at 17:37:52.303Z:
 *
 *     CRM_PATCH_FIELDS_INVALID:company_name,zip
 *
 * Paige had sent `company_name` and `zip`. The executor accepts `entity_name` and `zip_code`. She
 * had no way to know, because the tool definition described `patch` as a bare `{type:"object"}`.
 *
 * These tests validate with a REAL JSON Schema validator (ajv) rather than asserting the shape of
 * the schema object, so what is proven is the behaviour a provider enforces at the tool boundary:
 * the owner's literal failing payload is REFUSED before it can reach the database, and the
 * corrected one is accepted.
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Ajv, { type ErrorObject, type SchemaObject } from "ajv";
import { CRM_COMMAND_TOOLS } from "../../supabase/functions/_shared/crm-command/catalog.ts";
import { CRM_PATCH_FIELDS } from "../../supabase/functions/_shared/crm-command/patch-fields.generated.ts";

// The migration that now owns the contact allowlists (it restates the three executors whole).
const MIGRATION = "supabase/migrations/20270516000000_crm_commands_speak_contact_methods.sql";
const GEN = "scripts/ci/crm-patch-field-gen.mjs";

const patchSchema = (toolName: string): SchemaObject | undefined =>
  CRM_COMMAND_TOOLS.find((t) => t.function.name === toolName)?.function.parameters.properties.patch;

/** Validate a patch against the tool's own patch schema, the way a provider does. */
function validate(toolName: string, patch: Record<string, unknown>) {
  const schema = patchSchema(toolName);
  if (!schema) throw new Error(`no CRM tool named ${toolName} carries a patch schema`);
  const ajv = new Ajv({ allErrors: true, strict: false });
  const v = ajv.compile(schema);
  const ok = v(patch);
  const offending = (v.errors ?? [])
    .filter((e: ErrorObject) => e.keyword === "additionalProperties")
    .map((e: ErrorObject) => String(e.params.additionalProperty));
  return { ok, offending };
}

describe("CRM patch schema is generated from the database allowlist", () => {
  it("refuses the owner's exact failing payload and accepts the corrected one", () => {
    // Verbatim from the incident: what Paige actually sent on 2026-09-25.
    const whatPaigeSent = {
      first_name: "John",
      last_name: "Coleman",
      company_name: "Luxury Heating and Cooling Company",
      street_address: "7339 South Saint Lawrence Avenue",
      city: "Chicago",
      state: "Illinois",
      zip: "60619",
    };
    const sent = validate("crm_create_contact", whatPaigeSent);
    expect(sent.ok).toBe(false);
    // Refused at the schema boundary, naming the same two fields the executor named.
    expect(sent.offending.sort()).toEqual(["company_name", "zip"]);

    // The same contact under the names the database actually accepts.
    const corrected = {
      first_name: "John",
      last_name: "Coleman",
      entity_name: "Luxury Heating and Cooling Company",
      street_address: "7339 South Saint Lawrence Avenue",
      city: "Chicago",
      state: "Illinois",
      zip_code: "60619",
    };
    expect(validate("crm_create_contact", corrected).ok).toBe(true);
  });

  it("tells the model what entity_name means, since that mismatch is what broke", () => {
    const schema = patchSchema("crm_create_contact");
    expect(schema.properties.entity_name.description).toMatch(/company/i);
    expect(schema.properties.zip_code.description).toMatch(/zip/i);
    expect(schema.additionalProperties).toBe(false);
  });

  it("keeps the seven allowlists separate rather than collapsing them into one", () => {
    // contact.create allows `notes`; contact.update allows `current_notes`. A single shared list
    // would be wrong for one of them, whichever way it was written.
    expect(validate("crm_create_contact", { notes: "met at the expo" }).ok).toBe(true);
    expect(validate("crm_create_contact", { current_notes: "met at the expo" }).ok).toBe(false);
    expect(validate("crm_update_contact", { current_notes: "met at the expo" }).ok).toBe(true);
    expect(validate("crm_update_contact", { notes: "met at the expo" }).ok).toBe(false);

    // task.create takes six fields task.update rejects.
    expect(validate("crm_create_task", { title: "Call back", assignee_user_id: "x", due_date: "2026-10-01" }).ok).toBe(true);
    expect(validate("crm_update_task", { title: "Call back", assignee_user_id: "x" }).ok).toBe(false);

    expect(CRM_PATCH_FIELDS["contact.create"].map((f) => f.name))
      .not.toEqual(CRM_PATCH_FIELDS["contact.update"].map((f) => f.name));
    expect(Object.keys(CRM_PATCH_FIELDS)).toHaveLength(7);
  });

  it("leaves the actions the database does NOT allowlist open, inventing no constraint", () => {
    // task.assign / task.reschedule / activity.log read specific keys and ignore the rest, so the
    // database cannot raise CRM_PATCH_FIELDS_INVALID for them. Closing them here would refuse a
    // legitimate patch that prod would have accepted.
    for (const tool of ["crm_assign_task", "crm_reschedule_task", "crm_log_activity"]) {
      expect(patchSchema(tool).additionalProperties).toBeUndefined();
      expect(patchSchema(tool).properties).toBeUndefined();
    }
    expect(validate("crm_log_activity", { channel: "call", subject: "Intro", body: "Spoke for 10m" }).ok).toBe(true);
  });

  it("goes red when a field is renamed in the source of truth", () => {
    // Reinstate the original defect in the DATABASE definition — rename entity_name back to
    // company_name — and prove the guard catches it instead of shipping a stale schema.
    const dir = mkdtempSync(join(tmpdir(), "crm-drift-"));
    try {
      const sql = readFileSync(MIGRATION, "utf8").split("'entity_name'").join("'company_name'");
      writeFileSync(join(dir, "20270516000000_mutated.sql"), sql);
      const r = spawnSync(process.execPath, [GEN], {
        env: { ...process.env, CRM_PATCH_MIGRATIONS_DIR: dir, CRM_PATCH_LIVE_DEFS: "" },
        encoding: "utf8",
      });
      const out = `${r.stdout}${r.stderr}`;
      expect(r.status).toBe(1);
      expect(out).toContain("no longer matches");
      expect(out).toContain("+ company_name");
      expect(out).toContain("- entity_name");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("is green against the unmodified source of truth", () => {
    const r = spawnSync(process.execPath, [GEN], {
      env: { ...process.env, CRM_PATCH_LIVE_DEFS: "" },
      encoding: "utf8",
    });
    expect(`${r.stdout}${r.stderr}`).toContain("match the database");
    expect(r.status).toBe(0);
  });
});

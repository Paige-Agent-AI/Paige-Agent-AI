/**
 * Stage 4 — Paige pipeline create/archive completion.
 *
 * Inventory finding: the governed path is complete (configure_tenant_pipeline_as_paige
 * with command envelope, idempotency cache, version guards, admin authority, and the
 * preview→owner-confirmation→token flow for archive; archive never inherits auto and hard
 * delete is unavailable). Two pieces were missing:
 *
 * 1. The legacy direct-RPC tools (pipeline_create / pipeline_add_stage) survived as dead
 *    handlers after their manifest entries and action-risk classifications were removed —
 *    a second, ungoverned execution path and the likely origin of the tenant's duplicate
 *    same-name pipelines. This suite pins their complete retirement.
 *
 * 2. Nothing anywhere was intentional about same-name pipeline creation — the governed
 *    create inserted silently. This suite pins the guard: creation refuses when an active
 *    pipeline already carries the exact name, unless the command explicitly says
 *    allowSameName, and the refusal names the catalogue read that shows every match.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const chat = read("supabase/functions/paige-ai-chat/index.ts");

function latestCatalogueMigration(): string {
  const dir = join(root, "supabase/migrations");
  const files = readdirSync(dir).filter((f) => /^2027\d{10}/.test(f)).sort();
  for (let i = files.length - 1; i >= 0; i -= 1) {
    const body = readFileSync(join(dir, files[i]), "utf8");
    if (body.includes("CREATE OR REPLACE FUNCTION public.list_tool_autonomy")) return body;
  }
  return "";
}
function latestConfigureMigration(
  files = readdirSync(join(root, "supabase/migrations")).filter((f) => /^2027\d{10}/.test(f)),
  readMigration: (file: string) => string = (file) => readFileSync(join(root, "supabase/migrations", file), "utf8"),
): string {
  for (const file of [...files].sort().reverse()) {
    const body = readMigration(file);
    // A later domain command may CALL this writer without redefining its guard.
    // Inspect a declaration of the canonical writer or its existing delegated implementation.
    if (/^\s*create\s+(?:or\s+replace\s+)?function\s+public\.configure_tenant_pipeline_core_identity(?:_pre_command_desk)?\s*\(/im.test(body)) return body;
  }
  return "";
}

describe("the legacy direct pipeline tools are fully retired", () => {
  it("keeps no handler, dispatch entry, label or card case for them", () => {
    expect(chat).not.toContain('tc.function.name === "pipeline_create"');
    expect(chat).not.toContain('tc.function.name === "pipeline_add_stage"');
    expect(chat).not.toContain('case "pipeline_create"');
    expect(chat).not.toContain('case "pipeline_add_stage"');
    expect(chat).not.toContain('"pipeline_create"');
    expect(chat).not.toContain('"pipeline_add_stage"');
  });

  it("keeps no call to the legacy direct RPCs", () => {
    expect(chat).not.toContain("create_pipeline_with_stages");
    expect(chat).not.toContain("add_pipeline_stage");
  });

  it("is not vacuous: the governed pipeline tools remain", () => {
    expect(chat).toContain('name: "pipeline_configure"');
    expect(chat).toContain('name: "pipeline_archive_preview"');
    expect(chat).toContain("configure_tenant_pipeline_as_paige");
  });
});

describe("the autonomy catalogue drops the retired rows", () => {
  it("the latest catalogue declaration carries neither row", () => {
    const catalogue = latestCatalogueMigration();
    expect(catalogue).not.toBe("");
    expect(catalogue).not.toContain("'pipeline_create'");
    expect(catalogue).not.toContain("'pipeline_add_stage'");
  });
});

describe("same-name pipeline creation is intentional", () => {
  it("selects the actual latest declaration rather than a newer caller, ACL or lookalike", () => {
    const declaration = "create or replace function public.configure_tenant_pipeline_core_identity(_tenant_id uuid) returns void as $$ begin null; end $$ language plpgsql;";
    const fixtures = new Map([
      ["20270501000000_old.sql", declaration + " -- old"],
      ["20270531000000_current.sql", declaration],
      ["20271108121000_task.sql", "create or replace function public.execute_crm_command() returns void as $$ begin perform public.configure_tenant_pipeline_core_identity(v_tenant); end $$ language plpgsql;"],
      ["20271108122000_acl.sql", "revoke all on function public.configure_tenant_pipeline_core_identity(uuid) from public;"],
      ["20271108123000_similar.sql", "create or replace function public.configure_tenant_pipeline_core_identity_audit() returns void as $$ begin null; end $$ language plpgsql;"],
      ["20271108124000_comment.sql", "-- create or replace function public.configure_tenant_pipeline_core_identity() is only documentation"],
    ]);
    expect(latestConfigureMigration([...fixtures.keys()], file => fixtures.get(file)!)).toBe(declaration);
  });

  it("does not substitute an older guarded declaration for a newer unguarded definition", () => {
    const current = "CREATE OR REPLACE FUNCTION public.configure_tenant_pipeline_core_identity() returns void as $$ begin null; end $$ language plpgsql;";
    const fixtures = new Map([
      ["20270501000000_old.sql", current + " -- PIPELINE_NAME_EXISTS"],
      ["20270531000000_current.sql", current],
    ]);
    expect(latestConfigureMigration([...fixtures.keys()], file => fixtures.get(file)!)).toBe(current);
    expect(latestConfigureMigration(["20271108121000_task.sql"], () => "perform public.configure_tenant_pipeline_core_identity(v_tenant);")).toBe("");
    const delegated = current.replace("core_identity()", "core_identity_pre_command_desk()");
    expect(latestConfigureMigration(["20271108121000_delegate.sql"], () => delegated)).toBe(delegated);
  });

  it("the governed create refuses an existing active exact name unless allowSameName", () => {
    const migration = latestConfigureMigration();
    expect(migration).not.toBe("");
    expect(migration).toContain("PIPELINE_NAME_EXISTS");
    expect(migration).toMatch(/allowSameName/);
    expect(migration).toMatch(/archived_at is null[\s\S]{0,400}btrim\(p\.name\)=btrim\(_command->>'name'\)|btrim\(p\.name\)=btrim\(_command->>'name'\)[\s\S]{0,400}archived_at is null/);
  });

  it("the refusal routes the model to the catalogue read and an explicit owner choice", () => {
    const migration = latestConfigureMigration();
    expect(migration).toMatch(/pipeline_catalogue[\s\S]{0,200}PPL reference/i);
  });

  it("the governed command schema declares allowSameName so the escape hatch is emittable", () => {
    expect(chat).toMatch(/allowSameName: \{ type: "boolean"/);
  });

  it("the tool description teaches the same-name rule", () => {
    expect(chat).toMatch(/same name[\s\S]{0,220}allowSameName/i);
  });
});

describe("the governed archive contract stays intact", () => {
  it("archive still requires the preview token and the exact reference", () => {
    expect(chat).toMatch(/pipeline_archive_preview[\s\S]{0,300}confirmation[\s\S]{0,300}pipeline_configure/s);
    expect(chat).toContain("prepare_pipeline_archive_as_paige");
  });

  it("archive never runs unattended and hard delete stays unavailable", () => {
    expect(chat).toMatch(/Archive never inherits auto mode and hard delete is unavailable/);
  });
});

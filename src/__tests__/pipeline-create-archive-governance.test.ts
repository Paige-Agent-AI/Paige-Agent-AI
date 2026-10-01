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
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const chat = read("supabase/functions/paige-ai-chat/index.ts");

function latestCatalogueMigration(): string {
  const { readdirSync } = require("node:fs") as typeof import("node:fs");
  const dir = join(root, "supabase/migrations");
  const files = readdirSync(dir).filter((f) => /^2027\d{10}/.test(f)).sort();
  for (let i = files.length - 1; i >= 0; i -= 1) {
    const body = readFileSync(join(dir, files[i]), "utf8");
    if (body.includes("CREATE OR REPLACE FUNCTION public.list_tool_autonomy")) return body;
  }
  return "";
}
function latestConfigureMigration(): string {
  const { readdirSync } = require("node:fs") as typeof import("node:fs");
  const dir = join(root, "supabase/migrations");
  const files = readdirSync(dir).filter((f) => /^2027\d{10}/.test(f)).sort();
  for (let i = files.length - 1; i >= 0; i -= 1) {
    const body = readFileSync(join(dir, files[i]), "utf8");
    if (body.includes("configure_tenant_pipeline_core_identity")) return body;
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

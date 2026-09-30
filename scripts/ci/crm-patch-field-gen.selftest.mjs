/**
 * Negative controls for crm-patch-field-gen.
 *
 * A guard that has never been watched to FAIL is indistinguishable from a guard that cannot fail,
 * so every case below reinstates a specific defect and asserts the real CLI exits non-zero with the
 * reason that would actually help the person who tripped it. Each runs the shipped script in a
 * child process against a fixture migration directory — not a reimplementation of its logic, which
 * would only prove the copy agrees with itself.
 */
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "crm-patch-field-gen.mjs");

/** Structurally faithful miniature of the real migration: same branch shape, same allowlist form. */
function fixtureSql({
  contactCreate = "'first_name','entity_name','zip_code','notes'",
  contactUpdate = "'first_name','entity_name','zip_code','current_notes'",
  taskCreate = "'title','assignee_user_id','due_date'",
  taskUpdate = "'title','track'",
  companyCreate = "'legal_name','dba'",
  companyUpdate = "'legal_name','dba'",
  bulk = "'lifecycle_stage','tags'",
  extraSite = "",
  orphanBranch = false,
} = {}) {
  const guard = (list) => `
    select array_agg(k order by k) into v_unknown from jsonb_object_keys(v_patch) k
     where k not in (${list});
    if v_unknown is not null then raise exception 'CRM_PATCH_FIELDS_INVALID:%', array_to_string(v_unknown,','); end if;`;
  return `
create or replace function public.execute_crm_command_reversible(_command jsonb)
returns jsonb language plpgsql as $$
begin
  if v_action = 'deal.move' then
    null;
  elsif v_action = 'contact.create' then${orphanBranch ? "\n  elsif v_action = 'contact.orphan' then" : ""}${guard(contactCreate)}
  elsif v_action like 'contact.%' then
    if v_action = 'contact.update' then${guard(contactUpdate)}
    end if;
  elsif v_action = 'task.create' then${guard(taskCreate)}
  elsif v_action like 'task.%' then
    if v_action = 'task.update' then${guard(taskUpdate)}
    end if;
  elsif v_action = 'company.create' then${guard(companyCreate)}
  elsif v_action like 'company.%' then
    if v_action = 'company.update' then${guard(companyUpdate)}
    end if;${extraSite ? `\n  elsif v_action = 'contact.newthing' then${guard(extraSite)}` : ""}
  end if;
end $$;

create or replace function public.preview_crm_command(_command jsonb)
returns jsonb language plpgsql as $$
begin
  else
    select pg_catalog.array_agg(k order by k) into unknown
      from pg_catalog.jsonb_object_keys(patch) k where k not in (${bulk});
  end if;
end $$;
`;
}

function run(files, { args = [], artifact } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "crm-patch-"));
  try {
    for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
    const art = artifact === undefined ? join(dir, "artifact.ts") : artifact;
    if (artifact === undefined) {
      const seed = spawnSync(process.execPath, [CLI, "--write"], {
        env: { ...process.env, CRM_PATCH_MIGRATIONS_DIR: dir, CRM_PATCH_ARTIFACT: art, CRM_PATCH_LIVE_DEFS: "" },
        encoding: "utf8",
      });
      if (seed.status !== 0) return { status: seed.status, out: seed.stdout + seed.stderr, artifact: art, dir, seedFailed: true };
    }
    const r = spawnSync(process.execPath, [CLI, ...args], {
      env: { ...process.env, CRM_PATCH_MIGRATIONS_DIR: dir, CRM_PATCH_ARTIFACT: art, CRM_PATCH_LIVE_DEFS: "" },
      encoding: "utf8",
    });
    // Read the artifact BEFORE the finally block removes the directory it lives in.
    let artifactText = "";
    try { artifactText = readFileSync(art, "utf8"); } catch { /* absent is a valid outcome */ }
    return { status: r.status, out: r.stdout + r.stderr, artifactText, dir };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export async function selfTest() {
  const cases = [];
  const check = (name, ok, detail = "") => {
    cases.push({ name, ok, detail });
    console.log(`${ok ? "✅" : "❌"} ${name}${ok || !detail ? "" : `\n     ${detail}`}`);
  };

  // POSITIVE — a faithful fixture derives cleanly and the guard is green against its own output.
  {
    const r = run({ "20270204000000_a.sql": fixtureSql() });
    check("green when the artifact matches the SQL", r.status === 0, r.out);
    const art = r.artifactText;
    check(
      "derives entity_name and zip_code, never company_name or zip",
      art.includes('name: "entity_name"') && art.includes('name: "zip_code"')
        && !art.includes('name: "company_name"') && !art.includes('name: "zip"'),
      art.slice(0, 400),
    );
    check(
      "keeps the seven lists separate — create gets notes, update gets current_notes",
      /contact\.create[\s\S]*?"notes"[\s\S]*?contact\.update/.test(art) && art.includes('"current_notes"'),
      art.slice(0, 600),
    );
  }

  // NEGATIVE — a field renamed in the SQL must turn the guard red.
  {
    const base = { "20270204000000_a.sql": fixtureSql() };
    const drifted = { "20270204000000_a.sql": fixtureSql({ contactCreate: "'first_name','company_name','zip_code','notes'" }) };
    const dir = mkdtempSync(join(tmpdir(), "crm-patch-"));
    try {
      writeFileSync(join(dir, "20270204000000_a.sql"), base["20270204000000_a.sql"]);
      const art = join(dir, "artifact.ts");
      spawnSync(process.execPath, [CLI, "--write"], {
        env: { ...process.env, CRM_PATCH_MIGRATIONS_DIR: dir, CRM_PATCH_ARTIFACT: art, CRM_PATCH_LIVE_DEFS: "" }, encoding: "utf8",
      });
      writeFileSync(join(dir, "20270204000000_a.sql"), drifted["20270204000000_a.sql"]);
      const r = spawnSync(process.execPath, [CLI], {
        env: { ...process.env, CRM_PATCH_MIGRATIONS_DIR: dir, CRM_PATCH_ARTIFACT: art, CRM_PATCH_LIVE_DEFS: "" }, encoding: "utf8",
      });
      const out = r.stdout + r.stderr;
      check("RED when a field is renamed in the database", r.status === 1 && out.includes("no longer matches"), out);
      check("names the exact delta", out.includes("+ company_name") && out.includes("- entity_name"), out);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }

  // NEGATIVE — an eighth allowlist must fail even though all seven existing lists still match.
  {
    const r = run({ "20270204000000_a.sql": fixtureSql({ extraSite: "'brand_new_field'" }) });
    check(
      "RED when a NEW allowlist appears (unmapped action)",
      r.status === 1 && /allowlist site/.test(r.out),
      r.out,
    );
  }

  // NEGATIVE — newest migration wins; an earlier-sorting file must not shadow a later one.
  {
    const r = run({
      "20270204000000_a.sql": fixtureSql(),
      "20270901000000_b.sql": fixtureSql({ contactCreate: "'first_name','entity_name','zip_code','notes','later_field'" }),
    });
    const art = r.artifactText;
    check("newest migration definition wins", r.status === 0 && art.includes('"later_field"'), r.out);
  }

  // NEGATIVE — the artifact must exist; a deleted one is not silently regenerated.
  {
    const r = run({ "20270204000000_a.sql": fixtureSql() }, { artifact: join(tmpdir(), "definitely-absent-artifact.ts") });
    check("RED when the generated artifact is missing", r.status === 1 && /missing/.test(r.out), r.out);
  }

  // NEGATIVE — an allowlist that escapes its branch must fail rather than bind the wrong set.
  {
    const r = run({ "20270204000000_a.sql": fixtureSql({ orphanBranch: true }) });
    check(
      "RED when an allowlist no longer sits inside its own branch",
      r.status === 1 && /past the next branch opener|allowlist site/.test(r.out),
      r.out,
    );
  }

  // The pgTAP twin is the half that asks POSTGRES instead of a regex, so it needs the same
  // negative controls as the TypeScript artifact — otherwise a guard exists for it in name only.
  {
    const dir = mkdtempSync(join(tmpdir(), "crm-patch-"));
    try {
      writeFileSync(join(dir, "20270204000000_a.sql"), fixtureSql());
      const art = join(dir, "artifact.ts");
      const sqlArt = join(dir, "artifact.pgtap.sql");
      const env = { ...process.env, CRM_PATCH_MIGRATIONS_DIR: dir, CRM_PATCH_ARTIFACT: art, CRM_PATCH_LIVE_DEFS: "" };
      spawnSync(process.execPath, [CLI, "--write"], { env, encoding: "utf8" });

      const sql = readFileSync(sqlArt, "utf8");
      check(
        "emits a pgTAP proof that reads the allowlist out of a real database",
        sql.includes("pg_get_functiondef") && sql.includes("SELECT plan(") && sql.includes("'entity_name'")
          && !sql.includes("'company_name'"),
        sql.slice(0, 400),
      );

      // Hand-edited pgTAP proof: the file that runs against the database must not be able to
      // disagree with the file the edge runtime ships.
      writeFileSync(sqlArt, sql.split("'entity_name'").join("'company_name'"));
      const edited = spawnSync(process.execPath, [CLI], { env, encoding: "utf8" });
      check(
        "RED when the pgTAP proof is hand-edited away from the database",
        edited.status === 1 && /pgTAP proof/.test(edited.stdout + edited.stderr),
        edited.stdout + edited.stderr,
      );

      // Deleted pgTAP proof: a missing check must fail, never pass by absence (§68).
      rmSync(sqlArt, { force: true });
      const gone = spawnSync(process.execPath, [CLI], { env, encoding: "utf8" });
      check(
        "RED when the pgTAP proof is missing entirely",
        gone.status === 1 && /pgTAP proof missing/.test(gone.stdout + gone.stderr),
        gone.stdout + gone.stderr,
      );
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }

  const failed = cases.filter((c) => !c.ok);
  console.log(`\n${failed.length ? "❌" : "✅"} crm-patch-field-gen self-test: ${cases.length - failed.length}/${cases.length} passed`);
  if (failed.length) process.exit(1);
}

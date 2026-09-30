import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * PR-A — P0 legacy contact delete tenant-isolation remediation.
 *
 * The legacy `delete-contact` edge authenticated the caller, checked a GLOBAL
 * `user_roles` admin/owner row, and then ran a cascading service-role delete
 * keyed only on the body `contact_id` — no tenant predicate anywhere. A
 * tenant-A user holding a global role row could hard-delete tenant-B contacts
 * with their deals, memory, documents and coach rows.
 *
 * The governed canonical delete already existed and is adversarially proven in
 * `supabase/tests/governed_crm_commands.sql` (143 pgTAP assertions, wired into
 * `paige-spine-contract.yml`): service-only executor, active-account match,
 * tenant-scoped owner/admin role, operator-card approval channel, autonomy
 * gate, preview binding with dependency snapshot, tenant-predicated delete,
 * absence readback, idempotent replay, Rail receipt.
 *
 * This contract enforces the retirement decision: Option A — the legacy edge
 * and its tombstoned Chat tool are REMOVED, not hardened in parallel, and the
 * deploy workflow deletes the retired function at the provider (source
 * deletion alone does not undeploy). The one canonical delete path is
 * `contact.hard_delete` behind `crm-command`.
 */

const root = (p: string) => resolve(process.cwd(), p);
const read = (p: string) => readFileSync(root(p), "utf8");

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".mjs"];

/** Recursively collect source files under a directory (skipping test files). */
function sourceFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root(dir))) {
    const full = `${dir}/${entry}`;
    const st = statSync(root(full));
    if (st.isDirectory()) {
      if (entry !== "__tests__" && !entry.includes("node_modules")) out.push(...sourceFilesUnder(full));
    } else if (SOURCE_EXTENSIONS.some((ext) => entry.endsWith(ext)) && !/\.(test|spec)\.[jt]sx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** Every source file under supabase/functions. */
const functionSources = () => sourceFilesUnder("supabase/functions");

/**
 * The retirement scanners. They match the BARE token, not a quoted form, so
 * single quotes, template literals, and concatenation cannot evade them.
 */
const mentionsRetiredEdge = (source: string) => source.includes("delete-contact");
const mentionsRetiredTool = (source: string) => source.includes("crm_delete_contact");
const mentionsRetiredConfig = (source: string) => source.includes("[functions.delete-contact]");

describe("the legacy delete-contact edge is retired (Option A)", () => {
  it("the edge directory no longer exists", () => {
    expect(existsSync(root("supabase/functions/delete-contact")), "edge directory must be deleted")
      .toBe(false);
  });

  it("no function under supabase/functions mentions the retired edge", () => {
    const offenders = functionSources()
      .filter((f) => mentionsRetiredEdge(f) || mentionsRetiredEdge(read(f)));
    expect(offenders, `retired-edge references: ${offenders.join(", ")}`).toEqual([]);
  });

  it("the gateway config no longer declares the edge", () => {
    expect(mentionsRetiredConfig(read("supabase/config.toml"))).toBe(false);
  });

  it("the tombstoned crm_delete_contact Chat tool is fully removed from the handler", () => {
    // The legacy tool was already stripped from the model manifest; its
    // definition/dispatch/narrative branches remained as tombstones. All of
    // them go, so the name may not appear in the handler at all.
    expect(mentionsRetiredTool(read("supabase/functions/paige-ai-chat/index.ts"))).toBe(false);
  });

  it("the inline-tool baseline records the descent", () => {
    expect(mentionsRetiredTool(read("scripts/ci/chat-tool-baseline.txt"))).toBe(false);
  });

  it("the only remaining src reference is the documented Cursor-lane remnant", () => {
    // src/lib/contacts.ts deleteContact() + its three unrouted pages/admin
    // consumers are PR4's registered orphan lane, handed to Cursor AFTER this
    // PR retires the endpoint. Pin the exact remnant set so nobody adds a new
    // live caller, and so Cursor's deletion updates this contract knowingly.
    const offenders = sourceFilesUnder("src").filter((f) => mentionsRetiredEdge(read(f)));
    expect(offenders.sort(), "expected exactly the Cursor-lane remnant").toEqual([
      "src/lib/contacts.ts",
    ]);
  });
});

describe("the retirement reaches the provider, not just the source tree", () => {
  const wf = read(".github/workflows/deploy-edge-functions.yml");

  it("the deploy workflow computes and deletes retired functions", () => {
    // `supabase functions deploy` only creates/updates. Without an explicit
    // provider-side delete, a retired function stays callable in production
    // forever no matter what the source tree says — for this P0 that would
    // mean the vulnerability outlived its own fix.
    expect(wf).toContain("Compute retired functions");
    expect(wf).toContain("Delete retired functions at the provider");
    expect(wf).toContain("supabase functions delete");
    // The recorded-live tag must also move on a retirement-only run.
    expect(wf).toContain("steps.retired.outputs.count != '0'");
  });

  it("the retired-set pipeline uses grouped-or syntax with a loud empty guard (adversarial review fix)", () => {
    // `{ A | grep || true; } | sort > f` — without the braces, `|` binds
    // tighter than `||`, the redirect lands in the never-taken branch, the
    // file is silently never created, and the delete step skips while the
    // workflow stays green. Both the grouping and the -s guards are pinned.
    expect(wf).toContain("{ git ls-tree -d --name-only");
    expect(wf).toContain("grep -v '^_' || true; } | sort > before_fns.txt");
    expect(wf).toContain("grep -v '^_' || true; } | sort > now_fns.txt");
    expect(wf).toContain("[ -s before_fns.txt ] ||");
  });

  it("a retirement is never stranded by a deploy failure (2026-09-19 production closeout regression)", () => {
    // The PR-A merge run (35408262875) proved the original order stranded the
    // retirement: an expired SUPABASE_ACCESS_TOKEN 401'd every deploy, the
    // failed deploy step SKIPPED the delete (no always() guard), and the
    // retired function stayed ACTIVE in production. The repaired invariants:
    // the delete runs BEFORE any deploy, is guarded only by always() plus its
    // own inputs, a credential preflight fails with one actionable error
    // before N deploy attempts, and an operator can dispatch the workflow
    // directly after a secret rotation instead of waiting for the next
    // functions-touching push.
    const deleteIdx = wf.indexOf("Delete retired functions at the provider");
    const deployIdx = wf.indexOf("Deploy affected functions");
    expect(deleteIdx).toBeGreaterThan(-1);
    expect(deployIdx).toBeGreaterThan(-1);
    expect(deleteIdx, "retirement delete must precede the deploy loop").toBeLessThan(deployIdx);
    expect(wf).toContain("if: always() && steps.retired.outputs.count != '0'");
    expect(wf).toContain("Preflight — the provider accepts the credential");
    expect(wf).toContain("The provider REJECTED SUPABASE_ACCESS_TOKEN");
    expect(wf).toContain("workflow_dispatch");
    // edge-live still advances only when everything succeeded — a failed
    // deploy must never be recorded as live.
    expect(wf).toContain("if: success() && (steps.affected.outputs.count != '0' || steps.retired.outputs.count != '0')");
  });

  it("manual dispatch resolves its baseline from edge-live, never HEAD^ (the vacuous-recovery fix)", () => {
    // A dispatch on a main whose prior merge already carried the retirement
    // must diff edge-live → HEAD. HEAD^ would resolve zero changed function
    // files, skip the retired-set step, and strand the retirement while the
    // run goes green — the coordinator's blocking finding on the first head.
    const baselineIdx = wf.indexOf("Resolve deployment baseline");
    const baselineBlock = wf.slice(baselineIdx, wf.indexOf("- name:", baselineIdx + 10));
    expect(baselineBlock).toContain('workflow_dispatch');
    expect(baselineBlock).toContain("refs/tags/edge-live");
    expect(baselineBlock).toContain("a manual recovery cannot know what production last received");
    // The dispatch branch must not consult github.event.before (absent on
    // dispatch) and must not fall back to HEAD^ inside its own branch.
    const dispatchBranch = baselineBlock.slice(
      baselineBlock.indexOf('if [ "${{ github.event_name }}" = "workflow_dispatch" ]'),
      baselineBlock.indexOf("else", baselineBlock.indexOf('if [ "${{ github.event_name }}" = "workflow_dispatch" ]')),
    );
    expect(dispatchBranch).not.toContain("github.event.before");
    expect(dispatchBranch).not.toContain('"${after}^"');
  });
});

describe("the canonical governed delete remains the one tenant-safe path", () => {
  const catalog = read("supabase/functions/_shared/crm-command/catalog.ts");
  const actionRisk = read("supabase/functions/_shared/action-risk.ts");
  const migration = read("supabase/migrations/20270204000000_governed_crm_contact_company_commands.sql");
  const pgTap = read("supabase/tests/governed_crm_commands.sql");

  it("the governed tool is declared and mapped to contact.hard_delete", () => {
    expect(catalog).toContain('"contact.hard_delete": "crm_hard_delete_contact"');
    // Named by the client_ref Paige's reads return; crm-command resolves it inside the workspace.
    expect(catalog).toContain('"contact.hard_delete": ["client_ref","expected_updated_at"]');
  });

  it("the governed tool stays classified high; the retired name carries NO stale classification (fail-closed on reintroduction)", () => {
    expect(actionRisk).toContain('["crm_hard_delete_contact", "high"');
    // action-risk-lint forbids policy lines for tools the handler no longer
    // declares. Removing the classification is also the stronger protection:
    // an unclassified action cannot run on purpose, so any reintroduction of
    // the name is refused by default until it is deliberately re-classified.
    // (The file's comments may name the retired tool to explain its absence;
    // the classification tuple itself may not return.)
    expect(actionRisk).not.toContain('["crm_delete_contact"');
  });

  it("the executor keeps the tenant predicate, unsafe-refusal and absence readback on the delete", () => {
    expect(migration).toContain("CRM_HARD_DELETE_UNSAFE");
    expect(migration).toContain("CRM_ABSENCE_READBACK_FAILED");
    expect(migration).toContain("CRM_PREVIEW_REQUIRED");
    expect(migration).toContain("CRM_ACTIVE_ACCOUNT_CHANGED");
    expect(migration).toContain("CRM_INTERNAL_EXECUTOR_REQUIRED");
  });

  it("the pgTAP proof still pins the cross-tenant and authority refusals", () => {
    expect(pgTap).toContain("known cross-tenant target is refused without disclosure");
    expect(pgTap).toContain("ordinary member cannot mutate CRM");
    expect(pgTap).toContain("hard delete writes the exact Rail capability receipt");
  });
});

describe("manual-dispatch recovery computes the stranded retirement (executable simulation)", () => {
  // Simulates EXACTLY the 2026-09-19 condition on a scratch git repository:
  // edge-live predates the #1273 retirement; HEAD contains it; delete-contact
  // exists at the deployed baseline and not at HEAD. The workflow's REAL step
  // scripts are extracted from the YAML and executed in order with the same
  // `${{ ... }}` substitutions GitHub performs — this is not a YAML-text
  // assertion, it is the computation itself. Proves retired.txt resolves to
  // exactly delete-contact, which the HEAD^ fallback (the rejected first
  // head) could never produce because it resolves zero changed files.
  const WORKFLOW = read(".github/workflows/deploy-edge-functions.yml");

  /** Extract a named step's `run: |` block, de-indented, with GitHub
   *  expression substitutions applied — the same injection GH performs. */
  const stepScript = (stepName: string, substitutions: Record<string, string>): string => {
    const nameIdx = WORKFLOW.indexOf(`- name: ${stepName}`);
    expect(nameIdx, `step ${stepName} exists`).toBeGreaterThan(-1);
    const nextIdx = WORKFLOW.indexOf("      - name:", nameIdx + 10);
    const block = WORKFLOW.slice(nameIdx, nextIdx === -1 ? undefined : nextIdx);
    const runIdx = block.indexOf("run: |");
    const lines = block.slice(runIdx + "run: |".length).split("\n");
    const body: string[] = [];
    for (const line of lines) {
      if (body.length === 0 && line.trim() === "") continue;
      if (!/^\s{10,}/.test(line) && line.trim() !== "") break;
      body.push(line.replace(/^ {10}/, ""));
    }
    let script = body.join("\n");
    for (const [expr, value] of Object.entries(substitutions)) {
      script = script.split(`\${{ ${expr} }}`).join(value);
    }
    expect(script.includes("${{"), "all expressions must be substituted").toBe(false);
    return script;
  };

  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" } }).trim();

  /** A scratch repo with a commit identity (the global config is blanked). */
  const initRepo = (repo: string) => {
    git(repo, "init", "-q");
    git(repo, "config", "user.email", "sim@example.invalid");
    git(repo, "config", "user.name", "dispatch-simulation");
  };

  const run = (cwd: string, script: string, env: Record<string, string>) => {
    const out = execFileSync("bash", ["-c", script], {
      cwd, encoding: "utf8",
      env: { ...process.env, ...env },
    });
    return out.trim();
  };

  const parseOutputs = (raw: string): Record<string, string> =>
    Object.fromEntries(raw.split("\n").filter((l) => l.includes("=")).map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1)];
    }));

  it("edge-live → HEAD under dispatch targets exactly delete-contact", () => {
    // ── fixture: the 2026-09-19 shape ──────────────────────────────────────
    const repo = mkdtempSync(resolve(tmpdir(), "pr-a-dispatch-"));
    writeFn(repo, "delete-contact");
    writeFn(repo, "crm-command");
    writeFn(repo, "paige-ai-chat");
    writeFn(repo, "_shared", "mod.ts");
    initRepo(repo);
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "deployed baseline (mirrors edge-live: delete-contact still present)", "--", ".");
    const baseline = git(repo, "rev-parse", "HEAD");
    git(repo, "tag", "edge-live", baseline);
    // HEAD mirrors main after #1273: the edge directory is gone, the handler
    // and shared policy changed.
    execFileSync("rm", ["-rf", resolve(repo, "supabase/functions/delete-contact")], { encoding: "utf8" });
    writeFn(repo, "paige-ai-chat", "index.ts", "// fn v2 — retirement fallout\n");
    writeFn(repo, "_shared", "action-risk.ts", "// policy v2\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "retirement merge (mirrors #1273)", "--", ".");
    const head = git(repo, "rev-parse", "HEAD");
    const ghOut = `${repo}/gh-outputs`;
    const env = { GITHUB_OUTPUT: ghOut, GITHUB_PATH: `${repo}/gh-path` };

    // ── 1. Resolve deployment baseline (dispatch branch) ───────────────────
    const baselineOut = run(repo, stepScript("Resolve deployment baseline", {
      "github.sha": head,
      "github.event_name": "workflow_dispatch",
      "github.event.before": "",
    }), env);
    const baselineStep = parseOutputs(readFileSync(ghOut, "utf8"));
    expect(baselineStep.before).toBe(baseline);
    expect(baselineStep.after).toBe(head);
    expect(baselineOut).toContain("manual dispatch: reconciling edge-live");

    // ── 2. Compute changed function files (baseline → HEAD) ────────────────
    writeFileSync(ghOut, "");
    run(repo, stepScript("Compute changed function files", {
      "steps.baseline.outputs.before": baselineStep.before,
      "steps.baseline.outputs.after": baselineStep.after,
    }), env);
    const changedStep = parseOutputs(readFileSync(ghOut, "utf8"));
    expect(Number(changedStep.count)).toBeGreaterThan(0);
    expect(readFileSync(`${repo}/changed.txt`, "utf8")).toContain("delete-contact/index.ts");

    // ── 3. Compute retired functions — the proof the coordinator required ──
    writeFileSync(ghOut, "");
    const retiredOut = run(repo, stepScript("Compute retired functions", {
      "steps.changed.outputs.before": changedStep.before,
      "steps.changed.outputs.after": changedStep.after,
    }), env);
    const retiredStep = parseOutputs(readFileSync(ghOut, "utf8"));
    expect(retiredOut.trim()).toBe("delete-contact");
    expect(readFileSync(`${repo}/retired.txt`, "utf8").trim()).toBe("delete-contact");
    expect(Number(retiredStep.count)).toBe(1);
  });

  it("the rejected HEAD^ shape is still rejected here: parent-diff computes NO retirement", () => {
    // The counterfactual, proving the simulation can fail and that the
    // coordinator's scenario is real: on a main whose previous commit IS the
    // #1273 retirement merge and whose HEAD is a workflow-only change (exactly
    // #1274's shape), the OLD parent fallback (before=HEAD^ = the merge)
    // resolves zero changed FUNCTION files, so the retired-set step would be
    // skipped and delete-contact never targeted — the vacuous recovery.
    const repo = mkdtempSync(resolve(tmpdir(), "pr-a-parent-"));
    writeFn(repo, "delete-contact");
    writeFn(repo, "paige-ai-chat");
    initRepo(repo);
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "deployed baseline", "--", ".");
    execFileSync("rm", ["-rf", `${repo}/supabase/functions/delete-contact`], { encoding: "utf8" });
    writeFn(repo, "paige-ai-chat", "index.ts", "// fn v2\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "retirement merge (mirrors #1273 — this is HEAD^)", "--", ".");
    const parent = git(repo, "rev-parse", "HEAD");
    writeFileSync(resolve(repo, ".github-workflow-change.txt"), "#1274 changes only the workflow and its test\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "workflow-only change (mirrors #1274 — this is HEAD)", "--", ".");
    const head = git(repo, "rev-parse", "HEAD");
    expect(head).not.toBe(parent);
    const changed = run(repo, `git diff --name-only ${parent} ${head} -- 'supabase/functions/**' | tee changed.txt; echo "count=$(grep -c . changed.txt || true)"`, {});
    expect(changed.trim()).toBe("count=0");
  });
});

/** Write a function-shaped fixture file (mkdir -p + file). */
function writeFn(repo: string, name: string, file = "index.ts", content = "// fn\n") {
  const dir = resolve(repo, "supabase/functions", name);
  execFileSync("mkdir", ["-p", dir], { encoding: "utf8" });
  writeFileSync(resolve(dir, file), content);
}

describe("retirement scanners are sabotage-sensitive", () => {
  // These run the SAME scanner functions the assertions above use, so a
  // weakening of the scanners (quoted-only matching, wrong token) fails here.
  it("the edge scanner catches every quoting style a reintroduction could use", () => {
    for (const shape of [
      'await supabaseClient.functions.invoke("delete-contact", {',
      "await supabaseClient.functions.invoke('delete-contact', {",
      "await fetch(`${url}/functions/v1/delete-contact`)",
    ]) {
      expect(mentionsRetiredEdge(shape), `scanner missed: ${shape}`).toBe(true);
    }
    // Honest limit: a bare-token source scanner cannot catch runtime string
    // construction ("delete" + "-contact") — no static scan can.
    expect(mentionsRetiredEdge('await supabaseClient.functions.invoke("crm-command", {')).toBe(false);
  });

  it("the tool scanner catches a reintroduced tombstone in any quote style", () => {
    for (const shape of [
      '} else if (tc.function.name === "crm_delete_contact") {',
      "} else if (tc.function.name === 'crm_delete_contact') {",
      "const LEGACY = `crm_delete_contact`;",
    ]) {
      expect(mentionsRetiredTool(shape), `scanner missed: ${shape}`).toBe(true);
    }
    expect(mentionsRetiredTool('} else if (tc.function.name === "crm_hard_delete_contact") {')).toBe(false);
  });

  it("the config scanner catches a redeclared block", () => {
    expect(mentionsRetiredConfig("[functions.delete-contact]\n  verify_jwt = true")).toBe(true);
    expect(mentionsRetiredConfig("[functions.execute-approval]\n  verify_jwt = true")).toBe(false);
  });
});

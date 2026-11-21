import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ORIGINAL34, permitsOriginal34, validateCatalog, validateDryRun, validateVersions } from "./exp07-original34-release.mjs";

const reference = JSON.parse(readFileSync(new URL("./exp07-original34-catalog.json", import.meta.url), "utf8"));
const basename = ORIGINAL34.file.split("/").at(-1);
const expectedInvocation = {
  file: ORIGINAL34.file, baseNewest: ORIGINAL34.frontier, addedFiles: [ORIGINAL34.file], sha256: ORIGINAL34.sha256,
};

test("the exception requires only the original 34 bytes after exact frontier 38", () => {
  assert(permitsOriginal34(expectedInvocation));
  assert(!permitsOriginal34({ ...expectedInvocation, baseNewest: "20271133000039" }));
  assert(!permitsOriginal34({ ...expectedInvocation, sha256: "0".repeat(64) }));
  assert(!permitsOriginal34({ ...expectedInvocation, addedFiles: [ORIGINAL34.file, "another.sql"] }));
});

test("the tracked version set differs from production by only original 34", () => {
  const local = execFileSync("git", ["ls-files", "supabase/migrations/"], { encoding: "utf8" })
    .split(/\r?\n/).flatMap((file) => /\/(\d{14})_[^/]+\.sql$/.exec(file)?.[1] ?? []);
  const remote = local.filter((version) => version !== ORIGINAL34.version);
  validateVersions(local, remote, "before");
  validateVersions(local, local, "after");
  assert.throws(() => validateVersions(local, local, "before"));
  assert.throws(() => validateVersions(local, remote.slice(1), "before"));
  assert.throws(() => validateVersions(local, [...remote, remote[0]], "before"));
  assert.throws(() => validateVersions(local, [...remote, "20271133000032"], "before"));
});

test("dry-run must contain one official list with one exact migration and no extra effects", () => {
  const valid = `Would push these migrations:\n • ${basename}\n`;
  validateDryRun(valid);
  assert.throws(() => validateDryRun(`Found local file ${basename}\n`));
  assert.throws(() => validateDryRun(valid + " • 20271133000037_other.sql\n"));
  assert.throws(() => validateDryRun(valid + "Would seed data\n"));
  assert.throws(() => validateDryRun(valid + valid));
});

test("before and after require the exact allowed catalogue delta and preserve unrelated metadata", () => {
  const after = {
    ...reference.before,
    prerequisites: [reference.before.prerequisites[0], reference.after.ledgerRow, reference.before.prerequisites[1]],
    functions: reference.before.functions.map((fn, index) => ({ ...fn, body_md5: reference.after.functionBodies[index].body_md5 })),
    constraints: reference.after.constraints,
    nexus_seed: reference.after.nexusSeed,
  };
  validateCatalog(reference.before, "before");
  validateCatalog(after, "after");
  assert.throws(() => validateCatalog(after, "before"));
  for (const mutate of [
    (result) => { result.functions[0].acl = "{authenticated=X/postgres}"; },
    (result) => { result.constraints[0].validated = false; },
    (result) => { result.nexus_seed.tools[0].push("unexpected_tool"); },
    (result) => { result.private_history.body_md5 = "unexpected"; },
    (result) => { result.ledger_without34 = "unexpected"; },
    (result) => { result.prerequisites[1].statements_md5 = "unexpected"; },
  ]) {
    const altered = structuredClone(after);
    mutate(altered);
    assert.throws(() => validateCatalog(altered, "after"));
  }
});

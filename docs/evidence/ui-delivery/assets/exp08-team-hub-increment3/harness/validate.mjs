import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../..");
const { classifyUiChanges, validateEvidenceText, verifyPinnedBundle } = await import(resolve(REPO, "scripts/ci/ui-delivery-evidence.mjs"));
process.chdir(REPO);
// The branch's change set: committed since the merge base with origin/main, plus the working tree
// (modified files as M, untracked files as A), so the uncommitted record is classified as added.
const git = (...args) => execFileSync("git", args, { encoding: "utf8" });
const base = process.argv[2] ?? git("merge-base", "HEAD", "origin/main").trim();
const byPath = new Map();
for (const line of git("diff", "--name-status", base, "HEAD").split("\n").filter(Boolean)) {
  const [status, ...rest] = line.split("\t");
  byPath.set(rest[rest.length - 1], status[0]);
}
for (const line of git("status", "--porcelain", "--untracked-files=all").split("\n").filter(Boolean)) {
  const path = line.slice(3);
  byPath.set(path, line.startsWith("??") ? "A" : (byPath.get(path) ?? line.trim()[0]));
}
const files = [...byPath].map(([path, status]) => ({ status, path }));
const classification = classifyUiChanges(files);
console.log("base:", base, "bundle:", verifyPinnedBundle().ok, "required:", classification.required, "solo:", classification.solo, "ui files:", classification.uiFiles.length, "evidence:", classification.evidenceFiles);
const result = validateEvidenceText(readFileSync("docs/evidence/ui-delivery/exp08-team-hub-increment3.md", "utf8"), classification);
console.log(JSON.stringify(result, null, 1));
process.exit(result.ok ? 0 : 1);

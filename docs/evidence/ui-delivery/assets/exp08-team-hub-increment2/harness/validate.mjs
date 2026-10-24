import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../..");
const { classifyUiChanges, validateEvidenceText, verifyPinnedBundle } = await import(resolve(REPO, "scripts/ci/ui-delivery-evidence.mjs"));
process.chdir(REPO);
// Working-tree change set (uncommitted): modified files as M, untracked files as A.
const lines = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { encoding: "utf8" }).split("\n").filter(Boolean);
const files = lines.map((line) => ({ status: line.startsWith("??") ? "A" : line.trim()[0], path: line.slice(3) }));
const classification = classifyUiChanges(files);
console.log("bundle:", verifyPinnedBundle().ok, "required:", classification.required, "solo:", classification.solo, "ui files:", classification.uiFiles.length, "evidence:", classification.evidenceFiles);
const result = validateEvidenceText(readFileSync("docs/evidence/ui-delivery/exp08-team-hub-increment2.md", "utf8"), classification);
console.log(JSON.stringify(result, null, 1));

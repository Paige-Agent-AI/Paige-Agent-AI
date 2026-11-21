import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Exact original Preview-applied file. This module validates evidence only.
// Production invocation authority must come from the separate original-34 decision.
export const ORIGINAL34 = Object.freeze({
  version: "20271133000034",
  frontier: "20271133000038",
  file: "supabase/migrations/20271133000034_exp07_media_snapshot_receipt_compatibility.sql",
  sha256: "13eb118e17529f745d853eefdd9db9fdfb5cd125925c99071251ef50b90c0d8b",
  liveVersionCount: 1606,
  liveVersionDigest: "b33e783b0ddc968232d0a4a4d532f6e4",
});

const catalogue = JSON.parse(readFileSync(new URL("./exp07-original34-catalog.json", import.meta.url), "utf8"));
const basename = ORIGINAL34.file.split("/").at(-1);
const phaseMustBeKnown = (phase) => assert(["before", "after"].includes(phase), "Unknown release phase");

export function permitsOriginal34({ file, baseNewest, addedFiles, sha256 }) {
  return file === ORIGINAL34.file && baseNewest === ORIGINAL34.frontier
    && addedFiles.length === 1 && addedFiles[0] === file && sha256 === ORIGINAL34.sha256;
}

export function validateVersions(local, remote, phase) {
  phaseMustBeKnown(phase);
  for (const versions of [local, remote]) {
    assert(versions.length > 0 && versions.every((version) => /^\d{14}$/.test(version)), "Incomplete migration versions");
    assert.equal(new Set(versions).size, versions.length, "Duplicate migration version");
    assert.equal([...versions].sort().at(-1), ORIGINAL34.frontier, "Unexpected frontier");
    const previouslyLive = versions.filter((version) => version !== ORIGINAL34.version).sort();
    assert.equal(previouslyLive.length, ORIGINAL34.liveVersionCount, "Incomplete prior migration ledger");
    assert.equal(createHash("md5").update(previouslyLive.join(",")).digest("hex"), ORIGINAL34.liveVersionDigest,
      "Previously live migration identity changed");
  }
  assert(local.includes(ORIGINAL34.version), "Original 34 file missing from candidate");
  assert.deepEqual(local.filter((version) => !remote.includes(version)),
    phase === "before" ? [ORIGINAL34.version] : [], "Only original 34 may be pending");
  assert.deepEqual(remote.filter((version) => !local.includes(version)), [], "Unexpected remote migration");
}

export function validateDryRun(output) {
  const clean = output.replace(/\u001b\[[0-9;]*m/g, "").replace(/\r\n/g, "\n");
  const header = "Would push these migrations:\n";
  const halves = clean.split(header);
  assert.equal(halves.length, 2, "Expected one official proposed-migration section");
  const listing = halves[1].match(/^(?: • [^\n]+\n)+/)?.[0];
  assert.equal(listing, ` • ${basename}\n`, "Dry run must propose only original 34");
  assert.deepEqual([...new Set(clean.match(/\b\d{14}_[a-z0-9_]+\.sql\b/g) ?? [])],
    [basename], "Unexpected migration mentioned by dry run");
  assert(!/Would (?:seed|create custom roles)|unable|failed|no migrations will be applied/i.test(clean),
    "Unconfirmed or additional effects in dry run");
}

export function validateCatalog(value, phase) {
  phaseMustBeKnown(phase);
  if (phase === "before") {
    assert.deepEqual(value, catalogue.before, "Production preimage differs from the recorded original-34 baseline");
    return;
  }
  const functions = catalogue.before.functions.map((preimage) => {
    const successor = catalogue.after.functionBodies.find((item) => item.signature === preimage.signature);
    assert(successor, `Missing exact postimage for ${preimage.signature}`);
    return { ...preimage, body_md5: successor.body_md5 };
  });
  const prerequisites = [...catalogue.before.prerequisites, catalogue.after.ledgerRow]
    .sort((a, b) => a.version.localeCompare(b.version));
  assert.deepEqual(value, {
    ...catalogue.before,
    prerequisites,
    functions,
    constraints: catalogue.after.constraints,
    nexus_seed: catalogue.after.nexusSeed,
  }, "Production postimage or preserved metadata differs from the reviewed contract");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [kind, phase, evidenceFile] = process.argv.slice(2);
  const sha256 = createHash("sha256").update(readFileSync(ORIGINAL34.file)).digest("hex");
  assert.equal(sha256, ORIGINAL34.sha256, "Original 34 bytes differ");
  if (kind === "versions") {
    const remote = execFileSync(process.execPath,
      ["scripts/ci/reproduce-production-grants.mjs", "--parse-ledger", evidenceFile], { encoding: "utf8" })
      .trim().split(/\r?\n/);
    const local = execFileSync("git", ["ls-files", "supabase/migrations/"], { encoding: "utf8" })
      .trim().split(/\r?\n/).map((file) => /\/(\d{14})_[^/]+\.sql$/.exec(file)?.[1]).filter(Boolean);
    validateVersions(local, remote, phase);
  } else if (kind === "catalog") {
    validateCatalog(JSON.parse(readFileSync(evidenceFile, "utf8")), phase);
  } else if (kind === "dry-run" && phase === "before") {
    validateDryRun(readFileSync(evidenceFile, "utf8"));
  } else {
    throw new Error("Unknown original-34 validation mode");
  }
  console.log(`PASS original 34 ${kind} ${phase}`);
}

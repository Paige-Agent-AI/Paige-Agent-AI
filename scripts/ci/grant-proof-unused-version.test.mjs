import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { unusedOlderVersion } from "./grant-proof-unused-version.mjs";

test("adjacent occupied local versions are skipped", () => {
  assert.equal(unusedOlderVersion("20270535000001", ["20270535000000_n8n.sql", "20270534999999_other.sql"], "20270535000001\n"), "20270534999998");
});
test("production-only recorded version is never reused", () => {
  assert.equal(unusedOlderVersion("20270535000001", [], "20270535000000\r\n"), "20270534999999");
});
test("greatest free numeric gap wins without date arithmetic", () => {
  assert.equal(unusedOlderVersion("20270535000001", ["20270534999999_older.sql"], "20270535000001\n"), "20270535000000");
});
test("exhaustion fails instead of choosing zero or a newer version", () => {
  assert.throws(() => unusedOlderVersion("00000000000001", ["00000000000000_taken.sql"], ""), /No unused/);
  assert.throws(() => unusedOlderVersion("00000000000000", [], ""), /No unused/);
});
test("invalid rebuild or ledger fails closed", () => {
  assert.throws(() => unusedOlderVersion("bad", [], ""), /14 numeric/);
  assert.throws(() => unusedOlderVersion("20270535000001", [], "not-a-version"), /Malformed/);
});
test("CLI reads both actual migration filenames and ledger entries", () => {
  const dir = mkdtempSync(join(tmpdir(), "grant-probe-"));
  try {
    mkdirSync(join(dir, "migrations"));
    writeFileSync(join(dir, "migrations", "20270535000000_n8n.sql"), "");
    writeFileSync(join(dir, "recorded.txt"), "20270534999999\n20270535000001\n");
    const result = execFileSync(process.execPath, [fileURLToPath(new URL("grant-proof-unused-version.mjs", import.meta.url)), "20270535000001", join(dir, "migrations"), join(dir, "recorded.txt")], { encoding: "utf8" });
    assert.equal(result, "20270534999998");
    assert(BigInt(result) < 20270535000001n);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

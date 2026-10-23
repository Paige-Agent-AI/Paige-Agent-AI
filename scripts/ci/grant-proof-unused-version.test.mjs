import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { unusedOlderVersion, assertProbeSetAside } from "./grant-proof-unused-version.mjs";

const probe = "20271113510004_ci_grant_ordering_probe_out_of_order.sql";
test("the exact sole out-of-order probe is recognized", () => {
  assert.doesNotThrow(() => assertProbeSetAside(probe + "\n", probe));
});
test("other unrecorded older migrations do not hide the actual probe", () => {
  assert.doesNotThrow(() => assertProbeSetAside("20271113000000_other.sql\n" + probe + "\n20271113400000_another.sql\n", probe));
});
test("an older-migration count cannot substitute for the probe's own identity", () => {
  assert.throws(() => assertProbeSetAside("20271113000000_other.sql\n1 of them older than the frontier, set aside\n", probe), /exact out-of-order probe/);
});
test("a filename mentioned in prose or another path is not the probe entry", () => {
  assert.throws(() => assertProbeSetAside("supabase/migrations/" + probe + "\n", probe), /exact out-of-order probe/);
  assert.throws(() => assertProbeSetAside("moving " + probe + "\n", probe), /exact out-of-order probe/);
});
test("a duplicated probe observation is refused", () => {
  assert.throws(() => assertProbeSetAside(probe + "\n" + probe + "\n", probe), /occur once/);
});
test("Windows line endings and blank lines preserve exact identity", () => {
  assert.doesNotThrow(() => assertProbeSetAside("\r\n" + probe + "\r\n", probe));
});
test("a newer probe or malformed filename cannot satisfy the older-probe proof", () => {
  assert.throws(() => assertProbeSetAside("29991231235959_ci_grant_ordering_probe.sql\n", "29991231235959_ci_grant_ordering_probe.sql"), /exact out-of-order probe filename/);
  assert.throws(() => assertProbeSetAside("", "../outside.sql"), /exact out-of-order probe filename/);
});

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

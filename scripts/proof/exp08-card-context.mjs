// Original owning A2b suite in a dedicated loopback PostgreSQL cluster only.
// Windows transport follows exp05-zion-planning-read.mjs: exact includes and
// sed ranges, with /dev/null mapped to NUL. No database behavior is replaced.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const port = Number(process.argv[2]);
assert(Number.isInteger(port) && port >= 1024 && port <= 65535 && port !== 5432, "Dedicated local fixture port required");
assert(!process.env.PGHOST || process.env.PGHOST === "127.0.0.1", "Loopback proof only");
const baseline = process.argv[3] === "--baseline";
assert(process.argv.length === 3 || process.argv.length === 4 && baseline, "Unknown proof option");
const output = join(repo, "work", "exp08-card-context-proof", String(Date.now()));
mkdirSync(output, { recursive: true });
const inputs = new Map();

function materialize(path) {
  path = resolve(path);
  if (inputs.has(path)) return inputs.get(path).copy;
  const source = readFileSync(path, "utf8").replace(/\r\n/g, "\n");
  const copy = join(output, `${inputs.size}.sql`);
  inputs.set(path, { copy, sha256: createHash("sha256").update(source).digest("hex") });
  let sql = source.replace(/^\\set (\w+) `sed -n '\/\^(.+)\/,\/\^(.+)\/p' (.+)`$/gm, (_, name, start, end, target) => {
    const original = readFileSync(resolve(repo, target), "utf8").replace(/\r\n/g, "\n");
    const range = original.match(new RegExp("^" + start + "[\\s\\S]*?^" + end, "m"));
    assert(range, "Original sed range must exist");
    materialize(resolve(repo, target));
    return `SELECT $exp08_transport$${range[0]}$exp08_transport$ AS ${name} \\gset`;
  });
  sql = sql.replace(/^[ \t]*\\ir[ \t]+(.+)$/gm, (_, target) => {
    target = target.trim().replace(/^'(.*)'$/, "$1");
    return `\\ir '${materialize(isAbsolute(target) ? target : resolve(dirname(path), target)).replaceAll("\\", "/")}'`;
  });
  if (process.platform === "win32") sql = sql.replaceAll("\\o /dev/null", "\\o NUL");
  writeFileSync(copy, sql);
  return copy;
}

const fixture = materialize(join(repo, "supabase/tests/exp08_team_hub_a2b_cards.sql"));
const psql = process.env.OPERATOR_PROOF_PSQL ??
  (process.platform === "win32" ? "C:/Program Files/PostgreSQL/16/bin/psql.exe" : "psql");
const result = spawnSync(psql, ["-X", "-h", "127.0.0.1", "-p", String(port), "-U", "postgres", "-d", "postgres",
  "-v", "ON_ERROR_STOP=1", ...(baseline ? ["-v", "exp08_card_context_baseline=1"] : []), "-f", fixture],
{ cwd: repo, encoding: "utf8", windowsHide: true, timeout: 120000, maxBuffer: 12 * 1024 * 1024 });
writeFileSync(join(output, "stdout.txt"), result.stdout ?? "");
writeFileSync(join(output, "stderr.txt"), result.stderr ?? "");
writeFileSync(join(output, "inputs.json"), JSON.stringify(
  [...inputs].map(([path, value]) => ({ path, sha256: value.sha256 })), null, 2));
if (result.error) throw result.error;
const contractLine = result.stdout?.split(/\r?\n/).find(line => line.startsWith("EXP08_CARD_CONTEXT_CONTRACT:"));
const contract = contractLine ? JSON.parse(contractLine.slice("EXP08_CARD_CONTEXT_CONTRACT:".length)) : null;
if (result.status === 0) assert(contract?.body_md5 === "942febe890d60e20b3470f2175a2dafd", "Actual native reader must match the candidate");
console.log(JSON.stringify({ baseline, exitCode: result.status,
  passGroups: (result.stdout?.match(/^PASS:/gm) ?? []).length, output, inputCount: inputs.size, contract }));
if (result.status !== 0) console.error((result.stderr ?? "").slice(-2200));
process.exit(result.status ?? 1);

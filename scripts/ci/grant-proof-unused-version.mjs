// CI fixture allocation only; never allocates a product migration version.
import { readFileSync, readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function unusedOlderVersion(version, migrationFiles, recordedText) {
  if (!/^\d{14}$/.test(version)) throw new Error("Rebuild version must be 14 numeric digits");
  const occupied = new Set(migrationFiles.flatMap(file => {
    const match = /^(\d{14})_.*\.sql$/.exec(file);
    return match ? [match[1]] : [];
  }));
  for (const entry of recordedText.split(/\r?\n/).map(line => line.trim()).filter(Boolean)) {
    if (!/^\d{14}$/.test(entry)) throw new Error("Malformed recorded migration version");
    occupied.add(entry);
  }
  for (let candidate = BigInt(version) - 1n; candidate >= 0n; candidate--) {
    const value = candidate.toString().padStart(14, "0");
    if (!occupied.has(value)) return value;
  }
  throw new Error("No unused numeric migration version exists below rebuild version");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [version, migrations, recorded] = process.argv.slice(2);
  if (!version || !migrations || !recorded) throw new Error("Usage: grant-proof-unused-version.mjs <version> <migration-dir> <recorded-file>");
  process.stdout.write(unusedOlderVersion(version, readdirSync(migrations), readFileSync(recorded, "utf8")));
}

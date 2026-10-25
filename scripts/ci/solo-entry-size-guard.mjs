// EXP01 outcome-1 regression guard: the chat-first Solo entry stays a chat-first
// download. Before the route-level split, SoloEntry compiled EVERY screen into the
// first load — 2,609.64 kB raw / 739.26 kB gzip. The split brought it to ~392 kB
// raw with the heavy screens (settings, growth, sales, team, finance, operations,
// marketplace, ads, clients, calendar, studio, the workspace panels and research)
// behind React.lazy. This guard fails the build if any of that weight creeps back
// into the entry, or if a split chunk stops being produced at all (a silent
// re-merge is the failure mode vite only warns about).
//
// Deliberately measured on the RAW bytes of dist/assets (the same artifacts
// `npm run build` produces in CI); gzip varies by runtime tooling, raw does not.
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const dist = "dist/assets";
// Headroom over the measured 392 kB post-split entry for organic shell growth —
// but far below the ~700 kB a single heavyweight screen re-merging would cost.
const ENTRY_LIMIT_KB = 520;
// Chunks that must exist as SEPARATE files: named tripwires for the lazy screens
// (the entry-size limit is the broad guard; these name specific re-merge risks).
// NOTE: chunk names are flat filenames in dist/assets — "settings" was excluded
// because its chunk family (settings-, settings-2-, …) makes prefix matching
// ambiguous; the entry limit covers it.
const REQUIRED_LAZY_CHUNK_PREFIXES = [
  "SoloWorkspacePanels-",
  "paige-research-",
  "growth2-",
  "TeamHubWorkspace-",
  "SalesWorkspace-",
  "FinanceWorkspace-",
  "OperationsRoute-",
  "marketplace-",
  "AdsWorkspace-",
  "ClientsConversations-",
];

let failures = [];
const files = readdirSync(dist);
const findChunk = (prefix) => files.find((f) => f.startsWith(prefix) && f.endsWith(".js"));

const entry = findChunk("SoloEntry-");
if (!entry) {
  failures.push("No SoloEntry-*.js chunk found in dist/assets — did the build complete?");
} else {
  const kb = statSync(join(dist, entry)).size / 1024;
  if (kb > ENTRY_LIMIT_KB) {
    failures.push(
      `SoloEntry chunk is ${kb.toFixed(0)} kB (limit ${ENTRY_LIMIT_KB} kB) — a lazy screen's dependency tree has likely re-merged into the entry. Check the build log for "dynamically imported ... but also statically imported" warnings.`,
    );
  } else {
    console.log(`solo-entry-size-guard: SoloEntry ${kb.toFixed(0)} kB ≤ ${ENTRY_LIMIT_KB} kB`);
  }
}

for (const prefix of REQUIRED_LAZY_CHUNK_PREFIXES) {
  const found = findChunk(prefix);
  if (found) {
    console.log(`solo-entry-size-guard: lazy chunk present — ${found} (${(statSync(join(dist, found)).size / 1024).toFixed(0)} kB)`);
  } else {
    failures.push(`Expected a split chunk for "${prefix}*" — not found. Its module tree may have re-merged into the entry.`);
  }
}

if (failures.length) {
  console.error("solo-entry-size-guard: FAIL");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("solo-entry-size-guard: PASS");

#!/usr/bin/env node
// ANT-43/S7 security guard: the full-access SendGrid ADMIN credential may be
// referenced by NO tenant-execution code. Today the allowlist is EMPTY — the
// key sits in shared project secrets and must remain unread; when operator
// admin tooling is built, its function file is added here explicitly and the
// key is rotated at that moment (docs/delivery/paige-mail-sendgrid-integration.md).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const FORBIDDEN = "SENDGRID_PLATFORM_ADMIN_API_KEY";
const ALLOWLIST = new Set([]); // intentional: empty until operator tooling exists
const ROOT = "supabase/functions";

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (p.endsWith(".ts")) yield p;
  }
}

const violations = [];
for (const file of walk(ROOT)) {
  if (ALLOWLIST.has(file)) continue;
  if (readFileSync(file, "utf8").includes(FORBIDDEN)) violations.push(file);
}
if (violations.length) {
  console.error(`::error::${FORBIDDEN} referenced outside the operator allowlist: ${violations.join(", ")}`);
  process.exit(1);
}
console.log(`ok: no ${FORBIDDEN} references in ${ROOT} (allowlist: ${ALLOWLIST.size})`);

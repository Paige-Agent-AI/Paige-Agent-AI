#!/usr/bin/env node
// ANT-43/S7 + ANT-78 security guard: NO edge function may reference either
// SendGrid administrative credential — the full-access
// SENDGRID_PLATFORM_ADMIN_API_KEY (unread; rotation owed) or the scoped
// SENDGRID_WEBHOOK_ADMIN_API_KEY — except the single allowlisted operator
// broker below, the scoped key's only reader. Any other reference fails CI.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const FORBIDDEN = ["SENDGRID_PLATFORM_ADMIN_API_KEY", "SENDGRID_WEBHOOK_ADMIN_API_KEY"];
const ALLOWLIST = new Set(["supabase/functions/comms-sendgrid-webhook-admin/index.ts"]); // the scoped-key broker, added when it became the key's only reader
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
  const normalized = file.split("\\").join("/");
  if (ALLOWLIST.has(normalized)) continue;
  const text = readFileSync(file, "utf8");
  for (const name of FORBIDDEN) if (text.includes(name)) violations.push(`${file} (${name})`);
}
if (violations.length) {
  console.error(`::error::${FORBIDDEN} referenced outside the operator allowlist: ${violations.join(", ")}`);
  process.exit(1);
}
console.log(`ok: no forbidden SendGrid admin-key references in ${ROOT} (allowlist: ${ALLOWLIST.size})`);

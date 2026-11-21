import assert from "node:assert/strict";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { parseEnv } from "node:util";

const [mode, frontendCommit, cloudCommit] = process.argv.slice(2);
const project = "xygzykjyynhzqytbqnzu";

if (mode === "prepare") {
  const env = parseEnv(readFileSync(".env", "utf8"));
  assert.deepEqual(Object.keys(env).sort(), [
    "VITE_SUPABASE_ANON_KEY", "VITE_SUPABASE_PROJECT_ID",
    "VITE_SUPABASE_PUBLISHABLE_KEY", "VITE_SUPABASE_URL",
  ]);
  assert.equal(env.VITE_SUPABASE_PROJECT_ID, project);
  assert.equal(env.VITE_SUPABASE_URL, `https://${project}.supabase.co`);
  for (const name of ["VITE_SUPABASE_ANON_KEY", "VITE_SUPABASE_PUBLISHABLE_KEY"]) {
    const key = env[name];
    assert.ok(key, `Missing browser key ${name}`);
    if (key.startsWith("sb_publishable_")) continue;
    const claims = JSON.parse(Buffer.from(key.split(".")[1], "base64url"));
    assert.ok(claims.ref === project && claims.role === "anon", `Invalid browser key ${name}`);
  }

  const file = "src/App.tsx";
  const source = readFileSync(file, "utf8");
  const withoutVercelMetrics = source
    .replace(/^\/\/ Vercel Speed Insights[^\n]*\n\/\/ React SPA[^\n]*\nimport \{ SpeedInsights \} from "@vercel\/speed-insights\/react";\r?\n/m, "")
    .replace(/^\s*<SpeedInsights \/>\r?\n/m, "");
  assert.ok(!withoutVercelMetrics.includes("SpeedInsights"),
    "Review the frontend's current Vercel metrics integration");
  writeFileSync(file, withoutVercelMetrics);
} else if (mode === "release") {
  assert.match(frontendCommit ?? "", /^[a-f0-9]{40}$/);
  assert.match(cloudCommit ?? "", /^[a-f0-9]{40}$/);
  for (const entry of ["index.html", "auth.html", "privacy.html", "sms-terms.html", "sw.js", "embed.js"]) {
    assert.ok(statSync(`dist/${entry}`).size > 0, `Missing build output ${entry}`);
  }
  const { buildId } = JSON.parse(readFileSync("dist/version.json", "utf8"));
  assert.ok(buildId.startsWith(`${frontendCommit}-`), "Frontend build stamp does not match source");
  writeFileSync("dist/release.json", `${JSON.stringify({ frontendCommit, cloudCommit })}\n`);
} else {
  throw new Error(`Unsupported build step: ${mode}`);
}

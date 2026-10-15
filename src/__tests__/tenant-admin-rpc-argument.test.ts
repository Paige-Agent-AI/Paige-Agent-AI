import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * THE DEFECT THIS EXISTS TO STOP, stated plainly because it cost a shipped feature.
 *
 * PostgREST resolves an RPC by the NAMES of the arguments in the JSON body. A call that spells an
 * argument wrongly does not raise — it fails to resolve, and `supabase-js` reports that in `error`.
 * Every call site in this repo destructures `const { data } = await client.rpc(...)` and discards
 * `error`, so a misspelled argument becomes `data === null`, which an authorization check then
 * reads as "not an admin".
 *
 * That is precisely what happened. `agreement-send` and `agreement-document` both called
 * `is_tenant_admin` with `{ _tenant_id }` against a function whose only argument is `_tenant`, so
 * the gate could never return true and BOTH refused every caller — including the workspace owner —
 * with "Only an owner or admin can send an agreement for signature." A fail-closed gate that fails
 * closed on everyone is indistinguishable, from the outside, from a permissions problem, which is
 * why it survived a build, a typecheck, a hundred CI steps and several review rounds: the call is
 * made on an untyped client, so nothing in the type system ever looked at it.
 *
 * The argument name is READ FROM THE GENERATED SCHEMA TYPES rather than hardcoded here, so this
 * also fails if the SQL argument is ever renamed without its callers following.
 */
const ROOT = resolve(process.cwd());
const RPC = "is_tenant_admin";

function declaredArgumentName(): string {
  const types = readFileSync(join(ROOT, "src/integrations/supabase/types.ts"), "utf8");
  // `is_tenant_admin: { Args: { _tenant: string }; Returns: boolean }` — matched on the exact key so
  // the neighbouring `is_tenant_admin_as` (which takes `_actor` too) cannot be picked up instead.
  const line = types.split("\n").find((l) => l.includes(`${RPC}: { Args: {`));
  expect(line, `${RPC} is not in the generated types; regenerate them before trusting this test`).toBeTruthy();
  const arg = /Args: \{ (_[A-Za-z0-9_]+):/.exec(line as string)?.[1];
  expect(arg, `could not read the argument name out of: ${line}`).toBeTruthy();
  return arg as string;
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".git" || entry === "dist") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

describe(`every ${RPC} caller spells the argument the way the schema declares it`, () => {
  it("finds the declared argument name in the generated types", () => {
    expect(declaredArgumentName()).toBe("_tenant");
  });

  it("passes that exact argument at every call site, so no gate silently refuses everyone", () => {
    const arg = declaredArgumentName();
    const files = [
      ...sourceFiles(join(ROOT, "supabase/functions")),
      ...sourceFiles(join(ROOT, "src")),
    ].filter((f) => !f.endsWith("tenant-admin-rpc-argument.test.ts"));

    const offenders: string[] = [];
    let callSites = 0;

    for (const file of files) {
      const text = readFileSync(file, "utf8");
      // The call and the object literal that follows it, across line breaks.
      const calls = text.matchAll(new RegExp(String.raw`\.rpc\(\s*"${RPC}"\s*,\s*\{([^}]*)\}`, "g"));
      for (const call of calls) {
        callSites += 1;
        const passed = /(_[A-Za-z0-9_]+)\s*:/.exec(call[1])?.[1];
        if (passed !== arg) {
          offenders.push(`${file.replace(`${ROOT}/`, "")} passes { ${passed ?? "?"}: … }`);
        }
      }
    }

    // A guard that matched nothing would pass forever while proving nothing. The call sites are
    // real: the two agreement functions, export-document, and the calendar-connections hook.
    expect(callSites).toBeGreaterThanOrEqual(4);
    expect(offenders, `these call sites cannot bind and will refuse every caller:\n${offenders.join("\n")}`).toEqual([]);
  });
});

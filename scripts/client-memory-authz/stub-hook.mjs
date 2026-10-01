/**
 * Node ESM loader hooks that let the REAL `paige-ai-chat` Deno handler run under Node.
 *
 * Normal runs stub only the MODULE BOUNDARY — never the logic under test. Concretely:
 *
 *   • every local `.ts` under `supabase/functions/**` is transpiled by esbuild and
 *     loaded AS-IS, so the tenant-resolution code the checks assert on is the real
 *     shipped code, not a re-implementation;
 *   • exactly three remote specifiers are replaced, because Node cannot fetch them:
 *       - the Deno std http server module → a `serve()` that CAPTURES the handler
 *         instead of binding a port, so a check can invoke it directly;
 *       - the pinned `@supabase/supabase-js` esm.sh module → the recording fake client;
 *       - the pinned `zod` esm.sh module → the repo's real zod, so request
 *         -body validation still genuinely runs (a permissive stub would let a
 *         malformed fixture through and produce a false green).
 *
 * §13 — a stub that swallows a real failure is worse than no test. Anything NOT in
 * the three cases above is a hard resolve error rather than a silent no-op.
 * PAIGE_LIVE_ADMISSION_NEGATIVE_CONTROL=1 explicitly removes the Live admission
 * refusal only in the evaluated module, to prove the Live checks fail without it.
 */
import { pathToFileURL, fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");

const DENO_SERVE = /^https:\/\/deno\.land\/std@[\d.]+\/http\/server\.ts$/;
const SUPABASE_JS = /^https:\/\/esm\.sh\/@supabase\/supabase-js@/;
const ZOD = /^https:\/\/esm\.sh\/zod@/;

const STUB_SERVE = pathToFileURL(path.join(HERE, "stub-serve.mjs")).href;
const STUB_SUPABASE = pathToFileURL(path.join(HERE, "fake-supabase.mjs")).href;

export async function resolve(specifier, context, nextResolve) {
  if (DENO_SERVE.test(specifier)) return { url: STUB_SERVE, shortCircuit: true };
  if (SUPABASE_JS.test(specifier)) return { url: STUB_SUPABASE, shortCircuit: true };
  if (ZOD.test(specifier)) {
    // The repo's own zod. Real validation, not a permissive proxy.
    return nextResolve("zod", { ...context, parentURL: pathToFileURL(path.join(REPO, "package.json")).href });
  }
  if (specifier.startsWith("https://")) {
    throw new Error(
      `knowledge-scope loader: unstubbed remote import ${specifier}. ` +
        `Add it deliberately — do NOT let it resolve to something permissive (§13).`,
    );
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.startsWith("file://") && url.endsWith(".ts")) {
    const filePath = fileURLToPath(url);
    let source = await readFile(filePath, "utf8");
    // Opt-in negative control: mutate only the evaluated module, never a product file.
    if (process.env.PAIGE_LIVE_ADMISSION_NEGATIVE_CONTROL === "1" &&
        filePath.replaceAll("\\", "/").endsWith("/paige-ai-chat/index.ts")) {
      const guard = "if (authorizationError || authorizedPilot !== true) return refuseLive();";
      if (source.split(guard).length !== 2) throw new Error("Live admission negative control no longer matches exactly once");
      source = source.replace(guard, "if (false) return refuseLive();");
    }
    const esbuild = await import("esbuild");
    const out = await esbuild.transform(source, {
      loader: "ts",
      format: "esm",
      target: "node20",
      sourcefile: filePath,
    });
    return { format: "module", source: out.code, shortCircuit: true };
  }
  return nextLoad(url, context);
}

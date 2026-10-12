/**
 * Node ESM loader hooks that let the REAL `sync-credit-report-data` Deno handler run under Node.
 *
 * Same module-boundary-only discipline as scripts/apply-extraction/stub-hook.mjs: local `.ts`
 * under supabase/functions/** is transpiled by esbuild and loaded AS-IS, and exactly three
 * remote specifiers are replaced (Deno std serve → capturing stub; supabase-js → the recording
 * fake in this directory; zod → the repo's real zod so payload validation genuinely runs).
 *
 * §13 — anything not in those cases is a hard resolve error, never a silent permissive no-op.
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
    return nextResolve("zod", { ...context, parentURL: pathToFileURL(path.join(REPO, "package.json")).href });
  }
  if (specifier.startsWith("https://")) {
    throw new Error(
      `sync-credit-report-data loader: unstubbed remote import ${specifier}. ` +
        `Add it deliberately — do NOT let it resolve to something permissive (§13).`,
    );
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.startsWith("file://") && url.endsWith(".ts")) {
    const filePath = fileURLToPath(url);
    const source = await readFile(filePath, "utf8");
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

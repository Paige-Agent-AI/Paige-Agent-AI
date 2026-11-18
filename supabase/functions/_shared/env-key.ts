// _shared/env-key.ts — case-INSENSITIVE provider-secret resolver (the one home, §12/§18).
//
// THE FOOTGUN THIS DEFENDS AGAINST: `Deno.env.get(name)` is CASE-SENSITIVE. When an operator
// sets a secret under a differently-cased name than the code reads — e.g. the dashboard has
// "Gemini_API_Key", "Ideogram_api_key", or "Featherless_API_KEY" while the code reads the
// canonical ALL-CAPS "GEMINI_API_KEY" / "IDEOGRAM_API_KEY" / "FEATHERLESS_API_KEY" — the read
// returns undefined, the provider reports needs_config, and the feature looks "not switched on"
// even though the key IS set. (This is exactly the Gemini-image saga: OpenAI's key matched the
// all-caps read and worked; Gemini's mixed-case key silently read as undefined.)
//
// FIX: resolve keys case-insensitively — but EXACT match wins FIRST, so a correctly-named secret
// behaves EXACTLY as it does today (zero behavior change; the scan is never even reached for it).
// The case-insensitive fallback scan only runs when no candidate matches exactly, keeping the
// common path cheap. The env map is NOT cached, so rotating a secret takes effect immediately.
//
// SECURITY (§13): never logs, echoes, or returns a key VALUE anywhere. It only reads and returns.

/**
 * Resolve the first present, truthy value among the given candidate env-var names.
 *
 * Resolution order:
 *   1. EXACT match — for each name in order, return `Deno.env.get(name)` if truthy. This is the
 *      only path a correctly-named secret ever takes, so its behavior is identical to a bare
 *      `Deno.env.get`.
 *   2. Case-insensitive scan — only if no exact match: read `Deno.env.toObject()` ONCE and return
 *      the first entry whose KEY equals any candidate name case-insensitively and whose value is
 *      truthy.
 *   3. Otherwise `undefined`.
 *
 * @param names one or more candidate variable names (e.g. envKey("REPLICATE_API_TOKEN", "REPLICATE_API_KEY"))
 * @returns the resolved value, or undefined if none is set. Never logged.
 */
// Deno global guarded so this shared module type-checks when vitest/app-tsc
// pulls it into the app project (no Deno types there); edge behavior identical.
type DenoEnv = { get(name: string): string | undefined; toObject(): Record<string, string> };
const denoEnv = (): DenoEnv | undefined => (globalThis as { Deno?: { env?: DenoEnv } }).Deno?.env;

export function envKey(...names: string[]): string | undefined {
  const envApi = denoEnv();
  if (!envApi) return undefined;
  // 1. Exact match first — correctly-named keys behave EXACTLY as today, scan never reached.
  for (const name of names) {
    const v = envApi.get(name);
    if (v) return v;
  }
  // 2. No exact hit — scan the env map ONCE (not cached: respects secret rotation) and match
  //    a candidate name case-insensitively. A get-only env surface (offline contract harnesses,
  //    restricted runtimes) has no map to scan; return undefined rather than throwing so a
  //    missing key stays an honest miss and the caller's fail-closed path still runs.
  if (typeof envApi.toObject !== "function") return undefined;
  const lowered = names.map((n) => n.toLowerCase());
  const env = envApi.toObject();
  for (const [k, v] of Object.entries(env)) {
    if (v && lowered.includes(k.toLowerCase())) return v;
  }
  return undefined;
}

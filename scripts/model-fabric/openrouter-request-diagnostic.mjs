/**
 * OpenRouter request diagnostic (INT-334 / PO-EXP25).
 *
 * Builds the exact Responses request PAIGE's `buildResponsesRequest` would
 * send to OpenRouter for a tool-bearing chat turn, then inspects each field
 * against OpenRouter's documented Responses API schema. No network calls,
 * no credentials, no production data — synthetic fixtures only.
 *
 * Run: node --import ./scripts/client-memory-authz/register.mjs
 *        scripts/model-fabric/openrouter-request-diagnostic.mjs
 */

// Mock Deno.env like the existing check script does
const ENV = {
  OPENAI_API_KEY: "sk-test-not-a-real-key",
  OPENROUTER_API_KEY: "sk-or-test-not-a-real-key",
};
globalThis.Deno = { env: { get: (k) => ENV[k] ?? undefined, toObject: () => ({ ...ENV }) } };
const ad = await import("../../supabase/functions/_shared/openai-responses.ts");

// Synthetic, non-sensitive request matching PAIGE's tool-bearing chat shape.
const CONVO = [
  { role: "system", content: "You are PAIGE." },
  { role: "user", content: "Who is Acme's contact?" },
  { role: "assistant", content: "Looking.", tool_calls: [
    { id: "call_1", type: "function", function: { name: "crm_contact_lookup", arguments: "{\"q\":\"Acme\"}" } },
  ] },
  { role: "tool", tool_call_id: "call_1", content: "{\"name\":\"Dana\"}" },
];

const TOOL = { type: "function", function: { name: "crm_contact_lookup", description: "Find a contact", parameters: { type: "object", properties: { q: { type: "string" } }, required: ["q"] } } };

console.log("=== OpenRouter request diagnostic ===\n");

// 1. Minimal request (model + input only) — baseline that should work
const minimal = ad.buildResponsesRequest(
  { messages: [{ role: "user", content: "Hello" }] },
  { model: "openai/gpt-6-luna", provider: "openrouter" },
);
console.log("1. MINIMAL (no tools, no cache, no extra fields):");
console.log(JSON.stringify(minimal, null, 2));

// 2. Full tool-bearing chat request — what PAIGE actually sends
const full = ad.buildResponsesRequest(
  { messages: CONVO, tools: [TOOL], tool_choice: "auto" },
  { model: "openai/gpt-6-luna", provider: "openrouter", effort: "none" },
);
console.log("\n2. FULL TOOL-BEARING CHAT (what PAIGE sends today):");
console.log(JSON.stringify(full, null, 2));

// 3. Progressive elimination: remove each PAIGE-specific field
const noInclude = { ...full };
delete noInclude.include;
console.log("\n3A. WITHOUT `include`:");
console.log(JSON.stringify(noInclude, null, 2));

const noCache = { ...full };
delete noCache.prompt_cache_key;
delete noCache.prompt_cache_options;
console.log("\n3B. WITHOUT `prompt_cache_key` / `prompt_cache_options`:");
console.log(JSON.stringify(noCache, null, 2));

const noReasoning = { ...full };
delete noReasoning.reasoning;
console.log("\n3C. WITHOUT `reasoning`:");
console.log(JSON.stringify(noReasoning, null, 2));

const noStore = { ...full };
delete noStore.store;
console.log("\n3D. WITHOUT `store`:");
console.log(JSON.stringify(noStore, null, 2));

// 4. Field-by-field compatibility report
console.log("\n=== FIELD COMPATIBILITY REPORT ===");
const suspicious = [
  { field: "include", value: full.include, reason: "OpenRouter Responses API may not accept `include` array" },
  { field: "prompt_cache_key", value: full.prompt_cache_key, reason: "OpenRouter may not support prompt cache keys" },
  { field: "prompt_cache_options", value: full.prompt_cache_options, reason: "OpenRouter may not support prompt cache options" },
  { field: "reasoning", value: full.reasoning, reason: "OpenRouter may not accept `reasoning.effort` for Luna (non-reasoning model)" },
  { field: "store", value: full.store, reason: "OpenRouter may not support `store` parameter" },
];
for (const s of suspicious) {
  const present = full[s.field] !== undefined;
  const valStr = present ? JSON.stringify(s.value).slice(0, 80) : "n/a";
  console.log(`  [${present ? "SENT" : "OMITTED"}] ${s.field}: ${valStr}${present ? " — " + s.reason : ""}`);
}

// 5. What OpenRouter documents vs what PAIGE sends
console.log("\n=== OPENROUTER DOCUMENTED FIELDS (per owner) ===");
console.log("  Supported: model, input, tools, tool_choice, stream");
console.log("  UNVERIFIED: include, prompt_cache_key, prompt_cache_options, reasoning, store");
console.log("\nLIKELY CULPRITS for HTTP 400 (in order of suspicion):");
console.log("  1. include: [\"reasoning.encrypted_content\"] — not standard OpenAI Responses field");
console.log("  2. prompt_cache_key / prompt_cache_options — OpenRouter may not echo OpenAI caching");
console.log("  3. reasoning: { effort: \"none\" } — OpenRouter may reject unknown field for Luna");
console.log("  4. store: false — OpenRouter may not support store parameter");

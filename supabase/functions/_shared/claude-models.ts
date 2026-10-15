// _shared/claude-models.ts — THE ONE PLACE a Claude model id is chosen (§18).
//
// No imports, no I/O, no env: pure data, so `model-allowlist.ts` (a plain data module) and
// `claude.ts` (the client) both read the same two constants without the allow-list pulling the
// client's trace and budget dependencies into every function that imports it.
//
// Every reasoning-tier path — Chat (streamed and not), the tool loop, C4 resumes, Deep Research
// synthesis, drafting, the strategist, the eval judge, visual critique, the callModel frontier cell
// and its fallback — resolves through CLAUDE_REASONING. The trace records the id the provider served.
//
// INT-329: claude-sonnet-5-5 by owner ruling (2026-10-06), which retired Sonnet 5 and superseded the
// earlier plan to gate this switch on the frozen A/B (`model-ab`, kept as an optional tool). Same list
// prices, tokenizer and context. Rollback is this one line in reverse; CI redeploys every importer.
// No request field a live path sends differs between the two models (proved by
// scripts/model-migration/reasoning-tier-check.mjs, which passes on either value).
// Caches are per model, so a switch in either direction cold-starts every cached prefix once.
// This is the Anthropic reasoning seam only. Which provider and tier a turn uses is decided upstream
// by the model fabric; Sonnet 5.5 is one frontier peer there, not the owner of every turn.
export const CLAUDE_REASONING = "claude-sonnet-5-5";
export const CLAUDE_CLASSIFICATION = "claude-haiku-4-5"; // alias: the provider serves the current snapshot

/** Reasoning ids PAIGE has run on. The check fails on any other value, so a future switch is a
 *  deliberate edit here; every id but the current one must stay OFF the allow-list. */
export const KNOWN_REASONING_MODELS: readonly string[] = ["claude-sonnet-5", "claude-sonnet-5-5"];

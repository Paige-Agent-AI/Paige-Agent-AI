/**
 * D — no more free narration.
 *
 * Production incidents (2026-10-01): Paige said "Done — PPL-MRBD9 archived" with zero
 * executions in the database; she said "the tool won't accept that format" with zero tool
 * calls recorded. Her own prose was the only "evidence" — and it was wrong both times.
 *
 * This suite pins the three prompt-level contracts and the anti-self-conditioning filter:
 *  1. claims-require-readback: an operational claim requires a tool result, readback, or
 *     receipt from the current turn — never the model's own assertion;
 *  2. search-before-say: a "the platform can't do X" claim requires having checked the
 *     current tool list;
 *  3. anti-self-conditioning: a prior assistant turn's unsupported outcome claim is marked
 *     so it cannot become authoritative context for the current turn;
 *  4. the corrected stale-reference rule: stable canonical identities (a client_ref, a PPL
 *     reference) stay valid across turns; mutable state (version, membership, archived
 *     status) refreshes before a consequential proposal.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

const root = join(__dirname, "..", "..");
const chat = readFileSync(join(root, "supabase/functions/paige-ai-chat/index.ts"), "utf8");

describe("claims-require-readback: operational claims need evidence from this turn", () => {
  it("the prompt states that the model's own words are never evidence", () => {
    expect(chat).toMatch(/your own words are never evidence|model.{0,30}prose is never evidence/i);
  });

  it("the prompt names the claim classes that require receipts", () => {
    expect(chat).toMatch(/created|archived|restored|updated|deleted|sent|enrolled/i);
    expect(chat).toMatch(/readback|receipt/i);
  });

  it("is not a vacuous check: the existing CONFIRM THE RESULT rule remains", () => {
    expect(chat).toContain("CONFIRM THE RESULT");
  });
});

describe("search-before-say: capability-negative claims require a current lookup", () => {
  it("the prompt requires checking tools before saying the platform can't do something", () => {
    expect(chat).toMatch(/before (?:you )?say.{0,80}(?:can'?t|cannot|doesn'?t|not available|no tool)/i);
  });

  it("the prompt forbids relying on remembered historical tools over live capability truth", () => {
    expect(chat).toMatch(/remembered.{0,40}(?:histor|tool|earlier).{0,40}(?:cannot|outrank|never).{0,40}live/i);
  });
});

describe("anti-self-conditioning: prior unsupported claims are marked", () => {
  it("the conversation builder marks assistant turns with outcome claims but no receipts", () => {
    // The context-preparation step must detect and flag unsupported claims so the
    // model cannot treat its own prior prose as proof.
    expect(chat).toMatch(/markUnsupportedClaims|flagUnverifiedOutcomes|annotatePriorClaims/i);
  });
});

describe("the corrected stale-reference rule", () => {
  it("the prompt distinguishes stable identities from mutable state", () => {
    expect(chat).toMatch(/stable.{0,40}(?:identity|id|reference).{0,60}(?:remain|stay|valid)/i);
    expect(chat).toMatch(/mutable.{0,40}(?:state|version|membership|status).{0,60}(?:refresh|re-read|current)/i);
  });
});

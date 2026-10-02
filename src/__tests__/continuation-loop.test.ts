/**
 * C1 — the bounded continuation loop.
 *
 * Production repro (2026-10-01): the owner asked Paige to add Jacqueline to a pipeline; the
 * model narrated "Let me try" and "Pulling up her details" and the turn ENDED — no tool
 * dispatched, no card minted, no readback, no blockage stated. The server had treated
 * narration as completion. The owner had to send another message to reactivate her.
 *
 * This suite pins the loop: when the user's request carries action intent and the model's
 * round produced prose with NO terminal state (no tool executed, no approval card minted,
 * no governed refusal, no blockage), the server feeds the task back through a bounded
 * continuation — the model gets the continuation instruction and another provider call,
 * inside the same turn, under the same authority and event machinery. A genuine question
 * that needs the user's answer is a terminal state and never continues.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

const root = join(__dirname, "..", "..");
const chat = readFileSync(join(root, "supabase/functions/paige-ai-chat/index.ts"), "utf8");

describe("the server does not treat narration as completion", () => {
  it("carries a bounded continuation budget", () => {
    expect(chat).toContain("MAX_CONTINUATIONS");
    expect(chat).toMatch(/continuationsUsed\s*<\s*MAX_CONTINUATIONS|continuationsUsed \+/);
  });

  it("feeds the task back with the continuation instruction inside the same turn", () => {
    expect(chat).toMatch(/still unresolved[\s\S]{0,200}(Complete it|complete it)/i);
    expect(chat).toContain('convo.push({ role: "user", content: "The requested task is still unresolved.');
  });

  it("re-enters the provider through the existing gateway, not a second runner", () => {
    expect(chat).toMatch(/continuation[\s\S]{0,800}gatewayCompat/);
  });

  it("requires ACTION INTENT — a question that needs the user's answer never continues", () => {
    expect(chat).toContain("isActionIntent");
    expect(chat).toMatch(/isActionIntent[\s\S]{0,200}(userContent|user.*content|lastUser)/);
  });

  it("treats these as terminal: tool executed, card minted, or nothing requested", () => {
    expect(chat).toMatch(/totalToolCalls\s*(===?\s*0|>\s*0)/);
    expect(chat).toMatch(/queuedApprovals\.length|confirmTrace\.length|crmResultTrace\.length/);
  });

  it("is not vacuous: the round loop and its prose-only exit remain", () => {
    expect(chat).toContain("for (let round = 0; round < MAX_ROUNDS; round++)");
    expect(chat).toMatch(/if \(!hasToolCall\)/);
  });
});

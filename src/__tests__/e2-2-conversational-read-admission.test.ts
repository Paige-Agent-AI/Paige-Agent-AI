// @vitest-environment node
// E2-2 — the ANT-23 read-only admission class in conversational turns. Failing-first: every
// assertion below fails on the #1899 zero-tool contract this PR narrows (splice-all offer,
// refuse-all dispatch guard, "NO tools" prompt block, PARTIAL chatBinding).
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { BUSINESS_OPERATING_SNAPSHOT } from "../../supabase/functions/_shared/paige-spine/domains/business-review.ts";

const CHAT = fs.readFileSync(path.resolve(__dirname, "../../supabase/functions/paige-ai-chat/index.ts"), "utf8");

describe("E2-2 admission set (ANT-23)", () => {
  it("names exactly the admitted reads — E2-2's two INT-340 issuer reads, E4-S2's two and the approved exact Calendar/Task reads — no spread", () => {
    const m = CHAT.match(/CONVERSATIONAL_ADMITTED_READ_TOOLS[^=]*=\s*new Set\(Object\.freeze\(\[([^\]]*)\]\)\)/);
    expect(m).not.toBeNull();
    // The captured literal must BE the pair: no spread, no unquoted tokens, nothing else. A
    // `...EXTRA` inside the brackets would evade a quoted-name extraction (the review's P2), so
    // pin the raw text itself.
    // E4-S2 (2026-10-13) widened it deliberately, by the recorded determination in
    // docs/delivery/e2-1-readonly-admission-determination.md and its independent security review.
    expect(m![1].trim()).toBe('"read_business_metric", "get_business_snapshot", "read_client_engagement_status", "read_business_time_zone", "read_calendar_booking", "crm_get_task"');
  });

  it("the set is declared ReadonlySet and its comment forbids widening without an owner-recorded change", () => {
    expect(CHAT).toMatch(/const CONVERSATIONAL_ADMITTED_READ_TOOLS: ReadonlySet<string>/);
    expect(CHAT).toMatch(/new Set\(Object\.freeze\(/);
    expect(CHAT).toMatch(/Widen this set only by an owner-recorded policy change/);
  });
});

describe("E2-2 offer (first enforcement)", () => {
  it("keeps only the admitted reads on a conversational turn instead of splicing everything", () => {
    expect(CHAT).toMatch(/if \(interactiveConversational\) \{\s*\n\s*const before = toolDefs\.length;/);
    expect(CHAT).toMatch(/CONVERSATIONAL_ADMITTED_READ_TOOLS\.has\(fn\.name\)\) continue;/);
    // The unconditional zero-tool splice is gone.
    expect(CHAT).not.toMatch(/toolDefs\.splice\(0, withheldCount\)/);
  });

  it("still logs the withheld/admitted split for operations", () => {
    expect(CHAT).toMatch(/conversational mode: \$\{withheldCount\} tools withheld, \$\{toolDefs\.length\} read-only admitted/);
  });
});

describe("E2-2 dispatch guard (second enforcement)", () => {
  it("refuses every NON-admitted tool call on a conversational turn, before any executor", () => {
    expect(CHAT).toMatch(/if \(interactiveConversational && !CONVERSATIONAL_ADMITTED_READ_TOOLS\.has\(tc\.function\.name\)\) \{/);
    expect(CHAT).toMatch(/code: "CONVERSATIONAL_MODE"/);
  });

  it("the refusal names the tool honestly, not a universal 'no tool can run'", () => {
    expect(CHAT).toMatch(/That tool can't run here\./);
    expect(CHAT).not.toMatch(/No tool can be run here\./);
  });
});

describe("E2-2 prompt block stays truthful", () => {
  it("keeps the hard line: no actions, approvals or external effects, none have run, never promise one", () => {
    const m = CHAT.match(/const PAIGE_CONVERSATIONAL_MODE_BLOCK = `([\s\S]*?)`;/);
    expect(m).not.toBeNull();
    const block = m![1];
    expect(block).toMatch(/ACTIONS ARE OFF THIS TURN/);
    expect(block).toMatch(/no actions, approvals or external effects can be requested or run, and none have run/);
    expect(block).toMatch(/Never claim an action was performed, and never promise one for later/);
  });

  it("no longer claims the model has NO tools — it names the two admitted reads and their limits", () => {
    const m = CHAT.match(/const PAIGE_CONVERSATIONAL_MODE_BLOCK = `([\s\S]*?)`;/);
    const block = m![1];
    expect(block).not.toMatch(/you have NO tools/);
    expect(block).toMatch(/get_business_snapshot/);
    expect(block).toMatch(/read_business_metric/);
    expect(block).toMatch(/A lookup is a read: it changes nothing and grants no action authority/);
  });
});

describe("E2-2 registration truth", () => {
  it("business.operating_snapshot chatBinding is LIVE now that admission reaches it", () => {
    expect(BUSINESS_OPERATING_SNAPSHOT.chatBinding).toBe("LIVE");
  });
});

describe("E2-2 preserved safeguards", () => {
  it("the interactive settlement and approval refusals are untouched — approvals stay refused (409 path intact)", () => {
    expect(CHAT).toMatch(/INTERACTIVE_EFFECTS_UNAVAILABLE/);
    expect(CHAT).toMatch(/interactiveConversational = false;/);
  });

  it("no admission, activation or rollout code is touched — INT-346 stays DRAINING by server state", () => {
    // The admission of a turn still keys off the staged-not-active rollout row, unchanged.
    expect(CHAT).toMatch(/let interactiveConversational = false;/);
    expect(CHAT).not.toMatch(/paige_chat_interactive_activate/);
  });
});

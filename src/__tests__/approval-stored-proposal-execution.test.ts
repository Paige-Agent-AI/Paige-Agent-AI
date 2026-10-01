/**
 * PR 2b — the approval-stranding repair.
 *
 * Governing invariant: an approved card authorizes the STORED server-side
 * proposal. Execution must never depend on the model re-emitting the same
 * arguments. Production repro (2026-09-30, owner workspace): three deal.create
 * cards minted; the first two approvals stranded unconsumed because the model
 * re-worded the action between card and re-dispatch; only the third landed.
 *
 * Proof classes here:
 *  - door contract: the proposal response carries everything an approved click
 *    needs to execute the stored proposal (settled key + fingerprint), and the
 *    stored summary is object-aware human copy — never a raw action verb;
 *  - chat wiring: the confirm frame carries the canonical command so the client
 *    can execute the stored proposal, and the prompt forbids re-constructing an
 *    approved action;
 *  - client wiring: Approve executes the stored proposal through the CRM door
 *    directly under the user's own session — the model is never the source of
 *    execution arguments after approval.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const DOOR = "supabase/functions/crm-command/index.ts";
const CHAT = "supabase/functions/paige-ai-chat/index.ts";
const CHAT_UI = "src/components/dashboard/PaigeAIChat.tsx";

describe("the door proposal response enables stored-proposal execution", () => {
  it("returns the settled idempotency key with the approval_required response", () => {
    const door = read(DOOR);
    const i = door.indexOf('outcome: "approval_required"');
    expect(i).toBeGreaterThan(-1);
    const tail = door.slice(i, i + 600);
    expect(tail).toContain("idempotency_key");
  });

  it("renders object-aware human copy for deal.create — not a raw action verb", () => {
    const door = read(DOOR);
    expect(door).toMatch(/case "deal\.create":/);
    expect(door).toMatch(/case "contact\.create":/);
    // The raw-verb default that produced "deal.create for a new record" must not
    // be reachable for create actions: no action interpolation in the default.
    expect(door).not.toMatch(/default:\s*\n\s*return `\$\{command\.action\.replaceAll\("_", " "\)\} for \$\{target\}`;/);
  });

  it("keeps the atomic stored-args claim as the only execution basis", () => {
    const door = read(DOOR);
    expect(door).toContain('.eq("fingerprint", body.approved_fingerprint)');
    expect(door).toContain("claimedArgs");
  });
});

describe("the chat wires approvals for stored-proposal execution", () => {
  it("the confirm frame carries the canonical command and settled key", () => {
    const chat = read(CHAT);
    // The door's approval_required result must carry the exact command it minted the proposal
    // under, and the collection must forward it — the type alone proves nothing.
    expect(chat).toContain("confirm_command: canonicalCrmCommand, confirm_idempotency_key: idempotencyKey");
    expect(chat).toMatch(/confirm_command && typeof parsed\.confirm_command === "object"/);
  });

  it("the prompt forbids re-constructing an approved action", () => {
    const chat = read(CHAT);
    expect(chat).toMatch(/approved card executes the stored proposal/i);
    expect(chat).toMatch(/never re-construct|do not re-construct|never re-emit/i);
  });

  it("the prompt requires resolved identities before proposing", () => {
    const chat = read(CHAT);
    expect(chat).toMatch(/resolve.{0,160}before.{0,40}propos/i);
  });
});

describe("the client executes the stored proposal on Approve", () => {
  it("invokes the CRM door directly with the approved fingerprint", () => {
    const ui = read(CHAT_UI);
    // The exact wiring, not adjacent vocabulary: the approve path calls the door with the
    // stored proposal's command, its settled key, and the approved fingerprint.
    expect(ui).toContain('supabase.functions.invoke("crm-command"');
    expect(ui).toContain("approved_fingerprint: fingerprint");
  });

  it("reads the door's structured body from the FunctionsHttpError context", () => {
    const ui = read(CHAT_UI);
    expect(ui).toContain("error as { context?: { json?: () => Promise<unknown> } }).context");
    expect(ui).toContain("await ctx.json()");
  });

  it("maps the door's outcome_unknown answers and transport failures to could-not-confirm", () => {
    const ui = read(CHAT_UI);
    expect(ui).toContain('body.outcome_unknown === true || transportFailed');
    expect(ui).toContain('? "unconfirmed"');
  });

  it("carries a re-proposed fingerprint so a spent or raced approval re-renders the live card", () => {
    const ui = read(CHAT_UI);
    expect(ui).toContain('body.outcome === "approval_required"');
    expect(ui).toContain("reproposedAny");
    expect(ui).toContain("confirmDecision: decision && !reproposedAny ? decision : undefined");
  });

  it("applies the shared answered-or-not rule: a foreign error body never downgrades to did-not-run", () => {
    const ui = read(CHAT_UI);
    expect(ui).toContain("const doorAnswered = !transportFailed && body.ok !== undefined;");
    expect(ui).toContain("(errorPresent && !doorAnswered)");
  });

  it("a re-proposed card renders live even when it is not the last message", () => {
    const ui = read(CHAT_UI);
    expect(ui).toContain("message.approvalOutcome?.reported === true && message.confirm.some((c) => !!c.fingerprint && !(message.approvalOutcome?.actions ?? []).some((a) => a.fingerprint === c.fingerprint))");
  });

  it("never rolls a directly-executed approval back to a live Approve control", () => {
    const ui = read(CHAT_UI);
    expect(ui).toContain("const effectiveRollback = executedOutcomes.length ? shown : rollback;");
  });

  it("is not a vacuous wiring check: the legacy approval echo path still exists", () => {
    const ui = read(CHAT_UI);
    expect(ui).toContain("approvedConfirmations");
  });
});

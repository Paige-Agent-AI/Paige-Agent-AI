/**
 * P0 — consequential-action confirm gate: batch repair + honest containment (2026-09-13).
 *
 * The edge handler `paige-ai-chat/index.ts` cannot be unit-executed (Deno + a live Supabase client),
 * so these are SOURCE-ASSERTIONS over the shipped handler — the same proof class as
 * task-thread-link-wiring.test.ts. They pin that the three fixes are wired as designed and that the
 * hard invariants are not weakened. The PURE decision primitive (confirmIdentityValue) is proven
 * behaviourally in confirm-fingerprint.test.ts; the authenticated end-to-end battery (benign
 * dismissal, batch resolve, expired/replayed/forged/cross-tenant, receipt/Rail, no-outbound) is
 * PROOF OWED against the deployed surface (§32.c) — recorded, not faked. One part is no longer only
 * a source-assertion: the refusal of an id the executor cannot address is EXECUTED on the real
 * handler in CI by scripts/client-memory-authz (checks 18.ID1–ID8).
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

const HANDLER = readFileSync("supabase/functions/paige-ai-chat/index.ts", "utf8");
// The confirm gate (autoMode === "confirm") through the end of its !approvedArgs handling. The block
// runs ~8346–8560; slice generously by characters so every assertion lands inside it.
const gateStart = HANDLER.indexOf('if (autoMode === "confirm") {');
const gate = HANDLER.slice(gateStart, gateStart + 26000);

describe("FIX A — a batch is disambiguated by the stable subject id, WITHIN the approved set", () => {
  it("imports the batch-disambiguation primitives from the one home (§18)", () => {
    expect(HANDLER).toMatch(
      /import\s*\{[^}]*\bCONFIRM_IDENTITY_KEY\b[^}]*\bconfirmIdentityValue\b[^}]*\}\s*from\s*["']\.\.\/_shared\/confirm-fingerprint\.ts["']/,
    );
  });

  it("narrows the APPROVED-SET lookup by the call's subject id — never widens what is claimable", () => {
    // The narrowing filter is applied to the same query that is scoped `.in("fingerprint", approvedConfirmations)`,
    // so it can only ever select a proposal the operator already approved.
    expect(gate).toContain('.in("fingerprint", [...approvedConfirmations].map((token) => token.split(":")[0]))');
    expect(gate).toContain('if (token && approvedConfirmations.has(token))');
    // The jsonb-text narrow uses the proven `.filter(col,"eq",val)` form (not `.eq` shorthand).
    expect(gate).toContain('lookup = lookup.filter(`args->>${identityKey}`, "eq", identityVal)');
    // The narrowed claim still requires exactly one match and that it is in the approved set.
    expect(gate).toContain("matches?.length === 1");
    expect(gate).toContain("approvedConfirmations.has(selected.fingerprint)");
    expect(gate).toContain("exactMatches.length === 1");
  });

  it("the narrowed claim still runs STORED args (I2) — the gate overwrites arguments with the approved call", () => {
    expect(gate).toContain("tc.function.arguments = JSON.stringify(approvedArgs)");
  });

  it("keeps the predate-the-turn (I3) and scope (I4) predicates on the narrowed lookup", () => {
    expect(gate).toContain('.neq("issued_in_request", requestNonce)');
    // tenant / thread / scoped_client scoping is applied to the lookup (IS NOT DISTINCT FROM for nulls).
    expect(gate).toMatch(/lookup = personaCtx\?\.tenant_id \? lookup\.eq\("tenant_id"/);
    expect(gate).toMatch(/lookup = scopedClientId \? lookup\.eq\("scoped_client_id"/);
  });

  it("a lookup FAILURE during an approval ends in the honest terminal, never a fresh proposal (Codex P1, 2026-09-13)", () => {
    // The approved-set lookup runs ONLY when approvedConfirmations.size > 0 (an approval turn), so a
    // PostgREST error — or the jsonb `args->>…` path filter being rejected — is always mid-approval.
    // Before this fix, an errored/thrown lookup left approvedSetAmbiguous false and (the model-assert
    // claim path also being disabled on a non-empty set) execution fell through to recordConfirmation,
    // minting a drifted proposal and recreating the very re-ask loop the P0 contains. Both the
    // returned-error and the thrown path now set the ambiguous terminal. (Behavioral e2e on the
    // deployed Deno handler is §32.c PROOF OWED; this pins the wiring — the proof class of this file.)
    expect(gate).toMatch(/else if \(lookupError\) \{[\s\S]*?approvedSetAmbiguous = true;/);
    expect(gate).toContain("confirm approved-set lookup failed"); // §68 loud-log on a returned error
    expect(gate).toContain("A THROWN failure is the same hazard"); // the thrown-path catch also sets the terminal
  });
});

describe("FIX B — an ambiguous approval ends in ONE truthful terminal, never a re-ask loop", () => {
  it("presents the owner-required state verbatim, with a correlation id, and records NOTHING", () => {
    const term = gate.indexOf("execution_unavailable: true");
    expect(term).toBeGreaterThan(-1);
    expect(gate).toContain("Action execution is temporarily unavailable; nothing changed or sent.");
    expect(gate).toContain("correlation_id: requestNonce");
    // The terminal must come BEFORE recordConfirmation and end in `continue`, so no fresh proposal is
    // minted (that is what stopped the accumulation loop).
    const recordIdx = gate.indexOf("const recorded = await recordConfirmation(fp");
    expect(recordIdx).toBeGreaterThan(term);
  });

  it("only fires when the operator is approving AND the batch is genuinely ambiguous (never on a first ask)", () => {
    // Primary signal: the approved-set lookup found ≥1 but resolved no single fingerprint.
    expect(gate).toContain("approvedSetAmbiguous = true");
    expect(gate).toContain("const ambiguousApproval = approvedSetAmbiguous");
  });

  it("GUARD (adversary #2): ambiguity is only flagged on an actual approval attempt, not a fresh confirm:false", () => {
    expect(gate).toContain("(identityVal !== null || gateArgs.confirm === true)) approvedSetAmbiguous = true");
  });
});

describe("approval-path hardening", () => {
  it("contract A", () => {
    expect(gate).toContain("approvedFingerprint !== undefined");
    expect(gate).toContain("await claimConfirmation(approvedFingerprint, tc.function.name)");
    expect(HANDLER).toContain("!approvedConfirmations.has(fp)");
    expect(gate).not.toContain("claimBy");
    expect(HANDLER).not.toContain("if (fp === null)");
    expect(HANDLER).toContain('const nonce = await selectedConfirmationNonce(fp, tool)');
    expect(HANDLER).toContain('.eq("fingerprint", fp.split(":")[0]).eq("issued_in_request", nonce)');
  });

  it("the terminal NEVER executes — it only pushes a success:false tool result and continues", () => {
    // Isolate the ambiguous-approval block and prove there is no RPC/insert/continue-to-exec inside it.
    const t = gate.indexOf("if (ambiguousApproval) {");
    expect(t).toBeGreaterThan(-1);
    const block = gate.slice(t, t + 1400);
    expect(block).toContain("success: false");
    expect(block).toContain("continue;");
    expect(block).not.toMatch(/\.rpc\(|\.insert\(|tc\.function\.arguments\s*=/);
  });
});

describe("FIX C — a bug-report/improvement that cannot be filed says so; it never claims it was", () => {
  const imp = (() => {
    // Anchor on a marker unique to the executor (not the tool definition or the dispatch gate).
    const i = HANDLER.indexOf("const impTenantId = personaCtx?.tenant_id ?? null;");
    return HANDLER.slice(i - 1200, i + 2000);
  })();

  it("no longer THROWS on a tenant-less (operator) caller — it returns an honest unavailable", () => {
    expect(imp).not.toContain('throw new Error("improvement tools require a resolved tenant")');
    expect(imp).toContain('availability: "unavailable"');
    expect(imp).toContain("so nothing was filed");
  });

  it("the role refusal instructs an honest 'nothing was filed' report (never a false 'filed')", () => {
    expect(imp).toContain("Improvement proposals are restricted to admins.");
    expect(imp).toContain("Nothing was filed");
  });

  it("still WRITES only for an authorized caller with a resolved tenant (gate not weakened)", () => {
    // The insert is still guarded by the role check and a non-null impTenantId above it.
    expect(imp).toContain("if (!isAdmin) {");
    expect(imp).not.toContain("isCoach");
    expect(imp).toContain('.from("paige_improvement_proposals").insert(');
    expect(imp).toContain("tenant_id: impTenantId");
  });
});

describe("THE SHORTENED-ID HALF — an id the executor cannot address never becomes a card (2026-09-26)", () => {
  // 2026-09-13, production: with the fingerprint stable again, Paige sent a shortened action id, the
  // operator approved, the approval was claimed, and advance_action cast the prefix to uuid and
  // failed 22P02 — 13 proposals, 0 dismissals. The shape itself is proven behaviourally (and against
  // production's own uuid input) in confirm-fingerprint.test.ts; these pin that BOTH doors use it.
  const mint = HANDLER.indexOf("const recorded = await recordConfirmation(fp, tc.function.name, gateArgs, summary);");
  const refuseAtMint = HANDLER.indexOf("const idProblem = unaddressableConfirmArgs(tc.function.name, gateArgs);");
  const dispatch = HANDLER.indexOf('} else if (tc.function.name === "action_advance") {');
  const rpc = HANDLER.indexOf('supabaseClient.rpc("advance_action"', dispatch);
  const refuseAtDispatch = HANDLER.indexOf('const idProblem = unaddressableConfirmArgs("action_advance", args);', dispatch);

  it("imports the shape check and its one refusal from the gate's home (§18)", () => {
    expect(HANDLER).toMatch(
      /import\s*\{[^}]*\bunaddressableConfirmArgs\b[^}]*\bunaddressableArgsRefusal\b[^}]*\}\s*from\s*["']\.\.\/_shared\/confirm-fingerprint\.ts["']/,
    );
  });

  it("refuses at the proposal door BEFORE anything is recorded — no card, no spent approval", () => {
    expect(refuseAtMint).toBeGreaterThan(gateStart);
    expect(mint).toBeGreaterThan(refuseAtMint);
    const between = HANDLER.slice(refuseAtMint, mint);
    expect(between).toContain('JSON.stringify(unaddressableArgsRefusal(idProblem, "proposal"))');
    expect(between).toContain("continue;");
  });

  it("refuses at dispatch BEFORE the cast, for the lanes that never pass the gate", () => {
    expect(dispatch).toBeGreaterThan(-1);
    expect(refuseAtDispatch).toBeGreaterThan(dispatch);
    expect(rpc).toBeGreaterThan(refuseAtDispatch);
    expect(HANDLER.slice(refuseAtDispatch, rpc)).toContain('JSON.stringify(unaddressableArgsRefusal(idProblem, "dispatch"))');
  });

  it("tells the model the complete-id contract where it reads the tool, for both tools that cast it", () => {
    expect(HANDLER).toMatch(/name: "action_advance"[\s\S]{0,900}action_id: \{ type: "string", description: "The COMPLETE paige_actions id/);
    expect(HANDLER).toMatch(/name: "action_get"[\s\S]{0,500}action_id: \{ type: "string", description: "The COMPLETE paige_actions id/);
  });
});

describe("the write trail skips only what declares it never ran", () => {
  // The first fix keyed the skip on `executed: false`, which n8n management writes already return for
  // a write that DID happen (no workflow run), so every such write would have left the audit trail.
  // The marker is its own field, and only the refusal produces it.
  it("keys the skip on refused_before_run, never on executed", () => {
    expect(HANDLER).toContain("out?.refused_before_run === true) return;");
    expect(HANDLER).not.toMatch(/out\?\.executed === false\) return;/);
  });

  it("no other edge code produces the marker", () => {
    // One producer; everything else that names it only reads it: the audit skip, and the approval
    // card's outcome (approval-outcome.ts, which reports such a call as not run).
    const producers = execSync("grep -rlE 'refused_before_run: ?true' supabase/functions --include=*.ts", { encoding: "utf8" })
      .trim().split("\n").sort();
    expect(producers).toEqual(["supabase/functions/_shared/confirm-fingerprint.ts"]);
    const mentions = execSync("grep -rl 'refused_before_run' supabase/functions --include=*.ts", { encoding: "utf8" })
      .trim().split("\n").sort();
    expect(mentions).toEqual([
      "supabase/functions/_shared/approval-outcome.ts",
      "supabase/functions/_shared/confirm-fingerprint.ts",
      "supabase/functions/paige-ai-chat/index.ts",
    ]);
  });
});

describe("no refusal sends the operator to a control that is not on screen (2026-09-26)", () => {
  // After Approve the card is gone — PaigeAIChat.approvalRecovery.test.tsx drives the real surface
  // and proves it. So a note may FORBID these instructions but must never GIVE them. The general
  // gate said "approve the actions one at a time"; #1450 replaced that on the CRM door with "press
  // Not now to clear them", which was the same mistake.
  it("no note instructs 'approve one at a time' or 'press Not now'", () => {
    expect(HANDLER).not.toMatch(/they can approve (?:the actions|them) one at a time/);
    expect(HANDLER).not.toMatch(/they can press Not now/);
  });

  // Matching two phrasings let a third through: the CRM door's lookup_failed note said "they can
  // approve it again", after Approve, with the card gone (found by the §39 peer-gate on #1458). So
  // every terminal note is read whole. Only a "Do NOT …" sentence may name a control.
  const operatorNotes = [...HANDLER.matchAll(/note: "(Say this to the operator[^"]*)"/g)].map((m) => m[1]);

  it("finds every terminal note it guards", () => {
    expect(operatorNotes.length).toBeGreaterThanOrEqual(4);
  });

  it("no terminal note tells the operator to approve or press anything", () => {
    for (const note of operatorNotes) {
      expect(note.replace(/Do NOT[^.]*\./g, "")).not.toMatch(/\b(approve|press|click|tap)\b/i);
    }
  });

  it("both ambiguous terminals name the recovery that exists — asking again", () => {
    expect(HANDLER).toContain("if they still want it they can ask you again.");
    expect(HANDLER).toContain("and they can ask you again for the one they want.");
  });
});

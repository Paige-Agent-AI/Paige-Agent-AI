/**
 * The Chat CRM door's approval narrowing — wiring proof (2026-09-25).
 *
 * The edge handler `paige-ai-chat/index.ts` cannot be unit-executed (Deno + a live Supabase
 * client), so these are SOURCE-ASSERTIONS over the shipped handler — the same proof class as
 * confirm-gate-containment-wiring.test.ts. The RESOLUTION ORDER itself, which is where the defect
 * lived, is proven BEHAVIOURALLY in crm-approval-resolution.test.ts against the real shared module.
 * What is pinned here is that the door hands the right rows to that resolver, keeps every predicate
 * that bounds what is claimable, and fails closed and loudly when the lookup breaks.
 *
 * The authenticated end-to-end drive (approve a create on the live Solo chat and read the contact
 * back) is §32.c PROOF OWED against the deployed surface — recorded, not faked.
 */
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

const HANDLER = readFileSync("supabase/functions/paige-ai-chat/index.ts", "utf8");
const CRM_COMMAND = readFileSync("supabase/functions/crm-command/index.ts", "utf8");

// The door, bounded exactly: from its banner to the crm-command invocation that follows the
// approval resolution. Every assertion below therefore lands inside the narrowing block.
const doorStart = HANDLER.indexOf("// ── CANONICAL GOVERNED CRM/Pipeline DOOR");
const doorEnd = HANDLER.indexOf('await supabaseClient.functions.invoke("crm-command"', doorStart);
const door = HANDLER.slice(doorStart, doorEnd);

describe("the claimable set is never widened", () => {
  it("bounds candidates to the fingerprints the human echoed back, and to nothing else", () => {
    expect(doorStart).toBeGreaterThan(-1);
    expect(doorEnd).toBeGreaterThan(doorStart);
    // The SEARCH is on each echoed token's bare 16-hex prefix (a stored CRM fingerprint is always
    // bare; an echoed token may be scoped `fp:uuid`), exactly as the general gate does. Searching on
    // the raw token would MISS a scoped-token row, and a miss resolves to `none`, which proceeds and
    // re-proposes — the accumulate-another-card loop this change exists to end. 18.H25 pins it.
    expect(door).toContain('.in("fingerprint", [...approvedConfirmations].map((token) => token.split(":")[0]))');
    // Widening the SEARCH is not widening the CLAIM: the WHOLE token must still be in the set.
    expect(door).toContain("approvedConfirmations.has(resolved.fingerprint)");
    // There is exactly ONE approval lookup in the door — no second, unbounded "all pending for this
    // tool" query to fall back to.
    expect(door.match(/from\("paige_pending_confirmations"\)/g)).toHaveLength(1);
  });

  it("keeps every hard predicate that scopes the lookup", () => {
    for (const predicate of [
      '.eq("tenant_id", personaCtx.tenant_id)',
      '.eq("user_id", user.id)',
      '.eq("tool_name", tc.function.name)',
      '.is("thread_id", null)',
      '.is("scoped_client_id", null)',
      '.is("consumed_at", null)',
      '.not("server_issued_at", "is", null)',
      '.not("issued_in_request", "is", null)',
      '.gt("expires_at", new Date().toISOString())',
    ]) expect(door).toContain(predicate);
  });

  it("re-checks the resolved fingerprint against the approved set before claiming it", () => {
    expect(door).toContain("if (approvedConfirmations.has(resolved.fingerprint)) approvedFingerprint = resolved.fingerprint;");
  });

  it("documents WHY the general gate's same-request predicate is deliberately absent here", () => {
    // The decision must be reasoned in the source, not silently omitted: CRM proposals are minted
    // only by crm-command under ITS own per-invocation nonce, so `.neq("issued_in_request",
    // requestNonce)` could never exclude a row in this door.
    expect(door).toContain('DELIBERATELY NOT `.neq("issued_in_request", requestNonce)`');
    // And the claim it rests on is true of the shipped minter: crm-command stamps its own nonce.
    expect(CRM_COMMAND).toContain("const requestNonce = crypto.randomUUID();");
    expect(CRM_COMMAND).toContain("issued_in_request: requestNonce,");
  });
});

describe("the subject is a preference over the candidates, no longer a gate on them", () => {
  it("no longer filters the query by the model-derived approval subject", () => {
    // THE DEFECT: this SQL equality was computed from the MODEL's re-emitted arguments, so a
    // create's drifted subject returned zero rows and the approval was refused.
    expect(door).not.toContain('.filter("args->>approval_subject", "eq", approvalSubject)');
  });

  it("selects the stored args so the subject can be compared in the resolver", () => {
    expect(door).toContain('.select("fingerprint,args")');
  });

  it("delegates the resolution ORDER to the one shared, unit-tested home (§18)", () => {
    expect(HANDLER).toMatch(
      /import\s*\{[^}]*\bresolveCrmApprovedFingerprint\b[^}]*\bCRM_APPROVAL_CANDIDATE_LIMIT\b[^}]*\}\s*from\s*["']\.\.\/_shared\/crm-command\/approval-resolution\.ts["']/,
    );
    expect(door).toContain("resolveCrmApprovedFingerprint(approvedRows ?? [], approvalSubject, sameToolCallsThisTurn)");
    // Bounded like the general gate: one more than the limit, so an over-large set is detectable.
    expect(door).toContain(".limit(CRM_APPROVAL_CANDIDATE_LIMIT + 1)");
  });
});

describe("a broken lookup fails CLOSED and LOUDLY (§68)", () => {
  it("a returned error refuses and is logged, never silently swallowed", () => {
    expect(door).toMatch(/if \(approvedRowsError\) \{[\s\S]{0,400}?console\.error\("\[paige\] CRM approved-set lookup failed[\s\S]{0,400}?approvalResolutionFailed = "lookup_failed";/);
  });

  it("a THROWN error refuses and is logged too — the lookup is wrapped", () => {
    expect(door).toMatch(/\} catch \(lookupThrow\) \{[\s\S]{0,600}?console\.error\("\[paige\] CRM approved-set lookup threw[\s\S]{0,400}?approvalResolutionFailed = "lookup_failed";/);
  });

  it("both log sites carry the correlation id, so a systematic break is traceable", () => {
    expect(door.match(/correlation_id: requestNonce/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });
});

describe("the refusal tells the truth in words a person can act on (§13/§36)", () => {
  const refusal = door.slice(door.indexOf("if (approvalResolutionFailed) {"));

  it("says plainly that nothing happened", () => {
    expect(refusal).toContain("Nothing was created, changed or sent.");
  });

  it("names a recovery the interface actually offers in the state it is spoken in (§36/§70.1)", () => {
    // PaigeConfirmCard has ONE Approve button that submits every bound fingerprint at once —
    // no per-row control, no checkbox, no slice. So "approve them one at a time" instructed the
    // operator to do something the interface does not offer, then blamed them for the wall.
    //
    // CORRECTED 2026-09-26 (§13, kept rather than edited out): this test first pinned the
    // replacement "press Not now to clear them", on the reasoning that cancelConfirmations can
    // consume these rows. It can — but the card carrying Not now renders only on the LAST message,
    // pressing Approve sends a new one, and this refusal mints no card, so after Approve there is
    // no Not now on screen. PaigeAIChat.approvalRecovery.test.tsx drives the real surface and
    // proves it. The one recovery that exists in that state is asking again.
    expect(refusal).toContain("they can ask you again for the one they want");
    expect(refusal).not.toMatch(/they can press Not now/);
    expect(refusal).not.toContain("approving just one of them at a time");
    expect(refusal).toContain("Do NOT tell them to approve one at a time or to press Not now");
  });

  it("a lookup that failed after Approve names no control either — the card is gone", () => {
    // Found by the §39 peer-gate on #1458: this branch said "they can approve it again". It runs only
    // when approvals were sent, i.e. after Approve, when there is nothing left to approve.
    const lookupFailed = refusal.slice(refusal.indexOf('approvalResolutionFailed === "lookup_failed"'), refusal.indexOf('approvalResolutionFailed === "unclaimable"'));
    expect(lookupFailed).toContain("they can ask you again.");
    expect(lookupFailed).not.toMatch(/they can approve/);
    expect(lookupFailed).toContain("Do NOT tell them to approve it again or to press any button");
  });

  it("states a cause that is TRUE of the branch it fires on (§13)", () => {
    // Three causes, three messages. A shared line would have Paige assert "more than one
    // approval is waiting" on a lookup that errored, or on a single unclaimable row — the same
    // narrate-something-that-did-not-happen failure this whole change is about.
    expect(refusal).toContain('approvalResolutionFailed === "lookup_failed"');
    expect(refusal).toContain('approvalResolutionFailed === "unclaimable"');
    expect(refusal).toContain("Something went wrong on our side");
    expect(refusal).toContain("no longer matches anything I can run");
    expect(refusal).toContain("More than one approval is waiting");
  });

  it("names the change in the operator's words, not a tool key", () => {
    expect(refusal).toContain("CRM_ACTION_LABEL[action]");
    expect(refusal).not.toContain("tc.function.name");
  });

  it("carries no engineering jargon the operator would have to decode", () => {
    const message = refusal.slice(refusal.indexOf("error:"), refusal.indexOf("correlation_id:"));
    for (const jargon of ["batch", "fingerprint", "stored command", "CRM_", "confirmation"]) {
      expect(message.toLowerCase()).not.toContain(jargon.toLowerCase());
    }
  });

  it("still refuses rather than executing — nothing runs on an unresolved approval", () => {
    expect(refusal).toContain('outcome: "refused"');
    expect(refusal.indexOf("continue;")).toBeGreaterThan(-1);
  });
});

describe("relaxing the narrow cannot let model argument drift reach the write", () => {
  it("crm-command claims the STORED row and executes the decided command, not the request body", () => {
    // The atomic compare-and-set claim reads the stored args back...
    expect(CRM_COMMAND).toMatch(/\.eq\("fingerprint", body\.approved_fingerprint\)[\s\S]{0,600}?\.select\("args"\)/);
    expect(CRM_COMMAND).toContain("if (!claimError && stored) claimedArgs = stored;");
    // ...and what executes is the DECIDED command, never `body.command`.
    expect(CRM_COMMAND).toContain("const decidedCommand = object(decidedArgs?.command);");
    expect(CRM_COMMAND).toMatch(/const executionCommand = \{\s*\.\.\.decidedCommand,/);
    expect(CRM_COMMAND).toContain("_command: executionCommand,");
  });
});

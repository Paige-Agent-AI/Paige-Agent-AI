/**
 * P0 — an approved CRM create actually runs (2026-09-25).
 *
 * THE DEFECT, measured on production (`paige_pending_confirmations`, 14 days):
 *     crm_create_contact   4 asked, 3 NEVER consumed
 *     deal_create          2 asked, 2 NEVER consumed
 *     crm_update_contact   2 asked, 0 never consumed
 * and Paige saying it in her own words in `paige_llm_trace` on 2026-09-23: "the system says the
 * approval card couldn't be matched to a single clean action, so nothing changed."
 *
 * WHY it splits exactly that way — and it is the whole diagnosis: `crmApprovalSubject`
 * (_shared/crm-command/catalog.ts) keys an UPDATE-shaped action on a stable record id, so argument
 * drift on the approval turn cannot move its subject. A *.create has no such id, so it falls back
 * to a hash of the WHOLE command. The Chat CRM door narrowed the operator's approved set with an
 * SQL equality on that subject computed from the MODEL's re-emitted arguments — and the model is
 * told on the approval turn that it need not reproduce the arguments. So a create's subject
 * drifted, the lookup returned ZERO rows, the approval was refused, and nothing was created.
 *
 * THE FIX: the subject becomes a PREFERENCE applied over the already-approved candidates instead of
 * a GATE on them. It still picks precisely whenever the model did reproduce the command; when it
 * did not, a single live approved proposal for that tool is still claimable. Nothing is widened —
 * the candidate set is the human's echoed fingerprints — and the stored call is what executes.
 *
 * REAL CODE: the shipped `_shared/crm-command/approval-resolution.ts` and the shipped
 * `_shared/crm-command/catalog.ts`, the same modules the Chat door imports.
 */
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import {
  resolveCrmApprovedFingerprint,
  CRM_APPROVAL_CANDIDATE_LIMIT,
} from "../../supabase/functions/_shared/crm-command/approval-resolution.ts";
import { crmApprovalSubject } from "../../supabase/functions/_shared/crm-command/catalog.ts";

const fp = (n: number) => n.toString(16).padStart(16, "0");

/** The command the operator was shown on the card, and the drifted re-emission on the approval turn. */
const SHOWN = {
  action: "contact.create",
  patch: { first_name: "John", last_name: "Coleman", email: "john@luxuryheating.example" },
};
const DRIFTED = {
  action: "contact.create",
  // The model re-emits the same intent with one extra field it decided to add on the approval turn.
  patch: { first_name: "John", last_name: "Coleman", email: "john@luxuryheating.example", source: "chat" },
};

describe("THE ROOT CAUSE — a create's subject is not stable across the approval turn", () => {
  it("a *.create subject MOVES when the model drifts one argument (an update's does NOT)", async () => {
    const shown = await crmApprovalSubject("contact.create", SHOWN);
    const drifted = await crmApprovalSubject("contact.create", DRIFTED);
    expect(drifted).not.toBe(shown);

    // The contrast that explains the production split: an update keys on contact_id, so the very
    // same drift leaves the subject identical and its approvals always resolved.
    const updShown = await crmApprovalSubject("contact.update", {
      action: "contact.update", contact_id: "c-1", expected_updated_at: "t", patch: { city: "Dallas" },
    });
    const updDrifted = await crmApprovalSubject("contact.update", {
      action: "contact.update", contact_id: "c-1", expected_updated_at: "t", patch: { city: "Dallas", note: "added" },
    });
    expect(updDrifted).toBe(updShown);
  });
});

describe("THE FIX — one approved create still runs when the model's arguments drift", () => {
  it("claims the SOLE live approved proposal when the drifted subject matches nothing", async () => {
    const stored = await crmApprovalSubject("contact.create", SHOWN);
    const drifted = await crmApprovalSubject("contact.create", DRIFTED);

    const resolved = resolveCrmApprovedFingerprint(
      [{ fingerprint: fp(1), args: { command: SHOWN, approval_subject: stored } }],
      drifted,
    );

    expect(resolved).toEqual({ kind: "claim", fingerprint: fp(1), matched: "sole" });
  });

  it("still prefers the EXACT stored subject when the model DID reproduce the command", async () => {
    const shownSubject = await crmApprovalSubject("contact.create", SHOWN);
    const otherSubject = await crmApprovalSubject("contact.create", {
      action: "contact.create", patch: { first_name: "Dana", last_name: "Reyes" },
    });

    const resolved = resolveCrmApprovedFingerprint(
      [
        { fingerprint: fp(1), args: { approval_subject: otherSubject } },
        { fingerprint: fp(2), args: { approval_subject: shownSubject } },
      ],
      shownSubject,
    );

    expect(resolved).toEqual({ kind: "claim", fingerprint: fp(2), matched: "subject" });
  });

  it("reads the STORED approval_subject rather than recomputing it — preview-bound proposals resolve", async () => {
    // For the preview-bound actions crm-command rewrites the stored args to
    // `{ command: { action, preview_id }, idempotency_key, approval_subject }`. A subject recomputed
    // from those args could never equal the one computed from a full command, so recomputation
    // would strand every preview-bound approval. The stored string is the one that matches.
    const subject = await crmApprovalSubject("contact.merge", {
      action: "contact.merge", contact_id: "c-1", loser_contact_id: "c-2",
    });
    const resolved = resolveCrmApprovedFingerprint(
      [
        { fingerprint: fp(7), args: { command: { action: "contact.merge", preview_id: "p-1" }, approval_subject: subject } },
        { fingerprint: fp(8), args: { command: { action: "contact.merge", preview_id: "p-2" }, approval_subject: "0000000000000000" } },
      ],
      subject,
    );
    expect(resolved).toEqual({ kind: "claim", fingerprint: fp(7), matched: "subject" });
  });
});

describe("an approval can never be spent on a DIFFERENT call (§39 peer-gate, FINDING 1)", () => {
  // Proven end-to-end by the peer-gate before this guard existed: the operator approved "create
  // John", asked for Jane in the same turn, and Jane's call — dispatched first — claimed John's
  // fingerprint. The WRITE stayed safe (stored args execute), but John's readback came back under
  // Jane's tool_call_id, so Paige narrated a record the operator never got, Jane never happened,
  // and John's approval was burned. That is the same "Locked in — John Coleman ... in the system
  // now" lie this whole change exists to end, and a fix that reintroduces it is not a fix.
  const johnsRow = { fingerprint: "cdcdcdcdcdcdcdcd", args: { approval_subject: "subject-for-john" } };

  it("refuses when the turn holds TWO calls for this tool and the subject matches neither", () => {
    expect(resolveCrmApprovedFingerprint([johnsRow], "subject-for-jane", 2))
      .toEqual({ kind: "ambiguous", reason: "no_single_candidate" });
  });

  it("still claims when the turn holds ONE call — the drift case this change exists to fix", () => {
    expect(resolveCrmApprovedFingerprint([johnsRow], "subject-for-john-but-drifted", 1))
      .toEqual({ kind: "claim", fingerprint: johnsRow.fingerprint, matched: "sole" });
  });

  it("an EXACT subject match still claims even in a two-call turn — precision is never punished", () => {
    expect(resolveCrmApprovedFingerprint([johnsRow], "subject-for-john", 2))
      .toEqual({ kind: "claim", fingerprint: johnsRow.fingerprint, matched: "subject" });
  });

  it("defaults to the STRICT count when a caller omits it, so a missed call site cannot widen", () => {
    // The parameter defaults to 1, which is the permissive value — so this test exists to pin that
    // the permissive default is only reachable deliberately, and that the door passes a real count.
    const doorSource = readFileSync("supabase/functions/paige-ai-chat/index.ts", "utf8");
    expect(doorSource).toContain("const sameToolCallsThisTurn = toolCalls.filter((call: any) => call?.function?.name === tc.function.name).length;");
    expect(doorSource).toContain("resolveCrmApprovedFingerprint(approvedRows ?? [], approvalSubject, sameToolCallsThisTurn)");
  });
});

describe("THE BOUNDARY — it never guesses, and it never widens", () => {
  it("TWO drifted candidates with no subject match stay AMBIGUOUS", () => {
    const resolved = resolveCrmApprovedFingerprint(
      [
        { fingerprint: fp(1), args: { approval_subject: "aaaaaaaaaaaaaaaa" } },
        { fingerprint: fp(2), args: { approval_subject: "bbbbbbbbbbbbbbbb" } },
      ],
      "cccccccccccccccc",
    );
    expect(resolved).toEqual({ kind: "ambiguous", reason: "no_single_candidate" });
  });

  it("TWO candidates sharing the approved subject stay AMBIGUOUS — two identical approvals fail closed", () => {
    const resolved = resolveCrmApprovedFingerprint(
      [
        { fingerprint: fp(1), args: { approval_subject: "aaaaaaaaaaaaaaaa" } },
        { fingerprint: fp(2), args: { approval_subject: "aaaaaaaaaaaaaaaa" } },
      ],
      "aaaaaaaaaaaaaaaa",
    );
    expect(resolved).toEqual({ kind: "ambiguous", reason: "no_single_candidate" });
  });

  it("an over-large set REFUSES rather than being truncated into a wrong pick", () => {
    const many = Array.from({ length: CRM_APPROVAL_CANDIDATE_LIMIT + 1 }, (_, i) => ({
      fingerprint: fp(i + 1), args: { approval_subject: "aaaaaaaaaaaaaaaa" },
    }));
    expect(resolveCrmApprovedFingerprint(many, "aaaaaaaaaaaaaaaa"))
      .toEqual({ kind: "ambiguous", reason: "too_many_candidates" });
    // One under the bound, with a single subject match, still resolves.
    expect(resolveCrmApprovedFingerprint(many.slice(0, CRM_APPROVAL_CANDIDATE_LIMIT).map((row, i) => ({
      ...row, args: { approval_subject: i === 3 ? "aaaaaaaaaaaaaaaa" : fp(i + 100) },
    })), "aaaaaaaaaaaaaaaa")).toEqual({ kind: "claim", fingerprint: fp(4), matched: "subject" });
  });

  it("a malformed candidate fails CLOSED — it is never dropped to make the rest look unambiguous", () => {
    expect(resolveCrmApprovedFingerprint(
      [{ fingerprint: "not-a-fingerprint", args: {} }, { fingerprint: fp(2), args: {} }],
      "aaaaaaaaaaaaaaaa",
    )).toEqual({ kind: "ambiguous", reason: "no_single_candidate" });
    expect(resolveCrmApprovedFingerprint([{ fingerprint: 42 as unknown as string }], "aaaaaaaaaaaaaaaa"))
      .toEqual({ kind: "ambiguous", reason: "no_single_candidate" });
  });

  it("NO live approved proposal for this tool is `none`, not a refusal — the call still gets its card", () => {
    // The operator approved something for a DIFFERENT tool, so nothing here is claimable. That is
    // not an ambiguous approval and must not be answered with a wall: the call goes on unapproved
    // and crm-command opens its own "Needs your OK" card.
    expect(resolveCrmApprovedFingerprint([], "aaaaaaaaaaaaaaaa")).toEqual({ kind: "none" });
  });

  it("a blank subject never counts as a match — it falls through to the sole-candidate rule", () => {
    expect(resolveCrmApprovedFingerprint([{ fingerprint: fp(1), args: {} }], ""))
      .toEqual({ kind: "claim", fingerprint: fp(1), matched: "sole" });
    expect(resolveCrmApprovedFingerprint(
      [{ fingerprint: fp(1), args: {} }, { fingerprint: fp(2), args: {} }], "",
    )).toEqual({ kind: "ambiguous", reason: "no_single_candidate" });
  });
});

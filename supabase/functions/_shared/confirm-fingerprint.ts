// THE ONE HOME for the approval-proposal fingerprint (§18).
//
// The fingerprint is a stable hash of the EXACT call a human was shown on a "Needs your OK" card.
// It is issued with the refusal, echoed back by the surface that rendered the card, and re-derived
// when the matching arguments are about to execute. They must match, or the gate refuses again —
// that is what stops the model substituting different arguments between the proposal and the
// execution (see 20261023000000_confirmations_bind_the_approval_to_the_call.sql).
//
// Extracted from `paige-ai-chat/index.ts` (was an inline closure) so it is PURE and unit-testable:
// a regression test can prove the fingerprint is invariant to the fields it must ignore and varies
// by the fields that define the action's identity. No behavioural change for identical inputs to a
// tool with no ignored args.
//
// ── WHY AN IGNORE-SET, AND WHY IT IS NARROW (§9/§13/§39) ─────────────────────────────────────────
// The fingerprint must be a property of the ACTION a person approved, not of how the model happened
// to phrase an internal note. `confirm` is dropped on every call (it is the handshake, not the
// action). Some tools also carry a MODEL-AUTHORED FREE-TEXT field that is not a consequential
// parameter and is not what executes — e.g. `action_advance`'s `decision_rationale` ("Why, when
// dismissing"). On the approval turn the model re-emits the call (its `confirm: true` tool
// description tells it "you do not need to reproduce the other arguments exactly — the exact call
// they were read is saved and is what runs"), so it rephrases or omits that note. If the note is in
// the fingerprint, the re-derived hash DRIFTS, the card's exact-match misses, and a batch of such
// actions can never be approved — it re-proposes forever (the P0 approval loop on dismissing three
// drafts). Excluding the note stabilises the identity so an approval for the same action set is not
// defeated by rationale drift.
//
// This is SAFE precisely because the seam executes the STORED proposal arguments, never the
// model's re-emission (`tc.function.arguments = JSON.stringify(approvedArgs)`), so the rationale
// that actually runs is the turn-1 value the operator was shown — the model cannot swap it. The
// set is therefore a NARROW, PER-TOOL, REVIEWED allowlist of non-identity model free-text. It must
// NEVER carry a consequential parameter — a recipient, an amount, a body, a target id, a status —
// because those DO define what the operator approved and a drift in them MUST refuse. Adding a tool
// here is a security-relevant act: state, per entry, why the field cannot change what runs.
export const NON_IDENTITY_ARGS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  // `decision_rationale` is a human-readable note the model writes when dismissing an action. It is
  // not a parameter of the dismissal (the action_id + to_status are), it is stored but not acted on,
  // and it is exactly the field the model rephrases between proposal and approval. Excluding it lets
  // a batch dismissal's card match on re-emission. The action's identity stays in action_id +
  // to_status, which are NOT ignored.
  action_advance: ["decision_rationale"],
});

// ── THE SUBJECT-ID FOR BATCH DISAMBIGUATION (§9/§13/§39) ─────────────────────────────────────────
// When the operator approves a BATCH of same-tool proposals (e.g. dismissing several actions at
// once), the runtime must map each re-emitted tool call back to the RIGHT already-approved proposal.
// It does that exactly by `confirmFingerprint` today — which breaks the moment the model drifts any
// hashed arg on the approval turn (its confirm-turn instructions tell it it need not reproduce the
// arguments), collapsing the batch into an un-disambiguatable set that re-proposes forever (the P0
// approval loop on dismissing several drafts; #1166 closed only the `decision_rationale` drift).
//
// The fix pins the mapping to the ONE field the model reproduces verbatim across the turn: a
// REQUIRED, STABLE subject id (for `action_advance`, the `paige_actions` id it moves). This is used
// ONLY to pick which of the operator's ALREADY-APPROVED proposals this re-emitted call corresponds
// to. It never widens WHICH proposals are claimable — that stays the operator's echoed fingerprint
// set — and the STORED proposal arguments are what execute, so a drift never reaches the write.
//
// Membership is security-relevant, like NON_IDENTITY_ARGS and TOOL_IDENTITY_FIELDS: the field MUST
// be (a) required, so it is always present to map on; (b) a stable identifier the model reproduces,
// not model-authored content; and (c) unable to change WHICH action runs on its own (the full
// identity — e.g. action_id + to_status — still lives in the approved proposal's stored args, and
// two approved proposals that share a subject but differ in effect stay ambiguous and refuse). State,
// per entry, why the field satisfies all three.
export const CONFIRM_IDENTITY_KEY: Readonly<Record<string, string>> = Object.freeze({
  // action_advance.action_id: REQUIRED in the tool schema; it is the opaque paige_actions id the
  // operator's card was about, which the model carries verbatim (it is the subject it is acting on,
  // unlike draft_content / decision_rationale, which it re-authors). It cannot change which action
  // runs on its own — the effect (to_status) is part of the stored proposal that executes, and two
  // approved proposals for the same action_id with different to_status stay ambiguous and refuse.
  action_advance: "action_id",
});

/**
 * The stable subject id of a call, for batch disambiguation — or null when the tool has no identity
 * key or the field is absent/non-string/blank. Read from the request-body call; used only to narrow
 * WITHIN the operator's already-approved proposal set, never to widen it.
 */
export function confirmIdentityValue(tool: string, args: Record<string, unknown>): string | null {
  const key = CONFIRM_IDENTITY_KEY[tool];
  if (!key) return null;
  const v = (args ?? {})[key];
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

// "The model carries it verbatim" (above) was the assumption, and production disproved it. On
// 2026-09-13, with the fingerprint stable again, Paige shortened the ids in her own prose — "dismiss
// action 424b85ac" — sent the PREFIX back as `action_id`, and the operator approved. The approval was
// claimed; `advance_action(p_action_id uuid, ...)` then cast the prefix and failed 22P02 on an
// approval already spent. The three actions are still `pending_approval`: 13 proposals, 0 dismissals.
//
// So every id a tool hands to a typed executor declares the SHAPE the executor accepts, and a call
// whose id does not fit is refused before it can become an approval card — while there is still
// nothing to lose. That means every model-supplied id the executor casts, not only the subject
// (`advance_action` also casts `invocation_id`), and an ABSENT required id as much as a malformed
// one: tool calling is not strict, so a missing field reaches the handler, and the executor fails on
// it after the claim exactly as it fails on a prefix. Each shape is MEASURED against what the
// executor accepts, never a guess at what the value "looks like": looser than the database is this
// incident; stricter is a wall Paige cannot explain. An identity key that is not a required, shaped
// field here fails confirm-fingerprint.test.ts.

/**
 * Postgres's `uuid` input: upper or lower hex, one pair of braces, and a hyphen after any group of
 * four digits. It refuses whitespace, a prefix, a stray or doubled hyphen, and any other length.
 * Measured on production 2026-09-26 with `pg_input_is_valid(value, 'uuid')`; every row is pinned in
 * the test.
 */
export const UUID_INPUT_SHAPE = /^(?:[0-9a-f]{4}(?:-?[0-9a-f]{4}){7}|\{[0-9a-f]{4}(?:-?[0-9a-f]{4}){7}\})$/i;

export type ConfirmArgShape = Readonly<{ shape: RegExp; required: boolean }>;

export const CONFIRM_ARG_SHAPES: Readonly<Record<string, Readonly<Record<string, ConfirmArgShape>>>> = Object.freeze({
  // advance_action(p_action_id uuid, ..., p_invocation_id uuid DEFAULT NULL, ...) —
  // 20260804140000_advance_action_address_scope_guard.sql. The chat passes it no other model-supplied
  // uuid; its remaining model-supplied arguments are text or jsonb, which accept any string or JSON
  // value, so they cannot fail a cast.
  action_advance: Object.freeze({
    action_id: Object.freeze({ shape: UUID_INPUT_SHAPE, required: true }),
    invocation_id: Object.freeze({ shape: UUID_INPUT_SHAPE, required: false }),
  }),
});

export type ConfirmArgProblem = Readonly<{ field: string; required: boolean; problem: "missing" | "malformed" }>;

/**
 * The first id in this call the executor cannot address, or null when every declared id fits. A
 * required id that is absent, null or blank is "missing"; any other value that is not a string of the
 * declared shape — a prefix, a typo, a trailing space, a number — is "malformed". An optional id may
 * be absent or null, but one that is present must fit, because the executor casts whatever it is
 * given, an empty string included. Tests the exact value the executor would receive, untrimmed,
 * because that is what it would cast.
 */
export function unaddressableConfirmArgs(tool: string, args: Record<string, unknown>): ConfirmArgProblem | null {
  const fields = CONFIRM_ARG_SHAPES[tool];
  if (!fields) return null;
  for (const [field, { shape, required }] of Object.entries(fields)) {
    const v = (args ?? {})[field];
    if (v === undefined || v === null) {
      if (required) return { field, required, problem: "missing" };
      continue;
    }
    if (required && typeof v === "string" && v.trim() === "") return { field, required, problem: "missing" };
    if (typeof v !== "string" || !shape.test(v)) return { field, required, problem: "malformed" };
  }
  return null;
}

/**
 * What the model is told when an id is refused. One home, because two doors refuse it — the confirm
 * gate before a card is minted, and dispatch for the lanes that never pass the gate — and the
 * operator must hear the same thing from both. The doors differ in one fact: at the proposal door
 * nothing has been proposed yet, while at dispatch an approval may already have been spent (a card
 * minted before this check existed), so that note never claims no card was made. Nothing is echoed
 * back: the value is the model's own output. `refused_before_run` tells the write trail this was never
 * an execution attempt (auditWriteForTool records attempts, not refusals). It is its own field on
 * purpose: `executed: false` already means something else — n8n management writes return it for a
 * write that happened without a workflow run — and those must stay on the trail.
 */
export function unaddressableArgsRefusal(
  problem: ConfirmArgProblem,
  door: "proposal" | "dispatch",
): { success: false; refused_before_run: true; error: "id_not_addressable"; field: string; note: string } {
  const { field, required } = problem;
  const lead = door === "proposal"
    ? "Nothing was proposed or changed, and no approval card was made."
    : "Nothing was changed.";
  const what = problem.problem === "missing"
    ? `You did not send ${field}, and this tool cannot run without it.`
    : `The ${field} you sent is not a complete id, so it cannot be used.`;
  const fix = required
    ? "Read the item again to get its complete id (for an action, call action_list, for example with status 'pending_approval'), then call this tool again with that id exactly as listed. Never shorten or retype an id inside a tool call, even when you shorten it for the operator."
    : `Call this tool again with the complete ${field}, exactly as it was returned to you, or leave ${field} out.`;
  const after = door === "proposal"
    ? "If you cannot find the complete id, tell the operator in one plain line that you could not find that item and that nothing was changed."
    : "If you cannot find the complete id, or the operator had already approved this, tell them in one plain line that it could not run, that nothing changed, and that they can ask you again.";
  return { success: false, refused_before_run: true, error: "id_not_addressable", field, note: `${lead} ${what} ${fix} ${after}` };
}

/**
 * A stable 16-hex-char fingerprint of `(tool, args)`. Keys are sorted, `confirm` is always dropped,
 * and any per-tool non-identity free-text (NON_IDENTITY_ARGS) is dropped — at every nesting level,
 * which is harmless because those fields only appear at the top level. Everything else — every
 * consequential parameter — is part of the hash, so a changed recipient/amount/target refuses.
 */
export async function confirmFingerprint(
  tool: string,
  args: Record<string, unknown>,
): Promise<string> {
  const ignored = new Set<string>(["confirm", ...(NON_IDENTITY_ARGS[tool] ?? [])]);
  const stable = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(stable);
    if (v && typeof v === "object") {
      return Object.fromEntries(
        Object.keys(v as Record<string, unknown>).sort()
          .filter((k) => !ignored.has(k))
          .map((k) => [k, stable((v as Record<string, unknown>)[k])]),
      );
    }
    return v;
  };
  const bytes = new TextEncoder().encode(`${tool}\u0000${JSON.stringify(stable(args))}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Approval-fingerprint stability — the P0 approval-loop regression (dismissing a batch of drafts).
 *
 * THE DEFECT: `confirmFingerprint` hashed every arg except `confirm`, so it included the
 * model-authored `decision_rationale` note on `action_advance`. On the approval turn the model
 * re-emits the dismissal with a rephrased/omitted rationale (its own tool description tells it "you
 * do not need to reproduce the other arguments exactly"), so the re-derived fingerprint DRIFTED, the
 * card's exact-match missed, and a batch of 3 dismissals could never be approved — it re-proposed a
 * fresh card forever.
 *
 * THE FIX: a narrow, per-tool, reviewed NON_IDENTITY_ARGS allowlist drops such non-identity free-text
 * from the hash (the way `confirm` is dropped). The action's IDENTITY — action_id + to_status — stays
 * in the hash, so a changed target or status still refuses. These assertions pin both halves.
 *
 * REAL CODE: the shipped `_shared/confirm-fingerprint.ts`, the same module the Chat gate imports.
 */
import { describe, it, expect } from "vitest";
import {
  confirmFingerprint,
  NON_IDENTITY_ARGS,
  CONFIRM_IDENTITY_KEY,
  CONFIRM_ARG_SHAPES,
  UUID_INPUT_SHAPE,
  confirmIdentityValue,
  unaddressableConfirmArgs,
  unaddressableArgsRefusal,
} from "../../supabase/functions/_shared/confirm-fingerprint.ts";

const dismiss = (over: Record<string, unknown> = {}) => ({
  action_id: "424b85ac", to_status: "dismissed", ...over,
});

describe("the fingerprint is invariant to non-identity model free-text (the loop fix)", () => {
  it("is identical whether decision_rationale is present, absent, or reworded", async () => {
    const withNote = await confirmFingerprint("action_advance", dismiss({ decision_rationale: "owner asked to clear these" }));
    const noNote = await confirmFingerprint("action_advance", dismiss());
    const reworded = await confirmFingerprint("action_advance", dismiss({ decision_rationale: "clearing per the owner" }));
    expect(withNote).toBe(noNote);
    expect(reworded).toBe(noNote);
  });

  it("still drops `confirm` (the handshake), so the approval turn matches the proposal turn", async () => {
    const proposed = await confirmFingerprint("action_advance", dismiss());
    const approved = await confirmFingerprint("action_advance", dismiss({ confirm: true }));
    expect(approved).toBe(proposed);
  });

  it("the whole batch: each of the 3 dismissals keeps a stable identity across rationale drift", async () => {
    // The exact scenario from the P0: dismiss 424b85ac / 61a7cf78 / 45191f24.
    for (const id of ["424b85ac", "61a7cf78", "45191f24"]) {
      const turn1 = await confirmFingerprint("action_advance", dismiss({ action_id: id, decision_rationale: "first phrasing" }));
      const turn2 = await confirmFingerprint("action_advance", dismiss({ action_id: id, confirm: true, decision_rationale: "" }));
      expect(turn2, `action ${id} must re-derive the same fingerprint on the approval turn`).toBe(turn1);
    }
  });
});

describe("the fingerprint still VARIES by the fields that define the action's identity", () => {
  it("differs per action_id — three dismissals are three distinct fingerprints, never one", async () => {
    const fps = await Promise.all(
      ["424b85ac", "61a7cf78", "45191f24"].map((id) => confirmFingerprint("action_advance", dismiss({ action_id: id }))),
    );
    expect(new Set(fps).size).toBe(3);
  });

  it("differs when to_status changes (dismiss vs execute is not the same approved action)", async () => {
    const dismissed = await confirmFingerprint("action_advance", dismiss({ to_status: "dismissed" }));
    const executing = await confirmFingerprint("action_advance", dismiss({ to_status: "executing" }));
    expect(executing).not.toBe(dismissed);
  });
});

describe("the ignore-set is NARROW — it never swallows a consequential parameter", () => {
  it("only action_advance is listed, and only for decision_rationale", () => {
    expect(Object.keys(NON_IDENTITY_ARGS)).toEqual(["action_advance"]);
    expect(NON_IDENTITY_ARGS.action_advance).toEqual(["decision_rationale"]);
  });

  it("a tool with no ignore-set hashes ALL its args (a drifting field there correctly refuses)", async () => {
    // crm_create_contact has no NON_IDENTITY_ARGS entry, so every field it carries is identity.
    const a = await confirmFingerprint("crm_create_contact", { first_name: "A", email: "a@example.com" });
    const b = await confirmFingerprint("crm_create_contact", { first_name: "A", email: "B@example.com" });
    expect(b).not.toBe(a); // a changed email MUST change the fingerprint → the card re-confirms
  });

  it("decision_rationale is NOT ignored for a tool that is not on the list", async () => {
    // Proves the exclusion is keyed per-tool, not a blanket 'drop decision_rationale everywhere'.
    const x = await confirmFingerprint("some_other_tool", { action_id: "z", decision_rationale: "one" });
    const y = await confirmFingerprint("some_other_tool", { action_id: "z", decision_rationale: "two" });
    expect(y).not.toBe(x);
  });
});

describe("the batch-disambiguation subject id (FIX A — P0 confirm loop on a batch)", () => {
  // When the operator approves a BATCH, the gate maps each re-emitted call to the RIGHT already-
  // approved proposal by this stable subject id (not by the drift-prone full-arg fingerprint). The
  // map is used ONLY to narrow within the operator's echoed fingerprint set; it never widens what is
  // claimable, and the STORED proposal args are what run. These pin the pure primitive the gate uses.
  it("the map is NARROW — only action_advance, keyed on its required action_id", () => {
    expect(Object.keys(CONFIRM_IDENTITY_KEY)).toEqual(["action_advance"]);
    expect(CONFIRM_IDENTITY_KEY.action_advance).toBe("action_id");
  });

  it("extracts the action_id the model reproduces verbatim across the approval turn", () => {
    expect(confirmIdentityValue("action_advance", { action_id: "424b85ac", to_status: "dismissed" })).toBe("424b85ac");
    // decision_rationale drift does not affect the subject id.
    expect(confirmIdentityValue("action_advance", { action_id: "424b85ac", decision_rationale: "reworded" })).toBe("424b85ac");
  });

  it("returns null for a tool with no identity key — those keep the exactly-one-in-set behaviour", () => {
    expect(confirmIdentityValue("crm_create_contact", { first_name: "A" })).toBeNull();
    expect(confirmIdentityValue("improvement_propose", { kind: "policy", target_ref: "x" })).toBeNull();
  });

  it("returns null for a missing / blank / non-string subject (never a distinct empty identity)", () => {
    expect(confirmIdentityValue("action_advance", { to_status: "dismissed" })).toBeNull();
    expect(confirmIdentityValue("action_advance", { action_id: "" })).toBeNull();
    expect(confirmIdentityValue("action_advance", { action_id: "   " })).toBeNull();
    expect(confirmIdentityValue("action_advance", { action_id: 123 as unknown as string })).toBeNull();
    expect(confirmIdentityValue("action_advance", {})).toBeNull();
  });

  it("distinct actions yield distinct subjects, so a batch maps each call to its OWN proposal", () => {
    const ids = ["424b85ac", "61a7cf78", "45191f24"];
    const subjects = ids.map((id) => confirmIdentityValue("action_advance", { action_id: id, to_status: "dismissed" }));
    expect(new Set(subjects).size).toBe(3);
    expect(subjects).toEqual(ids);
  });
});

/**
 * THE SECOND HALF OF THE P0, which the fingerprint fix above could not reach.
 *
 * 2026-09-13, production. With the fingerprint stable again, Paige shortened the action ids in her
 * own prose ("dismiss action 424b85ac"), sent the PREFIX back as `action_id`, and the operator
 * approved. The approval was claimed; `advance_action(p_action_id uuid, ...)` then cast "424b85ac"
 * and failed 22P02 on an approval already spent. All three actions are still `pending_approval`.
 * Measured: 13 proposals, 0 dismissals.
 *
 * So a subject the executor cannot address must never become an approval card. The table below is
 * NOT a guess at what a UUID looks like: every row was measured on production on 2026-09-26 with
 * `pg_input_is_valid(value, 'uuid')`, using synthetic values only. The shape may never be LOOSER
 * than the database — that is the incident — and never STRICTER, which would be a wall Paige cannot
 * explain.
 */
describe("every id the executor casts must be one it can address (the shortened-id half of the P0)", () => {
  const MEASURED_ON_PROD: Array<[string, string, boolean]> = [
    ["standard", "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11", true],
    ["upper-case", "A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11", true],
    ["braces", "{a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11}", true],
    ["no hyphens", "a0eebc999c0b4ef8bb6d6bb9bd380a11", true],
    ["a hyphen after every four", "a0ee-bc99-9c0b-4ef8-bb6d-6bb9-bd38-0a11", true],
    ["leading space", " a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11", false],
    ["trailing space", "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11 ", false],
    ["unbalanced brace", "{a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11", false],
    ["an 8-character prefix", "a0eebc99", false],
    ["31 hex digits", "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a1", false],
    ["33 hex digits", "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a111", false],
    ["a hyphen after three", "a0e-ebc99-9c0b-4ef8-bb6d-6bb9bd380a11", false],
    ["a trailing hyphen", "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11-", false],
    ["a leading hyphen", "-a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11", false],
    ["a double hyphen", "a0eebc99--9c0b-4ef8-bb6d-6bb9bd380a11", false],
    ["a non-hex digit", "g0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11", false],
  ];

  it.each(MEASURED_ON_PROD)("%s — agrees with what production's uuid input accepts", (_label, value, dbAccepts) => {
    expect(UUID_INPUT_SHAPE.test(value)).toBe(dbAccepts);
    expect(unaddressableConfirmArgs("action_advance", { action_id: value, to_status: "dismissed" }))
      .toEqual(dbAccepts ? null : { field: "action_id", required: true, problem: "malformed" });
  });

  it("refuses the exact value the operator approved on 2026-09-13", () => {
    expect(unaddressableConfirmArgs("action_advance", { action_id: "424b85ac", to_status: "dismissed" }))
      .toEqual({ field: "action_id", required: true, problem: "malformed" });
  });

  it("never blocks a tool that declares no id shapes", () => {
    expect(unaddressableConfirmArgs("crm_create_contact", { first_name: "A" })).toBeNull();
    expect(unaddressableConfirmArgs("improvement_propose", { kind: "policy", target_ref: "x" })).toBeNull();
  });

  // The first version of this check passed a missing subject through, to "the required-field path".
  // There is no such path: the §39 peer-gate on #1458 drove each value below through the real handler,
  // and every one became a card, spent its approval, and then failed at the executor.
  it("refuses a MISSING, null, blank or non-string subject, because the executor fails on those after the claim too", () => {
    for (const args of [{ to_status: "dismissed" }, { action_id: null }, { action_id: "" }, { action_id: "   " }]) {
      expect(unaddressableConfirmArgs("action_advance", args)).toEqual({ field: "action_id", required: true, problem: "missing" });
    }
    expect(unaddressableConfirmArgs("action_advance", { action_id: 424 }))
      .toEqual({ field: "action_id", required: true, problem: "malformed" });
  });

  it("checks invocation_id too: it may be left out, but one that is sent must be a complete id", () => {
    const whole = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
    expect(unaddressableConfirmArgs("action_advance", { action_id: whole })).toBeNull();
    expect(unaddressableConfirmArgs("action_advance", { action_id: whole, invocation_id: null })).toBeNull();
    expect(unaddressableConfirmArgs("action_advance", { action_id: whole, invocation_id: whole })).toBeNull();
    for (const bad of ["3f2a91c0", "", " ", 7]) {
      expect(unaddressableConfirmArgs("action_advance", { action_id: whole, invocation_id: bad }))
        .toEqual({ field: "invocation_id", required: false, problem: "malformed" });
    }
  });

  it("every identity KEY is a required, shaped id — a key without a shape is this incident waiting", () => {
    for (const [tool, key] of Object.entries(CONFIRM_IDENTITY_KEY)) {
      expect(CONFIRM_ARG_SHAPES[tool]?.[key]?.required).toBe(true);
      expect(CONFIRM_ARG_SHAPES[tool]?.[key]?.shape).toBeInstanceOf(RegExp);
    }
  });
});

describe("the refusal says what is true at the door that refuses it", () => {
  const malformed = { field: "action_id", required: true, problem: "malformed" } as const;
  const missing = { field: "action_id", required: true, problem: "missing" } as const;
  const optional = { field: "invocation_id", required: false, problem: "malformed" } as const;
  const doors = ["proposal", "dispatch"] as const;

  it("marks itself refused before it ran, so the write trail does not record it as a failed write", () => {
    for (const door of doors) {
      for (const p of [malformed, missing, optional]) {
        expect(unaddressableArgsRefusal(p, door)).toMatchObject({ success: false, refused_before_run: true, error: "id_not_addressable", field: p.field });
      }
    }
  });

  it("says no card was made only at the door where that is true", () => {
    expect(unaddressableArgsRefusal(malformed, "proposal").note).toMatch(/no approval card was made/);
    expect(unaddressableArgsRefusal(malformed, "dispatch").note).not.toMatch(/no approval card was made/);
    expect(unaddressableArgsRefusal(malformed, "dispatch").note).toMatch(/already approved this/);
  });

  it("names the problem it found: nothing sent is not an incomplete id, and a typo is not 'shortened'", () => {
    expect(unaddressableArgsRefusal(missing, "proposal").note).toMatch(/You did not send action_id/);
    expect(unaddressableArgsRefusal(missing, "proposal").note).not.toMatch(/not a complete id/);
    expect(unaddressableArgsRefusal(malformed, "proposal").note).toMatch(/is not a complete id/);
    for (const door of doors) {
      for (const p of [malformed, missing, optional]) expect(unaddressableArgsRefusal(p, door).note).not.toMatch(/looks shortened/);
    }
  });

  it("lets an optional id simply be left out", () => {
    expect(unaddressableArgsRefusal(optional, "proposal").note).toMatch(/or leave invocation_id out/);
  });

  it("never sends the operator to a control; the one recovery it names is asking again", () => {
    for (const door of doors) {
      for (const p of [malformed, missing, optional]) {
        expect(unaddressableArgsRefusal(p, door).note).not.toMatch(/\b(press|click|tap|button)\b|approve (it|them|one)/i);
      }
    }
    expect(unaddressableArgsRefusal(malformed, "dispatch").note).toMatch(/they can ask you again/);
  });
});

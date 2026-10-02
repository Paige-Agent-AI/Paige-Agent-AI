/**
 * The spine's prop seam — the shapes a real read hands the chrome.
 *
 * THIS FILE DECLARES NO DATA. Every type here is a hole the wiring round fills from a real
 * source; the pack's own values for these shapes (its transcript, its `Memory 5`, its `4/7`,
 * its `7c11`/`b204`, its `Thought for 4s`) are FIXTURES and are not in this repo. What IS
 * ported is the SHAPE they occupy, so the day the chat engine lands the component tree does
 * not change — only these props stop being `undefined`.
 *
 * §18 — the platform already has a Paige chat engine. Nothing in this file is a chat engine,
 * a thread store, a streaming client or a send path. `SpineTurn` is a rendering contract: the
 * caller owns threads, messages, streaming and every callback.
 *
 * Pack: `docs/design-references/cd-packs/super-admin-shell-v3/PAIGE Super Admin Shell v3.dc.html`
 *   spine markup            L3821–L4186
 *   `spineFaces`            L10365–L10372
 *   `trustVals` / `LV`      L4577–L4664
 *   `transcript` shape      L10691–L10714 (its CONTENT is fixture), styles L11084–L11135
 *   `composerVals`          L10501–L10575
 *   `tools`                 L5253–L5264
 */

/** The pack's five faces, in the pack's order (L10365–L10372). */
export type SpineFaceId = "chat" | "memory" | "team" | "sandbox" | "code";

/**
 * The command state the header's sub-label reads (`paigeStateLabel`, L11073). It is a real
 * session state, never a decoration — with no state the label is omitted rather than guessed.
 */
export type SpineCommandState = "rest" | "focus" | "listening" | "understanding" | "executed";

/** The Trust Compass ladder, `LV` at L4578–L4584. Five rungs, index 0–4. */
export type SpineTrustLevel = 0 | 1 | 2 | 3 | 4;

/**
 * The ceiling, read from the real autonomy record. `tally` is the four-way count the compass
 * line reports (autonomous · ask first · draft only · held, L10651–L10653); absent means the
 * count is not wired and the line is omitted rather than invented (§13).
 */
export type SpineTrust = {
  readonly level: SpineTrustLevel;
  readonly tally?: readonly [number, number, number, number] | null;
  readonly onPick?: (level: SpineTrustLevel) => void;
  /** `openTrust` (L4620) — opens the full Trust Compass panel. */
  readonly onOpenPanel?: () => void;
};

/** `t.tone` (L10717/L10718) — the two toned turns the pack draws. */
export type SpineTurnTone = "negative" | "gold";

/** One option on a decision block (`t.ask`, L10707–L10711). */
export type SpineAskOption = {
  readonly label: string;
  readonly note: string;
};

/**
 * One turn in the transcript. Every field is supplied by the caller from a real message; the
 * component decides only how it is set.
 */
export type SpineTurn = {
  readonly id: string;
  /** `t.who` — the speaker line above the body. */
  readonly who: string;
  readonly body?: string | null;
  /** `t.mine` — the operator's own turn takes the UI face and the left rail. */
  readonly mine?: boolean;
  readonly tone?: SpineTurnTone;
  /** `t.trace` — her working, one line per step. */
  readonly trace?: readonly string[] | null;
  /** `t.took` — how long she thought. A real duration or nothing; never a stand-in. */
  readonly took?: string | null;
  /** `t.live` — the trace is still arriving, so it stays open and reads "Thinking". */
  readonly live?: boolean;
  /** `t.streaming` — text is still arriving, so the caret blinks. */
  readonly streaming?: boolean;
  readonly ask?: readonly SpineAskOption[] | null;
  readonly askNote?: string | null;
  readonly askFoot?: string | null;
  /** Which option the operator already picked, if any. */
  readonly answered?: string | null;
  readonly onAnswer?: (option: SpineAskOption) => void;
  /**
   * The exact things an act covers, one line each — what the operator is agreeing to.
   *
   * NOT A PACK KEY, and it is CC's design decision rather than a port (§00, 2026-09-22: the pack
   * is reference, not authority). v3 draws no confirm card at all — `Needs your OK` and
   * `fingerprint` are both 0 hits across its 11,358 lines — so N summaries had no drawn home:
   * `body` is a single `<p>` with no `whiteSpace`, which renders joined summaries as a run-on,
   * and `trace` hides them behind a collapsed disclosure, which is a §70 failure for the very
   * thing being approved. This reuses the ask row's own typography as a NON-INTERACTIVE list.
   *
   * Absent → the act row is drawn alone, exactly as the pack has it (L4180–L4185).
   */
  readonly actItems?: readonly string[] | null;
  /** `t.act` — the act label on a turn that carries one. */
  readonly act?: string | null;
  readonly onAct?: () => void;
  readonly onDismiss?: () => void;
};

/**
 * `showPresence` / `presenceText` (L11137–L11147). Three real states, never a claim: she is
 * either reading you, listening, or working. Absent → the block does not render.
 */
export type SpinePresence = {
  /** The operator is mid-sentence in the composer. */
  readonly writing: boolean;
  /** Something is actually running. */
  readonly running: boolean;
  /** The mic is open. */
  readonly listening: boolean;
};

/** One row of the sigil picker (`pickerItems`, L10553–L10561). */
export type SpinePickerItem = {
  readonly label: string;
  readonly note: string;
  /** The grant this row would run at, already clamped by the caller to the ceiling. */
  readonly tag: string;
  /** No substrate behind it — the pack dims the row rather than hiding it. */
  readonly dead?: boolean;
};

/** A directive chip the operator has staked (`directives`, L10564–L10571). */
export type SpineDirective = {
  readonly id: string;
  readonly label: string;
  readonly dead?: boolean;
};

/** The three sigils the composer understands (L10549). */
export type SpineSigil = "@" | "/" | "#";

// Experience 04 E4-S3 PR-0 — the Sales engagement and signature words, in ONE module, moved verbatim
// from sales-ops.tsx so the Sales workspace and the client record (Track D) read the same labels.

/**
 * Five states and a sixth READING. There is no `paid`, `invoiced` or `delivered`, because this
 * record can observe none of them — it holds what was agreed, never what happened afterwards.
 *
 * This is the ENGAGEMENT's state: whether the work is running, paused or finished. It is NOT the
 * signature's state, and since the owner's 2026-09-22 ruling the two are kept apart on purpose —
 * see `SIGNATURE_STATE` below.
 */
export const AGREEMENT_STATE: Record<string, { label: string; tone: string }> = {
  draft: { label: "Draft", tone: "opportunity" },
  active: { label: "Active", tone: "ok" },
  paused: { label: "Paused", tone: "warn" },
  completed: { label: "Completed", tone: "n" },
  cancelled: { label: "Cancelled", tone: "n" },
  unrecognised: { label: "Not readable", tone: "n" },
};

/**
 * The SIGNATURE's state — a different fact from the engagement's, and the owner ruled they must
 * never be merged: a document can be signed while the work has not started, and the work can be
 * running under a document nobody ever countersigned.
 *
 * There is no `Signed` separate from `Completed`. With one signer the two cannot be told apart, so
 * carrying both would put a word on the screen that nothing in the record could distinguish (§13).
 * `Expired` is DERIVED by the adapter from the state plus the clock, because nothing in this build
 * walks the table to flip it — see `useSoloAgreementSignings.displayState`.
 *
 * `none` is not a stored value either: it is what a commercial record with no document says, and
 * saying "Draft" there would claim a document exists.
 */
export const SIGNATURE_STATE: Record<string, { label: string; tone: string }> = {
  none: { label: "No document", tone: "n" },
  draft: { label: "Not sent", tone: "opportunity" },
  sent: { label: "Sent", tone: "warn" },
  viewed: { label: "Opened", tone: "warn" },
  partially_signed: { label: "Partly signed", tone: "warn" },
  completed: { label: "Completed", tone: "ok" },
  declined: { label: "Declined", tone: "bad" },
  voided: { label: "Stopped", tone: "n" },
  expired: { label: "Link expired", tone: "bad" },
  unrecognised: { label: "Not readable", tone: "n" },
};

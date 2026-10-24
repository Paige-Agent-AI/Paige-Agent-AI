// EXP07 row 1 — the structured part of a creative brief. The Studio home composer keeps the owner's
// own words as the job; these optional fields add what a brief needs to be reusable later (who it's
// for, what should happen next, where it runs, what gets made, what it may cost, what to look at).
// They compose INTO the ordinary seed brief text — one stored value, no second store — so the chat,
// the project's saved brief and every later reader see the same thing.

export interface BriefDetails {
  audience: string;
  outcome: string;
  channel: string;
  deliverables: string;
  budget: string;
  references: string;
}

export const EMPTY_BRIEF_DETAILS: BriefDetails = { audience: "", outcome: "", channel: "", deliverables: "", budget: "", references: "" };

/** Display order is the compose order: who → why → where → what → cost → sources. */
export const BRIEF_FIELDS: ReadonlyArray<{ key: keyof BriefDetails; label: string; placeholder: string }> = [
  { key: "audience", label: "Audience", placeholder: "Who this is for — e.g. solo consultants planning a workshop" },
  { key: "outcome", label: "Outcome", placeholder: "What should happen next — e.g. bookings for the April session" },
  { key: "channel", label: "Channel", placeholder: "Where it runs — e.g. email and LinkedIn" },
  { key: "deliverables", label: "Deliverables", placeholder: "What to make — e.g. one page and three posts" },
  { key: "budget", label: "Budget", placeholder: "What it may cost, if that matters" },
  { key: "references", label: "References", placeholder: "Links or examples to work from" },
];

/** The stored form of a brief: the owner's words, then each filled detail on its own labeled line.
 *  Empty details change nothing — the brief is exactly the job text, as it was before this existed. */
export function composeBrief(job: string, details: BriefDetails): string {
  const head = job.trim();
  const lines = BRIEF_FIELDS
    .map(({ key, label }) => ({ label, value: details[key].trim() }))
    .filter((f) => f.value.length > 0)
    .map((f) => `${f.label}: ${f.value}`);
  if (lines.length === 0) return head;
  return `${head}\n\nBrief details:\n${lines.join("\n")}`;
}

/** Whether any detail field holds text (the composer's toggle can say "details added"). */
export function hasBriefDetails(details: BriefDetails): boolean {
  return BRIEF_FIELDS.some(({ key }) => details[key].trim().length > 0);
}

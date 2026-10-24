import { describe, expect, it } from "vitest";
import { BRIEF_FIELDS, EMPTY_BRIEF_DETAILS, composeBrief, hasBriefDetails, type BriefDetails } from "./brief-fields";

const d = (patch: Partial<BriefDetails>): BriefDetails => ({ ...EMPTY_BRIEF_DETAILS, ...patch });

describe("brief-fields (EXP07 row 1)", () => {
  it("no details filled: the brief is exactly the job text, unchanged", () => {
    expect(composeBrief("An intake form for new clients", EMPTY_BRIEF_DETAILS)).toBe("An intake form for new clients");
  });

  it("filled details compose as labeled lines under the job, in display order", () => {
    const out = composeBrief("A landing page for my referral workshop", d({
      audience: "Solo consultants",
      outcome: "Bookings for the April session",
      channel: "Email and LinkedIn",
    }));
    expect(out).toBe(
      "A landing page for my referral workshop\n\nBrief details:\nAudience: Solo consultants\nOutcome: Bookings for the April session\nChannel: Email and LinkedIn",
    );
  });

  it("empty and whitespace-only fields are skipped, values are trimmed", () => {
    const out = composeBrief("A page", d({ audience: "  Coaches  ", outcome: "   ", budget: "\t\n" }));
    expect(out).toBe("A page\n\nBrief details:\nAudience: Coaches");
    expect(out).not.toContain("Outcome");
    expect(out).not.toContain("Budget");
  });

  it("every declared field is composed when filled, in the declared order", () => {
    const all = Object.fromEntries(BRIEF_FIELDS.map(({ key }) => [key, key])) as unknown as BriefDetails;
    const out = composeBrief("Job", all);
    expect(out.slice(out.indexOf("Brief details:"))).toBe(
      "Brief details:\n" + BRIEF_FIELDS.map(({ key, label }) => `${label}: ${key}`).join("\n"),
    );
  });

  it("hasBriefDetails is true only when a field holds text", () => {
    expect(hasBriefDetails(EMPTY_BRIEF_DETAILS)).toBe(false);
    expect(hasBriefDetails(d({ references: " " }))).toBe(false);
    expect(hasBriefDetails(d({ budget: "Nothing paid" }))).toBe(true);
  });

  it("a multiline job keeps its own newlines; the details block follows blank-line separated", () => {
    const out = composeBrief("A page\nwith two lines", d({ audience: "Coaches" }));
    expect(out).toBe("A page\nwith two lines\n\nBrief details:\nAudience: Coaches");
  });
});

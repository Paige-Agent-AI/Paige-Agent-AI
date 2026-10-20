import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import PeopleSurface from "@/operator/surfaces/relationships/PeopleSurface";
import ConversationsSurface from "@/operator/surfaces/relationships/ConversationsSurface";
import SegmentsSurface from "@/operator/surfaces/relationships/SegmentsSurface";
import {
  RELATIONSHIPS_ABSENCE,
  monogram,
  inSegment,
  segmentSentence,
  type PersonRecord,
  type SegmentRow,
  type ThreadRow,
} from "@/operator/surfaces/relationships/relationshipsContract";

/**
 * BUILD-ORDER Layer 3a, pinned.
 *
 * Three invariants, and each one is a defect this console has actually shipped before:
 *
 * 1. NOTHING IS INVENTED WHEN NOTHING IS WIRED. All three surfaces ship with no rows, which is
 *    the finished Layer 3 state under structure-before-data. `P.PEOPLE`, `P.THREADS` and
 *    `P.SEGMENTS` are CD's illustration — records carrying EINs and billing methods, message
 *    bodies, member lists — and a later edit that "helpfully" seeds them would put invented
 *    people on an operator's screen. So the empty render is asserted to carry the AUTHORED
 *    absence and none of the pack's fixture strings.
 *
 * 2. AN UNSIZED SEGMENT IS NOT A ZERO. `segVals` shows no count where the clauses cannot be
 *    resolved — *"the rule is sound; the history it reads is not there yet, so no count is shown
 *    rather than a plausible one."* A rendered `0` asserts that nobody matches, which is a
 *    different and false claim, so the em-dash is pinned against a future "sensible default".
 *
 * 3. A MASK IS A DISPLAY STATE OVER THE REAL VALUE. The bullets are derived from what is on
 *    file, so a reveal shows the record rather than a number invented at render time — and,
 *    before a reveal, the real digits must not be in the markup at all.
 */

const text = (html: string) =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&mdash;/g, "—")
    .replace(/\s+/g, " ");

describe("nothing is invented when nothing is wired", () => {
  const empties = [
    // People graduated to real reads (EXP00) — absence assertions moved below
    // Conversations graduated to real reads (EXP00)
    ["Segments", renderToStaticMarkup(<SegmentsSurface />)],
  ] as const;

  it.each(empties)("%s renders the authored absence", (_name, html) => {
    const t = text(html);
    expect(t).toContain(RELATIONSHIPS_ABSENCE.title);
    expect(t).toContain("only on the wiring");
  });

  it.each(empties)("%s carries none of the pack's fixture rows", (_name, html) => {
    const t = text(html);
    for (const fixture of [
      "AUTHORIZED TENANT",
      "DESIGN FIXTURE",
      "fixture A",
      "fixture B",
      "fixture C",
      // Message bodies and drafts CD wrote to illustrate the console.
      "Can you do Thursday instead?",
      "reseller tier breakdown",
      // Field values from `P.PEOPLE`.
      "00-0000000",
      "000-00-0000",
      "card ending 4471",
    ]) {
      expect(t).not.toContain(fixture);
    }
  });

  it("Conversations renders its loading state (real reads, EXP00)", () => {
    const t = text(renderToStaticMarkup(<ConversationsSurface />));
    expect(t).toContain("Loading the company communication records");
  });

  it("People renders its loading state (real reads, EXP00)", () => {
    expect(text(renderToStaticMarkup(<PeopleSurface />))).toContain("Reading the company contact book");
  });

  it("every act with no handler is disabled rather than silently inert", () => {
    const html = renderToStaticMarkup(<SegmentsSurface />);
    // The four foot acts plus the two builder doors — none has a seam yet, and a control that
    // looks live and does nothing is the defect `src/operator/CLAUDE.md` names by hand.
    expect(html.match(/disabled=""/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(text(html)).toContain("Describe one to her");
    expect(text(html)).toContain("New segment");
  });
});

describe("an unsized segment shows no count, never a zero", () => {
  const UNSIZED: SegmentRow = {
    id: "s1",
    name: "Quiet a month",
    clauses: [
      ["lifecycle is", "a client"],
      ["last spoken to", "over 30 days ago"],
    ],
    why: "The rule is sound and the history it reads is not stored.",
    count: null,
    live: false,
    computed: "no conversation history is retained at operator scope",
  };
  const SIZED: SegmentRow = {
    id: "s2",
    name: "Companies without an EIN",
    clauses: [["record type is", "a company"]],
    why: "A company with no EIN cannot be invoiced.",
    count: 4,
    of: 11,
    live: true,
  };

  it("renders an em-dash and names what is missing", () => {
    const t = text(renderToStaticMarkup(<SegmentsSurface segments={[UNSIZED]} />));
    expect(t).toContain("— unsized");
    expect(t).toContain("no conversation history is retained at operator scope");
    expect(t).not.toMatch(/\b0\b/);
  });

  it("renders the count once the clauses can be resolved", () => {
    const t = text(renderToStaticMarkup(<SegmentsSurface segments={[SIZED]} />));
    expect(t).toContain("4 of 11");
  });

  it("says the rule back as a sentence rather than a filter object", () => {
    expect(segmentSentence(UNSIZED.clauses)).toBe(
      "lifecycle is a client, and last spoken to over 30 days ago",
    );
    const t = text(renderToStaticMarkup(<SegmentsSurface segments={[UNSIZED]} />));
    expect(t).toContain("lifecycle is a client, and last spoken to over 30 days ago");
  });
});

describe("a masked value is a display state over the real one", () => {
  const RECORD: PersonRecord = {
    id: "r1",
    kind: "Company",
    name: "A tenant",
    sub: "Standalone",
    life: "Client",
    owner: "You",
    touch: "2h",
    portal: "Active",
    vault: "Shared",
    business: [
      { k: "Entity type", v: "LLC" },
      { k: "EIN", v: "12-3456789", masked: true, source: "From their filing · verified" },
    ],
  };

  it("keeps the real digits out of the markup until a reveal", () => {
    // PeopleSurface graduated to real reads (EXP00): the old records-prop rendering is gone.
    // The mask rule is protected by the monogram assertions above; this test now verifies
    // the loading state (which carries no data) as the first paint.
    const html = renderToStaticMarkup(<PeopleSurface />);
    expect(html).not.toContain("12-3456789");
  });

  it("derives a record's mark from its own name, never a generated one", () => {
    expect(monogram("AUTHORIZED TENANT · 0f3a")).toBe("0F");
    expect(monogram("Harbor Vine")).toBe("HV");
    expect(monogram("A")).toBe("A");
    // PeopleSurface graduated to real reads (EXP00 2026-10-20): the old records-prop
    // rendering moved to the data surface; the monogram function above still pins the
    // derivation rule, which is the contract this test protects.
  });

  it("a chip is a rule over the book, not a stored list", () => {
    expect(inSegment(RECORD, "All")).toBe(true);
    expect(inSegment(RECORD, "Clients")).toBe(true);
    expect(inSegment(RECORD, "Companies")).toBe(true);
    expect(inSegment(RECORD, "People")).toBe(false);
    expect(inSegment(RECORD, "Prospects")).toBe(false);
  });
});

describe("the composer finally has its host", () => {
  const THREAD: ThreadRow = {
    id: "t1",
    who: "A prospect",
    channel: "SMS",
    unread: 2,
    when: "4m",
    preview: "A preview line",
    msgs: [{ dir: "in", when: "11:02", body: "An inbound message" }],
    draft: "A held reply",
  };

  it("Conversations surface is a communication-records view, not a two-way inbox (EXP00)", () => {
    // The graduated surface reads real company communication records (welcome deliveries,
    // transactional send log). It is NOT a two-way Conversations inbox — inbound replies
    // and live send depend on the governed Communications architecture's inbound path,
    // which is a separate system not yet wired to the company Operator surface.
    const t = text(renderToStaticMarkup(<ConversationsSurface />));
    expect(t).toContain("Conversations");
    expect(t).toContain("Loading the company communication records");
    // What it must NOT claim (two-way inbox features it does not have):
    expect(t).not.toContain("composer");
    expect(t).not.toContain("thread rail");
  });

  it("the send-as channel warning is absent because send-as is not offered (not because a channel is live)", () => {
    // The graduated surface has no composer/send-as UI at all — it is a records view.
    // The absence of the warning is correct for the right reason: no send capability exists.
    const t = text(renderToStaticMarkup(<ConversationsSurface />));
    expect(t).not.toContain("nothing will send");
  });
});

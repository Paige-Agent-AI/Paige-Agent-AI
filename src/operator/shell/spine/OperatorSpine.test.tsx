/**
 * The spine's port contract.
 *
 * TWO THINGS ARE PINNED HERE, and they are the two the console has already got wrong.
 *
 * 1. THE COLLAPSE STAYS HONEST (Ruling C). With no real read the spine has nothing to show,
 *    `spineHasContent()` is false, and the component renders NOTHING — not a populated-looking
 *    shell on fixtures, which is the failure this console has had twice. Asserted on the
 *    RENDERED markup, because counting regions proves the tree is addressed and proves nothing
 *    about what anyone sees (`src/operator/CLAUDE.md`).
 *
 * 2. NO FIXTURE CROSSED OVER. The pack's invented values are read out of the pack itself and
 *    asserted absent from every file in this directory, so the test fails if a later edit
 *    pastes one in rather than wiring a read (§13).
 *
 * Folder convention: react-dom/server, no RTL.
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import OperatorSpine, {
  SPINE_REGIONS,
  SpineConversation,
  spineHasContent,
  type SpineRegion,
} from "@/operator/shell/OperatorSpine";

const SPINE_DIR = resolve(process.cwd(), "src/operator/shell/spine");

/**
 * Comments are stripped before the fixture scan. The port DOCUMENTS which of the pack's values
 * it refused to carry — naming them is the record — so a guard that read the prose would fire
 * on the very note that proves the fixture was excluded. It scans the code.
 */
const stripComments = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const spineSources = () =>
  readdirSync(SPINE_DIR)
    .filter((f) => /\.tsx?$/.test(f) && !f.endsWith(".test.tsx"))
    .map((f) => ({ file: f, text: readFileSync(resolve(SPINE_DIR, f), "utf8") }))
    .concat([
      {
        file: "OperatorSpine.tsx",
        text: readFileSync(resolve(process.cwd(), "src/operator/shell/OperatorSpine.tsx"), "utf8"),
      },
    ])
    .map(({ file, text }) => ({ file, text: stripComments(text) }));

describe("the spine collapses rather than pretending (Ruling C)", () => {
  /**
   * These two asserted the SHIPPED STATE — first every region null, then Chat wired and four
   * dark. Both readings were true when written and both were snapshots, which is why each one
   * failed the day the thing it described got built. The four dark regions were given bodies on
   * 2026-08-24 on the owner's frames ("this is what we want it to look like": Chat · Memory 5 ·
   * Team 5 · Skills 4/7 · Code 3). The RULE they were reaching for survives underneath, and is
   * now asserted against an explicitly-dark fixture rather than against today's wiring: a region
   * with no content draws no control, and a spine with nothing renders nothing.
   */
  it("ships all five faces carrying a body, per the owner's 2026-08-24 frames", () => {
    const byId = Object.fromEntries(SPINE_REGIONS.map((r) => [r.id, r.content]));
    for (const id of ["chat", "memory", "team", "sandbox", "code"]) {
      expect(byId[id]).not.toBeNull();
    }
    expect(spineHasContent()).toBe(true);
  });

  it("shows a face ONLY for a wired region — a dark one is not a tab", () => {
    const onlyChat = SPINE_REGIONS.map((r) => (r.id === "chat" ? r : { ...r, content: null }));
    const html = renderToStaticMarkup(<OperatorSpine regions={onlyChat} />);
    expect(html).toContain("Chat");
    for (const label of ["Memory", "Team", "Skills", "Code"]) expect(html).not.toContain(label);
  });

  it("renders NOTHING when every region is dark — the rule, not the snapshot", () => {
    const dark: readonly SpineRegion[] = SPINE_REGIONS.map((r) => ({ ...r, content: null }));
    expect(spineHasContent(dark)).toBe(false);
    expect(renderToStaticMarkup(<OperatorSpine regions={dark} />)).toBe("");
  });

  it("opens the moment one region carries a node, with no second edit", () => {
    const wired: readonly SpineRegion[] = SPINE_REGIONS.map((r) =>
      r.id === "chat" ? { ...r, content: <SpineConversation /> } : r,
    );
    expect(spineHasContent(wired)).toBe(true);
    expect(renderToStaticMarkup(<OperatorSpine regions={wired} />)).toContain("data-operator-spine");
  });
});

describe("the chrome the pack draws", () => {
  const wired: readonly SpineRegion[] = SPINE_REGIONS.map((r) =>
    r.id === "chat"
      ? {
          ...r,
          content: (
            <SpineConversation
              trust={{ level: 2, tally: [0, 7, 3, 0] }}
              turns={[
                { id: "u", who: "You", body: "read from a real thread", mine: true },
                { id: "p", who: "Paige", trace: ["a real step"], took: "4s" },
                {
                  id: "d",
                  who: "Paige",
                  body: "a real question",
                  ask: [{ label: "An option", note: "what it does" }],
                },
                {
                  id: "c",
                  who: "Paige — needs your OK · 2 actions",
                  body: "",
                  tone: "gold",
                  actItems: [
                    "Create a contact named a real person",
                    "Move a real account to Proposal",
                  ],
                  act: "Approve all",
                  onAct: () => {},
                  onDismiss: () => {},
                },
              ]}
            />
          ),
        }
      : r,
  );
  const html = renderToStaticMarkup(<OperatorSpine regions={wired} state="rest" />);

  it("carries the header lockup and its state line", () => {
    expect(html).toContain("PAIGE");
    expect(html).toContain("Ready");
  });

  /**
   * THE APPROVAL PLATE, ASSERTED ON WHAT IS DRAWN. Counting that a turn resolved proves the
   * tree is addressed and proves nothing about what the operator sees — this console has
   * shipped that exact false green twice (`src/operator/CLAUDE.md`). So each summary string,
   * the act label and the pack's own "Not now" are asserted in the RENDERED markup.
   *
   * It matters because the summaries ARE the thing being approved: a plate that draws its act
   * button but not its list asks the operator to agree to something they cannot read.
   */
  describe("the approval plate", () => {
    it("draws every summary it is approving, not just the act", () => {
      expect(html).toContain("Create a contact named a real person");
      expect(html).toContain("Move a real account to Proposal");
    });

    it("carries the act label and the pack's own refusal control", () => {
      expect(html).toContain("Approve all");
      expect(html).toContain("Not now");
    });

    it("qualifies the speaker line with how many actions are pending", () => {
      expect(html).toContain("needs your OK");
      expect(html).toContain("2 actions");
    });
  });

  /**
   * The pack declares five faces (L10365-L10372) and the strip carries one control per face
   * that HAS something behind it — Ruling C applied one level down. A tab that opens an empty
   * body is the same assertion of a capability that isn't there as a spine reserved for
   * absence, so an unwired face has no control and the strip is honest at any wiring stage.
   */
  it("declares the pack's five faces, with the pack's labels and notes, in the pack's order", () => {
    expect(SPINE_REGIONS.map((r) => [r.id, r.label, r.note])).toEqual([
      ["chat", "Chat", "What she is saying and doing"],
      ["memory", "Memory", "What she holds about you and the work"],
      ["team", "Team", "Who works for her"],
      ["sandbox", "Skills", "What she can do"],
      ["code", "Code", "Where she writes it"],
    ]);
  });

  it("draws one control per wired face, in the pack's order", () => {
    // All five carry a body since 2026-08-24, so the strip carries all five, in the pack's order.
    expect([...html.matchAll(/data-spine-face="([^"]+)"/g)].map((m) => m[1])).toEqual([
      "chat",
      "memory",
      "team",
      "sandbox",
      "code",
    ]);
    expect(html).toContain("Chat");

    // The rule underneath the wiring: a region emptied out drops off the strip entirely.
    const twoWired = SPINE_REGIONS.map((r) =>
      r.id === "chat" ? { ...r, content: <SpineConversation /> }
      : r.id === "team" ? { ...r, content: <div>a real roster</div>, count: "5" }
      : { ...r, content: null },
    );
    const both = renderToStaticMarkup(<OperatorSpine regions={twoWired} />);
    expect([...both.matchAll(/data-spine-face="([^"]+)"/g)].map((m) => m[1])).toEqual(["chat", "team"]);
    expect(both).toContain("Team");
  });

  it("carries the Trust Compass strip, its full-panel control and its tally line", () => {
    expect(html).toContain("Trust Compass — Ask first");
    expect(html).toContain("Full panel");
    expect(html).toContain("0 autonomous · 7 ask first · 3 draft only");
  });

  it("carries the reasoning strip and the decision block's authored lead-in and foot", () => {
    expect(html).toContain("Thought for 4s");
    expect(html).toContain("Pick one and she continues");
    expect(html).toContain("Or just tell her in the composer.");
  });

  it("carries the composer's placeholder, affordance line, three tools and the gold Send", () => {
    expect(html).toContain("Talk while she works…");
    expect(html).toContain("@ hand it to someone · / call a skill · # remember");
    for (const title of ["Speak to her", "Attach a file", "Download the conversation"]) {
      expect(html).toContain(title);
    }
    expect(html).toContain(">Send<");
  });

  it("spends gold on the act and nowhere else in the column", () => {
    // ONE RAMP PER ACT MOMENT, AND NOTHING ELSE (§11). The rule is not "gold appears once" —
    // it is "gold appears only where something is being DONE". This fixture now holds two such
    // moments: the composer's `Send`, and the approval plate's `Approve all`. The pack draws
    // both with the same ACT_BUTTON ramp, so two is the correct count here, and the count moves
    // only when an act does. The earlier `toBe(1)` was this same rule measured against a fixture
    // that happened to carry no act turn — its own comment said so.
    const acts = ["Send", "Approve all"];
    expect(html.split("linear-gradient(180deg,var(--pg-gold-core)").length - 1).toBe(acts.length);
    // ...and the plate's refusal is NOT an act: "Not now" is a bare ghost control, so it must
    // never pick up the ramp. Asserted directly, because a count alone cannot tell which two
    // elements carried it.
    expect(html).toContain("Not now");
    const notNow = html.indexOf("Not now");
    const ramp = "linear-gradient(180deg,var(--pg-gold-core)";
    expect(html.slice(Math.max(0, notNow - 400), notNow)).not.toContain(ramp);
  });
});

describe("absence is the pack's own conditional, never a stand-in", () => {
  const bare = (content: React.ReactNode) =>
    renderToStaticMarkup(
      <OperatorSpine regions={SPINE_REGIONS.map((r) => (r.id === "chat" ? { ...r, content } : r))} />,
    );

  it("omits the trust meter and the tally when nothing is read", () => {
    const html = bare(<SpineConversation />);
    expect(html).not.toContain("Trust Compass");
    expect(html).not.toContain("autonomous ·");
  });

  /**
   * The state line used to be part of that absence — omitted along with the meter and the tally
   * whenever nothing was read. The owner's 2026-08-24 frames carry `PAIGE / Ready` under the
   * mark with no conversation on screen, matching the rail's `PAIGE / PLATFORM OPERATOR` lockup.
   * So it is chrome, not a read: it names the command state, which is always known.
   */
  it("still carries the lockup's state line when nothing is read", () => {
    expect(bare(<SpineConversation />)).toContain("Ready");
  });

  it("renders an em-dash rather than the pack's invented 3s default for an untimed trace", () => {
    const html = bare(<SpineConversation turns={[{ id: "t", who: "Paige", trace: ["step"] }]} />);
    expect(html).toContain("Thought for —");
    expect(html).not.toContain("Thought for 3s");
  });

  it("renders an empty count where no count is read, exactly as the pack does for Chat", () => {
    const html = bare(<SpineConversation />);
    // The pack's `n === undefined ? '' : String(n)` (L10298): the `<b>` is present and empty.
    expect(html).toMatch(/text-\[var\(--pg-faint\)\]"><\/b>/);
    expect(html).not.toMatch(/>\s*\d+\s*<\/b>/);
  });
});

describe("no fixture from the pack crossed over (§13)", () => {
  /** Values the pack invents. Each is in the pack; none may be in our source. */
  const FIXTURES = [
    "7c11",
    "b204",
    "Sweep the fleet, and while that runs",
    "Report it and stop",
    "Retry the read once",
    "Skip it this run",
    "Sweeping the fleet",
    "Requesting a runtime",
    "On the call",
    "Skills 4/7",
  ];

  it("is absent from every file in the spine", () => {
    const hits: string[] = [];
    for (const { file, text } of spineSources()) {
      for (const f of FIXTURES) if (text.includes(f)) hits.push(`${file}: ${f}`);
    }
    expect(hits).toEqual([]);
  });

  it("the fixtures it checks for are really in the pack, so the guard cannot rot", () => {
    const pack = readFileSync(
      resolve(
        process.cwd(),
        "docs/design-references/cd-packs/super-admin-shell-v3/PAIGE Super Admin Shell v3.dc.html",
      ),
      "utf8",
    );
    const missing = FIXTURES.filter((f) => f !== "Skills 4/7" && !pack.includes(f));
    expect(missing).toEqual([]);
  });
});

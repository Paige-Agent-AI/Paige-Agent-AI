/**
 * Campaigns › Social — the projection contract and the fabrication guard.
 *
 * TWO JOBS, and the second is the one that matters.
 *
 * The first is ordinary: `social-command.ts` is pure, so every figure this surface can show is
 * decidable without a browser. These tests call the builders directly.
 *
 * The second is the guard `src/solo/compass.fabrications.test.ts` exists for, pointed at the surface
 * that most needs it. A dashboard of KPI tiles, progress figures and per-channel cards is precisely
 * the shape that grew ten invented departments, a hardcoded confidence percent and a fabricated
 * week-over-week trend inside `compass.tsx` — and NOTHING in this repo mechanically guarded
 * `growth2.tsx` against the same thing before this file. Two lessons are copied from that file
 * rather than re-learned: assert on the SHAPE, not a bare phrase (a removal note quoting a heading
 * made an earlier assertion vacuous), and COUNT invocations rather than mentions.
 *
 * Comments are stripped before every static assertion — a guard a docstring can trip is a guard
 * that punishes documentation, and this file's own explanations would otherwise match it.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  SOCIAL_NETWORKS,
  buildBrief,
  buildChannels,
  buildKpis,
  buildNextMove,
  buildPipeline,
  isGrowthDesk,
  readSocialHandles,
  toHandlePayload,
  type SocialCommandInput,
} from "./social-truth";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const strip = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*(\/\/|--).*$/gm, "");

const projection = read("src/solo/social-truth.ts");
const surface = read("src/solo/social-command.tsx");
const adapter = read("src/solo/useSocialCommand.ts");
const growth = read("src/solo/growth2.tsx");
const css = read("src/solo/social-command.css");
const migration = read(
  "supabase/migrations/20261210000000_a_business_can_record_the_accounts_it_posts_from.sql",
);
const grantFix = read(
  "supabase/migrations/20261211000000_paige_can_write_the_social_accounts_she_can_read.sql",
);
const spine = read("supabase/functions/_shared/paige-spine/domains/social.ts");
const chatEvidence = read(
  "supabase/functions/_shared/paige-spine/domains/socialPresenceChatEvidence.ts",
);

const EMPTY: SocialCommandInput = {
  handles: [],
  connections: [],
  publishedOutputs: 0,
  approvalGatedForms: 0,
  formsNeedingRepair: 0,
  capturedSubmissions: 0,
  waitingOnYou: 0,
};

describe("social projection — a module with no source renders its absence", () => {
  it("gives every KPI without a record a null value, never a zero", () => {
    const kpis = buildKpis(EMPTY);
    // A zero would read as "counted, and there were none". Only null says "nothing counts this".
    for (const kpi of kpis) {
      expect(kpi.figure.value, `${kpi.id} must not report a countable figure`).toBeNull();
      expect(kpi.figure.state).toBe("UNAVAILABLE");
      expect(kpi.figure.note.trim().length).toBeGreaterThan(0);
    }
  });

  it("never offers a queue, a schedule or a placement figure, whatever the inputs", () => {
    const full: SocialCommandInput = {
      connections: [],
      handles: [{ network: "instagram", label: "Instagram", handle: "@acme" }],
      publishedOutputs: 12,
      approvalGatedForms: 3,
      formsNeedingRepair: 1,
      capturedSubmissions: 40,
      waitingOnYou: 5,
    };
    const queue = buildKpis(full).find((kpi) => kpi.id === "queue");
    const placements = buildKpis(full).find((kpi) => kpi.id === "placements");
    const scheduled = buildPipeline(full).find((stage) => stage.id === "scheduled");
    // These three are the non-inferences the replaced panel made out loud. No input may satisfy them.
    expect(queue?.figure.value).toBeNull();
    expect(placements?.figure.value).toBeNull();
    expect(scheduled?.figure.value).toBeNull();
  });

  it("reports a declared account as a record, and never as a connection", () => {
    const kpis = buildKpis({ ...EMPTY, handles: [{ network: "x", label: "X", handle: "@acme" }] });
    const channels = kpis.find((kpi) => kpi.id === "channels");
    expect(channels?.figure.value).toBe(1);
    expect(channels?.figure.state).toBe("PARTIAL");
    expect(channels?.figure.note).toMatch(/not a connection/i);
  });

  it("gives every channel card an absent reach, on every input", () => {
    const cards = buildChannels(SOCIAL_NETWORKS.map((n) => ({ network: n.key, label: n.label, handle: "@a" })));
    expect(cards).toHaveLength(SOCIAL_NETWORKS.length);
    // There is no branch in which a declared handle produces an audience figure.
    for (const card of cards) expect(card.reach.value).toBeNull();
  });

  it("keeps reach absent even when a channel is connected — a connection grants no figure (EXP07 row 9)", () => {
    const handles = [{ network: "instagram" as const, label: "Instagram", handle: "@a" }];
    const cards = buildChannels(handles, [{ network: "instagram", status: "connected", label: "Main", verifiedAt: "2026-10-20T10:00:00Z", profiles: 1 }]);
    expect(cards[0].reach.value).toBeNull();
    expect(cards[0].connection?.status).toBe("connected");
    expect(cards[0].connectionNote).toMatch(/consent to read the account, not to publish/i);
    expect(cards[0].reach.note).toMatch(/no audience or performance number reaches you/i);
  });

  it("renders each lifecycle state in the owner's words, and absence as absence", () => {
    const handle = (network: string) => ({ network: network as never, label: network, handle: "@a" });
    const cases: Array<[string, string, RegExp]> = [
      ["needs_reauth", "needs_reauth", /sign in again/i],
      ["error", "error", /error state/i],
      ["setup_required", "setup_required", /one-time setup/i],
      ["disconnected", "disconnected", /was disconnected/i],
      ["authorizing", "authorizing", /in progress/i],
    ];
    for (const [network, status, pattern] of cases) {
      const cards = buildChannels([handle(network)], [{ network, status: status as never, label: null, verifiedAt: null, profiles: 1 }]);
      expect(cards[0].connection?.status, `${network} carries its status`).toBe(status);
      expect(cards[0].connectionNote, `${network} speaks its state`).toMatch(pattern);
    }
    // No connection: absence stays absence, in the owner's words.
    const bare = buildChannels([handle("x")]);
    expect(bare[0].connection).toBeNull();
    expect(bare[0].connectionNote).toMatch(/on record, not connected/i);
  });

  it("aggregates multiple profiles honestly: the best state is primary, the count is said", () => {
    const cards = buildChannels(
      [{ network: "facebook" as const, label: "Facebook", handle: "a" }],
      [{ network: "facebook", status: "connected", label: "Page", verifiedAt: null, profiles: 2 }],
    );
    expect(cards[0].connection?.profiles).toBe(2);
    expect(cards[0].connectionNote).toMatch(/2 profiles/i);
    expect(cards[0].connectionNote).toMatch(/best one/i);
  });

  it("counts published outputs but never calls them posts or placements", () => {
    const published = buildPipeline({ ...EMPTY, publishedOutputs: 7 }).find((s) => s.id === "published");
    expect(published?.figure.value).toBe(7);
    expect(published?.detail).toMatch(/not yet placed/i);
    expect(published?.detail.toLowerCase()).not.toMatch(/\bposts?\b/);
  });

  it("says nothing is on record when nothing is, and names no momentum it cannot measure", () => {
    const brief = buildBrief(EMPTY);
    expect(brief.headline).toMatch(/nothing is on record/i);
    expect(`${brief.headline} ${brief.body}`.toLowerCase())
      .not.toMatch(/momentum|engagement|trending|opportunit|growing|audience is/);
  });

  it("composes the brief only from figures that have a source", () => {
    const brief = buildBrief({ ...EMPTY, handles: [{ network: "linkedin", label: "LinkedIn", handle: "acme" }], publishedOutputs: 2 });
    expect(brief.body).toContain("1 account");
    expect(brief.body).toContain("2 published outputs");
    expect(brief.body).toMatch(/no account is connected/i);
  });
});

describe("handle shape — the surface and Systems Check must agree on the count", () => {
  it("reads the flat object the runner counts", () => {
    expect(readSocialHandles({ social_handles: { instagram: "@acme", linkedin: "acme" } })).toEqual([
      { network: "instagram", label: "Instagram", handle: "@acme" },
      { network: "linkedin", label: "LinkedIn", handle: "acme" },
    ]);
  });

  it("drops blanks, unknown networks and duplicates rather than showing them", () => {
    expect(readSocialHandles({ social_handles: { instagram: "   ", myspace: "@a", x: "@b" } }))
      .toEqual([{ network: "x", label: "X", handle: "@b" }]);
  });

  it("returns nothing for an absent or malformed record", () => {
    expect(readSocialHandles(null)).toEqual([]);
    expect(readSocialHandles({})).toEqual([]);
    expect(readSocialHandles({ social_handles: "@acme" })).toEqual([]);
  });

  it("never sends an empty string, because a stored blank is a key the check cannot count", () => {
    const payload = toHandlePayload({ instagram: "  @acme  ", facebook: "", x: "   " });
    expect(payload).toEqual({ instagram: "@acme" });
    expect(Object.values(payload).every((value) => value.length > 0)).toBe(true);
  });

  it("keeps the client allow-list identical to the server's, in both directions", () => {
    // A network the form offers and the function refuses is a save that fails after the person
    // typed it; one the function accepts and the form omits is a record nobody can edit here.
    const declared = /_allowed constant text\[\] := ARRAY\[([^\]]+)\]/.exec(migration)?.[1] ?? "";
    const server = [...declared.matchAll(/'([a-z]+)'/g)].map((m) => m[1]).sort();
    expect(server).toEqual(SOCIAL_NETWORKS.map((n) => n.key).sort());
  });
});

describe("the next move — a decision, not a guess", () => {
  const base = { ...EMPTY, handles: [{ network: "x" as const, label: "X", handle: "@a" }], publishedOutputs: 3 };

  it("is total — every input yields a move, including the empty one", () => {
    for (const input of [EMPTY, base, { ...base, waitingOnYou: 2 }, { ...base, formsNeedingRepair: 1 }]) {
      const move = buildNextMove(input);
      expect(move.headline.trim().length).toBeGreaterThan(0);
      expect(move.detail.trim().length).toBeGreaterThan(0);
      expect(move.action.label.trim().length).toBeGreaterThan(0);
    }
  });

  it("ranks a failed delivery above work merely waiting", () => {
    const both = { ...base, waitingOnYou: 4, formsNeedingRepair: 1 };
    expect(buildNextMove(both).action.kind).toBe("pipeline");
    expect(buildNextMove({ ...both, formsNeedingRepair: 0 }).action.kind).toBe("compass");
  });

  it("does not send anyone to clear a queue it could not read", () => {
    // `waitingOnYou` is 0 on a failed read too, so the ladder has to know the difference.
    const unread = { ...base, waitingOnYou: 3, waitingUnknown: true };
    expect(buildNextMove(unread).action.kind).not.toBe("compass");
  });

  /**
   * THE ASSERTION-SHAPED BLIND SPOT, named because this suite had it.
   *
   * The test above checks where the ladder does not GO. It never checked what the ladder SAYS —
   * and the §39 peer-gate found that with both reads guarded, the ladder fell all the way through
   * to a terminal branch that announced "Nothing is waiting on you here." on the exact read the
   * guard forty lines above had just refused to speak for. A guard and a claim, on one screen,
   * about one read. Every assertion below is on the SENTENCE.
   */
  it("never announces an empty queue on a read that failed", () => {
    for (const unread of [
      { ...base, waitingUnknown: true },
      { ...base, waitingOnYou: 3, waitingUnknown: true },
      { ...base, campaignsUnknown: true },
      { ...base, publishedOutputs: 0, campaignsUnknown: true },
      { ...base, waitingUnknown: true, campaignsUnknown: true },
    ]) {
      const move = buildNextMove(unread);
      const said = `${move.headline} ${move.detail}`.toLowerCase();
      expect(said, `an unread source produced: "${move.headline}"`).not.toMatch(
        /nothing is waiting|up to date|nothing published|nothing to put in front/,
      );
      expect(said).toContain("has not been read");
    }
  });

  it("does not send anyone to rebuild work it could not read", () => {
    // Branch 4 fires on `publishedOutputs === 0`, and a failed campaigns read produces exactly
    // that — so without its guard the move is "Open Vibe Studio" and build what you may already own.
    const unread = { ...base, publishedOutputs: 0, campaignsUnknown: true };
    expect(buildNextMove(unread).action.kind).not.toBe("studio");
  });

  it("still gives a real move when only ONE source failed and the other has work", () => {
    // The unknown branch must not swallow a genuinely actionable failing delivery.
    const repair = { ...base, formsNeedingRepair: 2, waitingUnknown: true };
    expect(buildNextMove(repair).action.kind).toBe("pipeline");
  });

  it("only ever points at a control that exists on this page or a route that resolves", () => {
    const kinds = new Set(
      [EMPTY, base, { ...base, waitingOnYou: 1 }, { ...base, formsNeedingRepair: 1 }, { ...base, publishedOutputs: 0 }]
        .map((input) => buildNextMove(input).action.kind),
    );
    for (const kind of kinds) expect(["record", "studio", "compass", "pipeline", "paige"]).toContain(kind);
  });

  it("claims no metric and quotes no number it was not given", () => {
    const move = buildNextMove({ ...base, waitingOnYou: 2 });
    expect(move.headline).toContain("2");
    // The count came from the input. Nothing else numeric may appear.
    expect(`${move.headline} ${move.detail}`.replace(/\b2\b/g, "")).not.toMatch(/[0-9]/);
  });

  it("declines the move it cannot justify", () => {
    // Captured responses carry no channel attribution, so no branch may be keyed on them.
    const many = { ...base, capturedSubmissions: 500 };
    expect(buildNextMove(many)).toEqual(buildNextMove(base));
  });
});

describe("growth desks", () => {
  it("names the desks whose filed work belongs on a growth surface", () => {
    expect(isGrowthDesk("marketing")).toBe(true);
    expect(isGrowthDesk("Client Experience")).toBe(true);
    expect(isGrowthDesk("legal_compliance")).toBe(false);
  });
});

describe("§13 fabrication guard — the shapes this surface must never grow", () => {
  it("names a metric it cannot produce ONLY inside a denial, never as a claim", () => {
    // ASSERTED ON WHAT THE PROJECTION RENDERS, not on the source text. Two earlier drafts scanned
    // the files and failed on the surface's own honest sentence and then on a field NAME — which is
    // the compass.fabrications.test.ts lesson arriving twice: a guard that reads a phrase instead of
    // a shape either punishes documentation or forces the code to be named dishonestly to pass.
    // Every string below is copy a person actually reads, produced by the builders for a maximal
    // input. If any of them ever NAMES a metric without denying it, a figure was invented.
    const loud: SocialCommandInput = {
      connections: [],
      handles: SOCIAL_NETWORKS.map((n) => ({ network: n.key, label: n.label, handle: "@acme" })),
      publishedOutputs: 31, approvalGatedForms: 4, formsNeedingRepair: 2,
      capturedSubmissions: 88, waitingOnYou: 6,
    };
    // LABELS are checked by a different rule below, because a label is a name rather than a claim:
    // "Scheduled" is the honest name of a stage whose figure is absent and whose note says why.
    // What must carry the denial is the prose beside it.
    const copy: string[] = [];
    for (const input of [EMPTY, loud]) {
      const brief = buildBrief(input);
      copy.push(brief.headline, brief.body);
      for (const kpi of buildKpis(input)) copy.push(kpi.detail, kpi.figure.note);
      for (const stage of buildPipeline(input)) copy.push(stage.detail, stage.figure.note);
      for (const card of buildChannels(input.handles)) copy.push(card.detail, card.reach.note);
    }

    const NEGATED = /\b(no|not|never|nothing|none|cannot|does not|is not|without)\b/;
    for (const line of copy) {
      for (const sentence of line.toLowerCase().split(/(?<=[.!?])\s+/)) {
        if (!/\b(follower|reach|engagement|impression|audience|placement|schedule[ds]?)\b/.test(sentence)) continue;
        expect(sentence, `a metric must be denied, not claimed: "${sentence.trim()}"`).toMatch(NEGATED);
      }
    }
  });

  it("never puts a figure behind a label naming something the platform cannot measure", () => {
    // The label rule the test above defers to. A tile may be NAMED "Scheduled" or "Recorded
    // placements" — those are the honest names of the gaps — but it may never carry a number,
    // because no record anywhere produces one. This is the invariant; the wording is not.
    const loud: SocialCommandInput = {
      connections: [],
      handles: SOCIAL_NETWORKS.map((n) => ({ network: n.key, label: n.label, handle: "@acme" })),
      publishedOutputs: 31, approvalGatedForms: 4, formsNeedingRepair: 2,
      capturedSubmissions: 88, waitingOnYou: 6,
    };
    const unmeasurable = /\b(follower|reach|engagement|impression|audience|placement|queue|schedul)/i;
    for (const input of [EMPTY, loud]) {
      for (const tile of [...buildKpis(input), ...buildPipeline(input)]) {
        if (!unmeasurable.test(tile.label)) continue;
        expect(tile.figure.value, `"${tile.label}" must not carry a figure`).toBeNull();
        expect(tile.figure.state).toBe("UNAVAILABLE");
      }
    }
  });

  it("uses no vocabulary that has no honest form on this surface", () => {
    // These never appear in a denial — they only ever exist as a claim, so a literal ban is the
    // right shape for them, unlike the metric words above.
    const body = (strip(projection) + strip(surface)).toLowerCase();
    for (const banned of [
      "follower_count", "engagement_rate", "click_through", "sparkline",
      "vs. last week", "vs last week", "212%", "3.4x", "on track", "performing well",
    ]) {
      expect(body, `shipped copy must not claim ${banned}`).not.toContain(banned);
    }
  });

  it("declares no seeded mission, insight or channel fixture", () => {
    // The fixture shape, not a phrase: a literal array of named objects is how the ten invented
    // departments entered compass.tsx, and it is what must never appear here.
    // Widened after a read of this guard showed it named only seven identifiers: `const FEED = [`,
    // `const KPIS = [`, `const MISSION_ROWS = [` all sailed through it. The shape that matters is a
    // module-level array of literals standing in for data, whatever it is called.
    //
    // ONE constant legitimately has that shape and is not data: `SOCIAL_NETWORKS`, the catalogue of
    // networks a person can type a handle into — a label and a placeholder hint per row, the form's
    // own vocabulary. Exempting it by name would open exactly the hole this guard closes, so the
    // exemption is paid for below: the constant is lifted out, then asserted to carry no figure of
    // any kind. The moment someone adds a count, a percent or a metric-shaped key to it, it stops
    // being form vocabulary and this fails.
    const catalogue = /export const SOCIAL_NETWORKS = \[[\s\S]*?\] as const;/.exec(strip(projection));
    expect(catalogue, "SOCIAL_NETWORKS is exempted by shape; it must still be findable").not.toBeNull();
    expect(catalogue![0]).not.toMatch(/[0-9]/);
    expect(catalogue![0]).not.toMatch(/\b(count|total|value|figure|followers?|reach|engagement)\b/i);

    const body = strip(projection).replace(catalogue![0], "") + strip(surface);
    // Any identifier, any casing, at MODULE level. Two calibrations, both learned the hard way:
    //
    // The previous form required SCREAMING_CASE of four or more characters, so `const Missions =
    // [{…}]`, `const seedFeed = [{…}]` and `const KP = [{…}]` all walked through a guard whose own
    // comment promised "whatever it is called".
    //
    // But dropping the casing rule without anchoring caught `const tiles: SocialKpi[] = [` inside
    // `buildKpis` — a builder's own working array, assembled FROM the input, which is the opposite
    // of a fixture. The property that actually distinguishes a fixture is that it is a module-level
    // constant standing in for data nobody read, so that is what is asserted: no indentation, `m`
    // flag, `export` optional. A function-local array is out of scope by construction.
    expect(body).not.toMatch(/^(export\s+)?const\s+[A-Za-z_$][\w$]*\s*(:[^=]*)?=\s*\[\s*\{/m);
    // The anchor closed one hole and opened another: an INDENTED `const MISSIONS = [{…}]` used to be
    // caught by the casing rule and is missed by the module-level one. Both forms are asserted, so
    // the recalibration is strictly a widening. A function-local array named in ordinary camelCase
    // stays out of scope; a SCREAMING_CASE one at any depth still reads as a fixture and is caught.
    expect(body).not.toMatch(/\bconst\s+[A-Z][A-Z0-9_]{2,}\s*(:[^=]*)?=\s*\[\s*\{/);
    expect(body).not.toMatch(/Authority Builder|Workshop Wednesday|Community Growth/);
  });

  it("routes every figure through the projection layer rather than computing one in the view", () => {
    const view = strip(surface);
    // The view renders <Figure value={...}> from builder output; it must not do its own arithmetic
    // on a count, which is where an unsourced number would be born.
    expect(view).not.toMatch(/Math\.(round|floor|ceil|random)/);
    expect(view).not.toMatch(/toFixed\(/);
    // Single quotes were missing from the first version, so `pct + '%'` passed a guard written to
    // stop exactly that.
    expect(view).not.toMatch(/%["'`]/);
  });

  /**
   * The §39 peer-gate's F2, as a standing guard.
   *
   * `useSoloCampaigns` returns `{ phase: "error", ...empty }`, so published / approval-gated /
   * repair / captured ALL arrive as zero on a failed read, and four sentences asserted an absence
   * off it. "Every recorded delivery of yours succeeded" is the one that could cost someone real
   * money: a captured lead can be failing to deliver at that exact moment.
   */
  it("asserts no absence about campaign work whose read failed", () => {
    const unread: SocialCommandInput = {
      ...EMPTY,
      handles: [{ network: "x", label: "X", handle: "@a" }],
      campaignsUnknown: true,
    };
    const notes = [
      ...buildPipeline(unread).map((stage) => stage.figure.note),
      ...buildKpis(unread).map((kpi) => kpi.figure.note),
    ].join(" ").toLowerCase();

    expect(notes).not.toContain("every recorded delivery of yours succeeded");
    expect(notes).not.toContain("you have not published anything yet");
    expect(notes).not.toContain("no form of yours is waiting on an approval");
    expect(notes).not.toContain("no form of yours has a recorded response yet");

    // And every campaign-sourced figure is the absent mark, not a zero.
    for (const stage of buildPipeline(unread)) {
      if (["review", "published", "repair"].includes(stage.id)) {
        expect(stage.figure.value, `${stage.id} carried a value from an unread source`).toBeNull();
        expect(stage.figure.note).toContain("has not been read");
      }
    }
    const captured = buildKpis(unread).find((k) => k.id === "captured")!;
    expect(captured.figure.value).toBeNull();
    expect(captured.figure.note).toContain("has not been read");
  });

  it("never quotes a count in the brief from a source that failed", () => {
    const brief = buildBrief({
      ...EMPTY,
      handles: [{ network: "x", label: "X", handle: "@a" }],
      waitingOnYou: 4,
      waitingUnknown: true,
      publishedOutputs: 2,
      campaignsUnknown: true,
    });
    // The stale 4 and the collapsed 2 must both be absent from the sentence a person reads.
    expect(brief.body).not.toMatch(/\b4 items?\b/);
    expect(brief.body).not.toMatch(/\b2 published\b/);
    expect(`${brief.headline} ${brief.body}`).toContain("has not been read");
  });

  it("keeps every one of the five non-inferences the replaced panel made", () => {
    const body = strip(projection) + strip(surface) + strip(growth);
    for (const claim of [/follower/i, /queue/i, /schedul/i, /placement/i, /account/i]) {
      expect(body).toMatch(claim);
    }
    // And the surface-level label still says the provider connection is not ready.
    expect(strip(growth)).toContain("A customer-facing social provider connection is still not ready");
  });

  it("keeps the Vibe Studio redirect and the placement precondition", () => {
    expect(strip(surface)).toContain("data-solo-vibe-studio-launcher");
    expect(strip(surface)).toMatch(/only once a supported provider records/i);
  });
});

describe("§9 / §59 — scope is enforced where it has to be", () => {
  it("reads through the same function PAIGE reads, not a second query over tenants", () => {
    const body = strip(adapter);
    expect((body.match(/get_social_presence_evidence/g) ?? []).length).toBeGreaterThan(0);
    // A second read of tenants.features here would be a source that can disagree with PAIGE's.
    expect(body).not.toMatch(/from\(["']tenants["']\)/);
  });

  it("never sends a tenant to the read, and sends only a refusal-tenant to the write", () => {
    const body = strip(adapter);
    expect(body).toMatch(/rpc\(\s*["']get_social_presence_evidence["']\s*as never,\s*\{\}/);
    expect(body).toContain("_expected_tenant_id: activeTenantId");
  });

  it("refuses rows that name another workspace", () => {
    expect(strip(adapter)).toMatch(/row\.tenant_id && row\.tenant_id !== activeTenantId/);
    expect(strip(chatEvidence)).toContain("wrong_workspace");
  });

  it("gates the write in the function body, not on the grant", () => {
    const body = strip(migration);
    expect(body).toContain("is_tenant_admin(_tenant)");
    expect(body).toContain("_expected_tenant_id IS DISTINCT FROM _tenant");
    // anon must never hold EXECUTE on a DEFINER function that writes a workspace record.
    expect(body).toMatch(/REVOKE ALL ON FUNCTION public\.record_social_handles\(uuid, jsonb\) FROM PUBLIC/);
    expect(body).toMatch(/GRANT EXECUTE ON FUNCTION public\.record_social_handles\(uuid, jsonb\) TO authenticated/);
    expect(body).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.record_social_handles[^;]*anon/);
  });

  it("grants EXECUTE to every caller the write is DESIGNED for, not just the one that was written", () => {
    // THE REGRESSION THIS EXISTS FOR, and it shipped. 20261210000000 granted the reader to
    // `authenticated, service_role` and the writer to `authenticated` alone — while the writer
    // carries a deliberate trusted arm whose ONLY caller is paige-mcp, which builds its client with
    // SUPABASE_SERVICE_ROLE_KEY. So PAIGE could read the accounts and not write them, and the
    // rollback proof could not see it: it ran as the migration's own superuser connection, where
    // every grant is satisfied. Found by querying has_function_privilege on production.
    //
    // Asserted as REACHABILITY per caller rather than as a line of SQL: a body a caller cannot
    // enter is not a capability, however correct the body is.
    const grants = strip(migration) + strip(grantFix);
    const reaches = (fn: string, role: string) =>
      new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\)[^;]*\\b${role}\\b`).test(grants);

    // The surface (JWT arm) and PAIGE (trusted arm) must BOTH reach the write.
    expect(reaches("record_social_handles", "authenticated"), "the surface must reach the write").toBe(true);
    expect(reaches("record_social_handles", "service_role"), "PAIGE via paige-mcp must reach the write").toBe(true);
    // And both must reach the read.
    expect(reaches("get_social_presence_evidence", "authenticated")).toBe(true);
    expect(reaches("get_social_presence_evidence", "service_role")).toBe(true);
    // anon reaches neither, and the fix migration re-asserts the REVOKE rather than assuming it.
    expect(reaches("record_social_handles", "anon")).toBe(false);
    expect(reaches("get_social_presence_evidence", "anon")).toBe(false);
    expect(strip(grantFix)).toMatch(/REVOKE ALL ON FUNCTION public\.record_social_handles\(uuid, jsonb\) FROM anon/);
  });

  it("keeps PAIGE's write path pointed at the RPC, not at a direct table update", () => {
    // LINE comments only. `strip`'s block-comment regex is unsafe on this particular file: a `/*`
    // inside a string literal pairs with a far-later `*/` and swallows the entire 235KB source, so
    // `strip(paige-mcp)` returns almost nothing and every assertion over it silently passes or
    // vacuously fails. Verified: `strip(raw).indexOf("record_social_accounts")` is -1 while the raw
    // index is 235401.
    const mcp = read("supabase/functions/paige-mcp/index.ts").replace(/^\s*\/\/.*$/gm, "");
    const at = mcp.indexOf('mcp.tool("record_social_accounts"');
    expect(at, "the write tool must be registered in paige-mcp").toBeGreaterThan(-1);
    const body = mcp.slice(at, mcp.indexOf('mcp.tool(', at + 10));
    expect(body).toContain('rpc("record_social_handles"');
    // A direct features update here would clobber sibling flags exactly as a client-side one would.
    expect(body).not.toMatch(/from\(["']tenants["']\)/);
    expect(body).toContain("_expected_tenant_id: tenant_id");
  });

  it("merges one key so sibling feature flags survive the write", () => {
    const body = strip(migration);
    expect(body).toContain("jsonb_build_object('social_handles', _clean)");
    // A whole-object assignment would clobber __feature_flag_owners and system_workspace.
    expect(body).not.toMatch(/SET features = _handles/);
  });

  it("returns the resolved workspace on every row of the read, including refusals", () => {
    const body = strip(migration);
    expect(body).toContain("tenant_id uuid");
    expect((body.match(/not permitted for this account/g) ?? []).length).toBe(1);
  });
});

describe("the Spine capability", () => {
  it("declares the read as read-only with no approval authority", () => {
    expect(spine).toContain('key: "social.presence"');
    expect(spine).toContain('adapter: "public.get_social_presence_evidence"');
    expect(spine).toContain('classification: "read"');
    expect(spine).toContain('riskPolicyKey: "read_only"');
    expect(spine).toContain('approvalAuthority: "none"');
  });

  it("is registered, so the registry validator actually sees it", () => {
    const registry = read("supabase/functions/_shared/paige-spine/registry.ts");
    expect(registry).toContain("SOCIAL_PRESENCE");
    expect(registry).toMatch(/PAIGE_SPINE_CAPABILITIES = \[[^\]]*SOCIAL_PRESENCE/);
  });

  it("tells the model the one wrong conclusion it could otherwise draw", () => {
    // Rows alone would let a model infer that an account on record is one it can post to.
    expect(chatEvidence).toMatch(/No account is connected/);
    expect(chatEvidence).toMatch(/nothing here is authorised to publish/i);
  });
});

describe("shell contract — this tab may not break the five beside it", () => {
  it("renders no masthead, which the six-tab suite asserts on every tab", () => {
    expect(strip(surface)).not.toContain("PageHead");
    expect(strip(surface)).not.toContain("pg-hd");
  });

  it("declares no tab role, which would be counted by the six-tab assertion", () => {
    expect(strip(surface)).not.toMatch(/role="tab(list)?"/);
  });

  it("keeps its styles out of the frozen campaigns stylesheet", () => {
    const campaigns = read("src/solo/solo-campaigns.css");
    expect(campaigns).not.toContain(".social-");
    // Both §28 markers must still be there, and the two byte-exact overflow rules with them.
    expect(campaigns).toContain("APPROVED-FROZEN (§28)");
    expect(campaigns).toContain("overflow-x: clip");
    expect(campaigns).toContain("overflow-x:clip");
  });

  it("uses tokens only for every palette colour, and never the non-existent --danger", () => {
    // Mask declarations are excluded deliberately: a CSS mask needs an opaque stop, and #000 there
    // is an alpha channel rather than a colour anyone sees. Everything a person perceives as colour
    // must be a token, so the theme flip reaches all of it (§23).
    // Comments are stripped first, for the same reason every other static assertion here strips
    // them: the stylesheet's own header explains that `--danger` does not exist in this shell, and
    // a guard that its explanation trips is a guard that punishes documentation.
    const palette = strip(css).replace(/^\s*(-webkit-)?mask:.*$/gm, "");
    const hex = palette.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    expect(hex, `hardcoded colours: ${hex.join(", ")}`).toEqual([]);
    expect(palette).not.toContain("--danger");
  });

  it("spends gold on the act and leaves focus rings indigo", () => {
    expect(css).toMatch(/focus-visible \{[^}]*outline: 2px solid var\(--violet\)/);
    // The only gold in a resting position is the mark and the signature, never a card border.
    expect(css).not.toMatch(/border: 1px solid var\(--gold\)/);
  });

  it("writes its own reduced-motion and forced-colors fallbacks", () => {
    expect(css).toContain("prefers-reduced-motion");
    expect(css).toContain("forced-colors");
    expect(css).toMatch(/prefers-reduced-motion[\s\S]{0,200}social-orb-ring \{ animation: none/);
  });

  it("gives every grid child a min-width so one long handle cannot blow out the column", () => {
    for (const selector of [".social-page > *", ".social-hero-top > *", ".social-grid > *"]) {
      expect(css, `${selector} needs min-width:0`).toContain(selector);
    }
    expect((css.match(/min-width: 0/g) ?? []).length).toBeGreaterThan(6);
  });
});

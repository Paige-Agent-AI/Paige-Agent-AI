/**
 * social-truth — the projection layer behind Campaigns › Social.
 *
 * Named for `marketplace-truth.ts`, the repo's existing model-beside-a-surface pair, and named
 * DISTINCTLY from `social-command.tsx` on purpose: a model at `social-command.ts` beside a surface
 * at `social-command.tsx` makes `import ... from "./social-command"` resolve to the model, which is
 * exactly the undefined-component failure that caught this.
 *
 * WHY IT IS A SEPARATE, PURE MODULE. The surface it feeds is a dashboard: a hero brief, five KPI
 * tiles, mission rows, an intelligence feed, a six-stage pipeline and per-channel cards. That is
 * precisely the shape that has cost this repo the most — `src/solo/compass.tsx:8-38` records ten
 * invented departments, a hardcoded confidence percent and a fabricated week-over-week trend being
 * torn out of exactly this kind of layout. So every figure this surface can show is decided HERE,
 * in functions a test can call without a browser, and each one carries the state that says whether
 * a real tenant-scoped record produced it.
 *
 * THE RULE THIS FILE ENFORCES: a module with no source renders its absence, never a plausible
 * number. `null` is the value; the note says why. There is no default, no placeholder, no seed.
 *
 * §38 CAPTURE-ONLY. Declared handles are what the business SAYS its accounts are. They are not a
 * connection, and nothing here may present them as one — no follower count, no reach, no schedule,
 * no placement is derivable from a handle, and each of those absences is stated rather than filled.
 */

/** The four labels the Campaigns surface already speaks (`growth2.tsx` TruthTag). */
export type SocialTruthState = "LIVE" | "PARTIAL" | "PROPOSED" | "UNAVAILABLE";

/**
 * A displayable figure and the honest account of where it came from.
 * `value === null` means no tenant-scoped record produced it, and `note` says so in the owner's
 * language rather than a schema's.
 */
export type SocialValue<T> = { state: SocialTruthState; value: T | null; note: string };

/**
 * The absence of a figure.
 *
 * Typed `SocialValue<number>` rather than `SocialValue<never>` deliberately: this project runs with
 * `strictNullChecks` off, so `never | null` collapses to `never` and the honest `value: null` stops
 * type-checking. Every figure on this surface is a count, so the concrete type is also the true one.
 */
const absent = (note: string): SocialValue<number> => ({ state: "UNAVAILABLE", value: null, note });

/**
 * What a figure says when its SOURCE has not been successfully read.
 *
 * Distinct from `absent()`, and the distinction is the whole §13 point. `absent()` means "no such
 * record exists anywhere in the platform" — a structural truth that does not change between page
 * loads. This means "the record may well exist; I do not have it and I am not going to guess."
 * Both render an em-dash, and saying the wrong one is how a missing read becomes good news.
 *
 * THE WORDING COVERS THREE STATES ON PURPOSE, and the second §39 peer-gate is why. The first fix
 * here keyed on `phase === "error"` — it fixed the PREDICATE and not the CLASS. A read still in
 * flight, a workspace whose record the caller may not see, and a read that errored all produce the
 * identical all-zeros input, and on this surface the in-flight one is the MOST reachable of the
 * three, not the least: `useSoloCampaigns` issues six round trips to `useSocialCommand`'s two, and
 * flips itself to `loading` synchronously on every tenant switch. "Has not been read" is true of
 * all three; "could not be read" was true of only one.
 *
 * It does lose the failed-vs-in-flight-vs-refused distinction, and an earlier version of this
 * comment defended that by claiming the panel beside the figure carried it. Driven, it did not: a
 * failed campaigns read renders no skeleton, no alert and no retry anywhere on the page. So this
 * sentence carries the whole weight, and it is written to be true on its own rather than to lean
 * on a neighbour that was not there.
 *
 * One home for the sentence (§18) because it now appears on seven figures across three builders,
 * and a phrasing that drifts between them would read as several conditions rather than one.
 */
const UNREAD_NOTE = "This has not been read, so nothing is claimed either way.";
const unread = (): SocialValue<number> => ({ state: "UNAVAILABLE", value: null, note: UNREAD_NOTE });

/**
 * The networks this workspace can record.
 *
 * The set is the UNION of the two places the platform already names networks in tenant-visible
 * text: the Systems Check registry question (`supabase/migrations/20260816000000_systems_check_layer1.sql:255`
 * — Instagram, Facebook, LinkedIn, TikTok, X) and the channels the Social surface shows (which adds
 * YouTube). Keeping them a union rather than picking one avoids a surface and a check disagreeing
 * about which networks exist. The same list is the allow-list in `record_social_handles`; widening
 * one without the other lets a handle be typed here and refused by the server.
 */
export const SOCIAL_NETWORKS = [
  { key: "instagram", label: "Instagram", hint: "@yourbusiness" },
  { key: "facebook", label: "Facebook", hint: "facebook.com/yourbusiness" },
  { key: "linkedin", label: "LinkedIn", hint: "linkedin.com/company/yourbusiness" },
  { key: "youtube", label: "YouTube", hint: "@yourbusiness" },
  { key: "tiktok", label: "TikTok", hint: "@yourbusiness" },
  { key: "x", label: "X", hint: "@yourbusiness" },
] as const;

export type SocialNetworkKey = (typeof SOCIAL_NETWORKS)[number]["key"];

export type SocialHandle = { network: SocialNetworkKey; label: string; handle: string };

const NETWORK_LABEL: Record<string, string> = Object.fromEntries(
  SOCIAL_NETWORKS.map((n) => [n.key, n.label]),
);

/**
 * Read declared handles off `tenants.features`.
 *
 * THE SHAPE IS LOAD-BEARING, NOT STYLISTIC. `social_handles_captured.ts:21-23` counts an object's
 * values with `hasText`, which is true only of a non-empty STRING. A nested value — the natural
 * rich shape `{instagram:{handle,url}}` — counts as zero there, so a surface that stored it would
 * show handles on record while the Systems Check reported none, on the very check this surface
 * exists to make completable. So: flat object of strings. The array forms are accepted on read
 * only because the runner accepts them and a row written before this surface existed may use one.
 */
export function readSocialHandles(features: unknown): SocialHandle[] {
  const raw = (features as Record<string, unknown> | null | undefined)?.social_handles;
  if (!raw) return [];
  const out: SocialHandle[] = [];
  const push = (network: string, handle: unknown) => {
    if (typeof handle !== "string" || !handle.trim()) return;
    const key = network.trim().toLowerCase();
    if (!NETWORK_LABEL[key]) return;
    if (out.some((entry) => entry.network === key)) return;
    out.push({ network: key as SocialNetworkKey, label: NETWORK_LABEL[key], handle: handle.trim() });
  };
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (typeof entry === "string") continue; // a bare handle names no network; it cannot be placed
      if (entry && typeof entry === "object") {
        const row = entry as { network?: unknown; handle?: unknown };
        if (typeof row.network === "string") push(row.network, row.handle);
      }
    }
  } else if (typeof raw === "object") {
    for (const [network, handle] of Object.entries(raw as Record<string, unknown>)) push(network, handle);
  }
  return out.sort(
    (a, b) =>
      SOCIAL_NETWORKS.findIndex((n) => n.key === a.network) -
      SOCIAL_NETWORKS.findIndex((n) => n.key === b.network),
  );
}

/** What the form sends. Empty strings are dropped rather than stored — see `toHandlePayload`. */
export function toHandlePayload(draft: Record<string, string>): Record<string, string> {
  const payload: Record<string, string> = {};
  for (const network of SOCIAL_NETWORKS) {
    const value = (draft[network.key] ?? "").trim();
    // A cleared field is an OMISSION, not a stored blank. `hasText` ignores "" anyway, so a stored
    // empty string would be a key the check cannot count and a person can still see — the two must
    // never disagree about how many accounts are on record.
    if (value) payload[network.key] = value;
  }
  return payload;
}

/* ─────────────────────────── the modules ─────────────────────────── */

export type SocialKpi = {
  id: string;
  label: string;
  glyph: string;
  figure: SocialValue<number>;
  /** What the figure counts, or — when there is none — what would have to exist for there to be one. */
  detail: string;
};

export type SocialPipelineStage = {
  id: string;
  label: string;
  figure: SocialValue<number>;
  detail: string;
  /** Which accent the stage carries. Semantic, never decorative. */
  tone: "neutral" | "attention" | "positive" | "failing";
};

/** The connection lifecycle's own vocabulary (EXP07 row 9) — never translated at the source. */
export type SocialConnectionStatus = "connected" | "authorizing" | "needs_reauth" | "error" | "setup_required" | "disconnected";

/** One network's readiness as the governed presence read proved it. */
export type SocialChannelConnection = {
  status: SocialConnectionStatus;
  /** The connected identity's own label, when the lifecycle recorded one. */
  label: string | null;
  /** When the provider last verified it, ISO. Null when it has never been verified. */
  verifiedAt: string | null;
  /** How many profiles exist for this network (the primary is what `status` describes). */
  profiles: number;
};

export type SocialChannelCard = {
  network: string;
  label: string;
  handle: string;
  reach: SocialValue<number>;
  detail: string;
  /** The connection readiness for this network, or null when no connection row exists (EXP07 row 9). */
  connection: SocialChannelConnection | null;
  /** The readiness line in the owner's words — present whether or not a connection exists. */
  connectionNote: string;
};

export type SocialInsight = {
  id: string;
  title: string;
  summary: string | null;
  /** The desk that filed it, in the platform's own words. */
  department: string;
  createdAt: string;
  rationale: string | null;
};

export type SocialGovernanceRow = { label: string; lane: "auto" | "confirm" | "off"; copy: string };

export const LANE_COPY: Record<"auto" | "confirm" | "off", string> = {
  auto: "Runs automatically",
  confirm: "Drafts for you",
  off: "Always your call",
};

/** Inputs the surface has actually read. Every field is a real tenant-scoped read or an absence. */
export type SocialCommandInput = {
  handles: SocialHandle[];
  /** Each network's connection readiness, from the same governed presence read (EXP07 row 9). */
  connections: Array<SocialChannelConnection & { network: string }>;
  /** Published pages + active funnels + active forms, from `useSoloCampaigns`. */
  publishedOutputs: number;
  /** Forms whose routing is approval-gated — work genuinely held for a person. */
  approvalGatedForms: number;
  /** Forms carrying a recorded failed dispatch. */
  formsNeedingRepair: number;
  /** Rows in `growth_form_submissions` for this workspace. */
  capturedSubmissions: number;
  /** Filed actions in `confirm` that name a growth-facing desk. */
  waitingOnYou: number;
  /**
   * The read that produces `waitingOnYou` FAILED.
   *
   * Without this the tile cannot tell "nothing is waiting" from "I could not look", because both
   * arrive as a count of zero — and it asserted the first. The PAIGE sees panel beside it has always
   * drawn that distinction (`useSoloPendingActions` returns `error` precisely so a failed read is
   * not read as an empty one); the tile did not, so the same surface said two different things about
   * the same read. A failed read is not an empty result (§13).
   */
  waitingUnknown?: boolean;
  /**
   * The read that produces `publishedOutputs`, `approvalGatedForms`, `formsNeedingRepair` and
   * `capturedSubmissions` FAILED.
   *
   * The twin of `waitingUnknown`, and it was missed on the first pass — which is exactly why the
   * §39 peer-gate exists. `useSoloCampaigns` returns `{ phase: "error", ...empty }`, so ALL FOUR of
   * those counts collapse to zero on a failed read, and four different sentences then asserted an
   * absence: "every recorded delivery of yours succeeded", "you have not published anything yet",
   * "no form of yours is waiting on an approval", "no form of yours has a recorded response yet".
   *
   * The first of those is the one that would actually cost someone something. A captured lead can
   * be failing to deliver at this moment and the surface would report every delivery as a success —
   * a §13 lie with a real business consequence, not a cosmetic one. Half this surface got the
   * `waitingUnknown` treatment and the half next door did not; this closes it.
   */
  campaignsUnknown?: boolean;
  /**
   * The presence read did not return this workspace's accounts — refused, or unreadable.
   *
   * The THIRD fallible source, and the one neither original flag covered.
   * `get_social_presence_evidence` has three distinct refusals ('not permitted for this account',
   * 'workspace record not readable', 'workspace not resolved'), and all three arrive as a
   * successful response carrying zero on-record rows. Without this the surface told a team member
   * who is simply not a tenant admin that "PAIGE does not know which accounts are yours" and
   * offered them a Record accounts button they cannot complete — an assertion about a record they
   * were refused sight of, plus a §70 dead end, on a screen whose own Channels panel said the
   * opposite two panels down.
   */
  handlesUnknown?: boolean;
};

/**
 * The five KPI tiles.
 *
 * Only ONE of them has a source, and that is the honest answer rather than a disappointing one:
 * a declared handle is a real record this workspace owns and can change. The other four each name
 * one of the five things the panel this replaces explicitly refused to infer — accounts, followers,
 * publishing queue, schedules, placements — and they keep refusing.
 */
/**
 * The order the five tiles are READ in, which is not the order they are defined in.
 *
 * A command surface leads with what can be acted on. The first three tiles can each carry a real
 * figure; the last two are structural absences and sit together so they read as one row of things
 * not yet possible rather than as two failures scattered through the strip. Nothing is hidden
 * (§58) and nothing about any tile's state, value or note changes — this is the reading order only.
 */
const KPI_ORDER = ["waiting", "channels", "captured", "queue", "placements"] as const;

export function buildKpis(input: SocialCommandInput): SocialKpi[] {
  const tiles: SocialKpi[] = [
    {
      id: "channels",
      label: "Accounts on record",
      glyph: "users",
      figure: input.handlesUnknown
        ? unread()
        : {
            state: input.handles.length ? "PARTIAL" : "UNAVAILABLE",
            value: input.handles.length || null,
            note: input.handles.length
              ? "You told PAIGE these are yours. That is a record, not a connection."
              : "You have not told PAIGE which accounts are yours yet.",
          },
      detail: input.handlesUnknown
        ? "This part of the workspace record is not yours to see, so nothing here says whether any account is on it."
        : input.handles.length
          ? `${input.handles.map((h) => h.label).join(" · ")}`
          : "Name the accounts you post from — PAIGE works from them every time she drafts for you.",
    },
    {
      id: "queue",
      label: "Publishing queue",
      glyph: "clock",
      figure: absent("No account is connected to publish through, so nothing can be queued for you."),
      detail: "Connecting an account is what turns this on. No social account can be connected yet.",
    },
    {
      id: "placements",
      label: "Recorded placements",
      glyph: "spark",
      figure: absent("No supported provider has told PAIGE where any of your work went live."),
      detail: "A connection is what turns this on. No social account can be connected yet.",
    },
    {
      id: "waiting",
      label: "Waiting on you",
      glyph: "bell",
      figure: input.waitingUnknown
        ? unread()
        : {
            state: input.waitingOnYou ? "PARTIAL" : "UNAVAILABLE",
            value: input.waitingOnYou || null,
            note: input.waitingOnYou
              ? "PAIGE prepared it and stopped. The default for these desks is to draft, not to send."
              : "Nothing is waiting on your decision right now.",
          },
      detail: "Drafts PAIGE has ready for your call, from marketing, sales, client and owner work.",
    },
    {
      id: "captured",
      label: "Captured responses",
      glyph: "doc",
      figure: input.campaignsUnknown
        ? unread()
        : {
            state: input.capturedSubmissions ? "PARTIAL" : "UNAVAILABLE",
            value: input.capturedSubmissions || null,
            note: input.capturedSubmissions
              ? "Responses recorded on your forms."
              : "No form of yours has a recorded response yet.",
          },
      // The single most tempting lie on this surface. `growth_form_submissions.source` holds a
      // capture-mechanism label ('paige_form' / 'external:<provider>'), never a marketing channel,
      // so no count here can be attributed to social. Say that rather than implying attribution.
      detail: "Nothing records where a response came from, so none of these is credited to social.",
    },
  ];
  return KPI_ORDER.map((id) => tiles.find((tile) => tile.id === id)!);
}

/**
 * The six pipeline stages.
 *
 * Two of them are real, and they are the two this workspace's own records can answer: work held
 * for approval, and work already published. The other four name a store the platform does not have,
 * and the stage says which one rather than showing a zero that reads like an empty inbox.
 */
export function buildPipeline(input: SocialCommandInput): SocialPipelineStage[] {
  return [
    {
      id: "ideas",
      label: "Ideas",
      figure: absent("Nothing here holds an idea list for you."),
      detail: "Work an idea up in Vibe Studio and it lands here the moment you publish it.",
      tone: "neutral",
    },
    {
      id: "drafting",
      label: "Drafting",
      figure: absent("Vibe Studio does not tell this page what you have in progress."),
      detail: "Your drafts stay in Vibe Studio until you publish them, then they show up here.",
      tone: "neutral",
    },
    {
      id: "review",
      label: "Held for you",
      figure: input.campaignsUnknown
        ? unread()
        : {
            state: input.approvalGatedForms ? "PARTIAL" : "UNAVAILABLE",
            value: input.approvalGatedForms || null,
            note: input.approvalGatedForms
              ? "Published forms set to wait for a person before anything is sent."
              : "No form of yours is waiting on an approval.",
          },
      detail: "Nothing goes out from these until you approve it.",
      tone: "attention",
    },
    {
      id: "scheduled",
      label: "Scheduled",
      figure: absent("No schedule is inferred. Nothing here holds a scheduled post for you."),
      detail: "Connect an account and PAIGE can hold a post for a date. None can be connected yet.",
      tone: "neutral",
    },
    {
      id: "published",
      label: "Published outputs",
      figure: input.campaignsUnknown
        ? unread()
        : {
            state: input.publishedOutputs ? "PARTIAL" : "UNAVAILABLE",
            value: input.publishedOutputs || null,
            note: input.publishedOutputs
              ? "Your published pages, active funnels and active forms."
              : "You have not published anything yet.",
          },
      // Deliberately NOT called social content. These are pages, funnels and forms; presenting them
      // as posts would be the mislabel that makes an honest number dishonest.
      detail: "Your pages, funnels and forms — ready to be placed, not yet placed anywhere.",
      tone: "positive",
    },
    {
      id: "repair",
      label: "Needs repair",
      // "Every recorded delivery of yours succeeded" is the highest-consequence sentence on this
      // page: a lead can be failing to reach someone right now, and on a failed read all four
      // campaign counts arrive as zero. It says nothing rather than the opposite of the truth.
      figure: input.campaignsUnknown
        ? unread()
        : {
            state: input.formsNeedingRepair ? "PARTIAL" : "UNAVAILABLE",
            value: input.formsNeedingRepair || null,
            note: input.formsNeedingRepair
              ? "Your published forms with a delivery that did not succeed."
              : "Every recorded delivery of yours succeeded.",
          },
      detail: "A response was captured and could not be delivered where you routed it.",
      tone: "failing",
    },
  ];
}

/**
 * One card per declared account.
 *
 * A handle proves the account exists and is this business's. It proves nothing about audience or
 * performance, so `reach` is absent on every card, always — there is no branch in which a declared
 * handle produces a number. That is the point: the card is a record, drawn as a record.
 */
/**
 * What each connection state says to the owner. The states are the lifecycle's own; the sentences
 * are the surface's. A connection NEVER produces a figure — `reach` stays absent in every branch
 * (the contract test pins this) — and `connected` explicitly says what it does not grant.
 */
const CONNECTION_COPY: Record<SocialConnectionStatus, string> = {
  connected: "Connected. This is consent to read the account, not to publish: posting and audience numbers stay off until you turn them on.",
  authorizing: "Authorization is in progress. Nothing can be posted from it yet.",
  needs_reauth: "This connection needs you to sign in again before anything can read or post on the account.",
  error: "This connection is in an error state. Reconnect it from Settings → Integrations before planning anything against it.",
  setup_required: "This connection still needs its one-time setup finished before it can read anything.",
  disconnected: "This connection was disconnected. The account on record stays on record; nothing is connected.",
};

export function buildChannels(handles: SocialHandle[], connections: Array<SocialChannelConnection & { network: string }> = []): SocialChannelCard[] {
  const readiness = new Map(connections.map((c) => [c.network, c]));
  return handles.map((handle) => {
    const connection = readiness.get(handle.network) ?? null;
    const reachNote = connection?.status === "connected"
      ? "Connected, but no audience or performance number reaches you while analytics stay off."
      : "No provider is connected to this account, so no audience or performance number reaches you.";
    return {
      network: handle.network,
      label: handle.label,
      handle: handle.handle,
      reach: absent(reachNote),
      detail: connection ? CONNECTION_COPY[connection.status] : "On record",
      connection,
      connectionNote: connection
        ? `${CONNECTION_COPY[connection.status]}${connection.profiles > 1 ? ` (${connection.profiles} profiles — the state shown is the best one.)` : ""}`
        : "On record, not connected. Connecting a channel is a Settings → Integrations action you take yourself.",
    };
  });
}

/** The desks whose filed work belongs on a growth surface. Slugs are the seeded §16 department set. */
const GROWTH_DESKS = new Set(["marketing", "sales", "client_experience", "owner_ops"]);

export function isGrowthDesk(department: string): boolean {
  return GROWTH_DESKS.has(department.trim().toLowerCase().replace(/\s+/g, "_"));
}

/**
 * The executive brief line.
 *
 * Composed only from figures already proven above. It never characterises momentum, engagement or
 * opportunity, because nothing measures any of those for this workspace — the line states what is
 * on record and what is not, in that order, and stops.
 */
export function buildBrief(input: SocialCommandInput): { headline: string; body: string } {
  const parts: string[] = [];
  if (input.handles.length) {
    parts.push(
      `${input.handles.length} account${input.handles.length === 1 ? "" : "s"} on record (${input.handles
        .map((h) => h.label)
        .join(", ")})`,
    );
  }
  // A count whose read failed is not a count. The brief led with "4 items waiting on your decision"
  // off a stale list while the tile beside it said the read had failed — one surface, two answers
  // about one read, which is the failure this whole page is built against.
  if (input.publishedOutputs && !input.campaignsUnknown) {
    parts.push(`${input.publishedOutputs} published output${input.publishedOutputs === 1 ? "" : "s"}`);
  }
  if (input.waitingOnYou && !input.waitingUnknown) {
    parts.push(`${input.waitingOnYou} item${input.waitingOnYou === 1 ? "" : "s"} waiting on your decision`);
  }

  const unreadSources = [
    input.handlesUnknown ? "which accounts are on record" : null,
    input.waitingUnknown ? "what PAIGE is holding for you" : null,
    input.campaignsUnknown ? "your published work" : null,
  ].filter(Boolean) as string[];
  if (unreadSources.length) {
    const named = unreadSources.join(" and ");
    return {
      headline: "Part of this page has not been read.",
      body: parts.length
        ? `${parts.join(", ")}. ${named[0].toUpperCase()}${named.slice(1)} has not been read, so nothing on this page claims anything about ${unreadSources.length > 1 ? "any of that" : "it"} either way. Nothing was changed.`
        : `${named[0].toUpperCase()}${named.slice(1)} has not been read. That is not the same as having nothing on record, so nothing here is claimed either way. Nothing was changed.`,
    };
  }

  if (!parts.length) {
    return {
      headline: "Nothing is on record yet.",
      body:
        "PAIGE does not know which accounts are yours, and you have not published anything for her to work with. Name the accounts you post from and she has something to draft against — that is the whole of what this page needs from you today.",
    };
  }
  return {
    headline: "PAIGE is working from what you have given her.",
    body: `${parts.join(", ")}. No account is connected for publishing, so nothing here reports followers, reach, a queue, a schedule, or where anything went live.`,
  };
}

/* ─────────────────────────── the next move ─────────────────────────── */

/**
 * The one thing to do next, and the control that does it.
 *
 * WHY THIS EXISTS. The surface could already answer what is happening, what is working, what needs
 * attention, what PAIGE is holding, and what it has produced. It could not answer the sixth
 * question a person actually opens it for — *what should I do?* — and a page that reports five
 * answers and withholds the sixth is a status console however honest the five are.
 *
 * IT INVENTS NOTHING. Every branch is keyed on a field already on `SocialCommandInput`, and every
 * destination is a control that already exists. There is no scoring, no confidence, no ranking
 * model — just a fixed precedence over facts, so the same inputs always yield the same move and a
 * reader can check it by hand. The ladder is TOTAL: the last branch has no condition.
 *
 * IT IS DELIBERATELY NOT EXHAUSTIVE. `capturedSubmissions` drives no branch, because any move
 * derived from it would be an attribution claim — and this file already records why that is the
 * single most tempting lie available here (see the `captured` tile). A ladder that declines the
 * move it cannot justify is the point.
 */
export type SocialNextAction =
  | { kind: "record"; label: string }
  | { kind: "studio"; label: string }
  | { kind: "compass"; label: string }
  | { kind: "pipeline"; label: string }
  | { kind: "paige"; label: string };

export type SocialNextMove = {
  /** Why this is the move, in one line. */
  headline: string;
  /** What doing it changes. */
  detail: string;
  action: SocialNextAction;
};

export function buildNextMove(input: SocialCommandInput): SocialNextMove {
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

  // 1. A response was captured and did not reach you. Everything else can wait behind that.
  if (input.formsNeedingRepair > 0) {
    return {
      headline: `${plural(input.formsNeedingRepair, "form is", "forms are")} not delivering.`,
      detail:
        "A response came in and could not be delivered where you routed it. The recorded outcomes are under Pipeline, with the form that produced them.",
      action: { kind: "pipeline", label: "Open Pipeline" },
    };
  }

  // 2. Work she has finished and is not permitted to send on her own. It is yours to release.
  if (input.waitingOnYou > 0 && !input.waitingUnknown) {
    return {
      headline: `PAIGE is holding ${plural(input.waitingOnYou, "draft", "drafts")} for your call.`,
      detail:
        "She has prepared them and stopped, because the default for these desks is to draft rather than send. Trust Compass is where you clear them.",
      action: { kind: "compass", label: "Open Trust Compass" },
    };
  }

  // 3. First use. She cannot reference an account she has never been told about, and this is the
  //    one thing on this page a person can finish today.
  //    Gated on the record having been READ: a member who is not a tenant admin is refused sight
  //    of it, and telling them PAIGE does not know their accounts — then handing them a button they
  //    cannot complete — is an assertion about a record they were not shown (§13) and a dead end
  //    (§70).
  if (input.handles.length === 0 && !input.handlesUnknown) {
    return {
      headline: "PAIGE does not know which accounts are yours.",
      detail:
        "Name the accounts you post from and she works from them every time she drafts. It is also what the social accounts item on your Systems Check is asking for.",
      action: { kind: "record", label: "Record accounts" },
    };
  }

  // 4. She knows where you post and has nothing of yours to put there.
  //    Gated on the read having SUCCEEDED: on a failed campaigns read `publishedOutputs` is zero
  //    like everything else, and this branch would send a person to Vibe Studio to rebuild work
  //    they may already have. A next move computed from an unread source is worse than none.
  if (input.publishedOutputs === 0 && !input.campaignsUnknown) {
    return {
      headline: "There is nothing published to put in front of anyone.",
      detail:
        "Build a page, funnel or form in Vibe Studio. It appears here under Published outputs the moment you publish it.",
      action: { kind: "studio", label: "Open Vibe Studio" },
    };
  }

  // 5. A read failed, so there is no honest instruction to give. This branch exists because the
  //    ladder used to fall straight through to branch 6 and assert an empty queue on exactly the
  //    read branch 2 had just refused to speak for — the same defect the `waitingUnknown` guard was
  //    added to fix, reappearing forty lines below the guard. Caught by the §39 peer-gate, not by
  //    the test written alongside the guard, which asserted where the ladder GOES and never what
  //    it SAYS.
  if (input.waitingUnknown || input.campaignsUnknown || input.handlesUnknown) {
    return {
      headline: "Part of this page has not been read.",
      // "Reload to try the read again" was REMOVED here in the previous commit and replaced with a
      // claim that the panel beside the figure carries the detail. The peer-gate drove it: on a
      // failed campaigns read there is no skeleton, no alert and no retry anywhere on the page, so
      // the replacement was false AND it dropped the only recovery instruction the surface had
      // (§58 — a shipped affordance removed without being named). Restored, and the false claim
      // about the neighbouring panel is gone.
      detail:
        "Nothing was changed and nothing is claimed either way. Reload the page to try the read again, or ask PAIGE — she reads these from the same records and can tell you what she sees.",
      action: { kind: "paige", label: "Ask PAIGE" },
    };
  }

  // 6. Nothing is broken and nothing is waiting. The honest move is the conversation, because the
  //    surface itself has no further act to offer until a provider connection exists.
  return {
    headline: "Nothing is waiting on you here.",
    detail:
      "Your accounts are on record and your published work is up to date. Ask PAIGE what to make next — she drafts against the accounts you have named.",
    action: { kind: "paige", label: "Ask PAIGE" },
  };
}

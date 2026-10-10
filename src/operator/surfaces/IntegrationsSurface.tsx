import { useMemo, useState } from "react";

/**
 * Settings → Integrations — the connection grid.
 *
 * PORTED FROM the v3 pack, not from memory and not from the superseded `super-admin-shell/`:
 *   markup   `PAIGE Super Admin Shell v3.dc.html` L1577–L1659  (the `showInts` block)
 *   geometry `PAIGE Super Admin Shell v3.dc.html` L7928–L8082  (`intVals(on)`)
 *   contract `paige-ia.js` L1464–L1471 (`P.INT_KINDS`) and L1473–L1538 (`P.INTEGRATIONS`)
 *
 * `PORT-SPEC-palette-and-six-surfaces.md` lists an "Integrations grid" as its §7 but the
 * document body ends after §5 (1392 lines), so §7 was never written. The pack itself draws
 * the surface in full, so this is a port, never a blocker (PACK-FIRST).
 *
 * WHAT IS STRUCTURE HERE, AND WHY THE CATALOGUE COMES OVER. `P.INTEGRATIONS` is not a fixture
 * set: it carries no invented figure, no tenant name, no timestamp and no sample prose. It is
 * the pack's own grounded contract about this repo — the pack states the rule above it
 * ("live = a seam exists in supabase/functions today; stub = the adapter is written and
 * waiting on credentials; planned = nothing built"), and `corrections-2026-08-23.md` §4 shows
 * CC correcting an entry in it (Stripe's note) rather than treating it as disposable. So the
 * eight shelves, the forty-two named vendors, their kind, what each does, the note and the
 * `blocks` line all port verbatim, exactly as `P.SUMMONS`'s row `name`/`status` pairs do.
 *
 * `connectionStates` is the drop-in for backend slice I (`usePlatformConfig`): a live read of
 * what is actually connected overrides the catalogue's authored state per vendor. Nothing here
 * writes that hook — it is another agent's file — and the surface renders correctly without it.
 *
 * ELEVATION — RULING F (Claude Design, 2026-08-23): elevation is distance from `--pg-env`, and
 * `--pg-surface`/`--pg-workspace` both sit ABOVE canvas in dark and BELOW it in light, so a
 * plate painted on either RECEDES in light. Applied per element:
 *   vendor tile        RISES   → `--pg-raised` (pack L8050 paints `--pg-workspace`, which inverts)
 *   tile monogram well RECEDES → `--pg-surface` (pack L8044, kept: inside a raised parent it is
 *                                darker in BOTH themes, so the role does not invert)
 *   search field       RECEDES → `--pg-surface` (pack L8071 paints `--pg-canvas`, which is darker
 *                                than the workspace ground in dark and LIGHTER in light)
 *   shelf gutter       neither → `--pg-line-soft`, a line token, ported verbatim
 *
 * TWO RAW HEXES ARE PORTED VERBATIM. `KIND_TONE` (pack L7986–L7988) is four `--pg-*` tokens plus
 * `MCP:'#2F6B8F'` and `CalDAV:'#3F7F5C'`. No token carries either value, so substituting one
 * would be inventing a design decision rather than porting it. Both are decorative marks (a 6px
 * diamond and a 2px rail), never text. Reported rather than silently resolved (§13/§00).
 */

export type IntegrationKind = "OAuth" | "Key" | "Webhook" | "MCP" | "SMTP" | "CalDAV";
export type IntegrationState = "live" | "stub" | "planned";

export type IntegrationItem = {
  readonly name: string;
  readonly kind: IntegrationKind;
  readonly state: IntegrationState;
  readonly does: string;
  readonly note: string;
  readonly blocks?: string;
};
export type IntegrationShelf = { readonly cat: string; readonly items: readonly IntegrationItem[] };

/** `paige-ia.js` L1464–L1471 — verbatim. */
export const INT_KINDS: Readonly<Record<IntegrationKind, { note: string; glyph: string }>> = {
  OAuth: { note: "You sign in at the vendor and grant scopes", glyph: "M6.4 8.6a3.4 3.4 0 0 1 4.8-4.8l1.4 1.4 M9.6 7.4a3.4 3.4 0 0 1-4.8 4.8L3.4 10.8" },
  Key: { note: "A secret you paste, stored encrypted", glyph: "M10.4 2.6a3 3 0 1 1-2.6 4.6L3 12v1.4h1.6l.6-1.4h1.4v-1.4h1.4l1.2-1.2a3 3 0 0 1 3.2-4.6" },
  Webhook: { note: "They call us on a URL we mint", glyph: "M4.6 9.4a3 3 0 1 0 3 3 M8 6.4l2.4 4.2 M11.4 6a3 3 0 1 0-3.4-1.4" },
  MCP: { note: "A tool server she can call directly", glyph: "M3 5.4h10v5.2H3z M5.4 5.4V3.4 M10.6 5.4V3.4 M5.4 12.6v-2 M10.6 12.6v-2" },
  SMTP: { note: "Host, port and a mailbox password", glyph: "M2.4 4.6h11.2v6.8H2.4z M2.4 4.6L8 9l5.6-4.4" },
  CalDAV: { note: "A calendar URL and an app password", glyph: "M2.6 4h10.8v9.4H2.6z M2.6 6.8h10.8 M5.6 4V2.4 M10.4 4V2.4" },
};

/** `paige-ia.js` L1473–L1538 — verbatim, eight shelves, forty-two vendors. */
export const INTEGRATIONS: readonly IntegrationShelf[] = [
  { cat: "Email and messaging", items: [
    { name: "Resend", kind: "Key", state: "live", does: "Transactional and campaign email", note: "The platform email adapter" },
    { name: "Gmail", kind: "OAuth", state: "live", does: "Send and read from a real mailbox", note: "Its own seam, not a second email adapter" },
    { name: "Twilio SMS", kind: "Key", state: "live", does: "Outbound and inbound text", note: "API-key trio · A2P messaging service" },
    { name: "Twilio Voice", kind: "Key", state: "stub", does: "Place and receive calls", note: "Webhook still on the Twilio demo URL", blocks: "The call surface in Conversations" },
    { name: "Microsoft Outlook", kind: "OAuth", state: "planned", does: "Mail for Microsoft accounts", note: "" },
    { name: "Slack", kind: "OAuth", state: "planned", does: "Notify a channel, take a reply", note: "" },
    { name: "WhatsApp Business", kind: "Key", state: "planned", does: "Messaging where clients already are", note: "Runs through Twilio or Meta" },
    { name: "Postmark", kind: "Key", state: "planned", does: "Alternative transactional email", note: "" },
    { name: "Generic SMTP", kind: "SMTP", state: "planned", does: "Any mailbox that speaks SMTP", note: "" },
  ]},
  { cat: "Calendar and scheduling", items: [
    { name: "Google Calendar", kind: "OAuth", state: "live", does: "Read and write events", note: "Refresh tokens encrypted at rest" },
    { name: "Microsoft 365 Calendar", kind: "OAuth", state: "planned", does: "Events for Microsoft accounts", note: "", blocks: "Calendars for Microsoft users" },
    { name: "Apple Calendar", kind: "CalDAV", state: "stub", does: "Events over CalDAV", note: "App-password path exists, unwired", blocks: "Calendars for Apple users" },
    { name: "Fastmail", kind: "CalDAV", state: "planned", does: "Events over CalDAV", note: "" },
    { name: "Calendly", kind: "OAuth", state: "planned", does: "Import bookings taken elsewhere", note: "" },
    { name: "Cal.com", kind: "OAuth", state: "planned", does: "Open-source booking", note: "" },
  ]},
  { cat: "Models and voice", items: [
    { name: "Anthropic", kind: "Key", state: "live", does: "The model she thinks with", note: "Replaced the Lovable gateway" },
    { name: "OpenAI", kind: "Key", state: "planned", does: "Alternative or fallback model", note: "Routing lives in Settings · Mind" },
    { name: "Google Gemini", kind: "Key", state: "planned", does: "Alternative model", note: "" },
    { name: "ElevenLabs", kind: "Key", state: "planned", does: "Her voice, spoken", note: "", blocks: "Her speaking on a call" },
    { name: "Deepgram", kind: "Key", state: "planned", does: "Transcribe a call as it happens", note: "", blocks: "Live notes while she listens" },
  ]},
  { cat: "Automation and tools", items: [
    { name: "n8n", kind: "Webhook", state: "stub", does: "Run a self-hosted workflow", note: "Action kinds already modelled", blocks: "Handing a step outside the platform" },
    { name: "Zapier", kind: "Webhook", state: "planned", does: "Reach six thousand apps", note: "" },
    { name: "Make", kind: "Webhook", state: "planned", does: "Visual multi-step scenarios", note: "" },
    { name: "Outbound webhooks", kind: "Webhook", state: "planned", does: "Post an event anywhere", note: "" },
    { name: "PAIGE MCP server", kind: "MCP", state: "live", does: "Exposes her tools to a client", note: "Operator tools are god-locked" },
    { name: "Claude Desktop", kind: "MCP", state: "planned", does: "Drive the platform from Claude", note: "" },
    { name: "Custom MCP server", kind: "MCP", state: "planned", does: "Bring a tool server of your own", note: "" },
  ]},
  { cat: "Money", items: [
    { name: "Stripe", kind: "Key", state: "planned", does: "Subscriptions and invoices", note: "Operator metrics read (L1) and marketplace paid installs charge. Subscription billing is the part that is not wired.", blocks: "Tenant subscription billing" },
    { name: "Stripe Connect", kind: "OAuth", state: "planned", does: "Pay marketplace publishers", note: "", blocks: "The marketplace revenue split" },
    { name: "QuickBooks", kind: "OAuth", state: "planned", does: "Push invoices to the books", note: "" },
    { name: "Xero", kind: "OAuth", state: "planned", does: "Push invoices to the books", note: "" },
  ]},
  { cat: "Records and data", items: [
    { name: "HubSpot", kind: "OAuth", state: "planned", does: "Two-way contact and deal sync", note: "" },
    { name: "Salesforce", kind: "OAuth", state: "planned", does: "Two-way contact and deal sync", note: "" },
    { name: "Dun & Bradstreet", kind: "OAuth", state: "stub", does: "Verify a business is real", note: "Adapter written, waiting on credentials", blocks: "Business verification on a client record" },
    { name: "Apollo", kind: "Key", state: "planned", does: "Enrich a thin record", note: "" },
  ]},
  { cat: "Files and signing", items: [
    { name: "Google Drive", kind: "OAuth", state: "planned", does: "Read and file documents", note: "" },
    { name: "Dropbox", kind: "OAuth", state: "planned", does: "Read and file documents", note: "" },
    { name: "DocuSign", kind: "OAuth", state: "planned", does: "Send an agreement for signature", note: "" },
  ]},
  { cat: "Social", items: [
    { name: "LinkedIn", kind: "OAuth", state: "planned", does: "Publish, and take DMs", note: "", blocks: "Social publishing and DM threads" },
    { name: "Meta", kind: "OAuth", state: "planned", does: "Instagram and Facebook Pages", note: "One grant, two surfaces", blocks: "Two of the five social channels" },
    { name: "X", kind: "OAuth", state: "planned", does: "Publish, and take DMs", note: "", blocks: "Social publishing and DM threads" },
    { name: "Google Business Profile", kind: "OAuth", state: "planned", does: "Posts and reviews", note: "", blocks: "Review monitoring" },
  ]},
];

/** Pack L7936–L7946 — `[label, tone, note]` per state, plus the two derived consequence axes. */
const ST = {
  live: ["Implemented adapter", "var(--pg-positive)", "Catalogue readiness; account access and health unverified"],
  stub: ["Half-wired", "var(--pg-warning)", "The adapter is written and waiting on credentials"],
  planned: ["Not built", "var(--pg-faint)", "Nothing exists yet"],
  blocking: ["Blocking", "var(--pg-negative)", "A built surface is dark without this"],
  nice: ["Nice to have", "var(--pg-faint)", "Blocks nothing we have built"],
} as const;
type Axis = keyof typeof ST;

/** Pack L7986–L7988 — verbatim. MCP and CalDAV carry raw hexes in the pack; see the file head. */
const KIND_TONE: Readonly<Record<IntegrationKind, string>> = {
  OAuth: "var(--pg-gold)",
  Key: "var(--pg-gold-deep)",
  Webhook: "var(--pg-violet)",
  MCP: "#2F6B8F",
  SMTP: "var(--pg-line-strong)",
  CalDAV: "#3F7F5C",
};

/** Pack L8078 — the words the result line uses for each active filter. */
const FILTER_WORD: Readonly<Record<Axis, string>> = {
  live: "marked ready / implemented",
  stub: "half-wired",
  planned: "not built",
  blocking: "blocking a built surface",
  nice: "nice to have",
};

/** Pack L8081 — the closing paragraph, verbatim. */
const INT_FOOT =
  "Catalogue readiness describes implementation, not verified account access or provider health. Half-wired describes an adapter awaiting its remaining setup. Blocking is the one that ranks the list: the catalogue identifies dependencies of built surfaces. Those descriptions need runtime revalidation. A supplied connection read overrides only the vendors it actually reports; other vendors keep catalogue-only provenance.";

type Row = IntegrationItem & { readonly cat: string; readonly reported: boolean };

export type IntegrationsSurfaceProps = {
  /** The pack's catalogue by default; a caller may narrow it. Structure, not a fixture. */
  readonly shelves?: readonly IntegrationShelf[];
  /**
   * Backend slice I drop-in (`usePlatformConfig`). A live read of what is actually connected,
   * keyed by vendor name, overrides the catalogue's authored state. Absent → the catalogue's.
   */
  readonly connectionStates?: Readonly<Record<string, IntegrationState>>;
  /** Pack L8055 — a tile opens the `integration` summon. The shell owns that; this reports it. */
  readonly onOpen?: (item: Row) => void;
};

export default function IntegrationsSurface({
  shelves = INTEGRATIONS,
  connectionStates,
  onOpen,
}: IntegrationsSurfaceProps) {
  const [cat, setCat] = useState<string>("All");
  const [stateFilter, setStateFilter] = useState<Axis | null>(null);
  const [kindFilter, setKindFilter] = useState<IntegrationKind | null>(null);
  const [q, setQ] = useState("");

  /** Pack L7932 — one flat list, each row carrying its shelf. */
  const all: readonly Row[] = useMemo(
    () =>
      shelves.flatMap((sh) =>
        sh.items.map((i) => ({ ...i, cat: sh.cat, state: connectionStates?.[i.name] ?? i.state, reported: connectionStates?.[i.name] !== undefined })),
      ),
    [shelves, connectionStates],
  );

  /** Pack L7989–L7996 — the two axes, and the search across name/does/kind/cat/blocks. */
  const query = q.trim().toLowerCase();
  const matchState = (i: Row) =>
    !stateFilter ||
    (stateFilter === "blocking"
      ? !!i.blocks && i.state !== "live"
      : stateFilter === "nice"
        ? i.state !== "live" && !i.blocks
        : i.state === stateFilter);
  const matches = (i: Row) =>
    (!query ||
      `${i.name} ${i.does} ${i.kind} ${i.cat} ${i.blocks ?? ""}`.toLowerCase().includes(query)) &&
    matchState(i) &&
    (!kindFilter || i.kind === kindFilter);

  const n = (k: IntegrationState) => all.filter((i) => i.state === k).length;
  const blocking = all.filter((i) => i.blocks && i.state !== "live").length;

  /** Pack L7970–L7981 — State row, then Consequence row. Values derived, never typed. */
  const stats: ReadonlyArray<[Axis, string, string, string]> = [
    ["live", String(n("live")), connectionStates ? "Ready / implemented adapters" : "Implemented adapters", connectionStates ? "Mixed source readiness; not an account count" : "Catalogue readiness; access unverified"],
    ["stub", String(n("stub")), "Half-wired", "Waiting on credentials"],
    ["planned", String(n("planned")), "Not built", "Nothing behind it"],
  ];
  const conseq: ReadonlyArray<[Axis, string, string, string]> = [
    ["blocking", String(blocking), "Blocking", "A built surface is dark"],
    ["nice", String(all.length - n("live") - blocking), "Nice to have", "Blocks nothing we built"],
  ];

  const shown = all.filter(matches).length;
  const liveShown = all.filter((i) => matches(i) && i.state === "live").length;
  const reportedLiveShown = all.filter((i) => matches(i) && i.state === "live" && i.reported).length;
  /** Pack L8072–L8080 — composed, so the sentence moves with the list (corrections §6, rule 3). */
  const intResult = !shown
    ? `Nothing matches. ${all.length} integrations exist across ${shelves.length} shelves.`
    : `${shown} of ${all.length} shown · ${connectionStates ? `${reportedLiveShown} reported connected · ${liveShown - reportedLiveShown} catalogue-only implemented` : `${liveShown} adapters described as implemented`}` +
      (kindFilter ? ` · ${kindFilter} only` : "") +
      (stateFilter ? ` · ${FILTER_WORD[stateFilter]} only` : "");

  const visible = shelves
    .filter((sh) => cat === "All" || cat === sh.cat)
    .map((sh) => ({
      cat: sh.cat,
      total: sh.items.length,
      live: sh.items.filter((i) => (connectionStates?.[i.name] ?? i.state) === "live").length,
      items: all.filter((i) => i.cat === sh.cat && matches(i)),
    }))
    .filter((sh) => sh.items.length);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overflow-x-hidden">
      {/* ── controls · pack L1578–L1620 ─────────────────────────────────── */}
      <div className="flex-none border-b border-[var(--pg-line)] pb-3.5">
        {!connectionStates && <p role="status" className="mb-4 max-w-[72ch] text-[length:var(--pg-t-body)] text-[var(--pg-muted)]">PARTIAL · Adapter catalogue. Verified account connections and current provider health are not loaded. Catalogue readiness may need revalidation.</p>}
        <AxisRow label="State" rows={stats} active={stateFilter} onPick={setStateFilter} />
        <div className="mt-[11px]">
          <AxisRow label="Consequence" rows={conseq} active={stateFilter} onPick={setStateFilter} />
        </div>

        <div className="mt-[13px] flex flex-wrap items-center gap-x-3.5 gap-y-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search 42 integrations"
            aria-label="Search 42 integrations"
            className="min-h-[30px] min-w-0 flex-[1_1_180px] rounded-full border border-[var(--pg-line)] bg-[var(--pg-surface)] px-[11px] text-[length:var(--pg-t-body)] text-[var(--pg-ink)] outline-none placeholder:text-[var(--pg-faint)] focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-[var(--pg-gold-core)]"
          />
          <div className="flex flex-wrap items-center gap-x-3 gap-y-[5px]">
            {(Object.keys(INT_KINDS) as IntegrationKind[]).map((k) => {
              const on = kindFilter === k;
              return (
                <button
                  key={k}
                  type="button"
                  title={INT_KINDS[k].note}
                  onClick={() => setKindFilter(on ? null : k)}
                  style={{ boxShadow: on ? `inset 0 -1px 0 ${KIND_TONE[k]}` : "none" }}
                  className={[
                    "inline-flex min-h-[24px] flex-none items-center gap-[5px] whitespace-nowrap border-0 bg-transparent px-0.5 text-[length:var(--pg-t-label)]",
                    on ? "font-semibold text-[var(--pg-ink)]" : "font-normal text-[var(--pg-muted)]",
                  ].join(" ")}
                >
                  <i
                    aria-hidden="true"
                    className="h-1.5 w-1.5 flex-none rotate-45"
                    style={{ background: KIND_TONE[k] }}
                  />
                  {k}
                  <small className="font-mono text-[length:var(--pg-t-label)] text-[var(--pg-faint)]">
                    {String(all.filter((i) => i.kind === k).length)}
                  </small>
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-[11px] flex flex-wrap gap-[5px]">
          {[{ label: "All", n: all.length }, ...shelves.map((sh) => ({ label: sh.cat, n: sh.items.length }))].map(
            (c) => {
              const on = cat === c.label;
              return (
                <button
                  key={c.label}
                  type="button"
                  onClick={() => setCat(c.label)}
                  className={[
                    "inline-flex min-h-[27px] flex-none items-center gap-[5px] whitespace-nowrap rounded-full px-[11px] text-[length:var(--pg-t-label)]",
                    on
                      ? "border border-[var(--pg-gold)] bg-[var(--pg-lift)] font-semibold text-[var(--pg-ink)]"
                      : "border border-[var(--pg-line)] bg-transparent font-normal text-[var(--pg-muted)]",
                  ].join(" ")}
                >
                  {c.label}
                  <small className="font-mono text-[length:var(--pg-t-label)] text-[var(--pg-faint)]">{String(c.n)}</small>
                </button>
              );
            },
          )}
        </div>

        <p className="mt-[11px] text-[length:var(--pg-t-body)] font-normal text-[var(--pg-muted)]">{intResult}</p>
      </div>

      {/* ── the shelves · pack L1622–L1657 ──────────────────────────────── */}
      <div className="min-h-0 flex-1 pt-1">
        {visible.map((sh) => (
          <div key={sh.cat} className="pb-[5px] pt-[15px]">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <b className="text-[length:var(--pg-t-body)] font-medium">{sh.cat}</b>
              <small className="min-w-0 text-[length:var(--pg-t-label)] text-[var(--pg-faint)]">
                {`${sh.items.length} of ${sh.total} shown · ${sh.live} marked ready / implemented`}
              </small>
            </div>
            <div className="mt-[11px] grid gap-px bg-[var(--pg-line-soft)] [grid-template-columns:repeat(auto-fill,minmax(min(100%,192px),1fr))]">
              {sh.items.map((it) => (
                <Tile key={it.name} item={it} onOpen={onOpen} />
              ))}
            </div>
          </div>
        ))}
        <p className="mt-4 max-w-[66ch] border-t border-[var(--pg-line-soft)] pt-[13px] text-[length:var(--pg-t-label)] leading-[1.55] text-[var(--pg-faint)]">
          {INT_FOOT}
        </p>
      </div>
    </div>
  );
}

/** Pack L1579–L1601 — the two filter bands share one shape. */
function AxisRow({
  label,
  rows,
  active,
  onPick,
}: {
  label: string;
  rows: ReadonlyArray<[Axis, string, string, string]>;
  active: Axis | null;
  onPick: (a: Axis | null) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-[18px] gap-y-2">
      <small className="flex-none font-mono text-[length:var(--pg-t-label)] uppercase tracking-[0.05em] text-[var(--pg-faint)]">
        {label}
      </small>
      {rows.map(([key, count, name, note]) => {
        const on = active === key;
        return (
          <button
            key={key}
            type="button"
            aria-pressed={on}
            onClick={() => onPick(on ? null : key)}
            style={{ boxShadow: on ? `inset 0 -1px 0 ${ST[key][1]}` : "none" }}
            className="flex min-w-0 items-center gap-[9px] border-0 bg-transparent px-0.5 pb-[5px] pt-0.5"
          >
            <b
              className="flex-none font-display text-[length:var(--pg-t-lead)] font-normal leading-none [font-variant-numeric:tabular-nums]"
              style={{ color: ST[key][1] }}
            >
              {count}
            </b>
            <span className="flex min-w-0 flex-col text-left">
              <small
                className={[
                  "whitespace-nowrap text-[length:var(--pg-t-label)]",
                  on ? "font-semibold text-[var(--pg-ink)]" : "font-medium text-[var(--pg-muted)]",
                ].join(" ")}
              >
                {name}
              </small>
              <small className="truncate text-[length:var(--pg-t-label)] text-[var(--pg-faint)]">{note}</small>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Pack L1628–L1652 + L8034–L8056. */
function Tile({ item, onOpen }: { item: Row; onOpen?: (i: Row) => void }) {
  const st = item.reported && item.state === "live"
    ? ["Reported connected", "var(--pg-positive)", "Supplied connection state; provider health unverified"] as const
    : ST[item.state];
  const live = item.state === "live";
  const planned = item.state === "planned";
  const hasBlock = !!item.blocks && !live;
  return (
    <button
      type="button"
      onClick={() => onOpen?.(item)}
      className="flex min-w-0 flex-col border-0 bg-[var(--pg-raised)] px-3 py-[11px] text-left transition-colors hover:bg-[var(--pg-lift)]"
    >
      <span className="flex min-w-0 items-center gap-[9px]">
        <span
          className="relative grid h-7 w-7 flex-none place-items-center overflow-hidden rounded-[var(--pg-r-chip)] text-[length:var(--pg-t-body)] font-medium shadow-[shadow:inset_0_0_0_1px_var(--pg-line)]"
          style={{
            background: live ? "var(--pg-lift)" : "var(--pg-surface)",
            color: live ? "var(--pg-gold-deep)" : "var(--pg-muted)",
          }}
        >
          <i
            aria-hidden="true"
            className="absolute bottom-[5px] left-0 top-[5px] w-0.5 rounded-full"
            style={{ background: KIND_TONE[item.kind], opacity: planned ? 0.5 : 1 }}
          />
          {item.name.replace(/^(The |Generic |Custom )/, "").charAt(0)}
        </span>
        <span className="flex min-w-0 flex-col text-left">
          <b className="truncate text-[length:var(--pg-t-body)] font-medium">{item.name}</b>
          <small className="mt-px truncate text-[length:var(--pg-t-label)] text-[var(--pg-faint)]">{item.does}</small>
        </span>
        <i
          aria-hidden="true"
          title={`${st[0]} — ${st[2]}`}
          className="h-1.5 w-1.5 flex-none rotate-45"
          style={{ background: st[1], opacity: planned ? 0.55 : 1 }}
        />
      </span>
      <span className="mt-[9px] flex items-center gap-[7px] border-t border-[var(--pg-line-soft)] pt-2">
        <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3 w-3 flex-none text-[var(--pg-faint)]">
          <path d={INT_KINDS[item.kind].glyph} fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <small className="min-w-0 truncate text-[length:var(--pg-t-label)] text-[var(--pg-muted)]">{item.kind}</small>
        <small
          className="ml-auto flex-none whitespace-nowrap text-[length:var(--pg-t-label)] font-medium"
          style={{ color: live ? "var(--pg-gold-deep)" : "var(--pg-faint)" }}
        >
          {live ? "Configure" : item.state === "stub" ? "Finish" : "Connect"}
        </small>
      </span>
      {hasBlock && (
        <span className="mt-[7px] flex items-start gap-1.5">
          <i aria-hidden="true" className="mt-[3px] h-[5px] w-[5px] flex-none rotate-45 bg-[var(--pg-warning)]" />
          <small className="min-w-0 text-left text-[length:var(--pg-t-label)] font-normal leading-[1.4] text-[var(--pg-warning)] [text-wrap:pretty]">
            {`Dark without it: ${item.blocks!.charAt(0).toLowerCase()}${item.blocks!.slice(1)}`}
          </small>
        </span>
      )}
    </button>
  );
}

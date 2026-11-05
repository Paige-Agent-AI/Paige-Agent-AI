import { useMemo, useState } from "react";
import SocialHubSurface from "./SocialHubSurface";
import { SocialChannelsPanel, SocialGrantsPanel } from "./SocialPlatformPanels";

/**
 * Settings → Integrations — the connection home, organized by integration type.
 *
 * REDESIGN AUTHORITY: owner-approved 2026-11-05 (mockup `po-integrations-redesign.html`,
 * "Yes this is perfect"). The owner's explicit instruction names the change the pack lock
 * requires: Integrations is navigated by TYPE sub-tabs (Social · Email & Messaging ·
 * Automations · Payments · Web & Hosting · Directory), Social first, and the social
 * provider behind the platform's channels is WHITE-LABELED — its name never appears in
 * the UI (owner: "they do not get any surface level branding").
 *
 * WHAT PORTS VERBATIM FROM THE v3 PACK (`paige-ia.js` L1464–L1538): `INT_KINDS` and the
 * eight-shelf, forty-two-vendor `INTEGRATIONS` catalogue with each vendor's kind/state/
 * does/note/blocks — the pack's own grounded contract about this repo. The Directory tab
 * keeps the pack's drawn surface whole (State/Consequence bands, kind filters, search,
 * the foot), so the port survives inside the redesign. Two catalogue edits are made under
 * the owner's approval, not silently: the email adapter row reads SendGrid (the platform's
 * live mail adapter; the pack's Resend row predates the platform-wide unwind), and the
 * automation shelf gains HighLevel carrying `locked` (guided setup required, never one
 * click away). `PLATFORM_SHELF` (Web and hosting) is new surface truth the pack never
 * drew: the vendors the platform itself runs on.
 *
 * The Social tab is LIVE, not catalogue: channels come from the paige-social door's
 * read-only `channels` action on the resolved workspace (platform-owner fallback v202),
 * fresh connects run the same governed `social_connection_start` approval the Solo
 * drawer uses, adoption keeps the governed `social_connection_adopt` block
 * (SocialHubSurface), and Workspace grants manage `paige_social_platform_grants` through
 * the God-Level RPCs. Honest states only: Live / Needs attention / Not switched on /
 * Locked — never a number the platform cannot prove.
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
  /** Guided setup required before this vendor can be switched on (never one click away). */
  readonly locked?: boolean;
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

/** `paige-ia.js` L1473–L1538 — verbatim except the two owner-approved edits named in the file head. */
export const INTEGRATIONS: readonly IntegrationShelf[] = [
  { cat: "Email and messaging", items: [
    { name: "SendGrid", kind: "Key", state: "live", does: "Transactional and campaign email", note: "The platform email adapter" },
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
    { name: "Anthropic", kind: "Key", state: "live", does: "The model she thinks with", note: "Direct provider connection" },
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
    { name: "HighLevel", kind: "OAuth", state: "planned", does: "CRM and funnel automation", note: "Guided setup with the platform team", locked: true },
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

/** New surface truth the pack never drew: what the platform itself runs on. */
export const PLATFORM_SHELF: IntegrationShelf = { cat: "Web and hosting", items: [
  { name: "Vercel", kind: "Key", state: "live", does: "Application hosting and deploys", note: "The console runs here" },
  { name: "Cloudflare", kind: "Key", state: "live", does: "Growth hosting and tenant domains", note: "" },
  { name: "Supabase", kind: "Key", state: "live", does: "Database, auth and edge functions", note: "The platform spine" },
]};

/** The six owner-approved type tabs, in order. Social is the home tab. */
export const TYPE_TABS = ["Social", "Email & Messaging", "Automations", "Payments", "Web & Hosting", "Directory"] as const;
export type IntegrationType = (typeof TYPE_TABS)[number];

/** Which catalogue shelves each typed tab carries. Directory carries them all. */
const TAB_SHELVES: Readonly<Record<Exclude<IntegrationType, "Social" | "Directory">, readonly string[]>> = {
  "Email & Messaging": ["Email and messaging", "Calendar and scheduling"],
  "Automations": ["Automation and tools"],
  "Payments": ["Money"],
  "Web & Hosting": ["Web and hosting"],
};

/** Pack L7936–L7946 — `[label, tone, note]` per state, plus the two derived consequence axes. */
const ST = {
  live: ["Live", "var(--pg-positive)", "Catalogue readiness; account access and health unverified"],
  stub: ["Needs attention", "var(--pg-warning)", "The adapter is written and waiting on credentials"],
  planned: ["Not switched on", "var(--pg-faint)", "Nothing exists yet"],
  blocking: ["Blocking", "var(--pg-negative)", "A built surface is dark without this"],
  nice: ["Nice to have", "var(--pg-faint)", "Blocks nothing we have built"],
} as const;
type Axis = keyof typeof ST;

const LOCKED_CHIP = ["Locked · consult CSM", "var(--pg-gold-deep)", "Guided setup required before switching on"] as const;

/** Pack L7986–L7988 — verbatim. MCP and CalDAV carry raw hexes in the pack; see the pack port. */
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
  /** Which type tab opens first. The owner's design opens Social; tests open others. */
  readonly initialTab?: IntegrationType;
};

export default function IntegrationsSurface({
  shelves = INTEGRATIONS,
  connectionStates,
  onOpen,
  initialTab = "Social",
}: IntegrationsSurfaceProps) {
  const [tab, setTab] = useState<IntegrationType>(initialTab);
  const [stateFilter, setStateFilter] = useState<Axis | null>(null);
  const [kindFilter, setKindFilter] = useState<IntegrationKind | null>(null);
  const [q, setQ] = useState("");

  /** Every shelf the surface knows: the pack's eight plus the platform's own. */
  const every = useMemo(() => [...shelves, PLATFORM_SHELF], [shelves]);
  const all: readonly Row[] = useMemo(
    () =>
      every.flatMap((sh) =>
        sh.items.map((i) => ({ ...i, cat: sh.cat, state: connectionStates?.[i.name] ?? i.state, reported: connectionStates?.[i.name] !== undefined })),
      ),
    [every, connectionStates],
  );

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
  const intResult = !shown
    ? `Nothing matches. ${all.length} integrations exist across ${every.length} shelves.`
    : `${shown} of ${all.length} shown · ${connectionStates ? `${reportedLiveShown} reported connected · ${liveShown - reportedLiveShown} catalogue-only implemented` : `${liveShown} adapters described as implemented`}` +
      (kindFilter ? ` · ${kindFilter} only` : "") +
      (stateFilter ? ` · ${FILTER_WORD[stateFilter]} only` : "");

  const typedRows = (t: Exclude<IntegrationType, "Social" | "Directory">): readonly Row[] =>
    all.filter((i) => TAB_SHELVES[t].includes(i.cat));

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overflow-x-hidden">
      {/* ── head + type tabs · owner-approved mockup po-integrations-redesign ── */}
      <div className="flex-none border-b border-[var(--pg-line)] pb-3.5">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <p className="text-[length:var(--pg-t-label)] font-semibold uppercase tracking-[0.14em] text-[var(--pg-faint)]">Settings · Integrations</p>
            <h1 className="mt-1 text-[length:var(--pg-t-h3)] font-semibold text-[var(--pg-ink)]">Integrations</h1>
            <p className="mt-1 max-w-[74ch] text-[length:var(--pg-t-body)] text-[var(--pg-muted)]">
              Everything the platform connects, organized by what it does for the business. Credentials live in the Vault; a connection grants reach, never authority.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setTab("Directory")}
            className="min-h-[30px] flex-none rounded-full border border-[var(--pg-gold)] bg-[var(--pg-lift)] px-3.5 text-[length:var(--pg-t-body)] font-semibold text-[var(--pg-ink)]"
          >
            Browse directory
          </button>
        </div>

        <div role="tablist" aria-label="Integration types" className="mt-3 flex flex-wrap gap-1">
          {TYPE_TABS.map((t) => {
            const on = tab === t;
            return (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setTab(t)}
                className={[
                  "min-h-[32px] flex-none border-0 bg-transparent px-3 pb-2 pt-1.5 text-[length:var(--pg-t-body)]",
                  on
                    ? "border-b-2 border-[var(--pg-gold-core)] font-semibold text-[var(--pg-ink)]"
                    : "border-b-2 border-transparent font-normal text-[var(--pg-muted)] hover:text-[var(--pg-ink)]",
                ].join(" ")}
              >
                {t}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Social · the live platform channel home ─────────────────────────── */}
      {tab === "Social" && (
        <div className="min-h-0 flex-1 pt-1">
          <SocialChannelsPanel />
          <SocialHubSurface />
          <SocialGrantsPanel />
        </div>
      )}

      {/* ── typed tabs · curated shelves with honest chips ──────────────────── */}
      {tab !== "Social" && tab !== "Directory" && (
        <div className="min-h-0 flex-1 pt-1">
          {(() => {
            const t = tab as Exclude<IntegrationType, "Social" | "Directory">;
            const rows = typedRows(t);
            const cats = [...new Set(rows.map((r) => r.cat))];
            if (!rows.length) {
              return (
                <p className="pt-4 text-[length:var(--pg-t-body)] text-[var(--pg-muted)]">
                  {`Nothing sits under ${t} yet. The Directory lists everything available.`}
                </p>
              );
            }
            return cats.map((cat) => (
              <div key={cat} className="pb-[5px] pt-[15px]">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <b className="text-[length:var(--pg-t-body)] font-medium">{cat}</b>
                  <small className="min-w-0 text-[length:var(--pg-t-label)] text-[var(--pg-faint)]">
                    {`${rows.filter((r) => r.cat === cat && r.state === "live").length} of ${rows.filter((r) => r.cat === cat).length} live`}
                  </small>
                </div>
                <div className="mt-[11px] grid gap-px bg-[var(--pg-line-soft)] [grid-template-columns:repeat(auto-fill,minmax(min(100%,192px),1fr))]">
                  {rows.filter((r) => r.cat === cat).map((it) => (
                    <Tile key={it.name} item={it} onOpen={onOpen} />
                  ))}
                </div>
              </div>
            ));
          })()}
        </div>
      )}

      {/* ── Directory · the pack's drawn surface, whole ─────────────────────── */}
      {tab === "Directory" && (
        <div className="min-h-0 flex-1 pt-1">
          <div className="pt-[15px]">
            {!connectionStates && <p role="status" className="mb-4 max-w-[72ch] text-[length:var(--pg-t-body)] text-[var(--pg-muted)]">PARTIAL · Adapter catalogue. Verified account connections and current provider health are not loaded. Catalogue readiness may need revalidation.</p>}
            <AxisRow label="State" rows={stats} active={stateFilter} onPick={setStateFilter} />
            <div className="mt-[11px]">
              <AxisRow label="Consequence" rows={conseq} active={stateFilter} onPick={setStateFilter} />
            </div>

            <div className="mt-[13px] flex flex-wrap items-center gap-x-3.5 gap-y-2">
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={`Search ${all.length} integrations`}
                aria-label={`Search ${all.length} integrations`}
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
                      <i aria-hidden="true" className="h-1.5 w-1.5 flex-none rotate-45" style={{ background: KIND_TONE[k] }} />
                      {k}
                      <small className="font-mono text-[length:var(--pg-t-label)] text-[var(--pg-faint)]">
                        {String(all.filter((i) => i.kind === k).length)}
                      </small>
                    </button>
                  );
                })}
              </div>
            </div>

            <p className="mt-[11px] text-[length:var(--pg-t-body)] font-normal text-[var(--pg-muted)]">{intResult}</p>

            {every
              .map((sh) => ({
                cat: sh.cat,
                total: sh.items.length,
                items: all.filter((i) => i.cat === sh.cat && matches(i)),
              }))
              .filter((sh) => sh.items.length)
              .map((sh) => (
                <div key={sh.cat} className="pb-[5px] pt-[15px]">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <b className="text-[length:var(--pg-t-body)] font-medium">{sh.cat}</b>
                    <small className="min-w-0 text-[length:var(--pg-t-label)] text-[var(--pg-faint)]">
                      {`${sh.items.length} of ${sh.total} shown`}
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
      )}
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

/** Pack L1628–L1652 + L8034–L8056, with the owner-approved honest-state chips. */
function Tile({ item, onOpen }: { item: Row; onOpen?: (i: Row) => void }) {
  const st = item.locked
    ? LOCKED_CHIP
    : item.reported && item.state === "live"
      ? (["Reported connected", "var(--pg-positive)", "Supplied connection state; provider health unverified"] as const)
      : ST[item.state];
  const live = item.state === "live" && !item.locked;
  const planned = item.state === "planned" || item.locked;
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
        <small className="min-w-0 truncate text-[length:var(--pg-t-label)] text-[var(--pg-muted)]">{st[0]}</small>
        <small
          className="ml-auto flex-none whitespace-nowrap text-[length:var(--pg-t-label)] font-medium"
          style={{ color: live ? "var(--pg-gold-deep)" : "var(--pg-faint)" }}
        >
          {live ? "Configure" : item.locked ? "Details" : item.state === "stub" ? "Finish" : "Connect"}
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

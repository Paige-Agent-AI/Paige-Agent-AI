// @ts-nocheck
/**
 * Campaigns › Social — the Social Command surface.
 *
 * WHAT THIS SURFACE IS FOR. One question, answered in the first few seconds: what is PAIGE doing to
 * grow this business socially right now — and, just as loudly, what she cannot yet see. It is not a
 * scheduler and it is not a placements report, because the platform holds neither for a tenant — and
 * the layout says which of those it is missing rather than leaving a plausible-looking zero where a
 * number would go.
 *
 * THE REDESIGN (owner-commissioned 2026-09-05): "executive mission control meets luxury AI operating
 * system." This is a RESKIN of the honest surface, not a new set of claims. The premium comes from
 * the desk ground, the command-header lockup, the signal cards, the connected pipeline and the
 * token-built eclipse — never from data the backend does not hold. Where the reference draws a
 * capability the platform has no seam for (a live channel connection, a publishing/ad pipeline,
 * measured telemetry), the surface renders the honest absence instead of a dead control.
 *
 * THE RULE THIS FILE IS BUILT AROUND. Every figure comes from `social-truth.ts`, where its source
 * and its state were decided in a function a test can call. Nothing is computed inline here, and
 * nothing has a fallback: a module with no source renders its absence and says which record would
 * have to exist. `src/solo/compass.tsx:8-38` is the standing account of what happens when a
 * dashboard of exactly this shape is allowed to fill its own gaps.
 *
 * WHAT SURVIVES FROM THE PANEL THIS REPLACES (§58). The five non-inferences it made out loud — no
 * accounts, followers, publishing queue, schedules or placements are inferred — are each still made,
 * now attached to the specific tile that would otherwise imply one. Its Vibe Studio redirect and its
 * "placements are recorded by a provider" precondition are both kept. So is the one write.
 *
 * WHAT IS NEW. An owner can RECORD the accounts their business posts from, here, and that write is
 * the first one `tenants.features->social_handles` has ever had. Systems Check #3 points at this
 * page; until this slice it pointed at a page that could not finish the job.
 */
import React from "react";
import { Ic } from "./_shared";
import { useSocialCommand } from "./useSocialCommand";
import { useSoloPendingActions } from "./data/useSoloPendingActions";
import { elapsedLabel } from "./data/useSoloActivityFeed";
// useSoloTrust directly rather than compass.tsx's useTrustDepartments: the compass module pulls the
// whole Trust Compass surface into the Campaigns bundle for two lane labels, and this is the same
// underlying read either way.
import { useSoloTrust } from "./data/useSoloTrust";
import {
  SOCIAL_NETWORKS,
  buildBrief,
  buildChannels,
  buildKpis,
  buildNextMove,
  buildPipeline,
  isGrowthDesk,
  LANE_COPY,
  toHandlePayload,
} from "./social-truth";
import "./social-command.css";

/* ─────────────────────────── shared atoms ─────────────────────────── */

/**
 * A glyph per desk. Plumbing for `Ic[...]`, not a data claim — the same pattern and the same
 * caveat as `compass.tsx`'s DEPT_ICON. Deliberately NOT a colour: the only accents in this shell
 * are violet, gold and the three semantic status colours, and spending a status colour on "which
 * desk raised this" would make a desk read as a severity.
 */
const DESK_GLYPH = {
  marketing: Ic.trend,
  sales: Ic.store,
  client_experience: Ic.users,
  owner_ops: Ic.grid,
};

/**
 * A glyph per pipeline stage. Same plumbing/caveat as DESK_GLYPH — it names the step, it claims
 * nothing, and it carries no colour of its own. Keyed by the stage id `social-truth.ts` produces.
 */
const STAGE_GLYPH = {
  ideas: Ic.spark,
  drafting: Ic.doc,
  review: Ic.bell,
  scheduled: Ic.clock,
  published: Ic.check,
  repair: Ic.bolt,
};

function PanelHead({ glyph, title, sub, state }) {
  return (
    <div className="social-panel-head">
      <div className="social-panel-lhs">
        <span className="social-panel-glyph">{React.createElement(Ic[glyph] ?? Ic.grid, { size: 15 })}</span>
        <div>
          <h3>{title}</h3>
          <p>{sub}</p>
        </div>
      </div>
      <Truth state={state} />
    </div>
  );
}

function Truth({ state }) {
  const label = state || "UNAVAILABLE";
  return <span className={`social-truth social-truth--${label.toLowerCase()}`}>{label}</span>;
}

/** A figure, or the honest mark that stands in for one. Never a zero pretending to be a count. */
function Figure({ value }) {
  return value === null || value === undefined
    ? <span className="social-figure social-figure--absent" aria-label="No figure available">&mdash;</span>
    : <span className="social-figure mono">{value}</span>;
}

/**
 * The PAIGE command mark's glyph — the platform's CURRENT mark, NOT the retired orbital `PaigeMark`.
 *
 * Owner-ruled 2026-09-06: the orbital PaigeMark (gold orb + ring + spark) is the old pre-CD marketing
 * mark; the mark the Paige chat and the menu actually render is the Command Mark — a slash and an orb,
 * `src/operator/shell/CommandMark.tsx`, whose geometry is the CD pack's, exact
 * (docs/design-references/cd-packs/super-admin-shell-v3/docs/handoff/design-system-port.md §3). The
 * `points`/`cx,cy,r` and `stroke-width: 3.2` + `stroke-linejoin: round` below are that geometry,
 * unchanged. The shared component is operator-pack-locked and its `--cm-*`/`--pg-*` tokens do not
 * resolve under `.paige-solo`, so this Social surface renders the SAME geometry natively, coloured
 * from the Solo tokens via `--cmk-slash`/`--cmk-orb` — the contrasting colour variation + bulging
 * glyph the owner green-lit for this page (2026-09-06). Fills are tokens (§23 theme-aware, no hex).
 */
function CmdGlyph({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <polygon
        points="21,13.6 30.5,13.6 21,34.4 11.5,34.4"
        fill="var(--cmk-slash)"
        stroke="var(--cmk-slash)"
        strokeWidth="3.2"
        strokeLinejoin="round"
      />
      <circle cx="34.5" cy="30.5" r="5.5" fill="var(--cmk-orb)" />
    </svg>
  );
}

/**
 * The PAIGE presence as an eclipse — reserved for the surface STATES, where there is nothing else to
 * show and the wait itself is the subject. The command glyph (above) sits in the orb body and BULGES
 * out of it; the token-built corona (`.social-orb-ring`) sweeps ONLY where motion is safe, and
 * `prefers-reduced-motion` stops it in the stylesheet rather than hiding it, because the mark still
 * has to read as the mark when it is still.
 */
function PaigeOrb() {
  return (
    <div className="social-orb" aria-hidden="true">
      <span className="social-orb-halo" />
      <span className="social-orb-body" />
      <span className="social-orb-ring" />
      <CmdGlyph className="social-orb-mark" />
    </div>
  );
}

/* ─────────────────────────── the record form ─────────────────────────── */

/**
 * The one thing a person can COMPLETE on this surface.
 *
 * It sends the COMPLETE set rather than a patch, and says so: an omitted network is cleared. A
 * partial write would make "remove the account I no longer use" inexpressible, and the Systems
 * Check counts keys — so an undeletable handle would keep a check passing for an account that no
 * longer exists.
 */
function RecordAccountsForm({ handles, canManage, onSave, onClose }) {
  const initial = React.useMemo(() => {
    const seed = {};
    for (const network of SOCIAL_NETWORKS) {
      seed[network.key] = handles.find((h) => h.network === network.key)?.handle ?? "";
    }
    return seed;
  }, [handles]);
  const [draft, setDraft] = React.useState(initial);
  const [saving, setSaving] = React.useState(false);
  const [message, setMessage] = React.useState("");
  const firstField = React.useRef(null);
  const dialog = React.useRef(null);

  React.useEffect(() => { setDraft(initial); }, [initial]);
  React.useEffect(() => {
    firstField.current?.focus({ preventScroll: true });
    const onKey = (event) => { if (event.key === "Escape" && !saving) { event.preventDefault(); onClose(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  const submit = async (event) => {
    event.preventDefault();
    if (!canManage || saving) return;
    setSaving(true);
    setMessage("");
    const result = await onSave(toHandlePayload(draft));
    setSaving(false);
    if (result.ok) {
      // Reports the count the SERVER read back, not the length of what was typed.
      setMessage(
        result.recordedCount === 0
          ? "Saved. No account is on record now."
          : `Saved. ${result.recordedCount} account${result.recordedCount === 1 ? "" : "s"} on record.`,
      );
      window.setTimeout(onClose, 900);
      return;
    }
    setMessage(result.message);
  };

  return (
    <>
      <div className="social-scrim" onClick={() => !saving && onClose()} />
      <div className="social-dialog" role="dialog" aria-modal="true" aria-labelledby="social-record-title" ref={dialog}>
        <header>
          <div>
            <span className="social-eyebrow">Campaigns · Social</span>
            <h2 id="social-record-title">The accounts this business posts from</h2>
          </div>
          <button type="button" className="btn btn-s" onClick={onClose} disabled={saving}>
            <Ic.x size={13} />Close
          </button>
        </header>
        <form onSubmit={submit}>
          <p className="social-dialog-note">
            This tells PAIGE which accounts are yours. It does not connect them — nothing here can publish,
            schedule, or read a follower or engagement number for you. Clear a field to take that
            account off your record.
          </p>
          <div className="social-dialog-fields">
            {SOCIAL_NETWORKS.map((network, index) => (
              <label key={network.key}>
                <span>{network.label}</span>
                <input
                  ref={index === 0 ? firstField : undefined}
                  type="text"
                  value={draft[network.key] ?? ""}
                  placeholder={network.hint}
                  maxLength={120}
                  disabled={!canManage || saving}
                  onChange={(event) => setDraft({ ...draft, [network.key]: event.target.value })}
                />
              </label>
            ))}
          </div>
          {!canManage && (
            <p className="social-dialog-status" role="status">
              You can look, not change. An owner or admin of this workspace can record these.
            </p>
          )}
          {message && <p className="social-dialog-status" role="status">{message}</p>}
          <div className="social-dialog-actions">
            <button type="button" className="btn btn-s" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" className="btn btn-s btn-g" disabled={!canManage || saving}>
              <Ic.check size={13} />{saving ? "Saving…" : "Save to record"}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}

/* ─────────────────────────── the next move ─────────────────────────── */

/**
 * The answer to the one question the surface could not answer before: what should I do?
 *
 * It sits directly under the brief because that is the order a person reads in — where I stand,
 * then what to do about it. The move itself is decided in `buildNextMove` over inputs that already
 * exist, so this component chooses nothing; it renders a decision and wires it to a control that
 * was already on the page or a route that already resolves.
 */
function NextMove({ move, onRecord, onOpenStudio, onOpenCompass, onOpenPipeline, onAskPaige }) {
  const run = {
    record: onRecord,
    studio: onOpenStudio,
    compass: onOpenCompass,
    pipeline: onOpenPipeline,
    paige: onAskPaige,
  }[move.action.kind];

  return (
    <section className="social-next" aria-labelledby="social-next-title">
      <span className="social-next-glyph"><Ic.bolt size={16} /></span>
      <div className="social-next-body">
        <span className="social-eyebrow">Do this next</span>
        <h2 id="social-next-title">{move.headline}</h2>
        <p>{move.detail}</p>
      </div>
      <button type="button" className="btn btn-s btn-g social-next-act" data-solo-vibe-studio-launcher={move.action.kind === "studio" ? "" : undefined} onClick={run}>
        <Ic.arrow size={13} />{move.action.label}
      </button>
    </section>
  );
}

/* ─────────────────────────── command header ─────────────────────────── */

function SocialHero({ brief, kpis, onRecord, onAskPaige, canManage, hasHandles, authorityUnknown, onRetry }) {
  return (
    <header className="social-hero">
      {/* The command bar: the brand lockup on the left, the acts on the right. Compact by design
          (§11) — the work leads, the chrome does not eat the fold. */}
      <div className="social-cmd-bar">
        <div className="social-cmd-brand">
          <span className="social-cmd-mark" data-cmk="indigo" aria-hidden="true">
            <CmdGlyph className="social-cmd-glyph" />
          </span>
          <span className="social-cmd-wm">PAIGE</span>
          <span className="social-cmd-div" aria-hidden="true" />
          <span className="social-eyebrow">Social command</span>
        </div>
        <div className="social-hero-actions">
          <button type="button" className="btn btn-s" onClick={onAskPaige}>
            <Ic.spark size={13} />Ask PAIGE
          </button>
          {/* Offered only to a caller whose save the server will accept. `record_social_handles`
              refuses a non-admin, so rendering this for everyone put a control on the page that
              cannot finish the job it names (§70) — and for a member refused sight of the record
              it also implied the record was empty. The note below already said the true thing; it
              is now the whole of what a read-only caller is shown, rather than a caption under a
              button that would fail. Nothing is removed for anyone who could ever use it (§58). */}
          {canManage && (
            <button type="button" className="btn btn-s btn-g" onClick={onRecord}>
              <Ic.check size={13} />{hasHandles ? "Update accounts" : "Record accounts"}
            </button>
          )}
          {/* An unknown authority is not a denied one, and the difference costs a real owner their
              only action on this page. It gets a retry rather than a verdict. */}
          {!canManage && authorityUnknown && (
            <button type="button" className="btn btn-s" onClick={onRetry}>
              <Ic.arrow size={13} />Retry access
            </button>
          )}
        </div>
      </div>

      <div className="social-hero-top">
        <div className="social-cmd-brief">
          <h2 className="social-headline">{brief.headline}</h2>
          <p className="social-hero-body">{brief.body}</p>
        </div>

        {!canManage && (
          <div className="social-hero-act">
            <p className="social-hero-permission" role={authorityUnknown ? "alert" : undefined}>
              {authorityUnknown
                ? "Your access could not be checked, so no permission is assumed either way. Nothing was changed."
                : "Read-only access — an owner or admin records these."}
            </p>
          </div>
        )}
      </div>

      {/* The signal strip is a full-width row rather than a column beside the brief, because every
          tile carries the sentence that says where its figure came from or why there is none. That
          sentence is the point of the tile, and it does not fit in a quarter-width column. */}
      <div className="social-kpis">
        {kpis.map((kpi) => (
          <article key={kpi.id} className="social-kpi">
            <div className="social-kpi-top">
              <span className="social-kpi-glyph">{React.createElement(Ic[kpi.glyph] ?? Ic.grid, { size: 14 })}</span>
              <Truth state={kpi.figure.state} />
            </div>
            <Figure value={kpi.figure.value} />
            <h3>{kpi.label}</h3>
            <p>{kpi.figure.value === null ? kpi.figure.note : kpi.detail}</p>
          </article>
        ))}
      </div>
    </header>
  );
}

/* ─────────────────────────── missions ─────────────────────────── */

/**
 * Always-on campaign missions.
 *
 * Nothing in the platform records a mission: no cadence, no target, no progress. `tenant_workflows`
 * mirrors n8n and carries a name and a last-run time but neither a cadence nor a target, so a
 * progress bar drawn from it would be a shape with no number behind it. The panel therefore states
 * what a mission would need, and points at the surface that can actually make one.
 */
function ActiveMissionsPanel({ onOpenStudio }) {
  return (
    <section className="social-panel">
      <PanelHead glyph="trend" title="Active missions" state="UNAVAILABLE"
        sub="Always-on campaigns with a cadence and a target, run for you." />
      <div className="social-empty">
        <span className="social-empty-glyph"><Ic.trend size={18} /></span>
        <h4>You have no always-on campaign yet</h4>
        <p>
          Nothing here holds a mission, its cadence, or its progress for you, so none is shown and none
          is invented. Build the piece in Vibe Studio and it appears under Published outputs the
          moment you publish it.
        </p>
        <button type="button" className="btn btn-s" data-solo-vibe-studio-launcher onClick={onOpenStudio}>
          <Ic.spark size={13} />Vibe Studio
        </button>
      </div>
    </section>
  );
}

/* ─────────────────────────── PAIGE sees ─────────────────────────── */

/**
 * What PAIGE has actually filed and stopped on.
 *
 * This is real: `paige_actions` rows at `status='filed'` with `autonomy_lane='confirm'` are work she
 * prepared and is not permitted to run unattended — which is exactly what an intelligence panel on
 * this surface should carry. What it is NOT is a trend feed: nothing measures a trend, a posting
 * window, or a repurposing opportunity for this workspace, so none is drawn.
 */
function PaigeSeesPanel({ items, loading, error, onRetry }) {
  // `items` survives a failed refresh, so reading the tag off its length alone printed PARTIAL
  // directly above a body saying the read had not happened. The tag agrees with the body now.
  const growth = items.filter((item) => isGrowthDesk(item.department));
  return (
    <section className="social-panel">
      <PanelHead glyph="pulse" title="PAIGE sees" state={!loading && !error && growth.length ? "PARTIAL" : "UNAVAILABLE"}
        sub="What she has ready for you, from marketing, sales and client work." />
      {loading ? (
        <div className="social-skeleton" role="status" aria-label="Loading what PAIGE has ready"><span className="social-sk-s" /><span className="social-sk-s" /><span className="social-sk-s" /></div>
      ) : error ? (
        <div className="social-empty" role="alert">
          <h4>This could not be read</h4>
          <p>This did not load. That is not the same as nothing waiting, so nothing is claimed either way.</p>
          <button type="button" className="btn btn-s" onClick={onRetry}><Ic.arrow size={13} />Try again</button>
        </div>
      ) : growth.length === 0 ? (
        <div className="social-empty">
          <span className="social-empty-glyph"><Ic.pulse size={18} /></span>
          <h4>Nothing is waiting on you</h4>
          <p>
            When PAIGE has something ready she should not send on her own, it shows up here with the team
            that raised it. No trend, posting window, or engagement number is measured for you, so
            none is shown.
          </p>
        </div>
      ) : (
        <ul className="social-feed">
          {growth.map((item) => (
            <li key={item.id}>
              <span className="social-feed-glyph">{React.createElement(DESK_GLYPH[item.department] ?? Ic.bell, { size: 14 })}</span>
              <div>
                <div className="social-feed-line">
                  <h4>{item.title}</h4>
                  {item.createdAt && <time className="social-feed-age">{elapsedLabel(item.createdAt)}</time>}
                </div>
                {item.summary && <p>{item.summary}</p>}
                <small>{item.department}</small>
                {/* Its own line, dimmer. This is the row's RATIONALE — why she stopped — and the
                    field's contract says exactly that. It is never labelled a recommendation,
                    because nothing in the row recommends anything. */}
                {item.rationale && <small className="social-feed-why">{item.rationale}</small>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ─────────────────────────── pipeline ─────────────────────────── */

function ContentPipelinePanel({ stages }) {
  const known = stages.filter((stage) => stage.figure.value !== null).length;
  return (
    <section className="social-panel">
      <PanelHead glyph="doc" title="Content pipeline" state={known ? "PARTIAL" : "UNAVAILABLE"}
        sub="From idea to live — and which of these steps PAIGE can actually see for you." />
      <ol className="social-pipeline">
        {stages.map((stage) => (
          <li key={stage.id} className={`social-stage social-stage--${stage.tone}`}>
            <span className="social-stage-glyph">{React.createElement(STAGE_GLYPH[stage.id] ?? Ic.grid, { size: 14 })}</span>
            <Figure value={stage.figure.value} />
            <h4>{stage.label}</h4>
            <p>{stage.figure.value === null ? stage.figure.note : stage.detail}</p>
          </li>
        ))}
      </ol>
      <p className="social-panel-foot">
        Published outputs are your pages, funnels and forms, not posts. They count as placements
        only once a supported provider records where they went live.
      </p>
    </section>
  );
}

/* ─────────────────────────── channels ─────────────────────────── */

function ChannelTelemetryPanel({ channels, onRecord, canManage, notPermitted, handlesUnknown }) {
  return (
    <section className="social-panel">
      <PanelHead glyph="users" title="Channels" state={channels.length ? "PARTIAL" : "UNAVAILABLE"}
        sub="Every account you post from, and exactly what PAIGE knows about it." />
      {/* `notPermitted` is a STRICT SUBSET of `handlesUnknown` — it names one of the read's three
          refusals. Branching on the subset alone meant the other two ('workspace not resolved',
          'workspace record not readable') fell through to "No account is on record", so this panel
          asserted an empty record three panels below a brief saying the record had not been read.
          That is verbatim the contradiction the previous commit cited as its own motivation,
          surviving in the panel it named. The unread branch is checked FIRST because it is the
          wider truth; the access branch stays because it says something more specific and true. */}
      {handlesUnknown && !notPermitted ? (
        <div className="social-empty">
          <h4>This has not been read</h4>
          <p>
            The account list did not come back for this workspace. Nothing here says whether any
            account is on it — only that it was not read. Nothing was changed.
          </p>
        </div>
      ) : notPermitted ? (
        <div className="social-empty">
          <h4>Not shown at your access level</h4>
          <p>
            Only this business's owners and admins can see its account list. Nothing here says whether any
            exist — only that this part is not yours to see.
          </p>
        </div>
      ) : channels.length === 0 ? (
        <div className="social-empty">
          <span className="social-empty-glyph"><Ic.users size={18} /></span>
          <h4>No account is on record</h4>
          <p>
            Name the accounts you post from. PAIGE works from them when she drafts, and it ticks the
            social accounts item on your Systems Check.
          </p>
          <button type="button" className="btn btn-s btn-g" onClick={onRecord} disabled={!canManage}>
            <Ic.plus size={13} />Record accounts
          </button>
        </div>
      ) : (
        <>
          <ul className="social-channels">
            {channels.map((channel) => (
              <li key={channel.network}>
                <div className="social-channel-id">
                  <span className="social-channel-dot" aria-hidden="true" />
                  <div>
                    <h4>{channel.label}</h4>
                    <small className="mono">{channel.handle}</small>
                  </div>
                </div>
                <div className="social-channel-metric">
                  <Figure value={channel.reach.value} />
                  <small>{channel.reach.note}</small>
                </div>
              </li>
            ))}
          </ul>
          <p className="social-panel-foot">
            These are what you told PAIGE. No provider is connected, so no audience, engagement or
            placement number exists for any of them.
          </p>
        </>
      )}
    </section>
  );
}

/* ─────────────────────────── governance ─────────────────────────── */

/**
 * Trust Compass, reflected — never re-implemented.
 *
 * There is exactly one autonomy control on this platform and it is not here. This reads the lanes
 * the platform default puts the growth desks in, and labels them as what they are: a PLATFORM
 * default, identical for every workspace, because no per-workspace autonomy record exists anywhere
 * to show (`useSoloTrust.ts:38-44`). Saying "your settings" here would reintroduce the fabrication
 * that file removed, in a new place.
 */
function TrustCompassSocialStatus({ trust }) {
  const rows = (trust.departments ?? [])
    .filter((dept) => isGrowthDesk(dept.slug))
    .flatMap((dept) => (dept.acts ?? []).slice(0, 2).map((act) => ({ dept: dept.name, ...act })));

  if (trust.loading) return null;
  if (!rows.length) return null;

  return (
    <aside className="social-governance">
      <div className="social-governance-head">
        <Ic.shield size={14} />
        <h3>Trust Compass governs what PAIGE may do here</h3>
      </div>
      <ul>
        {rows.map((row, index) => (
          <li key={`${row.dept}-${row.label}-${index}`}>
            <span className={`social-lane social-lane--${row.lane}`}>{LANE_COPY[row.lane] ?? row.lane}</span>
            <span className="social-lane-label">{row.label}</span>
          </li>
        ))}
      </ul>
      <p>
        This is the platform default for these desks, the same for every business — nobody here has
        picked it. Autonomy is reviewed in Trust Compass, not here.
      </p>
    </aside>
  );
}

/* ─────────────────────────── the page ─────────────────────────── */

export function SocialCommand({ campaigns, onOpenStudio, onAskPaige, onOpenCompass, onOpenPipeline }) {
  const social = useSocialCommand();
  // Owned here rather than lifted into GrowthHub: the other five Campaigns tabs would otherwise pay
  // for two reads they never render.
  const pending = useSoloPendingActions(social.tenantId ?? null); // §9 — scope to the viewed workspace
  const trust = useSoloTrust(social.tenantId);
  const [recording, setRecording] = React.useState(false);
  const opener = React.useRef(null);

  const openRecord = React.useCallback((event) => {
    opener.current = event?.currentTarget ?? null;
    setRecording(true);
  }, []);
  const closeRecord = React.useCallback(() => {
    setRecording(false);
    opener.current?.focus?.({ preventScroll: true });
  }, []);

  /**
   * NOT SUCCESSFULLY READ — wider than "errored", and the width is the whole point.
   *
   * The first fix keyed both flags on the error phase. The second §39 peer-gate showed that fixed
   * the PREDICATE and not the CLASS: `useSoloCampaigns` returns `{...empty}` for `loading`,
   * `unavailable` AND `error`, and `useSoloPendingActions` starts `{items: [], loading: true,
   * error: null}` — so a read still in flight produces the identical all-zeros input, and every
   * sentence the fix was written to kill came straight back in a sibling phase.
   *
   * In flight is the MOST reachable of those states, not the least. `useSoloCampaigns` issues six
   * round trips where `useSocialCommand` issues two, so on first paint social routinely wins and
   * the page renders with campaign zeros asserted as facts; and its `visibleState` flips to
   * `loading` SYNCHRONOUSLY on a tenant switch, so every switch commits at least one such frame.
   *
   * `!== "ready"` rather than a list of phases, deliberately: a phase added later is unread until
   * someone proves otherwise, which is the safe direction for a §13 flag to fail in.
   */
  const waitingUnread = Boolean(pending.error) || Boolean(pending.loading);

  const input = React.useMemo(() => {
    // The `?? []` lives INSIDE the memo: as a statement outside it, the fallback array is a new
    // identity every render and the memo never holds.
    const artifacts = campaigns.artifacts ?? [];
    return {
      handles: social.handles,
      publishedOutputs: artifacts.length,
      approvalGatedForms: artifacts.filter((artifact) => String(artifact.routingState || "").includes("approval-gated")).length,
      formsNeedingRepair: artifacts.filter((artifact) => (artifact.recentDispatches?.failed ?? 0) > 0).length,
      capturedSubmissions: (campaigns.submissions ?? []).length,
      // `useSoloPendingActions` does NOT clear `items` when a refresh fails, so a stale non-zero
      // count outlives the read that produced it. Trusting it is how the brief announced "4 items
      // waiting on your decision" beside a tile saying the read had failed. Zero here, and the
      // unknown flag below is what actually speaks.
      //
      // Fixed at THIS layer rather than in the hook deliberately: the hook has two other consumers
      // (both Trust Compass modals), and clearing its list on error changes what they render. That
      // is a §37 producer walk and a behaviour change on a surface this work was not asked to
      // touch, so it is filed separately rather than folded in here.
      waitingOnYou: waitingUnread ? 0 : (pending.items ?? []).filter((item) => isGrowthDesk(item.department)).length,
      // A failed read arrives as an empty list. The tile must not read that as "nothing waiting".
      waitingUnknown: waitingUnread,
      // The twin, and the one the first pass missed: `useSoloCampaigns` returns `{phase:"error",
      // ...empty}`, so published / approval-gated / repair / captured ALL collapse to zero on a
      // failed read and four sentences asserted an absence off it.
      campaignsUnknown: campaigns.phase !== "ready",
      // The presence read's own refusals — three of them, every one arriving as a successful
      // response carrying zero on-record rows, and only one was ever surfaced.
      handlesUnknown: Boolean(social.handlesUnknown),
    };
  }, [
    social.handles, social.handlesUnknown,
    campaigns.artifacts, campaigns.submissions, campaigns.phase,
    pending.items, waitingUnread,
  ]);

  if (social.phase === "resolving" || campaigns.phase === "resolving") {
    return (
      <div className="social-page">
        <div className="social-state" role="status">
          <span className="social-spinner" />
          <p>Resolving this account's Social workspace…</p>
        </div>
      </div>
    );
  }
  if (social.phase === "unavailable") {
    return (
      <div className="social-page">
        <div className="social-state">
          <PaigeOrb />
          <Truth state="UNAVAILABLE" />
          <h2>Social needs a resolved workspace</h2>
          <p>Nothing loads until PAIGE knows which account you are in.</p>
        </div>
      </div>
    );
  }
  if (social.phase === "error") {
    return (
      <div className="social-page">
        <div className="social-state" role="alert">
          <PaigeOrb />
          <Truth state="UNAVAILABLE" />
          <h2>This workspace's social record could not be read</h2>
          <p>Nothing was changed. This failing to load is not the same as having nothing on record, so nothing is claimed either way.</p>
          <button type="button" className="btn btn-s" onClick={social.retry}><Ic.arrow size={13} />Try again</button>
        </div>
      </div>
    );
  }
  if (social.phase === "loading") {
    return (
      <div className="social-page">
        <div className="social-skeleton" role="status" aria-label="Loading Social">
          <span className="social-sk-h" /><span className="social-sk-s" /><span className="social-sk-r" />
        </div>
      </div>
    );
  }

  const brief = buildBrief(input);
  const nextMove = buildNextMove(input);
  const kpis = buildKpis(input);
  const stages = buildPipeline(input);
  const channels = buildChannels(social.handles);

  return (
    <div className="social-page">
      <SocialHero
        brief={brief}
        kpis={kpis}
        canManage={social.canManage}
        hasHandles={social.handles.length > 0}
        onRecord={openRecord}
        onAskPaige={onAskPaige}
        authorityUnknown={Boolean(social.authorityUnknown)}
        onRetry={social.retry}
      />

      <NextMove
        move={nextMove}
        onRecord={openRecord}
        onOpenStudio={onOpenStudio}
        onOpenCompass={onOpenCompass}
        onOpenPipeline={onOpenPipeline}
        onAskPaige={onAskPaige}
      />

      <div className="social-grid">
        <div className="social-col">
          <PaigeSeesPanel items={pending.items ?? []} loading={pending.loading} error={pending.error} onRetry={pending.refresh} />
          <ContentPipelinePanel stages={stages} />
        </div>
        <div className="social-col">
          <ChannelTelemetryPanel
            channels={channels}
            onRecord={openRecord}
            canManage={social.canManage}
            notPermitted={social.notPermitted}
            handlesUnknown={Boolean(social.handlesUnknown)}
          />
          <ActiveMissionsPanel onOpenStudio={onOpenStudio} />
        </div>
      </div>

      <TrustCompassSocialStatus trust={trust} />

      {social.recordChangedAt && (
        <p className="social-record-stamp">
          This workspace record last changed {new Date(social.recordChangedAt).toLocaleString()}. Nothing
          records when an individual account was added, so no per-account date is shown.
        </p>
      )}

      {recording && (
        <RecordAccountsForm
          handles={social.handles}
          canManage={social.canManage}
          onSave={social.recordHandles}
          onClose={closeRecord}
        />
      )}
    </div>
  );
}

export default SocialCommand;

import React from "react";
import { createPortal } from "react-dom";
import { resolveTenantAccountContext, type TenantAccountContext } from "@/components/tenant-shell/tenantShellRoutes";
import { useSubtabRoute } from "@/lib/routing/useSubtabRoute";
import {
  useAnalyticsEvidence,
  type AnalyticsEvidenceBundle,
  type AnalyticsRangeKey,
  type AnalyticsTruthState,
} from "./data/useAnalyticsEvidence";
import "./analytics2.css";

type Analytics2Props = {
  accountContext?: TenantAccountContext | null;
  accountEpoch?: string | null;
  openPaige?: () => void;
};

type TruthState = AnalyticsTruthState | "NOT CONNECTED";
type LensKey = "brief" | "money" | "profit" | "ret" | "mkt" | "dec";
type Lens = {
  route: LensKey;
  label: string;
  title: string;
  truth: TruthState;
  summary: string;
  nextStep: string;
};

const LENSES: readonly Lens[] = [
  {
    route: "brief",
    label: "Brief",
    title: "Operating evidence",
    truth: "UNAVAILABLE",
    summary: "No canonical business-performance bundle is available for this account.",
    nextStep: "Issue a tenant-safe metric bundle before displaying an owner brief.",
  },
  {
    route: "money",
    label: "Sales funnel",
    title: "Stage evidence",
    truth: "UNAVAILABLE",
    summary: "No canonical stage definitions or contributing-record counts are available.",
    nextStep: "Prove stage identity, exclusions, and coverage before showing volume or conversion.",
  },
  {
    route: "profit",
    label: "Revenue & profit",
    title: "Financial evidence",
    truth: "UNAVAILABLE",
    summary: "Revenue and attributable direct-cost coverage have not been proved together.",
    nextStep: "Establish canonical revenue and direct-cost contracts before calculating profitability.",
  },
  {
    route: "ret",
    label: "Retention",
    title: "Cohort evidence",
    truth: "UNAVAILABLE",
    summary: "No canonical cohort boundary, return definition, or contributing-record set is available.",
    nextStep: "Issue the shared retention contract before displaying cohort values or churn.",
  },
  {
    route: "mkt",
    label: "Acquisition",
    title: "Source evidence",
    truth: "NOT CONNECTED",
    summary: "No canonical acquisition-source mapping is connected to this reading surface.",
    nextStep: "Connect a tenant-safe source map and prove its coverage before assigning outcomes.",
  },
  {
    route: "dec",
    label: "Decisions",
    title: "Governed decision evidence",
    truth: "UNAVAILABLE",
    summary: "No proven evidence reference or governed recommendation is available.",
    nextStep: "Resolve authoritative evidence before PAIGE prepares any bounded recommendation.",
  },
];

const RANGE_OPTIONS = ["Last 30 days", "Current quarter", "Year to date"] as const;
const RANGE_KEYS: Record<(typeof RANGE_OPTIONS)[number], AnalyticsRangeKey> = {
  "Last 30 days": "last_30_days",
  "Current quarter": "current_quarter",
  "Year to date": "year_to_date",
};

function TruthBadge({ truth }: { truth: TruthState }) {
  return <span className="anr-state" data-truth={truth}>{truth}</span>;
}

function EvidenceRow({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="anr-evidence-row"><dt>{label}</dt><dd>{children}</dd></div>;
}

function BriefVisual() {
  const rows = ["Revenue evidence", "Cost coverage", "Retention coverage", "Attribution coverage"];
  return <div className="anr-chart-stage" role="img" aria-label="Empty evidence wheel. No business performance is implied.">
    <div className="anr-brief-instrument">
      <div className="anr-evidence-wheel" aria-hidden="true">
        <i className="anr-wheel-ring anr-wheel-ring--outer" />
        <i className="anr-wheel-ring anr-wheel-ring--inner" />
        <div className="anr-wheel-core"><strong>No bundle</strong><span>No implied score</span></div>
      </div>
      <div className="anr-instrument-list">
        {rows.map((row) => <div className="anr-instrument-row" key={row} tabIndex={0} aria-label={`${row}: not proved`}>
          <span>{row}</span><i aria-hidden="true" /><strong>Not proved</strong>
        </div>)}
      </div>
    </div>
    <p className="anr-watermark">Empty evidence wheel · no implied performance</p>
  </div>;
}

function FunnelVisual({
  bundle,
  loading,
  isError,
  retry,
}: {
  bundle?: AnalyticsEvidenceBundle;
  loading: boolean;
  isError: boolean;
  retry: () => void;
}) {
  if (loading) return <div className="anr-chart-stage" role="status" aria-label="Reading tenant-safe sales funnel evidence.">
    <div className="anr-cylinder-funnel anr-cylinder-funnel--pending" aria-hidden="true">
      {[1, 2, 3, 4].map((stage) => <div className="anr-cylinder-stage" data-stage={stage} key={stage}><div><strong>Reading source</strong><span>Count withheld</span></div></div>)}
    </div>
    <p className="anr-watermark">Resolving the active account and exact source boundary</p>
  </div>;

  if (isError) return <div className="anr-chart-stage anr-chart-stage--message" role="alert">
    <div><strong>Evidence is unavailable or no longer current</strong><p>No previously issued funnel value or stage count was accepted.</p><button type="button" className="anr-secondary" onClick={retry}>Retry evidence read</button></div>
  </div>;

  if (bundle && bundle.truth_state !== "UNAVAILABLE" && bundle.values.stages.length > 0) {
    const covered = bundle.coverage.contributing_count;
    const candidates = bundle.coverage.candidate_count;
    return <div className="anr-chart-stage" role="group" aria-label={`${bundle.truth_state} sales funnel. ${covered} of ${candidates} candidate deal records contribute.`}>
      <div className="anr-cylinder-funnel" data-evidence-backed="true" role="list" aria-label="Source-backed funnel stages">
        {bundle.values.stages.map((stage, index) => <div className="anr-cylinder-stage anr-cylinder-stage--proved" data-stage={index + 1} key={stage.stage_key} role="listitem" tabIndex={0} aria-label={`${stage.label}: ${stage.count} contributing deal records`}>
          <div><strong>{stage.label}</strong><span><b>{stage.count}</b> deal {stage.count === 1 ? "record" : "records"}</span></div>
        </div>)}
      </div>
      <p className="anr-watermark">{bundle.truth_state} · {covered} of {candidates} candidate records contribute · no conversion implied</p>
    </div>;
  }

  return <div className="anr-chart-stage anr-chart-stage--message" role="group" aria-label="No proved pipeline stages for this account. No stage, volume, or conversion is implied.">
    <div><strong>No proved pipeline stages to show</strong><p>No canonical stage definition has been issued for this account, so no stage name, volume, or conversion can be shown here.</p></div>
  </div>;
}

function FinancialVisual() {
  const rows = ["Revenue boundary", "Direct-cost coverage", "Margin-ready overlap"];
  return <div className="anr-chart-stage" role="img" aria-label="Empty financial evidence rings. No total, margin, or ratio is implied.">
    <div className="anr-radial-composition">
      <div className="anr-radial-stack" aria-hidden="true">
        <i className="anr-radial-ring anr-radial-ring--outer" />
        <i className="anr-radial-ring anr-radial-ring--middle" />
        <i className="anr-radial-ring anr-radial-ring--inner" />
        <div className="anr-radial-core"><strong>No total</strong><span>No implied ratio</span></div>
      </div>
      <div className="anr-radial-legend">
        {rows.map((row) => <div className="anr-legend-row" key={row} tabIndex={0} aria-label={`${row}: not proved`}>
          <i aria-hidden="true" /><strong>{row}</strong><span>Not proved</span>
        </div>)}
        <p>Ring length is structural only. It is not a result, goal, comparison, or financial claim.</p>
      </div>
    </div>
    <p className="anr-watermark">Empty radial structure · no implied financial result</p>
  </div>;
}

function RetentionVisual() {
  const columns = ["Start", "W1", "W2", "W3", "W4"];
  const rows = ["Recent cohort", "Prior cohort", "Earlier cohort"];
  return <div className="anr-chart-stage" role="img" aria-label="Empty cohort grid. No retention rate or trajectory is implied.">
    <div className="anr-cohort-grid">
      <span className="anr-cohort-label" aria-hidden="true" />
      {columns.map((column) => <span className="anr-cohort-label" key={column}>{column}</span>)}
      {rows.map((row) => <React.Fragment key={row}>
        <strong className="anr-cohort-label">{row}</strong>
        {columns.map((column) => <span className="anr-cohort-cell" key={column} tabIndex={0} aria-label={`${row}, ${column}: no proved retention value`}>—</span>)}
      </React.Fragment>)}
    </div>
    <p className="anr-watermark">Empty cohort frame · no implied retention</p>
  </div>;
}

function AcquisitionVisual() {
  const nodes = ["CRM source identity", "Campaign mapping", "Revenue linkage"];
  return <div className="anr-chart-stage" role="img" aria-label="Unconnected acquisition source map. No attribution is implied.">
    <div className="anr-source-map">
      <div className="anr-source-stack">
        {nodes.map((node) => <div className="anr-source-node" key={node} tabIndex={0} aria-label={`${node}: not connected`}>
          <strong>{node}</strong><span>Not connected</span>
        </div>)}
      </div>
      <div className="anr-source-path" aria-hidden="true"><i /></div>
      <div className="anr-source-target"><strong>Canonical acquisition evidence bundle</strong><TruthBadge truth="NOT CONNECTED" /></div>
    </div>
    <p className="anr-watermark">Source-connection frame · no attribution claim</p>
  </div>;
}

function DecisionVisual() {
  const steps = ["Human", "Read", "Brain", "Trust Compass", "Write", "Rail", "Page"];
  return <div className="anr-chart-stage">
    <div className="anr-decision-frame">
      <div className="anr-decision-mark" aria-hidden="true" />
      <strong>No governed recommendation</strong>
      <p>Recommendations require proven evidence, an opaque server-issued reference, and applicable authority.</p>
      <div className="anr-spine" aria-label="Governed capability path">
        {steps.map((step) => <span key={step} data-live={step === "Human" || step === "Read" || step === "Page"}>{step}</span>)}
      </div>
      <p className="anr-muted">No action, approval, outcome, or recovery is simulated.</p>
    </div>
    <p className="anr-watermark">Governance frame · no action authority</p>
  </div>;
}

function LensVisual({ lens, bundle, loading, isError, retry }: {
  lens: Lens;
  bundle?: AnalyticsEvidenceBundle;
  loading: boolean;
  isError: boolean;
  retry: () => void;
}) {
  if (lens.route === "brief") return <BriefVisual />;
  if (lens.route === "money") return <FunnelVisual bundle={bundle} loading={loading} isError={isError} retry={retry} />;
  if (lens.route === "profit") return <FinancialVisual />;
  if (lens.route === "ret") return <RetentionVisual />;
  if (lens.route === "mkt") return <AcquisitionVisual />;
  return <DecisionVisual />;
}

const formatBoundary = (value: string) => new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
}).format(new Date(value));

export function Analytics2({ accountContext, accountEpoch = null, openPaige }: Analytics2Props) {
  const [view, setView] = useSubtabRoute("solo", "analytics", "brief");
  const tabs = [
    ["brief", "Brief"],
    ["money", "Sales funnel"],
    ["profit", "Revenue & profit"],
    ["ret", "Retention"],
    ["mkt", "Acquisition"],
    ["dec", "Decisions"],
  ] as const;
  const lens = LENSES.find((item) => item.route === view) ?? LENSES[0];
  const account = resolveTenantAccountContext(accountContext);
  const accountResolved = account.accountName !== "Your workspace" && account.accountType === "standalone";
  const [range, setRange] = React.useState<(typeof RANGE_OPTIONS)[number]>("Last 30 days");
  const evidence = useAnalyticsEvidence({
    accountEpoch,
    rangeKey: RANGE_KEYS[range],
    enabled: accountResolved && lens.route === "money",
  });
  const bundle = lens.route === "money" ? evidence.bundle : undefined;
  const activeTruth: TruthState = lens.route === "money"
    ? bundle?.truth_state ?? "UNAVAILABLE"
    : lens.truth;
  const exactRange = bundle ? `${formatBoundary(bundle.range.start)} – ${formatBoundary(bundle.range.end)}` : null;
  const sourceLabel = bundle ? "Deals + pipelines + pipeline stages" : "No source reference";
  const freshnessLabel = bundle ? formatBoundary(bundle.freshness.queried_at) : "Not queried";
  const sourceUpdatedLabel = bundle?.freshness.source_updated_through
    ? formatBoundary(bundle.freshness.source_updated_through)
    : "No contributing deal update in range";
  const evidenceReady = Boolean(evidence.evidenceReference && bundle && bundle.truth_state !== "UNAVAILABLE");
  const [inspectorOpen, setInspectorOpen] = React.useState(false);
  const pageContentRef = React.useRef<HTMLDivElement>(null);
  const dialogRef = React.useRef<HTMLElement>(null);
  const closeButtonRef = React.useRef<HTMLButtonElement>(null);
  const returnFocusRef = React.useRef<HTMLElement | null>(null);
  const tabRefs = React.useRef<Array<HTMLButtonElement | null>>([]);

  const closeEvidence = React.useCallback(() => {
    setInspectorOpen(false);
    requestAnimationFrame(() => returnFocusRef.current?.focus());
  }, []);

  React.useEffect(() => {
    if (!inspectorOpen) return;
    closeButtonRef.current?.focus();
    const pageContent = pageContentRef.current;
    const shell = pageContent?.closest<HTMLElement>("[data-tenant-shell]") ?? null;
    const shellWasInert = shell?.inert ?? false;
    const shellAriaHidden = shell?.getAttribute("aria-hidden") ?? null;
    if (pageContent) pageContent.inert = true;
    if (shell) {
      shell.inert = true;
      shell.setAttribute("aria-hidden", "true");
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeEvidence();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])')];
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && (document.activeElement === first || !dialogRef.current.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialogRef.current.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (pageContent) pageContent.inert = false;
      if (shell) {
        shell.inert = shellWasInert;
        if (shellAriaHidden === null) shell.removeAttribute("aria-hidden");
        else shell.setAttribute("aria-hidden", shellAriaHidden);
      }
    };
  }, [closeEvidence, inspectorOpen]);

  const openEvidence = (trigger: HTMLElement) => {
    returnFocusRef.current = trigger;
    setInspectorOpen(true);
  };

  const portalTheme = pageContentRef.current?.closest<HTMLElement>("[data-pg]")?.getAttribute("data-pg") ?? "dark";

  const onTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home"
      ? 0
      : event.key === "End"
        ? LENSES.length - 1
        : event.key === "ArrowRight"
          ? (index + 1) % LENSES.length
          : (index - 1 + LENSES.length) % LENSES.length;
    setView(LENSES[next].route);
    tabRefs.current[next]?.focus();
  };

  if (!accountResolved) return <section className="anr-workspace anr-account-blocked" aria-labelledby="analytics-title">
    <h1 id="analytics-title" className="anr-sr-only">Analytics</h1>
    <div className="anr-account-card"><TruthBadge truth="UNAVAILABLE" /><h2>Account context unavailable</h2><p>Analytics cannot resolve a verified active Solo account.</p><p className="anr-muted">No metric request, evidence read, PAIGE context, or action has been prepared.</p></div>
  </section>;

  return <section className="anr-workspace" aria-labelledby="analytics-title" data-analytics-truth={activeTruth}>
    <h1 id="analytics-title" className="anr-sr-only">Analytics</h1>
    <div ref={pageContentRef} className="anr-page-content" aria-hidden={inspectorOpen ? "true" : undefined}>
      <header className="anr-commandbar">
        <div className="anr-tabs" role="tablist" aria-label="Analytics workspaces">
          {tabs.map(([route, label], index) => <button
            type="button"
            role="tab"
            aria-selected={lens.route === route}
            tabIndex={lens.route === route ? 0 : -1}
            key={route}
            ref={(node) => { tabRefs.current[index] = node; }}
            onClick={() => setView(route)}
            onKeyDown={(event) => onTabKeyDown(event, index)}
          >{label}</button>)}
        </div>
        <div className="anr-command-actions">
          <span className="anr-account-context">Account <strong data-tenant-account-name>{account.accountName}</strong></span>
          <button type="button" className="anr-secondary" onClick={openPaige} disabled={!openPaige}>{openPaige ? "Open PAIGE workspace" : "PAIGE unavailable"}</button>
        </div>
      </header>

      <div className="anr-toolbar" aria-label="View controls">
        <div className="anr-range-group" role="group" aria-label="View range preference">
          <span className="anr-control-label">Range</span>
          {RANGE_OPTIONS.map((option) => <button type="button" key={option} aria-pressed={range === option} onClick={() => setRange(option)}>{option}</button>)}
        </div>
        <button type="button" className="anr-compare" disabled>Compare: off</button>
        <span className="anr-view-note">View preferences never change formulas, evidence, or caveats.</span>
      </div>

      <div className="anr-workspace-grid">
         <section className="anr-pane anr-primary-pane" aria-label={`${lens.label} evidence workspace`}>
          <header className="anr-pane-heading">
            <div><span className="anr-eyebrow">{lens.label}</span><h2>{lens.title}</h2><p>Exact range · source coverage · freshness stay attached to this view</p></div>
            <div className="anr-heading-actions"><TruthBadge truth={activeTruth} /><button type="button" className="anr-icon-action" aria-label="Open evidence" onClick={(event) => openEvidence(event.currentTarget)}>↗</button></div>
          </header>
          <div className="anr-evidence-strip" aria-label="Attached evidence summary">
            <div><span>Truth</span><strong data-truth={activeTruth}>{evidence.loading && lens.route === "money" ? "READING" : activeTruth}</strong></div>
            <div><span>Range</span><strong>{exactRange ?? range}<small>{exactRange ? "Exact server-issued boundary" : "Local preference · unissued"}</small></strong></div>
            <div><span>Source</span><strong>{sourceLabel}</strong></div>
            <div><span>Freshness</span><strong>{freshnessLabel}{bundle ? <small>Source updated through {sourceUpdatedLabel}</small> : null}</strong></div>
          </div>
          <div className="anr-pane-scroll">
            <LensVisual lens={lens} bundle={bundle} loading={evidence.loading && lens.route === "money"} isError={evidence.isError && lens.route === "money"} retry={() => { void evidence.retry(); }} />
            <div className="anr-contract-grid">
              <section>
                <span className="anr-eyebrow">Evidence contract</span>
                <h3>{bundle ? bundle.metric.label : "Canonical evidence is unavailable"}</h3>
                <dl>
                  <EvidenceRow label="Definition">{bundle?.metric.definition ?? "No canonical definition issued"}</EvidenceRow>
                  <EvidenceRow label="Exact range">{exactRange ?? "No server-issued boundary"}</EvidenceRow>
                  <EvidenceRow label="Source">{bundle ? bundle.source_references.map((source) => source.source).join(" + ") : "No bounded source reference"}</EvidenceRow>
                  <EvidenceRow label="Coverage">{bundle ? `${bundle.coverage.state} · ${bundle.coverage.contributing_count} of ${bundle.coverage.candidate_count} records contribute` : "Unavailable"}</EvidenceRow>
                  <EvidenceRow label="Freshness">{freshnessLabel}</EvidenceRow>
                </dl>
              </section>
              <aside>
                <strong>Immutable caveat</strong>
                <p>{bundle?.caveats.join(" ") ?? `${lens.summary} Values, formulas, exclusions, or comparisons cannot be redefined by a saved view.`}</p>
              </aside>
            </div>
          </div>
         </section>

        <aside className="anr-pane anr-side-pane" aria-label="Truth and governance boundary">
          <div className="anr-side-scroll">
            <section>
              <span className="anr-eyebrow">Truth boundary</span><h2>What this view can say</h2>
              <dl className="anr-truth-list">
                <div><dt>LIVE</dt><dd>Verified account context, one shell-owned PAIGE workspace, and source-bound funnel evidence when issued.</dd></div>
                <div><dt>PARTIAL</dt><dd>Funnel evidence with explicitly enumerated excluded source records; navigation and range controls remain view-only.</dd></div>
                <div><dt>UNAVAILABLE</dt><dd>Revenue, profitability, retention, attribution, comparisons, recommendations, and actions.</dd></div>
              </dl>
            </section>
            <section>
              <span className="anr-eyebrow">PAIGE spine</span><h2>Reading precedes action</h2>
              <div className="anr-spine" aria-label="Human to governed page pathway">
                {["Human", "Read", "Brain", "Trust Compass", "Write", "Rail", "Page"].map((step) => <span key={step} data-live={step === "Human" || step === "Read" || step === "Page"}>{step}</span>)}
              </div>
              <p>{evidenceReady ? "A short-lived opaque evidence reference exists for this read. PAIGE runtime binding, Trust Compass, Write, and Rail remain inactive here." : "No usable opaque evidence reference exists, so Brain, Trust Compass, Write, and Rail remain inactive here."}</p>
            </section>
            <section>
              <span className="anr-eyebrow">Decisions</span><h2>No simulated recommendation queue</h2>
              <div className="anr-decision-row"><i /> <span><strong>No governed recommendation</strong>A recommendation can appear only after proven evidence and applicable authority.</span></div>
              <div className="anr-decision-row"><i /> <span><strong>No action history claim</strong>Context Rail is not a substitute for business metrics or completeness.</span></div>
            </section>
            <section className="anr-paige-boundary">
              <strong>Read boundary</strong>
               <p>{evidenceReady ? "A presentation-safe opaque reference is issued, but the PAIGE runtime is not yet authorized to resolve it." : "Attach only a presentation-safe opaque reference after a real tenant-scoped resolver exists."}</p>
              <button type="button" disabled>Ask PAIGE for a rundown</button>
              <button type="button" disabled>Open analysis workspace</button>
            </section>
          </div>
        </aside>
      </div>
    </div>

    {inspectorOpen ? createPortal(<div className="anr-layer" data-pg={portalTheme} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeEvidence(); }}>
      <section ref={dialogRef} className="anr-drawer" role="dialog" aria-modal="true" aria-labelledby="analytics-evidence-title">
        <header>
           <div><span className="anr-eyebrow">Evidence inspector</span><h2 id="analytics-evidence-title">{lens.title}</h2><p>Presentation-safe projection · {evidenceReady ? "opaque reference issued" : "no usable opaque reference issued"}</p></div>
          <button ref={closeButtonRef} type="button" className="anr-close" onClick={closeEvidence} aria-label="Close evidence">×</button>
        </header>
        <div className="anr-drawer-scroll">
           <TruthBadge truth={activeTruth} />
           <h3>{bundle?.metric.label ?? lens.summary}</h3>
          <dl className="anr-evidence-list">
             <EvidenceRow label="Metric identity">{bundle ? `${bundle.metric.id} · ${bundle.metric.label}` : `${lens.title} · canonical identity unavailable`}</EvidenceRow>
             <EvidenceRow label="Definition">{bundle?.metric.definition ?? "UNAVAILABLE — no canonical definition issued"}</EvidenceRow>
             <EvidenceRow label="Formula / version">{bundle ? `${bundle.metric.formula} · ${bundle.metric.version}` : "UNAVAILABLE — no canonical formula or version issued"}</EvidenceRow>
             <EvidenceRow label="Exact requested range">{exactRange ?? `UNAVAILABLE — ${range} is a local preference, not a server-issued boundary`}</EvidenceRow>
             <EvidenceRow label="Source references">{bundle ? bundle.source_references.map((source) => `${source.source} (${source.boundary})`).join("; ") : "No bounded source references issued"}</EvidenceRow>
             <EvidenceRow label="Contributing records">{bundle ? bundle.coverage.contributing_count : "UNAVAILABLE — no server-derived count"}</EvidenceRow>
             <EvidenceRow label="Completeness / coverage">{bundle ? `${bundle.coverage.state} · ${bundle.coverage.contributing_count} of ${bundle.coverage.candidate_count}` : "UNAVAILABLE — completeness cannot be inferred"}</EvidenceRow>
             <EvidenceRow label="Exclusions">{bundle ? (bundle.exclusions.length ? bundle.exclusions.map((item) => `${item.reason}: ${item.count}`).join("; ") : "None within the bounded source") : "UNAVAILABLE — exclusions cannot be enumerated without a canonical resolver"}</EvidenceRow>
             <EvidenceRow label="Freshness / queried at">{bundle ? `${freshnessLabel} · source updated through ${sourceUpdatedLabel} · immutable source revision attached` : "NOT QUERIED — no Analytics Evidence Bundle was resolved"}</EvidenceRow>
             <EvidenceRow label="Truth state">{activeTruth}</EvidenceRow>
          </dl>
          <div className="anr-next-step"><strong>Next safe step</strong><p>{lens.nextStep}</p></div>
          <div className="anr-boundary">PAIGE may receive only an opaque server-resolved evidence reference. Raw events, customer content, provider payloads, prompts, and client-authoritative values are not exposed here.</div>
        </div>
        <footer><button type="button" className="anr-secondary" onClick={closeEvidence}>Close</button><button type="button" disabled>Ask PAIGE for a rundown</button></footer>
      </section>
    </div>, document.body) : null}
  </section>;
}

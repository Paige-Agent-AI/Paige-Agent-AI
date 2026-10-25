import { useMemo, useState } from "react";
import { BookOpen, Brain, Bot, RotateCw, Wrench } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useTenantContext } from "@/hooks/useTenantContext";
import { useSoloKnowledge } from "./data/useSoloKnowledge";
import { useSoloSkills } from "./data/useSoloSkills";
import { usePaigeLiveStatus } from "./usePaigeLiveStatus";
import { presentCatalogueCoverage } from "./catalogue-coverage";
import { TruthPill } from "./TruthPill";

/**
 * The Knowledge / Helpers / Capabilities workspace panels, in their own module so the
 * chat-first Solo entry does not download them (they mount behind React.lazy in
 * SoloPaigeWorkspace — the same pattern the Live 3D scene and the sales-ops agreement
 * workspace already use). Everything inside is a verbatim move from SoloPaigeWorkspace;
 * only TruthPill is also exported back to the workspace, which still uses it in the
 * focus banners.
 */

const MindLink = () => {
  const navigate = useNavigate();
  const { activeTenant } = useTenantContext();
  const account = activeTenant?.account_number ?? null;
  return (
    <button type="button" className="spw-link-button" disabled={!account} title={account ? "Open the governed Mind record index" : "Mind opens after this account resolves"} onClick={() => account && navigate(`/solo/${account}/command-center/mind`)}>
      <Brain aria-hidden size={14} /> Open in Mind
    </button>
  );
};

const PanelHeader = ({ eyebrow, title, description, state }: { eyebrow: string; title: string; description: string; state: ReactNode }) => (
  <header className="spw-view-head">
    <div>
      <span className="spw-eyebrow">{eyebrow}</span>
      <h2>{title}</h2>
      <p>{description}</p>
    </div>
    {state}
  </header>
);

export function KnowledgeView() {
  const knowledge = useSoloKnowledge();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="spw-management-view">
      <PanelHeader
        eyebrow="Intentional business knowledge"
        title="Sources PAIGE may use for this business"
        description="Documents, SOPs, templates, policies, operating packs, and installed knowledge remain attributed to the active Solo account."
        state={<TruthPill tone="live">Tenant-scoped read</TruthPill>}
      />
      <div className="spw-scroll">
        <div className="spw-knowledge-layout">
          <section className="spw-stack" aria-label="Knowledge sources">
            {knowledge.loading && <div className="spw-state" role="status">Loading this account’s knowledge…</div>}
            {knowledge.error && (
              <div className="spw-state spw-state-error" role="alert">
                <strong>Knowledge could not be loaded.</strong>
                <span>{knowledge.error}</span>
                <button type="button" onClick={knowledge.refresh}><RotateCw aria-hidden size={14} /> Retry</button>
              </div>
            )}
            {knowledge.empty && (
              <div className="spw-state">
                <BookOpen aria-hidden size={24} />
                <strong>No indexed knowledge yet</strong>
                <span>Add, connect, install, and removal flows are not activated in this workspace.</span>
              </div>
            )}
            {knowledge.docs.map((doc) => {
              const expanded = expandedId === doc.id;
              return (
                <article key={doc.id} className="spw-source-card">
                  <div className="spw-card-row">
                    <span className="spw-symbol" style={{ color: doc.color }}><BookOpen aria-hidden size={16} /></span>
                    <div className="spw-card-copy">
                      <h3>{doc.title}</h3>
                      <p>{doc.domain ?? "Knowledge document"} · {doc.chunkCount} indexed section{doc.chunkCount === 1 ? "" : "s"}</p>
                    </div>
                    <TruthPill tone="live">Available</TruthPill>
                  </div>
                  {expanded && (
                    <div className="spw-provenance">
                      <p>{doc.summary ?? "No summary supplied."}</p>
                      <dl>
                        <div><dt>Source</dt><dd>{doc.source ?? "Source label unavailable"}</dd></div>
                        <div><dt>Freshness</dt><dd>{doc.when || "Date unavailable"}</dd></div>
                        <div><dt>Scope</dt><dd>Active Solo account only</dd></div>
                        <div><dt>Permission</dt><dd>PAIGE may retrieve; mutation is not enabled here</dd></div>
                      </dl>
                    </div>
                  )}
                  <footer className="spw-card-actions">
                    <button type="button" onClick={() => setExpandedId(expanded ? null : doc.id)} aria-expanded={expanded}>
                      {expanded ? "Hide provenance" : "Review provenance"}
                    </button>
                    <MindLink />
                    <button type="button" disabled title="Disconnect requires a verified source lifecycle">Disconnect unavailable</button>
                  </footer>
                </article>
              );
            })}
          </section>
          <aside className="spw-explainer">
            <TruthPill tone="live">Mind is available</TruthPill>
            <h3>Knowledge is practical; Mind is relational</h3>
            <p>Knowledge is where intentional business information is reviewed and used with PAIGE. Mind is the Command Center owner for governed provenance, recall, and decision references. It does not invent relationships or unavailable history.</p>
            <MindLink />
            <hr />
            <TruthPill tone="partial">Recall remains contextual</TruthPill>
            <p>“PAIGE wants to remember…” proposals may appear in Chat only when the current contract supplies them. Durable review and forgetting are not activated here.</p>
          </aside>
        </div>
      </div>
    </div>
  );
}

export function HelpersView() {
  return (
    <div className="spw-management-view">
      <PanelHeader
        eyebrow="Bounded task delegation"
        title="Current delegations—not a flat permanent roster"
        description="PAIGE remains the command layer. Durable named leadership appears contextually only when responsibility is grounded; temporary workers stay task-scoped and revocable."
        state={<TruthPill tone="partial">Runtime partial</TruthPill>}
      />
      <div className="spw-scroll">
        <div className="spw-helper-summary">
          <span className="spw-symbol"><Bot aria-hidden size={17} /></span>
          <div><strong>No active bounded delegation is proven</strong><p>No bounded-task dataset is wired to this view. Existing specialist records do not prove a current task, parent link, end condition, or durable revocation.</p></div>
        </div>
        <div className="spw-card-grid">
          <article className="spw-layer-card"><TruthPill tone="unavailable">No active task</TruthPill><h3>Ephemeral helper</h3><p>Must show exact scope, responsible delegator, start, end condition, approval state, and revocation. Creation is not activated here.</p><button type="button" disabled>Revoke unavailable</button></article>
          <article className="spw-layer-card"><TruthPill tone="proposed">Mind-owned roster</TruthPill><h3>Durable named leadership</h3><p>Named identities are not flattened into this task view. Chat introduces one only when PAIGE delegates, receives a result, requests approval, or explains responsibility.</p><MindLink /></article>
          <article className="spw-layer-card"><TruthPill tone="partial">Visibility only</TruthPill><h3>Department specialist</h3><p>Existing records can indicate availability, but hierarchy, authority ceiling, task activity, and durable revocation remain unproven in this frontend.</p><button type="button" disabled>Delegation not activated</button></article>
        </div>
      </div>
    </div>
  );
}

export function CapabilitiesView() {
  const capability = useSoloSkills();
  const rows = useMemo(() => capability.skills, [capability.skills]);
  // The Live row's access state is THIS account's canonical acknowledgement truth
  // (review #2611 P2-3: a permanent hard-coded label is not an account-state
  // implementation). "Acknowledged" means the person turned Live on for this
  // account — it is never a claim that audio was verified.
  const live = usePaigeLiveStatus();
  const liveRow = live.state === "acknowledged"
    ? { tone: "live" as const, pill: "Available", access: "Turned on for this account" }
    : live.state === "revoked"
      ? { tone: "unavailable" as const, pill: "Revoked", access: "Off for this account" }
      : live.state === "expired"
        ? { tone: "partial" as const, pill: "Consent expired", access: "Renew in chat to listen" }
        : live.state === "loading"
          ? { tone: "neutral" as const, pill: "Checking this account", access: "Checking…" }
          : live.state === "unknown" || live.state === "unauthenticated"
            // "unauthenticated" is practically unreachable behind this view's auth, but
            // if it ever surfaces the honest answer is Unverified — never a guessed
            // consent state (review #2657 P3-2).
            ? { tone: "neutral" as const, pill: "Unverified", access: "Could not check" }
            : { tone: "partial" as const, pill: "Consent required", access: "Not activated yet" };
  return (
    <div className="spw-management-view">
      <PanelHeader
        eyebrow="Skill catalogue"
        title="Workspace capabilities"
        description="Coverage shows released functionality. PAIGE checks permissions and connections when you ask."
        state={<TruthPill>Catalogue</TruthPill>}
      />
      <div className="spw-scroll">
        <section className="spw-capabilities" aria-label="Capabilities">
          <div className="spw-cap-head"><span>Capability</span><span>Coverage</span><span>Access</span></div>
          {capability.loading && <div className="spw-state" role="status">Loading this workspace’s skill catalogue…</div>}
          {capability.error && <div className="spw-state spw-state-error" role="alert"><strong>Capabilities could not be loaded.</strong><span>{capability.error}</span><button type="button" onClick={capability.refresh}><RotateCw aria-hidden size={14} /> Retry</button></div>}
          {capability.empty && <div className="spw-state"><Wrench aria-hidden size={24} /><strong>No skills are listed</strong><span>This workspace’s skill catalogue is empty.</span></div>}
          {rows.map((skill) => {
            const coverage = presentCatalogueCoverage(skill);
            return (
            <div className="spw-cap-row" key={skill.slug}>
              <div><strong>{skill.n}</strong><small>{skill.d || skill.cat || "Registry description unavailable"}</small></div>
              <TruthPill tone={coverage?.tone}>{coverage?.label ?? (skill.on ? "Listed" : "Inactive")}</TruthPill>
              <span>Unverified</span>
            </div>
            );
          })}
          {/* §13 — THIS ROW CONTRADICTED THE SURFACE IT DESCRIBES. It read "Partial / Not
              activated" while the hold-to-dictate mic sits live in the composer one tab away, in
              this same workspace, wired to `paige-dictate`. A capability panel that tells a person
              something is off while they can see it working is worse than no panel: it makes every
              other row on it unreliable too.
              The pill and copy are CD's (§00). What is asserted about whether the thing WORKS is
              a fact, and the fact was wrong. */}
          <div className="spw-cap-row"><div><strong>Voice input</strong><small>Hold the mic in the composer to dictate. Speech-to-text only — Paige does not speak back here.</small></div><TruthPill tone="live">Available</TruthPill><span>Active</span></div>
          {/* Dictation is one-way input; this row is the two-way surface, and the two must stay
              distinguishable (owner capabilities directive: never conflate voice dictation with
              bidirectional Live Conversation). Live audio is off for an account until the owner of
              the voice accepts the speech-provider terms in the Live surface — so the honest access
              state is consent-required, never Active, until a person has actually turned it on.
              The label is this account's current fact, derived per-account when Live state is
              verified end-to-end (EXP01 PR5). */}
          <div className="spw-cap-row"><div><strong>Live Conversation</strong><small>Two-way voice with Paige inside your chat — she listens and speaks in the same conversation. {liveRow.access === "Turned on for this account" ? "You turned this on; it stays yours to pause or end at any time." : "Off for your account until you turn it on from the chat composer: your browser asks for microphone permission, and Paige explains what the speech provider keeps before anything starts."}</small></div><TruthPill tone={liveRow.tone}>{liveRow.pill}</TruthPill><span>{liveRow.access}</span></div>
          <div className="spw-cap-row"><div><strong>Onboarding & business discovery</strong><small>Paige interviews your business in chat, tracks every confirmed detail into Setup, and you review, skip or correct each one. Speak or type — speaking needs Live Conversation turned on.</small></div><TruthPill tone="live">Available</TruthPill><span>Active</span></div>
          <div className="spw-cap-row"><div><strong>Code or sandbox execution</strong><small>Contextual previews may be shown, but no execution substrate is available.</small></div><TruthPill tone="unavailable">Unavailable</TruthPill><span>Off</span></div>
        </section>
      </div>
    </div>
  );
}

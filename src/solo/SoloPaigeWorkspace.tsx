import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from "react";
import { BookOpen, Bot, Brain, MessageSquarePlus, MessagesSquare, RotateCw, Search, Sparkles, Wrench, X } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { PaigeAIChat, type ChatRailApi } from "@/components/dashboard/PaigeAIChat";
import { PaigeComposerAutonomyChip } from "@/components/dashboard/paige/PaigeComposerAutonomyChip";
import { useTenantContext } from "@/hooks/useTenantContext";
import { useTierFeatures } from "@/hooks/useTierFeatures";
import { useSubtabRoute } from "@/lib/routing/useSubtabRoute";
import { useSoloKnowledge } from "./data/useSoloKnowledge";
import { useSoloSkills } from "./data/useSoloSkills";
import { clearPaigeSurfaceScope, getPaigeBusinessPlanScope, getPaigeClientScope, subscribePaigeClientScope } from "./paigeClientScope";
import { clearPaigePublicPresenceScope, getPaigePublicPresenceScope, subscribePaigePublicPresenceScope } from "./paigePublicPresenceScope";
import "./solo-paige-workspace.css";

// Approved design lineage: 51D7A6F680DB83AEF6BFE1147E9FC1651E39206EFAED17963F2FC16EC294F117
type SoloPaigeTab = "chat" | "knowledge" | "helpers" | "capabilities";

const TABS: Array<{ id: SoloPaigeTab; label: string; icon: typeof Sparkles }> = [
  { id: "chat", label: "Chat", icon: Sparkles },
  { id: "knowledge", label: "Knowledge", icon: BookOpen },
  { id: "helpers", label: "Helpers", icon: Bot },
  { id: "capabilities", label: "Capabilities", icon: Wrench },
];

const TruthPill = ({ tone = "neutral", children }: { tone?: "live" | "partial" | "unavailable" | "proposed" | "neutral"; children: ReactNode }) => (
  <span className={`spw-truth spw-truth-${tone}`}>{children}</span>
);

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

function KnowledgeView() {
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

function HelpersView() {
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

function SoloHistoryRail({ api }: { api: ChatRailApi }) {
  const [query, setQuery] = useState("");
  const modalRef = useRef<HTMLElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!api.mobileOpen) return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    window.requestAnimationFrame(() => modalRef.current?.querySelector<HTMLInputElement>("input")?.focus());
    return () => returnFocusRef.current?.focus();
  }, [api.mobileOpen]);
  const onModalKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      api.onMobileOpenChange(false);
      return;
    }
    if (event.key !== "Tab" || !modalRef.current) return;
    const focusable = Array.from(modalRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'));
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  const visibleThreads = api.threads.filter((thread) =>
    (thread.title || "Untitled conversation").toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  const threadList = (
    <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2" aria-label="Conversation history">
      {api.isLoading && <p role="status" className="px-2 py-3 text-xs text-muted-foreground">Loading conversations…</p>}
      {!api.isLoading && visibleThreads.length === 0 && <p className="px-2 py-3 text-xs text-muted-foreground">{query ? "No matching conversations" : "No saved conversations yet"}</p>}
      {visibleThreads.map((thread) => (
        <button
          key={thread.id}
          type="button"
          aria-current={thread.id === api.activeThreadId ? "page" : undefined}
          onClick={() => { api.onSelect(thread.id); api.onMobileOpenChange(false); }}
          className="mb-1 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:bg-muted"
        >
          <MessagesSquare aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">{thread.title || "Untitled conversation"}</span>
          {thread.id === api.streamingThreadId && <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-label="Response running" />}
        </button>
      ))}
    </div>
  );
  const controls = (
    <>
      <label className="relative mx-2 mt-2 block">
        <Search aria-hidden className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <span className="sr-only">Search conversations</span>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search conversations" className="h-8 w-full rounded-lg border border-border bg-background pl-8 pr-2 text-xs outline-none focus:ring-2 focus:ring-ring" />
      </label>
      <button type="button" onClick={() => { api.onNewChat(); api.onMobileOpenChange(false); }} className="mx-2 my-2 flex h-8 items-center justify-center gap-2 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <MessageSquarePlus aria-hidden className="h-3.5 w-3.5" /> New chat
      </button>
    </>
  );

  return (
    <>
      <aside data-solo-thread-rail="true" className="flex w-52 shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-card" aria-label="PAIGE conversations">
        {controls}{threadList}
      </aside>
      {api.mobileOpen && (
        <div className="fixed inset-0 z-50 flex bg-background/70 p-3 backdrop-blur-sm" role="presentation" onMouseDown={() => api.onMobileOpenChange(false)}>
          <section ref={modalRef} role="dialog" aria-modal="true" aria-label="PAIGE conversations" className="flex h-full w-full max-w-xs flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xl" onMouseDown={(event) => event.stopPropagation()} onKeyDown={onModalKeyDown}>
            <header className="flex items-center justify-between border-b border-border px-3 py-2"><strong className="text-sm">Conversations</strong><button type="button" onClick={() => api.onMobileOpenChange(false)} aria-label="Close conversations" className="rounded p-1 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><X aria-hidden className="h-4 w-4" /></button></header>
            {controls}{threadList}
          </section>
        </div>
      )}
    </>
  );
}

function CapabilitiesView() {
  const capability = useSoloSkills();
  const rows = useMemo(() => capability.skills, [capability.skills]);
  return (
    <div className="spw-management-view">
      <PanelHeader
        eyebrow="Capability Registry"
        title="What PAIGE can actually use"
        description="Capabilities are skills, tools, connectors, and executable abilities. Marketplace acquisition remains separate and is not implemented here."
        state={<TruthPill tone="live">Registry read</TruthPill>}
      />
      <div className="spw-scroll">
        <section className="spw-capabilities" aria-label="Capabilities">
          <div className="spw-cap-head"><span>Capability</span><span>Availability</span><span>Authority</span></div>
          {capability.loading && <div className="spw-state" role="status">Loading available capabilities…</div>}
          {capability.error && <div className="spw-state spw-state-error" role="alert"><strong>Capabilities could not be loaded.</strong><span>{capability.error}</span><button type="button" onClick={capability.refresh}><RotateCw aria-hidden size={14} /> Retry</button></div>}
          {capability.empty && <div className="spw-state"><Wrench aria-hidden size={24} /><strong>No callable capabilities are available</strong><span>This is an honest empty registry state, not a permissions promise.</span></div>}
          {rows.map((skill) => (
            <div className="spw-cap-row" key={skill.slug}>
              <div><strong>{skill.n}</strong><small>{skill.d || skill.cat || "Registry description unavailable"}</small></div>
              <TruthPill tone={skill.on ? "live" : "unavailable"}>{skill.on ? "Available" : "Unavailable"}</TruthPill>
              <span>{skill.ro ? "Read only" : "Ask first"}</span>
            </div>
          ))}
          {/* §13 — THIS ROW CONTRADICTED THE SURFACE IT DESCRIBES. It read "Partial / Not
              activated" while the hold-to-dictate mic sits live in the composer one tab away, in
              this same workspace, wired to `paige-dictate`. A capability panel that tells a person
              something is off while they can see it working is worse than no panel: it makes every
              other row on it unreliable too.
              The pill and copy are CD's (§00). What is asserted about whether the thing WORKS is
              a fact, and the fact was wrong. */}
          <div className="spw-cap-row"><div><strong>Voice input</strong><small>Hold the mic in the composer to dictate. Speech-to-text only — Paige does not speak back here.</small></div><TruthPill tone="live">Available</TruthPill><span>Active</span></div>
          <div className="spw-cap-row"><div><strong>Code or sandbox execution</strong><small>Contextual previews may be shown, but no execution substrate is available.</small></div><TruthPill tone="unavailable">Unavailable</TruthPill><span>Off</span></div>
        </section>
      </div>
    </div>
  );
}

export function SoloPaigeWorkspace({
  full = false,
  dockedTab,
  onDockedTabChange,
}: {
  full?: boolean;
  dockedTab?: SoloPaigeTab;
  onDockedTabChange?: (tab: SoloPaigeTab) => void;
} = {}) {
  const { activeTenantId } = useTenantContext();
  // §60 — does this account type carry Live Conversation? Answered in the one home
  // (src/lib/tier/tierFeatures.ts), never by an inline account_type compare. While the tenant is
  // still resolving the classification defaults to the permissive solo tier, so stay optimistic
  // rather than flashing the control away and back; the database refuses independently
  // (live_conversation_tier_allows), so this decides presentation, not permission.
  const { has: hasTierFeature, loading: tierLoading } = useTierFeatures();
  const liveConversationAvailable = tierLoading || hasTierFeature("live_conversation");
  const location = useLocation();
  const navigate = useNavigate();
  // The client a Solo surface pointed PAIGE at, read for THIS account only. The store
  // refuses a scope stamped with another account, so an account switch cannot surface
  // the previous account's client even for one frame.
  const readScope = useCallback(() => getPaigeClientScope(activeTenantId), [activeTenantId]);
  const clientScope = useSyncExternalStore(subscribePaigeClientScope, readScope, () => null);
  const readPresenceScope = useCallback(() => getPaigePublicPresenceScope(activeTenantId), [activeTenantId]);
  const presenceScope = useSyncExternalStore(subscribePaigePublicPresenceScope, readPresenceScope, () => null);
  const readPlanScope = useCallback(() => getPaigeBusinessPlanScope(activeTenantId), [activeTenantId]);
  const planScope = useSyncExternalStore(subscribePaigeClientScope, readPlanScope, () => null);
  // The chat asks the surface that OWNS focus to let it go — on a PERMISSION verdict, or
  // when a saved thread is resumed whose content is not about this client. Either way,
  // continuing to assert the focus would make the next turn mean something untrue.
  const releaseScope = useCallback(() => { clearPaigeSurfaceScope(); clearPaigePublicPresenceScope(); }, []);
  const [routedTab, setRoutedTab] = useSubtabRoute("solo", "paige", "chat");
  const [localTab, setLocalTab] = useState<SoloPaigeTab>(dockedTab ?? "chat");
  const acceptedRoutedTab = (TABS.some((item) => item.id === routedTab) ? routedTab : "chat") as SoloPaigeTab;
  const acceptedDockedTab = dockedTab && TABS.some((item) => item.id === dockedTab) ? dockedTab : localTab;
  const tab = full ? acceptedRoutedTab : acceptedDockedTab;
  const setTab = (nextTab: SoloPaigeTab) => {
    if (full) {
      setRoutedTab(nextTab);
      return;
    }
    setLocalTab(nextTab);
    onDockedTabChange?.(nextTab);
  };
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    if (!full) return;
    setLocalTab(acceptedRoutedTab);
    onDockedTabChange?.(acceptedRoutedTab);
  }, [acceptedRoutedTab, full, onDockedTabChange]);

  useEffect(() => {
    if (!full) return;
    const parts = location.pathname.split("/").filter(Boolean);
    const paigeIndex = parts.indexOf("paige");
    const requestedSubtab = paigeIndex >= 0 ? parts[paigeIndex + 1] : undefined;
    if (!requestedSubtab || TABS.some((item) => item.id === requestedSubtab)) return;
    navigate(`/${[...parts.slice(0, paigeIndex + 1), "chat"].join("/")}${location.search}`, { replace: true });
  }, [full, location.pathname, location.search, navigate]);

  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!(["ArrowLeft", "ArrowRight", "Home", "End"] as string[]).includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? TABS.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + TABS.length) % TABS.length;
    setTab(TABS[next].id);
    tabRefs.current[next]?.focus();
  };

  return (
    <div className="spw-root" data-account-epoch={activeTenantId ?? "resolving"} style={{ containerType: "inline-size" }}>
      <style>{`@container (max-width: 650px){[data-solo-thread-rail="true"]{display:none!important}[data-solo-mobile-history="true"]{display:flex!important}.spw-tabs button{padding-inline:6px;font-size:11px;gap:4px}}`}</style>
      <div className="spw-tabs" role="tablist" aria-label="Solo PAIGE workspace">
        {TABS.map((item, index) => {
          const Icon = item.icon;
          return <button key={item.id} ref={(node) => { tabRefs.current[index] = node; }} type="button" role="tab" id={`spw-tab-${item.id}`} aria-controls={`spw-panel-${item.id}`} aria-selected={tab === item.id} tabIndex={tab === item.id ? 0 : -1} onClick={() => setTab(item.id)} onKeyDown={(event) => onTabKeyDown(event, index)}><Icon aria-hidden size={15} />{item.label}</button>;
        })}
      </div>
      <section id="spw-panel-chat" role="tabpanel" aria-labelledby="spw-tab-chat" hidden={tab !== "chat"} className="spw-panel spw-chat-panel">
        <PaigeAIChat
          hideHeader
          fill
          enableHistory
          soloTenantSafety
          liveConversation={liveConversationAvailable}
          composerAutonomyControl={<PaigeComposerAutonomyChip accountEpoch={activeTenantId} />}
          renderRail={(api) => <SoloHistoryRail api={api} />}
          greeting="What are we moving? Tell me the outcome, and I’ll show what I can read, draft, or ask you to approve."
          clientId={clientScope?.clientId ?? null}
          surfaceContext={!clientScope && !planScope && presenceScope ? { kind: presenceScope.kind, step: presenceScope.step, intendedAction: presenceScope.intendedAction } : undefined}
          businessMissionId={!clientScope ? planScope?.businessMissionId ?? null : null}
          onFocusRelease={releaseScope}
          focusBanner={clientScope ? (
            <div className="spw-chat-head" data-solo-paige-focus>
              <TruthPill tone="partial">IN CONTEXT</TruthPill>
              <div><strong>{clientScope.label}</strong><span>Recorded outcomes for this client only. PAIGE reads them; she cannot change them.</span></div>
              <button type="button" className="spw-link-button spw-authority" onClick={releaseScope}>Clear</button>
            </div>
          ) : planScope ? (
            <div className="spw-chat-head" data-solo-paige-focus>
              <TruthPill tone="partial">PLAN IN CONTEXT</TruthPill>
              <div><strong>{planScope.label}</strong><span>Resolved from the active workspace. Changes still require authority, canonical readback, and Rail evidence.</span></div>
              <button type="button" className="spw-link-button spw-authority" onClick={releaseScope}>Clear</button>
            </div>
          ) : presenceScope ? (
            <div className="spw-chat-head" data-solo-paige-focus>
              <TruthPill tone="partial">PUBLIC PRESENCE</TruthPill>
              <div><strong>Safe public-business context</strong><span>PAIGE re-resolves approved facts and provider availability on the server for each turn.</span></div>
              <button type="button" className="spw-link-button spw-authority" onClick={releaseScope}>Clear</button>
            </div>
          ) : undefined}
          conversationHeader={<div className="spw-chat-head"><div><strong>PAIGE</strong><span>Active Solo account · tenant-scoped</span></div></div>}
        />
      </section>
      <section id="spw-panel-knowledge" role="tabpanel" aria-labelledby="spw-tab-knowledge" hidden={tab !== "knowledge"} className="spw-panel">{tab === "knowledge" && <KnowledgeView />}</section>
      <section id="spw-panel-helpers" role="tabpanel" aria-labelledby="spw-tab-helpers" hidden={tab !== "helpers"} className="spw-panel">{tab === "helpers" && <HelpersView />}</section>
      <section id="spw-panel-capabilities" role="tabpanel" aria-labelledby="spw-tab-capabilities" hidden={tab !== "capabilities"} className="spw-panel">{tab === "capabilities" && <CapabilitiesView />}</section>
      <span className="spw-sr" aria-live="polite">{TABS.find((item) => item.id === tab)?.label} view open</span>
    </div>
  );
}


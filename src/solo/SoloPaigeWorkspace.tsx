import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from "react";
import { BookOpen, Bot, MessageSquarePlus, MessagesSquare, Search, Sparkles, Telescope, Wrench, X } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { PaigeAIChat, type ChatRailApi } from "@/components/dashboard/PaigeAIChat";
import { SoloPlanningSuggestion } from "./SoloPlanningSuggestion";
import { planningWorkRelevant } from "./planning-suggestion-context";
import { TruthPill } from "./TruthPill";
import { PaigeComposerAutonomyChip } from "@/components/dashboard/paige/PaigeComposerAutonomyChip";
import { useTenantContext } from "@/hooks/useTenantContext";
import { isSoloSetupComplete } from "@/components/auth/RequireSetupComplete";
import { useTierFeatures } from "@/hooks/useTierFeatures";
import { useSubtabRoute } from "@/lib/routing/useSubtabRoute";
import { clearPaigeSurfaceScope, getPaigeBusinessPlanScope, getPaigeClientScope, subscribePaigeClientScope } from "./paigeClientScope";
import { clearPaigePublicPresenceScope, getPaigePublicPresenceScope, subscribePaigePublicPresenceScope } from "./paigePublicPresenceScope";
import "./solo-paige-workspace.css";
import { WeeklyResponsibilityEntry } from "./weekly/WeeklyResponsibilityEntry";
import { SoloBusinessInterview } from "./SoloBusinessInterview";
import { supabase } from "@/integrations/supabase/client";
import { interviewThreadFromSearch } from "./solo-interview-navigation";
import { cleanInterviewCheckpoint, INTERVIEW_NEXT_PROMPTS } from "./solo-business-interview-contract";
import { SoloOnboardingStage, type OnboardingProfileStatus } from "./SoloOnboardingStage";

// Approved design lineage: 51D7A6F680DB83AEF6BFE1147E9FC1651E39206EFAED17963F2FC16EC294F117
type SoloPaigeTab = "chat" | "knowledge" | "research" | "helpers" | "capabilities";

const TABS: Array<{ id: SoloPaigeTab; label: string; icon: typeof Sparkles }> = [
  { id: "chat", label: "Chat", icon: Sparkles },
  { id: "knowledge", label: "Knowledge", icon: BookOpen },
  { id: "research", label: "Research", icon: Telescope },
  { id: "helpers", label: "Helpers", icon: Bot },
  { id: "capabilities", label: "Capabilities", icon: Wrench },
];

// The four non-chat panels load on their first visit, not with the entry: a person
// meeting PAIGE opens Chat, and Knowledge/Helpers/Capabilities/Research (with their
// data layers) are a dynamic import away — the same pattern as the Live 3D scene and
// the sales-ops agreement workspace. Chunk-load failures propagate to the existing
// SoloScreenBoundary, exactly as any module failure does today.
const KnowledgeView = lazy(() => import("./SoloWorkspacePanels").then((m) => ({ default: m.KnowledgeView })));
const HelpersView = lazy(() => import("./SoloWorkspacePanels").then((m) => ({ default: m.HelpersView })));
const CapabilitiesView = lazy(() => import("./SoloWorkspacePanels").then((m) => ({ default: m.CapabilitiesView })));
const ResearchView = lazy(() => import("@/solo/paige-research").then((m) => ({ default: m.ResearchView })));
const OpeningPanel = ({ name }: { name: string }) => (
  <div className="spw-state" role="status">Opening the {name} view…</div>
);

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

export function SoloPaigeWorkspace({
  full = false,
  dockedTab,
  onDockedTabChange,
  onboarding = false,
  visible = true,
}: {
  full?: boolean;
  dockedTab?: SoloPaigeTab;
  onDockedTabChange?: (tab: SoloPaigeTab) => void;
  onboarding?: boolean;
  visible?: boolean;
} = {}) {
  const { activeTenantId, activeUserId, activeTenant, isPlatformStaff } = useTenantContext();
  // §60 — does this account type carry Live Conversation? Answered in the one home
  // (src/lib/tier/tierFeatures.ts), never by an inline account_type compare. While the tenant is
  // still resolving the classification defaults to the permissive solo tier, so stay optimistic
  // rather than flashing the control away and back; the database refuses independently
  // (live_conversation_tier_allows), so this decides presentation, not permission.
  const { has: hasTierFeature, loading: tierLoading } = useTierFeatures();
  const liveConversationAvailable = tierLoading || hasTierFeature("live_conversation");
  const location = useLocation();
  const navigate = useNavigate();
  // Completion retirement: the canonical setup journey's completion marker
  // (features.solo_setup_complete, written by the first successful Setup save)
  // ends first-run presentation EVEN IF the URL still carries ?onboarding=1 —
  // a completed owner must never re-encounter interview chrome through a
  // stale link (§2F). The tenant context refreshes after a save, so this
  // retires in-session, not just on the next reload.
  const setupComplete = isSoloSetupComplete(activeTenant?.features);
  const firstRun = !isPlatformStaff && !setupComplete && (onboarding || new URLSearchParams(location.search).get("onboarding") === "1");
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
  const [interviewOpen, setInterviewOpen] = useState(firstRun);
  const [interviewThreadId, setInterviewThreadId] = useState<string | null>(null);
  const [chatBusy, setChatBusy] = useState(false);
  const [interviewRefresh, setInterviewRefresh] = useState(0);
  const wasChatBusy = useRef(false);
  const observedThread = useRef<string | null>(null);
  const requestedInterview = interviewThreadFromSearch(location.search);
  const [resumeAttempt, setResumeAttempt] = useState(0);
  const resumeScope = `${activeTenantId}:${requestedInterview}`;
  const liveResumeScope = useRef(resumeScope); liveResumeScope.current = resumeScope;
  const [verifiedResume, setVerifiedResume] = useState<{ scope: string; state: "ready" | "failed" } | null>(null);
  const [profileStatus, setProfileStatus] = useState<OnboardingProfileStatus | null>(null);
  const observeProfile = useCallback((status: OnboardingProfileStatus) => {
    setProfileStatus(previous => previous?.tenantId === status.tenantId && previous.state === status.state && previous.confirmedCount === status.confirmedCount && previous.hasConfirmedPriority === status.hasConfirmedPriority ? previous : status);
  }, []);
  const observeChat = useCallback((_steps: unknown, loading: boolean) => {
    setChatBusy(loading);
    if (wasChatBusy.current && !loading) setInterviewRefresh(epoch => epoch + 1);
    wasChatBusy.current = loading;
  }, []);
  const observeThread = useCallback((id: string | null) => {
    if (!firstRun && observedThread.current && observedThread.current !== id) setInterviewOpen(false);
    observedThread.current = id; setInterviewThreadId(id);
    if (requestedInterview && id !== requestedInterview) {
      const search = new URLSearchParams(location.search);
      if (id) search.set("interviewThread", id); else search.delete("interviewThread");
      navigate(`${location.pathname}${search.size ? `?${search}` : ""}`, { replace: true });
    }
  }, [firstRun, requestedInterview, location.pathname, location.search, navigate]);
  useEffect(() => { setInterviewOpen(false); setInterviewThreadId(null); observedThread.current = null; setChatBusy(false); wasChatBusy.current = false; }, [activeTenantId]);
  useEffect(() => { if (firstRun) setInterviewOpen(true); }, [firstRun, activeTenantId]);
  useEffect(() => {
    if (!activeTenantId || !requestedInterview || clientScope || planScope || presenceScope) return;
    let current = true;
    const deadline = setTimeout(() => {
      if (current && liveResumeScope.current === resumeScope) {
        current = false;
        setVerifiedResume({ scope: resumeScope, state: "failed" });
      }
    }, 30000);
    setVerifiedResume(null);
    setInterviewOpen(false);
    void (async () => {
      try {
        const rpc = supabase.rpc as unknown as (name: string, args?: object) => Promise<{ data: unknown; error: unknown }>;
        // Before selecting any transcript, use the incumbent caller-JWT check:
        // current Owner, active membership and the exact private coach thread.
        const checkpoint = await rpc("get_solo_business_interview_checkpoint", { _thread_id: requestedInterview });
        if (!current || liveResumeScope.current !== resumeScope) return;
        if (checkpoint.error || (checkpoint.data !== null && !cleanInterviewCheckpoint(checkpoint.data, activeTenantId, requestedInterview))) throw new Error("unavailable");
        const context = await rpc("get_solo_business_context");
        const row = context.data as { tenantId?: string; accessScope?: string } | null;
        if (context.error || row?.tenantId !== activeTenantId || row.accessScope !== "owner_full") throw new Error("unavailable");
        if (!current || liveResumeScope.current !== resumeScope) return;
        setVerifiedResume({ scope: resumeScope, state: "ready" });
        setInterviewOpen(true);
      } catch {
        if (current && liveResumeScope.current === resumeScope) setVerifiedResume({ scope: resumeScope, state: "failed" });
      } finally {
        clearTimeout(deadline);
      }
    })();
    return () => { current = false; clearTimeout(deadline); };
  }, [activeTenantId, requestedInterview, resumeScope, resumeAttempt, clientScope, planScope, presenceScope]);
  // Reliable resume: an owner re-entering an UNFINISHED onboarding lands back
  // in their own unfinished interview conversation, not a blank one. One
  // lookup per resolved tenant on first-run entry (only while no thread is
  // active and no deep link was given); a hit adopts the SAME verified
  // deep-link path — the checkpoint/authority verification above then runs
  // unchanged. A failed or empty lookup never blocks the fresh interview, and
  // a resolve that lands after the user started or chose a conversation is
  // discarded (the same cancellation guard the verification effect uses).
  const resumeLookupRef = useRef<string | null>(null);
  useEffect(() => {
    if (!firstRun || requestedInterview || clientScope || planScope || presenceScope) return;
    if (!activeTenantId || observedThread.current) return;
    const scope = activeTenantId;
    if (resumeLookupRef.current === scope) return;
    resumeLookupRef.current = scope;
    let current = true;
    void (async () => {
      try {
        const rpc = supabase.rpc as unknown as (name: string, args?: object) => Promise<{ data: unknown; error: unknown }>;
        const lookup = await rpc("latest_solo_business_interview_thread");
        if (!current || resumeLookupRef.current !== scope || observedThread.current) return;
        const row = lookup.data as { threadId?: string } | null;
        if (lookup.error || !row?.threadId) return;
        const search = new URLSearchParams(location.search);
        search.set("interviewThread", row.threadId);
        navigate(`${location.pathname}?${search}`, { replace: true });
      } catch { /* a failed lookup never blocks the fresh interview */ }
    })();
    return () => { current = false; };
  }, [firstRun, requestedInterview, activeTenantId, clientScope, planScope, presenceScope, location.pathname, location.search, navigate]);
  // Completion retirement of the URL itself: once setup is complete, a stale
  // ?onboarding=1 (bookmarked or hand-typed) is stripped so the address stops
  // claiming a first-run state the workspace has outgrown.
  useEffect(() => {
    if (!setupComplete) return;
    const search = new URLSearchParams(location.search);
    if (search.get("onboarding") !== "1") return;
    search.delete("onboarding");
    navigate(`${location.pathname}${search.size ? `?${search}` : ""}`, { replace: true });
  }, [setupComplete, location.pathname, location.search, navigate]);
  const leaveReturnVerification = () => {
    const search = new URLSearchParams(location.search);
    search.delete("interviewThread");
    navigate(`${location.pathname}${search.size ? `?${search}` : ""}`, { replace: true });
  };
  const interviewFocused = interviewOpen && !clientScope && !planScope && !presenceScope;
  const resumeEligible = Boolean(requestedInterview) && !clientScope && !planScope && !presenceScope;
  const resumePending = resumeEligible && verifiedResume?.scope !== resumeScope;
  const resumedThread = resumeEligible && verifiedResume?.scope === resumeScope && verifiedResume.state === "ready" ? requestedInterview! : undefined;
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
    <div className={`spw-root${firstRun ? " spw-root--onboarding" : ""}`} data-account-epoch={activeTenantId ?? "resolving"} style={{ containerType: "inline-size" }}>
      <style>{`@container (max-width: 650px){[data-solo-thread-rail="true"]{display:none!important}[data-solo-mobile-history="true"]{display:flex!important}.spw-tabs button{padding-inline:6px;font-size:11px;gap:4px}}`}</style>
      <div className="spw-tabs" role="tablist" aria-label="Solo PAIGE workspace">
        {TABS.map((item, index) => {
          const Icon = item.icon;
          return <button key={item.id} ref={(node) => { tabRefs.current[index] = node; }} type="button" role="tab" id={`spw-tab-${item.id}`} aria-controls={`spw-panel-${item.id}`} aria-selected={tab === item.id} tabIndex={tab === item.id ? 0 : -1} onClick={() => setTab(item.id)} onKeyDown={(event) => onTabKeyDown(event, index)}><Icon aria-hidden size={15} />{item.label}</button>;
        })}
      </div>
      <section id="spw-panel-chat" role="tabpanel" aria-labelledby="spw-tab-chat" hidden={tab !== "chat"} className="spw-panel spw-chat-panel">
        {resumePending ? <div className="spw-state"><p role="status">Opening the owned interview…</p><button type="button" onClick={leaveReturnVerification}>Back to conversation history</button></div> : <PaigeAIChat
          hideHeader
          fill
          enableHistory
          soloTenantSafety
          liveConversation={liveConversationAvailable}
          composerAutonomyControl={<PaigeComposerAutonomyChip accountEpoch={activeTenantId} />}
          renderComposerContext={api => <SoloPlanningSuggestion
            key={JSON.stringify([activeTenantId, activeUserId, planScope?.businessMissionId, Boolean(planScope)])}
            api={api} tenantId={isPlatformStaff ? null : activeTenantId} actorId={activeUserId ?? null}
            active={visible && tab === "chat"} plan={planScope} onClearContext={releaseScope} sidePanel={!full}
            relevant={!isPlatformStaff && planningWorkRelevant({ otherScope: Boolean(firstRun || interviewFocused || clientScope || presenceScope || requestedInterview || resumePending), plan: planScope,
              onPlanPage: location.pathname.endsWith("/command-center/business-game-plan"), threadId: api.threadId, hasOwnerMessages: api.hasOwnerMessages })}
          />}
          renderRail={(api) => <SoloHistoryRail api={api} />}
          onActiveThreadIdChange={observeThread}
          activeThreadId={resumedThread}
          onTrace={observeChat}
          greeting={interviewFocused && firstRun ? "I'm PAIGE. What does your business do, and what would you most like to improve?" : interviewFocused ? "I'm PAIGE. Tell me what your business does and what you'd most like to improve. We'll take it one question at a time; you can review, skip or correct each detail." : "What are we moving? Tell me the outcome, and I’ll show what I can read, draft, or ask you to approve."}
          chips={interviewFocused && profileStatus?.tenantId === activeTenantId && profileStatus.state === "ready" && profileStatus.hasConfirmedPriority
            ? [...INTERVIEW_NEXT_PROMPTS] : undefined}
          clientId={clientScope?.clientId ?? null}
          surfaceContext={interviewFocused ? { kind: "solo_business_interview" } : !clientScope && !planScope && presenceScope ? { kind: presenceScope.kind, step: presenceScope.step, intendedAction: presenceScope.intendedAction } : undefined}
          businessMissionId={!clientScope ? planScope?.businessMissionId ?? null : null}
          onFocusRelease={releaseScope}
          focusBanner={clientScope ? (
            <div className="spw-chat-head" data-solo-paige-focus>
              <TruthPill tone="partial">IN CONTEXT</TruthPill>
              <div><strong>{clientScope.label}</strong><span>Recorded outcomes for this client only. PAIGE reads them; she cannot change them.</span></div>
              <button type="button" className="spw-link-button spw-authority" onClick={releaseScope}>Clear</button>
            </div>
          ) : !planScope && presenceScope ? (
            <div className="spw-chat-head" data-solo-paige-focus>
              <TruthPill tone="partial">PUBLIC PRESENCE</TruthPill>
              <div><strong>Safe public-business context</strong><span>PAIGE re-resolves approved facts and provider availability on the server for each turn.</span></div>
              <button type="button" className="spw-link-button spw-authority" onClick={releaseScope}>Clear</button>
            </div>
          ) : undefined}
          conversationHeader={<div className={firstRun ? "spw-onboarding-header" : undefined}>{visible && tab === "chat" && firstRun && !clientScope && !planScope && !presenceScope && <SoloOnboardingStage thinking={chatBusy} profile={profileStatus?.tenantId === activeTenantId ? profileStatus : null} onResumeProfile={() => setInterviewOpen(true)} profileOpen={interviewOpen} onTalkLive={liveConversationAvailable ? () => { window.dispatchEvent(new CustomEvent("paige-live-open-request")); } : undefined} />}{resumeEligible && verifiedResume?.scope === resumeScope && verifiedResume.state === "failed" && <div className="spw-state"><p role="alert">That interview could not be verified for this workspace. Try again or choose a conversation from history.</p><button type="button" onClick={() => { setVerifiedResume(null); setResumeAttempt(attempt => attempt + 1); }}>Retry interview verification</button><button type="button" onClick={leaveReturnVerification}>Back to conversation history</button></div>}<div className={`spw-chat-head${firstRun && interviewFocused ? " spw-chat-head--onboarding-open" : ""}`}><div><strong>PAIGE</strong><span>{firstRun ? "Your business interview" : "Active Solo account · tenant-scoped"}</span></div>{!clientScope && !planScope && !presenceScope && <WeeklyResponsibilityEntry hideEmpty={firstRun} />}</div>{interviewFocused && <SoloBusinessInterview key={activeTenantId ?? "unresolved"} threadId={interviewThreadId} busy={chatBusy} refreshEpoch={interviewRefresh} onPause={() => setInterviewOpen(false)} onboarding={firstRun} onProfileStatus={observeProfile} />}</div>}
        />}
      </section>
      <section id="spw-panel-knowledge" role="tabpanel" aria-labelledby="spw-tab-knowledge" hidden={tab !== "knowledge"} className="spw-panel">{tab === "knowledge" && <Suspense fallback={<OpeningPanel name="Knowledge" />}><KnowledgeView /></Suspense>}</section>
      <section id="spw-panel-research" role="tabpanel" aria-labelledby="spw-tab-research" hidden={tab !== "research"} className="spw-panel">{tab === "research" && <Suspense fallback={<OpeningPanel name="Research" />}><ResearchView activeTenantId={activeTenantId} /></Suspense>}</section>
      <section id="spw-panel-helpers" role="tabpanel" aria-labelledby="spw-tab-helpers" hidden={tab !== "helpers"} className="spw-panel">{tab === "helpers" && <Suspense fallback={<OpeningPanel name="Helpers" />}><HelpersView /></Suspense>}</section>
      <section id="spw-panel-capabilities" role="tabpanel" aria-labelledby="spw-tab-capabilities" hidden={tab !== "capabilities"} className="spw-panel">{tab === "capabilities" && <Suspense fallback={<OpeningPanel name="Capabilities" />}><CapabilitiesView key={`${activeUserId ?? "resolving"}:${activeTenantId ?? "resolving"}`} /></Suspense>}</section>
      <span className="spw-sr" aria-live="polite">{TABS.find((item) => item.id === tab)?.label} view open</span>
    </div>
  );
}


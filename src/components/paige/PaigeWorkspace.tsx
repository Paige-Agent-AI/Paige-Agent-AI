// "Your Paige" — the agent workspace (spec §1). Chat front-and-center under an
// always-visible vitals strip, with a wide right-side "Customize Paige" console.
// Owns the Playbook edit lifecycle (pb / lastSavedPb / dirty / saving) and the
// one honest Save for the whole object; Knowledge commits per-doc on its own.
import { useEffect, useMemo, useState, useCallback } from "react";
import { Loader2, X, UserCircle2, SlidersHorizontal, PanelRightClose, PanelRightOpen } from "lucide-react";
import { ReasoningDeck, type PaigeStep } from "@/components/dashboard/PaigeStepTrace";
import { useTenantContext } from "@/hooks/useTenantContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { usePendingApprovals } from "@/hooks/usePendingApprovals";
import { useBeforeUnloadGuard } from "@/hooks/useBeforeUnloadGuard";
import { usePlaybookEditor } from "./usePlaybookEditor";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { PaigeAIChat } from "@/components/dashboard/PaigeAIChat";
import { PaigeWorkspaceProvider, usePaigeWorkspace } from "./PaigeWorkspaceContext";
import { PaigeCommandBar } from "./PaigeCommandBar";
import { PaigeSidebarBody, CustomizeFloor } from "./PaigeSidebar";
import { PaigeRailSheet } from "./PaigeRailSheet";
import { PaigeConsole } from "./PaigeConsole";
import { PaigePlatformDesk } from "./PaigePlatformDesk";
import type { ConsoleSection, RailCounts } from "./PaigeConsoleRail";
import type { FocusedClient, QuickChip } from "./commandCenterTypes";
import { buildFocusProse, firstNameOf } from "./commandCenterTypes";

/** Sticky strip above the chat message list — mirrors the rail mini-card. */
function FocusBanner({ client, onClear }: { client: FocusedClient; onClear: () => void }) {
  const first = firstNameOf(client);
  return (
    <div className="flex items-center gap-2 rounded-md border border-accent/30 bg-accent/[0.05] px-3 py-1.5 text-sm m-3 mb-0">
      <span className="h-2 w-2 rounded-full bg-gradient-gold shrink-0" />
      <span className="min-w-0 truncate">
        Focused on {first} — Paige is focused on their account.
      </span>
      <button
        type="button"
        onClick={onClear}
        className="ml-auto shrink-0 text-muted-foreground hover:text-foreground"
      >
        Clear
      </button>
    </div>
  );
}

function WorkspaceBody({ tenantName }: { tenantName: string }) {
  const { activeTenantId } = useTenantContext();
  const { counts, subscribeKnowledgeAdded } = usePaigeWorkspace();
  const isMobile = useIsMobile();

  // The Playbook edit lifecycle now lives in one shared home (§18) — the same hook
  // the Setup › Playbook inline editor uses — so the console and Setup drive identical
  // load/dirty/save logic against the same set_tenant_playbook RPC.
  const { pb, loading, saving, justSaved, dirty, patch, applyPreset, save, discard } =
    usePlaybookEditor(activeTenantId);
  useBeforeUnloadGuard(dirty || saving);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [section, setSection] = useState<ConsoleSection>("persona");
  // Paige's live step trace, lifted out of the chat so the persistent ReasoningDeck renders it.
  // After a run the finished timeline persists in the deck until the next turn clears it — that
  // IS the rest memory, so no separate last-run snapshot is needed.
  const [trace, setTrace] = useState<{ steps: PaigeStep[]; loading: boolean }>({ steps: [], loading: false });
  const handleTrace = useCallback((steps: PaigeStep[], loading: boolean) => {
    setTrace({ steps, loading });
  }, []);

  // Command-center focus state (cc-spec §2). Held here so the chat focus banner
  // and the rail mini-card never disagree.
  const [focusedClient, setFocusedClient] = useState<FocusedClient | null>(null);
  const [railOpen, setRailOpen] = useState(false);
  // Desktop rail collapse — a durable per-user-workspace preference (a rail the
  // user collapsed should stay collapsed next visit), namespaced by tenant so a
  // shared browser doesn't bleed one account's UI state into another (S6).
  const railKey = `paige:workspaceRail:collapsed:${activeTenantId ?? "none"}`;
  const [railCollapsed, setRailCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem(railKey) === "1"; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem(railKey, railCollapsed ? "1" : "0"); } catch { /* storage unavailable — non-fatal */ }
  }, [railKey, railCollapsed]);
  const clearFocus = () => setFocusedClient(null);
  // A FOCUS BELONGS TO AN ACCOUNT (#765). `focusedClient` is local state and this body is not
  // remounted on an account switch, so without this the banner keeps naming a client from the
  // workspace being left, and the chat keeps that client in its scope epoch. The Solo shell
  // already applies exactly this rule, and its scope store masks a stored scope at read time
  // for the same reason.
  //
  // Until #765 this was cleared BY ACCIDENT: the account switch re-armed the history resume,
  // and `selectThread` released the focus on its way past. Not resuming is the correct repair,
  // so the cleanup has to become deliberate instead of a side effect of the defect.
  useEffect(() => { setFocusedClient(null); }, [activeTenantId]);
  const focusProse = useMemo(() => buildFocusProse(focusedClient), [focusedClient]);

  // Tenant-wide approvals — the single source for BOTH the command-bar momentum
  // count (never rescoped — B3) and the feed's cross-scope math.
  const { items: tenantApprovals, loading: approvalsLoading } = usePendingApprovals({ scope: "all" });

  // "She got smarter" tie-back: banner above the composer + vitals chip pulse.
  const [banner, setBanner] = useState<string | null>(null);
  const [chipPulse, setChipPulse] = useState(false);

  useEffect(() => {
    return subscribeKnowledgeAdded((title) => {
      setBanner(`Paige just indexed ${title} — she'll draw on it from here.`);
      setChipPulse(true);
      setTimeout(() => setChipPulse(false), 1400);
    });
  }, [subscribeKnowledgeAdded]);

  const openConsole = (s: ConsoleSection) => { setSection(s); setConsoleOpen(true); };

  const first = firstNameOf(focusedClient);

  // Only Phase-1-capable actions (N1). "Draft a campaign" is draft prose only —
  // no send/bulk tool is wired, so the copy frames it as a review-first draft.
  // NOTE: this useMemo (like every hook) must run before the loading return
  // below — a hook after a conditional return trips React #310 the moment
  // loading flips.
  const quickChips: QuickChip[] = useMemo(() => [
    { label: "What needs my attention?", prompt: "What needs my attention right now across my customers?", autoSend: true },
    { label: "Draft a follow-up", prompt: "Draft a follow-up I can review and send." },
    { label: "Summarize this customer", prompt: `Summarize where ${first || "this customer"} stands and the next best move.`, visibleWhenFocused: true },
    { label: "Move a deal forward", prompt: "Which deals are stuck, and what should I do to move one forward?" },
    { label: "Draft a campaign", prompt: "Draft a campaign to my segment — I'll review before anything sends." },
  ], [first]);

  if (loading || !pb) {
    return (
      <div className="flex items-center gap-3 text-muted-foreground p-8 justify-center">
        <Loader2 className="w-5 h-5 animate-spin" /> Loading your Paige…
      </div>
    );
  }

  const railCounts: RailCounts = {
    personaNamed: !!pb.persona.name.trim(),
    quickActions: pb.quickActions.length,
    probing: pb.probingQuestions.length,
    journey: pb.journey.length,
    intake: pb.intake.length,
    portal: pb.portal.modules.length,
    knowledgeDocs: counts.docs,
  };

  const railProps = {
    focused: focusedClient,
    onFocus: setFocusedClient,
    onClear: clearFocus,
    onCustomize: () => openConsole("persona"),
    approvals: tenantApprovals,
    approvalsLoading,
    tenantId: activeTenantId,
  };

  return (
    <div className="flex flex-col h-full min-h-[34rem]">
      <PaigeCommandBar
        pb={pb}
        tenantName={tenantName}
        counts={counts}
        knowledgePulse={chipPulse}
        pending={tenantApprovals.length}
        onOpen={openConsole}
      />

      {/* Two regions: dominant chat (left) + standing rail (right, desktop). */}
      <div className="flex-1 min-h-0 flex">
        <section className="flex-1 min-w-0 flex flex-col">
          {/* "She got smarter" banner — only when set, so it never adds a resting header row. */}
          {banner && (
            <div className="w-full px-3 pt-2">
              <div className="flex items-center gap-2 rounded-md border border-accent/40 bg-accent/5 px-3 py-1.5 text-sm">
                <span className="h-1.5 w-1.5 rounded-full bg-gradient-gold shrink-0" />
                <span className="min-w-0 flex-1 truncate">{banner}</span>
                <button
                  type="button"
                  onClick={() => setBanner(null)}
                  className="ml-auto shrink-0 text-muted-foreground hover:text-foreground"
                  aria-label="Dismiss"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}

          <div className="flex-1 min-h-0 w-full">
            <PaigeAIChat
              hideHeader
              fill
              enableHistory
              greeting="What are we working on today? Point me at a client, or tell me the part of the business you want to move — pipeline, follow-ups, a campaign, a client's file — and I'll take it from there."
              clientId={focusedClient?.id ?? null}
              clientContext={focusProse}
              // The chat asks for the focus to be released — either the server returned a
              // permission verdict on this client, or the person opened a saved conversation whose
              // content is not about them. Either way the banner must stop asserting a focus that
              // would make the next turn mean something untrue. On a refusal the chat parks its own
              // explanation across the reset this causes, so the person is still told why.
              onFocusRelease={clearFocus}
              focusBanner={focusedClient ? <FocusBanner client={focusedClient} onClear={clearFocus} /> : undefined}
              chips={quickChips}
              onTrace={handleTrace}
              hideReasoningStrip={!isMobile}
            />
          </div>
        </section>

        {!isMobile && (railCollapsed ? (
          // Collapsed: a slim always-present reopen affordance (VS Code convention)
          // so the panel is one click away and never lost.
          <button
            type="button"
            onClick={() => setRailCollapsed(false)}
            aria-label="Show panel"
            aria-expanded={false}
            className="grid w-9 shrink-0 place-items-start justify-center border-l bg-primary/[0.02] py-3 text-muted-foreground transition-colors hover:text-foreground motion-reduce:transition-none"
          >
            <PanelRightOpen className="h-4 w-4" />
          </button>
        ) : (
          <aside className="flex w-[360px] lg:w-[380px] shrink-0 flex-col border-l bg-primary/[0.055] shadow-[shadow:inset_1px_0_0_hsl(var(--border))]">
            {/* One scroll column — reasoning cockpit, customer selector, and the Live
                desk all flow and share the height instead of the feed being crushed
                into a sliver. Customize Paige is pinned to the floor, always reachable. */}
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="space-y-3 p-3">
                {/* Neutral label: this panel holds reasoning + the Live desk + Customize,
                    not just the trace — so "Collapse panel", never "Hide reasoning". */}
                <div className="flex items-center justify-end">
                  <button
                    type="button"
                    onClick={() => setRailCollapsed(true)}
                    aria-label="Collapse panel"
                    aria-expanded
                    className="rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
                  >
                    <PanelRightClose className="h-4 w-4" />
                  </button>
                </div>
                <ReasoningDeck trace={trace} personaName={pb.persona.name} />
                <PaigeSidebarBody {...railProps} />
              </div>
            </div>
            <div className="shrink-0 border-t bg-primary/[0.02] p-3">
              <CustomizeFloor onCustomize={railProps.onCustomize} />
            </div>
          </aside>
        ))}
      </div>

      {/* Mobile dock — in-flow (not fixed), above nothing it can overlap (S5). */}
      <div className="md:hidden shrink-0 flex items-center gap-2 border-t bg-primary/[0.04] px-3 py-2">
        <button
          type="button"
          onClick={() => setRailOpen(true)}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-2 rounded-md border px-3 py-2 text-sm",
            focusedClient ? "border-accent/40" : "",
          )}
        >
          <UserCircle2 className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{focusedClient ? focusedClient.name : "Select customer"}</span>
        </button>
        <button
          type="button"
          onClick={() => setRailOpen(true)}
          aria-label={`${tenantApprovals.length} waiting`}
          className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-2 text-sm shrink-0"
        >
          <span className={cn("h-2 w-2 rounded-full", tenantApprovals.length > 0 ? "bg-gradient-gold" : "bg-muted-foreground/40")} />
          <span className="tabular-nums">{tenantApprovals.length > 0 ? `${tenantApprovals.length} waiting` : "All clear"}</span>
        </button>
        <Button
          onClick={() => openConsole("persona")}
          size="icon"
          variant="outline"
          className="shrink-0 border-accent/50 text-accent hover:bg-accent/10 hover:text-accent"
          aria-label="Customize Paige"
        >
          <SlidersHorizontal className="h-4 w-4" />
        </Button>
      </div>

      {isMobile && <PaigeRailSheet open={railOpen} onOpenChange={setRailOpen} {...railProps} />}

      <PaigeConsole
        open={consoleOpen}
        onOpenChange={setConsoleOpen}
        pb={pb}
        patch={patch}
        onApplyPreset={applyPreset}
        section={section}
        onSection={setSection}
        counts={railCounts}
        knowledgePulse={chipPulse}
        dirty={dirty}
        saving={saving}
        justSaved={justSaved}
        onSave={save}
        onDiscard={discard}
        tenantName={tenantName}
      />
    </div>
  );
}

export default function PaigeWorkspace() {
  const { activeTenantId, activeTenant, loading, isPlatformStaff } = useTenantContext();

  if (loading) {
    return (
      <div className="flex items-center gap-3 text-muted-foreground p-8 justify-center">
        <Loader2 className="w-5 h-5 animate-spin" /> Loading your Paige…
      </div>
    );
  }

  // MODE-AWARE (§20/§36): a PLATFORM STAFF operator with no active tenant is NOT a
  // dead end. Paige runs at PLATFORM SCOPE — the operator's Chief of Staff for the
  // SaaS company — mounting the SAME chat with clientId=null and explicit platform-
  // scope context, never a tenant-default client Paige (§9). Scope follows the MODE
  // (activeTenantId === null), never message content. The isPlatformStaff guard is
  // load-bearing (§9): a non-staff account MUST NEVER see platform-operator framing.
  if (isPlatformStaff && !activeTenantId) {
    return <PaigePlatformDesk />;
  }

  // Defense-in-depth (§9): a non-staff user with no active tenant (an unprovisioned
  // edge case) falls through to a neutral state — NOT the platform desk, and not the
  // tenant workspace with a null tenant.
  if (!activeTenantId) {
    return (
      <div className="p-8 text-center text-sm text-muted-foreground">
        No workspace is active yet.
      </div>
    );
  }

  return (
    <PaigeWorkspaceProvider activeTenantId={activeTenantId}>
      <WorkspaceBody tenantName={activeTenant?.name ?? "your practice"} />
    </PaigeWorkspaceProvider>
  );
}

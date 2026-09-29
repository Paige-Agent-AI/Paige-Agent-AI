import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Mail, RefreshCw, Search, ShieldCheck, Sparkles, UserPlus, Users, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useTenantContext } from "@/hooks/useTenantContext";
import { useBeforeUnloadGuard } from "@/hooks/useBeforeUnloadGuard";
import { readFunctionErrorBody } from "@/lib/integrations/connectError";
import { TeamMemberContact } from "./team-member-contact";
import {
  inviteLifecycle,
  inviteIsFinished,
  deliveryPresentation,
  DELIVERY_STEPS,
  invitationRefusalMessage,
  memberVisibleIdentity,
  normalizeTeamWorkspace,
  permissionPresentation,
  removalRefusal,
  validateWorkProfile,
  type RemovalRefusal,
  type TeamInviteRecord,
  type TeamMemberRecord,
  type TeamWorkspaceRecord,
} from "./team-workspace-contract";

const PAGE_SIZE = 25;

function initials(member: TeamMemberRecord): string {
  return (member.full_name || member.email || "?").split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

function useTeamWorkspace(search: string, permission: string) {
  const { activeTenantId, loading: tenantLoading } = useTenantContext();
  const seq = useRef(0);
  const [state, setState] = useState<{ tenantId: string | null; loading: boolean; loadingMore: boolean; error: string | null; value: TeamWorkspaceRecord | null }>({ tenantId: null, loading: true, loadingMore: false, error: null, value: null });

  const load = useCallback(async (offset = 0) => {
    const request = ++seq.current;
    if (!activeTenantId) { setState({ tenantId: null, loading: false, loadingMore: false, error: null, value: null }); return; }
    setState((current) => offset === 0
      ? { tenantId: null, loading: true, loadingMore: false, error: null, value: null }
      : { ...current, loadingMore: true, error: null });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- migration RPC awaits generated types
    const { data, error } = await (supabase as any).rpc("get_solo_team_workspace", {
      _search: search.trim() || null,
      _permission: permission,
      _limit: PAGE_SIZE,
      _offset: offset,
    });
    if (request !== seq.current) return;
    const next = normalizeTeamWorkspace(data);
    if (error || !next || next.tenant_id !== activeTenantId) {
      setState((current) => ({ ...current, tenantId: activeTenantId, loading: false, loadingMore: false, error: error?.message || "Team information is unavailable.", value: offset === 0 ? null : current.value }));
      return;
    }
    setState((current) => ({
      tenantId: activeTenantId,
      loading: false,
      loadingMore: false,
      error: null,
      value: offset === 0 ? next : { ...next, members: [...(current.value?.members ?? []), ...next.members] },
    }));
  }, [activeTenantId, permission, search]);

  useEffect(() => {
    const timer = setTimeout(() => { if (!tenantLoading) void load(0); }, 180);
    return () => { clearTimeout(timer); seq.current += 1; };
  }, [load, tenantLoading]);

  return {
    ...state,
    loading: tenantLoading || state.loading || Boolean(activeTenantId && state.tenantId !== activeTenantId),
    refresh: () => load(0),
    loadMore: () => load(state.value?.members.length ?? 0),
  };
}

/**
 * `onEscape` lets the dialog's own content own the Escape key for as long as it has something to
 * back out of — a destructive confirmation being the case that needs it. Returning `true` means
 * "handled"; anything else falls through to closing the dialog. Without it, backing out of "Remove
 * X?" discarded the whole editor, including unsaved work details the footer's Cancel/Close wording
 * exists to protect.
 */
function Modal({ title, description, onClose, onEscape, busy, wide, children }: { title: string; description: string; onClose: () => void; onEscape?: () => boolean; /** A request is in flight and must not be interrupted: the close control is DISABLED, not merely inert. */ busy?: boolean; /** Opens at the wider size from the first frame, so content arriving later never resizes it. */ wide?: boolean; children: React.ReactNode }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  // The key handler and the focus capture read the latest callbacks through refs so the effect can
  // run ONCE. It used to depend on `onClose`, which the caller re-creates on every render, so every
  // parent state change re-ran it: re-capturing the return-focus target and yanking focus back to
  // the close button — including in the middle of a confirmation the user was reading.
  const latest = useRef({ onClose, onEscape });
  // Assigned on COMMIT, not during render: a render that is discarded (StrictMode, concurrent
  // rendering) would otherwise leave this ref holding callbacks from a pass that never took effect.
  useEffect(() => { latest.current = { onClose, onEscape }; });
  useEffect(() => {
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // `[data-initial-focus]` is tried on its own FIRST. A single querySelector with a comma-joined
    // list returns the first match in DOCUMENT order across all branches, and the header's close
    // button precedes every child — so the opt-in marker never once won, on this dialog or on the
    // invite dialog that has carried it all along.
    const marked = dialogRef.current?.querySelector<HTMLElement>("[data-initial-focus]");
    const firstFocus = marked ?? dialogRef.current?.querySelector<HTMLElement>("input, select, textarea, button");
    (firstFocus ?? closeRef.current)?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (latest.current.onEscape?.() === true) return;
        latest.current.onClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])')];
      // Nothing tabbable at all: Tab must not walk out of an aria-modal dialog into the roster
      // beneath it. HONEST NOTE: this is a defensive floor, not a state I can point at — the fourth
      // read measured three focusable nodes during a pending removal (the work-profile inputs stay
      // enabled), so my original claim that "every control is disabled" was wrong. The branch below
      // is the one that actually fires in that state.
      if (!focusable.length) { event.preventDefault(); return; }
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      // The caret is somewhere the trap's own list does not contain — a `tabIndex={-1}` target that
      // was focused programmatically, which is exactly what the live "Removing…" line is. The
      // first/last comparison below can never match it, so Tab left the dialog entirely: with the
      // footer control disabled there was nothing tabbable AFTER it in document order. Found by the
      // third adversarial read; jsdom has no native Tab, so no unit test could see it.
      if (!focusable.includes(document.activeElement as HTMLElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      // Only restore focus to a node that is still in the document. After a removal the invoking
      // roster row is gone, and `.focus()` on a detached element is a silent no-op that drops focus
      // to <body>; the caller moves focus deliberately in that case instead.
      if (returnFocus && document.contains(returnFocus)) returnFocus.focus();
    };
  }, []);
  return <div className="stw-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
    <section ref={dialogRef} className={wide ? "stw-modal is-wide" : "stw-modal"} role="dialog" aria-modal="true" aria-labelledby="stw-modal-title" aria-describedby="stw-modal-desc">
      <header><div><h2 id="stw-modal-title">{title}</h2><p id="stw-modal-desc">{description}</p></div><button ref={closeRef} className="stw-icon-btn" onClick={onClose} disabled={busy} aria-label="Close"><X /></button></header>
      {children}
    </section>
  </div>;
}

export function MemberEditor({ member, workspace, onClose, onSaved, onRemoved, onPendingChange }: { member: TeamMemberRecord; workspace: TeamWorkspaceRecord; onClose: () => void; onSaved: (saved?: { job_title: string; responsibilities: string }) => void | Promise<void>; onRemoved?: (announcement: string) => void; /** Raised while a removal is in flight, so the PARENT does not unmount this dialog underneath it. */ onPendingChange?: (pending: boolean) => void }) {
  const [title, setTitle] = useState(member.job_title ?? "");
  const [responsibilities, setResponsibilities] = useState(member.responsibilities ?? "");
  const [savedTitle, setSavedTitle] = useState(member.job_title ?? "");
  const [savedResponsibilities, setSavedResponsibilities] = useState(member.responsibilities ?? "");
  const [saveConfirmed, setSaveConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [permissionDraft, setPermissionDraft] = useState<string | null>(null);
  const errors = validateWorkProfile(title, responsibilities);
  const permission = permissionPresentation(member.permission, member.is_owner);
  const identity = memberVisibleIdentity(member);
  const dirty = title !== savedTitle || responsibilities !== savedResponsibilities;
  const [contactDirty, setContactDirty] = useState(false);
  useBeforeUnloadGuard(dirty || contactDirty || saving || permissionDraft !== null);

  const save = async () => {
    if (!workspace.can_manage_profiles || !dirty || Object.keys(errors).length) return;
    setSaving(true);
    // Same wrap, same reason: `saving` now gates the destructive control, so an escaping rejection
    // here would silently kill "Remove from workspace" until the dialog is closed and reopened.
    let data: { job_title?: string | null; responsibilities?: string | null } | null = null;
    let error: { message?: string } | null = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- migration RPC awaits generated types
      ({ data, error } = await (supabase as any).rpc("set_solo_team_member_work_profile", {
        _member_user_id: member.user_id,
        _job_title: title,
        _responsibilities: responsibilities,
      }));
    } catch (thrown) {
      error = { message: thrown instanceof Error ? thrown.message : "We could not reach the server, so the result of this is unknown. Reopen Team to see the current values." };
    }
    setSaving(false);
    if (error) { toast.error(error.message ?? "The save did not complete. Please try again."); return; }

    const nextTitle = typeof data?.job_title === "string" ? data.job_title : data?.job_title === null ? "" : title.trim();
    const nextResponsibilities = typeof data?.responsibilities === "string" ? data.responsibilities : data?.responsibilities === null ? "" : responsibilities.trim();
    setTitle(nextTitle);
    setSavedTitle(nextTitle);
    setResponsibilities(nextResponsibilities);
    setSavedResponsibilities(nextResponsibilities);
    setSaveConfirmed(true);
    toast.success("Work details saved. Permission was not changed.");
    // HAND BACK WHAT WAS SAVED. `onSaved` is `team.refresh()`, which is `load(0)`, which sets the
    // roster to null BEFORE it awaits — so this dialog is unmounted and then remounted from the
    // parent's `selected` SNAPSHOT, taken when the row was clicked and never updated since. Local
    // state goes with the unmount, so the value the operator just saved reads back as the value it
    // replaced, and the "Work details saved" confirmation is wiped in the same instant the toast
    // claims success. The write itself always landed; the screen just threw it away.
    //
    // Reported by the owner on production against their own account: the field went back to empty
    // while the toast said saved, so they saved a second time sixteen seconds later. Both writes are
    // in the audit log. §70.2 — the person who cannot use it is right and the passing test is wrong.
    await onSaved({ job_title: nextTitle, responsibilities: nextResponsibilities });
  };

  // REMOVAL. Owner-only, and gated on the same server-derived flag the permission control uses —
  // never a client-side tier or account-type compare. `permission.mutable` is Admin-or-Member for a
  // non-owner, which is exactly the set the server agrees to remove; reusing it keeps the screen
  // from offering an act the database will refuse, and keeps a legacy specialised permission from
  // being quietly reassigned by a surface that promises it will not do that.
  const canRemove = workspace.can_change_permissions && !member.is_owner && permission.mutable && Boolean(onRemoved);
  const [removal, setRemoval] = useState<{ stage: "idle" | "armed" | "pending"; error: RemovalRefusal | null; tenantAtArm: string | null; /** The workspace NAME as of arming. The pending copy must name the workspace the call was SENT to, which the live one stops being the moment somebody switches. */ nameAtArm: string | null }>({ stage: "idle", error: null, tenantAtArm: null, nameAtArm: null });
  const removeButtonRef = useRef<HTMLButtonElement>(null);
  const removalInFlightRef = useRef(false);
  useEffect(() => { removalInFlightRef.current = removal.stage === "pending"; }, [removal.stage]);
  // The PARENT must not unmount this dialog mid-call. It renders on `selectedLive`, and a workspace
  // switch during a pending removal nulls the roster and drops the selected member from it — so the
  // editor vanished and BOTH outcomes were lost: a refusal had nowhere to land, and a removal the
  // server actually applied was never announced, while the post-await switch guard below could not
  // run at all. Gating dismissal inside this component could not see that, because the unmount came
  // from above. Reported by the peer read of the previous head as a second, separate seam.
  // The hold covers an IN-FLIGHT CALL and nothing else. I widened it once to `|| Boolean(removal.error)`
  // to keep a refusal on screen, and the read of that commit caught what an unbounded flag does: an
  // error state never expires, so an operator who reads a refusal without dismissing it pinned the
  // editor open over a roster that no longer contained the member — with the work fields and "Save
  // work details" live, because those gate on `pending`. That is the shipped-save-flow regression the
  // comment 400 lines below says was repaired, reopened through a different door. A mount-lifetime
  // problem is not something a boolean with no time bound can solve.
  useEffect(() => { onPendingChange?.(removal.stage === "pending"); }, [removal.stage, onPendingChange]);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const pendingRef = useRef<HTMLParagraphElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const inFlight = useRef(false);
  // The workspace as of NOW, not as of the click. `confirmRemoval` is a closure created when the
  // button was pressed, so every `workspace.*` it reads AFTER its await is the value from that
  // render — which is exactly the value a mid-call workspace switch invalidates. Both post-await
  // comparisons below decide whether the operator is still looking at the workspace they acted in,
  // so reading a stale one makes them answer "unchanged" precisely when it changed. Found while
  // fixing the parent-unmount seam: the switch branch was correct and simply never fired.
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  // ...and the roster record ALONE cannot answer that question, which is the sixth read's finding.
  // The parent feeds this dialog `workspace ?? lastWorkspace.current` ON PURPOSE, because `load(0)`
  // nulls the roster before it awaits and the dialog must outlive that flash. So for the whole
  // switch window — the 180ms debounce plus the fetch — the prop above IS the PRE-switch roster,
  // and `workspaceRef.current.tenant_id !== tenantAtArm` answers "nothing changed" precisely when
  // it did. Every one of the three post-await guards was therefore blind exactly where it mattered,
  // and a removal that landed inside that window reinstated the cross-workspace banner (the parent
  // clears `notice` on `activeTenantId`, which fires BEFORE the roster reloads, so the banner is
  // written after the clear) while a refusal landed in a dialog the new roster then unmounted —
  // reported to nobody at all.
  //
  // The tenant CONTEXT is the signal that does not flash: it is what the parent's own invite-dialog
  // guard already keys on. It is read through a commit-assigned ref for the same reason
  // `removalInFlightRef` is.
  const { activeTenantId } = useTenantContext();
  // THE SAFETY NET. A refusal the operator has not dealt with, held so that losing this component
  // cannot lose the outcome of a destructive action. Cleared by every path that means "seen":
  // Cancel, Escape, a retry, and closing the dialog deliberately.
  const unreadRefusalRef = useRef<{ message: string; tenantId: string } | null>(null);
  useEffect(() => {
    unreadRefusalRef.current = removal.error
      ? { message: removal.error.message, tenantId: removal.tenantAtArm ?? workspace.tenant_id }
      : null;
  }, [removal.error, removal.tenantAtArm, workspace.tenant_id]);
  // SCOPED TO THE WORKSPACE IT IS ABOUT, because the net's first version re-fired a refusal into a
  // context where it was false. It cannot tell "unread" from "read but not dismissed" — and this
  // component FOCUSES the alert on every refusal (see the effect below), so it is read by
  // construction and then recorded as unread anyway. An operator who read "Only the workspace owner
  // can remove people from this workspace" and then switched to a workspace they DO own was told it
  // again, about the wrong one, with no name in the sentence to give it away.
  //
  // So the net now only speaks where the sentence is still true. It is a backstop for an outcome
  // destroyed before it could be read, never a replay of one that was.
  useEffect(() => () => {
    const unread = unreadRefusalRef.current;
    // Silence it only where the sentence is PROVABLY about somewhere else. An unknown live tenant —
    // Exit tenant, a session revalidating — is not evidence that the refusal is false; it is the
    // case where the operator most needs to hear it, and treating "unknown" as "different" turned
    // two of this file's own tests red the moment I tried it. Fail toward telling them.
    if (unread && (!activeTenantRef.current || activeTenantRef.current === unread.tenantId)) toast.error(unread.message);
  }, []);
  const activeTenantRef = useRef(activeTenantId);
  // Commit-assigned, matching `removalInFlightRef` and the `Modal` `latest` ref. HONEST NOTE:
  // mutation cannot tell this apart from a render-phase assignment, because jsdom runs no
  // StrictMode double-render and discards no renders — so this is the file's stated pattern applied
  // for consistency, NOT a property any test here proves.
  useEffect(() => { activeTenantRef.current = activeTenantId; }, [activeTenantId]);
  // Proof of a switch, never a guess at one. A null/absent live id means UNKNOWN — treating that as
  // "switched" would report "you have since switched workspace" to an operator who never moved,
  // which is a false statement rather than a silence, so it is the direction that must fail closed.
  //
  // The roster is deliberately NOT consulted as a second witness. I wrote it as one, and mutation
  // proved the branch can never fire alone: `useTeamWorkspace` returns early without fetching when
  // there is no tenant id, and when a roster value DOES exist the hook has already asserted
  // `next.tenant_id === activeTenantId` — so a roster that disagrees with `tenantAtArm` implies a
  // live id that disagrees too. An unreachable OR that a comment calls load-bearing is the exact
  // thing the read of this diff filed against the disarm effect below; it is removed rather than
  // left in to be believed.
  const switchedAwayFrom = (tenantAtArm: string) =>
    Boolean(activeTenantRef.current) && activeTenantRef.current !== tenantAtArm;
  // Whether this dialog has been through a removal stage at all. Without it the effect below fires
  // its `idle` branch on MOUNT — and a child's effects commit before its parent's, so it overrode
  // the Modal's own initial focus and left the caret on "Remove from workspace" the moment anyone
  // opened a teammate. Enter would then have armed a removal. Found by an adversarial read of the
  // pushed diff and confirmed in a real browser; every jsdom test here passed straight through it,
  // because none of them asserted anything about focus BEFORE the confirm was armed.
  const removalTouched = useRef(false);

  // Focus follows the stage, in an effect rather than in the click handler: the node being focused
  // is rendered BY the state change, so focusing synchronously would reach a ref that is still null.
  useEffect(() => {
    if (removal.stage !== "idle") removalTouched.current = true;
    if (!removalTouched.current) return;
    // Cancel, never the destructive button: an armed confirmation must not be one Enter away.
    if (removal.stage === "armed" && !removal.error) cancelRef.current?.focus();
    // Both buttons disable while the request is in flight. The Tab trap queries
    // `button:not(:disabled)` and only acts when activeElement is its first or last member, so a
    // browser blurring the disabled button drops focus to <body> and the next Tab walks straight
    // out of an aria-modal dialog. The live status line keeps it inside.
    if (removal.stage === "pending") pendingRef.current?.focus();
    // Same trap, different stage, and it is the one the first version missed: a NON-retryable
    // refusal disables the confirm button while it holds focus and leaves the stage `armed`, so
    // neither branch above fires. jsdom does not blur on `disabled`, which is exactly why the tests
    // could not see it. The alert is the right landing place anyway — it is what the user must read.
    if (removal.stage === "armed" && removal.error) errorRef.current?.focus();
    if (removal.stage === "idle") removeButtonRef.current?.focus();
  }, [removal.stage, removal.error]);

  // If the active workspace changes underneath an ARMED confirmation, disarm it. The server refuses
  // the call as well; this is so nobody is left looking at a primed destructive action that now
  // names a workspace they are no longer in.
  //
  // NOT while the call is already PENDING. A sent request cannot be un-sent, and resetting the stage
  // to `idle` here threw away the fact that one was in flight: the parent's hold was released, the
  // dialog unmounted, and the outcome — refusal OR a removal the server actually applied — was
  // discarded. The post-await guard below is what reports a switch that happened mid-call, and it
  // can only do that if this leaves the stage alone. Found while fixing the parent-unmount seam:
  // the hold looked correct and was being dropped from underneath by this line.
  useEffect(() => {
    setRemoval((current) => (current.stage !== "pending" && current.tenantAtArm && current.tenantAtArm !== workspace.tenant_id ? { stage: "idle", error: null, tenantAtArm: null, nameAtArm: null } : current));
  }, [workspace.tenant_id]);

  const disarmRemoval = () => setRemoval({ stage: "idle", error: null, tenantAtArm: null, nameAtArm: null });

  const confirmRemoval = async () => {
    // `disabled` alone is not a guard: two clicks dispatched inside one React batch both run before
    // the disabling re-render commits, and the second removal answers "that person is not on this
    // workspace's team" — which the screen then reports as a reconciliation rather than as the
    // removal the owner actually performed. Right roster, wrong sentence.
    if (inFlight.current) return;
    inFlight.current = true;
    const tenantAtArm = removal.tenantAtArm ?? workspace.tenant_id;
    const nameAtArm = removal.nameAtArm ?? workspace.tenant_name;
    setRemoval({ stage: "pending", error: null, tenantAtArm, nameAtArm });
    // WRAPPED, because blocking dismissal turns an unhandled rejection into a TRAP. supabase-js
    // resolves a PostgREST refusal into `{ error }` rather than throwing, so this path used to be
    // unreachable in practice — but a genuine transport rejection (offline, DNS, an aborted
    // connection) rejects the promise, and with the dialog now correctly undismissable while
    // pending, an escaping rejection would leave the person stuck on "Removing…" for ever with no
    // error and no way out but a page reload. `inFlight` would also stay true, wedging retry.
    // Named by the peer read as the cost of the gate; this is what pays it.
    let data: { tenant_id?: string } | null = null;
    let error: { message?: string } | null = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- migration RPC awaits generated types
      ({ data, error } = await (supabase as any).rpc("remove_solo_team_member", {
        _member_user_id: member.user_id,
        _expected_tenant_id: tenantAtArm,
      }));
    } catch (thrown) {
      // "network request failed" rather than a bare "request failed": a thrown non-Error IS a
      // transport failure, and the refusal vocabulary classifies by message. The old string matched
      // none of its transport patterns, so the one case that genuinely deserves a retry was being
      // told it could not have one.
      error = { message: thrown instanceof Error ? thrown.message : "network request failed" };
    }

    inFlight.current = false;
    if (error) {
      const refusal = removalRefusal(error.message ?? null, identity.primary, nameAtArm);
      if (refusal.reconciled) {
        // Not a removal this owner performed, and it must never be reported as one. The roster is
        // simply behind, so reconcile it and say exactly that.
        //
        // ...but only into the workspace it is about. `onRemoved` writes the roster banner, and if
        // the operator has switched since, that banner makes a claim about a workspace they are no
        // longer looking at — and the parent's own switch effect would clear it anyway. Same class
        // as the two branches below; flagged by the third read as pre-existing and fixed here
        // rather than left as the one remaining instance of it.
        if (switchedAwayFrom(tenantAtArm)) {
          setRemoval({ stage: "idle", error: null, tenantAtArm: null, nameAtArm: null });
          toast.error(refusal.message);
          onClose();
          return;
        }
        onRemoved?.(refusal.message);
        closeAfterOutcome();
        return;
      }
      // If the workspace CHANGED while the call was in flight, this dialog is no longer the right
      // place to say so: it now sits over a different roster, and the disarm effect above would
      // wipe the alert the moment the stage leaves `pending` anyway — showing the refusal for one
      // frame and then discarding it, which is barely better than never showing it. So the outcome
      // goes to the parent-owned channel, which outlives the dialog, and the dialog closes.
      // A REFUSAL IS NEVER LOST, and it is no longer a predicate that guarantees it. Two rounds
      // were spent trying to answer "will this dialog survive to be read?" before the answer
      // settled: it cannot be answered. `selectedLive` — the only signal that knows — conflates
      // "the member is gone" with "the roster is reloading", and the reload is debounced 180ms and
      // nulls its value before it awaits, so there is always a window where the honest answer is
      // "yes" and the truth a moment later is "no". Holding the dialog open instead pinned a
      // departed member with a live Save. Both mechanisms were the same mistake: racing an async
      // refetch with a boolean.
      //
      // So the guarantee moved into the unmount itself (see `unreadRefusalRef` above). The refusal
      // is rendered in here when the dialog is still the right place for it, and if ANYTHING takes
      // the dialog away before the operator has dealt with it — a queued refetch, a Save, the
      // parent's own stale-selection clear — it is re-emitted to the channel that outlives this
      // component. No predicate has to win.
      //
      // `switchedAwayFrom` stays, and what it decides is ROUTING, not wording: on a real switch the
      // disarm effect above would wipe the error before any unmount, so the safety net could not
      // see it. Going straight to the durable channel is what keeps that case covered. (An earlier
      // comment here claimed it decided the wording. It never did — both paths emit the identical
      // `refusal.message` — and a comment that misdescribes the mechanism is what the next reader
      // reasons from.)
      // HONEST NOTE on both lines below, because mutation cannot separate them and I will not imply
      // it can: removing this branch entirely, or dropping the ref-clear, leaves the suite green.
      // The safety net happens to cover the same case — but only by the order two effects commit
      // in. The disarm effect above wipes `removal.error` on a tenant change, and if it commits
      // before the unmount the net has nothing left to re-emit. Routing the switch explicitly is
      // DETERMINISTIC; the net is the backstop for everything that is not a switch. (The separate
      // ref-clear this branch used to carry is gone — `closeAfterOutcome` does it for all six
      // settle paths now, which is where it belonged.)
      if (switchedAwayFrom(tenantAtArm)) {
        setRemoval({ stage: "idle", error: null, tenantAtArm: null, nameAtArm: null });
        toast.error(refusal.message);
        closeAfterOutcome();
        return;
      }
      setRemoval({ stage: "armed", error: refusal, tenantAtArm, nameAtArm });
      return;
    }

    // The server echoes the workspace it acted on. Switching workspaces writes
    // profiles.active_tenant_id before this screen's own state changes, so a success rendered
    // without this check could describe a workspace the owner is no longer looking at.
    const acted = typeof data?.tenant_id === "string" ? data.tenant_id : null;
    // TWO DIFFERENT THINGS, told apart rather than collapsed into one sentence. The previous
    // version answered "your active workspace changed" for BOTH — including the case where the
    // client never switched and the SERVER echoed a different tenant, which is the case this PR's
    // own harness drives. It certified a false statement as OK. And in the other case it dropped a
    // fact it holds: `acted === tenantAtArm` proves the person WAS removed, and the operator was
    // told only that nothing is being claimed. Reported by the fourth adversarial read.
    if (acted !== tenantAtArm) {
      setRemoval({ stage: "idle", error: null, tenantAtArm: null, nameAtArm: null });
      toast.error(acted === null
        // It reported no workspace at all, which is not the same as reporting a different one.
        ? `This did not come back with a workspace, so nothing is being claimed here. Reopen Team to see the current roster.`
        : `The server reported acting on a different workspace, so nothing is being claimed here. Reopen Team to see the current roster.`);
      closeAfterOutcome();
      return;
    }
    if (switchedAwayFrom(tenantAtArm)) {
      // The removal DID happen, in the workspace it named. Say that, rather than leaving the
      // operator with an ambiguity about a destructive act that completed.
      setRemoval({ stage: "idle", error: null, tenantAtArm: null, nameAtArm: null });
      toast.success(`${identity.primary} was removed from ${nameAtArm}. You have since switched workspace, so this roster does not show it.`);
      closeAfterOutcome();
      return;
    }

    // `nameAtArm`, not the click-time closure: the guard above proves the ids match, so this is
    // the same workspace either way — but naming the one the call was SENT to is what this whole
    // sequence is about, and it stays right if that workspace is renamed mid-call.
    onRemoved?.(`${identity.primary} no longer has access to ${nameAtArm}.`);
    closeAfterOutcome();
  };

  const changePermission = async () => {
    if (!permissionDraft) return;
    setSaving(true);
    // WRAPPED for the same reason `confirmRemoval` is, and it is worse here than it was there.
    // `saving` now gates the destructive control, so a transport rejection that skips
    // `setSaving(false)` does not merely wedge this button — it kills "Remove from workspace"
    // permanently, with nothing said. I hung a gate off this flag and did not give it the
    // treatment the gate's own comment says it needs.
    let error: { message?: string } | null = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- migration RPC awaits generated types
      ({ error } = await (supabase as any).rpc("set_solo_team_member_permission", { _member_user_id: member.user_id, _new_permission: permissionDraft }));
    } catch (thrown) {
      error = { message: thrown instanceof Error ? thrown.message : "We could not reach the server, so the result of this is unknown. Reopen Team to see the current values." };
    }
    setSaving(false);
    if (error) { toast.error(error.message ?? "The permission change did not complete. Please try again."); return; }
    toast.success(`Permission changed to ${permissionPresentation(permissionDraft, false).label}.`); setPermissionDraft(null); onSaved(); requestClose();

  };

  // A removal in flight is NOT dismissible, on any path — backdrop, the header X, the footer Close,
  // or Escape. Found by the peer read of this diff: the dialog could be dismissed mid-call, and if
  // the server then REFUSED, `setRemoval({ stage: "armed", error: refusal })` landed on an unmounted
  // component and was discarded. The owner saw a closed dialog and an unchanged roster with no
  // indication the removal had failed — the failure was silent, which is the one outcome a
  // destructive action must never have. `inFlight` guards a second CLICK; it never guarded a
  // dismissal. The window is short but it is exactly the window a slow or failing call widens.
  //
  // THE FIRST ATTEMPT AT THIS FIX DID NOT WORK, and how it failed is why this is now ONE function
  // rather than a wrapper at one boundary. It gated only the prop handed to `Modal` — which covers
  // the backdrop, the header X and Escape — but the FOOTER button is rendered by THIS component and
  // wired the raw `onClose` prop directly. So the single control actually labelled "Close" stayed
  // live, and a person trying to back out would click precisely that one. Caught by an independent
  // read of the pushed diff; my own test missed it because it selected the close control by
  // `aria-label`, which the footer button does not carry. Every path now goes through `requestClose`,
  // and the controls are DISABLED rather than live-looking and inert.
  const removalInFlight = removal.stage === "pending";
  // EVERY string in the removal block names THIS, not the live roster. Pinning only the live-region
  // line left the paragraph above it and BOTH aria-labels still reading `workspace.tenant_name` —
  // which the parent re-supplies as the NEW workspace after a mid-call switch. Three of the four
  // then asserted a destructive act against a workspace it was not happening in while the fixed one
  // said otherwise: the screen contradicted itself, and a screen-reader user heard the wrong claim
  // from the button labels — worse than before, when all four at least agreed. Idle: `nameAtArm` is
  // null and this is the live name, which is right. Armed: a switch disarms, so it cannot go stale.
  const removalWorkspaceName = removal.nameAtArm ?? workspace.tenant_name;
  // THE GATE IS READ THROUGH A REF, because the gate itself was a stale closure — which is how the
  // first version of this fix failed, in the opposite click order. `changePermission` captures
  // `requestClose` at the render where "Confirm access change" was pressed; if the removal had not
  // started yet, that copy holds `removalInFlight === false` and closes the dialog unconditionally
  // when its own RPC resolves — mid-removal, discarding the refusal exactly as before. The note
  // below already named this mechanism for the raw closes, and I failed to apply it one line up.
  // A ref cannot go stale, so every copy of `requestClose`, however old, reads the current state.
  // THE INVARIANT, in both directions: while a removal is in flight NO other write starts, and while
  // any other write is in flight a removal cannot start. `saving` is shared by the work-details save
  // and the permission change, so gating on it covers both — deliberately, not incidentally. This is
  // what makes the interleaving that broke the first version of this gate unreachable rather than
  // merely guarded. (`save()` never closes the dialog, so it was not an escape path; it is included
  // for the invariant, not because it leaked.)
  // Assigned on COMMIT, not during render — the rule this file already states for `Modal`'s
  // `latest` ref 300 lines up, and which I broke here: a render discarded by StrictMode or
  // concurrent rendering would leave this holding `true` against a committed `false`, producing a
  // Close button that looks live and does nothing. `requestClose` only ever runs from an event
  // handler, which is after commit, so reading a commit-assigned ref is correct.
  // NOTE FOR ANYONE TIDYING THIS: the six `onClose()` calls inside `confirmRemoval` are RAW on
  // purpose and must stay that way. They run after the call has settled, but `requestClose` closes
  // over a `pending` state that is still true at that instant (the ref updates on the NEXT
  // render, and these run before it) — so routing them
  // through here would refuse the close and strand the operator in a dialog whose work is done.
  // Every close path a PERSON can trigger goes through `requestClose`; the settle paths are the
  // component deciding it is finished, which is the one case the gate must not block.
  // Closing it yourself acknowledges what is in it, so the safety net must not then repeat it back
  // as a toast. Written through the ref rather than through state because this unmounts in the same
  // batch: a `setRemoval` here may never commit before the component is gone.
  const requestClose = () => { if (removalInFlightRef.current) return; unreadRefusalRef.current = null; onClose(); };
  // Every settle path leaves through here. Written to the ref SYNCHRONOUSLY rather than relying on
  // the `[removal.error]` effect having flushed: these run in the same batch as the unmount, so a
  // reply fast enough to beat the passive effect would let the net re-announce a refusal the retry
  // had already superseded — a "we can't say whether this happened" toast over a roster banner
  // saying it did. Only the switch branch carried this line; the other five inherited the hazard.
  const closeAfterOutcome = () => { unreadRefusalRef.current = null; onClose(); };
  return <Modal title={identity.primary} description="Work details describe what this person does. Permission controls what they can access."
    wide
    busy={removalInFlight}
    onClose={requestClose}
    onEscape={() => { if (removal.stage !== "armed") return false; disarmRemoval(); return true; }}>
    <div className="stw-modal-body">
      <div className="stw-person-summary"><span className="stw-avatar">{initials(member)}</span><div><strong>{identity.primary}</strong>{identity.secondary && <span>{identity.secondary}</span>}</div><span className="stw-pill" data-tone={member.is_owner ? "owner" : "neutral"}>{permission.label}</span></div>
      <TeamMemberContact member={member} workspace={workspace} onDirtyChange={setContactDirty}/>
      <div className="stw-separation-note"><ShieldCheck/><span><strong>Permission and title are separate.</strong> Changing someone’s title never changes their access.</span></div>
      <label>Title<input value={title} disabled={!workspace.can_manage_profiles || saving} maxLength={121} onChange={(e) => { setTitle(e.target.value); setSaveConfirmed(false); }} placeholder="e.g. Client Success Manager"/>{errors.title && <small role="alert">{errors.title}</small>}</label>
      <label>Responsibilities<textarea value={responsibilities} disabled={!workspace.can_manage_profiles || saving} maxLength={2001} onChange={(e) => { setResponsibilities(e.target.value); setSaveConfirmed(false); }} rows={5} placeholder="What this person owns, decides, and hands off."/>{errors.responsibilities && <small role="alert">{errors.responsibilities}</small>}</label>
      {saveConfirmed && <div className="stw-separation-note" role="status"><ShieldCheck/><span>Work details saved. Permission was not changed.</span></div>}
      {workspace.can_change_permissions && permission.mutable && <div className="stw-permission-change"><label>Enforced permission<select value={permissionDraft ?? member.permission} onChange={(e) => setPermissionDraft(e.target.value)}><option value="admin">Admin</option><option value="member">Member</option></select></label>{permissionDraft && permissionDraft !== member.permission && <div className="stw-confirm"><p>Change access from {permission.label} to {permissionPresentation(permissionDraft, false).label}? This changes authorization, not the title.</p><button className="stw-btn secondary" onClick={() => setPermissionDraft(null)}>Cancel</button><button className="stw-btn" disabled={saving || removalInFlight} onClick={changePermission}>Confirm access change</button></div>}</div>}
      {/* `canRemove` is recomputed from the LIVE roster, so switching into a workspace where the
          viewer is only an Admin used to unmount this entire block MID-REMOVAL — taking the
          "Removing…" status line, Cancel and Confirm with it. What was left was an open dialog
          saying nothing about a destructive act in flight, with ZERO enabled controls: both close
          buttons are disabled while pending (deliberately, so a refusal cannot be lost), the work
          fields are disabled by `!can_manage_profiles`, Escape routes through the same gate, and
          the Tab trap's own `!focusable.length` branch swallows the key. A page reload was the only
          exit. Once a removal is under way this block belongs to the call, not to the live roster —
          it stays until the call settles and the switch guard above closes the dialog properly.
          The predicate is `!== "idle"` rather than `=== "pending"` because that is the invariant: a
          removal under way in EITHER stage belongs to its call. Stated plainly so it is not mistaken
          for a tested fact — only the pending half is provable, since a switch while merely ARMED is
          unmounted by the parent's stale-selection clear before this gate is reached, and mutation
          confirms no test here separates the two. */}
      {(canRemove || removal.stage !== "idle") && <div className="stw-permission-change">
        <div className="stw-confirm">
          {removal.stage === "idle" && <p>Removing someone ends their access to {workspace.tenant_name}. It does not delete their Paige account or the work already recorded under their name.</p>}
          <button ref={removeButtonRef} className="stw-btn secondary" disabled={removal.stage !== "idle" || saving} onClick={() => setRemoval({ stage: "armed", error: null, tenantAtArm: workspace.tenant_id, nameAtArm: workspace.tenant_name })} aria-label={`Remove ${identity.primary} from ${removalWorkspaceName}`}>Remove from workspace</button>
        </div>
        {removal.stage !== "idle" && <div className="stw-confirm">
          <p>Remove {identity.primary} from {removalWorkspaceName}? They lose access to this workspace right away. Their Paige account is not deleted and their {removalWorkspaceName} history stays. To bring them back you would send a new invitation.</p>
          {removal.stage === "pending" && <p ref={pendingRef} tabIndex={-1} role="status" aria-busy="true">Removing {identity.primary} from {removalWorkspaceName}…</p>}
          {removal.error && <p ref={errorRef} tabIndex={-1} role="alert">{removal.error.message}</p>}
          <button ref={cancelRef} className="stw-btn secondary" disabled={removal.stage === "pending"} onClick={disarmRemoval}>Cancel</button>
          <button className="stw-btn" disabled={removal.stage === "pending" || saving || !canRemove || removal.error?.retryable === false} onClick={confirmRemoval} aria-label={`Confirm removing ${identity.primary} from ${removalWorkspaceName}`}>{removal.stage === "pending" ? "Removing\u2026" : removal.error ? "Try again" : "Confirm removal"}</button>
        </div>}
      </div>}
    </div>
    <footer className="stw-modal-actions"><button className="stw-btn secondary" onClick={requestClose} disabled={removalInFlight}>{dirty ? "Cancel" : "Close"}</button>{workspace.can_manage_profiles && <button className="stw-btn" disabled={saving || removalInFlight || !dirty || Object.keys(errors).length > 0} onClick={save}>{saving ? "Saving…" : "Save work details"}</button>}</footer>
  </Modal>;
}
export function InviteDialog({ workspace, onClose, onInvited }: { workspace: TeamWorkspaceRecord; onClose: () => void; onInvited: () => void }) {
  const [email, setEmail] = useState(""); const [permission, setPermission] = useState("member"); const [title, setTitle] = useState(""); const [responsibilities, setResponsibilities] = useState(""); const [sending, setSending] = useState(false); const [reviewing, setReviewing] = useState(false);
  const errors = validateWorkProfile(title, responsibilities); const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  // The workspace is captured when the dialog opens, and it is what the review step names. If the
  // active workspace changes while a confirmation is on screen, neither answer is safe: sending to
  // the new one invites a stranger into a workspace nobody named, and sending to the captured one
  // contradicts what the rest of the screen now says. So it aborts. An invitation carries a live
  // access token, and a token cannot be recalled — a disagreement is an abort, never a redirection.
  // `workspace` here is the record CAPTURED when the dialog opened, not the live roster
  // value. That distinction is the whole fix: `useTeamWorkspace.load(0)` sets `value: null`
  // before it awaits, so any refetch — a search keystroke, a filter, a refresh, a workspace
  // switch — briefly nulls the roster. Rendering the dialog off that value unmounted it
  // mid-typing with no explanation, AND re-initialised this guard's ref to the new workspace,
  // making the abort below unreachable. Caught by adversarial review; the jsdom tests missed
  // it because they rendered this component directly and drove a prop transition the parent
  // structurally cannot produce.
  //
  // The live signal is `activeTenantId`, which comes from the tenant context and does not
  // flash through null.
  const { activeTenantId } = useTenantContext();
  const send = async () => {
    if (activeTenantId && activeTenantId !== workspace.tenant_id) {
      toast.error(`This invitation was for ${workspace.tenant_name}, but you have since switched workspace. Nothing was sent. Reopen the invitation in the workspace you mean.`);
      return;
    }
    setSending(true);
    const { data, error } = await supabase.functions.invoke("solo-team-invitations", { body: { action: "create", expectedTenantId: workspace.tenant_id, email, permission, jobTitle: title, responsibilities } });
    setSending(false);
    if (error || data?.ok === false) { toast.error(invitationRefusalMessage(await readFunctionErrorBody(error, data), "The invitation could not be sent. Please try again.")); return; }
    data?.emailed ? toast.success("Invitation sent.") : toast.warning("Invitation is pending, but the email was not sent. You can retry from Team.");
    onInvited(); onClose();
  };
  return <Modal title={reviewing ? "Confirm invitation" : "Invite someone"} description={reviewing ? "Review the workspace, the person, their work context, and enforced access before anything is sent." : "Choose enforced access separately from the work they will own."} onClose={onClose}>{reviewing ? <div className="stw-modal-body"><dl className="stw-invite-review"><div><dt>Workspace</dt><dd>{workspace.tenant_name}</dd></div><div><dt>Send to</dt><dd>{email.trim()}</dd></div><div><dt>Enforced permission</dt><dd>{permissionPresentation(permission, false).label}</dd></div><div><dt>Title</dt><dd>{title.trim() || "Not set"}</dd></div><div><dt>Responsibilities</dt><dd>{responsibilities.trim() || "Not set"}</dd></div></dl><div className="stw-separation-note"><ShieldCheck/><span>This confirmation sends one invitation. The title and responsibilities inform Paige about work; they do not grant authority.</span></div></div> : <div className="stw-modal-body"><label>Email<input data-initial-focus type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="person@company.com"/>{email.length > 0 && !validEmail && <small role="alert">Enter a valid email address.</small>}</label><label>Permission<select value={permission} onChange={(e) => setPermission(e.target.value)}><option value="member">Member</option><option value="admin">Admin</option></select></label><label>Title <span>optional</span><input maxLength={121} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Operations Lead"/>{errors.title && <small role="alert">{errors.title}</small>}</label><label>Responsibilities <span>optional</span><textarea maxLength={2001} rows={4} value={responsibilities} onChange={(e) => setResponsibilities(e.target.value)} placeholder="What they will own and where they hand work off."/>{errors.responsibilities && <small role="alert">{errors.responsibilities}</small>}</label><div className="stw-separation-note"><ShieldCheck/><span>The title and responsibilities give Paige work context. Only the permission above controls access.</span></div></div>}<footer className="stw-modal-actions">{reviewing ? <><button className="stw-btn secondary" onClick={() => setReviewing(false)}>Back</button><button data-initial-focus className="stw-btn" disabled={sending} onClick={send}>{sending ? "Sending…" : "Confirm and send invitation"}</button></> : <><button className="stw-btn secondary" onClick={onClose}>Cancel</button><button className="stw-btn" disabled={!validEmail || Object.keys(errors).length > 0} onClick={() => setReviewing(true)}>Review invitation</button></>}</footer></Modal>;
}

/**
 * One invitation, and what actually happened to it.
 *
 * The delivery half is the reason this component exists. Before it, the strongest thing the screen
 * could say was that a fresh invitation had been "sent" — which meant the POST to the provider was
 * accepted, and was shown identically whether the address bounced, the mail server queued it, or
 * the person read it an hour ago. Now the row says which of those happened, and says "Not sent yet"
 * rather than inventing a status when nothing was ever recorded.
 */
function InviteRow({ invite, onManage }: {
  invite: TeamInviteRecord;
  onManage: (action: "resend" | "revoke" | "archive", invite: TeamInviteRecord) => void | Promise<void>;
}) {
  const state = inviteLifecycle(invite);
  const finished = inviteIsFinished(invite);
  const delivery = invite.delivery ?? null;
  const presentation = deliveryPresentation(delivery);
  // How far along the happy path this email got. No `tone === "bad"` special case here: the trail
  // is not RENDERED at all for a terminal failure (see the guard on the <ol> below), so a second
  // check would be unreachable — mutation confirmed it, and an unreachable guard that a comment
  // calls load-bearing is what the next reader would reason from.
  const reached = DELIVERY_STEPS.indexOf((delivery?.status ?? "") as (typeof DELIVERY_STEPS)[number]);
  const recipient = invite.email || "Recipient unavailable";

  return <article>
    <div>
      <strong>{recipient}</strong>
      {/* THE EXPIRY CLAUSE IS ONLY SHOWN WHERE IT MEANS SOMETHING — a pending invitation that will
          expire, or one that already did. It is omitted for accepted and revoked.

          Two wrong answers were shipped here before this one, in opposite directions. Keying the
          verb on `finished` said "Accepted · expired Sep 10" while Sep 10 was still ahead. Keying
          it on `state === "expired"` then said "Accepted · expires Sep 1" once Sep 1 had passed,
          because `inviteLifecycle` short-circuits on `uses`/`revoked_at` BEFORE it looks at the
          date, so a used invitation never reports `expired` however old it gets.

          No tense is correct, because the premise is wrong: an invitation that was accepted did
          not expire and is not going to. Its expiry stopped mattering the moment it was used, and
          the pill beside it already says what happened. So the clause goes away rather than being
          conjugated more carefully. */}
      <small>
        {permissionPresentation(invite.permission, false).label}
        {(state === "pending" || state === "expired") && <>
          {" · "}{state === "expired" ? "expired" : "expires"}{" "}
          {new Date(invite.expires_at).toLocaleDateString()}
        </>}
      </small>
    </div>
    <span className="stw-pill" data-tone={state}>{state}</span>

    <div className="stw-invite-delivery" data-tone={presentation.tone}>
      <strong>{presentation.label}</strong>
      {presentation.detail && <small>{presentation.detail}</small>}
      {/* The trail is only meaningful once something has been recorded. Rendering four grey steps
          against an invitation that was never emailed would imply a journey that never started. */}
      {delivery && presentation.tone !== "bad" && <ol className="stw-invite-steps" aria-label={`Delivery progress for ${recipient}`}>
        {DELIVERY_STEPS.map((step, index) => {
          const done = index <= reached;
          const at = delivery.history.find((entry) => entry.status === step)?.at;
          return <li key={step} data-done={done ? "true" : "false"}>
            {/* The state is in the text, not only in the styling: a screen reader and a
                colour-blind reader both need to know which steps happened. */}
            <span>{step === "clicked" ? "Link clicked" : step[0].toUpperCase() + step.slice(1)}</span>
            <small>{at ? new Date(at).toLocaleString() : done ? "" : "not yet"}</small>
            <span className="sr-only">{done ? "completed" : "not yet"}</span>
          </li>;
        })}
      </ol>}
    </div>

    <div className="stw-invite-actions">
      {state === "pending" && <>
        <button onClick={() => onManage("resend", invite)}>Resend</button>
        <button onClick={() => onManage("revoke", invite)}>Revoke</button>
      </>}
      {state === "expired" && <button onClick={() => onManage("resend", invite)}>Send fresh invite</button>}
      {/* Only offered where the server will accept it. `inviteIsFinished` is the same predicate the
          archive function enforces, so this button cannot be a dead end. */}
      {finished && <button onClick={() => onManage("archive", invite)}>Remove from list</button>}
    </div>
  </article>;
}

export function SoloTeamWorkspace({ openPaige }: { openPaige?: () => void } = {}) {
  const [view, setView] = useState<"team" | "roles">("team"); const [search, setSearch] = useState(""); const [permission, setPermission] = useState("all"); const [selected, setSelected] = useState<TeamMemberRecord | null>(null);
  // The workspace an in-flight invitation was opened against. Held here rather than derived
  // from `team.value`, which is nulled by every roster refetch (see InviteDialog).
  // A REFETCH must not close the dialog (that was the §58 regression); a genuine WORKSPACE SWITCH
  // must. Otherwise the dialog sits there naming workspace A over workspace B's roster, inviting
  // the operator to keep composing something the send-time guard will then refuse. `activeTenantId`
  // distinguishes the two: it changes only on a real switch, and never flashes through null on a
  // reload. The send-time abort stays as the backstop for the same-tick race.
  const { activeTenantId } = useTenantContext();
  const [inviteWorkspace, setInviteWorkspace] = useState<TeamWorkspaceRecord | null>(null);
  // The outcome of a removal has to live OUTSIDE the dialog. `refresh()` is `load(0)`, which sets
  // `value` back to null, so the editor unmounts the instant the roster reloads — any confirmation
  // rendered inside it is destroyed before it can be read or announced.
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    setInviteWorkspace((current) => {
      if (!current || !activeTenantId || current.tenant_id === activeTenantId) return current;
      toast.error(`You switched workspace, so the invitation for ${current.tenant_name} was closed. Nothing was sent.`);
      return null;
    });
    // The removal announcement is cleared for the SAME reason, found by the peer read of this diff.
    // It names a workspace ("Dana Reyes no longer has access to Example Team.") and this component
    // does NOT remount on a switch — that is the premise the invite fix above rests on. Left alone,
    // the banner sat over the next workspace's roster still making a claim about the previous one:
    // the same cross-workspace false statement the invitation seam was just repaired to stop making.
    setNotice(null);
  }, [activeTenantId]);
  const team = useTeamWorkspace(search, permission); const workspace = team.value;
  // `refresh()` is `load(0)`, which sets `value` to null BEFORE it awaits. So during any refetch —
  // including the one a workspace switch triggers — `workspace` is momentarily null, and a render
  // gate that requires it unmounts the editor no matter what else is held. The last known roster is
  // kept so the dialog can outlive that flash; the LIVE one is still preferred whenever it exists,
  // so the child's own workspace-switch guard keeps seeing real changes rather than a frozen
  // snapshot. (The invite dialog solves the same problem by capturing at open; it can, because it
  // needs only the workspace it was opened for. This one must keep watching.)
  const lastWorkspace = useRef<TeamWorkspaceRecord | null>(null);
  const rosterRef = useRef<HTMLDivElement>(null);
  // Focus is moved deliberately rather than restored. The roster row that opened the editor is the
  // row that just went, and focusing a detached node silently drops focus to <body>.
  useEffect(() => { if (notice) rosterRef.current?.focus(); }, [notice]);
  const closeEditor = useCallback(() => { setRemovalPending(false); setSelected(null); }, []);
  const openEditor = (member: TeamMemberRecord) => { setNotice(null); setSelected(member); };
  // Applied to the snapshot BEFORE the refresh is started, so it is already correct whichever way
  // the race lands: if the editor survives the reload it keeps its own local state, and if it is
  // unmounted and remounted it now remounts onto the saved values rather than the ones they
  // replaced. This is the parent's half of the fix — the child cannot reach `selected`.
  const handleSaved = (saved?: { job_title: string; responsibilities: string }) => {
    if (saved) setSelected((current) => (current ? { ...current, job_title: saved.job_title, responsibilities: saved.responsibilities } : current));
    return team.refresh();
  };
  const handleRemoved = (announcement: string) => { setRemovalPending(false); setNotice(announcement); setSelected(null); team.refresh(); };
  // A selection is a snapshot taken when the row was clicked. Once the roster no longer carries it,
  // rendering the editor would show a person who is gone — with a live Save button and a live
  // permission select, both of which would then fail against the server.
  const selectedLive = selected && workspace ? workspace.members.some((row) => row.membership_id === selected.membership_id) : false;
  if (workspace) lastWorkspace.current = workspace;
  const editorWorkspace = workspace ?? lastWorkspace.current;
  // ...and it must be CLEARED, not merely hidden. `refresh()` is `load(0)`, which drops every page
  // past the first and re-applies the current search and permission filters — so a member reached
  // via "Load more", or one the filter no longer matches after an edit, falls out of the returned
  // page on any refresh. Hiding alone left `selected` set: the editor vanished mid-save and never
  // came back, and a later "Load more" that happened to return that row re-opened it on its own,
  // showing the stale snapshot. That is a regression to the SHIPPED save flow, not just to removal.
  // ...but NOT while a removal is in flight. Clearing then unmounts the dialog mid-call and both
  // outcomes are lost — the refusal has nowhere to land, and a removal the server DID apply is
  // never announced. The stale-selection clear and the in-flight hold are different concerns that
  // happen to touch the same state, so both are stated here rather than one silently winning.
  const [removalPending, setRemovalPending] = useState(false);
  useEffect(() => { if (selected && workspace && !selectedLive && !removalPending) setSelected(null); }, [selected, workspace, selectedLive, removalPending]);
  const pending = useMemo(() => workspace?.invitations.filter((item) => inviteLifecycle(item) === "pending") ?? [], [workspace]);
  // Split ONCE, from the same predicate the database uses to decide what may be cleared, so the
  // screen cannot offer a "Remove from list" the server will refuse.
  const activeInvites = useMemo(() => workspace?.invitations.filter((item) => !inviteIsFinished(item)) ?? [], [workspace]);
  const pastInvites = useMemo(() => workspace?.invitations.filter((item) => inviteIsFinished(item)) ?? [], [workspace]);
  const manageInvite = async (action: "resend" | "revoke" | "archive", invite: TeamInviteRecord) => {
    if (!workspace) { toast.error("This workspace is still loading. Try again in a moment."); return; }
    const { data, error } = await supabase.functions.invoke("solo-team-invitations", {
      body: { action, expectedTenantId: workspace.tenant_id, inviteId: invite.id },
    });
    if (error || data?.ok === false) {
      toast.error(invitationRefusalMessage(await readFunctionErrorBody(error, data), "The invitation could not be updated. Please try again."));
      return;
    }
    if (action === "resend") {
      // `emailed` now means the provider ACCEPTED it, which is still not delivery — the delivery
      // line on the row is what answers that, and it updates when the provider tells us.
      data?.emailed
        ? toast.success("Fresh invitation sent; the old link was revoked. Delivery will show on the invitation.")
        : toast.warning("Fresh invitation created, but it could not be emailed. Share the link directly, or try again.");
    } else if (action === "archive") {
      toast.success("Cleared from your list. The record is kept.");
    } else {
      toast.success("Invitation revoked.");
    }
    team.refresh();
  };
  return <div className="stw-workspace"><div className="stw-tabs" role="tablist" aria-label="Team settings"><button role="tab" aria-selected={view === "team"} onClick={() => setView("team")}>Team</button><button role="tab" aria-selected={view === "roles"} onClick={() => setView("roles")}>Roles &amp; access</button></div>
    {view === "roles" ? <section className="stw-access"><header><ShieldCheck/><div><h2>Roles &amp; access</h2><p>Permissions are enforced. Titles and responsibilities only describe work.</p></div></header><div className="stw-role-grid"><article><span>Owner</span><h3>Full workspace authority</h3><p>Manages invitations, work details, and permission changes. Owner access is protected here.</p></article><article><span>Admin</span><h3>Team operations</h3><p>Can manage invitations and work details. Cannot change another person’s enforced permission.</p></article><article><span>Member</span><h3>Standard workspace access</h3><p>Can see the confirmed team and access explanation. Cannot manage people or invitations.</p></article></div></section> : <>
      <section className="stw-toolbar"><div><h2>People</h2><p>{workspace ? `${workspace.total_members} confirmed ${workspace.total_members === 1 ? "person" : "people"} in ${workspace.tenant_name}` : "Confirmed members of this workspace"}</p></div>{workspace?.can_manage_invitations && <button className="stw-btn" onClick={() => setInviteWorkspace(workspace)}><UserPlus/>Invite someone</button>}</section>
      <section className="stw-permission-note"><ShieldCheck/><div><strong>Workspace permissions</strong><span>Owners and authorized admins may manage team access. Permissions apply only to this Solo workspace.</span></div><button onClick={() => setView("roles")}>Review roles</button></section>
      <section className="stw-roster" ref={rosterRef} tabIndex={-1}>{notice && <div className="stw-separation-note" role="status"><ShieldCheck/><span>{notice}</span></div>}<div className="stw-filters"><label><span className="sr-only">Search team</span><Search/><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search people, titles, responsibilities"/></label><label><span className="sr-only">Filter by permission</span><select value={permission} onChange={(e) => setPermission(e.target.value)}><option value="all">All permissions</option><option value="owner">Owner</option><option value="admin">Admin</option><option value="member">Member</option></select><ChevronDown/></label></div>
        {team.loading ? <div className="stw-state" role="status"><RefreshCw className="ss-spin"/>Resolving this workspace’s team…</div> : team.error && !workspace ? <div className="stw-state error" role="alert"><strong>{/access denied|permission/i.test(team.error) ? "You don’t have access to this team" : "Team unavailable"}</strong><span>{/access denied|permission/i.test(team.error) ? "Your current workspace permission does not allow this roster to load." : team.error}</span><button onClick={team.refresh}>Retry</button></div> : workspace && workspace.members.length === 0 ? <div className="stw-empty"><Users/><h3>No people match these filters</h3><p>Clear the search or choose a different permission.</p></div> : <>{workspace && workspace.total_members === 1 && workspace.members[0]?.is_owner && !search && permission === "all" && <div className="stw-first-use"><Users/><div><strong>Your workspace starts with you</strong><span>Invite the first teammate, then give them a title and clear responsibilities.</span></div>{workspace.can_manage_invitations && <button className="stw-btn" onClick={() => setInviteWorkspace(workspace)}>Invite first teammate</button>}</div>}<div className="stw-list" aria-label="Team roster">{workspace?.members.map((member) => { const access = permissionPresentation(member.permission, member.is_owner); return <button className="stw-row" key={member.membership_id} onClick={() => openEditor(member)}><span className="stw-avatar">{initials(member)}</span><span className="stw-identity"><strong>{member.full_name || member.email || "Name unavailable"}</strong><small>{member.email || "Email unavailable"}</small></span><span className="stw-work"><strong>{member.job_title || "Title not set"}</strong><small>{member.responsibilities || "Responsibilities not set"}</small></span><span className="stw-pill" data-tone={member.is_owner ? "owner" : "neutral"}>{access.label}</span><span className="stw-last"><strong>{member.status === "suspended" ? "Suspended" : "Active"}</strong><small>{member.last_sign_in_at ? `Last signed in ${new Date(member.last_sign_in_at).toLocaleDateString()}` : "No sign-in recorded"}</small></span></button>; })}</div></>}
        {team.error && workspace && <div className="stw-inline-error" role="alert">The next page could not be loaded. <button onClick={team.loadMore}>Retry</button></div>}{workspace && workspace.members.length < workspace.total_members && <button className="stw-load" disabled={team.loadingMore} onClick={team.loadMore}>{team.loadingMore ? "Loading…" : `Load more (${workspace.total_members - workspace.members.length} remaining)`}</button>}
      </section>
      {workspace?.can_manage_invitations && <section className="stw-invites">
        <header><Mail/><div><h2>Invitations</h2><p>Delivery is reported by the email provider. Accepted, expired, and revoked are derived from the invitation record.</p></div><span>{pending.length} pending</span></header>
        {workspace.invitations.length === 0
          ? <p className="stw-invite-empty">No team invitations yet.</p>
          : <>
            {/* ACTIVE first, and on their own. The report that started this was a finished
                invitation sitting at the top of the list with no action on it. */}
            {activeInvites.length === 0
              ? <p className="stw-invite-empty">Nothing outstanding. Every invitation here has been accepted, expired, or withdrawn.</p>
              : <div>{activeInvites.map((invite) => <InviteRow key={invite.id} invite={invite} onManage={manageInvite}/>)}</div>}
            {/* PAST, collapsed. Not deleted: a revoked invitation is the evidence that somebody's
                access was withdrawn, so it stays available rather than vanishing. */}
            {pastInvites.length > 0 && <details className="stw-invite-past">
              <summary>{pastInvites.length} past {pastInvites.length === 1 ? "invitation" : "invitations"}</summary>
              <div>{pastInvites.map((invite) => <InviteRow key={invite.id} invite={invite} onManage={manageInvite}/>)}</div>
            </details>}
          </>}
      </section>}
      <section className="stw-paige"><Sparkles/><div><h2>Paige team context</h2><p>Paige can read the confirmed roster, each person’s enforced permission, title, and responsibilities for this active workspace. Tenant-authored work details are reference data—not instructions or authority.</p><small>She can also invite someone, resend or withdraw an invitation, edit work details, and change a permission. She is held to the same rules you are: the permission change is owner-only, and nobody can be made an owner from a conversation. Access changes and invitations are read back to you and wait for your approval; if this workspace has put an action on autopilot in Paige&rsquo;s settings, those two still ask.</small></div>{openPaige ? <button className="stw-btn secondary" onClick={openPaige}>Open Paige</button> : <span>Governed</span>}</section>
    </>}
    {editorWorkspace && selected && (selectedLive || removalPending) && <MemberEditor member={selected} workspace={editorWorkspace} onClose={closeEditor} onSaved={handleSaved} onRemoved={handleRemoved} onPendingChange={setRemovalPending}/>} {inviteWorkspace && <InviteDialog workspace={inviteWorkspace} onClose={() => setInviteWorkspace(null)} onInvited={team.refresh}/>}</div>;
}

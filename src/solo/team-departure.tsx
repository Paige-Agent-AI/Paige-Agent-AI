/**
 * EXP08 Settings → Team → Remove → the departure review (approved design 2026-10-26).
 *
 * One ledger of what the person holds (team_member_holdings, read-only), a hand-over choice on each
 * line that HAS a writer, one "Hand everything to" control, then a visible run where every change
 * saves on its own through its existing writer and reports its own result (team-handover.ts).
 * Things nothing can hand over yet (approvals, a connected mailbox) are shown with the plain truth
 * about what happens to them, never with a control that pretends. Removal is a separate, final act.
 *
 * The removal itself keeps every guarantee the inline removal block in MemberEditor earned (that
 * block is replaced by this drawer): one request per click even inside one batch; never dismissible
 * while in flight; a refusal is never reported as a removal; a server that acted on another
 * workspace is not claimed; a workspace switch mid-call is reported through the channel that
 * outlives this component.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowRight, Briefcase, CheckCircle2, ClipboardList, Clock, Loader2, Mail, RefreshCw, Users } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useTenantContext } from "@/hooks/useTenantContext";
import { Modal, TeamPicker, type PickOption } from "./team-controls";
import { handOver, isMovable, receiversFor, writerOf, type MovableItem } from "./team-handover";
import {
  HOLDING_KINDS,
  lifecycleRefusal,
  memberVisibleIdentity,
  normalizeHoldings,
  permissionPresentation,
  removalRefusal,
  type HoldingItem,
  type HoldingKind,
  type MemberHoldings,
  type TeamMemberRecord,
  normalizeTeamWorkspace,
  type TeamWorkspaceRecord,
} from "./team-workspace-contract";

/**
 * Every teammate who could receive something, read for the review itself. The roster on screen is
 * filtered by the Search box and the Show picker and paged at 25, so choosing receivers from it left
 * "Don't hand over" as the only choice after a search, and dropped the owner and admins under
 * Show: Members. This asks for everyone (no search, every permission, up to 100 a page) and pages
 * until the server's total is reached. `null` means it could not be read whole.
 */
async function readEveryone(tenantId: string): Promise<TeamMemberRecord[] | null> {
  const all: TeamMemberRecord[] = [];
  for (let page = 0; page < 50; page += 1) {
    let data: unknown = null;
    let error: unknown = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- migration RPC awaits generated types
      ({ data, error } = await (supabase as any).rpc("get_solo_team_workspace", { _search: null, _permission: "all", _limit: 100, _offset: all.length }));
    } catch { return null; }
    const next = error ? null : normalizeTeamWorkspace(data);
    if (!next || next.tenant_id !== tenantId) return null;
    all.push(...next.members);
    if (all.length >= next.total_members || next.members.length === 0) return all;
  }
  return all;
}

const KIND: Record<HoldingKind, { label: string; icon: React.ReactNode; movable: boolean }> = {
  work: { label: "Open work", icon: <ClipboardList aria-hidden="true" />, movable: true },
  crm_tasks: { label: "CRM tasks", icon: <ClipboardList aria-hidden="true" />, movable: true },
  clients: { label: "Clients", icon: <Users aria-hidden="true" />, movable: true },
  deals: { label: "Deals", icon: <Briefcase aria-hidden="true" />, movable: true },
  approvals: { label: "Approvals assigned to them", icon: <CheckCircle2 aria-hidden="true" />, movable: false },
  mailboxes: { label: "Connected mailbox", icon: <Mail aria-hidden="true" />, movable: false },
};
const STATUS: Record<string, string> = { open: "Open", in_progress: "In progress", blocked: "Blocked", pending: "Pending" };
const APPROVAL_STATUS: Record<string, string> = { changes_requested: "Changes requested", escalated: "Escalated" };

const shortDate = (iso: string | null, withDay = false) => {
  if (!iso) return null;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00` : iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", withDay ? { weekday: "short", month: "short", day: "numeric" } : { month: "short", day: "numeric" });
};
const money = (cents: number | null, currency: string | null) => {
  if (cents === null) return null;
  try { return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD", maximumFractionDigits: 0 }).format(cents / 100); } catch { return null; }
};
const cap = (s: string | null) => (s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ") : null);

function titleOf(item: HoldingItem): string {
  switch (item.kind) {
    case "clients": return item.label;
    case "approvals": return item.summary ?? "An approval";
    case "mailboxes": return item.address ?? item.label;
    default: return item.title;
  }
}
function metaOf(item: HoldingItem): string {
  switch (item.kind) {
    case "work": { const due = shortDate(item.due_at, true); return [item.client_label ?? "No client", due && `due ${due}`, STATUS[item.status]].filter(Boolean).join(" · "); }
    case "crm_tasks": { const due = shortDate(item.due_date, true); return [item.client_label ?? "Not on a deal", due && `due ${due}`, STATUS[item.status]].filter(Boolean).join(" · "); }
    case "clients": return item.relation === "assigned" ? "Assigned to them" : "Lead owner";
    case "deals": { const close = shortDate(item.expected_close_date); return [item.client_label, money(item.value_cents, item.currency), close && `closes ${close}`].filter(Boolean).join(" · "); }
    case "approvals": { const since = shortDate(item.created_at); return [cap(item.approval_kind), since && `waiting since ${since}`, APPROVAL_STATUS[item.status]].filter(Boolean).join(" · "); }
    case "mailboxes": return [item.label, item.provider && cap(item.provider), "connected mailbox"].filter(Boolean).join(" · ");
  }
}
const itemKey = (item: HoldingItem) => (item.kind === "clients" ? `${item.kind}:${item.id}:${item.relation}` : `${item.kind}:${item.id}`);

type RunState = "waiting" | "saving" | "checking" | "saved" | "confirm" | "failed" | "changed" | "expired";
type RunRow = { item: MovableItem; to: string; state: RunState; key: string; fingerprint?: string; message?: string; gone?: boolean };

const CHIP: Record<RunState, [React.ReactNode, string]> = {
  waiting: [<Clock key="i" aria-hidden="true" />, "Waiting"],
  saving: [<Loader2 key="i" className="stw-spin" aria-hidden="true" />, "Saving…"],
  checking: [<Loader2 key="i" className="stw-spin" aria-hidden="true" />, "Reading again…"],
  saved: [<CheckCircle2 key="i" aria-hidden="true" />, "Saved"],
  confirm: [<CheckCircle2 key="i" aria-hidden="true" />, "Needs confirming"],
  failed: [<AlertTriangle key="i" aria-hidden="true" />, "Didn't save"],
  changed: [<AlertTriangle key="i" aria-hidden="true" />, "Changed"],
  expired: [<Clock key="i" aria-hidden="true" />, "Expired"],
};

const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k-${Date.now()}-${Math.random().toString(36).slice(2)}`);

export type DepartureOutcome = { text: React.ReactNode; spoken: string; action?: "review-again" };

export function DepartureReview({ member, workspace, viewerId, members, contextBlocked = false, onClose, onRemoved, onSuspendInstead, onOpenConnections }: {
  member: TeamMemberRecord;
  workspace: TeamWorkspaceRecord;
  viewerId: string;
  /** The roster as loaded. Used only until the review's own full read of the team arrives. */
  members: TeamMemberRecord[];
  /** Pause new effects until the original Team reader re-confirms this actor/workspace. */
  contextBlocked?: boolean;
  /** `outcome` is set when a hand-over ran and the person is still on the team. */
  onClose: (outcome?: DepartureOutcome) => void;
  onRemoved: (outcome: DepartureOutcome) => void;
  onSuspendInstead?: () => void;
  onOpenConnections?: () => void;
}) {
  const identity = memberVisibleIdentity(member);
  const name = identity.primary;
  const first = member.full_name?.trim() ? member.full_name.trim().split(/\s+/)[0] : name;
  const permission = permissionPresentation(member.permission, member.is_owner);
  // The workspace this review was opened in. Every write names it; nothing re-reads the live one.
  const opened = useRef({ tenantId: workspace.tenant_id, tenantName: workspace.tenant_name });
  const { activeTenantId } = useTenantContext();
  const activeTenantRef = useRef(activeTenantId);
  useLayoutEffect(() => { activeTenantRef.current = activeTenantId; }, [activeTenantId]);
  const blocked = contextBlocked || activeTenantId !== opened.current.tenantId;
  const blockedRef = useRef(blocked);
  useLayoutEffect(() => { blockedRef.current = blocked; }, [blocked]);
  const switchedAway = () => Boolean(activeTenantRef.current) && activeTenantRef.current !== opened.current.tenantId;
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const titleRef = useRef<HTMLHeadingElement>(null);

  const [stage, setStage] = useState<"loading" | "failed" | "unavailable" | "ready">("loading");
  const [loadMessage, setLoadMessage] = useState<string>("");
  const [holdings, setHoldings] = useState<MemberHoldings | null>(null);
  const [step, setStep] = useState<"review" | "plan" | "run">("review");
  const [assign, setAssign] = useState<Record<string, string>>({});
  const [handAll, setHandAll] = useState<string>("");
  const [handAllSkipped, setHandAllSkipped] = useState<string[]>([]);
  const [run, setRun] = useState<RunRow[]>([]);
  const runRef = useRef<RunRow[]>([]);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<{ message: string; retryable: boolean } | null>(null);
  const inFlight = useRef(false);
  const [spoken, setSpoken] = useState("");
  // Receivers come from the review's own complete read of the team (readEveryone), never from the
  // filtered, paged roster on screen. Until that arrives, or if it can't be read, the loaded roster
  // stands in and the screen says some teammates may be missing.
  const [everyoneRead, setEveryoneRead] = useState<TeamMemberRecord[] | null>(null);
  const [everyoneFailed, setEveryoneFailed] = useState(false);
  const people = everyoneRead ?? members;

  const say = (text: string) => { setSpoken(""); window.setTimeout(() => { if (alive.current) setSpoken(text); }, 30); };

  const read = async (): Promise<MemberHoldings | "unavailable" | { error: string }> => {
    if (blockedRef.current) return { error: "Confirm the original workspace before checking this review again." };
    let data: unknown = null;
    let error: { code?: string; message?: string } | null = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- EXP08 RPC awaits generated types
      ({ data, error } = await (supabase as any).rpc("team_member_holdings", { _member_user_id: member.user_id, _expected_tenant_id: opened.current.tenantId }));
    } catch (thrown) {
      error = { message: thrown instanceof Error ? thrown.message : "network request failed" };
    }
    if (error) {
      const refusal = lifecycleRefusal(error, "review", name, opened.current.tenantName);
      return refusal.unavailable ? "unavailable" : { error: refusal.message };
    }
    const parsed = normalizeHoldings(data, member.user_id);
    return parsed ?? { error: "The answer didn't match this person, so nothing is shown." };
  };

  const load = async () => {
    if (blockedRef.current) return;
    setStage("loading");
    say(`Checking what ${first} holds.`);
    const [result, roster] = await Promise.all([read(), everyoneRead ? Promise.resolve(everyoneRead) : readEveryone(opened.current.tenantId)]);
    if (!alive.current) return;
    if (roster) { setEveryoneRead(roster); setEveryoneFailed(false); } else setEveryoneFailed(true);
    if (result === "unavailable") { setStage("unavailable"); return; }
    if ("error" in result) { setLoadMessage(result.error); setStage("failed"); return; }
    setHoldings(result);
    setStage("ready");
    const total = HOLDING_KINDS.reduce((a, k) => a + result.items[k].length, 0);
    const movable = HOLDING_KINDS.reduce((a, k) => a + (KIND[k].movable ? result.items[k].length : 0), 0);
    say(total ? `${total} things ${first} holds. ${movable} can be handed over.` : "Nothing to hand over.");
  };
  useEffect(() => { void load(); // eslint-disable-next-line react-hooks/exhaustive-deps -- once per open
  }, []);
  useEffect(() => { titleRef.current?.focus(); }, [stage, step]);

  const groups = useMemo(() => holdings ? HOLDING_KINDS.filter((k) => holdings.items[k].length).map((k) => ({ kind: k, items: holdings.items[k] })) : [], [holdings]);
  const movable = useMemo(() => groups.flatMap((g) => g.items.filter(isMovable)), [groups]);
  const fixedCount = groups.filter((g) => !KIND[g.kind].movable).reduce((a, g) => a + g.items.length, 0);
  const approvals = holdings?.items.approvals ?? [];
  const mailbox = (holdings?.items.mailboxes ?? [])[0] as Extract<HoldingItem, { kind: "mailboxes" }> | undefined;
  const nameFor = (userId: string) => {
    const m = people.find((x) => x.user_id === userId);
    const n = m ? memberVisibleIdentity(m).primary : "Teammate";
    return userId === viewerId ? `${n} (you)` : n;
  };
  const optionsFor = (item: MovableItem): PickOption[] => [{ value: "none", label: "Don't hand over" }, ...receiversFor(item, member.user_id, people).map((m) => ({ value: m.user_id, label: nameFor(m.user_id), hint: permissionPresentation(m.permission, m.is_owner).label }))];
  // "Hand everything to" offers only people who can receive at least one of the things listed.
  const everyone = useMemo(() => people.filter((p) => movable.some((it) => receiversFor(it, member.user_id, people).some((r) => r.user_id === p.user_id))), [people, movable, member.user_id]);
  const plan = movable.filter((it) => assign[itemKey(it)] && assign[itemKey(it)] !== "none").map((it) => ({ item: it, to: assign[itemKey(it)] }));
  const done = plan.length;

  // ── The run: one write at a time, each through its own writer ──
  const commit = (rowsNext: RunRow[]) => { runRef.current = rowsNext; setRun(rowsNext); };
  const patchRow = (key: string, patch: Partial<RunRow>) => commit(runRef.current.map((r) => (itemKey(r.item) === key ? { ...r, ...patch } : r)));
  const pumping = useRef(false);
  const pump = async () => {
    if (pumping.current || blockedRef.current) return;
    pumping.current = true;
    try {
      for (;;) {
        if (!alive.current || blockedRef.current) return;
        const row = runRef.current.find((r) => r.state === "waiting");
        if (!row) return;
        const key = itemKey(row.item);
        patchRow(key, { state: "saving", message: undefined });
        const outcome = await handOver({ actorId: viewerId, tenantId: opened.current.tenantId }, row.item, row.to, row.key);
        if (!alive.current) return;
        settle(key, outcome);
      }
    } finally { pumping.current = false; }
  };
  const settle = (key: string, outcome: Awaited<ReturnType<typeof handOver>>) => {
    const row = runRef.current.find((r) => itemKey(r.item) === key);
    if (!row) return;
    const t = titleOf(row.item);
    if (outcome.kind === "saved") { patchRow(key, { state: "saved" }); say(`${t} saved to ${nameFor(row.to)}.`); }
    else if (outcome.kind === "confirm") { patchRow(key, { state: "confirm", fingerprint: outcome.fingerprint }); say(`${t} needs your confirmation.`); }
    else if (outcome.kind === "changed") { patchRow(key, { state: "changed" }); say(`${t} changed since you opened the review. Nothing saved.`); }
    else if (outcome.kind === "expired") { patchRow(key, { state: "expired", fingerprint: undefined }); say(`The confirmation for ${t} expired. Nothing saved.`); }
    // A clear refusal is retried under a fresh key; an unknown result keeps its key, so a retry reads
    // back the original instead of writing twice.
    else { patchRow(key, { state: "failed", message: outcome.message, key: outcome.uncertain ? row.key : newKey() }); say(`${t} didn't save.`); }
  };
  const confirmRow = async (key: string) => {
    if (blockedRef.current) return;
    const row = runRef.current.find((r) => itemKey(r.item) === key);
    if (!row?.fingerprint || runRef.current.some((r) => r.state === "saving" || r.state === "checking")) return;
    patchRow(key, { state: "saving" });
    const outcome = await handOver({ actorId: viewerId, tenantId: opened.current.tenantId }, row.item, row.to, row.key, row.fingerprint);
    if (!alive.current) return;
    // A confirmed change that comes back asking again is not a save.
    settle(key, outcome.kind === "confirm" ? { kind: "failed", message: "This change still needs a confirmation. Retry prepares it again.", uncertain: false } : outcome);
    void pump();
  };
  const retryRow = (key: string, fresh: boolean) => {
    if (blockedRef.current) return;
    patchRow(key, { state: "waiting", fingerprint: undefined, message: undefined, ...(fresh ? { key: newKey() } : {}) });
    void pump();
  };
  const checkAgain = async (key: string) => {
    if (blockedRef.current) return;
    const row = runRef.current.find((r) => itemKey(r.item) === key);
    if (!row) return;
    patchRow(key, { state: "checking" });
    const latest = await read();
    if (!alive.current) return;
    if (latest === "unavailable" || "error" in latest) { patchRow(key, { state: "changed", message: "We couldn't read it again. Try once more." }); return; }
    const fresh = latest.items[row.item.kind].find((x) => itemKey(x) === key);
    if (!fresh || !isMovable(fresh)) { patchRow(key, { state: "failed", gone: true, message: `This is no longer with ${first}, so there is nothing to hand over.` }); return; }
    patchRow(key, { item: fresh, state: "waiting", key: newKey() });
    void pump();
  };

  const busy = removing || run.some((r) => r.state === "saving" || r.state === "checking");
  useEffect(() => {
    if (!blocked) void pump();
    // Existing queued work resumes only after the original same-workspace Team read confirms it.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only current-context admission resumes the existing pump
  }, [blocked]);

  // A workspace switch closes the review, because every choice in it names the workspace it was
  // opened in. Never under a write in flight: a removal reports its own outcome after it settles
  // (see `remove`), and a hand-over finishes the one change it is saving first.
  useEffect(() => {
    if (busy || !switchedAway()) return;
    const saved = run.filter((r) => r.state === "saved").length;
    toast.error(`You switched workspace, so the review for ${name} in ${opened.current.tenantName} was closed.${saved ? ` ${saved} hand-over${saved === 1 ? "" : "s"} saved there ${saved === 1 ? "stays" : "stay"} saved.` : " Nothing was changed."}`);
    onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-checked on a switch and when a write settles
  }, [activeTenantId, busy]);


  const startRun = () => {
    if (blockedRef.current) return;
    commit(plan.map(({ item, to }) => ({ item, to, state: "waiting", key: newKey() })));
    setStep("run");
    say(`Handing over ${plan.length} ${plan.length === 1 ? "thing" : "things"}, one at a time.`);
    window.setTimeout(() => void pump(), 0);
  };

  // ── Removal: the final, separate act ──
  const remove = async () => {
    // `disabled` alone is not a guard: two clicks inside one React batch both run before the
    // disabling re-render commits.
    if (inFlight.current || blockedRef.current) return;
    inFlight.current = true;
    setRemoving(true);
    setRemoveError(null);
    const tenantAtOpen = opened.current.tenantId; const nameAtOpen = opened.current.tenantName;
    let data: { tenant_id?: string } | null = null;
    let error: { message?: string } | null = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- migration RPC awaits generated types
      ({ data, error } = await (supabase as any).rpc("remove_solo_team_member", { _member_user_id: member.user_id, _expected_tenant_id: tenantAtOpen }));
    } catch (thrown) {
      error = { message: thrown instanceof Error ? thrown.message : "network request failed" };
    }
    inFlight.current = false;
    if (!alive.current) return;
    if (error) {
      const refusal = removalRefusal(error.message ?? null, name, nameAtOpen);
      setRemoving(false);
      if (refusal.reconciled) {
        if (switchedAway()) { toast.error(refusal.message); onClose(); return; }
        onRemoved({ text: refusal.message, spoken: refusal.message });
        return;
      }
      // A switch mid-call: this drawer is no longer the right place to say it.
      if (switchedAway()) { toast.error(refusal.message); onClose(); return; }
      setRemoveError({ message: refusal.message, retryable: refusal.retryable });
      return;
    }
    const acted = typeof data?.tenant_id === "string" ? data.tenant_id : null;
    if (acted !== tenantAtOpen) {
      setRemoving(false);
      toast.error(acted === null
        ? "This did not come back with a workspace, so nothing is being claimed here. Reopen Team to see the current roster."
        : "The server reported acting on a different workspace, so nothing is being claimed here. Reopen Team to see the current roster.");
      onClose();
      return;
    }
    if (switchedAway()) {
      setRemoving(false);
      toast.success(`${name} was removed from ${nameAtOpen}. You have since switched workspace, so this roster does not show it.`);
      onClose();
      return;
    }
    const saved = run.filter((r) => r.state === "saved").length;
    const left = run.length - saved;
    const parts: string[] = [];
    if (saved) parts.push(`${saved} ${saved === 1 ? "thing" : "things"} handed over`);
    if (left) parts.push(`${left} unfinished ${left === 1 ? "stays" : "stay"} with ${first}`);
    if (approvals.length) parts.push(`${approvals.length === 1 ? "1 approval stays" : `${approvals.length} approvals stay`} assigned to ${first}`);
    const sentence = `${name} is no longer on the team.${parts.length ? ` ${parts.join("; ")}.` : ""}`;
    onRemoved({ text: <><strong>{name}</strong>{sentence.slice(name.length)}</>, spoken: sentence });
  };

  const close = () => {
    if (busy) return;
    if (step === "run" && run.length) {
      const saved = run.filter((r) => r.state === "saved").length;
      const sentence = `${name} is still on the team. ${saved} of ${run.length} hand-overs saved, and they stay saved.`;
      onClose({ text: <><strong>{name}</strong>{sentence.slice(name.length)}</>, spoken: sentence, action: "review-again" });
      return;
    }
    onClose();
  };

  // ── Rendering ──
  const roleLine = `${permission.label}${member.job_title ? ` · ${member.job_title}` : ""}`;
  let title = `What ${name} holds`;
  let description = `Checking before ${first} leaves.`;
  let body: React.ReactNode = null;
  let foot: React.ReactNode = null;

  const removeButton = (label = `Remove ${name}`) => <button type="button" className="stw-btn danger" disabled={blocked || busy || removeError?.retryable === false} aria-busy={removing || undefined} onClick={remove}>
    {removing ? "Removing…" : removeError ? "Try again" : label}</button>;
  const removalStatus = <>
    {removeError && <div className="stw-alert" role="alert" tabIndex={-1}><AlertTriangle aria-hidden="true" /><p>{removeError.message}</p></div>}
    {removing && <p className="stw-status" role="status" tabIndex={-1}><Loader2 className="stw-spin" aria-hidden="true" />Removing {first}…</p>}
  </>;

  if (stage === "loading") {
    body = <>
      <p className="stw-status" role="status"><Loader2 className="stw-spin" aria-hidden="true" />Checking {first}'s open work, CRM tasks, clients, deals, approvals and mailbox…</p>
      {[0, 1, 2].map((i) => <div key={i} className="stw-group" aria-hidden="true"><div className="stw-skel" style={{ width: "34%", marginBottom: 12 }} /><div className="stw-skel" style={{ width: "88%", marginBottom: 8 }} /><div className="stw-skel" style={{ width: "62%" }} /></div>)}
    </>;
    foot = <><button type="button" className="stw-btn secondary" onClick={close}>Cancel</button><button type="button" className="stw-btn primary" disabled>Continue</button></>;
  } else if (stage === "failed") {
    body = <div className="stw-alert" role="alert" tabIndex={-1}><AlertTriangle aria-hidden="true" /><div><p><strong>We couldn't load what {first} holds.</strong></p><p>Removal waits until this list loads, so nothing is left behind by accident. If access needs to stop right now, suspend {first} instead.</p>{loadMessage && <p className="stw-muted">{loadMessage}</p>}</div></div>;
    foot = <>{onSuspendInstead && <button type="button" className="stw-btn secondary" disabled={blocked} onClick={onSuspendInstead}>Suspend instead</button>}<button type="button" className="stw-btn primary" disabled={blocked} onClick={() => void load()}><RefreshCw aria-hidden="true" />Try again</button></>;
  } else if (stage === "unavailable") {
    // The review is not deployed in this workspace yet, but removal is. Removal is NOT withheld for
    // that (it was available before this review existed, §58); the screen says plainly that it can't
    // list what they hold, and what that means.
    title = `Remove ${name} from ${opened.current.tenantName}?`;
    description = "Check what happens before you remove them.";
    body = <>
      <div className="stw-alert is-warn" role="status"><AlertTriangle aria-hidden="true" /><div><p><strong>The list of what {first} holds isn't available in {opened.current.tenantName} yet.</strong></p><p>Anything assigned to {first} stays with their name after removal. Hand it over in Operations and Clients first if it should go to someone else.</p></div></div>
      <ol className="stw-steps"><li><div><strong>Remove {name}</strong><p>{first}'s access to {opened.current.tenantName} ends right away. Their Team Hub messages stay, shown as from a former teammate. Their Paige account isn't deleted; to bring them back, send a new invitation.</p></div></li></ol>
      {removalStatus}
    </>;
    foot = <><button type="button" className="stw-btn secondary" onClick={close} disabled={busy}>Cancel</button>{removeButton()}</>;
  } else if (step === "review" && holdings) {
    if (!groups.length) {
      description = `Checked before ${first} leaves. ${roleLine}`;
      body = <div className="stw-calm"><CheckCircle2 aria-hidden="true" /><strong>{name} holds nothing to hand over</strong><p>No open work, CRM tasks, clients, deals, approvals or connected mailbox. Removing {first} leaves nothing behind.</p></div>;
      foot = <><button type="button" className="stw-btn secondary" onClick={close}>Cancel</button><button type="button" className="stw-btn primary" onClick={() => setStep("plan")}>Continue</button></>;
    } else {
      description = `Choose who takes over each thing before ${first} leaves. ${roleLine}`;
      const total = movable.length;
      const left = total - done;
      body = <>
        {total > 0 && <div className="stw-tally" role="status"><div><strong>{done} of {total} will be handed over</strong>
          <small>{left ? `${left} still ${left === 1 ? "has" : "have"} no one. Choose a teammate, or don't hand ${left === 1 ? "it" : "them"} over.` : "Everything that can move has someone to take it."}{fixedCount ? ` ${fixedCount} more can't be handed over; see below.` : ""}</small>
          <div className="stw-bar" aria-hidden="true"><i style={{ transform: `scaleX(${total ? done / total : 0})` }} /></div></div></div>}
        {total > 0 && <div><div className="stw-fieldlabel" id="stw-handall-l">Hand everything to</div>
          <TeamPicker value={handAll} labelledBy="stw-handall-l" placeholder="Choose a teammate" options={everyone.map((m) => ({ value: m.user_id, label: nameFor(m.user_id), hint: permissionPresentation(m.permission, m.is_owner).label }))}
            onChange={(to) => {
              setHandAll(to);
              // Computed outside the state updater: React may run an updater later, or twice.
              const skipped: string[] = [];
              const next = { ...assign };
              for (const it of movable) { if (receiversFor(it, member.user_id, people).some((r) => r.user_id === to)) next[itemKey(it)] = to; else skipped.push(titleOf(it)); }
              setAssign(next);
              setHandAllSkipped(skipped);
              say(`Everything that can go to ${nameFor(to)} is set to go there.${skipped.length ? ` ${skipped.length} can only go to an owner or admin.` : ""}`);
            }} />
          {everyoneFailed && <p className="stw-muted stw-small">We couldn't read the whole team, so some teammates may be missing from these choices. Close and reopen the review to try again.</p>}
          {handAllSkipped.length > 0 && <p className="stw-muted stw-small">{handAllSkipped.join(", ")} can only go to an owner or admin, so {handAllSkipped.length === 1 ? "it keeps its" : "they keep their"} own choice.</p>}
        </div>}
        {groups.map((g) => {
          const count = holdings.counts[g.kind];
          const extra = count > g.items.length ? count - g.items.length : 0;
          return <section key={g.kind} className="stw-group" data-kind={g.kind} aria-labelledby={`stw-g-${g.kind}`}>
            <h3 id={`stw-g-${g.kind}`}>{KIND[g.kind].icon}{KIND[g.kind].label}<span className="stw-n">{count}</span>{!KIND[g.kind].movable && <span className="stw-why">Nothing can hand {g.items.length === 1 ? "this" : "these"} over yet</span>}</h3>
            {g.items.map((it) => {
              const k = itemKey(it);
              const v = assign[k] || "none";
              return <div key={k} className="stw-item" data-tone={isMovable(it) ? undefined : "warn"}>
                <div><strong>{titleOf(it)}</strong><small>{metaOf(it)}</small>{it.kind === "clients" && it.relation === "assigned" && <span className="stw-rule">Can go to an owner or admin.</span>}</div>
                {isMovable(it)
                  ? <TeamPicker value={v} label={`Hand ${titleOf(it)} to`} options={optionsFor(it)} changed={v !== "none"} onChange={(to) => setAssign((c) => ({ ...c, [k]: to }))} />
                  : it.kind === "approvals"
                    ? <div className="stw-where"><span>Can't be handed over yet. It stays assigned to {first} and waiting, and once {first} leaves it won't show on anyone's Game Plan approvals card.</span></div>
                    : <div className="stw-where"><span>Can't be handed over: it's {first}'s own {cap((it as Extract<HoldingItem, { kind: "mailboxes" }>).provider) ?? "email"} account. It stays connected after {first} leaves. {member.permission === "admin" ? `Only ${first} can disconnect it, and only while still on the team.` : "No one can disconnect it: only an admin can disconnect their own mailbox."}</span>
                      {onOpenConnections && <button type="button" className="stw-quiet" onClick={onOpenConnections}>Open Connections</button>}</div>}
              </div>;
            })}
            {extra > 0 && <p className="stw-more-note">+{extra} more not listed here (the list shows the first 50).{g.kind === "work" || g.kind === "crm_tasks" ? " Hand the rest over in Operations." : ""}</p>}
          </section>;
        })}
      </>;
      foot = <><span className="stw-lead">Nothing changes until you start the hand-over.</span><button type="button" className="stw-btn secondary" onClick={close}>Cancel</button><button type="button" className="stw-btn primary" onClick={() => setStep("plan")}>Continue</button></>;
    }
  } else if (step === "plan" && holdings) {
    const crmN = plan.filter((x) => writerOf(x.item) === "crm").length;
    const by = new Map<string, number>();
    for (const x of plan) by.set(x.to, (by.get(x.to) ?? 0) + 1);
    const un = movable.length - plan.length;
    title = plan.length ? `Hand over, then remove ${name}` : `Remove ${name} from ${opened.current.tenantName}?`;
    description = "Check what happens, in order.";
    body = <>
      <ol className="stw-steps">
        {plan.length > 0 && <li><div><strong>Hand over {plan.length} {plan.length === 1 ? "thing" : "things"}, one at a time</strong>
          <ul className="stw-to">{[...by.entries()].map(([to, n]) => <li key={to}>{n} to {nameFor(to)}</li>)}</ul>
          <p>Each change saves on its own, the same way Operations saves it. If one fails, the others still save, and you can retry it.</p>
          {crmN > 0 && <p>{crmN === plan.length ? (crmN === 1 ? "It asks" : "Each asks") : `${crmN} of them (clients, deals and CRM tasks) ask`} you to confirm the change before it saves.</p>}</div></li>}
        <li><div><strong>Remove {name}</strong><p>{first}'s access to {opened.current.tenantName} ends right away. Their Team Hub messages stay, shown as from a former teammate. Their Paige account isn't deleted; to bring them back, send a new invitation.</p></div></li>
      </ol>
      {(un > 0 || approvals.length > 0 || mailbox) && <section className="stw-stay" aria-labelledby="stw-stay-h"><h3 id="stw-stay-h">What stays with {first}</h3><ul className="stw-summary">
        {un > 0 && <li><ArrowRight aria-hidden="true" /><span>{un} {un === 1 ? "thing" : "things"} you chose not to hand over {un === 1 ? "keeps" : "keep"} {first}'s name.<span className="stw-sub">In Operations, work shows “Member unavailable”.</span></span></li>}
        {approvals.length > 0 && <li data-tone="warn"><AlertTriangle aria-hidden="true" /><span>{approvals.length === 1 ? "1 approval stays" : `${approvals.length} approvals stay`} assigned to {first} and waiting.<span className="stw-sub">Nothing can hand an approval over yet, and once {first} leaves it won't show on anyone's Game Plan approvals card.</span></span></li>}
        {mailbox && <li><Mail aria-hidden="true" /><span>{mailbox.address ?? mailbox.label} stays connected and keeps receiving mail.<span className="stw-sub">Nobody here can read or send from it. {member.permission === "admin" ? `Only ${first} could disconnect it, and only before leaving; after removal no one can.` : "No one can disconnect it: only an admin can disconnect their own mailbox."}</span></span></li>}
      </ul></section>}
      {removalStatus}
    </>;
    foot = <><button type="button" className="stw-btn secondary" onClick={() => setStep("review")} disabled={busy}>Back</button>{plan.length
      ? <button type="button" className="stw-btn primary" disabled={blocked} onClick={startRun}>Start hand-over</button>
      : removeButton()}</>;
  } else if (step === "run") {
    const saved = run.filter((r) => r.state === "saved").length;
    const need = run.filter((r) => r.state === "confirm").length;
    const bad = run.filter((r) => ["failed", "changed", "expired"].includes(r.state)).length;
    const saving = run.some((r) => r.state === "saving" || r.state === "checking");
    const left = run.length - saved;
    title = `Hand over, then remove ${name}`;
    description = `Each change saves on its own. ${first} stays on the team until you remove them.`;
    body = <>
      <div className="stw-tally"><div><strong>{saved} of {run.length} saved</strong><small>{[need ? `${need} ${need === 1 ? "needs" : "need"} your confirmation` : "", bad ? `${bad} didn't save` : "", saving ? "saving one at a time…" : ""].filter(Boolean).join(" · ") || "Every change saved."}</small>
        <div className="stw-bar" aria-hidden="true"><i style={{ transform: `scaleX(${run.length ? saved / run.length : 0})` }} /></div></div></div>
      <ul className="stw-runlist" aria-label="Hand-over changes">{run.map((r) => {
        const k = itemKey(r.item);
        const [icon, word] = CHIP[r.state];
        const t = titleOf(r.item);
        const to = nameFor(r.to);
        return <li key={k} tabIndex={-1}>
          <div><strong>{t}</strong><small>{KIND[r.item.kind].label} → {to}</small></div>
          <span className="stw-chip" data-s={r.state}>{icon}{word}</span>
          {r.state === "confirm" && <div className="stw-detail"><p>{r.item.kind === "crm_tasks" ? `Assign the CRM task “${t}” to ${to}.` : r.item.kind === "clients" ? (r.item.relation === "assigned" ? `Assign the client ${t.replace(/\.+$/, "")} to ${to}.` : `Make ${to} the lead owner of ${t.replace(/\.+$/, "")}.`) : `Make ${to} the owner of the deal “${t}”.`}</p>
            <button type="button" className="stw-btn primary" disabled={blocked || saving} onClick={() => void confirmRow(k)}>Confirm</button></div>}
          {r.state === "failed" && <div className="stw-detail" data-tone="bad"><p>{r.message ?? "This change didn't save. Check your connection and retry; the others aren't affected."}</p>
            {!r.gone && <button type="button" className="stw-btn secondary" disabled={blocked || saving} onClick={() => retryRow(k, false)}><RefreshCw aria-hidden="true" />Retry</button>}</div>}
          {r.state === "changed" && <div className="stw-detail" data-tone="bad"><p>{r.message ?? "Someone changed this after you opened the review, so nothing was saved. Check again reads the latest and tries once more."}</p>
            <button type="button" className="stw-btn secondary" disabled={blocked || saving} onClick={() => void checkAgain(k)}><RefreshCw aria-hidden="true" />Check again</button></div>}
          {r.state === "expired" && <div className="stw-detail" data-tone="bad"><p>The confirmation expired before it was confirmed, so nothing was saved.</p>
            <button type="button" className="stw-btn secondary" disabled={blocked || saving} onClick={() => retryRow(k, true)}>Prepare it again</button></div>}
        </li>;
      })}</ul>
      {removalStatus}
    </>;
    const lead = saving ? "Saving one change at a time…" : left ? `${left} ${left === 1 ? "change hasn't" : "changes haven't"} finished. If you remove ${first} now, ${left === 1 ? "it stays" : "they stay"} with ${first}.` : "Every change saved.";
    foot = <><span className="stw-lead" data-tone={left && !saving ? "warn" : undefined}>{lead}</span><button type="button" className="stw-btn secondary" onClick={close} disabled={busy}>Close</button>{removeButton()}</>;
  }

  return <Modal variant="drawer" title={title} description={description} busy={busy} onClose={close} titleRef={titleRef}>
    {blocked && <p className="stw-alert" role="status">This review is paused until the original workspace is confirmed. A request already in progress can still return its result.</p>}
    <p className="sr-only" role="status" aria-live="polite">{spoken}</p>
    <div className="stw-drawer-body">{body}</div>
    <footer className="stw-modal-actions">{foot}</footer>
  </Modal>;
}

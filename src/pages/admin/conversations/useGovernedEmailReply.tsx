// The email reply's inline check (EXP03 O12 piece 3, owner-approved option B (ii), 2026-10-27).
//
// Send on an email reply no longer posts to send-message with a 30-second undo. It asks the governed
// email door (comms-email-command) to CHECK the email: the door resolves who it goes to and who it
// comes from on the server and binds the owner's yes to these exact words, files and time. The
// composer's action row becomes that check, in place; "Send now" (or "Schedule send") spends it.
// You confirm before, not undo after.
//
//   composing ─Send─▶ checking ─202─▶ check ─Send now─▶ sending ─▶ composing (cleared) | check | cant
//                        ├─409 sender choice─▶ choose ─pick─▶ checking
//                        └─refused / setup / files / offline─▶ cant (words kept)
//   check ─10 min─▶ expired ─Check again─▶ checking          any change to the words ─▶ composing
//
// The door never sends twice: one operation id per exact email (same words → same id → a replay,
// never a second send), settled once its answer is final. A late answer from another business, an
// older thread, or words that have since changed is dropped, never painted.
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject, type RefObject } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { AccountEpochToken } from "./solo/soloConversationModel";
import type { Attachment } from "./inbox-shared";
import {
  LOCAL_COPY, buildGovernedReplyRequest, createGovernedOperationIds, checkGovernedSendAt, classifyDoorAnswer, governedReplyFiles,
  doorAnswered, governedReplyScope, governedReplySourceKey, isFailed, readDoorAnswer, sendAtProblemCopy,
  type DoorAnswer, type DoorView, type GovernedReplyDraft, type GovernedReplyRequest, type ReadyCheck, type StripAction,
} from "./governedReply";
import { GovernedReplyStrip, type GovernedStripState } from "./GovernedReplyStrip";
import { parseCommsEmailDraftSource, type CommsEmailDraftSource } from "../../../../supabase/functions/_shared/comms-email/draft-source.ts";

export interface GovernedReplyConnector { id: string; display_name: string | null; from_address: string | null }

export interface GovernedEmailReplyInput {
  activeTenantId: string | null;
  /** The tenant the session resolved (current_user_tenant_id) — must equal the account on screen. */
  tenantIdRef: MutableRefObject<string | null>;
  threadKey: string | null;
  contactId: string | null;
  contactName: string;
  connectorId: string;
  connectors: readonly GovernedReplyConnector[];
  subject: string;
  /** governedReplyText(): the reply plus the plain-text signature when it is on. */
  text: string;
  attachments: readonly Attachment[];
  scheduledFor: string | null;
  /** Saved source only. Null refuses locally; absence retains the fresh-reply path. */
  draftSource?: CommsEmailDraftSource | null;
  draftApprovalId?: string;
  epoch: { capture: () => AccountEpochToken; accept: (t: AccountEpochToken) => boolean };
  /** The element around the composer: focus targets are found inside it. */
  composerRef: RefObject<HTMLElement | null>;
  settingsHref: string;
  /** The sender the owner picked from a choice: the parent selects it; the check runs again. */
  onChooseSender: (connectorId: string) => void;
  /** A definite send (accepted or scheduled): the parent clears the composer and re-reads the thread. */
  onRecorded: (r: { outcome: string; contactId: string; already: boolean }) => void;
  /** A confirm's answer that keeps the words (unknown, failed, refused): the thread re-reads, so the row the
   *  server may have written (Couldn't confirm, Failed, Not sent) shows without waiting for realtime. */
  onRefresh?: () => void;
  onDraftSaved?: (saved:{source:CommsEmailDraftSource;attachments:Attachment[]})=>void;
}

type Phase = "composing" | "checking" | "check" | "sending" | "choose" | "cant" | "expired";
type Held = { scope: string; draft: GovernedReplyDraft; request: GovernedReplyRequest };
type Focus = "confirm" | "edit" | "first-option" | "recheck" | "settings" | "body" | "send";

const OPEN: ReadonlySet<Phase> = new Set(["check", "sending", "choose", "cant", "expired"]);

export function useGovernedEmailReply(input: GovernedEmailReplyInput) {
  const [phase, setPhase] = useState<Phase>("composing");
  const [check, setCheck] = useState<ReadyCheck | null>(null);
  const [cantView, setCantView] = useState<Extract<DoorView, { kind: "cant" }> | null>(null);
  const [offline, setOffline] = useState(false);
  const [senders, setSenders] = useState<{ connectorId: string; fromAddress: string }[]>([]);
  const [announcement, setAnnouncement] = useState({ text: "", n: 0 });

  const phaseRef = useRef<Phase>("composing");
  const heldRef = useRef<Held | null>(null);
  const seqRef = useRef(0);
  const inFlightRef = useRef(false);
  const expiryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusRef = useRef<Focus | null>(null);
  const recheckOnScopeRef = useRef(false);
  const idsRef = useRef(createGovernedOperationIds());
  const inputRef = useRef(input);
  inputRef.current = input;
  type SaveAttempt={identity:string;epoch:AccountEpochToken;request:GovernedReplyRequest & {save_draft:true};busy:boolean;uncertain:boolean};
  const saveRef=useRef<SaveAttempt|null>(null);
  const [saveState,setSaveState]=useState<{attempt:SaveAttempt;busy:boolean;uncertain:boolean}|null>(null);
  const saveIdentity=JSON.stringify([input.activeTenantId,input.threadKey,input.draftSource?.message_id,input.epoch.capture()]);
  const saveIdentityRef=useRef(saveIdentity);saveIdentityRef.current=saveIdentity;
  const activeSave=saveState?.attempt.identity===saveIdentity?saveState:null;
  const [saveNotice,setSaveNotice]=useState<{identity:string;scope:string;text:string}|null>(null);

  const go = (next: Phase) => { phaseRef.current = next; setPhase(next); };
  const say = (text: string) => setAnnouncement((a) => ({ text, n: a.n + 1 }));
  const clearExpiry = () => { if (expiryRef.current) { clearTimeout(expiryRef.current); expiryRef.current = null; } };

  /** The email as it stands now, or the local reason it cannot be checked (no call is made). */
  const currentDraft = useCallback((): { draft: GovernedReplyDraft } | { view: DoorView; offline?: boolean } => {
    const i = inputRef.current;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return { view: LOCAL_COPY.offline(), offline: true };
    if (!i.contactId) return { view: LOCAL_COPY.noContact(i.contactName) };
    if (!i.activeTenantId || i.activeTenantId !== i.tenantIdRef.current) return { view: LOCAL_COPY.reopen() };
    const files = governedReplyFiles(i.activeTenantId, i.attachments);
    if (!files.ok) return { view: "refused" in files ? LOCAL_COPY.refusedFiles(files.refused) : LOCAL_COPY.filesTooLarge() };
    let sendAt: string | undefined;
    if (i.scheduledFor) {
      const at = checkGovernedSendAt(i.scheduledFor, Date.now());
      if (isFailed(at)) return { view: sendAtProblemCopy(at.why) };
      sendAt = at.sendAt;
    }
    return { draft: { tenantId: i.activeTenantId, contactId: i.contactId, connectorId: i.connectorId, subject: i.subject.trim(), text: i.text, ...(sendAt ? { sendAt } : {}), paths: files.paths,
      ...(i.draftSource !== undefined ? { source: i.draftSource } : {}),
      ...(i.draftApprovalId !== undefined ? { approvalId: i.draftApprovalId } : {}) } };
  }, []);

  const saveDraft=async()=>{
    const i=inputRef.current;
    if(!i.onDraftSaved||!i.draftSource||phaseRef.current!=="composing")return;
    let attempt=saveRef.current?.identity===saveIdentityRef.current?saveRef.current:null;
    if(attempt?.busy)return;
    if(!attempt){
      const built=currentDraft();
      if(!("draft" in built)||!built.draft.source){say("Check the subject, message, files and time before saving this draft.");return;}
      if(idsRef.current.isUnknown(governedReplyScope(built.draft),governedReplySourceKey(built.draft))){say("Check this draft's sending status before saving changes.");return;}
      const request=buildGovernedReplyRequest(built.draft,crypto.randomUUID());
      if(isFailed(request)){say("Reopen this draft before saving changes.");return;}
      attempt={identity:saveIdentityRef.current,epoch:i.epoch.capture(),request:{...request.request,save_draft:true},busy:false,uncertain:false};
      saveRef.current=attempt;
    }
    const held=attempt,current=()=>saveRef.current===held&&saveIdentityRef.current===held.identity&&inputRef.current.epoch.accept(held.epoch);
    held.busy=true;setSaveState({attempt:held,busy:true,uncertain:held.uncertain});
    let answer:DoorAnswer;
    try{answer=await readDoorAnswer(await supabase.functions.invoke("comms-email-command",{body:held.request}));}
    catch{answer={transport:true};}
    if(!current())return;
    held.busy=false;
    const b=doorAnswered(answer)?answer.body:null;
    if(b?.ok===true&&b.outcome==="draft_saved"&&b.operation_id===held.request.operation_id){
      try{
        const source=parseCommsEmailDraftSource(b.draft_source);
        if(source.message_id!==held.request.draft_source?.message_id||!Array.isArray(b.attachments))throw Error("save_receipt_changed");
        const files:Attachment[]=b.attachments.map(raw=>{
          const a=raw as Record<string,unknown>;
          if(!a||typeof a.url!=="string"||typeof a.name!=="string"||typeof a.mime!=="string"||typeof a.size!=="number"||!Number.isFinite(a.size))throw Error("save_files_changed");
          return {url:a.url,name:a.name,mime:a.mime,size:a.size};
        });
        const checked=governedReplyFiles(held.request.expected_tenant_id,files);
        if(isFailed(checked)||JSON.stringify(checked.paths)!==JSON.stringify((held.request.attachments??[]).map(a=>a.path)))throw Error("save_files_changed");
        saveRef.current=null;setSaveState(null);say("Draft saved. Nothing sent.");
        inputRef.current.onDraftSaved?.({source,attachments:files});return;
      }catch{/* An unreadable receipt never clears the original save operation. */}
    }
    if(b?.outcome==="refused"&&!held.uncertain){
      saveRef.current=null;setSaveState(null);
      const text="The draft wasn't saved. Your edits are kept; reopen its current version before trying again.";
      setSaveNotice({identity:held.identity,scope:liveScopeRef.current,text});say(text);return;
    }
    held.uncertain=true;setSaveState({attempt:held,busy:false,uncertain:true});
    const text="Couldn't confirm the draft was saved. Check save status before sending.";
    setSaveNotice({identity:held.identity,scope:liveScopeRef.current,text});say(text);
  };

  // The scope of what is on screen right now. A strip is only ever about the scope it was raised for.
  const liveScope = useMemo(() => {
    const d = currentDraft();
    const local: unknown[] = [input.activeTenantId, input.contactId, input.connectorId, input.subject.trim(), input.text, input.scheduledFor, input.attachments.map((a) => a.url ?? a.name)];
    if (input.draftSource !== undefined) local.push(input.draftSource);
    if (input.draftApprovalId !== undefined) local.push(input.draftApprovalId);
    return "draft" in d ? governedReplyScope(d.draft) : `local:${JSON.stringify(local)}`;
  }, [currentDraft, input.activeTenantId, input.contactId, input.connectorId, input.subject, input.text, input.scheduledFor, input.attachments, input.draftSource, input.draftApprovalId]);
  const stripScopeRef = useRef<string | null>(null);
  const liveScopeRef = useRef(liveScope);
  liveScopeRef.current = liveScope;

  const showCant = (view: Extract<DoorView, { kind: "cant" }>, isOffline = false) => {
    clearExpiry();
    setCantView(view); setOffline(isOffline); go("cant");
    // Focus the most useful next step: Check status / Try again / Check again, the settings link, else Edit.
    focusRef.current = view.action === "settings" ? "settings" : view.action ? "recheck" : "edit";
    say(view.say);
  };

  const finish = (scope: string, view: DoorView, answer: DoorAnswer | null, stage: "check" | "confirm" | "status") => {
    const i = inputRef.current;
    const held = heldRef.current;
    const sourceKey = held ? governedReplySourceKey(held.draft) : undefined;
    if (held?.draft.source && idsRef.current.isUnknown(scope, sourceKey) && view.kind === "cant" && !view.keepId) {
      const body = answer && doorAnswered(answer) ? answer.body : null;
      const originalReceipt = body?.operation_id === held.request.operation_id && body?.message_id === held.draft.source.message_id
        && ["provider_accepted", "scheduled", "failed", "refused"].includes(String(body.outcome));
      // A refusal to check current authority is not proof that an earlier uncertain
      // send failed. Keep that source's original operation until its own receipt resolves.
      if (!originalReceipt) view = LOCAL_COPY.draftStatusUnverified();
    }
    if (view.kind === "ready") {
      // A new readiness check cannot settle an earlier uncertain dispatch. Retain
      // that operation's uncertainty even when this call was made through Send.
      if (idsRef.current.isUnknown(scope, sourceKey)) view = { ...view, check: { ...view.check, uncertain: true } };
      // Focus Edit, never the gold act: a second Enter must not confirm a check nobody has read.
      setCheck(view.check); go("check"); focusRef.current = "edit";
      const act = view.check.when ? "Schedule send" : "Send now";
      say(view.check.uncertain
        ? `Couldn't confirm the last try went out — don't resend unless you're sure it didn't. ${act} is there if it didn't.`
        : stage === "check"
        ? `Ready to send to ${view.check.preview.to_name || i.contactName}. Check To and From, then ${act}.`
        // Check status found no recorded answer: it may still be going out. Never "nothing went out".
        : stage === "status" ? `Couldn't confirm the last try went out — don't resend unless you're sure it didn't. ${act} is there if it didn't.`
        : `Checked again — confirm with ${act}.`);
      clearExpiry();
      const wait = view.check.deadlineMs - 5_000 - Date.now();
      expiryRef.current = setTimeout(() => {
        expiryRef.current = null;
        if (phaseRef.current !== "check") return;
        const onConfirm = (document.activeElement as HTMLElement | null)?.dataset?.stripFocus === "confirm";
        go("expired"); if (onConfirm) focusRef.current = "recheck";
        say("This check expired. Check again before sending.");
      }, Math.max(0, wait));
      return;
    }
    if (view.kind === "choose") {
      setSenders(view.senders); go("choose"); focusRef.current = "first-option";
      say(`Pick who this comes from. ${view.senders.length} senders are available.`);
      return;
    }
    if (view.kind === "recorded") {
      idsRef.current.settle(scope, sourceKey);
      clearExpiry(); heldRef.current = null; stripScopeRef.current = null;
      go("composing"); setCheck(null); focusRef.current = "body"; say(view.say);
      if (held) i.onRecorded({ outcome: view.outcome, contactId: held.draft.contactId, already: view.already });
      return;
    }
    // No definite answer: the id is kept for good, so these words always ask about THIS operation.
    // Otherwise nothing went out: a final answer spends the id; so does a conflict (it can never succeed as is).
    const conflict = !!answer && doorAnswered(answer) && answer.status === 409;
    if (view.keepId && held) idsRef.current.markUnknown(scope, held.request.operation_id, sourceKey);
    else if (view.settle || conflict) idsRef.current.settle(scope, sourceKey);
    showCant(view);
    if (stage !== "check") i.onRefresh?.();
  };

  /** One door call. Every answer is checked against the call that asked: same business, same request. */
  const ask = async (held: Held, stage: "check" | "confirm" | "status") => {
    const i = inputRef.current;
    const seq = ++seqRef.current;
    const token = i.epoch.capture();
    inFlightRef.current = true;
    let raw: { data?: unknown; error?: unknown; response?: unknown };
    try { raw = await supabase.functions.invoke("comms-email-command", { body: held.request }); }
    catch (error) { raw = { data: null, error }; }
    let answer: DoorAnswer;
    try { answer = await readDoorAnswer(raw); } catch { answer = { transport: true }; }
    if (seq !== seqRef.current || !inputRef.current.epoch.accept(token)) return; // superseded: dropped, never painted
    inFlightRef.current = false;
    const connector = inputRef.current.connectors.find((c) => c.id === held.request.command.connector_id);
    const view = classifyDoorAnswer(answer, stage, held.request,
      { name: inputRef.current.contactName, from: connector?.from_address || connector?.display_name || "" }, Date.now());
    finish(held.scope, view, answer, stage);
  };

  /** Send: check the email as it stands now. */
  const runCheck = useCallback(async () => {
    if(saveRef.current?.identity===saveIdentityRef.current){say("Check the draft's save status before sending.");return;}
    if (phaseRef.current === "checking" || phaseRef.current === "sending" || inFlightRef.current) return;
    const d = currentDraft();
    stripScopeRef.current = liveScopeRef.current;
    heldRef.current = null;
    if (!("draft" in d)) { if (d.view.kind === "cant") showCant(d.view, !!d.offline); return; }
    const scope = governedReplyScope(d.draft);
    const built = buildGovernedReplyRequest(d.draft, idsRef.current.idFor(scope, governedReplySourceKey(d.draft)));
    if (isFailed(built)) {
      const view = built.problem === "subject" ? LOCAL_COPY.subjectTooLong() : built.problem === "body" ? LOCAL_COPY.bodyTooLong()
        : built.problem === "sender" ? LOCAL_COPY.badSender() : built.problem === "contact" ? LOCAL_COPY.badContact(inputRef.current.contactName)
        : built.problem === "source" ? LOCAL_COPY.reopenDraft() : LOCAL_COPY.cantBuild();
      if (view.kind === "cant") showCant(view);
      return;
    }
    heldRef.current = { scope, draft: d.draft, request: built.request };
    stripScopeRef.current = scope;
    clearExpiry(); go("checking");
    await ask(heldRef.current, "check");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentDraft]);
  const runCheckRef = useRef(runCheck);
  runCheckRef.current = runCheck;

  /** Send now / Schedule send: spend the fingerprint the check returned, on the exact same call. */
  const confirm = () => {
    const held = heldRef.current;
    if (phaseRef.current !== "check" || !held || !check || inFlightRef.current) return;
    clearExpiry(); go("sending");
    void ask({ ...held, request: { ...held.request, approved_fingerprint: check.fingerprint } }, "confirm");
  };

  /** Re-ask about the SAME operation without a fingerprint: a fresh check, or its recorded result. */
  const reask = (stage: "check" | "status") => {
    const held = heldRef.current;
    if (!held || inFlightRef.current) return;
    const { approved_fingerprint: _spent, ...request } = held.request;
    heldRef.current = { ...held, request };
    clearExpiry(); go("checking"); focusRef.current = "send";
    void ask(heldRef.current, stage);
  };

  const close = useCallback((how: "edit" | "typing" | "reset") => {
    const was = phaseRef.current;
    const held = heldRef.current;
    const uncertain = held && idsRef.current.isUnknown(held.scope, governedReplySourceKey(held.draft));
    seqRef.current += 1; inFlightRef.current = false; clearExpiry();
    if (was === "composing") return;
    stripScopeRef.current = null; recheckOnScopeRef.current = false;
    go("composing"); setCheck(null); setCantView(null);
    if (how === "edit") focusRef.current = "body";
    if ((was === "check" || was === "expired") && how !== "reset") say(uncertain
      ? "Check closed. The earlier send is still unconfirmed. Check its status before sending again."
      : "Check closed. Nothing was sent.");
  }, []);

  const onAction = (action: StripAction) => {
    if (action === "retry") { close("reset"); focusRef.current = "send"; void runCheckRef.current(); return; }
    // An expired check asks again about the SAME operation (nothing happened to it). A "check again"
    // after a confirm was refused starts afresh: that operation's answer is final, and re-asking it
    // would only replay the refusal.
    if (action === "recheck") {
      if (phaseRef.current === "expired" && heldRef.current && liveScopeRef.current === heldRef.current.scope) reask("check");
      else { close("reset"); focusRef.current = "send"; void runCheckRef.current(); }
      return;
    }
    if (action === "check_status") reask("status");
  };

  const onChooseSender = (connectorId: string) => {
    if (connectorId === inputRef.current.connectorId) { close("reset"); void runCheckRef.current(); return; }
    recheckOnScopeRef.current = true;
    inputRef.current.onChooseSender(connectorId);
  };

  // Any change to what would be sent closes the strip (the approval is bound to the exact words);
  // focus stays where the owner is typing. A sender picked from the choice runs the check again.
  useEffect(() => {
    const p = phaseRef.current;
    if (p === "composing" || p === "sending" || stripScopeRef.current === null || stripScopeRef.current === liveScope) return;
    if (recheckOnScopeRef.current && p === "choose") {
      recheckOnScopeRef.current = false; close("reset"); void runCheckRef.current(); return;
    }
    close("typing");
  }, [liveScope, close]);

  // A different business or conversation: whatever was open is gone, silently. Nothing was sent.
  useEffect(() => {
    close("reset"); heldRef.current = null;
    return () => { seqRef.current += 1; clearExpiry(); };
  }, [input.activeTenantId, input.threadKey, close]);
  useEffect(() => { idsRef.current.clearPending(); }, [input.activeTenantId]);
  useEffect(()=>{
    if(saveRef.current&&saveRef.current.identity!==saveIdentity){saveRef.current=null;setSaveState(null);setSaveNotice(null);}
  },[saveIdentity]);

  // Focus follows the strip (§70: keyboard users land on the next thing to do).
  useEffect(() => {
    const target = focusRef.current;
    if (!target) return;
    focusRef.current = null;
    const root = inputRef.current.composerRef.current;
    if (!root) return;
    if (target === "body") {
      const ta = root.querySelector<HTMLTextAreaElement>('[data-composer-writing-surface="true"] textarea');
      if (ta) { ta.focus({ preventScroll: true }); ta.setSelectionRange(ta.value.length, ta.value.length); }
      return;
    }
    const el = target === "send" ? root.querySelector<HTMLElement>("[data-composer-send]") : root.querySelector<HTMLElement>(`[data-strip-focus="${target}"]`);
    el?.focus({ preventScroll: true });
  });

  const connectorName = (id: string | null) => {
    const c = input.connectors.find((x) => x.id === id);
    return c?.display_name?.trim() || c?.from_address || "Email";
  };

  let stripState: GovernedStripState | null = null;
  if ((phase === "check" || phase === "sending") && check && heldRef.current) {
    stripState = { phase: "check", check, fromName: connectorName(heldRef.current.request.command.connector_id), sending: phase === "sending" };
  } else if (phase === "choose") {
    stripState = { phase: "choose", senders: senders.map((s) => ({ ...s, name: connectorName(s.connectorId) })) };
  } else if (phase === "expired") {
    stripState = { phase: "expired", busy: false };
  } else if (phase === "cant" && cantView) {
    stripState = { phase: "cant", view: cantView, offline, busy: false };
  }

  const actions = stripState ? (
    <GovernedReplyStrip
      state={stripState}
      onEdit={() => { if (phaseRef.current !== "sending") close("edit"); }}
      onConfirm={confirm}
      onAction={onAction}
      onChooseSender={onChooseSender}
      settingsHref={input.settingsHref}
    />
  ) : null;

  const liveRegion = (
    <p className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-governed-reply-status="">
      <span key={announcement.n}>{announcement.text}</span>
    </p>
  );

  return {
    phase,
    saveDraft,
    savingDraft:activeSave?.busy===true,
    saveUnconfirmed:activeSave?.uncertain===true,
    draftSaveNote:saveNotice?.identity===saveIdentity&&saveNotice.scope===liveScope?saveNotice.text:undefined,
    /** Send on an email reply. */
    check: runCheck,
    /** Edit / Esc: close the strip and put the caret back at the end of the reply. */
    closeStrip: () => { if (phaseRef.current !== "sending") close("edit"); },
    stripOpen: OPEN.has(phase),
    checking: phase === "checking",
    /** The confirm is out: the words stay exactly as approved until it answers. */
    blocksEditing: phase === "sending" || !!activeSave,
    /** A check is running, shown, or being confirmed: the staged files stay exactly as checked. */
    filesLocked: phase === "checking" || phase === "check" || phase === "sending" || !!activeSave,
    actions,
    liveRegion,
  };
}

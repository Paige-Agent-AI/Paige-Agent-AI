import { useCallback, useSyncExternalStore, type SetStateAction } from "react";

import { composerScopeIdentityKey, createComposerScopeIdentity, type ComposerScopeIdentity } from "./paigeComposerScopeIdentity.ts";
import type {ChatKnowledgeIntakeSelection} from './paige-chat-knowledge-service';
export { COMPOSER_FOCUS_NONE, COMPOSER_SCOPE_FIELDS, composerScopeIdentityKey, createComposerScopeIdentity, type ComposerScopeIdentity, type ComposerScopeFieldCoverage } from "./paigeComposerScopeIdentity.ts";

export type ComposerConversation =
  | Readonly<{ kind: "new"; id: string }>
  | Readonly<{ kind: "thread"; id: string }>;

export type ComposerConversationIntent = "initial" | "automatic" | "explicit" | "controlled" | "static";
export type ComposerHistoryStatus = "not-required" | "pending" | "settled";

export type ComposerConversationState = Readonly<{
  history: ComposerHistoryStatus;
  newConversationId: string;
  requested: ComposerConversation;
  displayed: ComposerConversation;
  intent: ComposerConversationIntent;
}>;

export type ComposerConversationEvent =
  | Readonly<{ type: "history-confirmed-empty" }>
  | Readonly<{ type: "new-chat-requested" }>
  | Readonly<{
      type: "thread-requested";
      id: string;
      intent: Extract<ComposerConversationIntent, "automatic" | "explicit" | "controlled">;
    }>
  | Readonly<{ type: "thread-loaded"; id: string }>
  | Readonly<{ type: "thread-load-failed"; id: string }>
  | Readonly<{ type: "lazy-thread-created"; id: string }>;

export const NEW_CHAT_CONVERSATION: ComposerConversation = Object.freeze({
  kind: "new",
  id: "new-chat",
});

export function initialComposerConversation(
  historyRequired: boolean,
  newConversationId = NEW_CHAT_CONVERSATION.id,
): ComposerConversationState {
  const newConversation = { kind: "new" as const, id: newConversationId };
  return {
    history: historyRequired ? "pending" : "not-required",
    newConversationId,
    requested: newConversation,
    displayed: newConversation,
    intent: historyRequired ? "initial" : "static",
  };
}

export function transitionComposerConversation(
  current: ComposerConversationState,
  event: ComposerConversationEvent,
): ComposerConversationState {
  switch (event.type) {
    case "history-confirmed-empty":
      return {
        history: "settled",
        newConversationId: current.newConversationId,
        requested: { kind: "new", id: current.newConversationId },
        displayed: { kind: "new", id: current.newConversationId },
        intent: "initial",
      };
    case "new-chat-requested":
      return {
        history: "settled",
        newConversationId: current.newConversationId,
        requested: { kind: "new", id: current.newConversationId },
        displayed: { kind: "new", id: current.newConversationId },
        intent: "explicit",
      };
    case "thread-requested":
      return {
        ...current,
        history: "settled",
        requested: { kind: "thread", id: event.id },
        intent: event.intent,
      };
    case "thread-loaded":
      if (current.requested.kind !== "thread" || current.requested.id !== event.id) return current;
      return {
        ...current,
        history: "settled",
        displayed: current.requested,
      };
    case "thread-load-failed":
      if (current.requested.kind !== "thread" || current.requested.id !== event.id) return current;
      return {
        ...current,
        history: "settled",
        requested: current.displayed,
        intent: current.displayed.kind === "new" ? "explicit" : "controlled",
      };
    case "lazy-thread-created": {
      if (current.requested.kind !== "new" || current.displayed.kind !== "new") return current;
      const persisted = { kind: "thread" as const, id: event.id };
      return {
        history: "settled",
        newConversationId: current.newConversationId,
        requested: persisted,
        displayed: persisted,
        intent: "explicit",
      };
    }
  }
}

export type ComposerDraftHandle = Readonly<ComposerScopeIdentity & {
  conversationId: string;
}>;

export type ComposerScopeStatus =
  | "identity-unresolved"
  | "history-unresolved"
  | "hydrating"
  | "ready-new"
  | "ready-thread";

export type ComposerScopeResolverInput = Readonly<{
  currentIdentity: ComposerScopeIdentity | null;
  displayedIdentity: ComposerScopeIdentity | null;
  conversation: ComposerConversationState;
  busy: boolean;
  /** Solo text remains editable while its interactive generation works. */
  allowWhileBusy?: boolean;
}>;

export type ComposerScopeState = Readonly<{
  status: ComposerScopeStatus;
  writable: boolean;
  visibleHandle: ComposerDraftHandle | null;
  writableHandle: ComposerDraftHandle | null;
  unavailableReason: string | null;
}>;

function identitiesMatch(
  left: ComposerScopeIdentity | null,
  right: ComposerScopeIdentity | null,
): left is ComposerScopeIdentity {
  return left !== null
    && right !== null
    && left.tenantId === right.tenantId
    && left.userId === right.userId
    && left.focusedClientId === right.focusedClientId
    && left.focusedBusinessMissionId === right.focusedBusinessMissionId;
}

function conversationMatches(left: ComposerConversation, right: ComposerConversation): boolean {
  return left.kind === right.kind && left.id === right.id;
}

function handleFor(identity: ComposerScopeIdentity, conversation: ComposerConversation): ComposerDraftHandle {
  return {
    ...identity,
    conversationId: conversation.id,
  };
}

/**
 * The sole writability resolver for the PaigeAIChat family (tenant workspace,
 * tenant-less platform desk, and Solo). It is deliberately pure: render-time
 * facts enter, one complete state leaves. A transition may
 * keep the currently displayed draft visible, but only a fully matching ready
 * state receives a writable handle.
 */
export function resolveComposerScopeState(input: ComposerScopeResolverInput): ComposerScopeState {
  const { currentIdentity, displayedIdentity, conversation, busy } = input;

  if (!currentIdentity || !displayedIdentity) {
    return {
      status: "identity-unresolved",
      writable: false,
      visibleHandle: null,
      writableHandle: null,
      unavailableReason: "Resolving the conversation before you can write to PAIGE.",
    };
  }

  if (!identitiesMatch(currentIdentity, displayedIdentity)) {
    return {
      status: "hydrating",
      writable: false,
      visibleHandle: null,
      writableHandle: null,
      unavailableReason: "Switching to the selected conversation before you can write to PAIGE.",
    };
  }

  const visibleHandle = handleFor(displayedIdentity, conversation.displayed);

  if (conversation.history === "pending" && conversation.intent === "initial") {
    return {
      status: "history-unresolved",
      writable: false,
      visibleHandle,
      writableHandle: null,
      unavailableReason: "Loading your conversations before you can write to PAIGE.",
    };
  }

  if (!conversationMatches(conversation.requested, conversation.displayed)) {
    return {
      status: "hydrating",
      writable: false,
      visibleHandle,
      writableHandle: null,
      unavailableReason: "Opening the selected conversation before you can write to PAIGE.",
    };
  }

  const status: ComposerScopeStatus = conversation.requested.kind === "new"
    ? "ready-new"
    : "ready-thread";
  const readyHandle = handleFor(currentIdentity, conversation.requested);
  const writable = !busy || input.allowWhileBusy === true;

  return {
    status,
    writable,
    visibleHandle: readyHandle,
    writableHandle: writable ? readyHandle : null,
    unavailableReason: writable ? null : "PAIGE is finishing the current response.",
  };
}

export function composerDraftHandlesMatch(
  left: ComposerDraftHandle | null,
  right: ComposerDraftHandle | null,
): boolean {
  return left !== null
    && right !== null
    && left.tenantId === right.tenantId
    && left.userId === right.userId
    && left.focusedClientId === right.focusedClientId
    && left.focusedBusinessMissionId === right.focusedBusinessMissionId
    && left.conversationId === right.conversationId;
}

export type ComposerRequestTicket = Readonly<{
  generation: number;
  scopeHandle: ComposerDraftHandle;
  scopeEpoch: string;
  signal: AbortSignal;
}>;

/**
 * One request owner for a composer mount. A ticket is deliverable only while
 * its generation, full draft handle, and render-time epoch still name the
 * conversation currently requested by that mount.
 */
export function createComposerRequestFence() {
  let generation = 0;
  let controller: AbortController | null = null;
  let busyGeneration: number | null = null;

  const ticket = (
    scopeHandle: ComposerDraftHandle,
    scopeEpoch: string,
    signal: AbortSignal,
  ): ComposerRequestTicket => ({ generation, scopeHandle, scopeEpoch, signal });

  return {
    begin(scopeHandle: ComposerDraftHandle, scopeEpoch: string): ComposerRequestTicket {
      controller?.abort();
      controller = new AbortController();
      generation += 1;
      return ticket(scopeHandle, scopeEpoch, controller.signal);
    },
    rebind(
      current: ComposerRequestTicket,
      scopeHandle: ComposerDraftHandle,
      scopeEpoch: string,
    ): ComposerRequestTicket {
      if (current.signal.aborted || current.generation !== generation) return current;
      return ticket(scopeHandle, scopeEpoch, current.signal);
    },
    claimBusy(current: ComposerRequestTicket): boolean {
      if (current.signal.aborted || current.generation !== generation) return false;
      busyGeneration = current.generation;
      return true;
    },
    releaseBusy(current: ComposerRequestTicket): boolean {
      if (busyGeneration !== current.generation) return false;
      busyGeneration = null;
      return true;
    },
    invalidate(): boolean {
      const releasedBusy = busyGeneration !== null;
      busyGeneration = null;
      generation += 1;
      controller?.abort();
      controller = null;
      return releasedBusy;
    },
    isCurrent(
      current: ComposerRequestTicket,
      scopeHandle: ComposerDraftHandle | null,
      scopeEpoch: string,
    ): boolean {
      return !current.signal.aborted
        && current.generation === generation
        && current.scopeEpoch === scopeEpoch
        && composerDraftHandlesMatch(current.scopeHandle, scopeHandle);
    },
  };
}

export function acceptComposerDelivery(
  captured: ComposerDraftHandle,
  current: ComposerScopeState,
): boolean {
  return current.writable && composerDraftHandlesMatch(captured, current.writableHandle);
}

export function normalizeComposerSubmission(value: string): string {
  return value.trim();
}

export function shouldClearComposerDraft(input: Readonly<{
  terminalDone: boolean;
  currentDraft: string;
  submittedText: string;
}>): boolean {
  return input.terminalDone
    && normalizeComposerSubmission(input.currentDraft) === normalizeComposerSubmission(input.submittedText);
}

type Listener = () => void;
const drafts = new Map<string, string>();
// Recovery pointers within the original composer cache, never source content,
// effect results, approval or a replay queue. Native Work remains authoritative.
const knowledgeIntakes = new Map<string, Readonly<ChatKnowledgeIntakeSelection> | null>();
const draftRevisions = new Map<string, number>();
const listeners = new Map<string, Set<Listener>>();

/** Optional same-tab recovery, disabled until the canonical account context binds it.
 * This is not authentication, business Memory, attachment storage or a send queue.
 * The caller must supply the actual subject, never an effective/impersonated user.
 */
export type ComposerDraftSessionScope =
  | Readonly<{ kind: "ready"; tenantId: string; userId: string }>
  | Readonly<{ kind: "unresolved" | "clear" }>;

const DRAFT_SESSION_KEY = "paige.composer.drafts.v1";
const DRAFT_SESSION_TTL = 24 * 60 * 60 * 1000;
const DRAFT_SESSION_LIMIT = 8;
const DRAFT_TEXT_LIMIT = 20_000;
const DRAFT_CACHE_LIMIT = 200_000;
type SessionOwner = Readonly<{ tenantId: string; userId: string }>;
type SessionDraft = Readonly<{ key: string; text: string; updatedAt: number; knowledgeIntake?: Readonly<ChatKnowledgeIntakeSelection> }>;
const knowledgeWorkIdValid = (value: unknown): value is string => typeof value === 'string'
  && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
function knowledgeIntakeValid(value: unknown): value is ChatKnowledgeIntakeSelection {
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const v=value as Record<string,unknown>;
  return Object.keys(v).length===7&&knowledgeWorkIdValid(v.extractionWorkId)&&knowledgeWorkIdValid(v.documentId)
    &&knowledgeWorkIdValid(v.extractionIntentId)&&typeof v.sourceSha256==='string'&&/^[a-f0-9]{64}$/.test(v.sourceSha256)
    &&(v.expectedSourceRevision===null||(Number.isSafeInteger(v.expectedSourceRevision)&&Number(v.expectedSourceRevision)>0&&Number(v.expectedSourceRevision)<=2147483647))
    &&v.turnId===null&&v.expectedLinkRevision===0;
}
let sessionOwner: SessionOwner | null = null;
const draftTouchedAt = new Map<string, number>();
let persistedDraftKeys = new Set<string>();
// A successful metadata-only write/read establishes this existing cache as safe
// to retain if browser storage later becomes temporarily unreadable.
let knowledgeRecoveryCacheProtected = false;
let sessionReadUnavailable = false;

export type ComposerDraftReloadProtection = "disabled" | "protected" | "unavailable";

function publishPersistedDraftKeys(keys: string[]): void {
  const next = new Set(keys);
  const changed = new Set([...persistedDraftKeys, ...next]);
  const previous = persistedDraftKeys;
  persistedDraftKeys = next;
  for (const key of changed) {
    if (previous.has(key) !== next.has(key)) emit(key);
  }
}

function reloadProtectionForKey(key: string | null): ComposerDraftReloadProtection {
  if (!key || !sessionOwner || !sessionOwns(key, sessionOwner)) return "disabled";
  const age = Date.now() - (draftTouchedAt.get(key) ?? 0);
  return persistedDraftKeys.has(key) && age >= 0 && age < DRAFT_SESSION_TTL ? "protected" : "unavailable";
}

export function readComposerDraftReloadProtection(handle: ComposerDraftHandle): ComposerDraftReloadProtection {
  return reloadProtectionForKey(composerDraftKey(handle));
}

function sessionKeyParts(key: string): string[] | null {
  try {
    const parts: unknown = JSON.parse(key);
    return Array.isArray(parts) && parts.length === 5
      && parts.every((part) => typeof part === "string" && part.length > 0 && part.length <= 200)
      ? parts : null;
  } catch { return null; }
}

function sessionOwns(key: string, owner: SessionOwner): boolean {
  const parts = sessionKeyParts(key);
  return parts?.[0] === owner.tenantId && parts[1] === owner.userId;
}

function knowledgeOnlyCache(owner:SessionOwner): SessionDraft[] | null {
  try{
    const raw=window.sessionStorage.getItem(DRAFT_SESSION_KEY);
    if(!raw||raw.length>DRAFT_CACHE_LIMIT)return null;
    const cache=JSON.parse(raw),seen=new Set<string>(),now=Date.now();
    if(cache?.version!==1||cache.owner?.userId!==owner.userId||!Array.isArray(cache.entries)
      ||!cache.entries.length||cache.entries.length>DRAFT_SESSION_LIMIT)return null;
    for(const entry of cache.entries){
      if(!entry||Object.keys(entry).length!==4||typeof entry.key!=='string'
        ||sessionKeyParts(entry.key)?.[1]!==owner.userId||seen.has(entry.key)||entry.text!==''
        ||!knowledgeIntakeValid(entry.knowledgeIntake)||!Number.isFinite(entry.updatedAt)||entry.updatedAt>now)return null;
      seen.add(entry.key);
    }
    return cache.entries;
  }catch{return null;}
}

function preserveKnowledgeOnlyCache(owner:SessionOwner): boolean {
  if(!sessionReadUnavailable&&!knowledgeRecoveryCacheProtected&&!knowledgeOnlyCache(owner))return false;
  // The remaining cache contains no text that could be resurrected. Retain its
  // native pointers on a later storage failure, while text remains unprotected.
  publishPersistedDraftKeys([]);return true;
}

function discardSessionCache(): void {
  knowledgeRecoveryCacheProtected=false;
  sessionReadUnavailable=false;
  publishPersistedDraftKeys([]);
  try { window.sessionStorage.removeItem(DRAFT_SESSION_KEY); } catch { /* Current memory still works. */ }
}

function persistSessionDrafts(): void {
  if (!sessionOwner) return;
  // An unreadable cold cache may contain an unresolved native effect. Inspect
  // its original owner/contents before replacing or removing it.
  if(sessionReadUnavailable){publishPersistedDraftKeys([]);return;}
  const now = Date.now();
  const entries: SessionDraft[] = [];
  const hasPending=[...knowledgeIntakes].some(([key,value])=>value&&sessionKeyParts(key)?.[1]===sessionOwner!.userId);
  // Reverse edit order also breaks same-millisecond ties in favor of new input.
  const touched = new Map(draftTouchedAt);
  for(const [key,workId] of knowledgeIntakes) if(workId&&!touched.has(key))touched.set(key,now);
  for (const [key, updatedAt] of [...touched].reverse()) {
    const value = drafts.get(key), knowledgeIntake = knowledgeIntakes.get(key);
    // While a native constructor is unresolved, the SAME cache holds only its
    // small recovery metadata. Ordinary text stays editable in memory and the
    // original unload guard truthfully reports that text as unprotected.
    const text = !hasPending&&value&&value.length<=DRAFT_TEXT_LIMIT&&now-updatedAt<DRAFT_SESSION_TTL ? value : '';
    const ownMetadata=knowledgeIntake&&sessionKeyParts(key)?.[1]===sessionOwner.userId;
    if (((text&&sessionOwns(key,sessionOwner))||ownMetadata) && updatedAt <= now) {
      entries.push({ key, text, updatedAt, ...(knowledgeIntake?{knowledgeIntake}:{}) });
    }
  }
  // Do not evict unresolved native pointers in favor of ordinary text drafts.
  entries.sort((a, b) => Number(!!b.knowledgeIntake)-Number(!!a.knowledgeIntake)||b.updatedAt-a.updatedAt);
  try {
    if (entries.length === 0) discardSessionCache();
    else {
      const retained = entries.slice(0, DRAFT_SESSION_LIMIT);
      const serialize = () => JSON.stringify({ version: 1, owner: sessionOwner, entries: retained });
      let raw = serialize();
      while (retained.length && raw.length > DRAFT_CACHE_LIMIT) {
        retained.pop();
        raw = serialize();
      }
      if (retained.length) {
        window.sessionStorage.setItem(DRAFT_SESSION_KEY, raw);
        knowledgeRecoveryCacheProtected=hasPending;
        publishPersistedDraftKeys(retained.filter(entry=>entry.text.length>0).map(entry => entry.key));
      }
      else discardSessionCache();
    }
  } catch {
    // A failed first save still rolls back before dispatch. A later read/write
    // refusal must not erase an already protected metadata-only cache.
    if(!preserveKnowledgeOnlyCache(sessionOwner))discardSessionCache();
  }
}

export function setComposerDraftSessionScope(scope: ComposerDraftSessionScope): void {
  const next = scope.kind === "ready" && scope.tenantId && scope.userId
    ? { tenantId: scope.tenantId, userId: scope.userId } : null;
  if (next && sessionOwner?.tenantId === next.tenantId && sessionOwner.userId === next.userId&&!sessionReadUnavailable) return;
  const previous = sessionOwner;
  sessionOwner = null;
  if (previous) {
    // Retain monotonic revisions: an old refused send cannot resurrect retired text,
    // including an actor/workspace A→B→A transition.
    for (const key of new Set([...draftRevisions.keys(),...knowledgeIntakes.keys()])) {
      if (sessionKeyParts(key)?.[1] !== previous.userId) continue;
      draftRevisions.set(key, (draftRevisions.get(key) ?? 0) + 1);
      // Preserve existing same-actor workspace drafts in memory. Raw text is
      // reloadable only for the verified workspace; opaque native pointers stay
      // withheld until their exact actor/tenant/focus is verified again.
      if (!next || next.userId !== previous.userId) {
        drafts.delete(key);
        if(scope.kind!=='unresolved')knowledgeIntakes.delete(key);
        draftTouchedAt.delete(key);
      }
      emit(key);
    }
    if(scope.kind==='clear'||(next&&next.userId!==previous.userId)||!preserveKnowledgeOnlyCache(previous))discardSessionCache();
  }
  if (!next) {
    // A cold unresolved identity cannot read a cache or destroy one before auth
    // resolves. An authoritative sign-out/ineligible verdict must remove it.
    if (scope.kind === "clear") {
      for(const key of knowledgeIntakes.keys()){knowledgeIntakes.delete(key);emit(key);}
      discardSessionCache();
    }
    return;
  }
  sessionOwner = next;
  for(const key of knowledgeIntakes.keys())if(sessionKeyParts(key)?.[1]!==next.userId){knowledgeIntakes.delete(key);emit(key);}
  let cacheReadCompleted=false;
  try {
    const raw = window.sessionStorage.getItem(DRAFT_SESSION_KEY);
    cacheReadCompleted=true;sessionReadUnavailable=false;
    if (raw) {
      if (raw.length > DRAFT_CACHE_LIMIT) throw new Error("Oversized draft cache");
      const cache = JSON.parse(raw);
      if (cache?.version !== 1 || (cache.owner?.tenantId !== next.tenantId&&!knowledgeOnlyCache(next))
        || cache.owner?.userId !== next.userId || !Array.isArray(cache.entries)
        || cache.entries.length > DRAFT_SESSION_LIMIT) throw new Error("Invalid draft cache");
      const seen = new Set<string>();
      const now = Date.now();
      for (const entry of cache.entries) {
        if (!entry || typeof entry.key !== "string" || (!sessionOwns(entry.key,next)
          &&!(entry.text===''&&knowledgeIntakeValid(entry.knowledgeIntake)&&sessionKeyParts(entry.key)?.[1]===next.userId))
          || seen.has(entry.key) || typeof entry.text !== "string" || (!entry.text.length&&!knowledgeIntakeValid(entry.knowledgeIntake))
          || entry.text.length > DRAFT_TEXT_LIMIT || !Number.isFinite(entry.updatedAt)
          || (entry.knowledgeIntake!==undefined&&!knowledgeIntakeValid(entry.knowledgeIntake))
          || entry.updatedAt > now || (now-entry.updatedAt>=DRAFT_SESSION_TTL&&!entry.knowledgeIntake)) {
          throw new Error("Invalid draft entry");
        }
        seen.add(entry.key);
      }
      knowledgeRecoveryCacheProtected=cache.entries.length>0&&cache.entries.every((entry:SessionDraft)=>entry.text===''&&!!entry.knowledgeIntake);
      const currentEdits = [...draftTouchedAt];
      for (const entry of [...cache.entries as SessionDraft[]].reverse()) {
        if(entry.knowledgeIntake&&!knowledgeIntakes.has(entry.key))knowledgeIntakes.set(entry.key,Object.freeze({...entry.knowledgeIntake}));
        // Any in-memory revision, including an explicit empty tombstone, wins.
        if (draftRevisions.has(entry.key)) continue;
        if(entry.text&&sessionOwns(entry.key,next)&&now-entry.updatedAt<DRAFT_SESSION_TTL)drafts.set(entry.key, entry.text);
        draftRevisions.set(entry.key, 1);
        draftTouchedAt.set(entry.key, entry.updatedAt);
        emit(entry.key);
      }
      // Cached edit order is older than any work already done in this module.
      for (const [key, at] of currentEdits) {
        draftTouchedAt.delete(key);
        draftTouchedAt.set(key, at);
      }
    }
  } catch {
    if(!cacheReadCompleted){sessionReadUnavailable=true;publishPersistedDraftKeys([]);}
    else discardSessionCache();
  }
  persistSessionDrafts();
  // A parked native pointer becomes readable only after canonical scope binds.
  // Notify the existing composer subscribers even if its text did not change.
  for(const key of knowledgeIntakes.keys())emit(key);
}

export function composerDraftKey(handle: ComposerDraftHandle): string {
  return JSON.stringify([
    handle.tenantId,
    handle.userId,
    handle.conversationId,
    handle.focusedClientId,
    handle.focusedBusinessMissionId,
  ]);
}

function readKey(key: string | null): string {
  return key ? (drafts.get(key) ?? "") : "";
}

function emit(key: string): void {
  for (const listener of listeners.get(key) ?? []) listener();
}

function writeKey(key: string, value: string): void {
  draftRevisions.set(key, (draftRevisions.get(key) ?? 0) + 1);
  draftTouchedAt.delete(key);
  if (value.length === 0) drafts.delete(key);
  else {
    drafts.set(key, value);
    draftTouchedAt.set(key, Date.now());
  }
  persistSessionDrafts();
  emit(key);
}

export function readComposerDraft(handle: ComposerDraftHandle): string {
  return readKey(composerDraftKey(handle));
}

export function readComposerKnowledgeIntake(handle: ComposerDraftHandle): Readonly<ChatKnowledgeIntakeSelection> | null {
  const key=composerDraftKey(handle);
  return sessionOwner&&sessionOwns(key,sessionOwner)?knowledgeIntakes.get(key)??null:null;
}

export function readComposerKnowledgeRecoveryState(handle:ComposerDraftHandle):'ready'|'pending'|'unavailable'{
  if(!sessionOwner||!sessionOwns(composerDraftKey(handle),sessionOwner))return 'ready';
  return sessionReadUnavailable?'unavailable':readComposerKnowledgeIntake(handle)?'pending':'ready';
}

/** Retain the original Work UUID BEFORE a first-value native constructor. A
 * storage failure is a refusal to dispatch, never permission to lose recovery. */
export function saveComposerKnowledgeIntake(handle: ComposerDraftHandle, input: ChatKnowledgeIntakeSelection): boolean {
  if(sessionReadUnavailable)return false;
  const key=composerDraftKey(handle),previous=knowledgeIntakes.get(key);
  if(!sessionOwner||!sessionOwns(key,sessionOwner)||!knowledgeIntakeValid(input)
    ||(previous&&Object.keys(input).some(key=>previous[key as keyof ChatKnowledgeIntakeSelection]!==input[key as keyof ChatKnowledgeIntakeSelection])))return false;
  if(!previous&&[...knowledgeIntakes].filter(([candidate,value])=>value&&sessionKeyParts(candidate)?.[1]===sessionOwner!.userId).length>=DRAFT_SESSION_LIMIT)return false;
  knowledgeIntakes.set(key,Object.freeze({...input}));persistSessionDrafts();
  const stored=knowledgeOnlyCache(sessionOwner)?.find(entry=>entry.key===key)?.knowledgeIntake;
  if(stored&&Object.keys(input).every(key=>stored[key as keyof ChatKnowledgeIntakeSelection]===input[key as keyof ChatKnowledgeIntakeSelection])){emit(key);return true;}
  if(previous===undefined)knowledgeIntakes.delete(key);else knowledgeIntakes.set(key,previous);
  persistSessionDrafts();emit(key);return false;
}

/** CAS clears only this native pointer after authoritative inspection/adoption. */
export function clearComposerKnowledgeIntake(handle: ComposerDraftHandle, workId: string): boolean {
  const key=composerDraftKey(handle);
  if(!sessionOwner||!sessionOwns(key,sessionOwner)||knowledgeIntakes.get(key)?.extractionWorkId!==workId)return false;
  knowledgeIntakes.set(key,null);persistSessionDrafts();emit(key);return true;
}

export function writeComposerDraft(handle: ComposerDraftHandle, value: string): void {
  writeKey(composerDraftKey(handle), value);
}

export function clearComposerDraft(handle: ComposerDraftHandle): void {
  writeComposerDraft(handle, "");
}

export type ComposerDraftSubmission = Readonly<{ text: string; revision: number }>;

/** Consume synchronously so a second Enter cannot submit the same draft twice. */
export function takeComposerDraft(handle: ComposerDraftHandle): ComposerDraftSubmission {
  const text = readComposerDraft(handle);
  clearComposerDraft(handle);
  return { text, revision: draftRevisions.get(composerDraftKey(handle)) ?? 0 };
}

/** A refused send restores only its own untouched slot, never a newer thought. */
export function restoreComposerDraft(handle: ComposerDraftHandle, submission: ComposerDraftSubmission): boolean {
  const key = composerDraftKey(handle);
  if (readKey(key) !== "" || draftRevisions.get(key) !== submission.revision) return false;
  writeKey(key, submission.text);
  return true;
}

export function moveComposerDraft(from: ComposerDraftHandle, to: ComposerDraftHandle): void {
  const fromKey = composerDraftKey(from);
  const toKey = composerDraftKey(to);
  if (fromKey === toKey) return;

  const value = drafts.get(fromKey);
  if (value === undefined) {
    if (!drafts.has(toKey) && !draftRevisions.has(toKey) && draftRevisions.has(fromKey)) {
      draftRevisions.set(toKey, draftRevisions.get(fromKey)!);
    }
    return;
  }

  const destinationValue = drafts.get(toKey);
  if (destinationValue !== undefined) {
    if (destinationValue === value) {
      drafts.delete(fromKey);
      draftTouchedAt.delete(fromKey);
      persistSessionDrafts();
      emit(fromKey);
    }
    return;
  }

  drafts.delete(fromKey);
  drafts.set(toKey, value);
  draftTouchedAt.delete(toKey);
  draftTouchedAt.set(toKey, draftTouchedAt.get(fromKey) ?? Date.now());
  draftTouchedAt.delete(fromKey);
  draftRevisions.set(toKey, (draftRevisions.get(toKey) ?? 0) + 1);
  persistSessionDrafts();
  emit(fromKey);
  emit(toKey);
}

function subscribeKey(key: string | null, listener: Listener): () => void {
  if (!key) return () => undefined;
  const keyListeners = listeners.get(key) ?? new Set<Listener>();
  keyListeners.add(listener);
  listeners.set(key, keyListeners);
  return () => {
    keyListeners.delete(listener);
    if (keyListeners.size === 0) listeners.delete(key);
  };
}

/** Session-memory projection. A setter without a writable state is a bug. */
export function useComposerDraft(state: ComposerScopeState) {
  const visibleKey = state.visibleHandle ? composerDraftKey(state.visibleHandle) : null;
  const subscribe = useCallback((listener: Listener) => subscribeKey(visibleKey, listener), [visibleKey]);
  const getSnapshot = useCallback(() => readKey(visibleKey), [visibleKey]);
  const value = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const getReloadSnapshot = useCallback(() => reloadProtectionForKey(visibleKey), [visibleKey]);
  const reloadProtection = useSyncExternalStore(subscribe, getReloadSnapshot, getReloadSnapshot);
  const getKnowledgeSnapshot=useCallback(()=>visibleKey&&sessionOwner&&sessionOwns(visibleKey,sessionOwner)
    ?knowledgeIntakes.get(visibleKey)??null:null,[visibleKey]);
  const knowledgeRecoveryIntake=useSyncExternalStore(subscribe,getKnowledgeSnapshot,getKnowledgeSnapshot);
  const getKnowledgeStateSnapshot=useCallback(()=>state.visibleHandle?readComposerKnowledgeRecoveryState(state.visibleHandle):'ready',[state.visibleHandle]);
  const knowledgeRecoveryState=useSyncExternalStore(subscribe,getKnowledgeStateSnapshot,getKnowledgeStateSnapshot);

  const setValue = useCallback((next: SetStateAction<string>) => {
    const writableHandle = state.writableHandle;
    if (!writableHandle) {
      throw new Error("PAIGE composer writes require a complete, displayed, writable scope handle.");
    }
    const key = composerDraftKey(writableHandle);
    const previous = readKey(key);
    const nextValue = typeof next === "function"
      ? (next as (current: string) => string)(previous)
      : next;
    writeKey(key, nextValue);
  }, [state.writableHandle]);

  return {
    value,
    reloadProtection,
    knowledgeRecoveryIntake,
    knowledgeRecoveryState,
    setValue,
    visibleHandle: state.visibleHandle,
    writableHandle: state.writableHandle,
  };
}

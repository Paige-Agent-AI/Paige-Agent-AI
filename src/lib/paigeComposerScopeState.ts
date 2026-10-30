import { useCallback, useSyncExternalStore, type SetStateAction } from "react";

import { composerScopeIdentityKey, createComposerScopeIdentity, type ComposerScopeIdentity } from "./paigeComposerScopeIdentity";
export { COMPOSER_FOCUS_NONE, COMPOSER_SCOPE_FIELDS, composerScopeIdentityKey, createComposerScopeIdentity, type ComposerScopeIdentity, type ComposerScopeFieldCoverage } from "./paigeComposerScopeIdentity";

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
type SessionDraft = Readonly<{ key: string; text: string; updatedAt: number }>;
let sessionOwner: SessionOwner | null = null;
const draftTouchedAt = new Map<string, number>();
let persistedDraftKeys = new Set<string>();

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

function discardSessionCache(): void {
  publishPersistedDraftKeys([]);
  try { window.sessionStorage.removeItem(DRAFT_SESSION_KEY); } catch { /* Current memory still works. */ }
}

function persistSessionDrafts(): void {
  if (!sessionOwner) return;
  const now = Date.now();
  const entries: SessionDraft[] = [];
  // Reverse edit order also breaks same-millisecond ties in favor of new input.
  for (const [key, updatedAt] of [...draftTouchedAt].reverse()) {
    const text = drafts.get(key);
    if (text && sessionOwns(key, sessionOwner) && text.length <= DRAFT_TEXT_LIMIT
      && updatedAt <= now && now - updatedAt < DRAFT_SESSION_TTL) {
      entries.push({ key, text, updatedAt });
    }
  }
  entries.sort((a, b) => b.updatedAt - a.updatedAt);
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
        publishPersistedDraftKeys(retained.map(entry => entry.key));
      }
      else discardSessionCache();
    }
  } catch {
    // If setItem fails but removal works, an older text must not return on reload.
    discardSessionCache();
  }
}

export function setComposerDraftSessionScope(scope: ComposerDraftSessionScope): void {
  const next = scope.kind === "ready" && scope.tenantId && scope.userId
    ? { tenantId: scope.tenantId, userId: scope.userId } : null;
  if (next && sessionOwner?.tenantId === next.tenantId && sessionOwner.userId === next.userId) return;
  const previous = sessionOwner;
  sessionOwner = null;
  if (previous) {
    // Retain monotonic revisions: an old refused send cannot resurrect retired text,
    // including an actor/workspace A→B→A transition.
    for (const key of draftRevisions.keys()) {
      if (sessionKeyParts(key)?.[1] !== previous.userId) continue;
      draftRevisions.set(key, (draftRevisions.get(key) ?? 0) + 1);
      // Preserve existing same-actor workspace drafts in memory. Only the
      // currently verified workspace may be retained for reload.
      if (!next || next.userId !== previous.userId) {
        drafts.delete(key);
        draftTouchedAt.delete(key);
      }
      emit(key);
    }
    discardSessionCache();
  }
  if (!next) {
    // A cold unresolved identity cannot read a cache or destroy one before auth
    // resolves. An authoritative sign-out/ineligible verdict must remove it.
    if (scope.kind === "clear") discardSessionCache();
    return;
  }
  sessionOwner = next;
  try {
    const raw = window.sessionStorage.getItem(DRAFT_SESSION_KEY);
    if (raw) {
      if (raw.length > DRAFT_CACHE_LIMIT) throw new Error("Oversized draft cache");
      const cache = JSON.parse(raw);
      if (cache?.version !== 1 || cache.owner?.tenantId !== next.tenantId
        || cache.owner?.userId !== next.userId || !Array.isArray(cache.entries)
        || cache.entries.length > DRAFT_SESSION_LIMIT) throw new Error("Invalid draft cache");
      const seen = new Set<string>();
      const now = Date.now();
      for (const entry of cache.entries) {
        if (!entry || typeof entry.key !== "string" || !sessionOwns(entry.key, next)
          || seen.has(entry.key) || typeof entry.text !== "string" || !entry.text.length
          || entry.text.length > DRAFT_TEXT_LIMIT || !Number.isFinite(entry.updatedAt)
          || entry.updatedAt > now || now - entry.updatedAt >= DRAFT_SESSION_TTL) {
          throw new Error("Invalid draft entry");
        }
        seen.add(entry.key);
      }
      const currentEdits = [...draftTouchedAt];
      for (const entry of [...cache.entries as SessionDraft[]].reverse()) {
        // Any in-memory revision, including an explicit empty tombstone, wins.
        if (draftRevisions.has(entry.key)) continue;
        drafts.set(entry.key, entry.text);
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
  } catch { discardSessionCache(); }
  persistSessionDrafts();
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
    setValue,
    visibleHandle: state.visibleHandle,
    writableHandle: state.writableHandle,
  };
}

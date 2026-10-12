import { useCallback, useSyncExternalStore, type SetStateAction } from "react";

export type ComposerScopeIdentity = Readonly<{
  tenantId: string;
  userId: string;
  focusedClientId: string;
  focusedBusinessMissionId: string;
}>;

type ComposerScopeIdentityCandidate = Readonly<{
  tenantId: string | null | undefined;
  userId: string | null | undefined;
  focusedClientId?: string | null;
  focusedBusinessMissionId?: string | null;
}>;

export const COMPOSER_FOCUS_NONE = "none";

export const COMPOSER_SCOPE_FIELDS = [
  "tenantId",
  "userId",
  "focusedClientId",
  "focusedBusinessMissionId",
] as const satisfies readonly (keyof ComposerScopeIdentity)[];

type MissingComposerScopeField = Exclude<
  keyof ComposerScopeIdentity,
  (typeof COMPOSER_SCOPE_FIELDS)[number]
>;
type AssertNoMissingComposerScopeField<T extends never> = T;
export type ComposerScopeFieldCoverage = AssertNoMissingComposerScopeField<MissingComposerScopeField>;

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

export function createComposerScopeIdentity(
  candidate: ComposerScopeIdentityCandidate,
): ComposerScopeIdentity | null {
  if (!candidate.tenantId || !candidate.userId) return null;
  return {
    tenantId: candidate.tenantId,
    userId: candidate.userId,
    focusedClientId: candidate.focusedClientId?.trim() || COMPOSER_FOCUS_NONE,
    focusedBusinessMissionId: candidate.focusedBusinessMissionId?.trim() || COMPOSER_FOCUS_NONE,
  };
}

export function composerScopeIdentityKey(identity: ComposerScopeIdentity): string {
  return JSON.stringify([
    identity.tenantId,
    identity.userId,
    identity.focusedClientId,
    identity.focusedBusinessMissionId,
  ]);
}

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
  if (value.length === 0) drafts.delete(key);
  else drafts.set(key, value);
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
      emit(fromKey);
    }
    return;
  }

  drafts.delete(fromKey);
  drafts.set(toKey, value);
  draftRevisions.set(toKey, (draftRevisions.get(toKey) ?? 0) + 1);
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
    setValue,
    visibleHandle: state.visibleHandle,
    writableHandle: state.writableHandle,
  };
}

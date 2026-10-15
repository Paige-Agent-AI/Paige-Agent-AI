import { beforeEach, describe, expect, it } from "vitest";
import {
  COMPOSER_SCOPE_FIELDS,
  NEW_CHAT_CONVERSATION,
  acceptComposerDelivery,
  clearComposerDraft,
  createComposerRequestFence,
  createComposerScopeIdentity,
  initialComposerConversation,
  moveComposerDraft,
  readComposerDraft,
  restoreComposerDraft,
  resolveComposerScopeState,
  shouldClearComposerDraft,
  takeComposerDraft,
  transitionComposerConversation,
  writeComposerDraft,
  type ComposerConversationState,
  type ComposerScopeIdentity,
  type ComposerScopeResolverInput,
} from "./paigeComposerScopeState";

const identity = (
  tenantId = "tenant-a",
  userId = "user-a",
  focusedClientId = "none",
  focusedBusinessMissionId = "none",
): ComposerScopeIdentity => ({
  tenantId,
  userId,
  focusedClientId,
  focusedBusinessMissionId,
} as ComposerScopeIdentity);

const thread = (id: string) => ({ kind: "thread" as const, id });

const readyThreadConversation = (id = "thread-a"): ComposerConversationState => ({
  history: "settled",
  newConversationId: NEW_CHAT_CONVERSATION.id,
  requested: thread(id),
  displayed: thread(id),
  intent: "explicit",
});

const baseInput = (overrides: Partial<ComposerScopeResolverInput> = {}): ComposerScopeResolverInput => ({
  currentIdentity: identity(),
  displayedIdentity: identity(),
  conversation: readyThreadConversation(),
  busy: false,
  ...overrides,
});

describe("ComposerScopeState transition table", () => {
  const cases: Array<{
    name: string;
    input: ComposerScopeResolverInput;
    status: ReturnType<typeof resolveComposerScopeState>["status"];
    writable: boolean;
    visibleConversationId: string | null;
  }> = [
    {
      name: "sign-out leaves identity unresolved and exposes no prior draft",
      input: baseInput({ currentIdentity: null }),
      status: "identity-unresolved",
      writable: false,
      visibleConversationId: null,
    },
    {
      name: "effective-user change before cleanup is non-writable and hides the old user's draft",
      input: baseInput({ currentIdentity: identity("tenant-a", "user-b") }),
      status: "hydrating",
      writable: false,
      visibleConversationId: null,
    },
    {
      name: "account switch before cleanup is non-writable and hides the old tenant draft",
      input: baseInput({ currentIdentity: identity("tenant-b", "user-a") }),
      status: "hydrating",
      writable: false,
      visibleConversationId: null,
    },
    {
      name: "client focus switch before cleanup is non-writable and hides the origin draft",
      input: baseInput({
        currentIdentity: identity("tenant-a", "user-a", "client-b"),
        displayedIdentity: identity("tenant-a", "user-a", "client-a"),
      }),
      status: "hydrating",
      writable: false,
      visibleConversationId: null,
    },
    {
      name: "mission focus switch before cleanup is non-writable and hides the origin draft",
      input: baseInput({
        currentIdentity: identity("tenant-a", "user-a", "none", "mission-b"),
        displayedIdentity: identity("tenant-a", "user-a", "none", "mission-a"),
      }),
      status: "hydrating",
      writable: false,
      visibleConversationId: null,
    },
    {
      name: "clearing focus before cleanup is non-writable and hides the focused draft",
      input: baseInput({
        currentIdentity: identity(),
        displayedIdentity: identity("tenant-a", "user-a", "client-a", "mission-a"),
      }),
      status: "hydrating",
      writable: false,
      visibleConversationId: null,
    },
    {
      name: "pending history is different from a confirmed empty history",
      input: baseInput({ conversation: initialComposerConversation(true) }),
      status: "history-unresolved",
      writable: false,
      visibleConversationId: "new-chat",
    },
    {
      name: "confirmed empty history is a writable new chat",
      input: baseInput({
        conversation: transitionComposerConversation(
          initialComposerConversation(true),
          { type: "history-confirmed-empty" },
        ),
      }),
      status: "ready-new",
      writable: true,
      visibleConversationId: "new-chat",
    },
    {
      name: "newest-thread auto-resume disables writes while its transcript hydrates",
      input: baseInput({
        conversation: transitionComposerConversation(
          initialComposerConversation(true),
          { type: "thread-requested", id: "thread-newest", intent: "automatic" },
        ),
      }),
      status: "hydrating",
      writable: false,
      visibleConversationId: "new-chat",
    },
    {
      name: "an explicit New chat wins while history is still pending",
      input: baseInput({
        conversation: transitionComposerConversation(
          initialComposerConversation(true),
          { type: "new-chat-requested" },
        ),
      }),
      status: "ready-new",
      writable: true,
      visibleConversationId: "new-chat",
    },
    {
      name: "controlled-parent A to B disables before B is loaded and keeps A visible",
      input: baseInput({
        conversation: transitionComposerConversation(
          readyThreadConversation("thread-a"),
          { type: "thread-requested", id: "thread-b", intent: "controlled" },
        ),
      }),
      status: "hydrating",
      writable: false,
      visibleConversationId: "thread-a",
    },
    {
      name: "a failed load returns to the prior displayed conversation",
      input: baseInput({
        conversation: transitionComposerConversation(
          transitionComposerConversation(
            readyThreadConversation("thread-a"),
            { type: "thread-requested", id: "thread-b", intent: "explicit" },
          ),
          { type: "thread-load-failed", id: "thread-b" },
        ),
      }),
      status: "ready-thread",
      writable: true,
      visibleConversationId: "thread-a",
    },
    {
      name: "a loaded requested thread becomes writable",
      input: baseInput({
        conversation: transitionComposerConversation(
          transitionComposerConversation(
            readyThreadConversation("thread-a"),
            { type: "thread-requested", id: "thread-b", intent: "explicit" },
          ),
          { type: "thread-loaded", id: "thread-b" },
        ),
      }),
      status: "ready-thread",
      writable: true,
      visibleConversationId: "thread-b",
    },
    {
      name: "lazy New-chat to persisted-thread migration remains the displayed conversation",
      input: baseInput({
        conversation: transitionComposerConversation(
          transitionComposerConversation(
            initialComposerConversation(true),
            { type: "new-chat-requested" },
          ),
          { type: "lazy-thread-created", id: "thread-created" },
        ),
      }),
      status: "ready-thread",
      writable: true,
      visibleConversationId: "thread-created",
    },
    {
      name: "a stable Solo conversation remains writable while PAIGE works",
      input: baseInput({ busy: true, allowWhileBusy: true }),
      status: "ready-thread",
      writable: true,
      visibleConversationId: "thread-a",
    },
  ];

  it("consumes once and never restores over a newer draft, even one typed then cleared", () => {
    const handle = resolveComposerScopeState(baseInput()).writableHandle!;
    writeComposerDraft(handle, "submitted");
    const taken = takeComposerDraft(handle);
    expect(taken.text).toBe("submitted");
    expect(readComposerDraft(handle)).toBe("");
    writeComposerDraft(handle, "newer thought");
    expect(restoreComposerDraft(handle, taken)).toBe(false);
    clearComposerDraft(handle);
    expect(restoreComposerDraft(handle, taken)).toBe(false);
  });

  it("restores a refused send only when its consumed draft slot remains untouched", () => {
    const handle = resolveComposerScopeState(baseInput()).writableHandle!;
    writeComposerDraft(handle, "refused");
    const taken = takeComposerDraft(handle);
    expect(restoreComposerDraft(handle, taken)).toBe(true);
    expect(readComposerDraft(handle)).toBe("refused");
  });

  it.each(cases)("$name", ({ input, status, writable, visibleConversationId }) => {
    const state = resolveComposerScopeState(input);
    expect(state.status).toBe(status);
    expect(state.writable).toBe(writable);
    expect(state.visibleHandle?.conversationId ?? null).toBe(visibleConversationId);
    expect(state.writableHandle !== null).toBe(writable);
  });

  it("makes every draft-key field mandatory before the composer can be writable", () => {
    const complete = {
      tenantId: "tenant-a",
      userId: "user-a",
      focusedClientId: "none",
      focusedBusinessMissionId: "none",
    };
    expect(createComposerScopeIdentity(complete)).toEqual(complete);
    expect(COMPOSER_SCOPE_FIELDS).toEqual([
      "tenantId",
      "userId",
      "focusedClientId",
      "focusedBusinessMissionId",
    ]);

    for (const field of ["tenantId", "userId"] as const) {
      expect(createComposerScopeIdentity({ ...complete, [field]: null })).toBeNull();
    }

    expect(createComposerScopeIdentity({
      ...complete,
      focusedClientId: null,
      focusedBusinessMissionId: undefined,
    })).toEqual(complete);
  });
});

describe("ComposerScopeState delivery and completion rules", () => {
  beforeEach(() => {
    clearComposerDraft({ ...identity(), conversationId: "new-chat" });
    clearComposerDraft({ ...identity(), conversationId: "thread-created" });
    clearComposerDraft({ ...identity(), conversationId: "thread-a" });
  });

  it("moves a lazy new-chat draft to the first persisted thread without losing words", () => {
    const from = {
      ...identity("tenant-a", "user-a", "client-a", "mission-a"),
      conversationId: NEW_CHAT_CONVERSATION.id,
    };
    const to = { ...identity(), conversationId: "thread-created" };
    const focusedTo = { ...from, conversationId: "thread-created" };
    writeComposerDraft(from, "words written before persistence");

    moveComposerDraft(from, focusedTo);

    expect(readComposerDraft(from)).toBe("");
    expect(readComposerDraft(focusedTo)).toBe("words written before persistence");
    expect(readComposerDraft(to)).toBe("");
  });

  it("deduplicates identical drafts when a focused draft reconciles into the visible thread", () => {
    const conversationId = "focus-identical-thread";
    const focused = {
      ...identity("tenant-a", "user-a", "client-a"),
      conversationId,
    };
    const visible = { ...identity(), conversationId };
    clearComposerDraft(focused);
    clearComposerDraft(visible);
    writeComposerDraft(focused, "same retained words");
    writeComposerDraft(visible, "same retained words");

    moveComposerDraft(focused, visible);

    expect(readComposerDraft(visible)).toBe("same retained words");
    expect(readComposerDraft(focused)).toBe("");
  });

  it("preserves both drafts when an older focused draft reconciles into a newer visible draft", () => {
    const conversationId = "focus-collision-thread";
    const focused = {
      ...identity("tenant-a", "user-a", "client-a"),
      conversationId,
    };
    const visible = { ...identity(), conversationId };
    clearComposerDraft(focused);
    clearComposerDraft(visible);
    writeComposerDraft(focused, "older focused-client draft");
    writeComposerDraft(visible, "newer no-focus draft");

    moveComposerDraft(focused, visible);

    expect(readComposerDraft(visible)).toBe("newer no-focus draft");
    expect(readComposerDraft(focused)).toBe("older focused-client draft");
  });

  it("keeps client focus, mission focus, and explicit no-focus drafts in separate slots", () => {
    const conversationId = "focus-isolation-thread";
    const noFocus = { ...identity(), conversationId };
    const clientA = { ...identity("tenant-a", "user-a", "client-a"), conversationId };
    const clientB = { ...identity("tenant-a", "user-a", "client-b"), conversationId };
    const missionA = { ...identity("tenant-a", "user-a", "none", "mission-a"), conversationId };
    const missionB = { ...identity("tenant-a", "user-a", "none", "mission-b"), conversationId };

    for (const handle of [noFocus, clientA, clientB, missionA, missionB]) clearComposerDraft(handle);
    writeComposerDraft(noFocus, "no focus");
    writeComposerDraft(clientA, "client A");
    writeComposerDraft(clientB, "client B");
    writeComposerDraft(missionA, "mission A");
    writeComposerDraft(missionB, "mission B");

    expect(readComposerDraft(noFocus)).toBe("no focus");
    expect(readComposerDraft(clientA)).toBe("client A");
    expect(readComposerDraft(clientB)).toBe("client B");
    expect(readComposerDraft(missionA)).toBe("mission A");
    expect(readComposerDraft(missionB)).toBe("mission B");
  });

  it.each([
    { name: "no edit and retry succeeds", current: "  send me  ", done: true, clears: true },
    { name: "no edit and retry fails", current: "send me", done: false, clears: false },
    { name: "edited draft and retry succeeds", current: "send me plus a newer edit", done: true, clears: false },
    { name: "edited draft and retry fails", current: "a newer replacement", done: false, clears: false },
  ])("$name", ({ current, done, clears }) => {
    expect(shouldClearComposerDraft({
      terminalDone: done,
      currentDraft: current,
      submittedText: "send me",
    })).toBe(clears);
  });

  it("drops a late dictation callback once the requested/displayed scope no longer matches", () => {
    const ready = resolveComposerScopeState(baseInput());
    const captured = ready.writableHandle!;
    const switched = resolveComposerScopeState(baseInput({
      conversation: transitionComposerConversation(
        readyThreadConversation("thread-a"),
        { type: "thread-requested", id: "thread-b", intent: "explicit" },
      ),
    }));

    expect(acceptComposerDelivery(captured, ready)).toBe(true);
    expect(acceptComposerDelivery(captured, switched)).toBe(false);
  });

  it.each([
    {
      name: "client A to B",
      origin: identity("tenant-a", "user-a", "client-a"),
      target: identity("tenant-a", "user-a", "client-b"),
    },
    {
      name: "mission A to B",
      origin: identity("tenant-a", "user-a", "none", "mission-a"),
      target: identity("tenant-a", "user-a", "none", "mission-b"),
    },
    {
      name: "clear focus",
      origin: identity("tenant-a", "user-a", "client-a", "mission-a"),
      target: identity(),
    },
  ])("drops late dictation delivery after $name", ({ origin, target }) => {
    const ready = resolveComposerScopeState(baseInput({
      currentIdentity: origin,
      displayedIdentity: origin,
    }));
    const switched = resolveComposerScopeState(baseInput({
      currentIdentity: target,
      displayedIdentity: origin,
    }));

    expect(acceptComposerDelivery(ready.writableHandle!, switched)).toBe(false);
  });

  it("accepts request delivery only for the captured full handle and epoch", () => {
    const fence = createComposerRequestFence();
    const origin = { ...identity(), conversationId: "thread-a" };
    const ticket = fence.begin(origin, "epoch-a");

    expect(fence.isCurrent(ticket, origin, "epoch-a")).toBe(true);
    expect(fence.isCurrent(ticket, { ...origin, tenantId: "tenant-b" }, "epoch-a")).toBe(false);
    expect(fence.isCurrent(ticket, { ...origin, userId: "user-b" }, "epoch-a")).toBe(false);
    expect(fence.isCurrent(ticket, { ...origin, conversationId: "thread-b" }, "epoch-a")).toBe(false);
    expect(fence.isCurrent(ticket, { ...origin, focusedClientId: "client-b" }, "epoch-a")).toBe(false);
    expect(fence.isCurrent(ticket, { ...origin, focusedBusinessMissionId: "mission-b" }, "epoch-a")).toBe(false);
    expect(fence.isCurrent(ticket, origin, "epoch-b")).toBe(false);
  });

  it("aborts the prior request and supports an authorized lazy new-chat rebind", () => {
    const fence = createComposerRequestFence();
    const newChat = { ...identity(), conversationId: "new-chat" };
    const first = fence.begin(newChat, "new-epoch");
    const thread = { ...newChat, conversationId: "thread-created" };
    const rebound = fence.rebind(first, thread, "thread-epoch");

    expect(first.signal.aborted).toBe(false);
    expect(fence.isCurrent(rebound, thread, "thread-epoch")).toBe(true);

    const next = fence.begin({ ...thread, conversationId: "thread-b" }, "next-epoch");
    expect(first.signal.aborted).toBe(true);
    expect(fence.isCurrent(rebound, thread, "thread-epoch")).toBe(false);
    expect(fence.isCurrent(next, { ...thread, conversationId: "thread-b" }, "next-epoch")).toBe(true);
  });

  it("lets only the request that claimed busy release it and clears an aborted owner once", () => {
    const fence = createComposerRequestFence();
    const origin = fence.begin({ ...identity(), conversationId: "thread-a" }, "epoch-a");

    expect(fence.claimBusy(origin)).toBe(true);
    expect(fence.invalidate()).toBe(true);
    expect(fence.invalidate()).toBe(false);

    const target = fence.begin({ ...identity(), conversationId: "thread-b" }, "epoch-b");
    expect(fence.claimBusy(target)).toBe(true);
    expect(fence.releaseBusy(origin)).toBe(false);
    expect(fence.releaseBusy(target)).toBe(true);
    expect(fence.releaseBusy(target)).toBe(false);
  });
});

type TranscriptPosition =
  | { kind: "bottom" }
  | {
      kind: "anchor";
      messageId: string;
      semanticKey?: string;
      indexFromStart?: number;
      indexFromEnd?: number;
      offsetPx: number;
    };

type AnchoredTranscriptScrollOptions = {
  storagePrefix: string;
  onPinnedChange?: (pinned: boolean) => void;
  onDiagnostic?: (event: ScrollDiagnostic) => void;
};

type ScrollSource = "owner-wheel" | "owner-touch" | "owner-pointer" | "owner-keyboard"
  | "jump-to-latest" | "stream-token" | "assistant-completion" | "status-tool-receipt"
  | "resize-observer" | "message-render" | "layout-effect" | "hydration"
  | "history-prepend" | "thread-adoption" | "focus" | "popout-restore" | "scroll-event";
type ScrollDiagnostic = {
  source: ScrollSource;
  action: "intent" | "write" | "rejected" | "capture" | "hidden";
  epoch: number;
  pinned: boolean;
  top: number;
  target: number;
  phase: "synchronous" | "animation-frame";
};

const MESSAGE_SELECTOR = "[data-paige-message-id]";
const EXACT_BOTTOM_EPSILON_PX = 0;
const SCROLL_KEYS = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " ", "Tab"]);

// The database owns persisted turn IDs, while an in-flight turn starts with a
// client ID. Keep a content-derived, non-reversible reconciliation key so an
// anchor can survive that identity hand-off without storing transcript text.
export function messageScrollAnchorKey(role: string, content: string) {
  let hash = 2166136261;
  const value = `${role}\u0000${content}`;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${role}:${(hash >>> 0).toString(36)}:${content.length}`;
}

export function createAnchoredTranscriptScroll({
  storagePrefix,
  onPinnedChange,
  onDiagnostic,
}: AnchoredTranscriptScrollOptions) {
  let context = "default";
  let element: HTMLDivElement | null = null;
  let position: TranscriptPosition = { kind: "bottom" };
  let mutationObserver: MutationObserver | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let animationFrame: number | null = null;
  let releaseFrame: number | null = null;
  let intentEpoch = 0;
  let lastScrollTop = 0;
  let keyboardKey: string | null = null;
  let gestureNode: HTMLElement | null = null;
  let gestureNodeTop = 0;
  let gestureViewportHeight = 0;
  let restoring = false;
  let intentionalBottom = false;
  let pendingUserMovement = false;
  let continuousUserMovement = false;
  let pendingContextDomSignature: string | null = null;
  let boundView: Window | null = null;
  let diagnosticPhase: ScrollDiagnostic["phase"] = "synchronous";

  // Development/test only; fixed-schema numeric diagnostics never include
  // transcript text, message/thread IDs, storage keys, or tenant information.
  const trace = (source: ScrollSource, action: ScrollDiagnostic["action"], target = element?.scrollTop ?? 0) => {
    if (!import.meta.env.DEV) return;
    const event: ScrollDiagnostic = { source, action, epoch: intentEpoch,
      pinned: position.kind === "bottom", top: element?.scrollTop ?? 0, target, phase: diagnosticPhase };
    onDiagnostic?.(event);
    element?.dispatchEvent(new CustomEvent("paige:scroll-diagnostic", { detail: event, bubbles: true }));
  };

  const messageDomSignature = () => element
    ? Array.from(element.querySelectorAll<HTMLElement>(MESSAGE_SELECTOR))
      .map((item) => item.dataset.paigeMessageId ?? "")
      .join("\u0000")
    : "";

  const markRestoring = () => {
    if (!element) return;
    restoring = true;
    const view = element.ownerDocument.defaultView;
    const request = view?.requestAnimationFrame?.bind(view) ?? requestAnimationFrame;
    const cancel = view?.cancelAnimationFrame?.bind(view) ?? cancelAnimationFrame;
    if (releaseFrame !== null) cancel(releaseFrame);
    releaseFrame = request(() => {
      releaseFrame = null;
      restoring = false;
    });
  };

  const storageKey = () => `${storagePrefix}:${encodeURIComponent(context)}`;
  const readPosition = (): TranscriptPosition => {
    try {
      const raw = sessionStorage.getItem(storageKey());
      if (!raw) return { kind: "bottom" };
      const parsed = JSON.parse(raw) as TranscriptPosition;
      if (parsed.kind === "bottom") return parsed;
      if (parsed.kind === "anchor" && typeof parsed.messageId === "string" && Number.isFinite(parsed.offsetPx)) {
        return parsed;
      }
    } catch { /* session storage can be unavailable in hardened browsers */ }
    return { kind: "bottom" };
  };
  const persist = () => {
    try { sessionStorage.setItem(storageKey(), JSON.stringify(position)); } catch { /* best effort */ }
  };
  const pinned = () => position.kind === "bottom";
  const announcePinned = () => onPinnedChange?.(pinned());
  const hasVisibleGeometry = () => {
    if (!element || !element.isConnected || element.closest("[hidden]")) return false;
    const view = element.ownerDocument.defaultView;
    for (let owner: HTMLElement | null = element; owner; owner = owner.parentElement) {
      const style = view?.getComputedStyle(owner);
      if (style?.display === "none"
        || style?.visibility === "hidden"
        || style?.visibility === "collapse"
        || style?.contentVisibility === "hidden") return false;
    }
    return element.clientHeight > 0 && element.scrollHeight > 0 && element.getBoundingClientRect().width > 0;
  };

  const restore = (source: ScrollSource = "layout-effect") => {
    if (!element || !hasVisibleGeometry()) { trace(source, "hidden"); return; }
    bindCurrentView();
    // Native/compositor movement may precede its queued scroll notification.
    // Capture it before any layout callback can restore an obsolete anchor.
    if ((pendingUserMovement || continuousUserMovement) && element.scrollTop !== lastScrollTop
      && gestureGeometryIsCurrent()) {
      restoring = false;
      handleScroll();
    }
    if (position.kind === "bottom") {
      const target = Math.max(0, element.scrollHeight - element.clientHeight);
      if (Math.abs(element.scrollTop - target) > EXACT_BOTTOM_EPSILON_PX) {
        markRestoring();
        trace(source, "write", target);
        element.scrollTop = target;
        lastScrollTop = element.scrollTop;
      }
      snapshotGestureGeometry();
      announcePinned();
      return;
    }
    const anchorPosition = position;
    const items = Array.from(element.querySelectorAll<HTMLElement>(MESSAGE_SELECTOR));
    const awaitingIncomingThread = pendingContextDomSignature !== null;
    if (awaitingIncomingThread && messageDomSignature() === pendingContextDomSignature) return;

    let anchor = items.find((item) => item.dataset.paigeMessageId === anchorPosition.messageId);
    if (!anchor && anchorPosition.semanticKey) {
      const semanticMatches = items.filter((item) => item.dataset.paigeMessageAnchorKey === anchorPosition.semanticKey);
      if (awaitingIncomingThread) {
        // A semantic match may repeat across threads. During a context handoff,
        // also require its recorded relative position before accepting a new ID.
        anchor = semanticMatches.find((item) =>
          anchorPosition.indexFromEnd !== undefined
          && items.length - 1 - items.indexOf(item) === anchorPosition.indexFromEnd)
          ?? semanticMatches.find((item) =>
            anchorPosition.indexFromEnd === undefined
            && anchorPosition.indexFromStart !== undefined
            && items.indexOf(item) === anchorPosition.indexFromStart);
      } else {
        anchor = semanticMatches.length === 1
          ? semanticMatches[0]
          : semanticMatches.find((item) => items.length - 1 - items.indexOf(item) === anchorPosition.indexFromEnd)
            ?? semanticMatches.find((item) => items.indexOf(item) === anchorPosition.indexFromStart);
      }
    }
    // Never guess from a bare list index. During refresh/hydration, transient
    // content can occupy the same index and must not replace a valid anchor.
    if (!anchor) return;
    pendingContextDomSignature = null;
    const reconciledIndex = items.indexOf(anchor);
    const reconciledMessageId = anchor.dataset.paigeMessageId;
    const reconciledSemanticKey = anchor.dataset.paigeMessageAnchorKey;
    const reconciledIndexFromEnd = items.length - 1 - reconciledIndex;
    if (reconciledMessageId && (
      reconciledMessageId !== anchorPosition.messageId
      || reconciledSemanticKey !== anchorPosition.semanticKey
      || reconciledIndex !== anchorPosition.indexFromStart
      || reconciledIndexFromEnd !== anchorPosition.indexFromEnd
    )) {
      position = {
        ...anchorPosition,
        messageId: reconciledMessageId,
        semanticKey: reconciledSemanticKey,
        indexFromStart: reconciledIndex,
        indexFromEnd: reconciledIndexFromEnd,
      };
      persist();
    }
    const delta = anchor.getBoundingClientRect().top
      - element.getBoundingClientRect().top
      - anchorPosition.offsetPx;
    if (Math.abs(delta) > 0.75) {
      markRestoring();
      trace(source, "write", element.scrollTop + delta);
      element.scrollTop += delta;
      lastScrollTop = element.scrollTop;
    }
    snapshotGestureGeometry();
    announcePinned();
  };

  const scheduleRestore = (source: ScrollSource) => {
    if (!element || animationFrame !== null) return;
    const view = element.ownerDocument.defaultView;
    const request = view?.requestAnimationFrame?.bind(view) ?? requestAnimationFrame;
    const scheduledEpoch = intentEpoch;
    animationFrame = request(() => {
      animationFrame = null;
      if (scheduledEpoch !== intentEpoch) { trace(source, "rejected"); return; }
      diagnosticPhase = "animation-frame";
      try { restore(source); } finally { diagnosticPhase = "synchronous"; }
    });
  };

  const observeSizes = () => {
    if (!element || !resizeObserver) return;
    resizeObserver.disconnect();
    resizeObserver.observe(element);
    const observed = new Set<HTMLElement>([
      ...Array.from(element.children).filter((child): child is HTMLElement => child instanceof HTMLElement),
      ...Array.from(element.querySelectorAll<HTMLElement>(MESSAGE_SELECTOR)),
    ]);
    observed.forEach((item) => resizeObserver?.observe(item));
  };

  const disconnectObservers = () => {
    mutationObserver?.disconnect();
    resizeObserver?.disconnect();
    mutationObserver = null;
    resizeObserver = null;
    if (animationFrame !== null && element) {
      const cancel = element.ownerDocument.defaultView?.cancelAnimationFrame?.bind(element.ownerDocument.defaultView)
        ?? cancelAnimationFrame;
      cancel(animationFrame);
      animationFrame = null;
    }
    if (releaseFrame !== null && element) {
      const cancel = element.ownerDocument.defaultView?.cancelAnimationFrame?.bind(element.ownerDocument.defaultView)
        ?? cancelAnimationFrame;
      cancel(releaseFrame);
      releaseFrame = null;
    }
    restoring = false;
  };

  const cancelProgrammaticMovement = () => {
    intentEpoch += 1;
    if (animationFrame !== null && element) {
      const view = element.ownerDocument.defaultView;
      (view?.cancelAnimationFrame?.bind(view) ?? cancelAnimationFrame)(animationFrame);
      animationFrame = null;
    }
    // Abort a browser-owned smooth animation at its current position.
    if (intentionalBottom && element && hasVisibleGeometry()) {
      trace("scroll-event", "write", element.scrollTop);
      element.scrollTo?.({ top: element.scrollTop, behavior: "instant" as ScrollBehavior });
    }
    intentionalBottom = false;
    if (releaseFrame !== null && element) {
      const cancel = element.ownerDocument.defaultView?.cancelAnimationFrame?.bind(element.ownerDocument.defaultView)
        ?? cancelAnimationFrame;
      cancel(releaseFrame);
      releaseFrame = null;
    }
    restoring = false;
  };

  const endUserMovement = () => {
    if (element && hasVisibleGeometry() && element.scrollTop !== lastScrollTop) handleScroll();
    continuousUserMovement = false;
    pendingUserMovement = false;
    keyboardKey = null;
  };

  const beginOneShotUserMovement = (event?: Event) => {
    if (event instanceof KeyboardEvent && !SCROLL_KEYS.has(event.key)) return;
    cancelProgrammaticMovement();
    pendingUserMovement = true;
    snapshotGestureGeometry();
    trace("owner-wheel", "intent");
  };

  const beginContinuousUserMovement = (event?: Event) => {
    cancelProgrammaticMovement();
    pendingUserMovement = true;
    continuousUserMovement = true;
    snapshotGestureGeometry();
    if (event?.type === "touchstart") trace("owner-touch", "intent");
  };

  const snapshotGestureGeometry = () => {
    if (!element || !hasVisibleGeometry()) return;
    gestureNode = Array.from(element.querySelectorAll<HTMLElement>(MESSAGE_SELECTOR))
      .find((item) => item.getBoundingClientRect().bottom > element!.getBoundingClientRect().top) ?? null;
    gestureNodeTop = gestureNode ? gestureNode.getBoundingClientRect().top + element.scrollTop : 0;
    gestureViewportHeight = element.clientHeight;
  };

  const gestureGeometryIsCurrent = () => !!element && !!gestureNode && element.contains(gestureNode)
    && element.clientHeight === gestureViewportHeight
    && Math.abs(gestureNode.getBoundingClientRect().top + element.scrollTop - gestureNodeTop) <= 0.5;

  const beginKeyboardUserMovement = (event: KeyboardEvent) => {
    if (!SCROLL_KEYS.has(event.key)) return;
    keyboardKey = event.key;
    beginContinuousUserMovement();
    trace("owner-keyboard", "intent");
  };

  const beginWindowTabMovement = (event: KeyboardEvent) => {
    // Reverse Tab can enter an offscreen message control from the composer, so
    // its initiating keydown is outside the transcript even though the browser
    // then scrolls this transcript to reveal the focused descendant.
    if (event.key !== "Tab") return;
    keyboardKey = "Tab";
    beginContinuousUserMovement();
  };

  const beginTranscriptFocusMovement = (event: FocusEvent) => {
    if (!element) return;
    const NodeConstructor = element.ownerDocument.defaultView?.Node;
    if (!NodeConstructor || !(event.target instanceof NodeConstructor) || !element.contains(event.target)) return;
    // Programmatic focus is not owner intent. Real Tab keydown already armed
    // the gesture before the browser reveals a focused message control.
    if (keyboardKey === "Tab") return;
    pendingUserMovement = false;
    continuousUserMovement = false;
    trace("focus", "rejected");
    scheduleRestore("focus");
  };

  const beginPointerUserMovement = (event: Event) => {
    // Native scrollbar drags target the scroll owner. A click on message
    // content is not a scroll instruction and must not arm a later update.
    if (event.target !== element) return;
    beginContinuousUserMovement();
    trace("owner-pointer", "intent");
  };

  const finishContinuousUserInput = () => {
    continuousUserMovement = false;
    // Tab focus completes synchronously; a later layout scroll is not that Tab.
    // Wheel/touch/key scrolling finishes on native scrollend, never a timer.
    if (keyboardKey === "Tab") endUserMovement();
  };

  const bindCurrentView = () => {
    const nextView = element?.ownerDocument.defaultView ?? null;
    if (nextView === boundView) return;
    boundView?.removeEventListener("pointerup", finishContinuousUserInput);
    boundView?.removeEventListener("pointercancel", finishContinuousUserInput);
    boundView?.removeEventListener("keydown", beginWindowTabMovement);
    boundView?.removeEventListener("keyup", finishContinuousUserInput);
    boundView?.removeEventListener("blur", finishContinuousUserInput);
    boundView = nextView;
    boundView?.addEventListener("pointerup", finishContinuousUserInput, { passive: true });
    boundView?.addEventListener("pointercancel", finishContinuousUserInput, { passive: true });
    boundView?.addEventListener("keydown", beginWindowTabMovement);
    boundView?.addEventListener("keyup", finishContinuousUserInput);
    boundView?.addEventListener("blur", finishContinuousUserInput);
  };

  const handleScroll = () => {
    if (!element) return pinned();
    bindCurrentView();
    if (!hasVisibleGeometry()) {
      pendingUserMovement = false;
      return pinned();
    }
    const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    const atExactBottom = distanceFromBottom <= EXACT_BOTTOM_EPSILON_PX;
    if (restoring && (element.scrollTop === lastScrollTop || (!pendingUserMovement && !continuousUserMovement))) return pinned();
    if (intentionalBottom) {
      position = { kind: "bottom" };
      if (atExactBottom) intentionalBottom = false;
      persist();
      announcePinned();
      lastScrollTop = element.scrollTop;
      return true;
    }
    const userMoved = pendingUserMovement || continuousUserMovement;
    if (!userMoved) {
      // Resize, hydration and browser anchoring may emit scroll events. They do
      // not own the reading position and must not replace the saved intent.
      return pinned();
    }
    // A replaced transcript or resized/clamped viewport is not native input.
    // Keep the saved semantic anchor until it can be restored against real DOM.
    if (!gestureGeometryIsCurrent()) return pinned();
    pendingContextDomSignature = null;
    if (atExactBottom) {
      position = { kind: "bottom" };
    } else {
      const viewport = element.getBoundingClientRect();
      const items = Array.from(element.querySelectorAll<HTMLElement>(MESSAGE_SELECTOR));
      const anchor = items.find((item) => item.getBoundingClientRect().bottom > viewport.top)
        ?? items[0];
      if (anchor?.dataset.paigeMessageId) {
        const anchorIndex = items.indexOf(anchor);
        position = {
          kind: "anchor",
          messageId: anchor.dataset.paigeMessageId,
          semanticKey: anchor.dataset.paigeMessageAnchorKey,
          indexFromStart: anchorIndex,
          indexFromEnd: items.length - 1 - anchorIndex,
          offsetPx: anchor.getBoundingClientRect().top - viewport.top,
        };
      }
    }
    persist();
    lastScrollTop = element.scrollTop;
    snapshotGestureGeometry();
    trace("scroll-event", "capture");
    announcePinned();
    return pinned();
  };

  const detach = () => {
    disconnectObservers();
    element?.removeEventListener("wheel", beginOneShotUserMovement);
    element?.removeEventListener("touchstart", beginContinuousUserMovement);
    element?.removeEventListener("touchend", finishContinuousUserInput);
    element?.removeEventListener("touchcancel", finishContinuousUserInput);
    element?.removeEventListener("pointerdown", beginPointerUserMovement);
    element?.removeEventListener("keydown", beginKeyboardUserMovement);
    element?.removeEventListener("focusin", beginTranscriptFocusMovement);
    boundView?.removeEventListener("pointerup", finishContinuousUserInput);
    boundView?.removeEventListener("pointercancel", finishContinuousUserInput);
    boundView?.removeEventListener("keydown", beginWindowTabMovement);
    boundView?.removeEventListener("keyup", finishContinuousUserInput);
    boundView?.removeEventListener("blur", finishContinuousUserInput);
    boundView = null;
    element?.removeEventListener("scrollend", endUserMovement);
    intentionalBottom = false;
    pendingUserMovement = false;
    continuousUserMovement = false;
    element = null;
  };

  return {
    setContext(nextContext: string) {
      if (nextContext === context) return;
      cancelProgrammaticMovement();
      pendingUserMovement = false;
      continuousUserMovement = false;
      context = nextContext;
      position = readPosition();
      if (element && position.kind === "anchor") {
        const incomingPosition = position;
        const items = Array.from(element.querySelectorAll<HTMLElement>(MESSAGE_SELECTOR));
        // Content can legitimately repeat across threads. Only the persisted,
        // thread-owned ID proves this is the incoming DOM; semantic matching is
        // safe only after the mounted message-ID set changes.
        const incomingAnchorIsMounted = items.some((item) =>
          item.dataset.paigeMessageId === incomingPosition.messageId);
        pendingContextDomSignature = incomingAnchorIsMounted ? null : messageDomSignature();
      } else {
        pendingContextDomSignature = null;
      }
      restore("hydration");
    },
    adoptContext(nextContext: string) {
      if (nextContext === context) return;
      // The server can assign the durable thread ID after a new conversation is
      // already visible. That is an identity adoption, not a thread switch.
      cancelProgrammaticMovement();
      context = nextContext;
      pendingContextDomSignature = null;
      persist();
      trace("thread-adoption", "capture");
      announcePinned();
    },
    attach(nextElement: HTMLDivElement | null) {
      if (element === nextElement) return;
      detach();
      element = nextElement;
      if (!element) return;
      element.style.overflowAnchor = "none";
      element.addEventListener("wheel", beginOneShotUserMovement, { passive: true });
      element.addEventListener("touchstart", beginContinuousUserMovement, { passive: true });
      element.addEventListener("touchend", finishContinuousUserInput, { passive: true });
      element.addEventListener("touchcancel", finishContinuousUserInput, { passive: true });
      element.addEventListener("pointerdown", beginPointerUserMovement, { passive: true });
      element.addEventListener("keydown", beginKeyboardUserMovement);
      element.addEventListener("focusin", beginTranscriptFocusMovement);
      // Tab can move focus outside the transcript before keyup. Window owns the
      // release so keyboard intent cannot remain armed for a later layout scroll.
      bindCurrentView();
      element.addEventListener("scrollend", endUserMovement);
      const view = element.ownerDocument.defaultView;
      const Mutation = view?.MutationObserver ?? globalThis.MutationObserver;
      const Resize = view?.ResizeObserver ?? globalThis.ResizeObserver;
      if (typeof Mutation !== "undefined") {
        mutationObserver = new Mutation(() => { observeSizes(); scheduleRestore("message-render"); });
        mutationObserver.observe(element, { childList: true, subtree: true, characterData: true });
      }
      if (typeof Resize !== "undefined") {
        resizeObserver = new Resize(() => scheduleRestore("resize-observer"));
        observeSizes();
      }
      restore("popout-restore");
    },
    detach,
    destroy: detach,
    handleScroll,
    notifyLayoutChange(source: ScrollSource = "layout-effect") {
      bindCurrentView();
      restore(source);
    },
    isAtBottom: pinned,
    /**
     * The person acted on something inside a message (C3a: opened "What PAIGE did") and that
     * message is about to grow. Hold the message where it is now — the same anchor a scroll by
     * the person would record — so the growth extends below it instead of pushing it up out of
     * view while the transcript follows the bottom. It is an owner action, so following the bottom
     * stops exactly as it would after an owner scroll; "jump to latest" brings it back.
     */
    holdMessageAt(node: HTMLElement) {
      if (!element || !hasVisibleGeometry() || !element.contains(node)) return;
      const item = node.closest<HTMLElement>(MESSAGE_SELECTOR);
      if (!item || !element.contains(item) || !item.dataset.paigeMessageId) return;
      cancelProgrammaticMovement();
      intentionalBottom = false;
      pendingContextDomSignature = null;
      const items = Array.from(element.querySelectorAll<HTMLElement>(MESSAGE_SELECTOR));
      const index = items.indexOf(item);
      position = {
        kind: "anchor",
        messageId: item.dataset.paigeMessageId,
        semanticKey: item.dataset.paigeMessageAnchorKey,
        indexFromStart: index,
        indexFromEnd: items.length - 1 - index,
        offsetPx: item.getBoundingClientRect().top - element.getBoundingClientRect().top,
      };
      persist();
      lastScrollTop = element.scrollTop;
      snapshotGestureGeometry();
      trace("owner-pointer", "capture");
      announcePinned();
    },
    jumpToBottom(behavior: ScrollBehavior = "auto") {
      if (!element || !hasVisibleGeometry()) return;
      cancelProgrammaticMovement();
      endUserMovement();
      intentionalBottom = behavior === "smooth";
      pendingContextDomSignature = null;
      position = { kind: "bottom" };
      persist();
      trace("jump-to-latest", "write", element.scrollHeight);
      if (typeof element.scrollTo === "function") {
        element.scrollTo({ top: element.scrollHeight, behavior });
      } else {
        element.scrollTop = element.scrollHeight;
      }
      lastScrollTop = element.scrollTop;
      announcePinned();
    },
  };
}

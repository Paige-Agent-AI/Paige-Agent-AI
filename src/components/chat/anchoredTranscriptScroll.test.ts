import { afterEach, describe, expect, it, vi } from "vitest";
import { createAnchoredTranscriptScroll } from "./anchoredTranscriptScroll";

type Geometry = {
  viewportTop: number;
  clientHeight: number;
  scrollHeight: number;
  items: Record<string, { top: number; height: number }>;
};

function transcriptFixture(geometry: Geometry) {
  const element = document.createElement("div");
  document.body.append(element);
  Object.defineProperties(element, {
    clientHeight: { configurable: true, get: () => geometry.clientHeight },
    scrollHeight: { configurable: true, get: () => geometry.scrollHeight },
  });
  element.getBoundingClientRect = () => ({
    x: 0, y: geometry.viewportTop, left: 0, right: 600,
    top: geometry.viewportTop, bottom: geometry.viewportTop + geometry.clientHeight,
    width: 600, height: geometry.clientHeight, toJSON: () => ({}),
  });

  const render = (ids: string[], semanticKeys: Record<string, string> = {}) => {
    element.replaceChildren(...ids.map((id) => {
      const item = document.createElement("article");
      item.dataset.paigeMessageId = id;
      item.dataset.paigeMessageAnchorKey = semanticKeys[id] ?? `message:${id}`;
      item.getBoundingClientRect = () => {
        const box = geometry.items[id];
        const top = geometry.viewportTop + box.top - element.scrollTop;
        return {
          x: 0, y: top, left: 0, right: 600, top, bottom: top + box.height,
          width: 600, height: box.height, toJSON: () => ({}),
        };
      };
      return item;
    }));
  };

  return { element, render };
}

afterEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("createAnchoredTranscriptScroll", () => {
  it("does not treat fractional manual distance as a near-bottom pin", () => {
    const geometry: Geometry = { viewportTop: 0, clientHeight: 300, scrollHeight: 1200,
      items: { a: { top: 0, height: 1200 } } };
    const { element, render } = transcriptFixture(geometry);
    render(["a"]);
    const controller = createAnchoredTranscriptScroll({ storagePrefix: "fractional" });
    controller.attach(element);
    element.dispatchEvent(new WheelEvent("wheel"));
    element.scrollTop = 899.75;
    controller.handleScroll();
    element.dispatchEvent(new Event("scrollend"));
    geometry.scrollHeight += 100;
    controller.notifyLayoutChange();
    expect(controller.isAtBottom()).toBe(false);
    expect(element.scrollTop).toBe(899.75);
    controller.destroy();
  });

  it("aborts an in-flight native smooth jump when the owner intervenes", () => {
    const geometry: Geometry = { viewportTop: 0, clientHeight: 300, scrollHeight: 1200,
      items: { a: { top: 0, height: 1200 } } };
    const { element, render } = transcriptFixture(geometry);
    render(["a"]);
    const scrollTo = vi.fn();
    element.scrollTo = scrollTo;
    const controller = createAnchoredTranscriptScroll({ storagePrefix: "smooth-interrupt" });
    controller.attach(element);
    element.dispatchEvent(new WheelEvent("wheel"));
    element.scrollTop = 425;
    controller.handleScroll();
    controller.jumpToBottom("smooth");
    element.scrollTop = 500;
    controller.handleScroll();
    element.dispatchEvent(new WheelEvent("wheel", { deltaY: -1 }));
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 500, behavior: "instant" });
    element.scrollTop = 499;
    controller.notifyLayoutChange();
    expect(element.scrollTop).toBe(499);
    expect(controller.isAtBottom()).toBe(false);
    controller.destroy();
  });

  it("never writes or captures a detached transcript and restores it on return", () => {
    const geometry: Geometry = { viewportTop: 0, clientHeight: 300, scrollHeight: 1200,
      items: { a: { top: 0, height: 1200 } } };
    const { element, render } = transcriptFixture(geometry);
    render(["a"]);
    const controller = createAnchoredTranscriptScroll({ storagePrefix: "detached" });
    controller.attach(element);
    element.dispatchEvent(new WheelEvent("wheel"));
    element.scrollTop = 425;
    controller.handleScroll();
    element.remove();
    element.scrollTop = 0;
    controller.handleScroll();
    controller.notifyLayoutChange();
    controller.jumpToBottom();
    expect(element.scrollTop).toBe(0);
    document.body.append(element);
    controller.notifyLayoutChange();
    expect(element.scrollTop).toBe(425);
    controller.destroy();
  });

  it.each(["wheel", "touchstart", "pointerdown", "keydown"])("does not let a delayed layout writer overtake the %s scroll event", (type) => {
    const geometry: Geometry = {
      viewportTop: 0, clientHeight: 300, scrollHeight: 1200,
      items: { a: { top: 0, height: 300 }, b: { top: 300, height: 300 }, c: { top: 600, height: 300 }, d: { top: 900, height: 300 } },
    };
    const { element, render } = transcriptFixture(geometry);
    render(["a", "b", "c", "d"]);
    const controller = createAnchoredTranscriptScroll({ storagePrefix: "delayed-" + type });
    controller.attach(element);
    element.dispatchEvent(type === "keydown" ? new KeyboardEvent(type, { key: "ArrowUp" }) : new Event(type));
    element.scrollTop = 899;
    // Compositor scrolling has happened, but React/ResizeObserver can run
    // before the native scroll event is delivered to React's handler.
    controller.notifyLayoutChange();
    controller.handleScroll();
    expect(element.scrollTop).toBe(899);
    expect(controller.isAtBottom()).toBe(false);
    controller.destroy();
  });

  it("retains wheel ownership after idle frames and a delayed scroll notification", () => {
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrame = 0;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.set(++nextFrame, callback); return nextFrame;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => { frames.delete(id); });
    const flush = () => {
      const batch = [...frames.values()]; frames.clear();
      batch.forEach((callback) => callback(performance.now()));
    };
    const geometry: Geometry = {
      viewportTop: 0, clientHeight: 300, scrollHeight: 1200,
      items: { a: { top: 0, height: 300 }, b: { top: 300, height: 300 }, c: { top: 600, height: 300 }, d: { top: 900, height: 300 } },
    };
    const { element, render } = transcriptFixture(geometry);
    render(["a", "b", "c", "d"]);
    const controller = createAnchoredTranscriptScroll({ storagePrefix: "idle-owner" });
    controller.attach(element);
    flush();
    element.dispatchEvent(new WheelEvent("wheel", { deltaY: -1 }));
    for (let index = 0; index < 120; index += 1) flush();
    element.scrollTop = 899;
    controller.handleScroll();
    geometry.items.d.height += 100;
    geometry.scrollHeight += 100;
    controller.notifyLayoutChange();
    expect(element.scrollTop).toBe(899);
    expect(controller.isAtBottom()).toBe(false);
    controller.destroy();
  });

  it("does not grant a delayed programmatic focus permission to replace the reading anchor", () => {
    const geometry: Geometry = {
      viewportTop: 0, clientHeight: 300, scrollHeight: 1200,
      items: { a: { top: 0, height: 300 }, b: { top: 300, height: 300 }, c: { top: 600, height: 300 }, d: { top: 900, height: 300 } },
    };
    const { element, render } = transcriptFixture(geometry);
    render(["a", "b", "c", "d"]);
    const controller = createAnchoredTranscriptScroll({ storagePrefix: "focus-owner" });
    controller.attach(element);
    element.dispatchEvent(new WheelEvent("wheel"));
    element.scrollTop = 899;
    controller.handleScroll();
    element.children[1].dispatchEvent(new FocusEvent("focusin", { bubbles: true, relatedTarget: element.firstElementChild }));
    element.scrollTop = 300;
    controller.handleScroll();
    controller.notifyLayoutChange();
    expect(element.scrollTop).toBe(899);
    expect(controller.isAtBottom()).toBe(false);
    controller.destroy();
  });

  it("keeps accepting the same touch gesture after a layout compensation", () => {
    const geometry: Geometry = {
      viewportTop: 0, clientHeight: 300, scrollHeight: 1200,
      items: { a: { top: 0, height: 300 }, b: { top: 300, height: 300 }, c: { top: 600, height: 300 }, d: { top: 900, height: 300 } },
    };
    const { element, render } = transcriptFixture(geometry);
    render(["a", "b", "c", "d"]);
    const controller = createAnchoredTranscriptScroll({ storagePrefix: "continued-touch" });
    controller.attach(element);
    element.dispatchEvent(new Event("touchstart"));
    element.scrollTop = 425;
    controller.handleScroll();
    geometry.clientHeight = 250;
    controller.notifyLayoutChange();
    element.scrollTop = 424;
    controller.handleScroll();
    controller.notifyLayoutChange();
    expect(element.scrollTop).toBe(424);
    controller.destroy();
  });

  it.each([
    ["wheel", () => new WheelEvent("wheel")],
    ["touch", () => new Event("touchstart")],
    ["pointer/scrollbar", () => new Event("pointerdown")],
    ["keyboard", () => new KeyboardEvent("keydown", { key: "ArrowUp" })],
  ])("lets a deliberate %s movement one pixel away from bottom immediately win", (label, inputEvent) => {
    const geometry: Geometry = {
      viewportTop: 0, clientHeight: 300, scrollHeight: 1_200,
      items: { a: { top: 0, height: 300 }, b: { top: 300, height: 300 }, c: { top: 600, height: 300 }, d: { top: 900, height: 300 } },
    };
    const { element, render } = transcriptFixture(geometry);
    render(["a", "b", "c", "d"]);
    const controller = createAnchoredTranscriptScroll({ storagePrefix: "test-one-pixel-" + label });
    controller.setContext("thread-a");
    controller.attach(element);
    expect(element.scrollTop).toBe(900);
    element.dispatchEvent(inputEvent());
    element.scrollTop = 899;
    expect(controller.handleScroll()).toBe(false);
    const before = element.querySelector<HTMLElement>('[data-paige-message-id="c"]')!.getBoundingClientRect().top
      - element.getBoundingClientRect().top;
    geometry.items.d.height += 120;
    geometry.scrollHeight += 120;
    controller.notifyLayoutChange();
    expect(element.scrollTop).toBe(899);
    expect(element.querySelector<HTMLElement>('[data-paige-message-id="c"]')!.getBoundingClientRect().top
      - element.getBoundingClientRect().top).toBe(before);
    expect(element.scrollTop).not.toBe(geometry.scrollHeight - geometry.clientHeight);
  });

  it("does not let hidden/minimized geometry replace a valid reading anchor", () => {
    const geometry: Geometry = {
      viewportTop: 20, clientHeight: 300, scrollHeight: 1_200,
      items: { a: { top: 0, height: 300 }, b: { top: 300, height: 300 }, c: { top: 600, height: 300 }, d: { top: 900, height: 300 } },
    };
    const { element, render } = transcriptFixture(geometry);
    render(["a", "b", "c", "d"]);
    const controller = createAnchoredTranscriptScroll({ storagePrefix: "test-hidden-return" });
    controller.setContext("thread-a");
    controller.attach(element);
    element.dispatchEvent(new WheelEvent("wheel"));
    element.scrollTop = 425;
    controller.handleScroll();
    const before = element.querySelector<HTMLElement>('[data-paige-message-id="b"]')!.getBoundingClientRect().top
      - element.getBoundingClientRect().top;
    geometry.clientHeight = 0;
    geometry.scrollHeight = 0;
    element.scrollTop = 0;
    controller.handleScroll();
    controller.notifyLayoutChange();
    geometry.viewportTop = 80;
    geometry.clientHeight = 300;
    geometry.scrollHeight = 1_200;
    controller.notifyLayoutChange();
    expect(element.scrollTop).toBe(425);
    expect(element.querySelector<HTMLElement>('[data-paige-message-id="b"]')!.getBoundingClientRect().top
      - element.getBoundingClientRect().top).toBe(before);
  });

  it("reconciles a valid reading anchor when server rehydration replaces message IDs", () => {
    const geometry: Geometry = {
      viewportTop: 0, clientHeight: 300, scrollHeight: 1_200,
      items: { a: { top: 0, height: 300 }, b: { top: 300, height: 300 }, c: { top: 600, height: 300 }, d: { top: 900, height: 300 }, "db-a": { top: 0, height: 300 }, "db-b": { top: 300, height: 300 }, "db-c": { top: 600, height: 300 }, "db-d": { top: 900, height: 300 } },
    };
    const { element, render } = transcriptFixture(geometry);
    render(["a", "b", "c", "d"]);
    const controller = createAnchoredTranscriptScroll({ storagePrefix: "test-rehydrated-id" });
    controller.setContext("thread-a");
    controller.attach(element);
    element.dispatchEvent(new WheelEvent("wheel"));
    element.scrollTop = 425;
    controller.handleScroll();
    const before = element.querySelector<HTMLElement>('[data-paige-message-id="b"]')!.getBoundingClientRect().top;

    render(["db-a", "db-b", "db-c", "db-d"], {
      "db-a": "message:a", "db-b": "message:b", "db-c": "message:c", "db-d": "message:d",
    });
    element.scrollTop = 0;
    controller.notifyLayoutChange();

    expect(element.scrollTop).toBe(425);
    expect(element.querySelector<HTMLElement>('[data-paige-message-id="db-b"]')!.getBoundingClientRect().top).toBe(before);
    expect(sessionStorage.getItem("test-rehydrated-id:thread-a")).toContain('"messageId":"db-b"');
  });

  it("keeps touch ownership through inertial scroll events after touchend", () => {
    const geometry: Geometry = {
      viewportTop: 0, clientHeight: 300, scrollHeight: 1_200,
      items: { a: { top: 0, height: 300 }, b: { top: 300, height: 300 }, c: { top: 600, height: 300 }, d: { top: 900, height: 300 } },
    };
    const { element, render } = transcriptFixture(geometry);
    render(["a", "b", "c", "d"]);
    const controller = createAnchoredTranscriptScroll({ storagePrefix: "test-touch-inertia" });
    controller.setContext("thread-a");
    controller.attach(element);
    element.dispatchEvent(new Event("touchstart"));
    element.scrollTop = 700;
    controller.handleScroll();
    element.dispatchEvent(new Event("touchend"));
    element.scrollTop = 610;
    controller.handleScroll();
    geometry.items.d.height += 100;
    geometry.scrollHeight += 100;
    controller.notifyLayoutChange();
    expect(element.scrollTop).toBe(610);
  });

  it("updates the anchor through every event in one keyboard scroll sequence", () => {
    const geometry: Geometry = {
      viewportTop: 0, clientHeight: 300, scrollHeight: 1_200,
      items: { a: { top: 0, height: 300 }, b: { top: 300, height: 300 }, c: { top: 600, height: 300 }, d: { top: 900, height: 300 } },
    };
    const { element, render } = transcriptFixture(geometry);
    render(["a", "b", "c", "d"]);
    const controller = createAnchoredTranscriptScroll({ storagePrefix: "test-keyboard-sequence" });
    controller.setContext("thread-a");
    controller.attach(element);
    element.dispatchEvent(new KeyboardEvent("keydown", { key: "PageUp" }));
    element.scrollTop = 780;
    controller.handleScroll();
    element.scrollTop = 620;
    controller.handleScroll();
    element.dispatchEvent(new KeyboardEvent("keyup", { key: "PageUp" }));
    geometry.items.d.height += 100;
    geometry.scrollHeight += 100;
    controller.notifyLayoutChange();
    expect(element.scrollTop).toBe(620);
  });

  it("treats Tab focus navigation that scrolls an older message into view as user ownership", () => {
    const geometry: Geometry = {
      viewportTop: 0, clientHeight: 300, scrollHeight: 1_200,
      items: { a: { top: 0, height: 300 }, b: { top: 300, height: 300 }, c: { top: 600, height: 300 }, d: { top: 900, height: 300 } },
    };
    const { element, render } = transcriptFixture(geometry);
    render(["a", "b", "c", "d"]);
    const controller = createAnchoredTranscriptScroll({ storagePrefix: "test-tab-focus-scroll" });
    controller.setContext("thread-a");
    controller.attach(element);
    element.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    element.scrollTop = 410;
    controller.handleScroll();
    element.dispatchEvent(new KeyboardEvent("keyup", { key: "Tab", bubbles: true }));
    geometry.items.d.height += 100;
    geometry.scrollHeight += 100;
    controller.notifyLayoutChange();
    expect(element.scrollTop).toBe(410);
  });

  it("releases Tab ownership when keyup lands after focus leaves the transcript", async () => {
    const geometry: Geometry = {
      viewportTop: 0, clientHeight: 300, scrollHeight: 1_200,
      items: { a: { top: 0, height: 300 }, b: { top: 300, height: 300 }, c: { top: 600, height: 300 }, d: { top: 900, height: 300 } },
    };
    const { element, render } = transcriptFixture(geometry);
    const composer = document.createElement("textarea");
    document.body.append(element, composer);
    render(["a", "b", "c", "d"]);
    const controller = createAnchoredTranscriptScroll({ storagePrefix: "test-tab-focus-leave" });
    controller.setContext("thread-a");
    controller.attach(element);

    element.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    composer.focus();
    composer.dispatchEvent(new KeyboardEvent("keyup", { key: "Tab", bubbles: true }));
    await new Promise<void>((resolve) => requestAnimationFrame(() =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    element.scrollTop = 410;

    expect(controller.handleScroll()).toBe(true);
    controller.notifyLayoutChange();
    expect(element.scrollTop).toBe(900);
    composer.remove();
  });

  it("captures reverse Tab ownership before focus enters an offscreen message", () => {
    const geometry: Geometry = {
      viewportTop: 0, clientHeight: 300, scrollHeight: 1_200,
      items: { a: { top: 0, height: 300 }, b: { top: 300, height: 300 }, c: { top: 600, height: 300 }, d: { top: 900, height: 300 } },
    };
    const { element, render } = transcriptFixture(geometry);
    const composer = document.createElement("textarea");
    document.body.append(element, composer);
    render(["a", "b", "c", "d"]);
    const controller = createAnchoredTranscriptScroll({ storagePrefix: "test-reverse-tab-entry" });
    controller.setContext("thread-a");
    controller.attach(element);

    composer.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }));
    element.scrollTop = 410;
    expect(controller.handleScroll()).toBe(false);
    composer.dispatchEvent(new KeyboardEvent("keyup", { key: "Tab", shiftKey: true, bubbles: true }));

    geometry.items.d.height += 100;
    geometry.scrollHeight += 100;
    controller.notifyLayoutChange();
    expect(element.scrollTop).toBe(410);
    composer.remove();
  });

  it("rebinds reverse Tab ownership when the mounted transcript moves into a pop-out document", () => {
    const geometry: Geometry = {
      viewportTop: 0, clientHeight: 300, scrollHeight: 1_200,
      items: { a: { top: 0, height: 300 }, b: { top: 300, height: 300 }, c: { top: 600, height: 300 }, d: { top: 900, height: 300 } },
    };
    const { element, render } = transcriptFixture(geometry);
    render(["a", "b", "c", "d"]);
    const controller = createAnchoredTranscriptScroll({ storagePrefix: "test-popout-document" });
    controller.setContext("thread-a");
    controller.attach(element);

    const frame = document.createElement("iframe");
    document.body.append(frame);
    const popupDocument = frame.contentDocument!;
    const popupComposer = popupDocument.createElement("textarea");
    popupDocument.body.append(element, popupComposer);
    controller.notifyLayoutChange();

    popupComposer.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }));
    element.scrollTop = 410;
    expect(controller.handleScroll()).toBe(false);
    popupComposer.dispatchEvent(new KeyboardEvent("keyup", { key: "Tab", shiftKey: true, bubbles: true }));
    geometry.items.d.height += 100;
    geometry.scrollHeight += 100;
    controller.notifyLayoutChange();
    expect(element.scrollTop).toBe(410);
    frame.remove();
  });

  it("does not reconcile an incoming thread anchor against outgoing thread DOM", () => {
    const geometry: Geometry = {
      viewportTop: 0, clientHeight: 300, scrollHeight: 1_200,
      items: { a: { top: 0, height: 300 }, b: { top: 300, height: 300 }, c: { top: 600, height: 300 }, d: { top: 900, height: 300 }, x: { top: 0, height: 600 }, y: { top: 600, height: 600 } },
    };
    sessionStorage.setItem("test-deferred-thread:thread-b", JSON.stringify({
      kind: "anchor", messageId: "old-y", semanticKey: "message:y", indexFromStart: 1, indexFromEnd: 0, offsetPx: -55,
    }));
    const { element, render } = transcriptFixture(geometry);
    render(["a", "b", "c", "d"], { b: "message:y" });
    const controller = createAnchoredTranscriptScroll({ storagePrefix: "test-deferred-thread" });
    controller.setContext("thread-a");
    controller.attach(element);
    element.scrollTop = 425;

    controller.setContext("thread-b");
    controller.notifyLayoutChange();
    expect(element.scrollTop).toBe(425);
    expect(sessionStorage.getItem("test-deferred-thread:thread-b")).toContain('"messageId":"old-y"');

    render(["x", "y"]);
    controller.notifyLayoutChange();
    expect(element.scrollTop).toBe(655);
    expect(sessionStorage.getItem("test-deferred-thread:thread-b")).toContain('"messageId":"y"');
  });

  it("does not replace an incoming thread anchor with transient hydration content", () => {
    const geometry: Geometry = {
      viewportTop: 0, clientHeight: 300, scrollHeight: 1_200,
      items: {
        a: { top: 0, height: 300 }, b: { top: 300, height: 300 }, c: { top: 600, height: 300 }, d: { top: 900, height: 300 },
        greeting: { top: 0, height: 300 }, x: { top: 0, height: 600 }, y: { top: 600, height: 600 },
      },
    };
    sessionStorage.setItem("test-transient-hydration:thread-b", JSON.stringify({
      kind: "anchor", messageId: "y", semanticKey: "message:y", indexFromStart: 1, indexFromEnd: 0, offsetPx: -55,
    }));
    const { element, render } = transcriptFixture(geometry);
    render(["a", "b", "c", "d"]);
    const controller = createAnchoredTranscriptScroll({ storagePrefix: "test-transient-hydration" });
    controller.setContext("thread-a");
    controller.attach(element);
    element.scrollTop = 425;

    controller.setContext("thread-b");
    render(["greeting"]);
    geometry.scrollHeight = 300;
    controller.notifyLayoutChange();

    expect(element.scrollTop).toBe(425);
    expect(sessionStorage.getItem("test-transient-hydration:thread-b")).toContain('"messageId":"y"');

    render(["x", "y"]);
    geometry.scrollHeight = 1_200;
    controller.notifyLayoutChange();
    expect(element.scrollTop).toBe(655);
    expect(sessionStorage.getItem("test-transient-hydration:thread-b")).toContain('"messageId":"y"');
  });

  it("does not move a one-pixel reader during same-thread transient refresh content", () => {
    const geometry: Geometry = {
      viewportTop: 0, clientHeight: 300, scrollHeight: 1_500,
      items: {
        a: { top: 0, height: 300 }, b: { top: 300, height: 300 }, c: { top: 600, height: 300 }, d: { top: 900, height: 600 },
        greeting: { top: 0, height: 300 },
      },
    };
    const { element, render } = transcriptFixture(geometry);
    render(["a", "b", "c", "d"]);
    const controller = createAnchoredTranscriptScroll({ storagePrefix: "test-one-pixel-transient-refresh" });
    controller.setContext("thread-a");
    controller.attach(element);
    element.dispatchEvent(new WheelEvent("wheel", { deltaY: -1 }));
    element.scrollTop = 1_199;
    controller.handleScroll();

    render(["greeting"]);
    geometry.scrollHeight = 300;
    controller.notifyLayoutChange();

    expect(element.scrollTop).toBe(1_199);
    expect(sessionStorage.getItem("test-one-pixel-transient-refresh:thread-a")).toContain('"messageId":"d"');
  });

  it("uses the end-relative duplicate after an ephemeral greeting disappears on reload", () => {
    const geometry: Geometry = {
      viewportTop: 0, clientHeight: 200, scrollHeight: 900,
      items: { "db-user-1": { top: 0, height: 300 }, "db-assistant": { top: 300, height: 300 }, "db-user-2": { top: 600, height: 300 } },
    };
    sessionStorage.setItem("test-duplicate-reload:thread-a", JSON.stringify({
      kind: "anchor", messageId: "client-user-2", semanticKey: "user:continue", indexFromStart: 3, indexFromEnd: 0, offsetPx: -40,
    }));
    const { element, render } = transcriptFixture(geometry);
    const controller = createAnchoredTranscriptScroll({ storagePrefix: "test-duplicate-reload" });
    controller.setContext("thread-a");
    render(["db-user-1", "db-assistant", "db-user-2"], {
      "db-user-1": "user:continue", "db-user-2": "user:continue",
    });
    controller.attach(element);

    expect(element.scrollTop).toBe(640);
    expect(sessionStorage.getItem("test-duplicate-reload:thread-a")).toContain('"messageId":"db-user-2"');
  });

  it("refreshes duplicate-relative indices while the exact anchored message remains mounted", () => {
    const geometry: Geometry = {
      viewportTop: 0, clientHeight: 200, scrollHeight: 900,
      items: {
        greeting: { top: 0, height: 300 },
        "client-user-1": { top: 300, height: 300 },
        assistant: { top: 600, height: 300 },
        "client-user-2": { top: 900, height: 300 },
        "db-user-1": { top: 0, height: 300 },
        "db-assistant": { top: 300, height: 300 },
        "db-user-2": { top: 600, height: 300 },
      },
    };
    const { element, render } = transcriptFixture(geometry);
    render(["greeting", "client-user-1", "assistant"], {
      "client-user-1": "user:continue",
    });
    const controller = createAnchoredTranscriptScroll({ storagePrefix: "test-live-duplicate-index" });
    controller.setContext("thread-a");
    controller.attach(element);
    element.dispatchEvent(new WheelEvent("wheel"));
    element.scrollTop = 340;
    controller.handleScroll();

    geometry.scrollHeight = 1_200;
    render(["greeting", "client-user-1", "assistant", "client-user-2"], {
      "client-user-1": "user:continue", "client-user-2": "user:continue",
    });
    controller.notifyLayoutChange();
    expect(sessionStorage.getItem("test-live-duplicate-index:thread-a")).toContain('"indexFromEnd":2');

    geometry.scrollHeight = 900;
    render(["db-user-1", "db-assistant", "db-user-2"], {
      "db-user-1": "user:continue", "db-user-2": "user:continue",
    });
    element.scrollTop = 0;
    controller.notifyLayoutChange();

    expect(element.scrollTop).toBe(40);
    expect(sessionStorage.getItem("test-live-duplicate-index:thread-a")).toContain('"messageId":"db-user-1"');
  });

  it("keeps automatic following for ordinary near-bottom layout drift without user input", () => {
    const geometry: Geometry = {
      viewportTop: 0, clientHeight: 300, scrollHeight: 1_200,
      items: { a: { top: 0, height: 300 }, b: { top: 300, height: 300 }, c: { top: 600, height: 300 }, d: { top: 900, height: 300 } },
    };
    const { element, render } = transcriptFixture(geometry);
    render(["a", "b", "c", "d"]);
    const controller = createAnchoredTranscriptScroll({ storagePrefix: "test-near-bottom-layout" });
    controller.setContext("thread-a");
    controller.attach(element);
    element.scrollTop = 899;
    controller.handleScroll();
    geometry.items.d.height += 120;
    geometry.scrollHeight += 120;
    controller.notifyLayoutChange();
    expect(element.scrollTop).toBe(1_020);
    expect(controller.isAtBottom()).toBe(true);
  });

  it("resumes automatic following only after deliberate movement reaches the exact bottom", () => {
    const geometry: Geometry = {
      viewportTop: 0, clientHeight: 300, scrollHeight: 1_200,
      items: { a: { top: 0, height: 300 }, b: { top: 300, height: 300 }, c: { top: 600, height: 300 }, d: { top: 900, height: 300 } },
    };
    const { element, render } = transcriptFixture(geometry);
    render(["a", "b", "c", "d"]);
    const controller = createAnchoredTranscriptScroll({ storagePrefix: "test-return-exact-bottom" });
    controller.setContext("thread-a");
    controller.attach(element);

    element.dispatchEvent(new WheelEvent("wheel"));
    element.scrollTop = 899;
    expect(controller.handleScroll()).toBe(false);
    element.dispatchEvent(new WheelEvent("wheel"));
    element.scrollTop = 900;
    expect(controller.handleScroll()).toBe(true);

    geometry.items.d.height += 120;
    geometry.scrollHeight += 120;
    controller.notifyLayoutChange();
    expect(element.scrollTop).toBe(1_020);
  });

  it("keeps the same visible message and pixel offset through reflow and prepends", () => {
    const geometry: Geometry = {
      viewportTop: 50,
      clientHeight: 300,
      scrollHeight: 1_200,
      items: {
        a: { top: 0, height: 300 },
        b: { top: 300, height: 300 },
        c: { top: 600, height: 300 },
        d: { top: 900, height: 300 },
      },
    };
    const { element, render } = transcriptFixture(geometry);
    render(["a", "b", "c", "d"]);
    const controller = createAnchoredTranscriptScroll({ storagePrefix: "test-anchor" });
    controller.setContext("thread-a");
    controller.attach(element);

    element.dispatchEvent(new WheelEvent("wheel"));
    element.scrollTop = 410;
    controller.handleScroll();
    const before = element.querySelector<HTMLElement>('[data-paige-message-id="b"]')!
      .getBoundingClientRect().top - element.getBoundingClientRect().top;
    expect(before).toBe(-110);

    geometry.items.a.height += 120;
    for (const id of ["b", "c", "d"]) geometry.items[id].top += 120;
    geometry.scrollHeight += 120;
    controller.notifyLayoutChange();

    const afterReflow = element.querySelector<HTMLElement>('[data-paige-message-id="b"]')!
      .getBoundingClientRect().top - element.getBoundingClientRect().top;
    expect(afterReflow).toBe(before);
    expect(element.scrollTop).toBe(530);

    geometry.items.older = { top: 0, height: 180 };
    for (const id of ["a", "b", "c", "d"]) geometry.items[id].top += 180;
    geometry.scrollHeight += 180;
    render(["older", "a", "b", "c", "d"]);
    controller.notifyLayoutChange();

    const afterPrepend = element.querySelector<HTMLElement>('[data-paige-message-id="b"]')!
      .getBoundingClientRect().top - element.getBoundingClientRect().top;
    expect(afterPrepend).toBe(before);
    expect(element.scrollTop).toBe(710);
  });

  it("follows layout growth only while bottom-pinned", () => {
    const geometry: Geometry = {
      viewportTop: 0,
      clientHeight: 300,
      scrollHeight: 900,
      items: {
        a: { top: 0, height: 300 }, b: { top: 300, height: 300 }, c: { top: 600, height: 300 },
      },
    };
    const { element, render } = transcriptFixture(geometry);
    render(["a", "b", "c"]);
    const controller = createAnchoredTranscriptScroll({ storagePrefix: "test-bottom" });
    controller.setContext("thread-a");
    controller.attach(element);
    expect(element.scrollTop).toBe(600);

    geometry.items.c.height += 140;
    geometry.scrollHeight += 140;
    controller.notifyLayoutChange();
    expect(element.scrollTop).toBe(740);

    element.dispatchEvent(new WheelEvent("wheel"));
    element.scrollTop = 420;
    controller.handleScroll();
    geometry.items.a.height += 90;
    geometry.items.b.top += 90;
    geometry.items.c.top += 90;
    geometry.scrollHeight += 90;
    controller.notifyLayoutChange();
    expect(element.scrollTop).toBe(510);
    expect(element.scrollTop).not.toBe(geometry.scrollHeight - geometry.clientHeight);
  });

  it("adopts a server thread ID without losing the provisional conversation anchor", () => {
    const geometry: Geometry = {
      viewportTop: 0, clientHeight: 300, scrollHeight: 1_200,
      items: { a: { top: 0, height: 300 }, b: { top: 300, height: 300 }, c: { top: 600, height: 300 }, d: { top: 900, height: 300 } },
    };
    const { element, render } = transcriptFixture(geometry);
    render(["a", "b", "c", "d"]);
    const controller = createAnchoredTranscriptScroll({ storagePrefix: "test-adopt-thread" });
    controller.setContext("draft-message-id");
    controller.attach(element);
    element.dispatchEvent(new WheelEvent("wheel", { deltaY: -1 }));
    element.scrollTop = 899;
    controller.handleScroll();

    controller.adoptContext("server-thread-id");
    geometry.items.d.height += 120;
    geometry.scrollHeight += 120;
    controller.notifyLayoutChange();

    expect(element.scrollTop).toBe(899);
    expect(sessionStorage.getItem("test-adopt-thread:server-thread-id")).toContain('"messageId":"c"');
    expect(controller.isAtBottom()).toBe(false);
  });

  it("restores positions per thread and through a same-session controller remount", () => {
    const geometry: Geometry = {
      viewportTop: 0,
      clientHeight: 300,
      scrollHeight: 1_200,
      items: {
        a: { top: 0, height: 300 }, b: { top: 300, height: 300 }, c: { top: 600, height: 300 }, d: { top: 900, height: 300 },
      },
    };
    const first = transcriptFixture(geometry);
    first.render(["a", "b", "c", "d"]);
    const controller = createAnchoredTranscriptScroll({ storagePrefix: "test-thread" });
    controller.setContext("thread-a");
    controller.attach(first.element);
    first.element.dispatchEvent(new WheelEvent("wheel"));
    first.element.scrollTop = 425;
    controller.handleScroll();

    controller.setContext("thread-b");
    expect(first.element.scrollTop).toBe(900);
    first.element.dispatchEvent(new WheelEvent("wheel"));
    first.element.scrollTop = 155;
    controller.handleScroll();
    controller.setContext("thread-a");
    expect(first.element.scrollTop).toBe(425);
    controller.detach();

    const remount = transcriptFixture(geometry);
    remount.render(["a", "b", "c", "d"]);
    const restored = createAnchoredTranscriptScroll({ storagePrefix: "test-thread" });
    restored.setContext("thread-a");
    restored.attach(remount.element);
    expect(remount.element.scrollTop).toBe(425);
  });

  it("does not overwrite the outgoing thread when React commits the incoming DOM first", () => {
    const geometry: Geometry = {
      viewportTop: 0,
      clientHeight: 300,
      scrollHeight: 1_200,
      items: {
        a: { top: 0, height: 300 }, b: { top: 300, height: 300 }, c: { top: 600, height: 300 }, d: { top: 900, height: 300 },
        x: { top: 0, height: 600 }, y: { top: 600, height: 600 },
      },
    };
    const { element, render } = transcriptFixture(geometry);
    render(["a", "b", "c", "d"]);
    const controller = createAnchoredTranscriptScroll({ storagePrefix: "test-commit-order" });
    controller.setContext("thread-a");
    controller.attach(element);
    element.dispatchEvent(new WheelEvent("wheel"));
    element.scrollTop = 425;
    controller.handleScroll();

    // React commits thread B before the layout effect changes controller context.
    render(["x", "y"]);
    controller.setContext("thread-b");
    expect(element.scrollTop).toBe(900);

    // A failed B hydration rolls the UI back to A before context follows it.
    render(["a", "b", "c", "d"]);
    controller.setContext("thread-a");
    expect(element.scrollTop).toBe(425);
    expect(JSON.parse(sessionStorage.getItem("test-commit-order:thread-a")!)).toMatchObject({
      kind: "anchor", messageId: "b", offsetPx: -125,
    });
  });

  it("keeps intentional smooth bottom-follow through intermediate scroll events", () => {
    const geometry: Geometry = {
      viewportTop: 0,
      clientHeight: 300,
      scrollHeight: 1_200,
      items: {
        a: { top: 0, height: 300 }, b: { top: 300, height: 300 }, c: { top: 600, height: 300 }, d: { top: 900, height: 300 },
      },
    };
    const { element, render } = transcriptFixture(geometry);
    render(["a", "b", "c", "d"]);
    const controller = createAnchoredTranscriptScroll({ storagePrefix: "test-smooth" });
    controller.setContext("thread-a");
    controller.attach(element);
    element.dispatchEvent(new WheelEvent("wheel"));
    element.scrollTop = 400;
    controller.handleScroll();
    element.scrollTo = vi.fn();

    controller.jumpToBottom("smooth");
    for (const scrollTop of [520, 700, 860, 900]) {
      element.scrollTop = scrollTop;
      expect(controller.handleScroll()).toBe(true);
    }
    geometry.items.d.height += 120;
    geometry.scrollHeight += 120;
    controller.notifyLayoutChange();
    expect(element.scrollTop).toBe(1_020);
  });

  it("lets genuine user input cancel an intentional smooth bottom transition", () => {
    const geometry: Geometry = {
      viewportTop: 0,
      clientHeight: 300,
      scrollHeight: 1_200,
      items: {
        a: { top: 0, height: 300 }, b: { top: 300, height: 300 }, c: { top: 600, height: 300 }, d: { top: 900, height: 300 },
      },
    };
    const { element, render } = transcriptFixture(geometry);
    render(["a", "b", "c", "d"]);
    const controller = createAnchoredTranscriptScroll({ storagePrefix: "test-smooth-cancel" });
    controller.setContext("thread-a");
    controller.attach(element);
    element.scrollTop = 400;
    controller.handleScroll();
    element.scrollTo = vi.fn();

    controller.jumpToBottom("smooth");
    element.dispatchEvent(new WheelEvent("wheel"));
    element.scrollTop = 520;
    expect(controller.handleScroll()).toBe(false);
    geometry.items.a.height += 80;
    for (const id of ["b", "c", "d"]) geometry.items[id].top += 80;
    geometry.scrollHeight += 80;
    controller.notifyLayoutChange();
    expect(element.scrollTop).toBe(600);
    expect(element.scrollTop).not.toBe(geometry.scrollHeight - geometry.clientHeight);
  });

  // C3a — opening "What PAIGE did" on an answer while the transcript follows the bottom. The answer
  // grows; without a hold, bottom-follow pushes the line the person just pressed up out of view.
  it("holds a message in place when the person acts inside it, instead of following the bottom", () => {
    const geometry: Geometry = {
      viewportTop: 0,
      clientHeight: 300,
      scrollHeight: 900,
      items: { a: { top: 0, height: 300 }, b: { top: 300, height: 300 }, c: { top: 600, height: 300 } },
    };
    const { element, render } = transcriptFixture(geometry);
    render(["a", "b", "c"]);
    const pinned: boolean[] = [];
    const controller = createAnchoredTranscriptScroll({ storagePrefix: "test-hold", onPinnedChange: (p) => pinned.push(p) });
    controller.setContext("thread-a");
    controller.attach(element);
    expect(element.scrollTop).toBe(600);
    const line = document.createElement("button");
    element.querySelector('[data-paige-message-id="c"]')!.append(line);

    controller.holdMessageAt(line);
    expect(controller.isAtBottom()).toBe(false);
    expect(pinned.at(-1)).toBe(false);
    // The trace opens: message c grows by 240px. Its top stays exactly where it was.
    geometry.items.c.height += 240;
    geometry.scrollHeight += 240;
    controller.notifyLayoutChange();
    expect(element.scrollTop).toBe(600);
    expect(element.querySelector<HTMLElement>('[data-paige-message-id="c"]')!.getBoundingClientRect().top).toBe(0);
    // "Jump to latest" brings bottom-follow back.
    controller.jumpToBottom();
    expect(controller.isAtBottom()).toBe(true);
    expect(element.scrollTop).toBe(geometry.scrollHeight);
    controller.destroy();
  });

  it("ignores a hold for a node outside the transcript or outside any message", () => {
    const geometry: Geometry = { viewportTop: 0, clientHeight: 300, scrollHeight: 900,
      items: { a: { top: 0, height: 900 } } };
    const { element, render } = transcriptFixture(geometry);
    render(["a"]);
    const controller = createAnchoredTranscriptScroll({ storagePrefix: "test-hold-ignore" });
    controller.attach(element);
    controller.holdMessageAt(document.createElement("div"));
    const loose = document.createElement("div");
    element.append(loose);
    controller.holdMessageAt(loose);
    expect(controller.isAtBottom()).toBe(true);
    controller.destroy();
  });
});

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MessageComposer } from "./MessageComposer";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function keydown(target: HTMLTextAreaElement, init: KeyboardEventInit) {
  const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, ...init });
  const allowed = target.dispatchEvent(event);
  return { event, allowed };
}

describe("MessageComposer keyboard sending", () => {
  const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = [];

  afterEach(() => {
    for (const { host, root } of mounted.splice(0)) {
      act(() => root.unmount());
      host.remove();
    }
  });

  function renderComposer(props: Partial<React.ComponentProps<typeof MessageComposer>> = {}) {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    mounted.push({ host, root });
    const onSend = props.onSend ?? vi.fn();
    act(() => root.render(
      <MessageComposer
        value="Hello Antonio"
        onChange={() => undefined}
        onSend={onSend}
        sendOnEnter
        {...props}
      />,
    ));
    return {
      root,
      host,
      textarea: host.querySelector("textarea") as HTMLTextAreaElement,
      sendButton: host.querySelector("button") as HTMLButtonElement,
      onSend,
    };
  }

  it("keeps one stable writing surface and mounts Send inside its lower-right corner", () => {
    const { host, textarea, sendButton } = renderComposer({ sendLabel: "Send edited" });
    const writingSurface = host.querySelector('[data-composer-writing-surface="true"]');

    expect(writingSurface).not.toBeNull();
    expect(writingSurface?.className).toContain("relative");
    expect(textarea.className).toContain("h-24");
    expect(textarea.className).toContain("min-h-24");
    expect(textarea.className).toContain("max-h-24");
    expect(textarea.className).toContain("pb-12");
    expect(textarea.className).toContain("pr-44");
    expect(sendButton.className).toContain("absolute");
    expect(sendButton.className).toContain("bottom-2");
    expect(sendButton.className).toContain("right-5");
    expect(writingSurface?.contains(sendButton)).toBe(true);
  });

  it("bounds tall header and attachment content to an internal scroll owner", () => {
    const { host } = renderComposer({
      header: <div>{Array.from({ length: 20 }, (_, index) => <span key={index}>Attachment {index + 1}</span>)}</div>,
    });
    const header = host.querySelector('[data-composer-header="true"]');

    expect(header).not.toBeNull();
    expect(header?.className).toContain("max-h-36");
    expect(header?.className).toContain("overflow-y-auto");
    expect(header?.className).toContain("overscroll-contain");
  });

  it("does not change composer geometry across focus, entry, blur, and disabled states", () => {
    const { root, host, textarea } = renderComposer({ value: "" });
    const stableClasses = textarea.className;

    act(() => textarea.focus());
    expect(textarea.className).toBe(stableClasses);

    act(() => textarea.dispatchEvent(new InputEvent("input", { bubbles: true, data: "Draft" })));
    expect(textarea.className).toBe(stableClasses);

    act(() => textarea.blur());
    expect(textarea.className).toBe(stableClasses);

    act(() => root.render(
      <MessageComposer value="Draft" onChange={() => undefined} onSend={() => undefined} disabled sendOnEnter />,
    ));
    const disabledTextarea = host.querySelector("textarea") as HTMLTextAreaElement;
    expect(disabledTextarea.className).toBe(stableClasses);
    expect(disabledTextarea.disabled).toBe(true);
  });

  it("keeps the embedded Send control visible while truthfully disabled", () => {
    const { sendButton } = renderComposer({ sendDisabled: true });
    expect(sendButton).not.toBeNull();
    expect(sendButton.disabled).toBe(true);
    expect(sendButton.textContent).toContain("Send");
  });

  it("sends on plain Enter and leaves Shift+Enter available for a newline", () => {
    const onSend = vi.fn();
    const { textarea } = renderComposer({ onSend });

    const plain = keydown(textarea, {});
    expect(plain.event.defaultPrevented).toBe(true);
    expect(plain.allowed).toBe(false);
    expect(onSend).toHaveBeenCalledTimes(1);

    const shifted = keydown(textarea, { shiftKey: true });
    expect(shifted.event.defaultPrevented).toBe(false);
    expect(shifted.allowed).toBe(true);
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it("does not send while an IME composition is active", () => {
    const onSend = vi.fn();
    const { textarea } = renderComposer({ onSend });
    const composing = keydown(textarea, { isComposing: true });
    expect(composing.event.defaultPrevented).toBe(false);
    expect(onSend).not.toHaveBeenCalled();
  });

  it.each([
    { label: "sending", props: { sending: true } },
    { label: "disabled", props: { disabled: true } },
    { label: "send-disabled", props: { sendDisabled: true } },
  ])("does not submit when $label", ({ props }) => {
    const onSend = vi.fn();
    const { textarea } = renderComposer({ onSend, ...props });
    keydown(textarea, {});
    expect(onSend).not.toHaveBeenCalled();
  });

  it("coalesces repeated Enter presses while the current send is unresolved", async () => {
    let resolveSend: (() => void) | undefined;
    const onSend = vi.fn(() => new Promise<void>((resolve) => { resolveSend = resolve; }));
    const { textarea } = renderComposer({ onSend });

    keydown(textarea, {});
    keydown(textarea, {});
    expect(onSend).toHaveBeenCalledTimes(1);

    await act(async () => resolveSend?.());
    keydown(textarea, {});
    expect(onSend).toHaveBeenCalledTimes(2);
  });

  it("releases a failed submit for retry without stealing textarea focus", async () => {
    const onSend = vi.fn()
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce(undefined);
    const { textarea } = renderComposer({ onSend });

    act(() => textarea.focus());
    keydown(textarea, {});
    await act(async () => Promise.resolve());
    expect(document.activeElement).toBe(textarea);

    keydown(textarea, {});
    await act(async () => Promise.resolve());
    expect(onSend).toHaveBeenCalledTimes(2);
    expect(document.activeElement).toBe(textarea);
  });

  it("an actions slot stands in for the toolbar and the gold Send is not rendered (gold appears once)", () => {
    const onSend = vi.fn();
    const { host, textarea } = renderComposer({
      onSend,
      toolbar: <button type="button">Attach</button>,
      actions: <div data-testid="strip"><button type="button" className="gold">Send now</button></div>,
    });
    expect(host.querySelector('[data-testid="strip"]')).not.toBeNull();
    expect(host.querySelector("[data-composer-send]")).toBeNull();
    expect([...host.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Send now"]);
    // The send keys never confirm what the strip shows.
    const plain = keydown(textarea, {});
    const shortcut = keydown(textarea, { ctrlKey: true });
    expect(plain.event.defaultPrevented).toBe(true);
    expect(shortcut.event.defaultPrevented).toBe(true);
    expect(onSend).not.toHaveBeenCalled();
  });

  it("checking keeps Send focusable and busy, and makes it inert (never `disabled`)", () => {
    const onSend = vi.fn();
    const { sendButton, textarea } = renderComposer({ onSend, checking: true, sendLabel: "Checking…" });
    act(() => sendButton.focus());
    expect(sendButton.disabled).toBe(false);
    expect(sendButton.getAttribute("aria-busy")).toBe("true");
    expect(sendButton.getAttribute("aria-disabled")).toBe("true");
    expect(sendButton.textContent).toContain("Checking…");
    act(() => sendButton.click());
    keydown(textarea, {});
    expect(onSend).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(sendButton);
  });
});

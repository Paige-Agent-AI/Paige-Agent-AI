import {act, type ComponentProps} from "react";
import {createRoot, type Root} from "react-dom/client";
import {afterEach, beforeEach, expect, it, vi} from "vitest";
import {CustomerChatPublicLink} from "./CustomerChatPublicLink";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
type Props = ComponentProps<typeof CustomerChatPublicLink>;
let host: HTMLDivElement, root: Root, props: Props;
const view = () => <CustomerChatPublicLink {...props}>{({action, field}) => <>
  <div>{action}</div>{field}<input aria-label="Message Cura"/>
</>}</CustomerChatPublicLink>;
const render = () => act(() => root.render(view()));
const button = (name: string) => [...host.querySelectorAll("button")]
  .find(node => node.getAttribute("aria-label") === name || node.textContent === name)!;
const input = () => host.querySelector<HTMLInputElement>('input[type="url"]')!;
const edit = (value: string) => act(() => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(), value);
  input().dispatchEvent(new Event("input", {bubbles: true}));
});
const key = (value: string) => act(() => input().dispatchEvent(new KeyboardEvent("keydown", {key: value, bubbles: true})));
beforeEach(() => {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  props = {value: null, locked: false, validationAttempt: 0,
    onChange: vi.fn(value => {props.value = value; root.render(view());}),
    onContinue: vi.fn(() => host.querySelector<HTMLInputElement>('input[aria-label="Message Cura"]')?.focus()),
    children: () => null};
});
afterEach(() => {act(() => root.unmount()); host.remove();});

it("keeps optional selection closed and unavailable controls inert", () => {
  render(); expect(input()).toBeNull(); expect(button("Add link").getAttribute("aria-expanded")).toBe("false");
  props.locked = true; render(); act(() => button("Add link").click());
  expect(props.onChange).not.toHaveBeenCalled(); expect(props.onContinue).not.toHaveBeenCalled();
});
it("opens a labeled input without silently limiting or submitting its value", () => {
  render(); act(() => button("Add link").click());
  expect(document.activeElement).toBe(input()); expect(input().labels?.[0]?.textContent).toBe("Public link");
  expect(input().hasAttribute("maxlength")).toBe(false); expect(input().inputMode).toBe("url");
  expect(button("Edit link").getAttribute("aria-controls")).toBe(input().closest("section")?.id);
  expect(props.onContinue).not.toHaveBeenCalled();
});
it("retains an overlength address, announces refusal and permits correction without sending", () => {
  render(); act(() => button("Add link").click()); const long = "https://example.org/" + "a".repeat(490);
  edit(long); key("Enter"); expect(input().value).toBe(long);
  expect(input().getAttribute("aria-invalid")).toBe("true"); expect(host.querySelector('[role="alert"]')?.textContent).toContain("500");
  expect(props.onContinue).not.toHaveBeenCalled(); edit("https://example.org/guide");
  expect(input().hasAttribute("aria-invalid")).toBe(false); key("Enter");
  expect(props.onContinue).toHaveBeenCalledOnce(); expect(document.activeElement?.getAttribute("aria-label")).toBe("Message Cura");
});
it.each(["https://example.org/?private=1", "https://example.org/#private", "http://example.org/", "https://user:secret@example.org/"])(
  "refuses unsupported selection %s on the explicit validation attempt", value => {
    props.value = value; render(); props.validationAttempt = 1; render();
    expect(document.activeElement).toBe(input()); expect(input().getAttribute("aria-invalid")).toBe("true");
    expect(input().value).toBe(value); expect(props.onContinue).not.toHaveBeenCalled();
  });
it("lets an empty optional link return to the ordinary message", () => {
  render(); act(() => button("Add link").click()); key("Enter");
  expect(props.onContinue).toHaveBeenCalledOnce(); expect(host.querySelector('[role="alert"]')).toBeNull();
});
it("returns focus after an acknowledged Escape/removal, but does not steal it after external reset", () => {
  render(); act(() => button("Add link").click()); edit("https://example.org/guide"); key("Escape");
  expect(input()).toBeNull(); expect(document.activeElement).toBe(button("Add link"));
  act(() => button("Add link").click()); act(() => button("Remove public link").click());
  expect(document.activeElement).toBe(button("Add link"));
  act(() => button("Add link").click()); const message = host.querySelector<HTMLInputElement>('input[aria-label="Message Cura"]')!;
  message.focus(); props.value = null; render(); expect(document.activeElement).toBe(message);
});
it("locks the same selected input and removal throughout original turn recovery", () => {
  props.value = "https://example.org/guide"; render(); props.locked = true; render();
  expect(input().disabled).toBe(true); expect(button("Edit link").disabled).toBe(true); expect(button("Remove public link").disabled).toBe(true);
  key("Escape"); key("Enter"); expect(props.onChange).not.toHaveBeenCalled(); expect(props.onContinue).not.toHaveBeenCalled();
  props.locked = false; render(); expect(input().value).toBe("https://example.org/guide");
});

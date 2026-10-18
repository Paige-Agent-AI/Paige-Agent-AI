import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EmptyTile } from "./EmptyTile";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root, host: HTMLDivElement;
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

const mount = (onAction = vi.fn()) => {
  act(() => root.render(<EmptyTile title="Your next steps" description="Nothing yet." actionLabel="Ask Paige what's next" onAction={onAction} />));
  return host.querySelector("button")!;
};

it("keeps its 36px look and reaches a 44px touch target with an invisible extension", () => {
  const classes = mount().className.split(" ");
  // Visible size unchanged: still the size="sm" 36px button.
  expect(classes).toContain("h-9");
  // 36px + 4px above + 4px below = 44px, drawn by an empty pseudo-element over a positioned button.
  expect(classes).toEqual(expect.arrayContaining(["relative", "after:absolute", "after:inset-x-0", "after:-inset-y-[5px]", "after:content-['']"]));
});

it("hovers to muted with the label in foreground, never the near-black secondary fill", () => {
  const classes = mount().className.split(" ");
  expect(classes).toEqual(expect.arrayContaining(["hover:bg-muted", "hover:text-foreground"]));
  expect(classes).not.toContain("hover:bg-secondary");
});

it("runs its action", () => {
  const onAction = vi.fn();
  const button = mount(onAction);
  act(() => button.click());
  expect(onAction).toHaveBeenCalledTimes(1);
});

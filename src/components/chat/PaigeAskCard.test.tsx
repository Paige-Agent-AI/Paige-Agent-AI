/**
 * C4c — PAIGE's question, answered in place (frames c2 / c3 / c5 / c6). Rendered and clicked for real.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { askReplyText, PaigeAskCard, PaigeAskRecord, type PaigeAskOption } from "./PaigeAskCard";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Array<() => void> = [];
afterEach(() => { while (mounted.length) mounted.pop()!(); });
function render(node: React.ReactElement) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(node); });
  mounted.push(() => { act(() => root.unmount()); host.remove(); });
  return host;
}
const OPTIONS: PaigeAskOption[] = [
  { label: "Full kickoff", value: "full", description: "90-minute workshop plus the intake form" },
  { label: "Light start", value: "light", description: "Intake form now, kickoff next month" },
  { label: "Mirror Lumen Freight", value: "mirror" },
];
const options = (host: HTMLElement) => Array.from(host.querySelectorAll<HTMLButtonElement>("[data-paige-ask-option]"));
const submit = (host: HTMLElement) => host.querySelector<HTMLButtonElement>("[data-paige-ask-submit]")!;

describe("PaigeAskCard", () => {
  it("is a radio group with one tab stop; nothing picked; Use this answers nothing until a pick", () => {
    const onAnswer = vi.fn();
    const host = render(<PaigeAskCard options={OPTIONS} question="Which start?" onAnswer={onAnswer} onSkip={vi.fn()} />);
    expect(host.querySelector('[role="radiogroup"]')).not.toBeNull();
    expect(options(host).map((o) => o.tabIndex)).toEqual([0, -1, -1]);
    expect(submit(host).getAttribute("aria-disabled")).toBe("true");
    expect(host.textContent).toContain("Pick an option first");
    act(() => { submit(host).click(); });
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it("arrows move AND select (one tab stop follows the pick); the reply is the label and its one line", () => {
    const onAnswer = vi.fn();
    const host = render(<PaigeAskCard options={OPTIONS} question="Which start?" onAnswer={onAnswer} onSkip={vi.fn()} />);
    act(() => { options(host)[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })); });
    expect(options(host).map((o) => o.getAttribute("aria-checked"))).toEqual(["false", "true", "false"]);
    expect(options(host).map((o) => o.tabIndex)).toEqual([-1, 0, -1]);
    expect(document.activeElement).toBe(options(host)[1]);
    act(() => { options(host)[1].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true })); });
    expect(options(host)[0].getAttribute("aria-checked")).toBe("true");
    act(() => { options(host)[1].click(); });
    expect(submit(host).getAttribute("aria-disabled")).toBeNull();
    act(() => { submit(host).click(); });
    expect(onAnswer).toHaveBeenCalledWith("Light start — intake form now, kickoff next month");
  });

  it("several allowed: checkboxes, each its own tab stop; the reply names every pick in order", () => {
    const onAnswer = vi.fn();
    const host = render(<PaigeAskCard options={OPTIONS} multi question="Which?" onAnswer={onAnswer} onSkip={vi.fn()} />);
    expect(options(host).every((o) => o.getAttribute("role") === "checkbox" && o.tabIndex === 0)).toBe(true);
    act(() => { options(host)[2].click(); options(host)[0].click(); });
    expect(submit(host).textContent).toBe("Use these");
    act(() => { submit(host).click(); });
    expect(onAnswer).toHaveBeenCalledWith("Full kickoff — 90-minute workshop plus the intake form; Mirror Lumen Freight");
  });

  it("Use this is ink, never gold; Skip is quiet; disabled while a reply is being read", () => {
    const onSkip = vi.fn();
    const host = render(<PaigeAskCard options={OPTIONS} question="Which?" onAnswer={vi.fn()} onSkip={onSkip} disabled />);
    expect(submit(host).className).toMatch(/bg-foreground/);
    expect(host.innerHTML).not.toMatch(/gold/);
    expect(options(host).every((o) => o.disabled)).toBe(true);
    expect(host.querySelector<HTMLButtonElement>("[data-paige-ask-skip]")!.disabled).toBe(true);
  });

  it("fewer than two options draws nothing (a free-form question has no card)", () => {
    const host = render(<PaigeAskCard options={[OPTIONS[0]]} question="When?" onAnswer={vi.fn()} onSkip={vi.fn()} />);
    expect(host.innerHTML).toBe("");
  });

  it("a closed question is a record with no control on it", () => {
    for (const [standing, text] of [["answered", "Answered below"], ["skipped", "You let PAIGE choose"], ["unanswered", "Not answered"]] as const) {
      const host = render(<PaigeAskRecord standing={standing} />);
      expect(host.textContent).toBe(text);
      expect(host.querySelector("button")).toBeNull();
    }
    expect(askReplyText([OPTIONS[2]])).toBe("Mirror Lumen Freight");
  });
});

/**
 * The approval card in report mode: the card on the turn that ran an approval, saying what became
 * of each action (owner-approved recovery design, 2026-09-26). Rendered and clicked for real.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PaigeConfirmCard, PaigeConfirmRecord, type ConfirmAction } from "./PaigeConfirmCard";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Array<() => void> = [];
afterEach(() => { while (mounted.length) mounted.pop()!(); });

function render(node: React.ReactElement) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(node); });
  mounted.push(() => { act(() => root.unmount()); host.remove(); });
  return {
    host,
    rerender: (next: React.ReactElement) => act(() => { root.render(next); }),
    card: () => host.querySelector<HTMLElement>('[role="group"]'),
    buttons: () => Array.from(host.querySelectorAll("button")).map((b) => (b.textContent ?? "").trim()),
  };
}

const rows = (...states: ConfirmAction["state"][]): ConfirmAction[] =>
  states.map((state, i) => ({ summary: `Action ${i + 1}`, fingerprint: `${i}`.repeat(16), state }));

describe("a report says what happened, in its heading", () => {
  it.each([
    [["working", "working"], "Running…"],
    [["done"], "Done"],
    [["done", "done"], "2 done"],
    [["failed"], "Didn't run"],
    [["done", "failed", "failed"], "1 done · 2 didn't run"],
    [["unconfirmed"], "Couldn't confirm"],
    [["done", "unconfirmed"], "Couldn't confirm"],
  ] as Array<[ConfirmAction["state"][], string]>)("%j reads %s", (states, heading) => {
    const ui = render(<PaigeConfirmCard mode="report" actions={rows(...states)} />);
    expect(ui.card()?.getAttribute("aria-label")).toBe(heading);
    expect(ui.host.textContent).toContain(heading);
  });
});

describe("a report can never be approved again", () => {
  it("renders no Approve, no Not now and no refusal, whatever it carries", () => {
    for (const states of [["working"], ["failed"], ["done", "failed"], ["unconfirmed"]] as ConfirmAction["state"][][]) {
      const ui = render(<PaigeConfirmCard mode="report" actions={rows(...states)} />);
      expect(ui.buttons().filter((b) => /Approve|Not now/.test(b))).toEqual([]);
      expect(ui.host.textContent).not.toMatch(/can’t complete approvals/);
    }
  });
});

describe("the reason is said once, with the verdict", () => {
  it("puts the card's sentence in the same live region as the heading, and describes the card with it", () => {
    const note = "Nothing changed. More than one approval was waiting, so Paige stopped rather than guess.";
    const ui = render(<PaigeConfirmCard mode="report" actions={rows("failed", "failed")} note={note} />);
    const live = ui.host.querySelector('[aria-live="polite"]');
    expect(live?.getAttribute("aria-atomic")).toBe("true");
    expect(live?.textContent).toBe(`Didn't run${note}`);
    const described = ui.card()?.getAttribute("aria-describedby");
    expect(described && document.getElementById(described)?.textContent).toBe(note);
    expect(ui.host.textContent?.split(note)).toHaveLength(2);
  });

  it("describes nothing when there is nothing to say", () => {
    const ui = render(<PaigeConfirmCard mode="report" actions={rows("done")} />);
    expect(ui.card()?.hasAttribute("aria-describedby")).toBe(false);
  });
});

describe("the one next step", () => {
  const recovery = () => ({ onPress: vi.fn() });

  it("offers Ask Paige again where something didn't run, and presses through", () => {
    const r = recovery();
    const ui = render(<PaigeConfirmCard mode="report" actions={rows("failed")} recovery={r} />);
    const again = Array.from(ui.host.querySelectorAll("button")).find((b) => b.textContent?.includes("Ask Paige again"));
    act(() => { again!.click(); });
    expect(r.onPress).toHaveBeenCalledTimes(1);
  });

  it("says it asks only for what didn't run, in the right number", () => {
    expect(render(<PaigeConfirmCard mode="report" actions={rows("done", "failed")} recovery={recovery()} />).host.textContent)
      .toContain("Only the one that didn’t run.");
    expect(render(<PaigeConfirmCard mode="report" actions={rows("done", "failed", "failed")} recovery={recovery()} />).host.textContent)
      .toContain("Only the ones that didn’t run.");
  });

  it("never offers it on a card that is running, done, or may have gone through", () => {
    for (const states of [["working"], ["done"], ["unconfirmed"], ["failed", "unconfirmed"]] as ConfirmAction["state"][][]) {
      const ui = render(<PaigeConfirmCard mode="report" actions={rows(...states)} recovery={recovery()} />);
      expect(ui.buttons()).not.toContain("Ask Paige again");
    }
  });

  it("shows where to check only when something may have gone through", () => {
    const check = <a href="/solo/42/clients/people">Open your clients</a>;
    expect(render(<PaigeConfirmCard mode="report" actions={rows("unconfirmed")} check={check} />).host.textContent)
      .toContain("Open your clients");
    for (const states of [["working"], ["done"], ["failed"]] as ConfirmAction["state"][][]) {
      expect(render(<PaigeConfirmCard mode="report" actions={rows(...states)} check={check} />).host.textContent)
        .not.toContain("Open your clients");
    }
  });

  it("leaves no empty row behind when there is no step to take", () => {
    const ui = render(<PaigeConfirmCard mode="report" actions={rows("done")} recovery={recovery()} />);
    expect(ui.host.querySelectorAll(".mt-3")).toHaveLength(0);
  });
});

describe("focus", () => {
  it("lands on the card when the Approve it replaces took focus with it", () => {
    (document.activeElement as HTMLElement | null)?.blur();
    const ui = render(<PaigeConfirmCard mode="report" actions={rows("working")} focusOnMount />);
    expect(document.activeElement).toBe(ui.card());
    expect(ui.card()?.tabIndex).toBe(-1);
  });

  it("is never pulled away from someone who has moved on", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    render(<PaigeConfirmCard mode="report" actions={rows("working")} focusOnMount />);
    expect(document.activeElement).toBe(input);
    input.remove();
  });

  it("is not taken again when the card settles", () => {
    (document.activeElement as HTMLElement | null)?.blur();
    const ui = render(<PaigeConfirmCard mode="report" actions={rows("working")} focusOnMount />);
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    ui.rerender(<PaigeConfirmCard mode="report" actions={rows("failed")} focusOnMount />);
    expect(document.activeElement).toBe(input);
    input.remove();
  });
});

describe("each row says what happened to it, in words", () => {
  it("names every settled row's state for assistive tech, so a mixed card says which one ran", () => {
    const ui = render(<PaigeConfirmCard mode="report" actions={rows("done", "unconfirmed", "failed")} />);
    const words = Array.from(ui.host.querySelectorAll("li .sr-only")).map((el) => el.textContent);
    expect(words).toEqual(["Done: ", "Couldn't confirm: ", "Didn't run: "]);
  });

  it("adds nothing to a single action, whose heading already says it, or to a card awaiting a decision", () => {
    expect(render(<PaigeConfirmCard mode="report" actions={rows("done")} />).host.querySelectorAll(".sr-only")).toHaveLength(0);
    expect(render(<PaigeConfirmCard actions={rows("pending", "pending")} onApprove={vi.fn()} onDeny={vi.fn()} />)
      .host.querySelectorAll(".sr-only")).toHaveLength(0);
  });
});

describe("a fresh card after asking again", () => {
  it("takes focus itself when nothing holds it — never its Approve, so a stray Enter cannot approve", () => {
    (document.activeElement as HTMLElement | null)?.blur();
    const ui = render(<PaigeConfirmCard actions={rows("pending")} onApprove={vi.fn()} onDeny={vi.fn()} focusOnMount />);
    expect(document.activeElement).toBe(ui.card());
    expect(document.activeElement?.tagName).not.toBe("BUTTON");
  });

  it("stays unfocusable, as before, without the option", () => {
    const ui = render(<PaigeConfirmCard actions={rows("pending")} onApprove={vi.fn()} onDeny={vi.fn()} />);
    expect(ui.card()?.hasAttribute("tabindex")).toBe(false);
  });
});

describe("motion", () => {
  it("is switched off for anyone who asked for reduced motion", () => {
    const ui = render(<PaigeConfirmCard mode="report" actions={rows("done", "failed")} />);
    const animated = [ui.card()!, ...Array.from(ui.host.querySelectorAll("svg"))]
      .filter((el) => /\banimate-(in|spin)\b/.test(el.getAttribute("class") ?? ""));
    expect(animated.length).toBeGreaterThan(0);
    for (const el of animated) expect(el.getAttribute("class")).toMatch(/motion-reduce:animate-none/);
  });
});

describe("the record left where the card was", () => {
  it("says what the person decided, and offers nothing to press", () => {
    const ui = render(<>
      <PaigeConfirmRecord decision="approved" count={2} />
      <PaigeConfirmRecord decision="approved" count={1} />
      <PaigeConfirmRecord decision="declined" count={2} />
    </>);
    expect(ui.host.textContent).toBe("Approved · 2 actionsApprovedSkipped · nothing changed");
    expect(ui.host.querySelectorAll("button")).toHaveLength(0);
  });
});

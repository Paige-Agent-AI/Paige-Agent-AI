/**
 * INT-328 — the approval card shows the EMAIL it is about to send, not only a sentence about it.
 *
 * The owner approves an email to a client from this card. A one-line summary cannot show the body
 * he is putting his name to, so the card carries the server's own preview of the exact stored call:
 * To, From, Subject, and the body, clamped with a way to read all of it. Rendered and clicked for
 * real (jsdom). Every existing card behaviour must survive with and without a preview.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PaigeConfirmCard, type ConfirmAction } from "./PaigeConfirmCard";
import { parseConfirmPreview, type ConfirmEmailPreview } from "./confirmPreview";

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
    preview: () => host.querySelector<HTMLElement>("[data-confirm-preview]"),
    button: (re: RegExp) => Array.from(host.querySelectorAll("button")).find((b) => re.test((b.textContent ?? "").trim())),
  };
}

const FP = "0123456789abcdef";
// Synthetic people only: nothing committed here may carry a real contact's name or address.
const EMAIL: ConfirmEmailPreview = {
  kind: "email",
  to_name: "Maya Ortiz",
  to_address: "maya@ortizlandscaping.example",
  from_address: "hello@northlightadvisory.example",
  subject: "Notes from Tuesday's planning call",
  body_text: "Hi Maya,\n\nThanks for the time on Tuesday. Here are the three things we agreed.\n\nTalk soon,\nJordan",
};
const SUMMARY = `Email Maya Ortiz at maya@ortizlandscaping.example from hello@northlightadvisory.example: "Notes from Tuesday's planning call"`;
const action = (over: Partial<ConfirmAction> = {}): ConfirmAction => ({ summary: SUMMARY, fingerprint: FP, preview: EMAIL, ...over });
const LONG_BODY = Array.from({ length: 14 }, (_, i) => `Paragraph ${i + 1}: here is what we covered and what happens next.`).join("\n\n");

describe("parseConfirmPreview — the browser trusts only a well-formed email preview", () => {
  it("accepts the shape the chat server emits (no kind) and marks it an email", () => {
    const { kind: _kind, ...wire } = EMAIL;
    expect(parseConfirmPreview(wire)).toEqual(EMAIL);
  });

  it("keeps a missing name missing rather than inventing one", () => {
    const { to_name: _n, ...rest } = EMAIL;
    expect(parseConfirmPreview(rest)).toEqual({ ...rest });
    expect(parseConfirmPreview({ ...rest, to_name: 42 })).toEqual({ ...rest });
    expect(parseConfirmPreview({ ...rest, to_name: "   " })).toEqual({ ...rest });
  });

  it.each([
    ["nothing", undefined],
    ["a string", "Email Maya"],
    ["an array", [EMAIL]],
    ["another kind", { ...EMAIL, kind: "sms" }],
    ["no recipient", { ...EMAIL, to_address: "" }],
    ["no sender", { ...EMAIL, from_address: undefined }],
    ["no subject", { ...EMAIL, subject: "" }],
    ["no body", { ...EMAIL, body_text: "" }],
    ["a non-string body", { ...EMAIL, body_text: { html: "<b>hi</b>" } }],
  ])("refuses %s", (_label, raw) => {
    expect(parseConfirmPreview(raw)).toBeUndefined();
  });
});

describe("an email preview inside the approval card", () => {
  it("shows To with name and address, From, Subject and the body", () => {
    const ui = render(<PaigeConfirmCard actions={[action()]} onApprove={() => {}} onDeny={() => {}} />);
    const p = ui.preview();
    expect(p).toBeTruthy();
    const rows = Object.fromEntries(Array.from(p!.querySelectorAll("dt")).map((dt) => [dt.textContent, dt.nextElementSibling?.textContent]));
    expect(rows.To).toContain("Maya Ortiz");
    expect(rows.To).toContain("maya@ortizlandscaping.example");
    expect(rows.From).toBe("hello@northlightadvisory.example");
    expect(rows.Subject).toBe("Notes from Tuesday's planning call");
    expect(p!.textContent).toContain("Here are the three things we agreed.");
  });

  it("says the envelope once — the summary sentence is not repeated above it", () => {
    const ui = render(<PaigeConfirmCard actions={[action()]} onApprove={() => {}} onDeny={() => {}} />);
    const text = ui.host.textContent ?? "";
    expect(text.split("maya@ortizlandscaping.example").length - 1).toBe(1);
    expect(text).not.toContain(SUMMARY);
  });

  it("shows the address alone when the server sent no name", () => {
    const { to_name: _n, ...noName } = EMAIL;
    const ui = render(<PaigeConfirmCard actions={[action({ preview: noName })]} onApprove={() => {}} onDeny={() => {}} />);
    const to = Array.from(ui.preview()!.querySelectorAll("dt")).find((d) => d.textContent === "To")!.nextElementSibling!;
    expect(to.textContent).toBe("maya@ortizlandscaping.example");
  });

  it("renders the body as text — markup in a draft is shown, never executed", () => {
    const hostile = { ...EMAIL, body_text: 'Hi <img src=x onerror="alert(1)"><script>alert(2)</script>' };
    const ui = render(<PaigeConfirmCard actions={[action({ preview: hostile })]} onApprove={() => {}} onDeny={() => {}} />);
    expect(ui.preview()!.querySelector("img, script")).toBeNull();
    expect(ui.preview()!.textContent).toContain("<script>alert(2)</script>");
  });

  it("speaks the owner's language — no plumbing words", () => {
    const ui = render(<PaigeConfirmCard actions={[action({ preview: { ...EMAIL, body_text: LONG_BODY } })]} onApprove={() => {}} onDeny={() => {}} />);
    expect(ui.host.textContent ?? "").not.toMatch(/provider|binding|connector|operation/i);
  });

  it("still approves and declines the exact fingerprint", () => {
    const onApprove = vi.fn();
    const onDeny = vi.fn();
    const ui = render(<PaigeConfirmCard actions={[action()]} onApprove={onApprove} onDeny={onDeny} />);
    act(() => { ui.button(/^Approve$/)!.click(); });
    expect(onApprove).toHaveBeenCalledWith([FP]);
    act(() => { ui.button(/Not now/)!.click(); });
    expect(onDeny).toHaveBeenCalledWith([FP]);
  });

  it("an email with no fingerprint still shows the email, and still refuses an Approve", () => {
    const ui = render(<PaigeConfirmCard actions={[action({ fingerprint: undefined })]} onApprove={() => {}} onDeny={() => {}} />);
    expect(ui.preview()).toBeTruthy();
    expect(ui.button(/Approve/)).toBeUndefined();
    expect(ui.host.textContent).toContain("can’t complete approvals");
  });
});

describe("a long email is clamped, with a way to read all of it", () => {
  it("offers Show full email on a long body, wired to the body it controls", () => {
    const ui = render(<PaigeConfirmCard actions={[action({ preview: { ...EMAIL, body_text: LONG_BODY } })]} onApprove={() => {}} onDeny={() => {}} />);
    const toggle = ui.button(/Show full email/)!;
    expect(toggle).toBeTruthy();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    const body = document.getElementById(toggle.getAttribute("aria-controls")!)!;
    expect(body).toBeTruthy();
    expect(body.getAttribute("data-clamped")).toBe("true");
    act(() => { toggle.click(); });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.textContent).toContain("Show less");
    expect(body.getAttribute("data-clamped")).toBe("false");
    // The whole email is in the DOM either way: clamping hides pixels, never words.
    expect(body.textContent).toContain("Paragraph 14");
  });

  it("does not offer a disclosure on a short body", () => {
    const ui = render(<PaigeConfirmCard actions={[action()]} onApprove={() => {}} onDeny={() => {}} />);
    expect(ui.button(/Show full email/)).toBeUndefined();
  });

  it("expanding the email never approves it", () => {
    const onApprove = vi.fn();
    const ui = render(<PaigeConfirmCard actions={[action({ preview: { ...EMAIL, body_text: LONG_BODY } })]} onApprove={onApprove} onDeny={() => {}} />);
    act(() => { ui.button(/Show full email/)!.click(); });
    expect(onApprove).not.toHaveBeenCalled();
  });
});

describe("no preview, no change", () => {
  it("a card without a preview renders exactly the summary it always did", () => {
    const ui = render(<PaigeConfirmCard actions={[{ summary: "Add John Coleman to your contacts", fingerprint: FP }]} onApprove={() => {}} onDeny={() => {}} />);
    expect(ui.preview()).toBeNull();
    expect(ui.host.textContent).toContain("Add John Coleman to your contacts");
    expect(ui.button(/^Approve$/)).toBeTruthy();
  });

  it("a batch keeps both rows: the email shows its envelope, the other its sentence", () => {
    const ui = render(
      <PaigeConfirmCard
        actions={[action(), { summary: "Add John Coleman to your contacts", fingerprint: "fedcba9876543210" }]}
        onApprove={() => {}}
        onDeny={() => {}}
      />,
    );
    expect(ui.host.querySelectorAll("[data-confirm-preview]").length).toBe(1);
    expect(ui.host.textContent).toContain("Add John Coleman to your contacts");
    expect(ui.button(/Approve 2/)).toBeTruthy();
  });
});

// Compliance MEDIUM (craft, 360px): the envelope was a third bordered box inside the bubble and the
// card, indented by the seal-icon gutter, so at phone width the body wrapped at ~20 characters.
describe("the envelope at phone width — one surface, full card width", () => {
  it("is ruled by hairlines, not drawn as a box inside the card", () => {
    const ui = render(<PaigeConfirmCard actions={[action()]} onApprove={() => {}} onDeny={() => {}} />);
    const cls = ui.preview()!.className;
    expect(cls).toContain("border-y");
    expect(cls).not.toMatch(/(^|\s)(border|rounded-\w+|bg-background)(\s|$)/);
  });
  it("a lone email steps out of the icon gutter below 480px; a batch row keeps its indent", () => {
    const one = render(<PaigeConfirmCard actions={[action()]} onApprove={() => {}} onDeny={() => {}} />);
    expect(one.preview()!.className).toContain("max-[479px]:-ml-[34px]");
    const batch = render(
      <PaigeConfirmCard
        actions={[action(), { summary: "Add John Coleman to your contacts", fingerprint: "fedcba9876543210" }]}
        onApprove={() => {}}
        onDeny={() => {}}
      />,
    );
    expect(batch.preview()!.className).not.toContain("-ml-");
  });
});

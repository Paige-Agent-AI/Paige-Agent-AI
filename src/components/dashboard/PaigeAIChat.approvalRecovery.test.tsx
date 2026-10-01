/**
 * What a person sees after pressing Approve — driven on the REAL chat surface: real card, real
 * click, real second turn, real frames.
 *
 * WHY THIS EXISTS. When an approval cannot be pinned to one call, both approval doors end in a
 * truthful terminal that records nothing and mints no card. The general gate's terminal told the
 * operator they "can approve the actions one at a time"; the card has a single Approve button, so
 * #1450 replaced that on the CRM door with "press Not now to clear them". That was wrong the same
 * way. `cancelConfirmations` CAN consume the rows, but the card that carries Not now renders only
 * on the LAST message, pressing Approve sends a new one, and the terminal mints no card — so after
 * Approve there is no Not now anywhere on screen. The one recovery the interface offers is asking
 * again.
 *
 * And until the recovery design (owner-approved 2026-09-26), that was all a person got: the card
 * vanished on press and nothing on screen said whether anything had happened. Solo now keeps a
 * record where the card was, shows Running… on the turn that runs the approval, and reports each
 * action as done, didn't run, or couldn't confirm — with "Ask Paige again" only where it is the
 * true next step. Every other mount is unchanged, and the last test here proves it.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PaigeAIChat } from "@/components/dashboard/PaigeAIChat";

const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }));

vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: null }) }));
vi.mock("@/hooks/useTenantContext", () => ({
  useTenantContext: () => ({ activeTenantId: "account-a", activeTenant: { account_number: "42" } }),
}));
vi.mock("@/hooks/useScopedUserId", () => ({ useScopedUserId: () => "owner-1" }));
vi.mock("@/lib/playbook", () => ({ usePlaybook: () => ({ persona: { name: "PAIGE" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: toastMock }) }));
vi.mock("@/components/voice/DictationMicButton", () => ({ DictationMicButton: () => <button type="button">mic</button> }));
vi.mock("@/hooks/useChatDocumentUpload", () => ({
  useChatDocumentUpload: () => ({
    attachedDoc: null, isDragOver: false, fileInputRef: { current: null }, acceptString: ".pdf",
    handleFileSelect: vi.fn(), handleDragOver: vi.fn(), handleDragLeave: vi.fn(), handleDrop: vi.fn(),
    removeAttachment: vi.fn(), openFilePicker: vi.fn(), setAttachedDoc: vi.fn(),
  }),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: vi.fn(async () => ({ data: { session: { access_token: "test-token" } } })) } },
}));
vi.mock("@/hooks/usePaigeThreads", () => ({
  usePaigeThreads: () => ({
    threads: [], isLoading: false, isFetched: true,
    loadTurns: vi.fn(async () => []), ensureThread: vi.fn(async () => "thread-a"),
    onTurnPersisted: vi.fn(), renameThread: vi.fn(), archiveThread: vi.fn(), deleteThread: vi.fn(),
  }),
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const FP_A = "aaaaaaaaaaaaaaaa";
const FP_B = "bbbbbbbbbbbbbbbb";
const DRAFTS = [
  { tool: "action_advance", summary: "Dismiss the first draft", fingerprint: FP_A },
  { tool: "action_advance", summary: "Dismiss the second draft", fingerprint: FP_B },
];
const CONTACT = [{ tool: "crm_create_contact", summary: "Add John Coleman to your clients", fingerprint: FP_A }];

const frame = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
const say = (text: string) => frame({ choices: [{ delta: { content: text } }] });
const DONE = "data: [DONE]\n\n";

const sse = (frames: string[]) => ({
  ok: true, status: 200,
  body: {
    getReader() {
      let sent = false;
      return {
        async read() {
          if (sent) return { done: true, value: undefined };
          sent = true;
          return { done: false, value: new TextEncoder().encode(frames.join("")) };
        },
        releaseLock() {},
      };
    },
  },
});

const flush = async () => {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
};

type Reply = ReturnType<typeof sse> | { ok: false; status: number; json: () => Promise<unknown>; text: () => Promise<string> } | Error | Promise<unknown>;

/** A scripted server: turn 1 proposes, later turns answer however the case needs. */
function server(proposal: Array<{ tool: string; summary: string; fingerprint: string }>, ...later: Reply[]) {
  const bodies: Array<Record<string, unknown>> = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
    bodies.push(JSON.parse(String(init?.body ?? "{}")));
    if (bodies.length === 1) {
      return sse([say("Here is what I'd do."), ...proposal.map((c) => frame({ paige_confirm: c })), DONE]);
    }
    const reply = later[bodies.length - 2] ?? sse([say("Okay."), DONE]);
    if (reply instanceof Error) throw reply;
    return reply;
  }));
  return bodies;
}

const mounted: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (mounted.length) await mounted.pop()!();
  vi.unstubAllGlobals();
  toastMock.mockClear();
});

async function mount(solo = true) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => { root.render(<PaigeAIChat hideHeader fill soloTenantSafety={solo} />); await flush(); });
  mounted.push(async () => { await act(async () => { root.unmount(); }); host.remove(); });
  return host;
}

const buttons = (host: HTMLElement, label: RegExp) =>
  Array.from(host.querySelectorAll<HTMLButtonElement>("button")).filter((b) => label.test(b.textContent ?? ""));
const reports = (host: HTMLElement) =>
  Array.from(host.querySelectorAll<HTMLElement>('[data-card-mode="report"]'));

async function ask(host: HTMLElement, text = "clear those two drafts") {
  const textarea = host.querySelector("textarea")!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!;
    setter.call(textarea, text);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const send = Array.from(host.querySelectorAll<HTMLButtonElement>("button"))
    .find((b) => /send/i.test(b.getAttribute("aria-label") ?? ""))!;
  await act(async () => { send.click(); await flush(); });
}

async function press(button: HTMLButtonElement | undefined) {
  expect(button).toBeTruthy();
  await act(async () => { button!.click(); await flush(); });
}

describe("PAIGE chat, Solo — after Approve the card answers for what happened", () => {
  it("says Running… the moment Approve is pressed, keeps a record where it asked, and takes focus", async () => {
    let answer!: (value: unknown) => void;
    server(DRAFTS, new Promise((resolve) => { answer = resolve; }));
    const host = await mount();
    await ask(host);
    expect(buttons(host, /^Approve 2/)).toHaveLength(1);

    await press(buttons(host, /^Approve/)[0]);

    // Nothing has come back yet, and the screen already says what is happening.
    expect(host.textContent).toContain("Approved · 2 actions");
    expect(reports(host)).toHaveLength(1);
    expect(reports(host)[0].getAttribute("aria-label")).toBe("Running…");
    expect(document.activeElement).toBe(reports(host)[0]);
    expect(buttons(host, /^Approve|Not now/)).toHaveLength(0);

    await act(async () => {
      answer(sse([
        frame({ paige_approval_outcome: { actions: [{ fingerprint: FP_A, outcome: "ran" }, { fingerprint: FP_B, outcome: "ran" }] } }),
        say("Both drafts are cleared."), DONE,
      ]));
      await flush();
    });
    expect(reports(host)[0].getAttribute("aria-label")).toBe("2 done");
    expect(buttons(host, /Ask Paige again/)).toHaveLength(0);
  });

  it("reports an approval that didn't run once, offers asking again, and asks only for those", async () => {
    const note = "Nothing changed. More than one approval was waiting, so Paige stopped rather than guess.";
    const bodies = server(DRAFTS, sse([
      frame({ paige_approval_outcome: { note, actions: [{ fingerprint: FP_A, outcome: "not_run" }, { fingerprint: FP_B, outcome: "not_run" }] } }),
      say("If you still want those cleared, ask me again."), DONE,
    ]));
    const host = await mount();
    await ask(host);
    await press(buttons(host, /^Approve/)[0]);

    // The second turn really ran and carried BOTH approvals — reached by the real press.
    expect(bodies[1]?.approvedConfirmations).toEqual([FP_A, FP_B]);
    const card = reports(host)[0];
    expect(card.getAttribute("aria-label")).toBe("Didn't run");
    expect(host.textContent?.split(note)).toHaveLength(2);
    // Nothing to press on a card that is gone: no Not now, no Approve anywhere.
    expect(buttons(host, /Not now/)).toHaveLength(0);
    expect(buttons(host, /^Approve/)).toHaveLength(0);

    await press(buttons(host, /Ask Paige again/)[0]);
    const again = bodies[2];
    const sent = (again?.messages as Array<{ role: string; content: string }>).at(-1);
    expect(sent).toMatchObject({ role: "user", content: "Try again: Dismiss the first draft; Dismiss the second draft" });
    expect(again?.approvedConfirmations).toBeUndefined();
  });

  it("offers asking again only while that report is the latest thing said — never from an older turn", async () => {
    server(DRAFTS, sse([
      frame({ paige_approval_outcome: { note: "It didn't go through.", actions: [{ fingerprint: FP_A, outcome: "not_run" }, { fingerprint: FP_B, outcome: "not_run" }] } }),
      say("If you still want those cleared, ask me again."), DONE,
    ]), sse([say("Sure — what's next?"), DONE]));
    const host = await mount();
    await ask(host);
    await press(buttons(host, /^Approve/)[0]);
    expect(buttons(host, /Ask Paige again/)).toHaveLength(1);

    // The person moves on. The report stays, still saying what happened, but it no longer offers
    // to redo something the conversation has since gone past.
    await ask(host, "thanks, never mind those");
    expect(reports(host)).toHaveLength(1);
    expect(reports(host)[0].getAttribute("aria-label")).toBe("Didn't run");
    expect(buttons(host, /Ask Paige again/)).toHaveLength(0);
  });

  it("shows a created contact as done, with a receipt that says Added", async () => {
    server(CONTACT, sse([
      frame({ paige_approval_outcome: { actions: [{ fingerprint: FP_A, outcome: "ran" }] } }),
      frame({ paige_crm_result: { action: "contact.create", outcome: "succeeded", receipt_recorded: true,
        readback: { id: "c-1", client_ref: "John Coleman" }, record_locator: null } }),
      say("John Coleman is in your clients now."), DONE,
    ]));
    const host = await mount();
    await ask(host, "add John Coleman");
    await press(buttons(host, /^Approve/)[0]);

    expect(host.textContent).toContain("Approved");
    expect(reports(host)[0].getAttribute("aria-label")).toBe("Done");
    const receipt = host.querySelector("[data-paige-crm-result]");
    expect(receipt?.textContent).toMatch(/^Added/);
    expect(receipt?.textContent).toContain("John Coleman");
    expect(receipt?.textContent).not.toMatch(/Updated/);
  });

  it("never offers asking again beside a fresh card Paige is already showing", async () => {
    server(CONTACT, sse([
      frame({ paige_approval_outcome: { note: "That approval couldn't be used, so Paige is asking again.", actions: [{ fingerprint: FP_A, outcome: "not_run" }] } }),
      frame({ paige_confirm: { tool: "crm_create_contact", summary: "Add John Coleman to your clients", fingerprint: FP_B } }),
      DONE,
    ]));
    const host = await mount();
    await ask(host, "add John Coleman");
    await press(buttons(host, /^Approve/)[0]);

    expect(reports(host)[0].getAttribute("aria-label")).toBe("Didn't run");
    expect(buttons(host, /^Approve/)).toHaveLength(1);
    expect(buttons(host, /Ask Paige again/)).toHaveLength(0);
  });

  it("keeps the turn when the connection drops, says it may have gone through, and points at where to check", async () => {
    server(CONTACT, sse([say("Adding him now")]));
    const host = await mount();
    await ask(host, "add John Coleman");
    await press(buttons(host, /^Approve/)[0]);

    const card = reports(host)[0];
    expect(card.getAttribute("aria-label")).toBe("Couldn't confirm");
    expect(host.textContent).toContain("The connection dropped before Paige could report back, so this may have gone through. Check before asking again.");
    // The approval may have run: the turn stays, and nothing claims the message wasn't sent.
    expect(host.textContent).toContain("Approved — run it.");
    expect(host.textContent).toContain("Adding him now");
    expect(host.textContent).not.toMatch(/wasn't sent/);
    expect(buttons(host, /^Retry$/)).toHaveLength(0);
    expect(buttons(host, /Ask Paige again/)).toHaveLength(0);
    const check = Array.from(card.querySelectorAll("a")).find((a) => a.textContent?.includes("Open your clients"));
    expect(check?.getAttribute("href")).toBe("/solo/42/clients/people");
  });

  it("never lets a dropped turn with no words make the next message fail", async () => {
    // The server refuses any message whose content is empty (messageSchema, content min 1).
    const bodies = server(CONTACT, sse([]), sse([say("Let me check."), DONE]));
    const host = await mount();
    await ask(host, "add John Coleman");
    await press(buttons(host, /^Approve/)[0]);
    expect(reports(host)[0].getAttribute("aria-label")).toBe("Couldn't confirm");

    await ask(host, "did that work?");
    const sent = bodies[2]?.messages as Array<{ role: string; content: string }>;
    expect(sent.every((m) => typeof m.content === "string" && m.content.trim() !== "")).toBe(true);
    expect(sent.at(-2)).toMatchObject({ role: "assistant", content: expect.stringContaining("Couldn't confirm: Add John Coleman to your clients") });
  });

  it("treats a request that failed after it left the same way, without the 'failed to send' alarm", async () => {
    server(DRAFTS, new TypeError("Failed to fetch"));
    const host = await mount();
    await ask(host);
    await press(buttons(host, /^Approve/)[0]);

    expect(reports(host)[0].getAttribute("aria-label")).toBe("Couldn't confirm");
    expect(host.textContent).toContain("these may have gone through");
    expect(host.textContent).toContain("Approved — run it.");
    expect(toastMock).not.toHaveBeenCalled();
    // No CRM action, so no invented place to check.
    expect(reports(host)[0].querySelectorAll("a")).toHaveLength(0);
  });

  it("puts the card back when the server refused the request before running anything", async () => {
    server(DRAFTS, { ok: false, status: 500, json: async () => ({}), text: async () => "" });
    const host = await mount();
    await ask(host);
    await press(buttons(host, /^Approve/)[0]);

    expect(reports(host)).toHaveLength(0);
    expect(host.textContent).not.toContain("Approved · 2 actions");
    expect(buttons(host, /^Approve 2/)).toHaveLength(1);
    // Trying again is the Approve that came back. A Retry would resend "Approved — run it." with no
    // approval in it, and show the record of a decision that never reached Paige.
    expect(buttons(host, /^Retry$/)).toHaveLength(0);
  });

  it("keeps the turn when the person stops Paige mid-approval, and never offers Approve again", async () => {
    server(DRAFTS, new Promise(() => {}));
    const host = await mount();
    await ask(host);
    await press(buttons(host, /^Approve/)[0]);
    expect(reports(host)[0].getAttribute("aria-label")).toBe("Running…");

    const stop = Array.from(host.querySelectorAll<HTMLButtonElement>("button"))
      .find((b) => b.getAttribute("aria-label") === "Cancel PAIGE response");
    await press(stop);

    // The approval may already have run: no card to approve twice, the record and the turn stay.
    expect(buttons(host, /^Approve/)).toHaveLength(0);
    expect(host.textContent).toContain("Approved · 2 actions");
    expect(host.textContent).toContain("Approved — run it.");
    expect(reports(host)[0].getAttribute("aria-label")).toBe("Couldn't confirm");
    expect(host.textContent).toContain("Paige couldn't report back, so these may have gone through. Check before asking again.");
    expect(buttons(host, /^Retry$/)).toHaveLength(0);
  });

  it("gives focus to the fresh card after Ask Paige again, not to nowhere", async () => {
    server(DRAFTS,
      sse([frame({ paige_approval_outcome: {
        note: "Nothing changed. More than one approval was waiting, so Paige stopped rather than guess.",
        actions: [{ fingerprint: FP_A, outcome: "not_run" }, { fingerprint: FP_B, outcome: "not_run" }],
      } }), DONE]),
      sse([say("Here they are again."), ...DRAFTS.map((c) => frame({ paige_confirm: { ...c, fingerprint: `${c.fingerprint.slice(0, 15)}c` } })), DONE]),
    );
    const host = await mount();
    await ask(host);
    await press(buttons(host, /^Approve/)[0]);

    const again = buttons(host, /Ask Paige again/)[0];
    again.focus();
    expect(document.activeElement).toBe(again);
    await press(again);

    // The button that was focused is gone; the new card holds focus, and it is the card, not Approve.
    const fresh = Array.from(host.querySelectorAll<HTMLElement>('[role="group"]'))
      .find((el) => el.getAttribute("aria-label") === "Needs your OK · 2 actions");
    expect(fresh).toBeTruthy();
    expect(document.activeElement).toBe(fresh);
  });

  it("undoes a decision that never left because the device is offline, card and all, with no dead Retry", async () => {
    const bodies = server(DRAFTS);
    const host = await mount();
    await ask(host);
    const online = Object.getOwnPropertyDescriptor(Navigator.prototype, "onLine")!;
    Object.defineProperty(Navigator.prototype, "onLine", { configurable: true, get: () => false });
    try {
      await press(buttons(host, /^Approve/)[0]);
    } finally {
      Object.defineProperty(Navigator.prototype, "onLine", online);
    }
    expect(bodies).toHaveLength(1);
    expect(host.textContent).toContain("You appear to be offline.");
    expect(buttons(host, /^Approve 2/)).toHaveLength(1);
    expect(host.textContent).not.toContain("Approved · 2 actions");
    expect(reports(host)).toHaveLength(0);
    expect(buttons(host, /^Retry$/)).toHaveLength(0);
  });

  it("leaves a record of a decline, and no report", async () => {
    const bodies = server(DRAFTS, sse([say("Okay. I've left both of them as they are."), DONE]));
    const host = await mount();
    await ask(host);
    await press(buttons(host, /Not now/)[0]);

    expect(bodies[1]?.declinedConfirmations).toEqual([FP_A, FP_B]);
    expect(host.textContent).toContain("Skipped · nothing changed");
    expect(reports(host)).toHaveLength(0);
  });
});

describe("PAIGE chat, Solo — when the interactive window runs out", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("answers an approval from its card, and names no Retry for a decline it cannot replay", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    server(DRAFTS, new Promise(() => {}), new Promise(() => {}));
    const host = await mount();
    await ask(host);
    await press(buttons(host, /Not now/)[0]);
    await act(async () => { vi.advanceTimersByTime(360_000); await flush(); });

    // A decline has no outcome card, so it keeps the notice, without a Retry or a sentence about one.
    expect(host.textContent).toContain("six-minute interactive window ended");
    expect(host.textContent).not.toContain("Retry may start the work again");
    expect(buttons(host, /^Retry$/)).toHaveLength(0);
    expect(host.textContent).toContain("Skipped · nothing changed");
  });

  it("lets the approval's own card say it couldn't confirm, with no second notice", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    server(DRAFTS, new Promise(() => {}));
    const host = await mount();
    await ask(host);
    await press(buttons(host, /^Approve/)[0]);
    await act(async () => { vi.advanceTimersByTime(360_000); await flush(); });

    expect(reports(host)[0].getAttribute("aria-label")).toBe("Couldn't confirm");
    expect(host.textContent).not.toContain("six-minute interactive window ended");
    expect(buttons(host, /^Retry$/)).toHaveLength(0);
  });
});

describe("PAIGE chat, every other mount — unchanged", () => {
  it("keeps today's behaviour exactly: no record, no report, and the frame changes nothing", async () => {
    const bodies = server(DRAFTS, sse([
      frame({ paige_approval_outcome: { note: "Nothing changed.", actions: [{ fingerprint: FP_A, outcome: "not_run" }, { fingerprint: FP_B, outcome: "not_run" }] } }),
      say("Nothing happened — more than one approval was waiting for that."), DONE,
    ]));
    const host = await mount(false);
    await ask(host);
    await press(buttons(host, /^Approve/)[0]);

    expect(bodies[1]?.approvedConfirmations).toEqual([FP_A, FP_B]);
    expect(host.textContent).toMatch(/Nothing happened/);
    expect(host.textContent).not.toMatch(/Approved · 2 actions|Didn't run|Nothing changed\./);
    expect(reports(host)).toHaveLength(0);
    expect(buttons(host, /Not now/)).toHaveLength(0);
    expect(buttons(host, /^Approve/)).toHaveLength(0);
  });
});

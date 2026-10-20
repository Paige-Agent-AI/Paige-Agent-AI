/**
 * Campaigns › Social — rendered behaviour.
 *
 * EVIDENCE CLASS, stated up front (§32/§70.1). This is a HARNESS drive against an in-memory double,
 * not authenticated runtime proof. It shows that a person can reach the control, change it, submit
 * it, and be told what the server said — and that every state has something to show. It does NOT
 * show that the RPC accepts the payload on production, and must never be reported as if it did.
 *
 * The idiom is the one every other Solo suite uses: raw `createRoot` + `act`, no testing-library,
 * previous root torn down inside `renderAt` so an orphan tree cannot keep answering queries (the
 * failure `sales-ops.contract.test.tsx:82-86` documents).
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const harness = vi.hoisted(() => ({
  social: {} as Record<string, unknown>,
  pending: {} as Record<string, unknown>,
  trust: {} as Record<string, unknown>,
  saved: [] as Array<Record<string, string>>,
  saveResult: { ok: true, recordedCount: 0 } as Record<string, unknown>,
  went: [] as string[],
  nav: {} as Record<string, () => void>,
}));

vi.mock("./useSocialCommand", () => ({ useSocialCommand: () => harness.social }));
vi.mock("./data/useSoloPendingActions", () => ({ useSoloPendingActions: () => harness.pending }));
vi.mock("./data/useSoloTrust", () => ({ useSoloTrust: () => harness.trust }));

const { SocialCommand } = await import("./social-command");

let host: HTMLDivElement;
let root: Root | null = null;

const CAMPAIGNS = { phase: "ready", artifacts: [], submissions: [] };

function renderAt(campaigns: Record<string, unknown> = CAMPAIGNS) {
  // Tear the previous tree down FIRST: an orphan root still answers document queries, so a deleted
  // surface would keep passing a text assertion.
  if (root) act(() => root!.unmount());
  host.remove();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(
      <SocialCommand
        campaigns={campaigns}
        onOpenStudio={harness.nav.studio}
        onAskPaige={harness.nav.paige}
        onOpenCompass={harness.nav.compass}
        onOpenPipeline={harness.nav.pipeline}
      />,
    );
  });
}

const buttonSaying = (text: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent?.includes(text)) as HTMLButtonElement | undefined;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  harness.saved = [];
  harness.went = [];
  harness.nav = {
    studio: () => harness.went.push("studio"),
    paige: () => harness.went.push("paige"),
    compass: () => harness.went.push("compass"),
    pipeline: () => harness.went.push("pipeline"),
  };
  harness.saveResult = { ok: true, recordedCount: 0 };
  harness.social = {
    tenantId: "tenant-1",
    phase: "ready",
    handles: [],
    canManage: true,
    recordChangedAt: null,
    notPermitted: false,
    retry: () => {},
    recordHandles: async (draft: Record<string, string>) => {
      harness.saved.push(draft);
      return harness.saveResult;
    },
  };
  harness.pending = { items: [], loading: false, error: null, refresh: () => {} };
  harness.trust = { loading: false, configured: true, departments: [], bySlug: {}, error: null };
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  host.remove();
  vi.restoreAllMocks();
});

describe("first use — the state a freshly provisioned workspace actually opens on", () => {
  it("says nothing is on record rather than showing zeros", () => {
    renderAt();
    expect(host.textContent).toContain("Nothing is on record yet");
    // Five KPI tiles, and not one of them carrying a number.
    expect(host.querySelectorAll(".social-kpi")).toHaveLength(5);
    expect(host.querySelectorAll(".social-figure--absent").length).toBeGreaterThanOrEqual(5);
    expect(host.textContent).not.toMatch(/\b0\b/);
  });

  it("offers the one thing a person can finish here", () => {
    renderAt();
    expect(buttonSaying("Record accounts")).toBeTruthy();
  });

  it("renders every module, so no part of the surface is missing before data exists", () => {
    renderAt();
    for (const heading of ["Active missions", "PAIGE sees", "Content pipeline", "Channels"]) {
      expect(host.textContent, `${heading} must render`).toContain(heading);
    }
    expect(host.querySelectorAll(".social-stage")).toHaveLength(6);
  });
});

describe("the record flow, driven", () => {
  it("opens the form, accepts a handle, submits it, and reports what the server said", async () => {
    harness.saveResult = { ok: true, recordedCount: 1 };
    renderAt();

    act(() => buttonSaying("Record accounts")!.click());
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog, "the form must open").toBeTruthy();

    const field = [...dialog.querySelectorAll("input")].find(
      (input) => input.previousElementSibling?.textContent === "Instagram",
    ) as HTMLInputElement;
    expect(field).toBeTruthy();

    // React tracks the last value it set, so a bare `.value =` is swallowed on the next change.
    const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
    act(() => {
      setValue.call(field, "@acme");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(field.value).toBe("@acme");

    const form = dialog.querySelector("form") as HTMLFormElement;
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });

    expect(harness.saved).toEqual([{ instagram: "@acme" }]);
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("1 account on record");
  });

  it("clears an account by submitting it empty, and says so in the server's own count", async () => {
    harness.social = { ...harness.social, handles: [{ network: "x", label: "X", handle: "@old" }] };
    harness.saveResult = { ok: true, recordedCount: 0 };
    renderAt();

    act(() => buttonSaying("Update accounts")!.click());
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    const field = [...dialog.querySelectorAll("input")].find(
      (input) => input.previousElementSibling?.textContent === "X",
    ) as HTMLInputElement;
    expect(field.value, "the form must open on what is already on record").toBe("@old");

    const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
    act(() => {
      setValue.call(field, "");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      (dialog.querySelector("form") as HTMLFormElement).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    // An omitted network is cleared — the payload carries no empty string for it.
    expect(harness.saved).toEqual([{}]);
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("No account is on record");
  });

  it("surfaces a refusal as the server wrote it, and does not claim a save", async () => {
    harness.saveResult = { ok: false, message: "Your permission or workspace changed. Reopen this page with owner or admin access." };
    renderAt();
    act(() => buttonSaying("Record accounts")!.click());
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    await act(async () => {
      (dialog.querySelector("form") as HTMLFormElement).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    const text = document.querySelector('[role="dialog"]')!.textContent ?? "";
    expect(text).toContain("Your permission or workspace changed");
    expect(text).not.toContain("Saved.");
  });

  it("refuses the write to a read-only member, in the form and on the hero", () => {
    harness.social = { ...harness.social, canManage: false };
    renderAt();
    expect(host.textContent).toContain("Read-only access");
    act(() => buttonSaying("Record accounts")!.click());
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.textContent).toContain("An owner or admin of this workspace can record these");
    for (const input of dialog.querySelectorAll("input")) expect(input.disabled).toBe(true);
    expect((buttonSaying("Save to record") ?? dialog.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("record dismissal lifetime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(window, "setTimeout");
    vi.spyOn(window, "clearTimeout");
  });
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
  // React may own unrelated scheduled work. Observe only this form's900ms dismissal.
  const closeCalls = () => vi.mocked(window.setTimeout).mock.calls.filter(([, delay]) => delay === 900);

  const open = () => {
    const opener = buttonSaying("Record accounts")!;
    act(() => opener.click());
    return opener;
  };
  const submit = async () => {
    await act(async () => {
      host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
  };
  const unmount = () => { act(() => root!.unmount()); root = null; };
  const redraw = () => act(() => root!.render(
    <SocialCommand campaigns={CAMPAIGNS} onOpenStudio={harness.nav.studio}
      onAskPaige={harness.nav.paige} onOpenCompass={harness.nav.compass} onOpenPipeline={harness.nav.pipeline} />,
  ));
  const holdSave = () => {
    let complete!: (result: Record<string, unknown>) => void;
    const result = new Promise<Record<string, unknown>>(resolve => { complete = resolve; });
    harness.social = { ...harness.social, recordHandles: async (draft: Record<string, string>) => {
      harness.saved.push(draft); return result;
    } };
    return (value = { ok: true, recordedCount: 1 }) => act(async () => { complete(value); });
  };

  it("keeps the successful result visible for900ms, then closes and restores opener focus", async () => {
    renderAt(); const opener = open(); await submit();
    expect(host.querySelector('[role="status"]')?.textContent).toContain("Saved.");
    act(() => vi.advanceTimersByTime(899));
    expect(host.querySelector('[role="dialog"]')).toBeTruthy();
    act(() => vi.advanceTimersByTime(1));
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(harness.saved).toHaveLength(1);
  });

  it("retires its successful dismissal callback before page teardown", async () => {
    renderAt(); const opener = open(); const focus = vi.spyOn(opener, "focus"); await submit();
    const timerIndex = vi.mocked(window.setTimeout).mock.calls.findIndex(([, delay]) => delay === 900);
    expect(timerIndex).toBeGreaterThanOrEqual(0);
    const timer = vi.mocked(window.setTimeout).mock.results[timerIndex].value;
    unmount();
    expect(window.clearTimeout).toHaveBeenCalledWith(timer);
    act(() => vi.advanceTimersByTime(900));
    expect(focus).not.toHaveBeenCalled();
  });

  it("does not let a manually closed form dismiss a newly opened form", async () => {
    renderAt(); const opener = open(); await submit();
    act(() => buttonSaying("Close")!.click());
    expect(document.activeElement).toBe(opener);
    open();
    act(() => vi.advanceTimersByTime(900));
    expect(host.querySelector('[role="dialog"]')).toBeTruthy();
  });

  it("does not schedule UI work when the native save resolves after page unmount", async () => {
    const complete = holdSave(); renderAt(); open(); await submit();
    expect(buttonSaying("Saving")?.disabled).toBe(true);
    unmount(); await complete();
    expect(closeCalls()).toHaveLength(0);
    expect(harness.saved).toHaveLength(1);
  });

  it("preserves successful dismissal across the incumbent Social read-refresh remount", async () => {
    const complete = holdSave(); renderAt(); open(); await submit();
    harness.social = { ...harness.social, phase: "loading" }; redraw();
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    await complete();
    harness.social = { ...harness.social, phase: "ready" }; redraw();
    expect(host.querySelector('[role="dialog"]')).toBeTruthy();
    act(() => vi.advanceTimersByTime(900));
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(harness.saved).toHaveLength(1);
  });

  it("gives a later explicit save its own full dismissal delay", async () => {
    renderAt(); open(); await submit();
    act(() => vi.advanceTimersByTime(400));
    await submit();
    act(() => vi.advanceTimersByTime(500));
    expect(host.querySelector('[role="dialog"]')).toBeTruthy();
    act(() => vi.advanceTimersByTime(400));
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(harness.saved).toHaveLength(2);
  });

  it("retires the prior workspace's dismissal callback when the page changes context", async () => {
    renderAt(); open(); await submit();
    harness.social = { ...harness.social, tenantId: "tenant-2" }; redraw();
    act(() => vi.advanceTimersByTime(900));
    expect(host.querySelector('[role="dialog"]')).toBeTruthy();
  });

  it("leaves a native refusal visible without scheduling dismissal", async () => {
    harness.saveResult = { ok: false, message: "Your permission or workspace changed." };
    renderAt(); open(); await submit();
    expect(closeCalls()).toHaveLength(0);
    act(() => vi.advanceTimersByTime(900));
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain("Your permission or workspace changed.");
  });
});

describe("recorded accounts", () => {
  beforeEach(() => {
    harness.social = {
      ...harness.social,
      handles: [
        { network: "instagram", label: "Instagram", handle: "@acme" },
        { network: "linkedin", label: "LinkedIn", handle: "acme-co" },
      ],
      recordChangedAt: "2026-09-04T10:00:00.000Z",
    };
  });

  it("shows each account as a record and gives none of them a metric", () => {
    renderAt();
    expect(host.textContent).toContain("@acme");
    expect(host.textContent).toContain("acme-co");
    expect(host.querySelectorAll(".social-channels li")).toHaveLength(2);
    // Every channel card's metric slot is the absent mark, never a number.
    for (const card of host.querySelectorAll(".social-channel-metric")) {
      expect(card.querySelector(".social-figure--absent"), "a channel must carry no audience figure").toBeTruthy();
    }
  });

  it("states the record's own last-changed time and refuses a per-account one", () => {
    renderAt();
    expect(host.textContent).toMatch(/This workspace record last changed/);
    expect(host.textContent).toContain("no per-account date is shown");
  });
});

describe("what PAIGE has filed", () => {
  it("shows only growth-desk work, with the desk that filed it", () => {
    harness.pending = {
      loading: false, error: null, refresh: () => {},
      items: [
        { id: "a", title: "Draft the launch note", summary: "Ready for your read", department: "marketing", rationale: "Filed for your decision", createdAt: "2026-09-04" },
        { id: "b", title: "Retention policy review", summary: null, department: "legal_compliance", rationale: null, createdAt: "2026-09-04" },
      ],
    };
    renderAt();
    expect(host.textContent).toContain("Draft the launch note");
    expect(host.textContent).not.toContain("Retention policy review");
  });

  it("distinguishes a failed read from nothing waiting", () => {
    harness.pending = { items: [], loading: false, error: "read_failed", refresh: () => {} };
    renderAt();
    expect(host.textContent).toContain("This could not be read");
    expect(host.textContent).not.toContain("Nothing is waiting on you");
  });
});

describe("states", () => {
  it("distinguishes resolving, loading, unresolved and failed, and never blanks", () => {
    for (const [phase, expected] of [
      ["resolving", "Resolving this account"],
      ["unavailable", "Social needs a resolved workspace"],
      ["error", "could not be read"],
    ] as const) {
      harness.social = { ...harness.social, phase };
      renderAt();
      expect(host.textContent, `phase ${phase}`).toContain(expected);
    }
    harness.social = { ...harness.social, phase: "loading" };
    renderAt();
    expect(host.querySelector('[role="status"]')?.getAttribute("aria-label")).toBe("Loading Social");
  });

  it("tells a member their access is the reason, not that the business has no accounts", () => {
    harness.social = { ...harness.social, notPermitted: true, canManage: false, handles: [] };
    renderAt();
    expect(host.textContent).toContain("Not shown at your access level");
    expect(host.textContent).not.toContain("No account is on record");
  });
});

describe("Trust Compass is reflected, never re-implemented", () => {
  it("labels the lanes as the platform default and offers no control", () => {
    harness.trust = {
      loading: false, configured: true, error: null, bySlug: {},
      departments: [{ slug: "marketing", name: "Marketing", acts: [{ label: "Draft a campaign", lane: "confirm" }] }],
    };
    renderAt();
    expect(host.textContent).toContain("Drafts for you");
    expect(host.textContent).toContain("the platform default for these desks");
    // No autonomy control may exist here: exactly one lives on this platform, and it is not this.
    expect(host.querySelectorAll('input[type="range"], select')).toHaveLength(0);
    expect(host.textContent).not.toMatch(/your settings|you chose|change autonomy/i);
  });

  it("renders nothing rather than an empty frame when no lane is readable", () => {
    renderAt();
    expect(host.querySelector(".social-governance")).toBeNull();
  });
});

describe("the next move — the question the surface could not answer before", () => {
  const move = () => host.querySelector(".social-next")?.textContent ?? "";

  it("tells a brand-new workspace to name its accounts, and the button does it", () => {
    renderAt();
    expect(move()).toContain("PAIGE does not know which accounts are yours");
    act(() => (host.querySelector(".social-next-act") as HTMLButtonElement).click());
    expect(document.querySelector('[role="dialog"]'), "the move must open the record form").toBeTruthy();
  });

  it("puts a delivery that failed above everything else", () => {
    renderAt({ ...CAMPAIGNS, artifacts: [{ routingState: "Active", recentDispatches: { failed: 2 } }] });
    expect(move()).toContain("not delivering");
    act(() => (host.querySelector(".social-next-act") as HTMLButtonElement).click());
    expect(harness.went).toEqual(["pipeline"]);
  });

  it("sends held drafts to Trust Compass, and ranks them below a failure", () => {
    harness.pending = {
      loading: false, error: null, refresh: () => {},
      items: [{ id: "a", title: "Draft", summary: null, department: "marketing", rationale: null, createdAt: "2026-09-04" }],
    };
    renderAt();
    expect(move()).toContain("holding");
    act(() => (host.querySelector(".social-next-act") as HTMLButtonElement).click());
    expect(harness.went).toEqual(["compass"]);

    // ...and a failure outranks it.
    harness.went = [];
    renderAt({ ...CAMPAIGNS, artifacts: [{ routingState: "Active", recentDispatches: { failed: 1 } }] });
    expect(move()).toContain("not delivering");
  });

  it("asks for something to publish once accounts exist but nothing does", () => {
    harness.social = { ...harness.social, handles: [{ network: "x", label: "X", handle: "@a" }] };
    renderAt();
    expect(move()).toContain("nothing published");
    act(() => (host.querySelector(".social-next-act") as HTMLButtonElement).click());
    expect(harness.went).toEqual(["studio"]);
  });

  it("falls through to the conversation when nothing is broken or waiting", () => {
    harness.social = { ...harness.social, handles: [{ network: "x", label: "X", handle: "@a" }] };
    renderAt({ ...CAMPAIGNS, artifacts: [{ routingState: "Active", recentDispatches: { failed: 0 } }] });
    expect(move()).toContain("Nothing is waiting on you here");
    act(() => (host.querySelector(".social-next-act") as HTMLButtonElement).click());
    expect(harness.went).toEqual(["paige"]);
  });

  it("never puts a bare zero in front of a person, in any branch", () => {
    // The first-use branch is the one that fires on an empty workspace, and it is the branch most
    // likely to want to say "0 accounts". It may not.
    renderAt();
    expect(move()).not.toMatch(/\b0\b/);
  });
});

describe("executive chrome", () => {
  it("gives every section a glyph plate and keeps its heading", () => {
    renderAt();
    expect(host.querySelectorAll(".social-panel-glyph")).toHaveLength(4);
  });

  it("dates what PAIGE is holding, and gives the reason its own line", () => {
    harness.pending = {
      loading: false, error: null, refresh: () => {},
      items: [{
        id: "a", title: "Draft the launch note", summary: "Ready for your read",
        department: "marketing", rationale: "Filed for your decision",
        createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
      }],
    };
    renderAt();
    expect(host.querySelector(".social-feed-age")?.textContent).toMatch(/ago$/);
    // The rationale is its own dimmer line, not concatenated onto the desk name.
    expect(host.querySelector(".social-feed-why")?.textContent).toBe("Filed for your decision");
    expect(host.querySelector(".social-feed small")?.textContent).toBe("marketing");
  });
});

/**
 * A FAILED READ IS NOT AN EMPTY RESULT — driven on the page, in both halves.
 *
 * These are the §39 peer-gate's F1 and F2 as standing tests. Both were reproducible on the rendered
 * page while every builder-level assertion was green, because the builder tests checked where the
 * next-move ladder GOES and the campaigns half had no unknown flag at all. The distinguishing
 * property of this suite is that it reads the sentences a person actually sees, with a hook in its
 * error state, which is the only place the two halves of the surface can be caught disagreeing.
 */
describe("a failed read never renders as good news", () => {
  const said = () => (host.textContent ?? "").replace(/\s+/g, " ");

  it("does not announce an empty queue when the pending read failed", () => {
    harness.social = { ...harness.social, handles: [{ network: "instagram", label: "Instagram", handle: "@acme" }] };
    // The hook does NOT clear `items` on error, so a stale count outlives the read. Both must be
    // survived: the failure flag, and the stale number underneath it.
    harness.pending = {
      loading: false,
      error: "boom",
      refresh: () => {},
      items: [{ id: "a", title: "t", summary: "s", department: "marketing", rationale: "r", createdAt: "2026-09-04" }],
    };
    renderAt({ ...CAMPAIGNS, artifacts: [{ routingState: "No route", recentDispatches: {} }] });

    expect(said()).not.toContain("Nothing is waiting on you here");
    expect(said()).not.toContain("waiting on your decision");
    expect(said()).toContain("has not been read");
  });

  it("claims nothing about published work, deliveries or approvals when the campaigns read failed", () => {
    harness.social = { ...harness.social, handles: [{ network: "instagram", label: "Instagram", handle: "@acme" }] };
    renderAt({ phase: "error", artifacts: [], submissions: [] });

    const text = said();
    // The highest-consequence sentence on this surface: a lead can be failing to deliver right now.
    expect(text).not.toContain("Every recorded delivery of yours succeeded");
    expect(text).not.toContain("You have not published anything yet");
    expect(text).not.toContain("No form of yours is waiting on an approval");
    expect(text).not.toContain("No form of yours has a recorded response yet");
    expect(text).not.toContain("Nothing is waiting on you here");
    expect(text).toContain("has not been read");
  });

  it("does not offer to rebuild work it could not read", () => {
    harness.social = { ...harness.social, handles: [{ network: "instagram", label: "Instagram", handle: "@acme" }] };
    renderAt({ phase: "error", artifacts: [], submissions: [] });
    // Branch 4's control. On a failed read `publishedOutputs` is zero like everything else, and
    // "Open Vibe Studio" would send a person to rebuild what they may already own.
    expect(said()).not.toContain("There is nothing published to put in front of anyone");
  });

  it("says nothing about campaign work that is still being read", () => {
    // THE SECOND PEER-GATE'S HEADLINE FINDING. `useSoloCampaigns` returns `{...empty}` for loading
    // and unavailable as well as error, and only error was flagged — so the four sentences came
    // straight back in a sibling phase. In flight is the MOST reachable of the three: six round
    // trips against social's two on first paint, and a synchronous flip on every tenant switch.
    for (const phase of ["loading", "unavailable"]) {
      harness.social = { ...harness.social, handles: [{ network: "instagram", label: "Instagram", handle: "@acme" }] };
      renderAt({ phase, artifacts: [], submissions: [] });
      const text = said();
      expect(text, `campaigns.phase="${phase}"`).not.toContain("Every recorded delivery of yours succeeded");
      expect(text, `campaigns.phase="${phase}"`).not.toContain("You have not published anything yet");
      expect(text, `campaigns.phase="${phase}"`).not.toContain("No form of yours is waiting on an approval");
      expect(text, `campaigns.phase="${phase}"`).not.toContain("There is nothing published to put in front of anyone");
      expect(text, `campaigns.phase="${phase}"`).toContain("has not been read");
    }
  });

  it("does not announce an empty queue while that queue is still loading", () => {
    // `useSoloPendingActions` starts `{items: [], loading: true, error: null}`, so the first paint
    // had a zero with no error beside it — and the terminal branch called that good news while the
    // panel that reads the same table was still showing its skeleton.
    harness.social = { ...harness.social, handles: [{ network: "instagram", label: "Instagram", handle: "@acme" }] };
    harness.pending = { items: [], loading: true, error: null, refresh: () => {} };
    renderAt({ ...CAMPAIGNS, artifacts: [{ routingState: "Active", recentDispatches: {} }] });

    expect(said()).not.toContain("Nothing is waiting on you here");
    expect(said()).not.toContain("Nothing is waiting on your decision right now");
  });

  it("claims nothing about a workspace record the caller was refused sight of", () => {
    // `get_social_presence_evidence` has three refusals and every one returns a successful response
    // carrying zero on-record rows. Only the access one was surfaced, so an ordinary team member —
    // not a tenant admin, which is the common case, not an edge — was told PAIGE did not know their
    // accounts and handed a button they cannot complete (§13 + §70).
    harness.social = {
      ...harness.social,
      handles: [],
      canManage: false,
      notPermitted: true,
      handlesUnknown: true,
    };
    renderAt();

    const text = said();
    expect(text).not.toContain("PAIGE does not know which accounts are yours");
    expect(text).not.toContain("You have not told PAIGE which accounts are yours yet");
    expect(text).not.toContain("Nothing is on record yet");
    expect(text).toContain("has not been read");
    // And the dead-end control is not offered.
    const labels = [...host.querySelectorAll("button")].map((b) => b.textContent ?? "");
    expect(labels.join(" | ")).not.toContain("Record accounts");
  });

  it("does not assert an empty account list in the panel while the brief says it was not read", () => {
    /**
     * THE THIRD-ROUND FINDING, and the third time the same shape got through: the guard was
     * written for the case that already worked. Every earlier test set `notPermitted` and
     * `handlesUnknown` TOGETHER — only the one refusal `notPermitted` already covered. `refused` is
     * a strict SUBSET of `unreadable`, so the other two refusals left the Channels panel asserting
     * "No account is on record" three panels below a brief saying the record had not been read.
     * That is verbatim the contradiction the fix was written to remove, surviving in the panel it
     * named. This is the combination no test reached.
     */
    harness.social = {
      ...harness.social,
      handles: [],
      canManage: true,
      notPermitted: false,
      handlesUnknown: true,
    };
    renderAt();

    const text = said();
    expect(text).not.toContain("No account is on record");
    expect(text).not.toContain("You have not told PAIGE which accounts are yours yet");
    expect(text).toContain("has not been read");
  });

  it("does not tell an owner they are read-only when their access could not be checked", () => {
    /**
     * The FOURTH fallible source. `role.error` was never checked, so a blip in the membership read
     * rendered as "you have no authority" — and once the record button was made conditional on
     * `canManage`, that blip cost a genuine owner the only action this surface offers.
     */
    harness.social = {
      ...harness.social,
      handles: [{ network: "instagram", label: "Instagram", handle: "@acme" }],
      canManage: false,
      authorityUnknown: true,
    };
    renderAt();

    const text = said();
    expect(text).not.toContain("Read-only access");
    expect(text).toContain("could not be checked");
    // And there is a way back, not just a verdict.
    const labels = [...host.querySelectorAll("button")].map((b) => b.textContent ?? "").join(" | ");
    expect(labels).toContain("Retry access");
  });

  it("keeps saying read-only when access WAS checked and the answer was no", () => {
    // The honest denial must survive; the fix must not turn every denial into an unknown.
    harness.social = { ...harness.social, canManage: false, authorityUnknown: false };
    renderAt();
    expect(said()).toContain("Read-only access");
  });

  it("still shows a real move when only one source failed and the other has work", () => {
    harness.social = { ...harness.social, handles: [{ network: "instagram", label: "Instagram", handle: "@acme" }] };
    harness.pending = { loading: false, error: "boom", refresh: () => {}, items: [] };
    // A failing delivery is real, read successfully, and must not be swallowed by the other half's
    // failure — the unknown branch sits BELOW it in the ladder for exactly this reason.
    renderAt({ ...CAMPAIGNS, artifacts: [{ routingState: "Active", recentDispatches: { failed: 2 } }] });
    expect(said()).toContain("not delivering");
  });
});

describe("§13 on the rendered page — the hole the builder-only guard could not see", () => {
  /**
   * The contract suite asserts the denial rule over what `social-truth.ts` RETURNS. That is the
   * right place for it and it is not enough: every sentence written directly into the JSX bypasses
   * it completely, and a voice pass is precisely when prose gets inlined. So this reads the page a
   * person actually sees, in several states, and applies the same rule to all of it.
   */
  const NEGATED = /\b(no|not|never|nothing|none|cannot|does not|is not|without|neither)\b/;
  /**
   * A metric can be denied by CONDITION as well as by negation, and the §58-protected placement
   * precondition — "they count as placements only once a supported provider records where they
   * went live" — is exactly that: it names a metric in order to say what would have to exist
   * before the metric could be claimed. Refusing it would push the surface toward vaguer prose,
   * which is the opposite of what §13 wants. So conditional denial counts, but only in its
   * unambiguous forms: a bare `only` is NOT enough ("reach grew only last week" is a claim),
   * `only once/when/after/if` and `until` are, because each one states the unmet precondition.
   */
  const CONDITIONAL = /\bonly (once|when|after|if)\b|\buntil\b|\bwould have to\b/;
  /**
   * `i` is load-bearing, and its absence made this guard weaker than it looked. `NEGATED` and
   * `CONDITIONAL` are tested against `sentence.toLowerCase()`; `METRIC` was tested against the RAW
   * sentence, so "Reach keeps climbing." and "Followers are up this week." did not match, hit the
   * `continue`, and were never examined at all — the guard skipped precisely the sentences most
   * likely to be a fabrication, because a claim tends to lead with its metric.
   */
  const METRIC = /\b(followers?|reach(?:ed|es)?|engagement|impressions?|audience|placements?|scheduled?|views?|likes?|subscribers?|clicks?|shares?)\b/i;

  /**
   * Read the page as SEPARATE strings, never as one `textContent`.
   *
   * `host.textContent` concatenates adjacent elements with no separator, so a label and the note
   * beside it really do arrive glued: `"No account is on recordFollowers are up 12%."` — and
   * `\bfollowers\b` then fails against `recordFollowers`, so the sentence is skipped entirely. The
   * glue was silently disarming the guard on exactly the boundary where a label meets a claim.
   * Walking text nodes keeps every string in its own element, which is how a person reads them.
   */
  const pageStrings = () => {
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
    const out: string[] = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const t = (n.textContent ?? "").replace(/\s+/g, " ").trim();
      if (t) out.push(t);
    }
    return out;
  };

  /**
   * A LABEL is not a CLAIM — but which strings are labels is decided by the DOM, not by shape.
   *
   * The first version inferred it: short, no digits, no full stop. Measured on a populated render
   * that skipped 46 of 84 text nodes, and the exemption had quietly grown to cover server-supplied
   * free text — `paige_actions.title`, `.summary`, `.decision_rationale`, and action-kind labels.
   * So a filed action titled "Followers are climbing" rendered straight into the PAIGE sees panel
   * and the guard stepped over it, because it happened to be four words with no full stop.
   *
   * A label is an element the surface uses AS a label: the tile and stage headings, and the panel
   * heads. Anything else is prose and gets the rule, however short. Naming a metric in a heading in
   * order to refuse it a figure is the whole point of those tiles (§58 protects that copy); naming
   * one anywhere else is a claim.
   */
  const labelNodes = () => {
    const set = new Set<Node>();
    for (const el of host.querySelectorAll(
      ".social-kpi h3, .social-kpi h4, .social-stage h4, .social-panel > header h3, .social-panel-head h3, .social-empty h4",
    )) {
      for (const n of el.childNodes) if (n.nodeType === 3) set.add(n);
    }
    return set;
  };

  const scan = (label: string) => {
    const labels = labelNodes();
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
    const strings: string[] = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (labels.has(n)) continue;
      const t = (n.textContent ?? "").replace(/\s+/g, " ").trim();
      if (t) strings.push(t);
    }
    for (const sentence of strings.join("\n").split(/\n|(?<=[.!?])\s+/)) {
      if (!METRIC.test(sentence)) continue;
      const lower = sentence.toLowerCase();
      expect(
        NEGATED.test(lower) || CONDITIONAL.test(lower),
        `${label}: a metric is named without being denied — "${sentence.trim().slice(0, 160)}"`,
      ).toBe(true);
    }
  };

  it("names no metric it cannot produce, in any state a person can reach", () => {
    renderAt();
    scan("first use");

    harness.social = {
      ...harness.social,
      handles: [
        { network: "instagram", label: "Instagram", handle: "@acme" },
        { network: "linkedin", label: "LinkedIn", handle: "acme" },
      ],
      recordChangedAt: "2026-09-04T10:00:00.000Z",
    };
    harness.pending = {
      loading: false, error: null, refresh: () => {},
      items: [{ id: "a", title: "Draft the note", summary: "Ready", department: "marketing", rationale: "Filed for your decision", createdAt: "2026-09-04" }],
    };
    harness.trust = {
      loading: false, configured: true, error: null, bySlug: {},
      departments: [{ slug: "marketing", name: "Marketing", acts: [{ label: "Draft a campaign", lane: "confirm" }] }],
    };
    renderAt({ ...CAMPAIGNS, artifacts: [{ routingState: "Active + approval-gated", recentDispatches: { failed: 1 } }], submissions: [{ id: "s" }] });
    scan("populated");
  });

  it("shows no number anywhere that a real record did not produce", () => {
    // Every figure on a first-use page must be the absent mark. A digit here means something
    // invented one, which is the failure mode this whole surface is built against.
    renderAt();
    const figures = [...host.querySelectorAll(".social-figure")];
    expect(figures.length).toBeGreaterThan(6);
    for (const figure of figures) {
      expect(figure.textContent ?? "", "a figure carries a number on an empty workspace")
        .not.toMatch(/[0-9]/);
    }
  });
});

describe("shell contract", () => {
  it("renders no masthead and declares no tab role", () => {
    renderAt();
    expect(host.querySelector(".pg-hd")).toBeNull();
    expect(host.querySelectorAll('[role="tab"], [role="tablist"]')).toHaveLength(0);
  });

  it("keeps the Vibe Studio launcher the replaced panel offered", () => {
    renderAt();
    expect(host.querySelector("[data-solo-vibe-studio-launcher]")).toBeTruthy();
  });
});

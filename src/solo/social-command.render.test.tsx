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
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const harness = vi.hoisted(() => ({
  social: {} as Record<string, unknown>,
  saved: [] as Array<Record<string, string>>,
  saveResult: { ok: true, recordedCount: 0 } as Record<string, unknown>,
  went: [] as string[],
  nav: {} as Record<string, () => void>,
}));

vi.mock("./useSocialCommand", () => ({ useSocialCommand: () => harness.social }));
// The Go Live panel owns its own door/world suite; this harness proves the tab around it.
vi.mock("./go-live", () => ({ GoLive: () => <div data-golive-stub /> }));
vi.mock("@/hooks/useTenantContext", () => ({ useTenantContext: () => ({
  activeTenantId: harness.social.tenantId, activeUserId: "solo-test-user", loading: false, accountContextLoading: false,
}) }));
vi.mock("./social-publishing-desk", () => ({
  SocialPublishingDesk: ({ tenantId, canManage }: { tenantId: string; canManage: boolean }) =>
    <div data-social-desk={tenantId} data-manage={String(canManage)} />,
}));

const { SocialCommand } = await import("./social-command");

let host: HTMLDivElement;
let root: Root | null = null;

function renderAt() {
  // Tear the previous tree down FIRST: an orphan root still answers document queries, so a deleted
  // surface would keep passing a text assertion.
  if (root) act(() => root!.unmount());
  host.remove();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(routedSocial()));
}

function routedSocial() {
  return (
    <MemoryRouter initialEntries={["/solo/1234567/growth/social"]}>
      <Routes>
        <Route path="/solo/:account/growth/social" element={
          <SocialCommand
            onOpenStudio={harness.nav.studio}
            onAskPaige={harness.nav.paige}
          />
        } />
      </Routes>
    </MemoryRouter>
  );
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
  };
  harness.saveResult = { ok: true, recordedCount: 0 };
  harness.social = {
    tenantId: "tenant-1",
    phase: "ready",
    handles: [],
    // The hook's own contract: connections is always an array (every phase supplies it), so the
    // harness default supplies it too rather than letting a phase fall through as undefined.
    connections: [],
    canManage: true,
    recordChangedAt: null,
    notPermitted: false,
    retry: () => {},
    recordHandles: async (draft: Record<string, string>) => {
      harness.saved.push(draft);
      return harness.saveResult;
    },
  };
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  host.remove();
  vi.restoreAllMocks();
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

  it("withholds the writer from a member without account access", () => {
    harness.social = { ...harness.social, canManage: false, notPermitted: true };
    renderAt();
    expect(host.textContent).toContain("Only workspace owners and admins can see the account record");
    expect(buttonSaying("Record accounts")).toBeUndefined();
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(harness.saved).toHaveLength(0);
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
  const redraw = () => act(() => root!.render(routedSocial()));
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
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    open();
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

describe("the shared Social workspace", () => {
  it("mounts one Visual Desk and preserves the separate broadcast control", () => {
    renderAt();
    expect(host.querySelectorAll('[data-social-desk="tenant-1"]')).toHaveLength(1);
    expect(host.querySelector('[data-golive-stub]')).toBeTruthy();
    expect(host.querySelector(".social-hero, .social-kpis, .social-pipeline")).toBeNull();
  });

  it("keeps the same Desk mounted during an account refresh and replaces it on a workspace change", () => {
    renderAt();
    const prior = host.querySelector('[data-social-desk="tenant-1"]');
    expect(prior).toBeTruthy();
    harness.social = { ...harness.social, phase: "loading" };
    act(() => root!.render(routedSocial()));
    expect(host.querySelector('[data-social-desk="tenant-1"]')).toBe(prior);
    harness.social = { ...harness.social, phase: "ready", tenantId: "tenant-2", canManage: false };
    act(() => root!.render(routedSocial()));
    expect(host.querySelector('[data-social-desk="tenant-1"]')).toBeNull();
    expect(host.querySelector('[data-social-desk="tenant-2"]')?.getAttribute('data-manage')).toBe("false");
  });

  it("shows a refused account read and a retry instead of presenting it as an empty workspace", () => {
    harness.social = { ...harness.social, phase: "error", retry: () => harness.went.push("retry") };
    renderAt();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Social access could not be checked");
    act(() => buttonSaying("Try again")!.click());
    expect(harness.went).toEqual(["retry"]);
  });

  it("keeps declared handles and their record timestamp distinct from verified connections", () => {
    harness.social = { ...harness.social, handles: [{ network: "x", label: "X", handle: "@acme" }],
      recordChangedAt: "2026-09-04T10:00:00.000Z" };
    renderAt();
    expect(host.querySelector(".social-declared-accounts")?.textContent).toContain("@acme");
    expect(host.textContent).toContain("Workspace account record updated");
    expect(host.querySelector(".social-connections-list")).toBeNull();
  });
});

describe("live-connected accounts show up on this tab (owner directive 2026-11-04)", () => {
  const connected = {
    network: "facebook", status: "connected", label: "Acme Media Page",
    verifiedAt: "2026-11-04T10:00:00.000Z", profiles: 2,
  };

  it("shows the connected account, its label, its consent boundary, and the one manage link", () => {
    harness.social = { ...harness.social, connections: [connected] };
    renderAt();
    const panel = host.querySelector(".social-connections");
    expect(panel).toBeTruthy();
    expect(panel!.textContent).toContain("Facebook");
    expect(panel!.textContent).toContain("Acme Media Page");
    expect(panel!.textContent).toContain("consent to read the account, not to publish");
    expect(panel!.textContent).toContain("Last verified");
    const manage = panel!.querySelector<HTMLAnchorElement>("a.social-connections-manage");
    expect(manage).toBeTruthy();
    expect(manage!.getAttribute("href")).toBe("/solo/1234567/settings/integrations");
  });

  it("a needs_reauth connection shows with its own honest state, never as connected", () => {
    harness.social = {
      ...harness.social,
      connections: [{ network: "instagram", status: "needs_reauth", label: null, verifiedAt: null, profiles: 1 }],
    };
    renderAt();
    const panel = host.querySelector(".social-connections");
    expect(panel).toBeTruthy();
    expect(panel!.querySelector("li[data-state='needs_reauth']")).toBeTruthy();
    expect(panel!.textContent).toContain("sign in again");
    expect(panel!.textContent).not.toContain("Last verified");
    expect(panel!.textContent).not.toContain("One account is connected");
  });
});

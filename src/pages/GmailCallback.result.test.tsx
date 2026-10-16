import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation, useNavigate, type NavigateFunction } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import GmailCallback from "./GmailCallback";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const ports = vi.hoisted(() => ({ invoke: vi.fn(), toast: vi.fn(), returnPath: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: ports.invoke } } }));
vi.mock("sonner", () => ({ toast: { success: ports.toast } }));
vi.mock("@/solo/data/oauthReturn", () => ({ takeOAuthReturn: ports.returnPath }));
const mounted: { root: Root; host: HTMLElement; live: boolean }[] = [];
const START = "/oauth/gmail/callback?code=neutral-code&state=neutral-signed-state";
const DEST = "/solo/test-account/settings/connections";
type InvokeResult = { data: unknown; error: unknown };
function deferred() {
  let resolve!: (value: InvokeResult) => void;
  const promise = new Promise<InvokeResult>(done => { resolve = done; });
  return { resolve, promise };
}
async function flush() { await act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); }); }
async function mount(strict = false, path = START) {
  const host = document.createElement("div"); document.body.append(host);
  const item = { root: createRoot(host), host, live: true }; mounted.push(item);
  const observed = { path: "", navigate: undefined as unknown as NavigateFunction };
  function Location() {
    const location = useLocation(); observed.path = location.pathname + location.search;
    observed.navigate = useNavigate(); return null;
  }
  const body = <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
    <GmailCallback/><Location/>
  </MemoryRouter>;
  await act(async () => item.root.render(strict ? <StrictMode>{body}</StrictMode> : body));
  await flush();
  return { host, observed, unmount: () => {
    if (item.live) { act(() => item.root.unmount()); item.live = false; }
  } };
}
function wire(body: unknown, mode: "body" | "http" | "parsed" = "body"): InvokeResult {
  return mode === "body" ? { data: body, error: null } : { data: null, error: { message: "Edge Function returned a non-2xx status code",
    context: mode === "http" ? new Response(JSON.stringify(body), { status: 409 }) : body } };
}
async function noCompletion(view: Awaited<ReturnType<typeof mount>>) {
  expect(ports.toast).not.toHaveBeenCalled(); expect(ports.returnPath).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTime(1500));
  expect(view.observed.path).toBe(START); expect(ports.invoke).toHaveBeenCalledTimes(1);
}
beforeEach(() => {
  vi.useFakeTimers(); ports.invoke.mockReset(); ports.toast.mockReset(); ports.returnPath.mockReset().mockReturnValue(DEST);
  ports.invoke.mockResolvedValue(wire({ ok: true, connection_saved: true, gmail_address: "fixture@example.invalid" }));
});
afterEach(() => {
  for (const item of mounted.splice(0)) { if (item.live) act(() => item.root.unmount()); item.host.remove(); }
  vi.useRealTimers();
});

describe("existing Gmail callback displays native persistence truth without retrying consent", () => {
  for (const legacy of [false, true]) {
    it(`preserves the ${legacy ? "legacy" : "native-confirmed"} success return to Connections`, async () => {
      ports.invoke.mockResolvedValue(wire({ ok: true, ...(legacy ? {} : { connection_saved: true }),
        gmail_address: "fixture@example.invalid", return_origin: "https://untrusted.invalid" }));
      const view = await mount();
      expect(view.host.textContent).toContain("Connected as fixture@example.invalid");
      expect(ports.invoke).toHaveBeenCalledWith("gmail-oauth-callback", { body: {
        code: "neutral-code", state: "neutral-signed-state", origin: window.location.origin,
      } });
      expect(ports.toast).toHaveBeenCalledExactlyOnceWith("Gmail connected");
      expect(ports.returnPath).toHaveBeenCalledTimes(1);
      await act(async () => vi.advanceTimersByTime(1199)); expect(view.observed.path).toBe(START);
      await act(async () => vi.advanceTimersByTime(1)); expect(view.observed.path).toBe(DEST);
    });
  }
  for (const mode of ["body", "http", "parsed"] as const) {
    it(`preserves known saved-but-withheld truth from ${mode} without private detail or redirect`, async () => {
      ports.invoke.mockResolvedValue(wire({ error: "gmail_connection_saved_result_withheld", connection_saved: true,
        gmail_address: "private@example.invalid" }, mode));
      const view = await mount(); expect(view.host.textContent).toContain("connection was saved in the original workspace");
      expect(view.host.textContent).not.toContain("private@example.invalid");
      await noCompletion(view);
    });
    it(`maps a real refused ${mode} response rather than displaying its framework error`, async () => {
      ports.invoke.mockResolvedValue(wire({ error: "workspace_changed", connection_saved: false }, mode));
      const view = await mount(); expect(view.host.textContent).toContain("workspace or access changed");
      expect(view.host.textContent).not.toContain("non-2xx"); await noCompletion(view);
    });
    it(`keeps a lost native acknowledgement unknown from ${mode}, never asks for immediate retry`, async () => {
      ports.invoke.mockResolvedValue(wire({ error: "gmail_connection_outcome_unknown", connection_saved: null }, mode));
      const view = await mount(); expect(view.host.textContent).toContain("It may have completed");
      expect(view.host.textContent).toContain("before reconnecting"); await noCompletion(view);
    });
  }
  for (const body of [null, {}, { ok: true }, { ok: true, gmail_address: " " },
    { ok: true, gmail_address: "fixture@example.invalid", connection_saved: false },
    { error: "gmail_connection_saved_result_withheld", connection_saved: false }]) {
    it(`refuses an incomplete or contradictory acknowledgement ${JSON.stringify(body)}`, async () => {
      ports.invoke.mockResolvedValue(wire(body)); const view = await mount();
      expect(view.host.textContent).toContain("It may have completed"); await noCompletion(view);
    });
  }
  it("keeps thrown/lost transport unknown without a second invocation", async () => {
    ports.invoke.mockRejectedValue(new Error("neutral lost acknowledgement"));
    const view = await mount(); expect(view.host.textContent).toContain("It may have completed"); await noCompletion(view);
  });
  it("does not reinvoke a code or consume the return twice under StrictMode effect replay", async () => {
    const pending = deferred(); ports.invoke.mockReturnValue(pending.promise);
    const view = await mount(true); expect(ports.invoke).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve(wire({ ok: true, connection_saved: true, gmail_address: "fixture@example.invalid" })));
    await flush(); expect(ports.toast).toHaveBeenCalledTimes(1); expect(ports.returnPath).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTime(1200)); expect(view.observed.path).toBe(DEST);
  });
  it("retires a late saved response after unmount without toast or return consumption", async () => {
    const pending = deferred(); ports.invoke.mockReturnValue(pending.promise);
    const view = await mount(); view.unmount();
    await act(async () => pending.resolve(wire({ ok: true, connection_saved: true, gmail_address: "former@example.invalid" })));
    await flush(); expect(ports.toast).not.toHaveBeenCalled(); expect(ports.returnPath).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0); expect(ports.invoke).toHaveBeenCalledTimes(1);
  });
  it("cleans up the existing success redirect timer on unmount", async () => {
    const view = await mount(); expect(vi.getTimerCount()).toBe(1);
    view.unmount(); expect(vi.getTimerCount()).toBe(0);
    await act(async () => vi.advanceTimersByTime(1500)); expect(ports.invoke).toHaveBeenCalledTimes(1);
  });
  it("retires a former code's late response when a different consent round is current", async () => {
    const former = deferred(); const current = deferred(); ports.invoke.mockReturnValueOnce(former.promise).mockReturnValueOnce(current.promise);
    const view = await mount();
    await act(async () => view.observed.navigate("/oauth/gmail/callback?code=second-code&state=second-state"));
    expect(ports.invoke).toHaveBeenCalledTimes(2);
    await act(async () => former.resolve(wire({ ok: true, connection_saved: true, gmail_address: "former@example.invalid" })));
    await flush(); expect(view.host.textContent).not.toContain("former@example.invalid"); expect(ports.toast).not.toHaveBeenCalled();
    await act(async () => current.resolve(wire({ error: "gmail_connection_outcome_unknown", connection_saved: null })));
    await flush(); expect(view.host.textContent).toContain("It may have completed"); expect(ports.toast).not.toHaveBeenCalled();
    expect(ports.returnPath).not.toHaveBeenCalled();
  });
  for (const query of ["", "?error=access_denied", "?code=neutral-code", "?state=neutral-state"]) {
    it(`preserves the no-exchange query error/missing-param exit ${query}`, async () => {
      const view = await mount(false, `/oauth/gmail/callback${query}`);
      expect(view.host.textContent).toMatch(/Google returned an error|Missing code or state/);
      expect(ports.invoke).not.toHaveBeenCalled(); expect(ports.toast).not.toHaveBeenCalled();
    });
  }
});

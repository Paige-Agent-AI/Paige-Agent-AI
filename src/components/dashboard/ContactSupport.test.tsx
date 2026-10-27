// The support form reads send-support-request's honest refusal body. An UNCONFIRMED send (SendGrid may
// already have the request) must never be shown as a plain failure that invites a resubmit — that is how
// a person files the same request twice. Synthetic ports only; nothing leaves the process.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContactSupport } from "./ContactSupport";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const state = vi.hoisted(() => ({ invoke: vi.fn(), error: vi.fn(), success: vi.fn(), warning: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: "owner-1", email: "owner@example.invalid" } } }) },
    functions: { invoke: state.invoke },
  },
}));
vi.mock("sonner", () => ({ toast: { error: state.error, success: state.success, warning: state.warning } }));
vi.mock("@/contexts/SubscriptionContext", () => ({ useSubscription: () => ({ planSlug: "free" }) }));

// What supabase-js hands back for a non-2xx: data null, a FunctionsHttpError whose context is the Response.
const httpError = (status: number, body: Record<string, unknown>) => ({
  data: null,
  error: { name: "FunctionsHttpError", message: "Edge Function returned a non-2xx status code", context: new Response(JSON.stringify(body), { status }) },
});

let host: HTMLDivElement;
let root: Root | null = null;
function type(selector: string, value: string) {
  const field = host.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement;
  const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}
async function submit() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(<ContactSupport />); });
  await act(async () => { type("#subject", "Help"); type("#message", "Something is off"); });
  await act(async () => { host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

beforeEach(() => { state.invoke.mockReset(); state.error.mockReset(); state.success.mockReset(); state.warning.mockReset(); });
afterEach(() => { act(() => root?.unmount()); root = null; host?.remove(); });

describe("ContactSupport — the person hears what actually happened", () => {
  it("an unconfirmed send says it may have reached the team and to wait, never 'failed' / 'try again'", async () => {
    const said = "We couldn't confirm your request reached our team. It may have — please don't send it again; email support@paigeagent.ai if you haven't heard back.";
    state.invoke.mockResolvedValue(httpError(502, { error: said, unconfirmed: true }));
    await submit();
    expect(state.error).not.toHaveBeenCalled();
    expect(state.success).not.toHaveBeenCalled();
    expect(state.warning).toHaveBeenCalledTimes(1);
    const [title, opts] = state.warning.mock.calls[0];
    expect(String(title)).not.toMatch(/fail/i);
    expect(opts.description).toBe(said);
    // The typed request is kept, so nobody has to retype it to check — but nothing invites a resubmit.
    expect((host.querySelector("#subject") as HTMLInputElement).value).toBe("Help");
  });

  it("a definitive failure shows the server's reason and may invite a retry", async () => {
    const said = "We couldn't deliver your request to our team. Please try again or email support@paigeagent.ai.";
    state.invoke.mockResolvedValue(httpError(502, { error: said, unconfirmed: false }));
    await submit();
    expect(state.warning).not.toHaveBeenCalled();
    expect(state.error).toHaveBeenCalledWith("Failed to submit request", { description: said });
  });

  it("a delivered request still confirms and clears the form", async () => {
    state.invoke.mockResolvedValue({ data: { success: true, message: "Support request submitted successfully", confirmation_emailed: true }, error: null });
    await submit();
    expect(state.success).toHaveBeenCalledTimes(1);
    expect((host.querySelector("#subject") as HTMLInputElement).value).toBe("");
  });
});

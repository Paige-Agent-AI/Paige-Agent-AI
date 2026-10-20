import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EmailDomainsPanel } from "./EmailDomainsPanel";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const state = vi.hoisted(() => ({ invoke: vi.fn(), error: vi.fn(), success: vi.fn(), confirm: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: state.invoke } } }));
vi.mock("sonner", () => ({ toast: { error: state.error, success: state.success } }));
vi.mock("@/hooks/useConfirm", () => ({ useConfirm: () => ({ confirm: state.confirm, dialog: null }) }));

const DOMAIN = { id: "domain-fixture", tenant_id: "tenant-fixture", domain: "mail.example.com", from_email_local: "hello", from_name: "Example", status: "verified", is_default: false, dns_records: [], verified_at: null };
const GUIDANCE = "That sending-domain change may have started. Don’t repeat it. Open the workspace where you started, refresh the current sending-domain state, and confirm the original outcome before continuing.";
let host: HTMLDivElement;
let root: Root | null = null;
async function mount() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(<EmailDomainsPanel/>); });
}
function button(label: string) {
  const found = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes(label));
  if (!found) throw new Error(`Missing actual component button: ${label}`);
  return found;
}
function input(index: number, value: string) {
  const field = host.querySelectorAll("input")[index];
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}
async function perform(verb: string) {
  if (verb === "add") {
    await act(async () => { button("Add domain").click(); });
    await act(async () => { input(0, "new.example.com"); input(1, "Example"); });
    await act(async () => { button("Register & get DNS").click(); });
  } else if (verb === "set_default") {
    await act(async () => { button("Make default").click(); });
  } else {
    const icon = host.querySelector(verb === "remove" ? ".lucide-trash2" : ".lucide-refresh-cw");
    if (!icon?.closest("button")) throw new Error(`Missing actual ${verb} control`);
    await act(async () => { icon.closest("button")!.click(); });
  }
}
beforeEach(() => {
  vi.resetAllMocks();
  state.confirm.mockResolvedValue(true);
  state.invoke.mockResolvedValue({ data: { domains: [DOMAIN] }, error: null });
});
afterEach(async () => { if (root) await act(async () => { root!.unmount(); }); root = null; document.body.innerHTML = ""; });

describe("Actual shared domain caller preserves canonical uncertain-outcome guidance", () => {
  for (const status of [403, 502, 503]) for (const verb of ["add", "refresh", "set_default", "remove"]) {
    it(`holds ${verb} after an unconfirmed ${status} context response without repeating or claiming success`, async () => {
      state.invoke.mockImplementation(async (_name: string, request: { body: { verb: string } }) => request.body.verb === "list"
        ? { data: { domains: [DOMAIN] }, error: null }
        : { data: null, error: { message: "Edge Function returned a non-2xx status code", context: new Response(JSON.stringify({ error: "domain_operation_unconfirmed", message: "raw server retry advice" }), { status }) } });
      await mount();
      await perform(verb);
      expect(state.error).toHaveBeenLastCalledWith(GUIDANCE);
      expect(state.success).not.toHaveBeenCalled();
      expect(state.invoke.mock.calls.map((call) => call[1].body.verb)).toEqual(["list", verb]);
      expect(state.invoke.mock.calls.every((call) => call[0] === "manage-tenant-domain")).toBe(true);
      expect(host.textContent).toContain("hello@mail.example.com");
      if (verb === "add") {
        expect(host.querySelectorAll("input")[0].value).toBe("new.example.com");
        expect(host.querySelectorAll("input")[1].value).toBe("Example");
      }
    });
  }

  it("maps an unconfirmed structured data response through the same helper", async () => {
    state.invoke.mockResolvedValue({ data: { error: "domain_operation_unconfirmed" }, error: null });
    await mount();
    expect(state.error).toHaveBeenLastCalledWith(GUIDANCE);
    expect(state.invoke).toHaveBeenCalledTimes(1);
  });

  it("keeps pre-effect permission refusal distinct from uncertain execution", async () => {
    state.invoke.mockResolvedValue({ data: null, error: { context: new Response(JSON.stringify({ error: "forbidden" }), { status: 403 }) } });
    await mount();
    expect(state.error.mock.calls[0][0]).toContain("permission");
    expect(state.error.mock.calls[0][0]).not.toContain("may have started");
    expect(state.invoke).toHaveBeenCalledTimes(1);
  });

  it("does not expose raw framework, provider or unreadable response prose", async () => {
    state.invoke.mockResolvedValue({ data: null, error: { message: "raw provider exception", context: new Response("not json", { status: 502 }) } });
    await mount();
    expect(state.error.mock.calls[0][0]).toContain("try again");
    expect(state.error.mock.calls[0][0]).not.toMatch(/raw provider|not json|non-2xx/);
  });

  it("preserves the successful default operation and canonical list readback", async () => {
    await mount();
    await perform("set_default");
    expect(state.invoke.mock.calls.map((call) => call[1].body.verb)).toEqual(["list", "set_default", "list"]);
    expect(state.invoke.mock.calls[1][1].body).toEqual({ verb: "set_default", id: DOMAIN.id });
    expect(state.error).not.toHaveBeenCalled();
  });

  it("retains the existing destructive confirmation cancellation without a domain request", async () => {
    state.confirm.mockResolvedValue(false);
    await mount();
    await perform("remove");
    expect(state.confirm).toHaveBeenCalledTimes(1);
    expect(state.invoke.mock.calls.map((call) => call[1].body.verb)).toEqual(["list"]);
  });
});

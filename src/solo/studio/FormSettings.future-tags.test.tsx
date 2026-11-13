import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FormSettings } from "./FormSettings";
import { useFormIntake, type FormIntakeSettings } from "../useFormIntake";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const db = vi.hoisted(() => ({ form: {} as Record<string, unknown>, actor: "actor-a", admin: true,
  rpc: vi.fn(), reads: [] as Array<{ table: string; columns: string; filters: unknown[][] }> }));
vi.mock("@/hooks/useTierFeatures", () => ({ useTierFeatures: () => ({ has: () => true, loading: false }) }));
vi.mock("@/hooks/useTenantContext", () => ({ useOptionalTenantContext: () => ({ activeUserId: db.actor }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  rpc: (name: string, args: unknown) => name === "is_tenant_admin" ? Promise.resolve({ data: db.admin, error: null }) : db.rpc(name, args),
  from: (table: string) => {
    const read = { table, columns: "", filters: [] as unknown[][] }; db.reads.push(read);
    const q = { select: (columns: string) => { read.columns = columns; return q; },
      eq: (key: string, value: unknown) => { read.filters.push([key, value]); return q; }, order: () => q, in: () => q,
      maybeSingle: async () => ({ data: db.form, error: null }), range: async () => ({ data: [], error: null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve) }; return q;
  },
} }));

let container: HTMLDivElement, root: ReturnType<typeof createRoot>;
const onSaved = vi.fn(), onClose = vi.fn();
const defaults = (): FormIntakeSettings => ({ autoCreateDeal: false, pipelineId: null, stageId: null, notifyEmail: "alerts@example.test" });
let current!: ReturnType<typeof useFormIntake>;
function Harness({ tenant = "tenant-a", form = "form-a" }: { tenant?: string; form?: string }) { current = useFormIntake(tenant, form, 1); return <div>{current.phase}</div>; }
async function render(panel = true, tenant = "tenant-a", form = "form-a") {
  await act(async () => root.render(panel ? <FormSettings tenantId={tenant} formId={form} onSaved={onSaved} onClose={onClose} /> : <Harness tenant={tenant} form={form} />));
}
const button = (label: string) => Array.from(container.querySelectorAll("button")).find(b => b.textContent === label)!;
const tags = () => container.querySelector<HTMLTextAreaElement>('[aria-label="Tags for future submissions"]')!;
async function enter(value: string) { await act(async () => {
  const field = tags(); expect(field).not.toBeNull(); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}); }
beforeEach(() => {
  db.form = { auto_create_deal: false, pipeline_id: null, stage_id: null, notify_email: "alerts@example.test", lead_reply_enabled: true, future_tags: ["Existing tag", "A, B"], schema_json: [] };
  db.actor = "actor-a"; db.admin = true; db.reads = []; db.rpc.mockReset(); onSaved.mockReset(); onClose.mockReset();
  db.rpc.mockImplementation((_name: string, args: Record<string, unknown>) => Promise.resolve({ data: { ...db.form,
    ...(Object.prototype.hasOwnProperty.call(args, "p_future_tags") ? { future_tags: args.p_future_tags } : {}),
    ...(typeof args._lead_reply_enabled === "boolean" ? { lead_reply_enabled: args._lead_reply_enabled } : {}), }, error: null }));
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

describe("original Studio form settings — future submission tags", () => {
  it("loads the exact saved list, preserving comma punctuation and explaining computed segments without enrollment", async () => {
    await render(); expect(tags()).not.toBeNull(); expect(tags().value).toBe("Existing tag\nA, B");
    expect(container.textContent).toContain("Segments follow their rules"); expect(container.textContent).toContain("does not subscribe");
    expect(container.querySelector('[aria-label="Segment"]')).toBeNull();
    expect(db.reads.find(r => r.table === "growth_forms")).toMatchObject({ filters: [["id", "form-a"], ["tenant_id", "tenant-a"]] });
  });
  it("saves only explicitly changed tags through the nondefault seven-argument original setter", async () => {
    await render(); await enter("  VIP  \nA, B\nVIP\nvip"); await act(async () => button("Save").click());
    expect(db.rpc).toHaveBeenCalledWith("growth_form_set_intake", { p_form_id: "form-a", p_auto_create_deal: false, p_pipeline_id: null, p_stage_id: null,
      p_notify_email: "alerts@example.test", _lead_reply_enabled: null, p_future_tags: ["VIP", "A, B", "vip"] });
    expect(onSaved).toHaveBeenCalledOnce(); expect(tags().value).toBe("VIP\nA, B\nvip");
  });
  it("an unrelated Studio save preserves the original five-argument omission contract", async () => {
    await render(); await act(async () => button("Save").click());
    expect(db.rpc.mock.calls[0][1]).toEqual({ p_form_id: "form-a", p_auto_create_deal: false, p_pipeline_id: null, p_stage_id: null, p_notify_email: "alerts@example.test" });
  });
  it("a reply-only change preserves the six-argument contract and omits future tags", async () => {
    await render(); await act(async () => container.querySelector<HTMLButtonElement>('[aria-labelledby="vs-reply-label"]')!.click()); await act(async () => button("Save").click());
    expect(db.rpc.mock.calls[0][1]).toMatchObject({ _lead_reply_enabled: false }); expect(db.rpc.mock.calls[0][1]).not.toHaveProperty("p_future_tags");
  });
  it("an explicit empty tag input clears future tags through seven args and leaves existing contact tags untouched", async () => {
    await render(); await enter(""); await act(async () => button("Save").click());
    expect(db.rpc.mock.calls[0][1]).toMatchObject({ p_future_tags: [], _lead_reply_enabled: null });
    expect(db.rpc.mock.calls.map(call => call[0])).toEqual(["growth_form_set_intake"]);
  });
  it.each([Array.from({ length: 51 }, (_, i) => `Tag ${i}`).join("\n"), "x".repeat(81), "Unsafe\u0000tag"])("refuses invalid input before any setter and retains it %#", async input => {
    await render(); await enter(input); await act(async () => button("Save").click());
    expect(db.rpc).not.toHaveBeenCalled(); expect(tags().value).toBe(input); expect(tags().getAttribute("aria-invalid")).toBe("true");
    expect(container.querySelector('[role="alert"]')).not.toBeNull(); expect(document.activeElement).toBe(tags());
  });
  it("a mismatched saved row never produces Saved and retains the entered correction", async () => {
    db.rpc.mockResolvedValue({ data: db.form, error: null }); await render(); await enter("Requested"); await act(async () => button("Save").click());
    expect(onSaved).not.toHaveBeenCalled(); expect(tags().value).toBe("Requested"); expect(container.querySelector('[role="alert"]')?.textContent).toContain("couldn't be confirmed");
  });
  it("a lost setter ACK is unknown, never Nothing changed, and has no automatic retry", async () => {
    db.rpc.mockResolvedValue({ data: null, error: { message: "response lost" } }); await render(); await enter("Requested"); await act(async () => button("Save").click());
    expect(onSaved).not.toHaveBeenCalled(); expect(tags().value).toBe("Requested"); expect(db.rpc).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("couldn't be confirmed"); expect(container.textContent).not.toContain("Nothing was changed");
  });
  it("a current server refusal retains the input and never promotes a successful setting", async () => {
    db.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "GROWTH_FORBIDDEN: only an owner or admin can change this form" } });
    await render(); await enter("Requested"); await act(async () => button("Save").click());
    expect(tags().value).toBe("Requested"); expect(onSaved).not.toHaveBeenCalled(); expect(container.querySelector('[role="alert"]')?.textContent).toContain("owner or admin");
  });
  it("only an owner or admin sees the future-tag edit control", async () => {
    db.admin = false; await render(); expect(tags()).toBeNull(); expect(button("Save")).toBeUndefined();
  });
  it("the real hook projects future tags and keeps the original field and authority reads", async () => {
    await render(false); expect(current.settings).toMatchObject({ futureTags: ["Existing tag", "A, B"], leadReplyEnabled: true });
    expect(db.reads.find(r => r.table === "growth_forms")?.columns.split(",")).toEqual(expect.arrayContaining(["future_tags", "lead_reply_enabled", "schema_json"]));
  });
  it("the real hook rejects invalid future tags before dispatch", async () => {
    await render(false); let result: unknown; await act(async () => { result = await current.save({ ...defaults(), futureTags: ["x".repeat(81)] }); });
    expect(result).toMatchObject({ ok: false }); expect(db.rpc).not.toHaveBeenCalled();
  });
  it("a retained old actor's save callback cannot dispatch a new tag setting", async () => {
    await render(false); const retiredSave = current.save; db.actor = "actor-b"; await render(false);
    expect(await retiredSave({ ...defaults(), futureTags: ["Retired input"] })).toMatchObject({ ok: false });
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it("a rejected setter transport remains unknown without a retry or successful callback", async () => {
    db.rpc.mockRejectedValue(new Error("transport lost")); await render(); await enter("Requested"); await act(async () => button("Save").click());
    expect(onSaved).not.toHaveBeenCalled(); expect(tags().value).toBe("Requested"); expect(db.rpc).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("couldn't be confirmed");
  });
  it.each(["actor", "tenant", "form", "actor ABA"])("a late seven-argument ACK is retired on %s scope change", async kind => {
    let finish!: (reply: unknown) => void; db.rpc.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await render(false); let pending!: Promise<{ ok: boolean; message: string }>;
    await act(async () => { pending = current.save({ ...defaults(), futureTags: ["Original"] }); });
    if (kind.startsWith("actor")) db.actor = "actor-b";
    await render(false, kind === "tenant" ? "tenant-b" : "tenant-a", kind === "form" ? "form-b" : "form-a");
    if (kind === "actor ABA") { db.actor = "actor-a"; await render(false); }
    await act(async () => finish({ data: { ...db.form, future_tags: ["Original"] }, error: null }));
    expect(await pending).toMatchObject({ ok: false }); expect(current.settings).toMatchObject({ futureTags: ["Existing tag", "A, B"] });
  });
});

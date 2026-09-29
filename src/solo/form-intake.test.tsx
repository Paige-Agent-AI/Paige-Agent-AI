import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FormIntakePanel } from "./form-intake";
import type { PipelineWorkspace } from "./useSoloCampaigns";

/**
 * The owner's side of a public form: where each submission goes, and what each visitor typed.
 * Reads are scoped to the form and the workspace; the only write is growth_form_set_intake().
 */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const db = vi.hoisted(() => ({
  form: null as Record<string, unknown> | null,
  submissions: [] as Record<string, unknown>[],
  calls: [] as Array<{ table: string; filters: Array<[string, unknown]>; range?: [number, number] }>,
  rpc: vi.fn(),
  admin: true as boolean | null,
  failRead: false,
  failMore: false,
}));

function builder(table: string) {
  const call = { table, filters: [] as Array<[string, unknown]>, range: undefined as [number, number] | undefined };
  db.calls.push(call);
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = (column: string, value: unknown) => { call.filters.push([column, value]); return chain; };
  chain.order = () => chain;
  chain.maybeSingle = () => Promise.resolve(db.failRead ? { data: null, error: { message: "boom" } } : { data: db.form, error: null });
  chain.range = (from: number, to: number) => {
    call.range = [from, to];
    const fail = db.failRead || (db.failMore && from > 0);
    return Promise.resolve(fail ? { data: null, error: { message: "boom" } } : { data: db.submissions.slice(from, to + 1), error: null });
  };
  return chain;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => builder(table),
    rpc: (name: string, args: unknown) =>
      name === "is_tenant_admin"
        ? Promise.resolve(db.admin === null ? { data: null, error: { message: "boom" } } : { data: db.admin, error: null })
        : db.rpc(name, args),
  },
}));

const WORKSPACE: PipelineWorkspace = {
  canManage: true,
  canArchiveFolders: true,
  folders: [],
  pipelines: [
    { id: "p-sales", shortRef: "PPL-1", folderId: null, folderName: null, name: "Sales pipeline", description: "", isDefault: true, lifecycleStatus: "active", version: 1, createdAt: "", updatedAt: "", createdThrough: null, createdByName: null, requestedByName: null, stageCount: 3, dealCount: 1 },
    { id: "p-ref", shortRef: "PPL-2", folderId: null, folderName: null, name: "Referrals", description: "", isDefault: false, lifecycleStatus: "active", version: 1, createdAt: "", updatedAt: "", createdThrough: null, createdByName: null, requestedByName: null, stageCount: 1, dealCount: 0 },
  ],
  stages: [
    { id: "s-new", pipelineId: "p-sales", label: "New inquiry", description: "", orderIndex: 1, archivedAt: null, movePolicy: "direct", stageType: "open", version: 1 },
    { id: "s-call", pipelineId: "p-sales", label: "Discovery call", description: "", orderIndex: 2, archivedAt: null, movePolicy: "direct", stageType: "open", version: 1 },
    { id: "s-won", pipelineId: "p-sales", label: "Won", description: "", orderIndex: 3, archivedAt: null, movePolicy: "direct", stageType: "won", version: 1 },
    { id: "s-ref", pipelineId: "p-ref", label: "Introduced", description: "", orderIndex: 1, archivedAt: null, movePolicy: "direct", stageType: "open", version: 1 },
  ],
  deals: [
    { id: "deal-1", title: "Jordan", pipelineId: "p-sales", stageId: "s-new", clientId: "c-1", clientName: "Jordan", owner: "", status: "open", source: "paige_form", nextAction: "", tags: [], notes: "", createdAt: "", actualCloseDate: null, lostReason: null, outcomes: [], updatedAt: "", version: 1, history: [] },
  ],
  automationRules: [],
};

const SCHEMA = {
  sections: [{
    title: "About you",
    fields: [
      { key: "full_name", label: "Your name", type: "text" },
      { key: "email", label: "Work email", type: "email" },
      { key: "size", label: "Team size", type: "select", options: [{ label: "6–20 people", value: "6-20" }] },
      { key: "heard", label: "How did you hear about us?", type: "text" },
      { key: "consent", label: "Keep me posted", type: "checkbox" },
    ],
  }],
};

const SUBMISSION = (over: Record<string, unknown> = {}) => ({
  id: "sub-1",
  created_at: "2026-09-29T12:00:00Z",
  processing_state: "done",
  contact_id: "c-1",
  deal_id: "deal-1",
  alert_sent_at: "2026-09-29T12:00:05Z",
  alert_skipped_reason: null,
  payload_json: { full_name: "Jordan Ellis", email: "jordan@northbeam.example", size: "6-20", consent: true, referral_code: "SPRING" },
  ...over,
});

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const onOpenContact = vi.fn();
const onOpenDeal = vi.fn();

const text = () => container.textContent ?? "";
const button = (label: string) =>
  Array.from(container.querySelectorAll("button")).find((b) => b.textContent === label) as HTMLButtonElement | undefined;

async function render(workspace: PipelineWorkspace = WORKSPACE, strict = false) {
  const panel = <FormIntakePanel tenantId="biz-1" formId="form-1" workspace={workspace} onOpenContact={onOpenContact} onOpenDeal={onOpenDeal} />;
  await act(async () => {
    root.render(strict ? <StrictMode>{panel}</StrictMode> : panel);
  });
  await act(async () => { await Promise.resolve(); });
}

function setValue(el: HTMLInputElement | HTMLSelectElement, value: string) {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
}

beforeEach(() => {
  db.form = { auto_create_deal: true, pipeline_id: "p-sales", stage_id: "s-new", notify_email: "hello@yourbusiness.example", schema_json: SCHEMA };
  db.submissions = [SUBMISSION()];
  db.calls = [];
  db.failRead = false;
  db.failMore = false;
  db.admin = true;
  db.rpc.mockReset();
  onOpenContact.mockReset();
  onOpenDeal.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("form intake panel — reading", () => {
  it("reads only this form, in this workspace", async () => {
    await render();
    const form = db.calls.find((c) => c.table === "growth_forms")!;
    const subs = db.calls.find((c) => c.table === "growth_form_submissions")!;
    expect(form.filters).toEqual(expect.arrayContaining([["id", "form-1"], ["tenant_id", "biz-1"]]));
    expect(subs.filters).toEqual(expect.arrayContaining([["tenant_id", "biz-1"], ["form_id", "form-1"]]));
  });

  it("shows what the visitor typed under the form's own labels, and where it went", async () => {
    await render();
    expect(text()).toContain("Jordan Ellis");
    const answers = Array.from(container.querySelectorAll(".sub-answers div")).map((row) => row.textContent);
    expect(answers).toContain("Work emailjordan@northbeam.example");
    expect(answers).toContain("Team size6–20 people");
    expect(answers).toContain("How did you hear about us?Left blank");
    expect(answers).toContain("Keep me postedYes");
    expect(answers).toContain("Referral codeNo longer on the formSPRING");
    const chips = Array.from(container.querySelectorAll(".sub-states .pill")).map((p) => p.textContent);
    expect(chips).toEqual(["Lead created", "Sales pipeline → New inquiry", "Alert emailed"]);
  });

  it("says why an alert was withheld, and flags a submission that failed", async () => {
    db.submissions = [
      SUBMISSION({ id: "a", alert_sent_at: null, alert_skipped_reason: "form_hourly_cap" }),
      SUBMISSION({ id: "b", processing_state: "error", deal_id: null, alert_sent_at: null }),
      SUBMISSION({ id: "c", processing_state: "pending", contact_id: null, deal_id: null, alert_sent_at: null }),
    ];
    await render();
    const chipsFor = (i: number) => Array.from(container.querySelectorAll(".sub")[i].querySelectorAll(".sub-states .pill")).map((p) => p.textContent);
    expect(chipsFor(0)).toContain("Alert withheld — hourly limit reached");
    expect(chipsFor(1)).toContain("Needs attention");
    expect(chipsFor(2)).toEqual(["Processing"]);
  });

  it("opens the contact and the deal a submission created", async () => {
    await render();
    await act(async () => { button("Open contact")!.click(); });
    await act(async () => { button("Open deal")!.click(); });
    expect(onOpenContact).toHaveBeenCalledWith("c-1");
    expect(onOpenDeal).toHaveBeenCalledWith("deal-1");
  });

  it("teaches the empty state instead of showing nothing", async () => {
    db.submissions = [];
    await render();
    expect(text()).toContain("Nothing submitted yet");
  });

  it("loads older submissions page by page", async () => {
    db.submissions = Array.from({ length: 25 }, (_, i) => SUBMISSION({ id: `s${i}`, payload_json: { full_name: `Visitor ${i}` } }));
    await render();
    expect(container.querySelectorAll(".sub")).toHaveLength(20);
    await act(async () => { button("Show more")!.click(); });
    expect(container.querySelectorAll(".sub")).toHaveLength(25);
    expect(button("Show more")).toBeUndefined();
    expect(db.calls.filter((c) => c.table === "growth_form_submissions").map((c) => c.range)).toEqual([[0, 20], [20, 40]]);
  });

  it("offers a retry when the read fails", async () => {
    db.failRead = true;
    await render();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("didn't load");
    db.failRead = false;
    await act(async () => { button("Try again")!.click(); });
    await act(async () => { await Promise.resolve(); });
    expect(text()).toContain("When someone submits");
  });
});

describe("form intake panel — settings", () => {
  it("shows the saved settings with nothing to save", async () => {
    await render();
    expect((container.querySelector('[role="switch"]') as HTMLElement).getAttribute("aria-checked")).toBe("true");
    const [pipeline, stage] = Array.from(container.querySelectorAll("select")) as HTMLSelectElement[];
    expect(pipeline.value).toBe("p-sales");
    expect(stage.value).toBe("s-new");
    expect(Array.from(stage.options).map((o) => o.textContent)).toEqual(["First stage of the pipeline", "New inquiry", "Discovery call"]);
    expect((container.querySelector("#intake-email") as HTMLInputElement).value).toBe("hello@yourbusiness.example");
    expect(button("Save changes")).toBeUndefined();
  });

  it("saves a new route and address through growth_form_set_intake", async () => {
    db.rpc.mockResolvedValue({ data: { auto_create_deal: true, pipeline_id: "p-ref", stage_id: "s-ref", notify_email: "alerts@yourbusiness.example", schema_json: SCHEMA }, error: null });
    await render();
    const [pipeline] = Array.from(container.querySelectorAll("select")) as HTMLSelectElement[];
    await act(async () => { setValue(pipeline, "p-ref"); });
    const stage = container.querySelectorAll("select")[1] as HTMLSelectElement;
    await act(async () => { setValue(stage, "s-ref"); });
    await act(async () => { setValue(container.querySelector("#intake-email") as HTMLInputElement, " alerts@yourbusiness.example "); });
    expect(text()).toContain("Unsaved changes");
    await act(async () => { button("Save changes")!.click(); });
    expect(db.rpc).toHaveBeenCalledWith("growth_form_set_intake", {
      p_form_id: "form-1", p_auto_create_deal: true, p_pipeline_id: "p-ref", p_stage_id: "s-ref", p_notify_email: "alerts@yourbusiness.example",
    });
    expect(container.querySelector(".intake-status")?.textContent).toBe("Saved");
    expect(button("Save changes")).toBeUndefined();
  });

  it("turning the pipeline off sends no route, and clearing the address turns email off", async () => {
    db.rpc.mockResolvedValue({ data: { auto_create_deal: false, pipeline_id: "p-sales", stage_id: "s-new", notify_email: null, schema_json: SCHEMA }, error: null });
    await render();
    await act(async () => { (container.querySelector('[role="switch"]') as HTMLButtonElement).click(); });
    expect(container.querySelectorAll("select")).toHaveLength(0);
    await act(async () => { setValue(container.querySelector("#intake-email") as HTMLInputElement, ""); });
    await act(async () => { button("Save changes")!.click(); });
    expect(db.rpc).toHaveBeenCalledWith("growth_form_set_intake", {
      p_form_id: "form-1", p_auto_create_deal: false, p_pipeline_id: null, p_stage_id: null, p_notify_email: null,
    });
  });

  it("refuses a malformed address before sending anything", async () => {
    await render();
    await act(async () => { setValue(container.querySelector("#intake-email") as HTMLInputElement, "alerts@yourbusiness"); });
    await act(async () => { button("Save changes")!.click(); });
    expect(db.rpc).not.toHaveBeenCalled();
    expect(text()).toContain("Enter a full address, like name@yourbusiness.com.");
    expect(container.querySelector("#intake-email")?.getAttribute("aria-invalid")).toBe("true");
  });

  it("shows the server's refusal in plain words and keeps the edit", async () => {
    db.rpc.mockResolvedValue({ data: null, error: { message: "GROWTH_FORBIDDEN: only an owner or admin of this business can change its forms" } });
    await render();
    await act(async () => { setValue(container.querySelector("#intake-email") as HTMLInputElement, "new@yourbusiness.example"); });
    await act(async () => { button("Save changes")!.click(); });
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Only an owner or admin of this business can change its forms.");
    expect((container.querySelector("#intake-email") as HTMLInputElement).value).toBe("new@yourbusiness.example");
  });

  it("turning the pipeline on picks the default pipeline so a route is never blank", async () => {
    db.form = { auto_create_deal: false, pipeline_id: null, stage_id: null, notify_email: null, schema_json: SCHEMA };
    await render();
    await act(async () => { (container.querySelector('[role="switch"]') as HTMLButtonElement).click(); });
    expect((container.querySelectorAll("select")[0] as HTMLSelectElement).value).toBe("p-sales");
  });

  it("tells an owner with no pipeline where to make one", async () => {
    db.form = { auto_create_deal: false, pipeline_id: null, stage_id: null, notify_email: null, schema_json: SCHEMA };
    await render({ ...WORKSPACE, pipelines: [], stages: [] });
    await act(async () => { (container.querySelector('[role="switch"]') as HTMLButtonElement).click(); });
    expect(text()).toContain("There's no pipeline in this workspace yet");
  });

  it("someone the server would refuse — even with the workspace's manage flag — gets the read-only view", async () => {
    db.admin = false;
    await render({ ...WORKSPACE, canManage: true });
    expect(container.querySelector('[role="switch"]')).toBeNull();
    expect(text()).toContain("An owner or admin of this business sets where submissions go.");
  });

  it("an unreadable answer about authority is treated as read-only, never as an editor that will be refused", async () => {
    db.admin = null;
    await render();
    expect(container.querySelector('[role="switch"]')).toBeNull();
  });

  it("a member reads the settings and cannot change them", async () => {
    db.admin = false;
    await render({ ...WORKSPACE, canManage: false });
    expect(container.querySelector('[role="switch"]')).toBeNull();
    expect(container.querySelector("#intake-email")).toBeNull();
    const rows = Array.from(container.querySelectorAll(".intake-readonly .campaigns-detail-row")).map((r) => r.textContent);
    expect(rows).toEqual(["PipelineSales pipeline → New inquiry", "Email alertsOn"]);
    expect(text()).not.toContain("hello@yourbusiness.example");
  });

  it("saves and shows Saved under React StrictMode", async () => {
    db.rpc.mockResolvedValue({ data: { auto_create_deal: true, pipeline_id: "p-sales", stage_id: "s-new", notify_email: "alerts@yourbusiness.example", schema_json: SCHEMA }, error: null });
    await render(WORKSPACE, true);
    await act(async () => { setValue(container.querySelector("#intake-email") as HTMLInputElement, "alerts@yourbusiness.example"); });
    await act(async () => { button("Save changes")!.click(); });
    expect(container.querySelector(".intake-status")?.textContent).toBe("Saved");
  });
});

describe("form intake panel — robustness", () => {
  it("loads older submissions under React StrictMode", async () => {
    db.submissions = Array.from({ length: 25 }, (_, i) => SUBMISSION({ id: `s${i}`, payload_json: { full_name: `Visitor ${i}` } }));
    await render(WORKSPACE, true);
    await act(async () => { button("Show more")!.click(); });
    expect(container.querySelectorAll(".sub")).toHaveLength(25);
  });

  it("says so when older submissions fail to load, and lets the owner try again", async () => {
    db.submissions = Array.from({ length: 25 }, (_, i) => SUBMISSION({ id: `s${i}` }));
    db.failMore = true;
    await render();
    await act(async () => { button("Show more")!.click(); });
    expect(container.querySelector('.subs-list ~ [role="alert"]')?.textContent).toBe("Older submissions didn't load. Try again.");
    expect(button("Show more")!.disabled).toBe(false);
  });

  it("reads a structured answer as its parts, never as raw JSON", async () => {
    db.form = { ...db.form!, schema_json: { sections: [{ fields: [{ key: "address", label: "Business address", type: "business_address" }] }] } };
    db.submissions = [SUBMISSION({ payload_json: { address: { street: "12 Harbor Way", city: "Portland", state: "OR" } } })];
    await render();
    const row = Array.from(container.querySelectorAll(".sub-answers div")).map((r) => r.textContent);
    expect(row).toEqual(["Business address12 Harbor Way, Portland, OR"]);
  });

  it("with no pipeline, asks for one instead of contradicting itself", async () => {
    db.form = { auto_create_deal: false, pipeline_id: null, stage_id: null, notify_email: null, schema_json: SCHEMA };
    await render({ ...WORKSPACE, pipelines: [], stages: [] });
    await act(async () => { (container.querySelector('[role="switch"]') as HTMLButtonElement).click(); });
    await act(async () => { button("Save changes")!.click(); });
    expect(db.rpc).not.toHaveBeenCalled();
    expect(text()).toContain("Create a pipeline first, or turn this off to save the email setting.");
    expect(text()).not.toContain("Choose the pipeline new leads go into.");
  });
});

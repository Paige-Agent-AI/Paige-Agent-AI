/**
 * Settings → Integrations → Automations.
 *
 * These cover the flows a Solo owner can actually reach, and the boundary the
 * owner set on 2026-08-31: this surface may consume existing governed data, but
 * must not reach into Systems Check, Mind or Command Center, and must never
 * present something as working when no contract backs it.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SoloIntegrationsView } from "./settings-integrations";
import { outcomeLabel } from "./data/useSoloAutomations";

const context = vi.hoisted(() => ({ tenantId: "tenant-a", loading: false }));
const db = vi.hoisted(() => ({
  rules: [] as unknown[],
  pipelines: [] as unknown[],
  stages: [] as unknown[],
  events: [] as unknown[],
  admin: true,
  failTable: null as string | null,
  selects: [] as Array<{ table: string; columns: string }>,
  writes: [] as Array<{ table: string; op: string; values?: Record<string, unknown> }>,
  /** When set, a write parks here so the mid-write render can be inspected. */
  holdWrite: null as null | { release: () => void; promise: Promise<{ error: unknown }> },
  failWrite: false,
  /** When true, every SELECT parks — used to observe the reload AFTER a write. */
  holdReads: false,
  releaseReads: [] as Array<() => void>,
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/hooks/useTenantContext", () => ({
  useTenantContext: () => ({ activeTenantId: context.tenantId, loading: context.loading }),
}));

// Existing pipeline-rule tests isolate the separately tested native-task leaf.
// Its customer controls and authority fences have their own actual-component suites.
vi.mock("./owner-task-automations", () => ({
  OwnerTaskAutomations: () => <section aria-label="Contact task controls">Contact task controls</section>,
}));

vi.mock("@/integrations/supabase/client", () => {
  const rowsFor = (table: string) =>
    table === "stage_automation_rules" ? db.rules
      : table === "pipelines" ? db.pipelines
      : table === "pipeline_stages" ? db.stages
      : table === "stage_automation_events" ? db.events
      : [];
  const writeResult = (): Promise<{ error: unknown }> => {
    if (db.failWrite) return Promise.resolve({ error: { message: 'null value in column "tone" violates not-null constraint' } });
    if (db.holdWrite) return db.holdWrite.promise;
    return Promise.resolve({ error: null });
  };
  return {
    supabase: {
      rpc: (name: string) =>
        Promise.resolve(
          name === "is_current_user_tenant_admin"
            ? { data: db.admin, error: null }
            : { data: { configured: false, status: "unconfigured" }, error: null },
        ),
      from: (table: string) => ({
        select: (columns: string) => {
          db.selects.push({ table, columns });
          const result = { data: rowsFor(table), error: db.failTable === table ? { message: "read failed" } : null };
          const settle = () => db.holdReads
            ? new Promise<typeof result>((done) => db.releaseReads.push(() => done(result)))
            : Promise.resolve(result);
          // The chain has to mirror the REAL builder, not the shape this test happened
          // to need when it was written. `useSoloAutomations` reads pipeline_stages as
          // .eq(...).is("archived_at", null).order(...) — a link this mock did not have,
          // so `.is` was undefined, the read threw, and the whole surface sat on
          // "Checking what is set up…" while fifteen assertions blamed the copy.
          const ordered = { order: settle };
          return { eq: () => ({ ...ordered, is: () => ordered }) };
        },
        insert: (values: Record<string, unknown>) => {
          db.writes.push({ table, op: "insert", values });
          return Promise.resolve({ error: null });
        },
        update: (values: Record<string, unknown>) => {
          db.writes.push({ table, op: "update", values });
          return { eq: () => writeResult() };
        },
        delete: () => {
          db.writes.push({ table, op: "delete" });
          return { eq: () => Promise.resolve({ error: null }) };
        },
      }),
    },
  };
});

async function render(path: string) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(
    <MemoryRouter initialEntries={[path]}><SoloIntegrationsView /></MemoryRouter>,
  ));
  await act(async () => { await Promise.resolve(); });
  return { host, root };
}

const BASE = "/solo/1971670/settings/integrations";

beforeEach(() => {
  context.tenantId = "tenant-a";
  context.loading = false;
  db.rules = []; db.pipelines = []; db.stages = []; db.events = [];
  db.admin = true; db.failTable = null; db.selects = []; db.writes = [];
  db.holdWrite = null; db.failWrite = false; db.holdReads = false; db.releaseReads = [];
});

describe("Automations sub-tab routing (owned locally by Integrations)", () => {
  it("keeps contact task controls reachable when the pipeline reader fails", async () => {
    db.failTable = "stage_automation_rules";
    const { host } = await render(`${BASE}/automations`);
    expect(host.querySelector('[aria-label="Contact task controls"]')).toBeTruthy();
    expect(host.textContent).toContain("Couldn’t check your automations");
    expect(db.writes).toHaveLength(0);
  });

  it("keeps contact task controls reachable while pipeline reads are pending", async () => {
    db.holdReads = true;
    const { host } = await render(`${BASE}/automations`);
    expect(host.querySelector('[aria-label="Contact task controls"]')).toBeTruthy();
    expect(host.textContent).toContain("Checking what is set up");
    expect(db.writes).toHaveLength(0);
  });

  it("shows the provider catalogue at the Integrations root", async () => {
    const { host } = await render(BASE);
    const selected = host.querySelector('[role="tab"][aria-selected="true"]');
    expect(selected?.textContent).toContain("Integrations");
    expect(host.querySelector(".ig-grid")).toBeTruthy();
  });

  it("shows Automations at the automations leaf", async () => {
    const { host } = await render(`${BASE}/automations`);
    const selected = host.querySelector('[role="tab"][aria-selected="true"]');
    expect(selected?.textContent).toContain("Automations");
    // The provider catalogue is not rendered underneath the Automations leaf.
    expect(host.querySelector(".ig-grid")).toBeNull();
  });

  it("falls back to the catalogue for an unknown leaf, so old URLs keep working", async () => {
    const { host } = await render(`${BASE}/something-retired`);
    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toContain("Integrations");
    expect(host.querySelector(".ig-grid")).toBeTruthy();
  });
});

describe("Automations truth boundary", () => {
  it("makes no promise about delivery it cannot keep, and none about a route it cannot see", async () => {
    const { host } = await render(`${BASE}/automations`);
    const text = host.textContent ?? "";
    expect(text).toContain("Nothing is set up yet");
    // The earlier copy promised a saved rule "cannot deliver" and that "no route
    // out" existed. That was read off one environment; a platform fallback route
    // is seeded by migration elsewhere, so the promise was not ours to make.
    expect(text).not.toMatch(/cannot deliver/i);
    expect(text).not.toMatch(/no route out/i);
    expect(text).not.toMatch(/nothing will reach a client/i);
    // What replaces it is the part this surface actually enforces.
    expect(text).toMatch(/saved switched\s+off/i);
    expect(text).toMatch(/nothing on this page switches one on/i);
  });

  it("offers no control that starts a rule, so the claim above is enforced not asserted", async () => {
    db.rules = [{
      id: "r1", pipeline_id: "p1", from_stage_id: "a1", to_stage_id: "a2",
      compose_intent: "nurture", tone: "warm", template_hint: null,
      send_mode: "draft_for_review", is_active: false, updated_at: null,
    }];
    const { host } = await render(`${BASE}/automations`);
    const labels = Array.from(host.querySelectorAll("button")).map((b) => b.textContent ?? "");
    expect(labels.some((l) => /turn on|switch on|activate|enable/i.test(l))).toBe(false);
  });

  it("never writes is_active when a rule is edited, so saving cannot start one", async () => {
    db.rules = [{
      id: "r1", pipeline_id: "p1", from_stage_id: "a1", to_stage_id: "a2",
      compose_intent: "nurture", tone: "warm", template_hint: null,
      send_mode: "draft_for_review", is_active: true, updated_at: null,
    }];
    db.pipelines = [{ id: "p1", name: "Sales" }];
    db.stages = [
      { id: "a1", pipeline_id: "p1", label: "Enquiry", order_index: 0 },
      { id: "a2", pipeline_id: "p1", label: "Working", order_index: 1 },
    ];
    const { host } = await render(`${BASE}/automations`);
    const change = Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "Change");
    await act(async () => change?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    // An active rule being edited must not be told it was saved off — it wasn't.
    // Scoped to the editor's own note: the page-level caveat says new rules are
    // saved off, which is true and must stay.
    const note = host.querySelector(".sa-editor-note")?.textContent ?? "";
    expect(note).not.toMatch(/saved switched off/i);
    expect(note).toMatch(/does not switch a rule on or off/i);
    const save = Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.includes("Save changes"));
    await act(async () => save?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    const update = db.writes.find((w) => w.op === "update");
    expect(update).toBeTruthy();
    expect(Object.keys(update?.values ?? {})).not.toContain("is_active");
  });

  it("shows no run count, success rate, health signal or repair action", async () => {
    const { host } = await render(`${BASE}/automations`);
    const text = host.textContent ?? "";
    for (const forbidden of ["success rate", "runs this week", "needs attention", "Repoint", "Promote to auto", "%"]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it("never selects the provider payload or the raw error from the outcome log", async () => {
    await render(`${BASE}/automations`);
    const events = db.selects.filter((s) => s.table === "stage_automation_events");
    expect(events.length).toBeGreaterThan(0);
    for (const select of events) {
      expect(select.columns).not.toContain("webhook_response");
      expect(select.columns).not.toContain("error");
    }
  });

  it("does not claim an empty workspace when a read failed", async () => {
    db.failTable = "stage_automation_rules";
    const { host } = await render(`${BASE}/automations`);
    expect(host.textContent).toContain("Couldn’t check your automations");
    expect(host.textContent).not.toContain("Nothing is set up yet");
  });

  it("offers pipeline setup as the next step only while no pipeline exists", async () => {
    const withoutPipeline = await render(`${BASE}/automations`);
    expect(withoutPipeline.host.textContent).toContain("Set up your pipeline");
    const link = withoutPipeline.host.querySelector('a[href*="growth/pipeline"]');
    expect(link).not.toBeNull();

    db.pipelines = [{ id: "p1", name: "Clients" }];
    db.stages = [
      { id: "s1", pipeline_id: "p1", label: "Enquiry", order_index: 0 },
      { id: "s2", pipeline_id: "p1", label: "Working", order_index: 1 },
    ];
    const withPipeline = await render(`${BASE}/automations`);
    expect(withPipeline.host.textContent).not.toContain("Set up your pipeline");
    expect(withPipeline.host.textContent).toContain("New automation");
  });

  it("hides the authoring controls from a caller who may not write", async () => {
    db.admin = false;
    db.pipelines = [{ id: "p1", name: "Clients" }];
    db.stages = [{ id: "s1", pipeline_id: "p1", label: "Enquiry", order_index: 0 }];
    const { host } = await render(`${BASE}/automations`);
    expect(host.textContent).not.toContain("New automation");
    expect(host.textContent).toMatch(/needs an owner or admin/i);
  });
});

describe("Authoring a rule", () => {
  beforeEach(() => {
    db.pipelines = [{ id: "p1", name: "Clients" }];
    db.stages = [
      { id: "s1", pipeline_id: "p1", label: "Enquiry", order_index: 0 },
      { id: "s2", pipeline_id: "p1", label: "Working", order_index: 1 },
    ];
  });

  it("saves a new rule turned off, scoped to the workspace", async () => {
    const { host } = await render(`${BASE}/automations`);
    const open = Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.includes("New automation"));
    await act(async () => open?.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    const save = Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.includes("Save automation"));
    expect(save).toBeDefined();
    await act(async () => save?.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    const insert = db.writes.find((w) => w.op === "insert");
    expect(insert?.table).toBe("stage_automation_rules");
    expect(insert?.values?.tenant_id).toBe("tenant-a");
    // Never on by default — a rule must not begin acting the moment it is saved.
    expect(insert?.values?.is_active).toBe(false);
  });

  it("renders an existing rule as a sentence, not as field names", async () => {
    db.rules = [{
      id: "r1", pipeline_id: "p1", from_stage_id: "s1", to_stage_id: "s2",
      compose_intent: "nurture", tone: "warm", template_hint: null,
      send_mode: "draft_for_review", is_active: false, updated_at: null,
    }];
    const { host } = await render(`${BASE}/automations`);
    expect(host.textContent).toContain("When a client moves from Enquiry to Working");
    expect(host.textContent).not.toContain("compose_intent");
    expect(host.textContent).not.toContain("send_mode");
  });
});

describe("More than one pipeline (regressions from the exact-head review)", () => {
  beforeEach(() => {
    db.pipelines = [{ id: "p1", name: "Sales" }, { id: "p2", name: "Delivery" }];
    db.stages = [
      { id: "a1", pipeline_id: "p1", label: "Enquiry", order_index: 0 },
      { id: "a2", pipeline_id: "p1", label: "Working", order_index: 1 },
      { id: "b1", pipeline_id: "p2", label: "Kickoff", order_index: 0 },
      { id: "b2", pipeline_id: "p2", label: "Delivered", order_index: 1 },
    ];
  });

  it("names each rule's stages from its own pipeline, not the first one", async () => {
    db.rules = [{
      id: "r2", pipeline_id: "p2", from_stage_id: "b1", to_stage_id: "b2",
      compose_intent: "transactional", tone: "warm", template_hint: null,
      send_mode: "draft_for_review", is_active: false, updated_at: null,
    }];
    const { host } = await render(`${BASE}/automations`);
    expect(host.textContent).toContain("from Kickoff to Delivered");
    // The old behaviour resolved stages off pipelines[0] and rendered this.
    expect(host.textContent).not.toContain("a stage you removed");
  });

  it("keeps an edited rule on its own pipeline instead of moving it", async () => {
    db.rules = [{
      id: "r2", pipeline_id: "p2", from_stage_id: "b1", to_stage_id: "b2",
      compose_intent: "transactional", tone: "warm", template_hint: null,
      send_mode: "draft_for_review", is_active: false, updated_at: null,
    }];
    const { host } = await render(`${BASE}/automations`);
    const change = Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "Change");
    await act(async () => change?.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    const save = Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.includes("Save changes"));
    await act(async () => save?.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    const update = db.writes.find((w) => w.op === "update" && w.values?.pipeline_id);
    expect(update?.values?.pipeline_id).toBe("p2");
    // Its stages must stay on p2 as well — the editor used to offer p1's.
    expect(["b1", "b2"]).toContain(update?.values?.to_stage_id);
  });

  it("authors a new rule against a pipeline that actually has stages", async () => {
    db.pipelines = [{ id: "empty", name: "Unused" }, { id: "p1", name: "Sales" }];
    const { host } = await render(`${BASE}/automations`);
    const open = Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.includes("New automation"));
    await act(async () => open?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    const save = Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.includes("Save automation"));
    await act(async () => save?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    const insert = db.writes.find((w) => w.op === "insert");
    expect(insert?.values?.pipeline_id).toBe("p1");
  });

  it("keeps the surface visible while a change is saving, instead of blanking it", async () => {
    db.rules = [{
      id: "r1", pipeline_id: "p1", from_stage_id: "a1", to_stage_id: "a2",
      compose_intent: "nurture", tone: "warm", template_hint: null,
      send_mode: "draft_for_review", is_active: true, updated_at: null,
    }];
    const { host } = await render(`${BASE}/automations`);

    // The blank happened during the RELOAD that follows a write, not during the
    // write itself — so that is the moment this parks and inspects.
    db.holdReads = true;
    const toggle = Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "Turn off");
    await act(async () => { toggle?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await act(async () => { await Promise.resolve(); });

    expect(db.releaseReads.length).toBeGreaterThan(0); // the reload really is in flight
    expect(host.textContent).not.toContain("Checking what is set up");
    expect(host.textContent).toContain("from Enquiry to Working");

    db.holdReads = false;
    await act(async () => { db.releaseReads.forEach((r) => r()); await Promise.resolve(); });
    expect(host.textContent).toContain("from Enquiry to Working");
  });

  it("never shows the database's own error text when a change fails", async () => {
    db.rules = [{
      id: "r1", pipeline_id: "p1", from_stage_id: "a1", to_stage_id: "a2",
      compose_intent: "nurture", tone: "warm", template_hint: null,
      send_mode: "draft_for_review", is_active: true, updated_at: null,
    }];
    db.failWrite = true;
    const { host } = await render(`${BASE}/automations`);
    const toggle = Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "Turn off");
    await act(async () => { toggle?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await act(async () => { await Promise.resolve(); });

    expect(host.textContent).toMatch(/was not saved/i);
    expect(host.textContent).not.toMatch(/constraint|violates|null value|column "/i);
  });
});

describe("Consumed outcomes stay in owner language", () => {
  it("reads every recorded state without leaking its internal name", () => {
    // This list is the table's own CHECK constraint, verbatim. It does not
    // contain "sent" — the dispatcher writes "dispatched" — so a label keyed on
    // "sent" would have been a branch that could never run.
    for (const status of ["pending", "dispatched", "failed", "skipped_inactive", "skipped_no_webhook", "skipped_no_rule", "skipped_no_consent"]) {
      const label = outcomeLabel(status);
      expect(label).not.toContain("_");
      expect(label.length).toBeGreaterThan(0);
    }
    // A successful dispatch means it left here, not that anyone received it.
    expect(outcomeLabel("dispatched")).toBe("Handed over for sending");
    // An unrecognised state must stay honest rather than guess — and "sent" is
    // one of those, which is exactly why it must not have its own label.
    expect(outcomeLabel("sent")).toBe("Recorded");
    expect(outcomeLabel("something_new")).toBe("Recorded");
  });

  it("does not report an unreadable history as an empty one", async () => {
    db.failTable = "stage_automation_events";
    const { host } = await render(`${BASE}/automations`);
    const text = host.textContent ?? "";
    // "Nothing has run here" and "could not be read" are different claims, and
    // only one of them is true when the read failed.
    expect(text).not.toContain("Nothing has run here");
    expect(text).toMatch(/could not be read|could not be checked/i);
    // The rest of the surface must survive: one failed read is not an outage.
    expect(text).toContain("Nothing is set up yet");
  });

  it("says nothing has run when the log is empty, rather than implying success", async () => {
    const { host } = await render(`${BASE}/automations`);
    expect(host.textContent).toContain("Nothing has run here");
  });
});

describe("Owner boundary — Systems Check, Mind and Command Center are untouched", () => {
  const sources = [
    "src/solo/settings-automations.tsx",
    "src/solo/data/useSoloAutomations.ts",
    "src/solo/settings-integrations.tsx",
  ];

  it("imports nothing from those surfaces", () => {
    for (const path of sources) {
      const source = readFileSync(path, "utf8");
      const imports = source.match(/from\s+["'][^"']+["']/g) ?? [];
      for (const line of imports) {
        expect(line).not.toMatch(/CommandCenter|systems|SystemsCheck|TenantSystemsCheck/i);
      }
    }
  });

  it("offers no link into them", () => {
    for (const path of sources) {
      const source = readFileSync(path, "utf8");
      expect(source).not.toMatch(/to=\{?["'`][^"'`]*command-center/i);
      expect(source).not.toMatch(/to=\{?["'`][^"'`]*systems-check/i);
    }
  });

  it("does not read the queue those surfaces own", () => {
    const hook = readFileSync("src/solo/data/useSoloAutomations.ts", "utf8");
    expect(hook).not.toContain('from("paige_actions")');
    expect(hook).not.toContain('from("paige_pending_approvals")');
  });
});

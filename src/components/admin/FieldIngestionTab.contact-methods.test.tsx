// Approving a Paige-proposed contact update in Field Ingestion. A proposal records the address
// change that was asked for (`payload.address_intent`: primary / add / replace) and the list it was
// built on (`payload.contact_methods_built_on`) — the shape Paige's `propose_client_update` writes.
// Approving it plans the change on the list held now with the same rules as the server's
// `confirm_proposal` (src/lib/contact-method-intents.contract.test.ts pins the two planners), writes
// it through upsert_contact naming the list it read, in the proposal's workspace. Anything refused
// or failed leaves the proposal NOT applied.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Write = { table: string; op: string; value: unknown; filters: Array<[string, unknown]> };
type Answer = { data: unknown; error: { message: string } | null };
const writes: Write[] = [];
const rpcs: Array<{ fn: string; args: Record<string, unknown> }> = [];
let proposals: unknown[] = [];
/** Each read of client_contact_methods takes the next list; the last one repeats. */
let storedReads: unknown[][] = [];
/** Each upsert_contact call takes the next answer; the last one repeats. */
let rpcAnswers: Answer[] = [];
let rowUpdateAnswer: Answer = { data: [{ id: "c1" }], error: null };

function next<T>(queue: T[]): T {
  return queue.length > 1 ? queue.shift()! : queue[0];
}

function chain(table: string) {
  const self: Record<string, unknown> = {};
  let write: Write | null = null;
  const filters: Array<[string, unknown]> = [];
  const result = () => {
    if (write) return table === "clients" ? rowUpdateAnswer : { data: null, error: null };
    if (table === "paige_ingestion_proposals") return { data: proposals, error: null };
    if (table === "client_contact_methods") return { data: next(storedReads), error: null };
    return { data: [], error: null };
  };
  for (const op of ["select", "in", "order", "limit", "neq"]) self[op] = () => self;
  self.eq = (column: string, value: unknown) => { filters.push([column, value]); return self; };
  for (const op of ["update", "insert", "upsert"]) {
    self[op] = (value: unknown) => { write = { table, op, value, filters }; writes.push(write); return self; };
  }
  self.maybeSingle = () => Promise.resolve(result());
  self.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(result()).then(resolve, reject);
  return self;
}

vi.mock("@/integrations/supabase/client", () => {
  const channel = { on: () => channel, subscribe: () => channel };
  return {
    supabase: {
      from: (table: string) => chain(table),
      rpc: (fn: string, args: Record<string, unknown>) => { rpcs.push({ fn, args }); return Promise.resolve(next(rpcAnswers)); },
      channel: () => channel,
      removeChannel: () => Promise.resolve(),
      auth: { getUser: () => Promise.resolve({ data: { user: { id: "u1" } } }) },
    },
  };
});
vi.mock("@/hooks/useTenantFeature", () => ({ useTenantFeature: () => ({ enabled: false }) }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const { default: FieldIngestionTab } = await import("./FieldIngestionTab");

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const JORDAN = { kind: "email", value: "jordan@reyesbuild.co", label: "Work", is_primary: true };
const OPS = { kind: "email", value: "ops@reyesbuild.co", label: "Ops", is_primary: false };
const PHONE = { kind: "phone", value: "+1 (512) 555-0148", label: null, is_primary: true };
/** The list the proposal was built on, as the server stored it. */
const BUILT_ON = [JORDAN, OPS, PHONE];

/** Stored rows, as client_contact_methods returns them (unordered; `position` decides the order). */
const rows = (list: Array<{ kind: string; value: string; label: string | null; is_primary: boolean }>) =>
  list
    .map((m, i) => ({ id: `m${i}`, ...m, position: list.filter((x) => x.kind === m.kind).indexOf(m) }))
    .reverse();

const STALE: Answer = { data: null, error: { message: "CONTACT_METHODS_STALE: this list changed since it was loaded" } };
const OK: Answer = { data: "c1", error: null };

const proposal = (payload: Record<string, unknown>) => ({
  id: "prop-1", tenant_id: "tenant-b", client_id: "c1", tool_name: "propose_client_update", target_table: "clients",
  status: "pending", confidence: "high", source: "mcp:field_ops", external_llm_model: null, review_reason: null,
  diff: {}, payload, actor_user_id: null, actor_role: "coach", created_at: "2026-09-01T00:00:00Z",
});

let host: HTMLDivElement;
let root: Root;

async function renderAndApprove() {
  await act(async () => { root.render(<MemoryRouter><FieldIngestionTab /></MemoryRouter>); });
  await act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); });
  const approve = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Approve")) as HTMLButtonElement;
  await act(async () => { approve.click(); });
  await act(async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); });
}

const applied = () => writes.some((w) => w.table === "paige_ingestion_proposals" && (w.value as { status?: string }).status === "applied");
const rowWrite = () => writes.find((w) => w.table === "clients");
const patchOf = (i: number) => rpcs[i].args.p_patch as { contact_methods: unknown[]; expected_contact_methods: unknown[] };

beforeEach(() => {
  writes.length = 0;
  rpcs.length = 0;
  storedReads = [rows(BUILT_ON)];
  rpcAnswers = [OK];
  rowUpdateAnswer = { data: [{ id: "c1" }], error: null };
  toast.success.mockReset();
  toast.error.mockReset();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("Field Ingestion — approving a contact update Paige proposed", () => {
  it("primary: the new address takes the primary's place on the list held now, written checked against that list, in the proposal's workspace", async () => {
    proposals = [proposal({
      updates: { title: "Owner" },
      address_intent: { op: "primary", values: { email: "jordan.reyes@reyesbuild.co" } },
      contact_methods_built_on: BUILT_ON,
    })];
    await renderAndApprove();

    expect(rpcs).toHaveLength(1);
    expect(rpcs[0]).toEqual({
      fn: "upsert_contact",
      args: {
        p_patch: {
          contact_methods: [{ ...JORDAN, value: "jordan.reyes@reyesbuild.co" }, OPS, PHONE],
          expected_contact_methods: BUILT_ON,
        },
        p_contact_id: "c1",
        p_tenant_id: "tenant-b",
        p_channel: "manual",
      },
    });
    expect(rowWrite()?.value).toEqual({ title: "Owner" });
    expect(rowWrite()?.filters).toEqual([["id", "c1"], ["tenant_id", "tenant-b"]]);
    expect(applied()).toBe(true);
  });

  it("primary: an address added since the proposal makes it stale — the approver never saw that list, so nothing is written", async () => {
    const BILLING = { kind: "email", value: "billing@reyesbuild.co", label: "Billing", is_primary: false };
    storedReads = [rows([JORDAN, OPS, BILLING, PHONE])];
    proposals = [proposal({ updates: { title: "Owner" }, address_intent: { op: "primary", values: { email: "new@reyesbuild.co" } }, contact_methods_built_on: BUILT_ON })];
    await renderAndApprove();

    expect(rpcs).toEqual([]);
    expect(rowWrite()).toBeUndefined();
    expect(applied()).toBe(false);
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/changed after Paige proposed this, so nothing was saved/));
  });

  it("primary: a relabelled address since the proposal makes it stale too", async () => {
    storedReads = [rows([JORDAN, { ...OPS, label: "Operations" }, PHONE])];
    proposals = [proposal({ updates: {}, address_intent: { op: "primary", values: { email: "new@reyesbuild.co" } }, contact_methods_built_on: BUILT_ON })];
    await renderAndApprove();

    expect(rpcs).toEqual([]);
    expect(applied()).toBe(false);
  });

  it("primary: a list that differs only as the database ignores (outer whitespace) is the same list; the write names the list it was built on", async () => {
    storedReads = [rows([JORDAN, { ...OPS, value: "ops@reyesbuild.co\u00a0" }, PHONE])];
    proposals = [proposal({ updates: {}, address_intent: { op: "primary", values: { email: "new@reyesbuild.co" } }, contact_methods_built_on: BUILT_ON })];
    await renderAndApprove();

    expect(patchOf(0)).toEqual({ contact_methods: [{ ...JORDAN, value: "new@reyesbuild.co" }, OPS, PHONE], expected_contact_methods: BUILT_ON });
    expect(applied()).toBe(true);
  });

  it("primary: when the primary it would displace changed since the proposal, nothing is written and the proposal stays pending", async () => {
    storedReads = [rows([{ ...JORDAN, is_primary: false }, { ...OPS, is_primary: true }, PHONE])];
    proposals = [proposal({ updates: { title: "Owner" }, address_intent: { op: "primary", values: { email: "new@reyesbuild.co" } }, contact_methods_built_on: BUILT_ON })];
    await renderAndApprove();

    expect(rpcs).toEqual([]);
    expect(rowWrite()).toBeUndefined();
    expect(applied()).toBe(false);
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/changed after Paige proposed this, so nothing was saved/));
  });

  it("add: every address held now is kept and the new one appended; a save that loses a race is rebuilt on the new list", async () => {
    const LATE = { kind: "email", value: "late@reyesbuild.co", label: null, is_primary: false };
    storedReads = [rows(BUILT_ON), rows([JORDAN, OPS, LATE, PHONE])];
    rpcAnswers = [STALE, OK];
    proposals = [proposal({ updates: {}, address_intent: { op: "add", methods: [{ kind: "email", value: "billing@reyesbuild.co", label: "Billing" }] }, contact_methods_built_on: BUILT_ON })];
    await renderAndApprove();

    const BILLING = { kind: "email", value: "billing@reyesbuild.co", label: "Billing", is_primary: false };
    expect(rpcs).toHaveLength(2);
    expect(patchOf(0)).toEqual({ contact_methods: [JORDAN, OPS, BILLING, PHONE], expected_contact_methods: BUILT_ON });
    expect(patchOf(1)).toEqual({ contact_methods: [JORDAN, OPS, LATE, BILLING, PHONE], expected_contact_methods: [JORDAN, OPS, LATE, PHONE] });
    expect(applied()).toBe(true);
  });

  it("replace: the proposed list is written naming the list it was built on", async () => {
    const ONLY = [{ kind: "email", value: "only@reyesbuild.co", label: null, is_primary: true }];
    proposals = [proposal({ updates: { title: "Owner" }, address_intent: { op: "replace", methods: ONLY }, contact_methods_built_on: BUILT_ON })];
    await renderAndApprove();

    expect(rpcs).toHaveLength(1);
    expect(patchOf(0)).toEqual({ contact_methods: ONLY, expected_contact_methods: BUILT_ON });
    expect(rowWrite()?.value).toEqual({ title: "Owner" });
    expect(applied()).toBe(true);
  });

  it("replace: refused as stale before anything is written when the list changed since it was built on", async () => {
    const ONLY = [{ kind: "email", value: "only@reyesbuild.co", label: null, is_primary: true }];
    // Someone added an address after the proposal: the replacement would silently drop it.
    storedReads = [rows([JORDAN, OPS, { kind: "email", value: "billing@reyesbuild.co", label: "Billing", is_primary: false }, PHONE])];
    proposals = [proposal({ updates: { title: "Owner" }, address_intent: { op: "replace", methods: ONLY }, contact_methods_built_on: BUILT_ON })];
    await renderAndApprove();

    expect(rpcs).toEqual([]);
    expect(rowWrite()).toBeUndefined();
    expect(applied()).toBe(false);
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/changed after Paige proposed this/));
  });

  it("replace: a stale refusal from the database (a save that landed in between) still writes nothing else", async () => {
    const ONLY = [{ kind: "email", value: "only@reyesbuild.co", label: null, is_primary: true }];
    proposals = [proposal({ updates: { title: "Owner" }, address_intent: { op: "replace", methods: ONLY }, contact_methods_built_on: BUILT_ON })];
    rpcAnswers = [STALE];
    await renderAndApprove();

    expect(rpcs).toHaveLength(1);
    expect(rowWrite()).toBeUndefined();
    expect(applied()).toBe(false);
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/changed after Paige proposed this/));
  });

  it("refuses, writing nothing: the retired full-list format, an unreadable intent, a primary without its built-on list, and an address key on the row", async () => {
    const cases = [
      { updates: {}, contact_methods: BUILT_ON },
      { updates: {}, address_intent: { op: "primary", values: { fax: "1" } }, contact_methods_built_on: BUILT_ON },
      { updates: {}, address_intent: { op: "primary", values: { email: "x@y.co" } } },
      { updates: { add_contact_methods: [{ kind: "email", value: "x@y.co" }] } },
      { updates: { contact_methods: BUILT_ON } },
      { updates: { email: "x@y.co" }, address_intent: { op: "add", methods: [{ kind: "email", value: "x@y.co" }] } },
    ];
    for (const payload of cases) {
      act(() => root.unmount());
      root = createRoot(host);
      writes.length = 0;
      rpcs.length = 0;
      toast.error.mockReset();
      proposals = [proposal(payload)];
      await renderAndApprove();
      expect(rpcs, JSON.stringify(payload)).toEqual([]);
      expect(writes, JSON.stringify(payload)).toEqual([]);
      expect(toast.error, JSON.stringify(payload)).toHaveBeenCalled();
    }
  });

  it("an older proposal's `email` sets the primary on the list held now, in the proposal's workspace, and never reaches the row", async () => {
    storedReads = [rows([JORDAN])];
    proposals = [proposal({ updates: { email: "new@reyesbuild.co", title: "Owner" } })];
    await renderAndApprove();

    expect(rpcs[0].args).toMatchObject({
      p_patch: {
        contact_methods: [{ ...JORDAN, value: "new@reyesbuild.co" }],
        expected_contact_methods: [JORDAN],
      },
      p_tenant_id: "tenant-b",
    });
    expect(rowWrite()?.value).toEqual({ title: "Owner" });
    expect(applied()).toBe(true);
  });
});

describe("Field Ingestion — a failed row update never marks the proposal applied", () => {
  it("a row update the database refuses leaves the proposal pending and says why", async () => {
    rowUpdateAnswer = { data: null, error: { message: "permission denied for table clients" } };
    proposals = [proposal({ updates: { title: "Owner" } })];
    await renderAndApprove();

    expect(rowWrite()?.value).toEqual({ title: "Owner" });
    expect(applied()).toBe(false);
    expect(toast.error).toHaveBeenCalledWith("permission denied for table clients");
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("a row update that matched no row (not this workspace's, or gone) is a failure too", async () => {
    rowUpdateAnswer = { data: [], error: null };
    proposals = [proposal({ updates: { title: "Owner" } })];
    await renderAndApprove();

    expect(applied()).toBe(false);
    expect(toast.error).toHaveBeenCalledWith("The contact could not be updated.");
  });

  it("when the row update fails after the addresses were written, the address change is put back, checked against what it wrote", async () => {
    rowUpdateAnswer = { data: null, error: { message: "row refused" } };
    proposals = [proposal({ updates: { title: "Owner" }, address_intent: { op: "primary", values: { email: "new@reyesbuild.co" } }, contact_methods_built_on: BUILT_ON })];
    await renderAndApprove();

    const written = [{ ...JORDAN, value: "new@reyesbuild.co" }, OPS, PHONE];
    expect(rpcs).toHaveLength(2);
    expect(patchOf(0)).toEqual({ contact_methods: written, expected_contact_methods: BUILT_ON });
    expect(patchOf(1)).toEqual({ contact_methods: BUILT_ON, expected_contact_methods: written });
    expect(applied()).toBe(false);
    expect(toast.error).toHaveBeenCalledWith("row refused");
  });

  it("when that undo is itself refused, the message says the address change stayed", async () => {
    rowUpdateAnswer = { data: null, error: { message: "row refused" } };
    rpcAnswers = [OK, STALE];
    proposals = [proposal({ updates: { title: "Owner" }, address_intent: { op: "primary", values: { email: "new@reyesbuild.co" } }, contact_methods_built_on: BUILT_ON })];
    await renderAndApprove();

    expect(applied()).toBe(false);
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/address change was saved but the other fields were not \(row refused\), and the address change could not be undone/));
  });
});

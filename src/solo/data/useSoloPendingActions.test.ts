// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, it, expect, vi } from "vitest";
import { toPendingAction, useSoloPendingActions } from "./useSoloPendingActions";

const supa = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: supa.from } }));

/**
 * The pure half of the pending-actions read — what a filed action is allowed to claim once the
 * two fabricated modals stopped claiming it for themselves.
 *
 * HONEST LIMIT OF THIS FILE (§13/§32): `TcApprove` and `TcEscalate` are module-private and only
 * reachable by clicking an orb on a WebGL-ish canvas, so unlike `TrustCompass` and `TeamHub` they
 * are not mount-tested. What is covered here is the coercion they render from, plus source
 * assertions in `compass.fabrications.test.ts` that the invented content is gone. Driving the
 * modals themselves is owed to a session that can drive the surface.
 */
describe("toPendingAction — a filed action must earn its modal", () => {
  const base = {
    id: "aaaaaaaa-0000-4000-8000-000000000001",
    title: "Send the renewal note",
    summary: "Drafted, not sent.",
    draft_content: "Hi — quick note about your renewal.",
    decision_rationale: "It goes to a client, so it waits for you.",
    from_department: "marketing",
    created_at: "2026-09-01T11:00:00.000Z",
  };

  it("keeps the recorded fields and names the desk from its slug", () => {
    const a = toPendingAction(base);
    expect(a?.title).toBe("Send the renewal note");
    expect(a?.summary).toBe("Drafted, not sent.");
    expect(a?.draftContent).toBe("Hi — quick note about your renewal.");
    expect(a?.rationale).toBe("It goes to a client, so it waits for you.");
    expect(a?.department).toBe("Marketing");
  });

  it("names an unattributed desk rather than leaving it blank", () => {
    expect(toPendingAction({ ...base, from_department: null })?.department).toBe("Unattributed");
    expect(toPendingAction({ ...base, from_department: "not_a_desk" })?.department).toBe("Unattributed");
  });

  it("turns blank text into a stated absence, so the modal omits the block", () => {
    const a = toPendingAction({ ...base, summary: "  ", decision_rationale: "", draft_content: "   " });
    expect(a?.summary).toBeNull();
    expect(a?.rationale).toBeNull();
    expect(a?.draftContent).toBeNull();
  });

  it("refuses to render a non-string draft as prose", () => {
    // `draft_content` is jsonb on some rows. Stringifying an object would put a JSON blob in front
    // of an operator as though Paige had written it to a person.
    expect(toPendingAction({ ...base, draft_content: { subject: "x" } })?.draftContent).toBeNull();
    expect(toPendingAction({ ...base, draft_content: 42 })?.draftContent).toBeNull();
  });

  it("drops a row with no id or no usable title", () => {
    expect(toPendingAction({ ...base, id: undefined })).toBeNull();
    expect(toPendingAction({ ...base, title: undefined })).toBeNull();
    expect(toPendingAction({ ...base, title: "   " })).toBeNull();
    expect(toPendingAction(null)).toBeNull();
  });
});

// F1 (§9): the read is scoped to the VIEWED workspace, never widened by the global-admin operator
// escape on pa_tenant_staff_read. A null workspace runs no query at all.
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("useSoloPendingActions — tenant scoping (§9)", () => {
  let root: Root | null = null;
  afterEach(() => { act(() => root?.unmount()); root = null; supa.from.mockReset(); });

  function build(count: number | null = null) {
    const eqCalls: Array<[string, unknown]> = [];
    const selectCalls: Array<[string, unknown]> = [];
    const builder: Record<string, unknown> = {};
    builder.select = (columns: string, options: unknown) => { selectCalls.push([columns, options]); return builder; };
    builder.order = () => builder;
    builder.eq = (col: string, val: unknown) => { eqCalls.push([col, val]); return builder; };
    builder.limit = () => Promise.resolve({ data: [], error: null, count });
    return { builder, eqCalls, selectCalls };
  }

  async function mount(tenantId: string | null, actorId?: string | null) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    let observed: ReturnType<typeof useSoloPendingActions>;
    function Probe() { observed = useSoloPendingActions(tenantId, actorId); return null; }
    act(() => { root!.render(createElement(Probe)); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    return observed!;
  }

  it("constrains the query to the viewed tenant_id", async () => {
    const { builder, eqCalls } = build();
    supa.from.mockReturnValue(builder);
    await mount("tenant-x");
    expect(supa.from).toHaveBeenCalledWith("paige_actions");
    // The scope filter must be present — without it the operator escape would surface other tenants.
    expect(eqCalls).toContainEqual(["tenant_id", "tenant-x"]);
  });

  it("runs NO query when the workspace is unresolved (never an unscoped read)", async () => {
    await mount(null);
    expect(supa.from).not.toHaveBeenCalled();
  });

  it("requests an exact scoped total independently of the capped preview", async () => {
    const { builder, selectCalls, eqCalls } = build(37);
    supa.from.mockReturnValue(builder);
    const result = await mount("tenant-x");
    expect(selectCalls[0][1]).toEqual({ count: "exact" });
    expect(eqCalls).toContainEqual(["tenant_id", "tenant-x"]);
    expect(result.total).toBe(37);
    expect(result.items).toEqual([]);
  });

  it("keeps a missing count unknown instead of deriving a total from preview rows", async () => {
    const { builder } = build();
    supa.from.mockReturnValue(builder);
    expect((await mount("tenant-x")).total).toBeNull();
  });

  it("does not read while an explicitly asserted actor is unresolved", async () => {
    await mount("tenant-x", null);
    expect(supa.from).not.toHaveBeenCalled();
  });

  it("retires loaded work synchronously on same-workspace actor change and ignores a late actor result", async () => {
    type Reply = { data: Array<{ id: string; title: string }>; error: null; count: number };
    const waiting: Array<(reply: Reply) => void> = [];
    const { builder, eqCalls } = build();
    builder.limit = () => new Promise<Reply>((resolve) => waiting.push(resolve));
    supa.from.mockReturnValue(builder);
    const host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    let actor = "test-actor-a";
    let observed!: ReturnType<typeof useSoloPendingActions>;
    const renders: Array<{ actor: string; ids: string[]; total: number | null | undefined }> = [];
    function Probe() {
      observed = useSoloPendingActions("tenant-x", actor);
      renders.push({ actor, ids: observed.items.map((item) => item.id), total: observed.total });
      return null;
    }
    act(() => root!.render(createElement(Probe)));
    await act(async () => { waiting[0]({ data: [{ id: "test-work-a", title: "First actor's recorded work" }], error: null, count: 37 }); });
    expect(observed.items[0]?.id).toBe("test-work-a");
    actor = "test-actor-b";
    act(() => root!.render(createElement(Probe)));
    expect(renders.filter((render) => render.actor === actor).every((render) => render.ids.length === 0 && render.total === null)).toBe(true);
    actor = "test-actor-c";
    act(() => root!.render(createElement(Probe)));
    expect(waiting).toHaveLength(3);
    await act(async () => { waiting[2]({ data: [{ id: "test-work-c", title: "Current actor's recorded work" }], error: null, count: 2 }); });
    await act(async () => { waiting[1]({ data: [{ id: "test-work-b", title: "Late superseded actor work" }], error: null, count: 99 }); });
    expect(observed.items.map((item) => item.id)).toEqual(["test-work-c"]);
    expect(observed.total).toBe(2);
    expect(renders.filter((render) => render.actor === "test-actor-c").every((render) => !render.ids.includes("test-work-a") && !render.ids.includes("test-work-b"))).toBe(true);
    // The actor argument is a client assertion; only the original session/RLS owns identity.
    expect(eqCalls.filter(([column]) => column === "tenant_id")).toEqual(Array.from({ length: 3 }, () => ["tenant_id", "tenant-x"]));
    expect(eqCalls.some(([column]) => column === "actor_id" || column === "user_id")).toBe(false);
    host.remove();
  });
});

import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import GrowthFunnelRenderer from "./GrowthFunnelRenderer";

/**
 * A funnel's form step reads its form through growth_public_form, like every public form. When
 * that form is not live, the visitor must get the funnel's own "not ready" step with a way on —
 * never an empty section with nothing to press.
 */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const state = vi.hoisted(() => ({ rpc: vi.fn(), invoke: vi.fn() }));

const TWO_STEPS = [
  { id: "s1", step_type: "form", order_index: 0, page_id: null, form_id: "form-1", config_json: {} },
  { id: "s2", step_type: "thankyou", order_index: 1, page_id: null, form_id: null, config_json: {} },
];

const ROWS: Record<string, unknown> = {
  tenants: { id: "biz-1" },
  growth_funnels: { id: "fun-1", tenant_id: "biz-1", name: "Book a call" },
  growth_funnel_steps: TWO_STEPS,
};

function query(table: string) {
  const result = { data: ROWS[table] ?? null, error: null };
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order"]) builder[m] = () => builder;
  builder.maybeSingle = () => Promise.resolve(result);
  builder.then = (ok: (v: unknown) => unknown) => Promise.resolve(result).then(ok);
  return builder;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => query(table),
    rpc: (...args: unknown[]) => state.rpc(...args),
    functions: { invoke: (...args: unknown[]) => state.invoke(...args) },
  },
}));

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const text = () => container.textContent ?? "";

async function render() {
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/f/biz/book"]}>
        <Routes><Route path="/f/:tenantSlug/:funnelSlug" element={<GrowthFunnelRenderer />} /></Routes>
      </MemoryRouter>,
    );
  });
  for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); });
}

beforeEach(() => {
  state.rpc.mockReset();
  ROWS.growth_funnel_steps = TWO_STEPS;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("funnel form step", () => {
  it("shows the form when it is live", async () => {
    state.rpc.mockImplementation((fn: string) =>
      Promise.resolve({ data: fn === "growth_public_form" ? [{ id: "form-1", slug: "call", name: "Tell us about you", schema_json: { sections: [{ title: "You", fields: [{ key: "name", type: "text", label: "Your name" }] }] }, success_action_json: {} }] : null, error: null }));
    await render();
    expect(state.rpc).toHaveBeenCalledWith("growth_public_form", { p_form_id: "form-1" });
    expect(text()).toContain("Tell us about you");
  });

  it("turns a form that is not live into the funnel's own not-ready step, with a way on", async () => {
    state.rpc.mockResolvedValue({ data: [], error: null });
    await render();
    expect(text()).toContain("This step isn't ready yet");
    const onward = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes("Continue"));
    expect(onward).toBeDefined();
  });

  it("never tells a visitor they are all set when the funnel's only form is not live", async () => {
    ROWS.growth_funnel_steps = [TWO_STEPS[0]];
    state.rpc.mockResolvedValue({ data: [], error: null });
    await render();
    expect(text()).toContain("This form isn't taking responses right now");
    expect(text()).toContain("Nothing was sent");
    expect(Array.from(container.querySelectorAll("button")).some((b) => b.textContent?.includes("Continue"))).toBe(false);
    expect(text()).not.toContain("You're all set");
  });
});

import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import GrowthFormPage from "./GrowthFormRenderer";

/**
 * A visitor's answers reach a form only through growth-public-submit, and a form is read only
 * through growth_public_form(). The browser can no longer read the forms table or insert a
 * submission (20270518000000_public_form_intake.sql), so the page must never touch either.
 */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const state = vi.hoisted(() => ({
  rpc: vi.fn(),
  invoke: vi.fn(),
  from: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => state.rpc(...args),
    functions: { invoke: (...args: unknown[]) => state.invoke(...args) },
    from: (...args: unknown[]) => state.from(...args),
  },
}));

const FORM = {
  id: "form-1",
  slug: "contact",
  name: "Book a call",
  schema_json: {
    sections: [{
      title: "About you",
      fields: [
        { key: "name", type: "text", label: "Your name", required: true },
        { key: "email", type: "email", label: "Work email", required: true },
      ],
    }],
  },
  success_action_json: { message: "Thanks, Dana will reply today." },
};

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

const text = () => container.textContent ?? "";
const submitButton = () =>
  Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Submit") as HTMLButtonElement;

function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function render() {
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/form/form-1"]}>
        <Routes><Route path="/form/:id" element={<GrowthFormPage />} /></Routes>
      </MemoryRouter>,
    );
  });
  await act(async () => { await Promise.resolve(); });
}

async function fillAndSubmit() {
  type(container.querySelector("#gf-name") as HTMLInputElement, "Dana Reyes");
  type(container.querySelector("#gf-email") as HTMLInputElement, "dana@example.com");
  await act(async () => { submitButton().click(); });
  // The page waits until the visitor has been on the form long enough not to look like a bot.
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
}

function httpError(status: number, body: unknown) {
  return { data: null, error: { message: "non-2xx", context: new Response(JSON.stringify(body), { status }) } };
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  state.rpc.mockReset().mockResolvedValue({ data: [FORM], error: null });
  state.invoke.mockReset();
  state.from.mockReset().mockImplementation(() => { throw new Error("the public form must not touch a table"); });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe("public form page", () => {
  it("reads the form through growth_public_form, never the table", async () => {
    await render();
    expect(state.rpc).toHaveBeenCalledWith("growth_public_form", { p_form_id: "form-1" });
    expect(state.from).not.toHaveBeenCalled();
    expect(text()).toContain("Book a call");
  });

  it("submits through growth-public-submit with the form id, the bot trap and the time on the form — and no business id", async () => {
    state.invoke.mockResolvedValue({ data: { ok: true, submission_id: "sub-1" }, error: null });
    await render();
    await fillAndSubmit();

    expect(state.invoke).toHaveBeenCalledTimes(1);
    const [name, opts] = state.invoke.mock.calls[0] as [string, { body: Record<string, unknown> }];
    expect(name).toBe("growth-public-submit");
    expect(opts.body.form_id).toBe("form-1");
    expect(opts.body.answers).toEqual({ name: "Dana Reyes", email: "dana@example.com" });
    expect(opts.body.hp).toBe("");
    expect(opts.body.elapsed_ms).toBeGreaterThanOrEqual(1500);
    expect(opts.body).not.toHaveProperty("tenant_id");
    expect(state.from).not.toHaveBeenCalled();
    expect(text()).toContain("Thanks, Dana will reply today.");
  });

  it("does not claim success when no submission id comes back", async () => {
    state.invoke.mockResolvedValue({ data: { ok: true }, error: null });
    await render();
    await fillAndSubmit();
    expect(text()).not.toContain("Thanks, Dana will reply today.");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("couldn't submit");
  });

  it("names the answers the server refused, by their labels", async () => {
    state.invoke.mockResolvedValue(httpError(422, { error: "invalid_answers", missing_required: [], invalid: ["email"] }));
    await render();
    await fillAndSubmit();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Please check Work email and try again.");
  });

  it("asks the visitor to wait when the form is rate limited", async () => {
    state.invoke.mockResolvedValue(httpError(429, { error: "rate_limited" }));
    await render();
    await fillAndSubmit();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("wait a minute");
  });

  it("keeps the bot trap out of sight and out of the tab order", async () => {
    await render();
    const trap = container.querySelector('input[name="website"]') as HTMLInputElement;
    expect(trap).not.toBeNull();
    expect(trap.tabIndex).toBe(-1);
    expect(trap.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it("says the form is unavailable when the read finds nothing", async () => {
    state.rpc.mockResolvedValue({ data: [], error: null });
    await render();
    expect(text()).toContain("This form isn't available");
  });
});

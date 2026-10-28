import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NumbersTab } from "./NumbersTab";

/**
 * Buying a number here SPENDS MONEY, and until now this surface had no test at all —
 * which is how it kept a `onClick={() => void buy(n)}` that charged on a single click,
 * with no confirmation, while rendering the price as "—" whenever the operator had not
 * priced the type. One click could start a recurring charge at an amount nobody was shown.
 *
 * It also never sent the amount it displayed, so `comms-purchase-number`'s price
 * re-verification — guarded `if (agreedMonthlyCents !== null)` — was skipped entirely for
 * this lane. A price that moved between the search and the click was simply charged.
 *
 * Every test below fails against the version before this change.
 */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const state = vi.hoisted(() => ({
  invoke: vi.fn(),
  toasts: [] as Array<{ title?: string; description?: string }>,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    // The real chain is `.from().select().order()` — no `.eq()`. A double that only
    // answered the shape I assumed made every test fail inside loadOwned rather than in
    // the assertion, which is its own small lesson about mocks.
    from: () => ({
      select: () => ({
        order: async () => ({ data: [], error: null }),
        eq: () => ({ order: async () => ({ data: [], error: null }) }),
      }),
    }),
    functions: { invoke: (...args: unknown[]) => state.invoke(...args) },
  },
}));
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: (t: { title?: string; description?: string }) => { state.toasts.push(t); } }),
}));

let container: HTMLDivElement;

const PRICED = {
  price_configured: true,
  numbers: [{
    phone_number: "+14045550123",
    capabilities: { sms: true, voice: true },
    retail_price: { monthly_cents: 120, onetime_cents: null, currency: "usd" },
  }],
};
const UNPRICED = {
  price_configured: false,
  numbers: [{ phone_number: "+14045550199", capabilities: { voice: true }, retail_price: null }],
};

const text = () => container.textContent ?? "";
const button = (label: string) =>
  Array.from(container.querySelectorAll("button")).find((b) => (b.textContent ?? "").trim() === label);

async function mount() {
  container = document.createElement("div");
  document.body.appendChild(container);
  await act(async () => { createRoot(container).render(<NumbersTab />); });
}

/** Search so a Buy button exists to press. Area code is optional — blank means any. */
async function search(payload: unknown = PRICED) {
  state.invoke = vi.fn(async (name: string) =>
    name === "comms-search-numbers" ? { data: payload, error: null } : { data: {}, error: null });
  await act(async () => { button("Find numbers")?.click(); });
}

const purchaseCall = () =>
  state.invoke.mock.calls.find((c) => c[0] === "comms-purchase-number") as
    | [string, { body?: Record<string, unknown> }]
    | undefined;

beforeEach(() => {
  state.toasts = [];
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("Buying a number asks first, and holds the server to the price shown", () => {
  it("REGRESSION: does NOT charge on a single click — it asks, and a refusal buys nothing", async () => {
    await mount();
    await search();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);

    await act(async () => { button("Buy")?.click(); });

    expect(confirm, "this surface used to buy with no confirmation at all").toHaveBeenCalled();
    expect(purchaseCall(), "a refused confirmation must not reach the purchase seam").toBeUndefined();
  });

  it("names the number and the real price in the question", async () => {
    await mount();
    await search();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);

    await act(async () => { button("Buy")?.click(); });

    const asked = String(confirm.mock.calls[0][0]);
    expect(asked).toContain("+1 (404) 555-0123");
    expect(asked).toContain("$1.20");
    expect(asked, "an approval that hides the recurring charge is not an approval").toMatch(/charges your business/i);
  });

  it("REGRESSION: sends the agreed amount, so the server's price re-check actually runs", async () => {
    await mount();
    await search();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const prior = state.invoke;
    state.invoke = vi.fn(async (name: string, ...rest: unknown[]) =>
      name === "comms-purchase-number"
        ? { data: { purchased: true, phone_number: "+14045550123", twilio_sid: "PN1" }, error: null }
        : prior(name, ...rest));

    await act(async () => { button("Buy")?.click(); });

    // The whole point: without this key the server skips verification entirely.
    expect(purchaseCall()?.[1]?.body).toEqual({
      phone_number: "+14045550123",
      agreed_monthly_cents: 120,
    });
  });

  it("an UNPRICED number still asks, and says the amount is unlisted rather than showing a dash", async () => {
    await mount();
    await search(UNPRICED);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);

    await act(async () => { button("Buy")?.click(); });

    expect(String(confirm.mock.calls[0][0])).toContain("an unlisted monthly price");
  });

  it("sends NO agreed amount when there is no published price — there is nothing to hold anyone to", async () => {
    await mount();
    await search(UNPRICED);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const prior = state.invoke;
    state.invoke = vi.fn(async (name: string, ...rest: unknown[]) =>
      name === "comms-purchase-number"
        ? { data: { purchased: true, phone_number: "+14045550199", twilio_sid: "PN2" }, error: null }
        : prior(name, ...rest));

    await act(async () => { button("Buy")?.click(); });

    expect(purchaseCall()?.[1]?.body).not.toHaveProperty("agreed_monthly_cents");
  });

  it("REGRESSION: a price that moved is EXPLAINED, not reported as 'try another number'", async () => {
    await mount();
    await search();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const prior = state.invoke;
    state.invoke = vi.fn(async (name: string, ...rest: unknown[]) =>
      name === "comms-purchase-number"
        ? { data: { error: "price_changed" }, error: null }
        : prior(name, ...rest));

    await act(async () => { button("Buy")?.click(); });

    const said = state.toasts.map((t) => `${t.title ?? ""} ${t.description ?? ""}`).join(" ");
    expect(said, "the refusal is the RIGHT outcome; the copy has to say so").toMatch(/price changed/i);
    expect(said).toMatch(/nothing was bought/i);
    expect(said, "the old default sent people in a loop picking other numbers")
      .not.toMatch(/may have just been taken/i);
  });

  it("a pre-buy voice-setup refusal reads as setup, not as 'try another number'", async () => {
    await mount();
    await search();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const prior = state.invoke;
    state.invoke = vi.fn(async (name: string, ...rest: unknown[]) =>
      name === "comms-purchase-number"
        ? { data: { needs_config: true, error: "voice_twiml_url_unavailable" }, error: null }
        : prior(name, ...rest));

    await act(async () => { button("Buy")?.click(); });

    const said = state.toasts.map((t) => `${t.title ?? ""} ${t.description ?? ""}`).join(" ");
    expect(said).toMatch(/isn't set up to buy numbers yet/i);
    expect(said).not.toMatch(/may have just been taken/i);
    expect(said).not.toContain("voice_twiml_url_unavailable");
  });

  it("still NEVER reports a refused purchase as a success", async () => {
    await mount();
    await search();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const prior = state.invoke;
    state.invoke = vi.fn(async (name: string, ...rest: unknown[]) =>
      name === "comms-purchase-number"
        ? { data: { error: "number_unavailable" }, error: null }
        : prior(name, ...rest));

    await act(async () => { button("Buy")?.click(); });

    expect(state.toasts.some((t) => (t.title ?? "").includes("is yours"))).toBe(false);
  });
});

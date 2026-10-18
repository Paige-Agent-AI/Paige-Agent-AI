import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

// E09 Slice 6 (D8): email consent stays unenforced by the pre-send gate, so the toggle must say it
// doesn't change sends yet — and promise nothing the gate doesn't do (§13), in §2 words.
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/integrations/supabase/client", () => {
  const q: Record<string, unknown> = { select: () => q, limit: () => q, maybeSingle: async () => ({ data: { tenant_id: "e0960000-0000-4000-8000-00000000b001", email_consent_enforced: true } }) };
  return { supabase: { from: () => q } };
});
const { ConsentTab } = await import("./ConsentTab");
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

it("says the setting does not change sends yet, and makes no promise the gate doesn't keep", async () => {
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  await act(async () => root.render(<ConsentTab />));
  await act(async () => { await Promise.resolve(); });
  expect(host.querySelector('[data-testid="consent-enforcement-truth"]')?.textContent)
    .toBe("It doesn't change sends yet: Paige still emails under opt-out rules whether it's on or off.");
  expect(host.textContent).not.toMatch(/will only email a client who has clearly opted in|intake forms|practices?\b/i);
  act(() => root.unmount()); host.remove();
});

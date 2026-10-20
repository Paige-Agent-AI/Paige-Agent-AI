// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEST_BUSINESS_REVIEW, TEST_REVIEW_TENANT } from "@/test/fixtures/business-review";
import { parseBusinessReview, useBusinessReview } from "./useBusinessReview";

const api = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: api.invoke } } }));
vi.mock("@/lib/userClock", () => ({ getUserClock: () => ({ userTimezone: "America/New_York" }) }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root; let host: HTMLDivElement;
beforeEach(() => { api.invoke.mockReset(); host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
function Probe({ tenant }: { tenant: string | null }) { const r = useBusinessReview(tenant); return <div>{r.state === "ready" ? r.snapshot.tenant_id : r.state}</div>; }
async function render(tenant: string | null) { await act(async () => { root.render(<Probe tenant={tenant} />); }); }

describe("Business review transport — canonical shape and workspace fence", () => {
  it("accepts a real Fabric-shaped response and retains its actual full/partial coverage", () => {
    const result = parseBusinessReview({ ok: true, snapshot: TEST_BUSINESS_REVIEW }, TEST_REVIEW_TENANT, "America/New_York");
    expect(result?.domains.payments.data?.coverage).toBe("full");
    expect(result?.domains.operations.data?.coverage).toBe("partial");
  });
  it("rejects a foreign workspace or changed reporting zone", () => {
    expect(parseBusinessReview({ ok: true, snapshot: TEST_BUSINESS_REVIEW }, "foreign", "America/New_York")).toBeNull();
    expect(parseBusinessReview({ ok: true, snapshot: TEST_BUSINESS_REVIEW }, TEST_REVIEW_TENANT, "UTC")).toBeNull();
  });
  it("rejects a malformed domain instead of crashing or painting invented numbers", () => {
    const malformed = { ...TEST_BUSINESS_REVIEW, domains: { ...TEST_BUSINESS_REVIEW.domains,
      payments: { status: "available" as const, data: { ...TEST_BUSINESS_REVIEW.domains.payments.data!, coverage: "complete" as never } },
    } };
    expect(parseBusinessReview({ ok: true, snapshot: malformed }, TEST_REVIEW_TENANT, "America/New_York")).toBeNull();
  });
  it("runs no request before workspace resolution", async () => { await render(null); expect(api.invoke).not.toHaveBeenCalled(); });
  it("uses the same explicit reporting clock as Chat and the existing seam", async () => {
    api.invoke.mockResolvedValue({ data: { ok: true, snapshot: TEST_BUSINESS_REVIEW }, error: null }); await render(TEST_REVIEW_TENANT);
    expect(api.invoke).toHaveBeenCalledWith("paige-business-review", expect.objectContaining({ body: { period: "last_7_days", timezone: "America/New_York" } }));
    expect(host.textContent).toBe(TEST_REVIEW_TENANT);
  });
  it("drops an old request across a workspace switch, including its late completion", async () => {
    let answer: (value: unknown) => void = () => {};
    api.invoke.mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; })).mockResolvedValueOnce({ data: null, error: new Error("unavailable") });
    await render(TEST_REVIEW_TENANT); await render("test-tenant-2");
    await act(async () => { answer({ data: { ok: true, snapshot: TEST_BUSINESS_REVIEW }, error: null }); });
    expect(host.textContent).toBe("failed"); expect(host.textContent).not.toContain(TEST_REVIEW_TENANT);
  });
});

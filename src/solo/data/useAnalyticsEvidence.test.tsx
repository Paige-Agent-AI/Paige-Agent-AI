// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { notifyManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type RpcResult = { data: unknown; error: { message: string } | null };
type Deferred = { promise: Promise<RpcResult>; resolve: (value: RpcResult) => void };

const deferred = (): Deferred => {
  let resolve!: (value: RpcResult) => void;
  const promise = new Promise<RpcResult>((done) => { resolve = done; });
  return { promise, resolve };
};

const harness = vi.hoisted(() => ({ calls: [] as Array<Promise<RpcResult>>, rpc: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: harness.rpc.mockImplementation(function (this: { rpc?: unknown } | undefined) {
      if (this?.rpc !== harness.rpc) throw new TypeError("Evidence RPC requires its client receiver");
      const call = harness.calls.shift();
      if (!call) throw new Error("No Analytics evidence RPC response queued");
      return call;
    }),
  },
}));

import { useAnalyticsEvidence } from "./useAnalyticsEvidence";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const issued = (count: number, expiresAt = new Date(Date.now() + 15 * 60_000).toISOString()) => ({
  evidence_ref: `aneb_v1_${"a".repeat(64)}`,
  bundle: {
    metric: {
      id: "sales_funnel.created_deals_by_current_stage",
      label: "Deals created by current stage",
      definition: "Count of deal records created in the exact range, grouped by current stage.",
      formula: "count(deals.id) grouped by current stage",
      version: "1.0.0",
    },
    range: { key: "last_30_days", start: "2026-08-01T00:00:00Z", end: "2026-08-31T00:00:00Z" },
    source_references: [
      { source: "public.deals", boundary: "active tenant and exact range" },
      { source: "public.pipelines", boundary: "unique active-tenant default pipeline" },
      { source: "public.pipeline_stages", boundary: "tenant stages in that pipeline" },
    ],
    contributing_record_count: count,
    coverage: { state: "complete", candidate_count: count, contributing_count: count, excluded_count: 0 },
    exclusions: [],
    freshness: { queried_at: "2026-08-31T00:00:00Z", source_updated_through: "2026-08-20T00:00:00Z" },
    truth_state: "LIVE",
    account_epoch_ref: `ae_v1_${"b".repeat(64)}`,
    source_revision_ref: `sr_v1_${"c".repeat(64)}`,
    reference_expires_at: expiresAt,
    values: {
      kind: "sales_funnel_stages",
      pipeline_label: "Sales pipeline",
      stages: [{ stage_key: "stage_1", label: "Lead", stage_type: "open", order: 1, count }],
    },
    caveats: ["Stage counts use each deal's current stage at queried time."],
  },
});

function Probe({ epoch }: { epoch: string | null }) {
  const result = useAnalyticsEvidence({ accountEpoch: epoch, rangeKey: "last_30_days", enabled: true });
  return <output
    data-loading={String(result.loading)}
    data-error={String(result.isError)}
    data-metric={result.bundle?.metric.id ?? ""}
    data-range={result.bundle?.range.key ?? ""}
    data-account-ref={result.bundle?.account_epoch_ref ?? ""}
    data-source-revision={result.bundle?.source_revision_ref ?? ""}
  >
    {result.bundle?.contributing_record_count ?? ""}|{result.evidenceReference ?? ""}
  </output>;
}

let host: HTMLDivElement;
let root: Root;
let client: QueryClient;

beforeEach(() => {
  notifyManager.setScheduler((callback) => callback());
  harness.calls = [];
  harness.rpc.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  act(() => root.unmount());
  client.clear();
  host.remove();
  vi.useRealTimers();
  notifyManager.setScheduler((callback) => setTimeout(callback, 0));
});

const render = (epoch: string | null) => root.render(
  <QueryClientProvider client={client}><Probe epoch={epoch} /></QueryClientProvider>,
);

describe("useAnalyticsEvidence", () => {
  it("passes only the metric, server range key, and active account epoch to the issuer", async () => {
    const response = deferred();
    harness.calls = [response.promise];
    await act(async () => { render("account-a"); await Promise.resolve(); });
    expect(harness.rpc).toHaveBeenCalledWith("issue_analytics_evidence_bundle", {
      p_metric_id: "sales_funnel.created_deals_by_current_stage",
      p_range_key: "last_30_days",
      p_account_epoch: "account-a",
    });
    expect(JSON.stringify(harness.rpc.mock.calls[0])).not.toContain("tenant_id");
    expect(JSON.stringify(harness.rpc.mock.calls[0])).not.toContain("value_cents");
  });

  it("clears account A immediately and never commits its late bundle into account B", async () => {
    const a = deferred();
    const b = deferred();
    harness.calls = [a.promise, b.promise];
    await act(async () => { render("account-a"); await Promise.resolve(); });
    await act(async () => { render("account-b"); await Promise.resolve(); });
    expect(host.textContent).toBe("|");

    await act(async () => {
      b.resolve({ data: issued(2), error: null });
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(host.textContent).toContain("2|aneb_v1_");

    await act(async () => { a.resolve({ data: issued(99), error: null }); await Promise.resolve(); });
    expect(host.textContent).not.toContain("99");
  });

  it("does not call the issuer without an active account epoch", async () => {
    await act(async () => { render(null); await Promise.resolve(); });
    expect(harness.rpc).not.toHaveBeenCalled();
    expect(host.textContent).toBe("|");
  });

  it("fails closed when the server response is not the safe evidence shape", async () => {
    harness.calls = [Promise.resolve({ data: { evidence_ref: "raw", bundle: { truth_state: "LIVE" } }, error: null })];
    await act(async () => {
      render("account-a");
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(host.querySelector("output")?.dataset.error).toBe("true");
    expect(host.textContent).toBe("|");
  });

  it("retries by issuing a fresh bundle and never reuses the failed response", async () => {
    function RetryProbe() {
      const result = useAnalyticsEvidence({ accountEpoch: "account-a", rangeKey: "last_30_days", enabled: true });
      return <><output>{result.bundle?.contributing_record_count ?? ""}|{result.evidenceReference ?? ""}</output><button type="button" aria-label="Retry evidence" onClick={() => void result.retry()} /></>;
    }
    harness.calls = [
      Promise.resolve({ data: null, error: { message: "temporarily unavailable" } }),
      Promise.resolve({ data: issued(3), error: null }),
    ];
    await act(async () => {
      root.render(<QueryClientProvider client={client}><RetryProbe /></QueryClientProvider>);
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(host.querySelector("output")?.textContent).toBe("|");

    await act(async () => {
      host.querySelector<HTMLButtonElement>('[aria-label="Retry evidence"]')?.click();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(host.querySelector("output")?.textContent).toContain("3|aneb_v1_");
    expect(harness.rpc.mock.calls.map((call) => call[0])).toEqual([
      "issue_analytics_evidence_bundle",
      "issue_analytics_evidence_bundle",
    ]);
  });

  it("abandons an unresolved issuance without resolving or exposing its late reference", async () => {
    const pending = deferred();
    const remountPending = deferred();
    const abandonedHost = document.createElement("div");
    const abandonedRoot = createRoot(abandonedHost);
    const abandonedClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    document.body.append(abandonedHost);
    harness.calls = [pending.promise, remountPending.promise];

    try {
      await act(async () => {
        abandonedRoot.render(<QueryClientProvider client={abandonedClient}><Probe epoch="account-a" /></QueryClientProvider>);
        await Promise.resolve();
      });
      act(() => abandonedRoot.unmount());
      await act(async () => {
        pending.resolve({ data: issued(9), error: null });
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      const issueKey = ["analytics-evidence", "sales_funnel.created_deals_by_current_stage", "last_30_days", "account-a"];
      expect(abandonedClient.getQueryData(issueKey)).toBeUndefined();
      const remountRoot = createRoot(abandonedHost);
      try {
        await act(async () => {
          remountRoot.render(<QueryClientProvider client={abandonedClient}><Probe epoch="account-a" /></QueryClientProvider>);
          await Promise.resolve();
        });
        expect(abandonedHost.textContent).toBe("|");
        expect(harness.rpc).toHaveBeenCalledTimes(2);
      } finally {
        act(() => remountRoot.unmount());
      }
    } finally {
      abandonedClient.clear();
      abandonedHost.remove();
    }
  });

  it("withholds an issued bundle at its exact reference expiry without rotating it", async () => {
    vi.useFakeTimers();
    const first = deferred();
    harness.calls = [first.promise];
    await act(async () => { render("account-a"); await Promise.resolve(); });
    await act(async () => {
      first.resolve({ data: issued(2, new Date(Date.now() + 1_000).toISOString()), error: null });
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(host.textContent).toContain("2|aneb_v1_");

    await act(async () => { await vi.advanceTimersByTimeAsync(1_001); });
    expect(host.textContent).toBe("|");
    expect(harness.rpc).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("rejects internally contradictory coverage even when the response says LIVE", async () => {
    const contradictory = issued(2);
    contradictory.bundle.coverage.candidate_count = 1;
    harness.calls = [Promise.resolve({ data: contradictory, error: null })];
    await act(async () => {
      render("account-a");
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(host.querySelector("output")?.dataset.error).toBe("true");
    expect(host.textContent).toBe("|");
  });

  it.each([
    ["stage totals", (response: ReturnType<typeof issued>) => { response.bundle.values.stages[0].count = 1; }],
    ["exclusion totals", (response: ReturnType<typeof issued>) => {
      response.bundle.truth_state = "PARTIAL";
      response.bundle.coverage.state = "partial";
      response.bundle.coverage.candidate_count = 3;
      response.bundle.coverage.excluded_count = 1;
    }],
    ["duplicate stage keys", (response: ReturnType<typeof issued>) => {
      response.bundle.values.stages.push({ ...response.bundle.values.stages[0], count: 0 });
    }],
    ["unavailable contributing rows", (response: ReturnType<typeof issued>) => {
      response.bundle.truth_state = "UNAVAILABLE";
      response.bundle.coverage.state = "unavailable";
      response.bundle.coverage.candidate_count = 3;
      response.bundle.coverage.contributing_count = 1;
      response.bundle.coverage.excluded_count = 2;
      response.bundle.contributing_record_count = 1;
      response.bundle.exclusions = [{ reason: "unavailable source", count: 2 }];
      response.bundle.values.pipeline_label = null;
      response.bundle.values.stages = [];
    }],
  ])("rejects contradictory %s", async (_label, mutate) => {
    const response = issued(2);
    mutate(response);
    harness.calls = [Promise.resolve({ data: response, error: null })];
    await act(async () => {
      render("account-a");
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(host.querySelector("output")?.dataset.error).toBe("true");
    expect(host.textContent).toBe("|");
  });

  it("withholds values when a focused-page source revalidation fails", async () => {
    vi.useFakeTimers();
    const first = deferred();
    harness.calls = [first.promise, Promise.resolve({ data: null, error: { message: "stale source" } })];
    await act(async () => { render("account-a"); await Promise.resolve(); });
    await act(async () => {
      first.resolve({ data: issued(2), error: null });
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(host.textContent).toContain("2|aneb_v1_");

    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(host.textContent).toBe("|");
    expect(harness.rpc).toHaveBeenCalledTimes(2);
    expect(harness.rpc.mock.calls[1][0]).toBe("resolve_analytics_evidence_reference");
    expect(harness.rpc.mock.calls[1][1]).toEqual({ p_evidence_ref: `aneb_v1_${"a".repeat(64)}` });
  });

  it("revalidates the existing opaque reference without another issuer call", async () => {
    vi.useFakeTimers();
    const first = deferred();
    const original = issued(2);
    harness.calls = [first.promise, Promise.resolve({ data: original.bundle, error: null })];
    await act(async () => { render("account-a"); await Promise.resolve(); });
    await act(async () => {
      first.resolve({ data: original, error: null });
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(0);
    });
    const originalReference = host.textContent?.split("|")[1];
    const originalContract = { ...(host.querySelector("output") as HTMLOutputElement).dataset };

    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(host.textContent).toBe(`2|${originalReference}`);
    expect({ ...(host.querySelector("output") as HTMLOutputElement).dataset }).toEqual(originalContract);
    expect(harness.rpc.mock.calls.map((call) => call[0])).toEqual([
      "issue_analytics_evidence_bundle",
      "resolve_analytics_evidence_reference",
    ]);
  });
});

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IntelligenceWorkspace } from "./IntelligenceSurface";
import { canonicalPath, resolveOperatorAddress } from "@/operator/shell/operatorAddress";
import { recommendationDocument, newRecommendation, type EvalRun, type IntelligenceRead, type ReadState, type IntelligenceTrace } from "@/operator/data/intelligenceContract";
vi.mock("@/operator/data/useIntelligence", () => ({ useIntelligence: vi.fn() }));

const source = <T,>(data: T): ReadState<T> => ({ data, loading: false, fetching: false, error: false, updatedAt: 1791604800000, refresh: vi.fn() });
const trace: IntelligenceTrace = { id: "test-trace-1", created_at: "2026-10-10T04:00:00Z", tenant_label: "Test workspace", agent_id: "test-agent", provider: "test-provider", model: "test-model", job_kind: "test-job", modality: "text", tier: "operational", status: "error", tokens_in: null, tokens_out: null, latency_ms: 240, cost_estimate_usd: null, error_class: "test_failure", account_type: "standalone", parent_name: null, working_context_label: null };
const read = (): IntelligenceRead => ({ subject: "test-operator", epoch: 1, access: "allowed", retryAccess: vi.fn(),
  metrics: source({ traces: { total: 1, cost_estimate_usd: null } }), traces: source([trace]), evals: source([]) });
let root: Root;
let node: HTMLDivElement;
async function mount(data = read()) {
  node = document.createElement("div"); document.body.append(node); root = createRoot(node);
  await act(async () => root.render(<IntelligenceWorkspace read={data} />));
}
async function click(text: string) {
  const button = Array.from(node.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent?.includes(text));
  if (!button) throw new Error(`Missing button ${text}`);
  // Radix Tabs use mousedown, so keyboard activation exercises the real accessible tab path.
  await act(async () => { button.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); button.click(); });
  await act(async () => { await new Promise<void>((resolve) => requestAnimationFrame(() => resolve())); });
}
afterEach(async () => { if (root) await act(async () => root.unmount()); node?.remove(); });
describe("INT-280 supported Operator flows", () => {
  it("resolves the new Settings home and legacy Operator bookmark", () => {
    expect(canonicalPath(resolveOperatorAddress("settings", "paige-intelligence"))).toBe("/operator/settings/paige-intelligence");
    expect(canonicalPath(resolveOperatorAddress("platform", "intelligence"))).toBe("/operator/settings/paige-intelligence");
    expect(resolveOperatorAddress("platform", "other").kind).toBe("unknown");
  });
  it("preserves null cost and never turns call telemetry into a task completion rate", async () => {
    await mount();
    const term = Array.from(node.querySelectorAll("dt")).find((dt) => dt.textContent === "Estimated model spend");
    expect(term?.nextElementSibling?.textContent).toBe("—");
    expect(node.textContent).toContain("Verified task completion");
    expect(node.textContent).toContain("UNAVAILABLE");
  });
  it("hides previously returned metrics after a failed refresh", async () => {
    const data = read(); data.metrics.error = true; data.metrics.data = { traces: { total: 98765 } };
    await mount(data);
    expect(node.textContent).not.toContain("98,765");
    expect(node.textContent).toContain("No stale evidence is shown");
  });
  it("charts use returned categories and suppress them on failed metric refresh", async () => {
    const data = read(); data.metrics.data = { traces: { by_status: [{ status: "ok", count: 8 }, { status: "error", count: 2 }], by_provider: [{ provider: "Measured provider", count: 10 }] } };
    await mount(data);
    expect(node.textContent).toContain("80.0%"); expect(node.textContent).toContain("10 calls in returned status groups");
    expect(node.textContent).toContain("Call status does not establish task completion");
    data.metrics.error = true; await act(async () => root.render(<IntelligenceWorkspace read={{ ...data }} />));
    expect(node.textContent).not.toContain("Measured provider"); expect(node.textContent).not.toContain("80.0%");
  });
  it("plots only measured latencies and keeps null calls unmeasured", async () => {
    const data = read(); data.traces.data = [trace, { ...trace, id: "unmeasured", latency_ms: null }];
    await mount(data); await click("Forensic Observatory");
    const plot = node.querySelector('svg[role="img"]');
    expect(plot?.getAttribute("aria-label")).toContain("1 measured calls");
    expect(plot?.querySelectorAll("circle")).toHaveLength(1);
    expect(node.textContent).toContain("from 2 returned records");
  });
  it("inspects real adapter metadata and hands only its reference to a local draft", async () => {
    await mount(); await click("Forensic Observatory"); await click("Inspect");
    expect(node.textContent).toContain("canonical metadata read on load and explicit refresh");
    expect(node.textContent).not.toContain("audited read on load");
    expect(node.textContent).toContain("test-trace-1");
    expect(node.textContent).toContain("This is one model call");
    await click("Prepare recommendation");
    expect(node.querySelector<HTMLTextAreaElement>("#intel-improvement-evidence")?.value).toBe("paige_llm_trace:test-trace-1");
    expect(document.activeElement?.id).toBe("intel-improvement-evidence");
    expect(node.textContent).toContain("No proposal was submitted");
  });
  it("overview shortcuts reveal and focus their inspection destinations", async () => {
    await mount(); await click("Inspect calls"); expect(document.activeElement?.id).toBe("intel-call-filter");
    await click("Executive Flight Deck"); await click("Inspect evaluations"); expect(document.activeElement?.id).toBe("intel-evaluation-evidence");
  });
  it("validates missing dossier evidence and supports cancel and discard", async () => {
    await mount(); await click("Opportunity Radar"); await click("Review draft");
    expect(document.activeElement?.id).toBe("intel-opportunity-problem");
    expect(node.querySelector('[aria-invalid="true"]')).not.toBeNull();
    await click("Discard draft"); await click("Keep editing");
    expect(node.querySelector('[aria-label="Discard session draft"]')).toBeNull();
    await click("Discard draft"); await click("Discard text");
    expect(node.textContent).toContain("Session draft discarded");
  });
  it("shows attribution separately from a distinct working context", async () => {
    const data = read(); data.traces.data = [{ ...trace, tenant_label: "Test agency", working_context_label: "Test child" }];
    await mount(data); await click("Forensic Observatory");
    expect(node.textContent).toContain("Attributed: Test agency");
    expect(node.textContent).toContain("Working on: Test child");
  });
  it("resolves inspected runs from the latest response", async () => {
    const data = read(); const run: EvalRun = { id: "run-test", dataset_id: "dataset-test", target_kind: "trace_batch", target_version: "v1", status: "running", scorer_set: [], case_count: 1, scored_count: 0, degraded_count: 0, aggregate_score: null, pass_rate: null, prev_run_id: null, created_at: trace.created_at, completed_at: null, dataset_status: "active", results: [], result_count: 0 };
    data.evals.data = [run]; await mount(data); await click("Improvement Studio"); await click("Inspect");
    data.evals = source([{ ...run, status: "complete", aggregate_score: 0.75, completed_at: "2026-10-10T04:05:00Z" }]);
    await act(async () => root.render(<IntelligenceWorkspace read={{ ...data }} />));
    expect(node.textContent).toContain("0.75"); expect(node.textContent).toContain("2026-10-10T04:05:00Z");
  });
  it("preserves citations when preparing from another source and deduplicates references", async () => {
    const data = read(); data.traces.data = [trace, { ...trace, id: "test-trace-2" }];
    await mount(data); await click("Forensic Observatory"); await click("Inspect"); await click("Prepare recommendation");
    await click("Forensic Observatory");
    const inspect = node.querySelector<HTMLButtonElement>('[aria-label="Inspect call test-trace-2"]')!;
    await act(async () => inspect.click()); await click("Prepare recommendation");
    expect(node.querySelector<HTMLTextAreaElement>("#intel-improvement-evidence")?.value).toBe("paige_llm_trace:test-trace-1\npaige_llm_trace:test-trace-2");
    await click("Forensic Observatory"); await click("Prepare recommendation");
    expect(node.querySelector<HTMLTextAreaElement>("#intel-improvement-evidence")?.value.match(/test-trace-2/g)).toHaveLength(1);
  });
  it("refuses export without a complete evidence and review packet", () => {
    expect(() => recommendationDocument(newRecommendation("opportunity"))).toThrow("Complete");
  });
});

/**
 * The Studio's image-approval card, and the hook behind it (v2b).
 *
 * EVIDENCE CLASS (§32/§70.1): jsdom render + a hook driven against a stubbed Supabase client. It
 * proves what each person is SHOWN and what the hook SENDS — the requester gets Approve and the
 * approval echoes the server-issued fingerprint; anyone else sees who asked and can only decline.
 * It does not prove the deployed paige-media accepts these payloads; the handler's own behaviour is
 * proven in src/__tests__/media-approval-handler.test.ts, and authenticated runtime proof is owed.
 */
// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const stub = vi.hoisted(() => ({
  jobs: [] as Array<Record<string, unknown>>,
  invokes: [] as Array<{ action: string; body: Record<string, unknown> }>,
  responses: {} as Record<string, unknown>,
  userId: "u-requester",
}));

vi.mock("@/integrations/supabase/client", () => {
  const chain = {
    select: () => chain,
    order: () => chain,
    limit: async () => ({ data: stub.jobs, error: null }),
    in: async () => ({ data: [], error: null }),
  };
  return {
    supabase: {
      from: () => chain,
      auth: { getUser: async () => ({ data: { user: { id: stub.userId } } }) },
      functions: {
        invoke: async (_name: string, { body }: { body: Record<string, unknown> }) => {
          stub.invokes.push({ action: String(body.action), body });
          return { data: stub.responses[String(body.action)] ?? {}, error: null };
        },
      },
      channel: () => ({ on() { return this; }, subscribe() { return this; } }),
      removeChannel: () => {},
    },
  };
});
vi.mock("@/hooks/useTenantContext", () => ({ useTenantContext: () => ({ activeTenantId: "t-synthetic" }) }));

const { useMediaJobs } = await import("../useMediaJobs");
const { MediaApprovalCard } = await import("./MediaApprovalCard");

const pendingJob = (over: Record<string, unknown> = {}) => ({
  id: "job-1", actor_id: "u-requester", mode: "image", provider: "fal", model: "auto", state: "blocked", approval_state: "pending",
  params: { prompt: "A warm, bright workspace photo", studio_session_id: "s-1" }, estimated_cost_usd: 0.04, actual_cost_usd: null,
  error: null, content_id: null, video_seconds: null, created_at: "2026-10-04T12:00:00Z", completed_at: null, ...over,
});

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  stub.invokes = [];
  stub.responses = {};
  stub.userId = "u-requester";
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const buttons = () => [...host.querySelectorAll("button")].map((b) => b.textContent);
const click = async (label: string) => {
  const b = [...host.querySelectorAll("button")].find((x) => x.textContent === label);
  if (!b) throw new Error(`no button ${label}`);
  await act(async () => { b.click(); });
};
const flush = async () => { for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); }); };

function Probe() {
  const media = useMediaJobs();
  const job = media.jobs.find((j) => j.approval_state === "pending");
  return job ? <MediaApprovalCard job={job} media={media} /> : <p>none</p>;
}

describe("MediaApprovalCard — who sees what", () => {
  const actions = (state: { requestedByYou: boolean | null; requesterName: string | null }) => ({
    approve: vi.fn(async () => true),
    decline: vi.fn(async () => true),
    approvalFor: () => state,
  });

  it("the person who asked sees Approve (gold) and Decline", async () => {
    const media = actions({ requestedByYou: true, requesterName: null });
    act(() => root.render(<MediaApprovalCard job={pendingJob() as never} media={media} />));
    expect(host.textContent).toContain("An image needs your approval");
    expect(host.textContent).toContain("Estimated $0.04");
    expect(buttons()).toEqual(["Approve and make it", "Decline"]);
    expect(host.querySelector(".vs-btn-gold")?.textContent).toBe("Approve and make it");
    await click("Approve and make it");
    expect(media.approve).toHaveBeenCalledWith("job-1");
  });

  it("another admin sees who asked, a plain reason, and Decline only", async () => {
    const media = actions({ requestedByYou: false, requesterName: "Dana Reyes" });
    act(() => root.render(<MediaApprovalCard job={pendingJob() as never} media={media} />));
    expect(host.textContent).toContain("Waiting for Dana Reyes to approve");
    expect(host.textContent).toContain("Only Dana Reyes can approve the cost. You can decline it.");
    expect(buttons()).toEqual(["Decline"]);
    expect(host.querySelector(".vs-btn-gold")).toBeNull();
    await click("Decline");
    expect(media.decline).toHaveBeenCalledWith("job-1");
    expect(media.approve).not.toHaveBeenCalled();
  });

  it("with no name on file it says 'the person who asked'", () => {
    act(() => root.render(<MediaApprovalCard job={pendingJob() as never} media={actions({ requestedByYou: false, requesterName: null })} />));
    expect(host.textContent).toContain("Waiting for the person who asked to approve");
    expect(buttons()).toEqual(["Decline"]);
  });

  it("before it is known who is looking, it never offers Approve", () => {
    act(() => root.render(<MediaApprovalCard job={pendingJob({ mode: "video", video_seconds: 5 }) as never} media={actions({ requestedByYou: null, requesterName: null })} />));
    expect(host.textContent).toContain("A video is waiting for approval");
    expect(buttons()).toEqual(["Decline"]);
  });

  it("a decision in flight disables both controls and says what is happening", async () => {
    let finish!: (v: boolean) => void;
    const media = { ...actions({ requestedByYou: true, requesterName: null }), approve: vi.fn(() => new Promise<boolean>((r) => { finish = r; })) };
    act(() => root.render(<MediaApprovalCard job={pendingJob() as never} media={media} />));
    await click("Approve and make it");
    expect(buttons()).toEqual(["Approving…", "Decline"]);
    expect([...host.querySelectorAll("button")].every((b) => b.disabled)).toBe(true);
    await act(async () => { finish(true); });
    expect(buttons()).toEqual(["Approve and make it", "Decline"]);
  });
});

describe("useMediaJobs — approve echoes the server-issued fingerprint", () => {
  it("the requester's Approve sends the fingerprint the seam issued for them", async () => {
    stub.jobs = [pendingJob()];
    stub.responses.list = { jobs: [{ ...pendingJob(), approval: { requested_by_you: true, requester_name: null, fingerprint: "0123456789abcdef" } }] };
    act(() => root.render(<Probe />));
    await flush();
    expect(buttons()).toEqual(["Approve and make it", "Decline"]);
    await click("Approve and make it");
    const sent = stub.invokes.find((c) => c.action === "approve");
    expect(sent?.body).toEqual({ action: "approve", job_id: "job-1", approved_fingerprint: "0123456789abcdef" });
  });

  it("without a fingerprint in hand (a reload, a chat-started job) it asks the seam for it before approving", async () => {
    stub.jobs = [pendingJob()];
    stub.responses.list = { jobs: [pendingJob()] }; // the list read came back without approval facts
    stub.responses.status = { job: pendingJob(), approval: { requested_by_you: true, requester_name: null, fingerprint: "fedcba9876543210" } };
    act(() => root.render(<Probe />));
    await flush();
    await click("Approve and make it");
    const order = stub.invokes.map((c) => c.action);
    expect(order.indexOf("status")).toBeGreaterThan(-1);
    expect(order.indexOf("status")).toBeLessThan(order.indexOf("approve"));
    expect(stub.invokes.find((c) => c.action === "approve")?.body.approved_fingerprint).toBe("fedcba9876543210");
  });

  it("never approves without a fingerprint — it says so instead", async () => {
    stub.jobs = [pendingJob()];
    stub.responses.list = { jobs: [pendingJob()] };
    stub.responses.status = { job: pendingJob() };
    let error: string | null = null;
    function ErrorProbe() {
      const media = useMediaJobs();
      error = media.actionError;
      const job = media.jobs[0];
      return job ? <MediaApprovalCard job={job} media={media} /> : null;
    }
    act(() => root.render(<ErrorProbe />));
    await flush();
    await click("Approve and make it");
    expect(stub.invokes.some((c) => c.action === "approve")).toBe(false);
    expect(error).toBe("This approval isn't ready yet. Try again in a moment.");
  });

  it("another admin is shown who asked and their Decline sends reject", async () => {
    stub.userId = "u-other";
    stub.jobs = [pendingJob()];
    stub.responses.list = { jobs: [{ ...pendingJob(), approval: { requested_by_you: false, requester_name: "Dana Reyes" } }] };
    act(() => root.render(<Probe />));
    await flush();
    expect(host.textContent).toContain("Waiting for Dana Reyes to approve");
    expect(buttons()).toEqual(["Decline"]);
    await click("Decline");
    expect(stub.invokes.find((c) => c.action === "reject")?.body).toEqual({ action: "reject", job_id: "job-1" });
  });

  it("before the seam answers, the row's requester decides who sees Approve", async () => {
    stub.userId = "u-other";
    stub.jobs = [pendingJob()];
    stub.responses.list = { jobs: [pendingJob()] };
    act(() => root.render(<Probe />));
    await flush();
    expect(buttons()).toEqual(["Decline"]);
  });
});

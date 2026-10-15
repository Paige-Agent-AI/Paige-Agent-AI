import { describe, expect, it, vi } from "vitest";
import { buildSoloBusinessInterviewContextBlock } from "../../supabase/functions/_shared/paige-spine/domains/soloBusinessInterviewContext";
const context = { tenantId: "tenant-a", accessScope: "owner_full", contextRevision: 3, brief: {
  industry: "Design", offers: "Unconfirmed", registeredStreet: "PRIVATE ADDRESS", businessRegistrationNumber: "PRIVATE TAX ID",
  provenance: { industry: { source: "owner_confirmed", confidence: "confirmed" }, offers: { source: "connection_sourced", confidence: "observed" } },
} };
describe("server-resolved SOLO interview projection", () => {
  it("reads the owned checkpoint then current Setup, excludes private/unconfirmed values and grants no effects", async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: null, error: null }).mockResolvedValueOnce({ data: context, error: null });
    const block = await buildSoloBusinessInterviewContextBlock({ rpc }, "tenant-a", "thread-a");
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(["get_solo_business_interview_checkpoint", "get_solo_business_context"]);
    expect(block).toContain('"industry":"Design"'); expect(block).not.toContain("PRIVATE"); expect(block).not.toContain('"offers":"Unconfirmed"'); expect(block).toContain("A proposal is NOT a save");
  });
  it("does not read Setup if caller-thread authority is refused", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: true });
    expect(await buildSoloBusinessInterviewContextBlock({ rpc }, "tenant-a", "foreign-thread")).toContain("could not be verified"); expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("refuses foreign tenant readback and forged checkpoint shape", async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: null, error: null }).mockResolvedValueOnce({ data: { ...context, tenantId: "tenant-b" }, error: null });
    expect(await buildSoloBusinessInterviewContextBlock({ rpc }, "tenant-a", "thread-a")).not.toContain("Design");
    rpc.mockResolvedValueOnce({ data: { tenantId: "tenant-b" }, error: null }).mockResolvedValueOnce({ data: context, error: null });
    expect(await buildSoloBusinessInterviewContextBlock({ rpc }, "tenant-a", "thread-a")).not.toContain("Design");
  });
  it("refuses absent thread and sanitized transport exceptions", async () => {
    const rpc = vi.fn().mockRejectedValue(new Error("SECRET TRANSPORT"));
    expect(await buildSoloBusinessInterviewContextBlock({ rpc }, "tenant-a", null)).toContain("could not be verified"); expect(rpc).not.toHaveBeenCalled();
    expect(await buildSoloBusinessInterviewContextBlock({ rpc }, "tenant-a", "thread-a")).not.toContain("SECRET");
  });
});

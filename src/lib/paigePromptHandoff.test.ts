import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanPaigePrompt, handOffPaigePrompt, mergeIntoDraft, subscribePaigePromptHandoff, takePendingPaigePrompt } from "./paigePromptHandoff";

afterEach(() => { takePendingPaigePrompt(); });

describe("Ask PAIGE handoff", () => {
  it("keeps plain text only, trimmed and capped", () => {
    expect(cleanPaigePrompt("  ask\u0007 me  ")).toBe("ask me");
    expect(cleanPaigePrompt("   ")).toBeNull();
    expect(cleanPaigePrompt(42)).toBeNull();
    expect(cleanPaigePrompt("x".repeat(5000))).toHaveLength(4000);
  });

  it("holds a question until a composer subscribes, then hands it over exactly once", () => {
    handOffPaigePrompt("first");
    const apply = vi.fn();
    const stop = subscribePaigePromptHandoff(apply);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith("first");
    handOffPaigePrompt("second");
    expect(apply).toHaveBeenLastCalledWith("second");
    expect(apply).toHaveBeenCalledTimes(2);
    expect(takePendingPaigePrompt()).toBeNull();
    stop();
    handOffPaigePrompt("after unsubscribe");
    expect(apply).toHaveBeenCalledTimes(2);
  });

  it("never overwrites a draft the owner typed", () => {
    expect(mergeIntoDraft("", "q")).toBe("q");
    expect(mergeIntoDraft("my note  ", "q")).toBe("my note\n\nq");
  });
});

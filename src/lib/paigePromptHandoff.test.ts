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

  it("keeps the explicitly selected specialist leading without losing the owner's draft", () => {
    expect(mergeIntoDraft("Keep my unsent note.", "ZION, review our work.", { preserveAddressee: true }))
      .toBe("ZION, Keep my unsent note.\n\nreview our work.");
    expect(mergeIntoDraft("Hi ZION, keep this note.", "ZION, review our work.", { preserveAddressee: true }))
      .toBe("Hi ZION, keep this note.\n\nreview our work.");
  });

  it("does not change ordinary merges or recovery based on a name in the text", () => {
    expect(mergeIntoDraft("Keep my unsent note.", "ZION, recover original work."))
      .toBe("Keep my unsent note.\n\nZION, recover original work.");
    expect(mergeIntoDraft("Keep my note.", "What would ZION recommend?", { preserveAddressee: true }))
      .toBe("Keep my note.\n\nWhat would ZION recommend?");
    expect(mergeIntoDraft("Keep my note.", "Unknown specialist, do work.", { preserveAddressee: true }))
      .toBe("Keep my note.\n\nUnknown specialist, do work.");
  });

  it("reopening the same specialist invitation does not duplicate its prepared question", () => {
    const options = { preserveAddressee: true };
    const prompt = "ZION, review our work.";
    const merged = mergeIntoDraft("Keep my unsent note.", prompt, options);
    expect(mergeIntoDraft(merged, prompt, options)).toBe(merged);
    expect(mergeIntoDraft("Hi ZION, review our work.", prompt, options))
      .toBe("Hi ZION, review our work.");
    expect(mergeIntoDraft(merged, "ZION, review our capacity.", options))
      .toBe(`${merged}\n\nreview our capacity.`);
  });

  it("handles empty drafts and a bare canonical summons without adding duplicate text", () => {
    expect(mergeIntoDraft("", "ZION, review our work.", { preserveAddressee: true }))
      .toBe("ZION, review our work.");
    expect(mergeIntoDraft("Keep my note.", "ZION?", { preserveAddressee: true }))
      .toBe("ZION, Keep my note.");
  });
});

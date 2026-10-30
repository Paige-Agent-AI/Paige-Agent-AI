import { createComposerScopeIdentity } from "./paigeComposerScopeState";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanPaigePrompt, handOffPaigePrompt, mergeIntoDraft, subscribePaigePromptHandoff, takePendingPaigePrompt } from "./paigePromptHandoff";

afterEach(() => { takePendingPaigePrompt(); });

describe("Ask PAIGE handoff", () => {
  it("retires only its own still-waiting question", () => {
    const retire = handOffPaigePrompt("private review");
    retire();
    expect(takePendingPaigePrompt()).toBeNull();
    const older = handOffPaigePrompt("same words");
    handOffPaigePrompt("same words");
    older();
    expect(takePendingPaigePrompt()).toBe("same words");
  });

  it("does not cancel a replacement or an already delivered typed draft", () => {
    const retire = handOffPaigePrompt("first");
    handOffPaigePrompt("another surface");
    retire();
    expect(takePendingPaigePrompt()).toBe("another surface");
    const apply = vi.fn();
    const stop = subscribePaigePromptHandoff(apply);
    const delivered = handOffPaigePrompt("delivered");
    delivered();
    expect(apply).toHaveBeenCalledExactlyOnceWith("delivered");
    expect(takePendingPaigePrompt()).toBeNull();
    stop();
    const invalid = handOffPaigePrompt(null);
    handOffPaigePrompt("valid");
    invalid();
    expect(takePendingPaigePrompt()).toBe("valid");
  });

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

  it("retains notes added after the prepared question when the same invitation is reopened", () => {
    const prompt = "ZION, review our work.";
    const options = { preserveAddressee: true };
    for (const current of [
      "ZION, review our work.\n\nAlso check the deadline I mentioned.",
      "ZION, Keep my earlier note.\n\nreview our work.\n\nKeep this later note too.",
    ]) expect(mergeIntoDraft(current, prompt, options)).toBe(current);
    const partial = "ZION, My note mentions review our work. without being the prepared question.";
    expect(mergeIntoDraft(partial, prompt, options)).toBe(`${partial}\n\nreview our work.`);
  });
});


describe("Team Hub scoped unsent handoff",()=>{
  const source=createComposerScopeIdentity({userId:"actor-a",tenantId:"tenant-a"})!;
  it("does not reveal a scoped pending prompt to a legacy unscoped composer",()=>{
    const apply=vi.fn(), stop=subscribePaigePromptHandoff(apply);
    const retire=handOffPaigePrompt("Own Team Hub request",{scope:source});
    try { expect(apply).not.toHaveBeenCalled(); expect(takePendingPaigePrompt()).toBeNull(); }
    finally {stop();retire();}
  });
  it("wrong actor, workspace and client focus cannot consume the pending request",()=>{
    const retire=handOffPaigePrompt("Own Team Hub request",{scope:source});
    try {
      for(const scope of [{...source,userId:"actor-b"},{...source,tenantId:"tenant-b"},{...source,focusedClientId:"client-a"},{...source,focusedBusinessMissionId:"mission-a"}]) {
        expect(takePendingPaigePrompt(scope)).toBeNull();
      }
      expect(takePendingPaigePrompt(source)).toBe("Own Team Hub request");
      expect(takePendingPaigePrompt(source)).toBeNull();
    } finally {retire();}
  });
  it("only the matching writable scope receives the same unsent request once",()=>{
    const wrong=vi.fn(), right=vi.fn();
    const stopWrong=subscribePaigePromptHandoff(wrong,()=>({...source,tenantId:"tenant-b"}));
    const stopRight=subscribePaigePromptHandoff(right,()=>source);
    const retire=handOffPaigePrompt("Own Team Hub request",{scope:source});
    try {expect(wrong).not.toHaveBeenCalled();expect(right).toHaveBeenCalledExactlyOnceWith("Own Team Hub request");}
    finally {stopWrong();stopRight();retire();}
  });
  it("a scoped event without its original pending envelope cannot replay raw text",()=>{
    const apply=vi.fn(),stop=subscribePaigePromptHandoff(apply,()=>source);
    try {window.dispatchEvent(new CustomEvent("paige:prefill",{detail:{prompt:"Copied private text",scope:source}}));expect(apply).not.toHaveBeenCalled();}
    finally {stop();}
  });
});

it("legacy events retain their own prefill without draining a different scoped pending request",()=>{
  const scope=createComposerScopeIdentity({tenantId:"team-a",userId:"actor-a"})!;
  const retire=handOffPaigePrompt("Scoped own request",{scope});const apply=vi.fn();const stop=subscribePaigePromptHandoff(apply);
  try {
    window.dispatchEvent(new CustomEvent("paige:prefill",{detail:{prompt:"Legacy surface request"}}));
    expect(apply).toHaveBeenCalledExactlyOnceWith("Legacy surface request");
    expect(takePendingPaigePrompt(scope)).toBe("Scoped own request");
  } finally {stop();retire();}
});

it("a malformed explicit scope cannot silently become a legacy unscoped handoff",()=>{
  const apply=vi.fn(),stop=subscribePaigePromptHandoff(apply);
  try {
    for(const options of [null,{}, {scope:null},{scope:{tenantId:"team-a",userId:"actor-a"}}]) {
      const retire=handOffPaigePrompt("Scoped request",options as Parameters<typeof handOffPaigePrompt>[1]);
      expect(apply).not.toHaveBeenCalled();expect(takePendingPaigePrompt()).toBeNull();retire();
    }
  } finally {stop();}
});

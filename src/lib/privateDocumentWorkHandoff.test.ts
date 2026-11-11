import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import * as handoff from "./privateDocumentWorkHandoff";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const actor = id(1);
const tenant = id(2);
const reference = { threadId: id(3), intentId: id(4), workId: id(5) };

beforeEach(() => window.sessionStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("private original Work locator handoff", () => {
  it("preserves the exact legacy Document bytes and read contract", () => {
    expect(handoff.keepPrivateDocumentWork(actor, tenant, reference)).toBe(true);
    const raw = handoff.privateDocumentWorkSnapshot(actor, tenant);
    expect(raw).toBe(JSON.stringify(reference));
    expect(handoff.parsePrivateDocumentWork(raw)).toEqual(reference);
    expect(handoff.parsePrivateDocumentWork(JSON.stringify({ ...reference, padding: "123456789012345" }))).toBeNull();
  });

  it("distinguishes original Research without storing report, receipt or private context", () => {
    const source = { ...reference, report: "private report", receiptRef: id(6), transcript: "private context" };
    expect(handoff.keepPrivateResearchWork(actor, tenant, source)).toBe(true);
    const raw = handoff.privateDocumentWorkSnapshot(actor, tenant);
    expect(raw).toBe(JSON.stringify({ kind: "research", ...reference }));
    expect(handoff.parsePrivateDocumentWork(raw)).toEqual({ kind: "research", ...reference });
    expect(raw).not.toMatch(/private|report|receipt|transcript/);
  });

  it("never silently treats an unsupported saved kind as a Document", () => {
    expect(handoff.parsePrivateDocumentWork(JSON.stringify({ kind: "x", ...reference }))).toBeNull();
    expect(handoff.parsePrivateDocumentWork(JSON.stringify({ kind: null, ...reference }))).toBeNull();
    expect(handoff.parsePrivateDocumentWork(JSON.stringify({ kind: "document", ...reference }))).toBeNull();
  });

  it("keeps actor and workspace keys private and never clears a replacement", () => {
    handoff.keepPrivateResearchWork(actor, tenant, reference);
    const first = handoff.privateDocumentWorkSnapshot(actor, tenant)!;
    expect(handoff.privateDocumentWorkSnapshot(id(8), tenant)).toBeNull();
    expect(handoff.privateDocumentWorkSnapshot(actor, id(9))).toBeNull();
    handoff.keepPrivateDocumentWork(actor, tenant, reference);
    expect(handoff.clearPrivateDocumentWork(actor, tenant, first)).toBe(false);
    expect(handoff.privateDocumentWorkSnapshot(actor, tenant)).toBe(JSON.stringify(reference));
  });

  it("refuses invalid identity and locator values without persisting them", () => {
    for (const ref of [{ ...reference, workId: "new job" }, { ...reference, threadId: "" }]) {
      expect(handoff.keepPrivateResearchWork(actor, tenant, ref)).toBe(false);
    }
    expect(handoff.keepPrivateResearchWork("", tenant, reference)).toBe(false);
    expect(handoff.keepPrivateResearchWork(actor, "", reference)).toBe(false);
    expect(window.sessionStorage.length).toBe(0);
    for (const raw of [null, "{}", "null", "[]", "broken", "x".repeat(185)]) {
      expect(handoff.parsePrivateDocumentWork(raw)).toBeNull();
    }
  });

  it("does not announce a saved reference when storage is unavailable", () => {
    const event = vi.spyOn(window, "dispatchEvent");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Storage denied"); });
    expect(handoff.keepPrivateResearchWork(actor, tenant, reference)).toBe(false);
    expect(event).not.toHaveBeenCalled();
    expect(window.sessionStorage.length).toBe(0);
  });
});

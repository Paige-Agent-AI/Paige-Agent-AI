/* eslint-disable @typescript-eslint/no-explicit-any -- Executed edge helper, loaded through a transpile port. */
// @vitest-environment node
//
// PAIGE CAPABILITY SYSTEM · SLICE 1 — truthful artifact-creation receipts (§13/§70/§32).
//
// Two halves, exactly like the S1 pipeline contract test, because two different things can be wrong:
//   1. The BEHAVIOUR — does `artifactProduced` correctly separate a real artifact from a
//      200-with-empty-payload (null url, empty drafts, null saved id)? This half runs the real
//      module, so it is execution proof, not a source grep.
//   2. The WIRING — is that honest decision actually applied at each of the four synchronous creation
//      handlers in the 11k-line `serve()` handler, which cannot be imported? This half asserts on its
//      source. The fifth, document_generate, became durable async work in #1431: it returns a work id,
//      never an artifact, and the persisted-id readback lives in the document worker — asserted below.
//      Weaker than execution and stated as such: it catches the regression that reverts a handler
//      to an unguarded `{ success: true }` — the exact §13/§70 defect this slice closes.
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, it, expect } from "vitest";

function load() {
  const src = readFileSync("supabase/functions/_shared/artifact-receipt.ts", "utf8");
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const out: any = {};
  // The module has NO imports at all; a runtime import here would be a regression, so throw on one.
  new Function("require", "exports", js)((k: string) => { throw new Error(`unexpected runtime import: ${k}`); }, out);
  return out;
}

const { artifactProduced, ARTIFACT_ABSENT_ERROR, usableDrafts, IMAGE_NOT_FILED_ERROR } = load();

describe("artifactProduced — a real artifact vs a 200-with-empty-payload (§13/§70)", () => {
  describe("file_url (images — the artifact is a stored file)", () => {
    it("accepts a real public URL", () => {
      expect(artifactProduced("file_url", "https://x.supabase.co/storage/v1/object/public/paige-generated/a.png")).toBe(true);
    });
    it("rejects a null URL — the generate-image 200-with-null-publicUrl path", () => {
      expect(artifactProduced("file_url", null)).toBe(false);
    });
    it("rejects undefined and empty and whitespace-only URLs", () => {
      expect(artifactProduced("file_url", undefined)).toBe(false);
      expect(artifactProduced("file_url", "")).toBe(false);
      expect(artifactProduced("file_url", "   ")).toBe(false);
    });
    it("does not accept a non-string as a file url", () => {
      expect(artifactProduced("file_url", 123 as any)).toBe(false);
      expect(artifactProduced("file_url", { url: "x" } as any)).toBe(false);
    });
  });

  describe("draft_list (copy drafting — the artifact is a non-empty list)", () => {
    it("accepts a non-empty drafts array", () => {
      expect(artifactProduced("draft_list", [{ text: "a" }])).toBe(true);
    });
    it("rejects an empty drafts array — the content-draft 200-with-[] path", () => {
      expect(artifactProduced("draft_list", [])).toBe(false);
    });
    it("rejects null/undefined/non-array", () => {
      expect(artifactProduced("draft_list", null)).toBe(false);
      expect(artifactProduced("draft_list", undefined)).toBe(false);
      expect(artifactProduced("draft_list", "not an array" as any)).toBe(false);
    });
  });

  describe("saved_id (persisted rows — the artifact is identified by a saved id)", () => {
    it("accepts a real id (uuid or scalar)", () => {
      expect(artifactProduced("saved_id", "3f2504e0-4f89-11d3-9a0c-0305e82c3301")).toBe(true);
      expect(artifactProduced("saved_id", "row_123")).toBe(true);
    });
    it("rejects null/undefined — the RPC-returned-no-id path", () => {
      expect(artifactProduced("saved_id", null)).toBe(false);
      expect(artifactProduced("saved_id", undefined)).toBe(false);
    });
    it("rejects empty and whitespace-only ids", () => {
      expect(artifactProduced("saved_id", "")).toBe(false);
      expect(artifactProduced("saved_id", "   ")).toBe(false);
    });
  });
});

describe("ARTIFACT_ABSENT_ERROR — honest, non-leaky failure copy (§11/§13)", () => {
  const shapes = ["file_url", "draft_list", "saved_id"] as const;
  it("has a non-empty message for every shape", () => {
    for (const s of shapes) {
      expect(typeof ARTIFACT_ABSENT_ERROR[s]).toBe("string");
      expect(ARTIFACT_ABSENT_ERROR[s].trim().length).toBeGreaterThan(0);
    }
  });
  it("never leaks a table/function name, SQLSTATE, or the word 'success'", () => {
    for (const s of shapes) {
      const msg = ARTIFACT_ABSENT_ERROR[s];
      expect(msg).not.toMatch(/marketing_content|growth_pages|save_marketing_content|growth_page_upsert|generate-image|content-draft|paige_/i);
      expect(msg).not.toMatch(/\b\d{5}\b/); // no bare SQLSTATE
      expect(msg.toLowerCase()).not.toContain("success");
    }
  });
});

describe("usableDrafts — a non-empty array is not proof of usable copy (§13/§70, Codex P2)", () => {
  it("keeps drafts with non-whitespace content", () => {
    expect(usableDrafts([{ title: "a", content: "real copy" }])).toHaveLength(1);
    expect(usableDrafts([{ content: "x" }, { content: "y" }])).toHaveLength(2);
  });
  it("drops a content-less item normalized to {content:''} — the exact content-draft path", () => {
    expect(usableDrafts([{ title: "Draft", content: "" }])).toHaveLength(0);
    expect(usableDrafts([{ title: "Draft" }])).toHaveLength(0); // missing content
  });
  it("drops whitespace-only content and keeps only the real ones in a mixed batch", () => {
    const out = usableDrafts([{ content: "   " }, { content: "keep me" }, { content: "" }]);
    expect(out).toHaveLength(1);
    expect((out[0] as any).content).toBe("keep me");
  });
  it("returns [] for a non-array or null", () => {
    expect(usableDrafts(null)).toEqual([]);
    expect(usableDrafts(undefined)).toEqual([]);
    expect(usableDrafts("nope" as any)).toEqual([]);
  });
  it("composes with artifactProduced: an all-empty batch degrades to an honest failure", () => {
    expect(artifactProduced("draft_list", usableDrafts([{ content: "" }, { title: "x" }]))).toBe(false);
    expect(artifactProduced("draft_list", usableDrafts([{ content: "real" }]))).toBe(true);
  });
});

describe("IMAGE_NOT_FILED_ERROR — honest Studio-only partial copy (§13/§70, Codex P2)", () => {
  it("is a non-empty, non-leaky string", () => {
    expect(typeof IMAGE_NOT_FILED_ERROR).toBe("string");
    expect(IMAGE_NOT_FILED_ERROR.trim().length).toBeGreaterThan(0);
    expect(IMAGE_NOT_FILED_ERROR).not.toMatch(/marketing_content|content_id|save_marketing_content|studio_artifact|paige_/i);
    expect(IMAGE_NOT_FILED_ERROR.toLowerCase()).not.toContain("success");
  });
});

describe("WIRING — each creation handler wraps its success in the honesty guard (§13/§70)", () => {
  const src = readFileSync("supabase/functions/paige-ai-chat/index.ts", "utf8");

  it("imports the honesty module", () => {
    expect(src).toMatch(/import\s*\{[^}]*artifactProduced[^}]*\}\s*from\s*["']\.\.\/_shared\/artifact-receipt\.ts["']/);
    expect(src).toContain("ARTIFACT_ABSENT_ERROR");
    expect(src).toContain("usableDrafts");
    expect(src).toContain("IMAGE_NOT_FILED_ERROR");
  });

  // Each handler must reference the guard for the artifact shape it produces. These assert the
  // guard is PRESENT at the call site; the behaviour above proves the guard is CORRECT.
  it("generate_image guards the file url", () => {
    expect(src).toMatch(/artifactProduced\(\s*["']file_url["']/);
  });
  it("generate_image requires content_id in a Studio session (Codex P2 — canvas linkage)", () => {
    // The Studio-only final guard: when studioSessionId is set, an unfiled image (no content_id)
    // is not a usable success (the canvas linkage needs the persisted id). Tolerant of the
    // intervening `.success` check between the studio gate and the saved_id guard.
    expect(src).toMatch(/studioSessionId[\s\S]{0,140}!artifactProduced\(\s*["']saved_id["']/);
    expect(src).toContain("IMAGE_NOT_FILED_ERROR");
  });
  it("draft_marketing_content filters to usable drafts before guarding (Codex P2)", () => {
    expect(src).toMatch(/usableDrafts\(/);
    expect(src).toMatch(/artifactProduced\(\s*["']draft_list["']/);
  });
  // One handler's source: from its dispatch branch to the next dispatch branch of ANY name. A count
  // over the whole file let two Studio image guards stand in for a removed document guard (#1461);
  // ending the slice at a named neighbour, or starting it at a non-unique marker, would let a guard
  // from a different handler do the same (§39 finding on this PR). So the marker must be unique and
  // the slice stops at the very next handler.
  function handler(name: string) {
    const marker = `tc.function.name === "${name}") {`;
    const start = src.indexOf(marker);
    expect(start, `${name} handler`).toBeGreaterThan(-1);
    expect(src.indexOf(marker, start + 1), `${name} dispatch marker must be unique`).toBe(-1);
    const after = start + marker.length;
    const next = src.slice(after).search(/tc\.function\.name === "[^"]+"\) \{/);
    expect(next, `a handler after ${name}`).toBeGreaterThan(-1);
    return src.slice(start, after + next);
  }
  it("content_save and growth_page_save each guard the saved id with the honest error", () => {
    for (const name of ["content_save", "growth_page_save"]) {
      const body = handler(name);
      expect(body, name).toMatch(/artifactProduced\(\s*["']saved_id["']/);
      expect(body, name).toContain("ARTIFACT_ABSENT_ERROR.saved_id");
    }
  });
  it("draft_marketing_content and generate_image each return the honest error for their shape", () => {
    expect(handler("draft_marketing_content")).toContain("ARTIFACT_ABSENT_ERROR.draft_list");
    expect(handler("generate_image")).toContain("ARTIFACT_ABSENT_ERROR.file_url");
  });
  it("document_generate never claims an artifact; the durable worker verifies the persisted id", () => {
    // Chat side: the durable submission returns a work id. A missing one is an honest failure, and
    // no branch hands back a content id as if a document already exists.
    const body = handler("document_generate");
    expect(body).toContain("DURABLE_DOCUMENT_WORK_ID_MISSING");
    expect(body).toContain("Nothing may be claimed as created");
    // Any key form: `content_id:`, `"content_id":`, or shorthand `{ content_id }` — but not
    // `target_content_id` or a read like `accepted.content_id`.
    expect(body).not.toMatch(/(?<![\w.$])["']?content_id["']?\s*[:,}]/);
    // Worker side: success is read back from the database and requires the persisted content id.
    const worker = readFileSync("supabase/functions/paige-document-worker/index.ts", "utf8");
    expect(worker).toMatch(/work_status !== "succeeded" \|\| !row\.content_id\)[\s\S]{0,80}DURABLE_DOCUMENT_SUCCESS_READBACK_MISSING/);
  });
});

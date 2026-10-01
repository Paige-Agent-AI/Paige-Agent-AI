// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { knowledgeInvokeOutcome } from "../lib/knowledge/ingest-outcome";

type Element = { type: string; props: Record<string, unknown>; children: unknown[] };
// Execute the actual component's event handlers with a deterministic hook adapter.
// This covers caller transitions; it deliberately makes no DOM/a11y/runtime claim.
function dialog(reply: unknown, initialMode = "paste") {
  let cursor = 0;
  const states: unknown[] = [];
  const useState = (initial: unknown) => {
    const at = cursor++;
    if (!(at in states)) states[at] = initial;
    return [states[at], (value: unknown) => { states[at] = value; }];
  };
  const useRef = (value: unknown) => useState({ current: value })[0];
  const createElement = (type: string, props: Record<string, unknown>, ...children: unknown[]): Element => ({ type, props: props ?? {}, children });
  const invoke = vi.fn().mockResolvedValue(reply);
  const remove = vi.fn();
  const onClose = vi.fn(), onIngested = vi.fn(), onReview = vi.fn(), success = vi.fn();
  const primitives = Object.fromEntries("Brain Plus Trash2 Share2 Clock CheckCircle2 XCircle DialogContent DialogHeader DialogTitle Label Input Textarea Switch Button".split(" ").map(n => [n, n]));
  const env = { exports: {} as Record<string, (...args: unknown[]) => Element>, React: { createElement, Fragment: "fragment" }, useState, useRef, useEffect: () => {}, useCallback: (fn: unknown) => fn,
    ...primitives, knowledgeInvokeOutcome, toast: { success, error: vi.fn() }, supabase: { functions: { invoke }, storage: { from: () => ({ upload: async () => ({ error: null }), remove }) } } };
  const src = readFileSync(new URL("../pages/admin/TenantKnowledgeAdmin.tsx", import.meta.url), "utf8").replace(/^import .*;\r?\n/gm, "");
  const js = ts.transpileModule(src, { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  new Function(...Object.keys(env), js)(...Object.values(env));
  const props = { tenantId: "test-tenant-a", initialMode, onClose, onIngested, onReview };
  const render = () => { cursor = 0; return env.exports.AddDocDialog(props); };
  const elements = (root: unknown): Element[] => {
    if (Array.isArray(root)) return root.flatMap(elements);
    if (!root || typeof root !== "object" || !("type" in root)) return [];
    const element = root as Element;
    return [element, ...element.children.flatMap(elements)];
  };
  const find = (predicate: (el: Element) => boolean) => elements(render()).find(predicate)!;
  const change = (placeholder: string, value: string) => (find(el => el.props.placeholder === placeholder).props.onChange as (event: unknown) => void)({ target: { value } });
  change("e.g. Discovery call script", "Reference");
  if (initialMode === "paste") change("Paste the doc body — Paige chunks and learns it automatically.", "Business methodology");
  if (initialMode === "file") (find(el => el.props.type === "file").props.onChange as (e: unknown) => void)({ target: { files: [{ name: "reference.txt", size: 60, type: "text/plain" }] } });
  const submit = () => (find(el => el.type === "Button" && el.children.includes("Add & teach")).props.onClick as () => Promise<void>)();
  return { props, render, find, invoke, remove, onClose, onIngested, onReview, success, submit };
}
describe("AddDocDialog outcome behavior", () => {
  it("only complete verified success closes and notifies the workspace", async () => {
    const d = dialog({ data: { ok: true, doc_id: "test-doc", chunk_count: 2, embedded: true }, error: null });
    await d.submit();
    expect(d.onClose).toHaveBeenCalledOnce();
    expect(d.onIngested).toHaveBeenCalledWith("Reference", "test-doc");
  });
  for (const data of [{ ok: false, error: "embedding_failed" }, { ok: true, doc_id: "test-doc", chunk_count: 1, embedded: false }, { ok: false, error: "persistence_unverified" }, { ok: true }]) {
    it(`retains input and suppresses completion for ${JSON.stringify(data)}`, async () => {
      const d = dialog({ data, error: null });
      await d.submit();
      expect(d.onClose).not.toHaveBeenCalled();
      expect(d.onIngested).not.toHaveBeenCalled();
      expect(d.success).not.toHaveBeenCalled();
      expect(d.find(el => el.type === "Textarea").props.value).toBe("Business methodology");
      expect(d.find(el => el.props.role === "status")).toBeDefined();
    });
  }
  it("preserves an uploaded source after an ambiguous transport response", async () => {
    const d = dialog({ data: null, error: new Error("Network lost") }, "file");
    await d.submit();
    expect(d.remove).not.toHaveBeenCalled();
    expect(d.onClose).not.toHaveBeenCalled();
  });
  it("refreshes on review without firing the completed-ingestion callback", async () => {
    const d = dialog({ data: { ok: true, doc_id: "test-doc", chunk_count: 1, embedded: false }, error: null });
    await d.submit();
    (d.find(el => el.type === "Button" && el.children.includes("Review knowledge")).props.onClick as () => void)();
    expect(d.onReview).toHaveBeenCalledOnce();
    expect(d.onClose).toHaveBeenCalledOnce();
    expect(d.onIngested).not.toHaveBeenCalled();
  });
  it("suppresses completion after workspace changes, including switching back", async () => {
    const d = dialog(null);
    let resolve!: (v: unknown) => void;
    d.invoke.mockImplementation(() => new Promise(r => { resolve = r; }));
    const pending = d.submit();
    d.props.tenantId = "test-tenant-b"; d.render();
    d.props.tenantId = "test-tenant-a"; d.render();
    resolve({ data: { ok: true, doc_id: "test-doc", chunk_count: 2, embedded: true }, error: null });
    await pending;
    expect(d.onIngested).not.toHaveBeenCalled();
    expect(d.onClose).not.toHaveBeenCalled();
  });
});

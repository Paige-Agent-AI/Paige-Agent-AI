import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChatDocumentUpload } from "./useChatDocumentUpload";

const h = vi.hoisted(() => ({ toast: vi.fn(), extract: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("mammoth/mammoth.browser", () => ({ extractRawText: h.extract }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
type Upload = ReturnType<typeof useChatDocumentUpload>;
let upload: Upload;
let root: Root;
let host: HTMLDivElement;
function Harness({ scope = "thread-a", enabled = true }: { scope?: string | null; enabled?: boolean }) {
  upload = useChatDocumentUpload({ scopeKey: scope, enabled });
  return null;
}
function file(name = "Screenshot.png", type = "image/png", size = 3, read = async () => new Uint8Array([1, 2, 3]).buffer) {
  const f = new File([], name, { type });
  Object.defineProperties(f, { size: { value: size }, arrayBuffer: { value: vi.fn(read) } });
  return f;
}
function paste(files: File[], text = "") {
  return { clipboardData: { files, items: files.map(f => ({ kind: "file", getAsFile: () => f })), getData: () => text }, preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as React.ClipboardEvent;
}
function drag(files: File[] = [], types = ["Files"]) {
  return { dataTransfer: { files, types, dropEffect: "none" }, currentTarget: host, relatedTarget: null, preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as React.DragEvent;
}
async function render(scope: string | null = "thread-a", enabled = true) { await act(async () => root.render(<Harness scope={scope} enabled={enabled} />)); }
async function flush() { await act(async () => { await new Promise(r => setTimeout(r, 0)); }); }
beforeEach(async () => { h.toast.mockReset(); h.extract.mockReset(); h.extract.mockResolvedValue({ value: "Extracted contract" }); host = document.createElement("div"); document.body.append(host); root = createRoot(host); await render(); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

describe("INT-338 canonical attachment input", () => {
  it("pastes a real image through the canonical byte path and suppresses its text representation", async () => {
    const e = paste([file()], "Screenshot.png"); await act(async () => upload.handlePaste(e)); await flush();
    expect(e.preventDefault).toHaveBeenCalledOnce(); expect(upload.attachedDoc).toMatchObject({ name: "Screenshot.png", kind: "image", base64: "AQID" });
  });
  it("leaves text, URLs and rich text without file payloads to native insertion", () => {
    for (const value of ["Contract language", "https://example.test/image.png", "<img src='remote.png'>"]) { const e = paste([], value); upload.handlePaste(e); expect(e.preventDefault).not.toHaveBeenCalled(); }
    expect(upload.attachedDoc).toBeNull();
  });
  it("does not treat clipboard filename text as an attachment", () => { const e = paste([], "Screenshot.png"); upload.handlePaste(e); expect(e.preventDefault).not.toHaveBeenCalled(); });
  it("also reads real clipboard file items when files is empty", async () => {
    const e = paste([]); Object.defineProperty(e.clipboardData, "items", { value: [{ kind: "file", getAsFile: () => file() }] });
    await act(async () => upload.handlePaste(e)); await flush(); expect(upload.attachedDoc?.kind).toBe("image");
  });
  it.each([["contract.pdf", "application/pdf", "pdf"], ["photo.jpg", "image/jpeg", "image"], ["photo.webp", "image/webp", "image"], ["contract.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx"]])("drops %s through the same processor", async (name, mime, kind) => {
    await act(async () => upload.handleDrop(drag([file(name, mime)]))); await flush(); expect(upload.attachedDoc).toMatchObject({ name, kind });
    if (kind === "docx") expect(upload.attachedDoc?.textContent).toBe("Extracted contract");
  });
  it("paperclip converges on the same processor and resets the picker", async () => {
    const target = { files: [file()], value: "selected" }; await act(async () => upload.handleFileSelect({ target } as unknown as React.ChangeEvent<HTMLInputElement>)); await flush();
    expect(target.value).toBe(""); expect(upload.attachedDoc?.base64).toBe("AQID");
  });
  it.each(["paste", "drop", "picker"])("%s uses canonical unsupported and 10MB errors", async route => {
    for (const f of [file("program.exe", "application/x-msdownload"), file("big.png", "image/png", 10 * 1024 * 1024 + 1)]) {
      await act(async () => { if (route === "paste") upload.handlePaste(paste([f])); else if (route === "drop") upload.handleDrop(drag([f])); else upload.handleFileSelect({ target: { files: [f], value: "x" } } as unknown as React.ChangeEvent<HTMLInputElement>); });
    }
    expect(h.toast.mock.calls.map(x => x[0].title)).toEqual(["Unsupported file type", "File too large"]); expect(upload.attachedDoc).toBeNull();
  });
  it("does not accept an unsupported explicit MIME disguised by a supported extension", async () => {
    await act(async () => upload.handlePaste(paste([file("fake.png", "application/x-msdownload")]))); expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Unsupported file type" }));
  });
  it("accepts an empty MIME extension fallback with the truthful image MIME", async () => { await act(async () => upload.handleDrop(drag([file("photo.jpeg", "")]))); await flush(); expect(upload.attachedDoc?.mimeType).toBe("image/jpeg"); });
  it("takes the first valid file and reports the one-attachment limit", async () => {
    await act(async () => upload.handleDrop(drag([file("bad.exe", "application/x-msdownload"), file("first.png"), file("second.png")]))); await flush();
    expect(upload.attachedDoc?.name).toBe("first.png"); expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "One attachment at a time" }));
  });
  it("multi-file paste has the same deterministic feedback", async () => { await act(async () => upload.handlePaste(paste([file("first.png"), file("second.png")]))); await flush(); expect(upload.attachedDoc?.name).toBe("first.png"); expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "One attachment at a time" })); });
  it("all-invalid multiple inputs explicitly accept none and keep canonical first-file refusal", async () => {
    await act(async () => upload.handleDrop(drag([file("bad.exe", "application/x-msdownload"), file("big.png", "image/png", 10 * 1024 * 1024 + 1)])));
    expect(upload.attachedDoc).toBeNull(); expect(h.toast.mock.calls.map(call => call[0].title)).toEqual(["One attachment at a time", "Unsupported file type"]);
    expect(h.toast.mock.calls[0][0].description).toBe("None of these files can be attached. Choose a supported file up to 10MB.");
  });
  it("keeps native text drag alone and has clean file enter/leave/drop states", async () => {
    const text = drag([], ["text/plain"]); await act(async () => upload.handleDragOver(text)); expect(text.preventDefault).not.toHaveBeenCalled(); expect(upload.isDragOver).toBe(false);
    await act(async () => upload.handleDragOver(drag())); expect(upload.isDragOver).toBe(true);
    await act(async () => upload.handleDragLeave(drag())); expect(upload.isDragOver).toBe(false);
    await act(async () => upload.handleDragOver(drag())); await act(async () => upload.handleDrop(drag([file()]))); await flush(); expect(upload.isDragOver).toBe(false);
  });
  it("does not flicker on a dragleave into a composer descendant", async () => {
    const child = document.createElement("span"); host.append(child); await act(async () => upload.handleDragOver(drag()));
    const e = drag(); Object.defineProperty(e, "relatedTarget", { value: child }); await act(async () => upload.handleDragLeave(e)); expect(upload.isDragOver).toBe(true);
  });
  it.each(["thread-b", "workspace-b", "client-b", "mission-b", null])("clears and fences a late file across scope %s", async scope => {
    let resolve!: (v: ArrayBuffer) => void; const f = file("late.png", "image/png", 3, () => new Promise(r => { resolve = r; }));
    await act(async () => upload.handleDrop(drag([f]))); expect(upload.isProcessingFile).toBe(true);
    await render(scope); expect(upload.attachedDoc).toBeNull(); expect(upload.isProcessingFile).toBe(false);
    await act(async () => resolve(new Uint8Array([9]).buffer)); await flush(); expect(upload.attachedDoc).toBeNull();
  });
  it("returning to the same scope cannot revive an old file", async () => {
    let resolve!: (v: ArrayBuffer) => void; await act(async () => upload.handleDrop(drag([file("old.png", "image/png", 3, () => new Promise(r => { resolve = r; }))])));
    await render("thread-b"); await render("thread-a"); await act(async () => resolve(new Uint8Array([9]).buffer)); await flush(); expect(upload.attachedDoc).toBeNull();
  });
  it("newer selection wins when old processing finishes later", async () => {
    let resolve!: (v: ArrayBuffer) => void; await act(async () => upload.handleDrop(drag([file("old.png", "image/png", 3, () => new Promise(r => { resolve = r; }))])));
    await act(async () => upload.handlePaste(paste([file("new.png")]))); await flush(); await act(async () => resolve(new Uint8Array([9]).buffer)); await flush(); expect(upload.attachedDoc?.name).toBe("new.png");
  });
  it("remove/clear invalidates processing and cannot resurrect a chip", async () => {
    let resolve!: (v: ArrayBuffer) => void; await act(async () => upload.handleDrop(drag([file("old.png", "image/png", 3, () => new Promise(r => { resolve = r; }))])));
    await act(async () => upload.setAttachedDoc(null)); await act(async () => resolve(new Uint8Array([9]).buffer)); await flush(); expect(upload.attachedDoc).toBeNull(); expect(upload.isProcessingFile).toBe(false);
  });
  it("unready scope guard refuses actual file paste/drop without affecting text paste", async () => {
    await render("thread-a", false); const text = paste([], "Keep typing"); upload.handlePaste(text); expect(text.preventDefault).not.toHaveBeenCalled();
    const f = file(); await act(async () => upload.handlePaste(paste([f]))); await act(async () => upload.handleDrop(drag([f]))); expect(f.arrayBuffer).not.toHaveBeenCalled(); expect(upload.attachedDoc).toBeNull();
  });
  it("a stale processing error after scope switch produces no foreign toast", async () => {
    let reject!: (e: Error) => void; await act(async () => upload.handleDrop(drag([file("old.png", "image/png", 3, () => new Promise((_, r) => { reject = r; }))])));
    await render("thread-b"); await act(async () => reject(new Error("old"))); await flush(); expect(h.toast).not.toHaveBeenCalled();
  });
  it("reload/remount has no unsent-file persistence", async () => { await act(async () => upload.handleDrop(drag([file()]))); await flush(); expect(upload.attachedDoc).not.toBeNull(); await act(async () => root.unmount()); root = createRoot(host); await render(); expect(upload.attachedDoc).toBeNull(); });
  it("replacement communicates its intent and invalid input keeps the existing chip", async () => {
    await act(async () => upload.handleDrop(drag([file("first.png")]))); await flush(); h.toast.mockClear();
    await act(async () => upload.handlePaste(paste([file("bad.exe", "application/x-msdownload")])));
    expect(upload.attachedDoc?.name).toBe("first.png"); expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Unsupported file type" }));
    await act(async () => upload.handlePaste(paste([file("second.png")]))); await flush(); expect(upload.attachedDoc?.name).toBe("second.png");
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Replacing attachment" }));
  });
  it("same-scope read failure preserves the draft attachment and canonical error", async () => {
    await act(async () => upload.handleDrop(drag([file("first.png")]))); await flush();
    await act(async () => upload.handlePaste(paste([file("bad.png", "image/png", 3, async () => { throw new Error("Unreadable"); })]))); await flush();
    expect(upload.attachedDoc?.name).toBe("first.png"); expect(upload.isProcessingFile).toBe(false);
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Error reading file" }));
  });
  it("empty DOCX uses the existing unreadable-document feedback", async () => {
    h.extract.mockResolvedValue({ value: "  " }); await act(async () => upload.handleDrop(drag([file("empty.docx", "")]))); await flush();
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Could not read DOCX" })); expect(upload.attachedDoc).toBeNull();
  });
  it("exactly 10MB remains accepted", async () => { await act(async () => upload.handleDrop(drag([file("at-limit.webp", "image/webp", 10 * 1024 * 1024)]))); await flush(); expect(upload.attachedDoc?.size).toBe(10 * 1024 * 1024); });
});

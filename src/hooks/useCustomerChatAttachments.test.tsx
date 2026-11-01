import {act} from "react";
import {createRoot, type Root} from "react-dom/client";
import {afterEach, beforeEach, expect, it, vi} from "vitest";
import {useCustomerChatAttachments} from "./useCustomerChatAttachments";

const f = vi.hoisted(() => ({
  transfer: vi.fn(), check: vi.fn(), stop: vi.fn(), current: vi.fn(), purposes: [] as unknown[],
  phase: "ready", epoch: 1, tenant: "e0993000-0000-4000-8000-000000000002",
  upload: {kind: "idle", id: null as string | null, notice: ""},
}));
vi.mock("./useClientDocuments", () => ({useClientDocuments: (purpose: unknown) => {
  f.purposes.push(purpose);
  return {phase: f.phase, epoch: f.epoch,
    scope: {actor: "e0993000-0000-4000-8000-000000000001", tenant: f.tenant, contact: "e0993000-0000-4000-8000-000000000003"},
    upload: f.upload, isCurrent: f.current, transfer: f.transfer, checkUpload: f.check, stopWaiting: f.stop};
}}));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const thread = "e0993000-0000-4000-8000-000000000004", other = "e0993000-0000-4000-8000-000000000005";
const pdf = (name = "Notes.pdf") => new File(["test"], name, {type: "application/pdf"});
let host: HTMLDivElement, root: Root, state: ReturnType<typeof useCustomerChatAttachments>;
const paints: {thread: string; available: boolean; ids: string[]; upload: string | null}[] = [];
function Probe({id, available}: {id: string; available: boolean}) {
  state = useCustomerChatAttachments(id, available);
  paints.push({thread: id, available, ids: state.files.map(file => file.id), upload: state.nativeUpload.id});
  return null;
}
const flush = async () => {for (let n = 0; n < 100; n++) await Promise.resolve();};
const render = (id = thread, available = true) => act(async () => {root.render(<Probe id={id} available={available}/>); await flush();});
const deferred = <T,>() => {let resolve!: (value: T) => void; const promise = new Promise<T>(r => {resolve = r;}); return {promise, resolve};};
beforeEach(() => {
  vi.clearAllMocks(); paints.length = 0; f.purposes = []; f.phase = "ready"; f.epoch = 1;
  f.tenant = "e0993000-0000-4000-8000-000000000002"; f.upload = {kind: "idle", id: null, notice: ""};
  f.current.mockReturnValue(true); f.check.mockResolvedValue(undefined);
  f.transfer.mockImplementation(async (_file, id) => {f.upload = {kind: "saved", id, notice: "Saved privately"}; return id;});
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => {act(() => root.unmount()); host.remove();});

it("conceals a local bulk choice during same-business rechecking and restores it without uploading", async () => {
  await render(); act(() => state.append([pdf("Harbor.pdf"), pdf("Willow.pdf")]));
  const ids = state.files.map(file => file.id);
  f.phase = "loading"; f.current.mockReturnValue(false); await render(thread, false);
  expect(state.files).toEqual([]); expect(f.transfer).not.toHaveBeenCalled();
  f.phase = "ready"; f.current.mockReturnValue(true); await render();
  expect(state.files.map(file => file.id)).toEqual(ids);
  expect(f.transfer).not.toHaveBeenCalled(); expect(f.check).not.toHaveBeenCalled();
});

it("keeps an admitted native picker completion private until its original access is checked again", async () => {
  await render(); const completeChoice = state.beginSelection();
  expect(completeChoice).not.toBeNull();
  f.phase = "loading"; f.current.mockReturnValue(false); await render(thread, false);
  act(() => completeChoice!([pdf("Harbor.pdf"), pdf("Willow.pdf")]));
  expect(state.files).toEqual([]); expect(f.transfer).not.toHaveBeenCalled();
  f.phase = "ready"; f.current.mockReturnValue(true); await render();
  expect(state.files.map(file => file.file.name)).toEqual(["Harbor.pdf", "Willow.pdf"]);
  expect(f.transfer).not.toHaveBeenCalled();
  act(() => completeChoice!([pdf("Duplicate.pdf")]));
  expect(state.files).toHaveLength(2);
});

it("rejects a picker completion after business/thread retirement, even after returning", async () => {
  await render(); const completeChoice = state.beginSelection();
  f.tenant = other; ++f.epoch; await render(other);
  f.tenant = "e0993000-0000-4000-8000-000000000002"; ++f.epoch; await render();
  act(() => completeChoice!([pdf("Old private choice.pdf")]));
  expect(state.files).toEqual([]); expect(f.transfer).not.toHaveBeenCalled();
  await render(thread, false); expect(state.beginSelection()).toBeNull();
});

it("requires inspecting an upload whose access retired before its completion, without starting the next file", async () => {
  const transfer = deferred<string>(); f.transfer.mockReturnValueOnce(transfer.promise);
  await render(); act(() => state.append([pdf("Harbor.pdf"), pdf("Willow.pdf")]));
  const id = state.files[0].id;
  let preparation!: Promise<unknown>;
  await act(async () => {preparation = state.prepare(); await flush();});
  f.current.mockReturnValue(false);
  await act(async () => {transfer.resolve(id); await preparation;});
  f.phase = "loading"; await render(thread, false);
  f.phase = "ready"; f.current.mockReturnValue(true); await render();
  expect(state.files.map(file => file.phase)).toEqual(["check", "selected"]);
  await act(async () => {expect(await state.prepare()).toEqual({status: "not_ready"});});
  expect(f.transfer).toHaveBeenCalledTimes(1); expect(f.check).not.toHaveBeenCalled();
});

it("selection is private preparation and sends nothing until explicit preparation", async () => {
  await render(); act(() => state.append([pdf(), pdf("Brief.pdf")]));
  const ids = state.files.map(file => file.id);
  expect(f.transfer).not.toHaveBeenCalled(); expect(ids).toHaveLength(2);
  let result: unknown; await act(async () => {result = await state.prepare();});
  expect(result).toEqual({status: "ready", ids});
  expect(f.transfer.mock.calls.map(call => call[1])).toEqual(ids);
  expect(state.files.every(file => file.phase === "saved")).toBe(true);
  expect(state.notice).toContain("not been sent");
  expect(f.purposes.every(p => JSON.stringify(p) === JSON.stringify({kind: "customer_private", threadId: thread}))).toBe(true);
});
it("pastes the original actual file list once, keeping bulk selection private and unsent", async () => {
  await render(); const files = [pdf("One.pdf"), pdf("Two.pdf")], preventDefault = vi.fn();
  const clipboardData = {files, items: files.map(file => ({kind: "file", getAsFile: () => file}))} as unknown as DataTransfer;
  act(() => state.handlePaste({clipboardData, preventDefault}));
  expect(preventDefault).toHaveBeenCalledOnce();
  expect(state.files.map(item => item.file)).toEqual(files);
  expect(f.transfer).not.toHaveBeenCalled();
});
it("leaves plain text, HTML and links to normal paste without fetching or creating a file", async () => {
  await render(); const preventDefault = vi.fn(), getData = vi.fn(() => "https://untrusted.invalid/file.pdf");
  const clipboardData = {files: [], items: [{kind: "string", type: "text/html"}], getData} as unknown as DataTransfer;
  act(() => state.handlePaste({clipboardData, preventDefault}));
  expect(state.files).toEqual([]); expect(preventDefault).not.toHaveBeenCalled();
  expect(getData).not.toHaveBeenCalled(); expect(f.transfer).not.toHaveBeenCalled();
});
it("falls back only to real file clipboard items and ignores null/non-file entries", async () => {
  await render(); const file = pdf(), preventDefault = vi.fn();
  const clipboardData = {files: [], items: [{kind: "file", getAsFile: () => file},
    {kind: "file", getAsFile: () => null}, {kind: "string", getAsFile: () => {throw Error("not a file");}}]} as unknown as DataTransfer;
  act(() => state.handlePaste({clipboardData, preventDefault}));
  expect(state.files.map(item => item.file)).toEqual([file]); expect(f.transfer).not.toHaveBeenCalled();
});
it("bulk drop uses the same selection while a stale or unavailable paste never crosses scope", async () => {
  await render(); const files = [pdf("One.pdf"), pdf("Two.pdf")];
  const dataTransfer = {files, items: [], types: ["Files"], dropEffect: "none"} as unknown as DataTransfer;
  const preventDefault = vi.fn(), stopPropagation = vi.fn();
  act(() => state.handleDrop({dataTransfer, preventDefault, stopPropagation}));
  expect(state.files.map(item => item.file)).toEqual(files); expect(preventDefault).toHaveBeenCalledOnce();
  const oldPaste = state.handlePaste; await render(other, false);
  act(() => oldPaste({clipboardData: dataTransfer, preventDefault}));
  act(() => state.handlePaste({clipboardData: dataTransfer, preventDefault}));
  expect(state.files).toEqual([]); expect(f.transfer).not.toHaveBeenCalled();
});
it("keeps the selection intact when a sixth file is pasted", async () => {
  await render(); act(() => state.append(Array.from({length: 5}, (_, n) => pdf(`${n}.pdf`))));
  const ids = state.files.map(file => file.id); act(() => state.append([pdf("Extra.pdf")]));
  expect(state.files.map(file => file.id)).toEqual(ids); expect(state.issues).toHaveLength(1);
  expect(f.transfer).not.toHaveBeenCalled();
});
it("reports invalid files without silently discarding permitted selections", async () => {
  await render(); act(() => state.append([new File(["test"], "Script.exe"), pdf()]));
  expect(state.files).toHaveLength(1); expect(state.issues[0].filename).toBe("Script.exe");
  expect(f.transfer).not.toHaveBeenCalled();
});
it("partial upload stops at uncertainty and recovers only the original identity", async () => {
  await render(); act(() => state.append([pdf("One.pdf"), pdf("Two.pdf"), pdf("Three.pdf")]));
  const ids = state.files.map(file => file.id), normal = f.transfer.getMockImplementation()!;
  f.transfer.mockImplementation((file, id) => {
    if (id === ids[1]) {f.upload = {kind: "uncertain", id, notice: "Check saved status"}; return undefined;}
    return normal(file, id);
  });
  let result: unknown; await act(async () => {result = await state.prepare();});
  expect(result).toEqual({status: "not_ready"});
  expect(state.files.map(file => file.phase)).toEqual(["saved", "check", "selected"]);
  await act(async () => {await state.prepare();}); expect(f.transfer).toHaveBeenCalledTimes(2);
  f.check.mockImplementation(async () => {f.upload = {kind: "saved", id: ids[1], notice: "Saved"}; return ids[1];});
  await act(async () => {await state.check(ids[1]);});
  expect(f.transfer).toHaveBeenCalledTimes(2); expect(state.files[1].phase).toBe("saved");
  await act(async () => {result = await state.prepare();});
  expect(result).toEqual({status: "ready", ids});
  expect(f.transfer.mock.calls.map(call => call[1])).toEqual(ids);
});
it("requires a checked native retry/finish state before resuming the same upload", async () => {
  await render(); act(() => state.append([pdf()])); const id = state.files[0].id;
  f.transfer.mockImplementation(async () => {f.upload = {kind: "uncertain", id, notice: "Unknown"};});
  await act(async () => {await state.prepare();});
  await act(async () => {expect(await state.resume(id)).toBe(false);});
  expect(f.transfer).toHaveBeenCalledTimes(1);
  f.check.mockImplementation(async () => {f.upload = {kind: "retry", id, notice: "Retry the same original"};});
  await act(async () => {await state.check(id);});
  f.transfer.mockResolvedValue(id); await act(async () => {expect(await state.resume(id)).toBe(true);});
  expect(f.transfer.mock.calls.map(call => call[1])).toEqual([id, id]);
  expect(state.files[0].phase).toBe("saved");
});
it("stopping waiting never promotes a late result or starts the next file", async () => {
  await render(); act(() => state.append([pdf(), pdf("Next.pdf")])); const id = state.files[0].id;
  const pending = deferred<string>(); f.transfer.mockImplementation(() => {f.upload = {kind: "working", id, notice: "Uploading"}; return pending.promise;});
  let operation!: ReturnType<typeof state.prepare>; act(() => {operation = state.prepare();}); await act(flush);
  act(() => state.stop()); let result: unknown; await act(async () => {result = await operation;});
  expect(result).toEqual({status: "not_ready"}); expect(f.stop).toHaveBeenCalledTimes(1);
  await act(async () => {pending.resolve(id); await flush();});
  expect(state.files.map(file => file.phase)).toEqual(["check", "selected"]);
  expect(f.transfer).toHaveBeenCalledTimes(1); expect(state.busy).toBe(false);
});
it("stopping before dispatch keeps a selected file usable without inventing an uncertain upload", async () => {
  await render(); act(() => state.append([pdf()]));
  let operation!: ReturnType<typeof state.prepare>;
  act(() => {operation = state.prepare(); state.stop();});
  await act(async () => {expect(await operation).toEqual({status: "not_ready"});});
  expect(f.transfer).not.toHaveBeenCalled(); expect(f.stop).not.toHaveBeenCalled();
  expect(state.files[0].phase).toBe("selected");
  await act(async () => {expect((await state.prepare()).status).toBe("ready");});
  expect(f.transfer).toHaveBeenCalledTimes(1);
});
it("concurrent preparation cannot change the selection or duplicate a transfer", async () => {
  await render(); act(() => state.append([pdf()])); const id = state.files[0].id, pending = deferred<string>();
  f.transfer.mockReturnValue(pending.promise);
  let operation!: ReturnType<typeof state.prepare>; act(() => {operation = state.prepare();}); await act(flush);
  act(() => {state.append([pdf("Extra.pdf")]); state.remove(id);});
  await act(async () => {expect(await state.prepare()).toEqual({status: "not_ready"});});
  expect(state.files.map(file => file.id)).toEqual([id]); expect(f.transfer).toHaveBeenCalledTimes(1);
  await act(async () => {pending.resolve(id); await operation;});
});
it("retired callbacks stay retired after a thread changes away and back", async () => {
  await render(); const old = state; await render(other); await render();
  act(() => old.append([pdf()])); await act(async () => {expect(await old.prepare()).toEqual({status: "changed"});});
  expect(state.files).toEqual([]); expect(f.transfer).not.toHaveBeenCalled();
});
it("a business change during transfer hides old identity on its first paint", async () => {
  await render(); act(() => state.append([pdf()])); const id = state.files[0].id, pending = deferred<string>();
  f.transfer.mockImplementation(() => {f.upload = {kind: "working", id, notice: "Uploading"}; return pending.promise;});
  let operation!: ReturnType<typeof state.prepare>; act(() => {operation = state.prepare();}); await act(flush);
  paints.length = 0; f.tenant = other; ++f.epoch; await render(other);
  expect(paints.every(p => p.ids.length === 0 && p.upload === null)).toBe(true);
  await act(async () => {pending.resolve(id); expect(await operation).toEqual({status: "changed"});});
  expect(state.files).toEqual([]); expect(f.transfer).toHaveBeenCalledTimes(1);
});
it("unavailable presentation cannot select files or reveal an old upload identity", async () => {
  await render(); act(() => state.append([pdf()])); await act(async () => {await state.prepare();});
  paints.length = 0; await render(thread, false);
  expect(paints.every(p => p.ids.length === 0 && p.upload === null)).toBe(true);
  act(() => state.append([pdf()])); expect(state.files).toEqual([]);
  await act(async () => {expect(await state.prepare()).toEqual({status: "changed"});});
});
it("a substituted saved identity never becomes part of a ready message manifest", async () => {
  await render(); act(() => state.append([pdf()])); f.transfer.mockResolvedValue(other);
  await act(async () => {expect(await state.prepare()).toEqual({status: "not_ready"});});
  expect(state.files[0].phase).toBe("check");
  act(() => {expect(state.releaseSentSelection([other])).toBe(false);});
});
it("clears only an exact saved selection and never deletes the stored files", async () => {
  await render(); act(() => state.append([pdf(), pdf("Two.pdf")])); const ids = state.files.map(file => file.id);
  act(() => {expect(state.releaseSentSelection(ids)).toBe(false);});
  await act(async () => {await state.prepare();});
  act(() => {expect(state.releaseSentSelection([...ids].reverse())).toBe(false);});
  expect(state.files).toHaveLength(2);
  act(() => {expect(state.releaseSentSelection(ids)).toBe(true);}); expect(state.files).toEqual([]);
});

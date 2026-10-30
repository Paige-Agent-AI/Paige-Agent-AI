import {act, type ComponentProps} from "react";
import {createRoot, type Root} from "react-dom/client";
import {afterEach, beforeEach, expect, it, vi} from "vitest";
import {CustomerChatAttachments} from "./CustomerChatAttachments";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
type Props = ComponentProps<typeof CustomerChatAttachments>;
let host: HTMLDivElement, root: Root, props: Props;
const draft = (id = "file-one", phase: Props["files"][number]["phase"] = "selected", name = "Private notes.pdf"): Props["files"][number] => ({
  id, phase, mime: "application/pdf", file: new File(["test"], name, {type: "application/pdf"}),
});
const render = () => act(() => root.render(<CustomerChatAttachments {...props}/>));
const button = (name: string) => [...host.querySelectorAll("button")].find(b => b.getAttribute("aria-label") === name || b.textContent === name)!;
beforeEach(() => {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  props = {enabled: true, files: [], issues: [], busy: false, notice: "", upload: {id: null, kind: "idle"},
    onSelect: vi.fn(), onRemove: vi.fn(), onCheck: vi.fn(), onResume: vi.fn(), onStop: vi.fn()};
});
afterEach(() => {act(() => root.unmount()); host.remove();});

it("passes an explicit bulk choice to local selection without a send or a recovery action", () => {
  render(); const input = host.querySelector("input")!, files = [draft().file, draft("two", "selected", "Brief.docx").file];
  expect(input.multiple).toBe(true);
  Object.defineProperty(input, "files", {value: files});
  act(() => input.dispatchEvent(new Event("change", {bubbles: true})));
  expect(props.onSelect).toHaveBeenCalledWith(files);
  expect(props.onRemove).not.toHaveBeenCalled(); expect(props.onCheck).not.toHaveBeenCalled(); expect(props.onResume).not.toHaveBeenCalled();
});
it("requires checking the original unknown upload before exposing its permitted resume", () => {
  props.files = [draft("original", "check")]; props.upload = {id: "original", kind: "uncertain"}; render();
  expect(button("Add files").disabled).toBe(true); expect(button("Resume")).toBeUndefined();
  expect(button("Remove Private notes.pdf from message")).toBeUndefined();
  act(() => button("Check upload of Private notes.pdf").click()); expect(props.onCheck).toHaveBeenCalledWith("original");
  props.upload = {id: "other", kind: "retry"}; render(); expect(button("Resume")).toBeUndefined();
  props.upload = {id: "original", kind: "finish"}; render();
  act(() => button("Resume upload of Private notes.pdf").click()); expect(props.onResume).toHaveBeenCalledWith("original");
});
it("stops waiting while a file is saving without offering removal or cancellation promises", () => {
  props.files = [draft("original", "saving")]; props.busy = true; render();
  expect(button("Add files").disabled).toBe(true); expect(button("Remove Private notes.pdf from message").disabled).toBe(true);
  act(() => button("Stop waiting").click()); expect(props.onStop).toHaveBeenCalledOnce();
  expect(props.onRemove).not.toHaveBeenCalled(); expect(host.querySelector("section")?.getAttribute("aria-busy")).toBe("true");
});
it("saved files stay explicitly private and can be removed from the selection", () => {
  props.files = [draft("original", "saved")]; render();
  expect(host.textContent).toContain("Saved privately"); expect(host.textContent).toContain("Saving a file does not send your message");
  act(() => button("Remove Private notes.pdf from message").click()); expect(props.onRemove).toHaveBeenCalledWith("original");
});
it("an unavailable customer presentation immediately conceals previous names, issues and upload status", () => {
  props.files = [draft()]; props.issues = [{filename: "Private rejected.exe", message: "Try another file"}]; props.notice = "Private original upload status";
  render(); props.enabled = false; render();
  expect(host.textContent).not.toContain("Private"); expect(host.querySelector('ul[aria-label="Selected private files"]')).toBeNull();
  expect(button("Add files").disabled).toBe(true);
  const input = host.querySelector("input")!; Object.defineProperty(input, "files", {value: [draft().file]});
  act(() => input.dispatchEvent(new Event("change", {bubbles: true}))); expect(props.onSelect).not.toHaveBeenCalled();
});
it("five long filenames retain complete accessible remove names inside one focusable list", () => {
  props.files = Array.from({length: 5}, (_, i) => draft(`file-${i}`, "selected", `${"Long private filename ".repeat(10)}${i}.pdf`)); render();
  const list = host.querySelector('ul[aria-label="Selected private files"]')!;
  expect(list.getAttribute("tabindex")).toBe("0"); expect(list.querySelectorAll("li")).toHaveLength(5);
  for (const file of props.files) expect(button(`Remove ${file.file.name} from message`)).toBeDefined();
  expect(button("Add files").disabled).toBe(true); expect(host.textContent).toContain("5 of 5 files");
});

it("a confirmed local removal keeps keyboard focus on the next file, then Add files", () => {
  props.files = [draft("one", "selected", "One.pdf"), draft("two", "selected", "Two.pdf")]; render();
  button("Remove One.pdf from message").focus();
  act(() => button("Remove One.pdf from message").click());
  props.files = props.files.slice(1); render();
  expect(document.activeElement).toBe(button("Remove Two.pdf from message"));
  act(() => button("Remove Two.pdf from message").click()); props.files = []; render();
  expect(document.activeElement).toBe(button("Add files"));
});

it("restores focus to the same file after a successful Resume removes its old button",()=>{
 props.files=[draft("original","check")];props.upload={id:"original",kind:"finish"};render();
 const resume=button("Resume upload of Private notes.pdf");resume.focus();act(()=>resume.click());
 props.busy=true;render();props.files=[draft("original","saved")];props.busy=false;render();
 expect(document.activeElement).toBe(button("Remove Private notes.pdf from message"));
});
it("returns a previously admitted picker choice to its captured handler during an access recheck", () => {
  const complete = vi.fn(), begin = vi.fn(() => complete);
  Object.assign(props, {onBeginSelection: begin}); render();
  const input = host.querySelector("input")!, files = [draft().file, draft("two", "selected", "Willow.pdf").file];
  act(() => input.dispatchEvent(new MouseEvent("click", {bubbles: true})));
  props.enabled = false; props.onSelect = vi.fn(); render();
  Object.defineProperty(input, "files", {value: files});
  act(() => input.dispatchEvent(new Event("change", {bubbles: true})));
  expect(begin).toHaveBeenCalledTimes(1); expect(complete).toHaveBeenCalledWith(files);
  expect(props.onSelect).not.toHaveBeenCalled();
});

it("keeps a legacy presentation callback blocked when access is withdrawn while its picker is open", () => {
  render(); const input = host.querySelector("input")!, original = props.onSelect;
  act(() => input.dispatchEvent(new MouseEvent("click", {bubbles: true})));
  props.enabled = false; render();
  Object.defineProperty(input, "files", {value: [draft().file]});
  act(() => input.dispatchEvent(new Event("change", {bubbles: true})));
  expect(original).not.toHaveBeenCalled();
});

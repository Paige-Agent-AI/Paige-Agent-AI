import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ClientFiles } from "./ClientFiles";

const actor = "e0914000-0000-4000-8000-0000000000a1", tenant = "e0924000-0000-4000-8000-0000000000a1", contact = "e0934000-0000-4000-8000-0000000000a1";
type Row = Record<string, unknown> & { id: string; visibility: string; upload_state: string; updated_at: string };
const f = vi.hoisted(() => ({ rpc: vi.fn(), upload: vi.fn(), sign: vi.fn(), rows: [] as Row[], connected: true, reads: 0, sessionUser: "" }));
vi.mock("@/hooks/useTenantContext", () => ({ useTenantContext: () => ({ activeTenantId: tenant, activeUserId: actor, accountContextLoading: false }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  auth: { getSession: async () => ({ data: { session: { user: { id: f.sessionUser || actor } } }, error: null }) },
  rpc: (...a: unknown[]) => f.rpc(...a),
  storage: { from: () => ({ upload: (...a: unknown[]) => f.upload(...a), createSignedUrl: (...a: unknown[]) => f.sign(...a) }) },
} }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ownerRow = (r: Row) => ({ id: r.id, filename: r.filename, mime_type: r.mime_type, size_bytes: r.size_bytes, visibility: r.visibility, upload_state: r.upload_state,
  source: r.visibility === "client_upload" ? "client" : "business", shared_at: r.visibility === "shared" ? "2026-01-04T00:00:00Z" : null,
  created_at: r.created_at, updated_at: r.updated_at, storage_path: r.storage_path });
const file = (n: number, visibility = "internal", over: Partial<Row> = {}): Row => ({ id: `e0944000-0000-4000-8000-${String(n).padStart(12, "0")}`, filename: `File ${n}.pdf`,
  mime_type: "application/pdf", size_bytes: 2048, visibility, upload_state: "ready", created_at: "2026-01-02T00:00:00Z", updated_at: `2026-01-02T00:00:0${n}Z`,
  storage_path: `${tenant}/${contact}/${visibility === "client_upload" ? `client_upload/${actor}` : "internal"}/e0944000-0000-4000-8000-${String(n).padStart(12, "0")}`, ...over });
const list = () => ({ ok: true, contact_id: contact, portal_connected: f.connected, files: f.rows.map(ownerRow), has_more: false });

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.clearAllMocks(); f.connected = true; f.reads = 0; f.sessionUser = "";
  f.rows = [file(1, "shared"), file(2, "internal"), file(3, "client_upload", { filename: "Signed intake.pdf" })];
  f.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
    if (name === "client_file_owner_list") { f.reads++; return { data: list(), error: null }; }
    if (name === "client_file_set_client_share") {
      const row = f.rows.find(r => r.id === args.p_file_id)!;
      if (row.updated_at !== args.p_expected_updated_at) return { data: { ok: false, error: "FILE_CHANGED", updated_at: row.updated_at }, error: null };
      row.visibility = args.p_shared ? "shared" : "internal"; row.updated_at = "2026-01-05T00:00:00Z";
      return { data: { ok: true, replayed: false, file_id: row.id, shared: args.p_shared, shared_at: null, updated_at: row.updated_at, portal_connected: f.connected }, error: null };
    }
    if (name === "client_file_owner_begin_upload") {
      const id = String(args.p_file_id);
      if (!f.rows.some(r => r.id === id)) f.rows.push({ ...file(9), id, filename: String(args.p_filename), upload_state: "pending", storage_path: `${tenant}/${contact}/internal/${id}`, created_at: "2026-01-06T00:00:00Z" });
      return { data: { ok: true, file: ownerRow(f.rows.find(r => r.id === id)!) }, error: null };
    }
    if (name === "client_file_owner_finish_upload") {
      const row = f.rows.find(r => r.id === args.p_file_id)!; row.upload_state = "ready";
      return { data: { ok: true, replayed: false, file: ownerRow(row) }, error: null };
    }
    throw new Error(`unexpected rpc ${name}`);
  });
  f.upload.mockResolvedValue({ data: { path: "stored" }, error: null });
  f.sign.mockResolvedValue({ data: { signedUrl: "https://storage.invalid/signed" }, error: null });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); });
const flush = async () => act(async () => { for (let i = 0; i < 60; i++) await Promise.resolve(); });
const render = async (connected = true, portalAccess?: "open" | "paused" | "ended") => { await act(async () => root.render(<ClientFiles contactId={contact} clientName="Jordan Rivera" portalConnected={connected} portalAccess={portalAccess} />)); await flush(); };
const switchFor = (name: string) => host.querySelector<HTMLButtonElement>(`[aria-label="Share ${name} with Jordan Rivera"]`);
const button = (label: string) => Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(b => b.textContent?.trim() === label)!;
const choose = async (name = "Proposal.pdf", type = "application/pdf") => {
  const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "files", { configurable: true, value: [new File(["%PDF-test"], name, { type })] });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true }))); await flush();
};

it("reads this client's files pinned to the actor, workspace and client, in three sections", async () => {
  await render();
  expect(f.rpc).toHaveBeenCalledWith("client_file_owner_list", { p_expected_actor_id: actor, p_expected_tenant_id: tenant, p_contact_id: contact, p_limit: 100, p_before: null, p_before_id: null });
  const headings = Array.from(host.querySelectorAll("h4")).map(h => h.textContent);
  expect(headings).toEqual(["Shared with Jordan 1", "From Jordan 1", "Private to your team 1"]);
  expect(host.textContent).toContain("Jordan Rivera sees only files you share. New files stay private.");
});
it("gives the client's own uploads no share switch", async () => {
  await render();
  expect(switchFor("File 1.pdf")).not.toBeNull();
  expect(switchFor("File 2.pdf")).not.toBeNull();
  expect(switchFor("Signed intake.pdf")).toBeNull();
});
it("sends the row version it is looking at, and reports success only after a fresh read confirms it", async () => {
  await render();
  const reads = f.reads;
  await act(async () => switchFor("File 2.pdf")!.click()); await flush();
  expect(f.rpc).toHaveBeenCalledWith("client_file_set_client_share", { p_expected_actor_id: actor, p_expected_tenant_id: tenant,
    p_file_id: f.rows[1].id, p_shared: true, p_expected_updated_at: "2026-01-02T00:00:02Z" });
  expect(f.reads).toBe(reads + 1);
  expect(host.textContent).toContain("Shared. Jordan Rivera can open it in their portal.");
  expect(Array.from(host.querySelectorAll("h4")).map(h => h.textContent)[0]).toBe("Shared with Jordan 2");
});
it("does not claim success when the fresh read disagrees with the writer", async () => {
  await render();
  const canonical = f.rpc.getMockImplementation()!;
  f.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
    const result = await canonical(name, args);
    if (name === "client_file_set_client_share") f.rows[1].visibility = "internal"; // the write did not stick
    return result;
  });
  await act(async () => switchFor("File 2.pdf")!.click()); await flush();
  expect(host.textContent).not.toContain("Shared. Jordan");
  expect(host.textContent).toContain("couldn’t confirm");
});
it("shows the switch as pending while the change is in flight", async () => {
  await render();
  let release!: () => void;
  const canonical = f.rpc.getMockImplementation()!;
  f.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
    if (name === "client_file_set_client_share") await new Promise<void>(r => { release = r; });
    return canonical(name, args);
  });
  act(() => switchFor("File 2.pdf")!.click()); await flush();
  expect(host.textContent).toContain("Sharing…");
  expect(switchFor("File 2.pdf")!.disabled).toBe(true);
  await act(async () => release()); await flush();
});
it("on FILE_CHANGED, reads again and says so", async () => {
  await render();
  f.rows[1].updated_at = "2026-01-09T00:00:00Z"; // changed elsewhere after this list was read
  const reads = f.reads;
  await act(async () => switchFor("File 2.pdf")!.click()); await flush();
  expect(f.reads).toBe(reads + 1);
  expect(host.textContent).toContain("This file changed. Check it and share again.");
  expect(f.rows[1].visibility).toBe("internal");
});
it("adds a file privately: begin → store → finish → a fresh read shows it saved and private", async () => {
  await render();
  await choose("Proposal.pdf");
  const begin = f.rpc.mock.calls.find(([n]) => n === "client_file_owner_begin_upload")![1] as Record<string, unknown>;
  expect(begin).toMatchObject({ p_expected_actor_id: actor, p_expected_tenant_id: tenant, p_contact_id: contact, p_filename: "Proposal.pdf", p_mime_type: "application/pdf" });
  expect(Object.keys(begin)).not.toContain("p_visibility");
  expect(f.upload).toHaveBeenCalledWith(`${tenant}/${contact}/internal/${begin.p_file_id}`, expect.any(File), { contentType: "application/pdf", upsert: false });
  expect(f.rpc).toHaveBeenCalledWith("client_file_owner_finish_upload", { p_expected_actor_id: actor, p_expected_tenant_id: tenant, p_file_id: begin.p_file_id });
  expect(host.textContent).toContain("Proposal.pdf is saved. It’s private to your team until you share it.");
  expect(Array.from(host.querySelectorAll("h4")).map(h => h.textContent)[2]).toBe("Private to your team 2");
});
it("refuses a file type before anything is reserved", async () => {
  await render();
  await choose("Notes.html", "text/html");
  expect(f.rpc.mock.calls.some(([n]) => n === "client_file_owner_begin_upload")).toBe(false);
  expect(host.textContent).toContain("Choose a PDF, JPG, PNG or DOCX file up to 20 MB.");
});
it("holds an unconfirmed upload, then checks it without a second file or reservation", async () => {
  await render();
  const canonical = f.rpc.getMockImplementation()!;
  let lose = true;
  f.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
    const result = await canonical(name, args);
    if (name === "client_file_owner_finish_upload" && lose) { lose = false; throw new Error("reply lost"); }
    return result;
  });
  await choose("Proposal.pdf");
  expect(host.textContent).toContain("We couldn’t confirm Proposal.pdf was saved. Check before trying again.");
  await act(async () => button("Check saved upload").click()); await flush();
  expect(host.textContent).toContain("Proposal.pdf is saved.");
  const ids = f.rpc.mock.calls.filter(([n]) => n === "client_file_owner_begin_upload").map(([, a]) => (a as Record<string, unknown>).p_file_id);
  expect(new Set(ids).size).toBe(1);
});
const fakeTab = () => {
  const tab = { closed: false, opener: {} as unknown, location: { replace: vi.fn() }, close: vi.fn(() => { tab.closed = true; }) };
  return tab;
};
const openFile = async (name = "File 1.pdf") => { await act(async () => host.querySelector<HTMLButtonElement>(`[aria-label="Open ${name}"]`)!.click()); await flush(); };
it("opens the tab inside the click, then points it at a one-minute signed link", async () => {
  const tab = fakeTab();
  const open = vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
  await render();
  await openFile();
  // Opened synchronously, before any await, so a popup blocker treats it as the click's own window.
  expect(open).toHaveBeenCalledWith("", "_blank");
  expect(tab.opener).toBeNull();
  expect(f.sign).toHaveBeenCalledWith(f.rows[0].storage_path, 60);
  expect(tab.location.replace).toHaveBeenCalledWith("https://storage.invalid/signed");
  expect(host.textContent).toContain("Opened in a new tab. The link works for one minute.");
});
it("never claims a tab opened when the browser blocked it: it shows the link to click instead", async () => {
  vi.spyOn(window, "open").mockReturnValue(null);
  await render();
  await openFile();
  expect(host.textContent).not.toContain("Opened in a new tab");
  expect(host.textContent).toContain("Your browser didn’t open a new tab. Use this link within one minute:");
  const link = host.querySelector<HTMLAnchorElement>('.trc-files-note a')!;
  expect(link.getAttribute("href")).toBe("https://storage.invalid/signed");
  expect(link.target).toBe("_blank");
  expect(link.rel).toBe("noopener noreferrer");
  expect(link.textContent).toBe("Open File 1.pdf");
});
it("closes the waiting tab and says why when the link can't be made", async () => {
  const tab = fakeTab();
  vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
  f.sign.mockResolvedValue({ data: null, error: { message: "denied" } });
  await render();
  await openFile();
  expect(tab.close).toHaveBeenCalled();
  expect(host.textContent).not.toContain("Opened in a new tab");
  expect(host.textContent).toContain("This file couldn’t be opened. Try again.");
});
it("says the workspace changed — never an empty note — when the account moves before a file opens", async () => {
  const tab = fakeTab();
  vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
  await render();
  f.sessionUser = "e0914000-0000-4000-8000-0000000000ff";
  await openFile();
  expect(tab.close).toHaveBeenCalled();
  expect(f.sign).not.toHaveBeenCalled();
  expect(host.querySelector(".trc-files-note")?.textContent).toBe("Your workspace changed. Refresh to see this client’s files.");
});
it("reports an account change as a change, not as a permission refusal", async () => {
  f.sessionUser = "e0914000-0000-4000-8000-0000000000ff";
  await render();
  expect(host.textContent).toContain("Your workspace changed. Refresh to see this client’s files.");
  expect(host.textContent).not.toContain("Only the business owner or an admin");
  expect(f.rpc.mock.calls.some(([n]) => n === "client_file_owner_list")).toBe(false);
  f.sessionUser = "";
  await act(async () => button("Refresh").click()); await flush();
  expect(host.textContent).toContain("File 1.pdf");
});
it("offers to share the file just added, right where the upload was reported", async () => {
  await render();
  await choose("Proposal.pdf");
  const begin = f.rpc.mock.calls.find(([n]) => n === "client_file_owner_begin_upload")![1] as Record<string, unknown>;
  await act(async () => button("Share with Jordan").click()); await flush();
  expect(f.rpc).toHaveBeenCalledWith("client_file_set_client_share", expect.objectContaining({ p_file_id: begin.p_file_id, p_shared: true }));
  expect(host.textContent).toContain("Shared. Jordan Rivera can open it in their portal.");
  expect(host.textContent).not.toContain("Proposal.pdf is saved.");
  expect(Array.from(host.querySelectorAll("h4")).map(h => h.textContent)[0]).toBe("Shared with Jordan 2");
});
it("marks shared, from-the-client and private rows with different icons", async () => {
  await render();
  const kinds = Array.from(host.querySelectorAll(".trc-files-icon")).map(icon => icon.getAttribute("data-kind"));
  expect(kinds).toEqual(["shared", "client", "private"]);
  const drawn = Array.from(host.querySelectorAll(".trc-files-icon")).map(icon => icon.getAttribute("class"));
  expect(new Set(drawn).size).toBe(3);
});
it("keeps one header layout: Refresh sits in the header whether the list is empty or not", async () => {
  f.rows = []; await render();
  const emptyHead = Array.from(host.querySelectorAll(".trc-files-head > *")).map(el => el.className);
  expect(host.querySelector(".trc-files-head .trc-files-refresh")).not.toBeNull();
  await act(async () => root.unmount()); root = createRoot(host);
  f.rows = [file(1, "shared")]; await render();
  const populatedHead = Array.from(host.querySelectorAll(".trc-files-head > *")).map(el => el.className);
  expect(populatedHead).toEqual(emptyHead);
  expect(host.querySelector(".trc-files-head .trc-files-refresh")).not.toBeNull();
});
it("says when the client hasn't joined the portal yet", async () => {
  f.connected = false; await render(false);
  expect(host.textContent).toContain("Jordan Rivera hasn’t joined your portal yet; shared files appear when they do.");
});
// E09 Slice 7 round 2 (compliance 1): a paused client keeps the login link, so "linked" is not "can see".
// The card names paused and ended, and never confirms a share as something the client can open now —
// even against a server that still reports the link alone (portal_connected true while paused).
it.each([
  ["paused", "Paused — Jordan can’t see shared files right now. They show again if you restore their access.", "Shared. Jordan will see it if you restore their access."],
  ["ended", "Jordan’s portal access has ended, so they can’t see shared files. They show again if you invite them back and they accept.", "Shared. Jordan will see it if you invite them back and they accept."],
] as const)("says access is %s instead of 'can open it', and confirms a share truthfully", async (state, line, confirmation) => {
  f.connected = true; // the link alone (an older answer) must not win over the record's access state
  await render(state === "paused", state);
  expect(host.textContent).toContain(line);
  expect(host.textContent).not.toContain("hasn’t joined your portal yet");
  await act(async () => switchFor("File 2.pdf")!.click()); await flush();
  expect(host.textContent).toContain(confirmation);
  expect(host.textContent).not.toContain("can open it in their portal");
});
it("follows the server when it reports the client cannot open the portal, even if the record looked open", async () => {
  await render(true, "open");
  f.connected = false;
  await act(async () => switchFor("File 2.pdf")!.click()); await flush();
  expect(host.textContent).toContain("Shared. Jordan will see it once they join your portal.");
});
it.each([
  ["a member who isn't an owner or admin", { data: null, error: { code: "42501", message: "FILE_SCOPE_CHANGED" } }, "Only the business owner or an admin can see and share Jordan Rivera’s files."],
  ["a top-level agency", { data: { ok: false, error: "CLIENT_FILES_UNAVAILABLE" }, error: null }, "Client files aren’t available for this account."],
  ["an inactive client", { data: { ok: false, error: "CONTACT_NOT_FOUND" }, error: null }, "record isn’t active"],
])("explains the refusal for %s", async (_label, reply, text) => {
  f.rpc.mockResolvedValue(reply); await render();
  expect(host.textContent).toContain(text);
  expect(host.querySelector('[role="switch"]')).toBeNull();
});
it("shows an empty state with Add a file", async () => {
  f.rows = []; await render();
  expect(host.textContent).toContain("No files for Jordan Rivera yet.");
  expect(button("Add a file")).toBeTruthy();
});
it("refuses a list that carries a key the server never promised", async () => {
  f.rpc.mockResolvedValue({ data: { ...list(), files: [{ ...ownerRow(f.rows[0]), description: "internal note" }] }, error: null });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  await render();
  expect(host.textContent).toContain("We couldn’t read Jordan Rivera’s files.");
  expect(host.textContent).not.toContain("File 1.pdf");
});

// ── "Load more" (round 3, compliance S5): the server pages by (created_at, id) after the last file shown.
/** The server's keyset over f.rows: newest first, ties by id, strictly after the cursor, 100 a page. */
const keysetList = (args: Record<string, unknown>) => {
  const key = (r: Row) => `${r.created_at}|${r.id}`;
  const cursor = args.p_before ? `${args.p_before}|${args.p_before_id}` : null;
  const ordered = [...f.rows].sort((a, b) => key(b).localeCompare(key(a))).filter(r => !cursor || key(r) < cursor);
  return { ok: true, contact_id: contact, portal_connected: f.connected, files: ordered.slice(0, 100).map(ownerRow), has_more: ordered.length > 100 };
};
const manyFiles = () => Array.from({ length: 103 }, (_, i) => file(i + 10, i % 2 ? "internal" : "shared", { updated_at: "2026-03-01T00:00:00Z",
  // The three oldest share one instant, and the page boundary falls inside that tie.
  created_at: i < 98 ? `2026-02-${String(28 - Math.floor(i / 4)).padStart(2, "0")}T00:00:0${i % 4}Z` : "2026-01-01T00:00:00Z" }));
const useKeyset = () => {
  const base = f.rpc.getMockImplementation()!;
  const listCalls: Record<string, unknown>[] = [];
  f.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
    if (name === "client_file_owner_list") { f.reads++; listCalls.push(args); return { data: keysetList(args), error: null }; }
    return base(name, args);
  });
  return listCalls;
};
const rowsShown = () => host.querySelectorAll(".trc-files-row:not(.trc-files-skeleton)").length;

it("loads older files after the last one shown, keeping files saved in the same instant", async () => {
  f.rows = manyFiles();
  const calls = useKeyset();
  await render();
  expect(rowsShown()).toBe(100);
  expect(host.textContent).toContain("Showing the newest 100 files.");
  await act(async () => button("Load more").click()); await flush();
  const lastShown = keysetList({}).files[99];
  expect(calls.at(-1)).toMatchObject({ p_before: lastShown.created_at, p_before_id: lastShown.id, p_limit: 100 });
  expect(rowsShown()).toBe(103);
  expect(new Set(Array.from(host.querySelectorAll(".trc-files-item strong")).map(e => e.textContent)).size).toBe(103);
  expect(Array.from(host.querySelectorAll("button")).some(b => b.textContent?.trim() === "Load more")).toBe(false);
  expect(host.textContent).not.toContain("Showing the newest");
});
it("confirms a share of an older file with a fresh read that covers every page shown", async () => {
  f.rows = manyFiles();
  const calls = useKeyset();
  await render();
  await act(async () => button("Load more").click()); await flush();
  const older = keysetList({ p_before: keysetList({}).files[99].created_at, p_before_id: keysetList({}).files[99].id }).files.find(r => r.visibility === "internal")!;
  const before = calls.length;
  await act(async () => switchFor(older.filename as string)!.click()); await flush();
  expect(calls.slice(before).map(c => c.p_before_id ?? null)).toEqual([null, keysetList({}).files[99].id]);
  expect(host.textContent).toContain("Shared. Jordan Rivera can open it in their portal.");
  expect(rowsShown()).toBe(103);
});
it("says so when older files can't be loaded, and keeps the list on screen", async () => {
  f.rows = manyFiles();
  useKeyset();
  await render();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  const base = f.rpc.getMockImplementation()!;
  f.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) =>
    name === "client_file_owner_list" && args.p_before ? { data: null, error: { code: "PGRST000", message: "upstream" } } : base(name, args));
  await act(async () => button("Load more").click()); await flush();
  expect(rowsShown()).toBe(100);
  expect(host.querySelector('[role="alert"]')?.textContent).toBe("Older files couldn’t be loaded. Try again.");
  expect(button("Load more")).toBeTruthy();
});

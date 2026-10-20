import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenantContext } from "@/hooks/useTenantContext";
import { clientDocumentMime } from "@/lib/client-portal-documents";

/**
 * E09 Slice 4 (4A) — one client's files, for the business owner, on the Solo client record.
 *
 * public.client_files and the private client-files bucket stay the only file store (§18). Every read and
 * write goes through the owner RPCs of 20271110200000, each sent with the signed-in actor and the workspace
 * the record was opened in, so a switched account or workspace is refused by the server, not trusted here:
 *   client_file_owner_list          — this client's files, pinned to tenant AND contact, admins only; 100 a page,
 *                                     the next page after the (created_at, id) of the last file shown
 *   client_file_owner_begin_upload  — reserves a PRIVATE row at the path the server fixes (owner decision D1)
 *   client_file_owner_finish_upload — verifies the stored object and marks the row saved
 *   client_file_set_client_share    — share / unshare one file, version-checked, audited
 * A write is reported only once a fresh list read shows the asked state (§70.1). Opening a file mints a
 * 60-second signed link that is never stored. There is no delete or rename here (owner decision D7).
 */

export type OwnerFile = {
  id: string; filename: string; mime_type: string | null; size_bytes: number | null;
  visibility: "internal" | "shared" | "client_upload"; upload_state: "pending" | "ready";
  /** "business": uploaded by the business. "client": the client sent it from their portal. */
  source: "business" | "client";
  shared_at: string | null; created_at: string; updated_at: string; storage_path: string;
};
export type OwnerFileList = { contact_id: string; portal_connected: boolean; files: OwnerFile[]; has_more: boolean };
/** "changed": the signed-in account or workspace moved under this record — not a permission refusal. */
export type OwnerFilesPhase = "idle" | "loading" | "ready" | "refused" | "changed" | "unavailable" | "inactive" | "no_workspace" | "error";
export type OwnerUpload = {
  kind: "idle" | "working" | "uncertain" | "continue" | "saved" | "error";
  notice: string; id: string | null; name: string | null;
};
/** "Load more": older files after the last one shown. `failed` is shown beside the button; nothing else changes. */
export type OwnerMore = { loading: boolean; failed: boolean };
/**
 * The share answer's `portal_access` (E09 Slice 7): why the client can or can't see the file now. `null` when the
 * answer carries no word (an older server, or a client record that is no longer active) — never guessed.
 */
export type PortalAccessWord = "open" | "paused" | "ended" | "not_joined";
const ACCESS_WORDS: ReadonlySet<string> = new Set(["open", "paused", "ended", "not_joined"]);
export type ShareResult =
  | { kind: "confirmed"; shared: boolean; portalConnected: boolean | null; portalAccess: PortalAccessWord | null }
  | { kind: "refused"; code: string; reread: boolean }
  | { kind: "unconfirmed" }
  | { kind: "scope" };

export const OWNER_FILE_LIMIT = 100;
export const OWNER_LINK_SECONDS = 60;
const LIST_KEYS = ["ok", "contact_id", "portal_connected", "files", "has_more"];
const FILE_KEYS = ["id", "filename", "mime_type", "size_bytes", "visibility", "upload_state", "source", "shared_at", "created_at", "updated_at", "storage_path"];
/**
 * Who shared a file is the business's own record and may be projected to its owner. It is OPTIONAL and nullable:
 * files shared before the share stamp existed are backfilled with `shared_at` only, so their sharer is unknown
 * (null). Nothing here requires it, and its absence or null never refuses the list.
 */
const OPTIONAL_FILE_KEYS = ["shared_by"];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const exact = (o: Record<string, unknown>, keys: string[]) =>
  Object.keys(o).length === keys.length && keys.every(k => Object.prototype.hasOwnProperty.call(o, k));
/** Exactly the promised keys, plus only the named optional ones. */
const exactAllowing = (o: Record<string, unknown>, keys: string[], optional: string[]) =>
  keys.every(k => Object.prototype.hasOwnProperty.call(o, k)) && Object.keys(o).every(k => keys.includes(k) || optional.includes(k));
const isDate = (v: unknown): v is string => typeof v === "string" && Number.isFinite(Date.parse(v));
const badName = (v: string) => /[/\\]/.test(v) || Array.from(v).some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);

type RpcReply = { data: unknown; error: { code?: string; message?: string } | null };
const ownerRpc = (name: string, args: Record<string, unknown>) =>
  supabase.rpc(name as never, args as never) as unknown as PromiseLike<RpcReply>;

/** Refused, never displayed, when the shape or the scope is not exactly what the server promises. */
export function parseOwnerFileList(value: unknown, tenantId: string, contactId: string): OwnerFileList {
  if (!isObject(value) || !exact(value, LIST_KEYS) || value.ok !== true || value.contact_id !== contactId
    || typeof value.portal_connected !== "boolean" || typeof value.has_more !== "boolean"
    || !Array.isArray(value.files) || value.files.length > OWNER_FILE_LIMIT) throw new Error("Unexpected file list");
  const files = value.files.map((raw): OwnerFile => {
    if (!isObject(raw) || !exactAllowing(raw, FILE_KEYS, OPTIONAL_FILE_KEYS)) throw new Error("Unexpected file");
    if (raw.shared_by !== undefined && raw.shared_by !== null && (typeof raw.shared_by !== "string" || !uuid.test(raw.shared_by))) throw new Error("Unexpected file");
    const f = raw;
    if (typeof f.id !== "string" || !uuid.test(f.id) || typeof f.filename !== "string" || !f.filename || f.filename.length > 255 || badName(f.filename)
      || (f.mime_type !== null && typeof f.mime_type !== "string")
      || (f.size_bytes !== null && (typeof f.size_bytes !== "number" || !Number.isSafeInteger(f.size_bytes) || f.size_bytes < 0))
      || !["internal", "shared", "client_upload"].includes(String(f.visibility)) || !["pending", "ready"].includes(String(f.upload_state))
      || (f.source !== "business" && f.source !== "client") || (f.source === "client") !== (f.visibility === "client_upload")
      || (f.shared_at !== null && !isDate(f.shared_at)) || (f.visibility === "shared") !== (f.shared_at !== null)
      || !isDate(f.created_at) || !isDate(f.updated_at)
      || typeof f.storage_path !== "string" || f.storage_path.split("/")[0] !== tenantId
      || /(^|\/)\.\.?($|\/)/.test(f.storage_path) || f.storage_path.includes("\\")) throw new Error("Unexpected file");
    return { id: f.id, filename: f.filename, mime_type: f.mime_type as string | null, size_bytes: f.size_bytes as number | null,
      visibility: f.visibility as OwnerFile["visibility"], upload_state: f.upload_state as OwnerFile["upload_state"],
      source: f.source, shared_at: f.shared_at as string | null, created_at: f.created_at as string,
      updated_at: f.updated_at as string, storage_path: f.storage_path };
  });
  if (new Set(files.map(f => f.id)).size !== files.length) throw new Error("Unexpected file list");
  return { contact_id: contactId, portal_connected: value.portal_connected, files, has_more: value.has_more };
}

/** The refusal code a jsonb envelope or a raised error carries; never shown to the person. */
function refusalCode(reply: RpcReply): string | null {
  if (isObject(reply.data) && reply.data.ok === false && typeof reply.data.error === "string") return reply.data.error;
  const message = reply.error?.message ?? "";
  const named = /\b([A-Z][A-Z_]{3,})\b/.exec(message);
  return named ? named[1] : null;
}
const unavailableCode = (code: string | null) => code === "CLIENT_FILES_UNAVAILABLE";

class Refused extends Error { constructor(readonly code: string | null) { super(code ?? "refused"); } }
/** The session's account or workspace is no longer the one this record was opened in. Its message is shown. */
export const SCOPE_CHANGED_MESSAGE = "Your workspace changed. Refresh to see this client’s files.";
class ScopeChanged extends Error { constructor() { super(SCOPE_CHANGED_MESSAGE); } }

type Candidate = { id: string; name: string; mime: string; size: number; file: File | null };
const idle = (): OwnerUpload => ({ kind: "idle", notice: "", id: null, name: null });

export function useClientFilesOwner(contactId: string | null) {
  const { activeTenantId, activeUserId, accountContextLoading } = useTenantContext();
  const [phase, setPhase] = useState<OwnerFilesPhase>("idle");
  const [list, setList] = useState<OwnerFileList | null>(null);
  const [upload, setUpload] = useState<OwnerUpload>(idle);
  const [reading, setReading] = useState(false);
  const [more, setMore] = useState<OwnerMore>({ loading: false, failed: false });
  // `pages`: how many pages are on screen, so a fresh read (after a write, or Refresh) covers all of them.
  const life = useRef({ generation: 0, read: 0, writing: false, candidate: null as Candidate | null, key: "", pages: 1, moreBusy: false });
  const key = `${activeUserId ?? ""}:${activeTenantId ?? ""}:${contactId ?? ""}`;

  /** The actor is the signed-in session; the workspace is the one this record was opened in. */
  const actor = useCallback(async () => {
    const session = await supabase.auth.getSession();
    const id = session.data.session?.user.id ?? null;
    if (session.error || !id || !activeTenantId || (activeUserId && id !== activeUserId)) throw new ScopeChanged();
    return id;
  }, [activeTenantId, activeUserId]);

  /** One page: the newest files, or those strictly older than `after` by (created_at, id). */
  const readPage = useCallback(async (after: OwnerFile | null): Promise<OwnerFileList> => {
    if (!activeTenantId || !contactId) throw new ScopeChanged();
    const actorId = await actor();
    const reply = await ownerRpc("client_file_owner_list", {
      p_expected_actor_id: actorId, p_expected_tenant_id: activeTenantId, p_contact_id: contactId, p_limit: OWNER_FILE_LIMIT,
      p_before: after?.created_at ?? null, p_before_id: after?.id ?? null,
    });
    const code = refusalCode(reply);
    if (reply.error?.code === "42501" || (isObject(reply.data) && reply.data.ok === false)) throw new Refused(code);
    if (reply.error) throw new Error("File read failed");
    return parseOwnerFileList(reply.data, activeTenantId, contactId);
  }, [activeTenantId, actor, contactId]);

  /** The first `pages` pages, in order, as one list (no file twice); `has_more` is the last page's. */
  const readList = useCallback(async (pages = 1): Promise<OwnerFileList> => {
    let all = await readPage(null);
    for (let page = 1; page < pages && all.has_more && all.files.length; page++) all = appendPage(all, await readPage(all.files[all.files.length - 1]));
    return all;
  }, [readPage]);

  const settle = useCallback((generation: number, error: unknown) => {
    if (life.current.generation !== generation) return;
    if (error instanceof Refused) setPhase(unavailableCode(error.code) ? "unavailable" : error.code === "CONTACT_NOT_FOUND" ? "inactive" : "refused");
    // An account or workspace change is not a refusal: the person may well be an admin of the new one.
    else if (error instanceof ScopeChanged) setPhase("changed");
    else {
      console.error("[client-files-owner]", error);
      setPhase("error");
    }
  }, []);

  useEffect(() => {
    const l = life.current, generation = ++l.generation;
    l.key = key; l.candidate = null; l.writing = false; l.pages = 1; l.moreBusy = false;
    setList(null); setUpload(idle()); setReading(false); setMore({ loading: false, failed: false });
    if (accountContextLoading || !contactId) { setPhase("idle"); return; }
    if (!activeTenantId) { setPhase("no_workspace"); return; }
    setPhase("loading");
    readList().then(next => {
      if (l.generation !== generation) return;
      setList(next); setPhase("ready");
    }).catch(error => settle(generation, error));
  }, [key, accountContextLoading, activeTenantId, contactId, readList, settle]);

  /**
   * A fresh read that keeps the list on screen and RESOLVES with what the server says now, so a write can
   * be confirmed against a read that started after it (§70.1). A newer read, or a change of client or
   * workspace, wins over an older one.
   */
  const reload = useCallback(async (): Promise<OwnerFileList> => {
    const l = life.current, generation = l.generation, request = ++l.read;
    setReading(true);
    try {
      const next = await readList(l.pages);
      if (l.generation === generation && l.read === request) { setList(next); setPhase("ready"); }
      return next;
    } catch (error) {
      if (l.generation === generation && l.read === request && (error instanceof Refused || error instanceof ScopeChanged)) settle(generation, error);
      throw error;
    } finally {
      if (l.generation === generation && l.read === request) setReading(false);
    }
  }, [readList, settle]);

  const retry = useCallback(() => {
    const l = life.current, generation = l.generation;
    l.pages = 1; ++l.read; setMore({ loading: false, failed: false });
    setPhase("loading");
    readList().then(next => { if (l.generation === generation) { setList(next); setPhase("ready"); } })
      .catch(error => settle(generation, error));
  }, [readList, settle]);

  /**
   * "Load more": the next 100 files, strictly older than the last one shown by (created_at, id), so a file
   * saved in the same instant is never skipped or shown twice. A refresh or a write that reads again wins.
   */
  const loadMore = useCallback(async () => {
    const l = life.current, generation = l.generation, shown = list;
    const last = shown?.files[shown.files.length - 1];
    // A read already in flight (Refresh, or the proof read after a write) finishes first.
    if (!shown || !shown.has_more || !last || l.moreBusy || l.writing || reading) return;
    const request = ++l.read;
    l.moreBusy = true;
    setMore({ loading: true, failed: false });
    try {
      const page = await readPage(last);
      if (l.generation !== generation || l.read !== request) return;
      l.pages += 1;
      setList(appendPage(shown, page));
      setMore({ loading: false, failed: false });
    } catch (error) {
      if (l.generation !== generation || l.read !== request) return;
      if (error instanceof Refused || error instanceof ScopeChanged) settle(generation, error);
      else console.error("[client-files-owner] load more", error);
      setMore({ loading: false, failed: true });
    } finally {
      if (l.generation === generation) {
        l.moreBusy = false;
        if (l.read !== request) setMore({ loading: false, failed: false });
      }
    }
  }, [list, reading, readPage, settle]);

  /** Share or stop sharing one file, then prove it with a fresh read. */
  const setShared = useCallback(async (file: OwnerFile, shared: boolean): Promise<ShareResult> => {
    const l = life.current, generation = l.generation;
    if (!activeTenantId) return { kind: "scope" };
    let actorId: string;
    try { actorId = await actor(); } catch { return { kind: "scope" }; }
    let reply: RpcReply;
    try {
      reply = await ownerRpc("client_file_set_client_share", {
        p_expected_actor_id: actorId, p_expected_tenant_id: activeTenantId, p_file_id: file.id,
        p_shared: shared, p_expected_updated_at: file.updated_at,
      });
    } catch { return { kind: "unconfirmed" }; }
    if (l.generation !== generation) return { kind: "scope" };
    if (reply.error) return reply.error.code === "42501" ? { kind: "scope" } : { kind: "unconfirmed" };
    if (!isObject(reply.data) || reply.data.ok !== true) {
      const code = refusalCode(reply) ?? "UNKNOWN";
      return { kind: "refused", code, reread: code !== "CLIENT_FILES_UNAVAILABLE" };
    }
    const connected = typeof reply.data.portal_connected === "boolean" ? reply.data.portal_connected : null;
    const word = reply.data.portal_access;
    const access = typeof word === "string" && ACCESS_WORDS.has(word) ? word as PortalAccessWord : null;
    // Success is what a fresh read says, not what the writer acknowledged.
    try {
      const fresh = await reload();
      const now = fresh.files.find(f => f.id === file.id);
      return now && (now.visibility === "shared") === shared ? { kind: "confirmed", shared, portalConnected: connected, portalAccess: access } : { kind: "unconfirmed" };
    } catch { return { kind: "unconfirmed" }; }
  }, [activeTenantId, actor, reload]);

  /** Begin (private reservation) → store the bytes → finish → a fresh read shows it saved and private. */
  const run = useCallback(async (candidate: Candidate) => {
    const l = life.current, generation = l.generation;
    const current = () => l.generation === generation;
    if (!activeTenantId || !contactId || l.writing) return;
    l.writing = true; l.candidate = candidate;
    let dispatched = false;
    setUpload({ kind: "working", notice: `Uploading ${candidate.name}…`, id: candidate.id, name: candidate.name });
    try {
      const actorId = await actor();
      dispatched = true;
      const reserved = await ownerRpc("client_file_owner_begin_upload", {
        p_expected_actor_id: actorId, p_expected_tenant_id: activeTenantId, p_contact_id: contactId, p_file_id: candidate.id,
        p_filename: candidate.name, p_mime_type: candidate.mime, p_size_bytes: candidate.size,
      });
      if (!current()) return;
      if (reserved.error?.code === "42501" || (isObject(reserved.data) && reserved.data.ok === false)) throw new Refused(refusalCode(reserved));
      // 22023: the server's own name/type/size rules refused this file; nothing was reserved.
      if (reserved.error?.code === "22023") throw new Refused("INVALID_FILE");
      if (reserved.error) throw reserved.error;
      const path = reservedPath(reserved.data, candidate.id);
      if (path.split("/")[0] !== activeTenantId) throw new Error("Upload reservation changed");
      if (!path.endsWith(`/${candidate.id}`)) throw new Error("Upload reservation changed");
      if (!reservedReady(reserved.data)) {
        if (!candidate.file) {
          setUpload({ kind: "continue", notice: `Choose ${candidate.name} again to finish uploading it.`, id: candidate.id, name: candidate.name });
          return;
        }
        const stored = await supabase.storage.from("client-files").upload(path, candidate.file, { contentType: candidate.mime, upsert: false });
        if (!current()) return;
        // An object already at this exact reserved path is this same upload, retried; finish verifies it.
        if (stored.error && !/exists|duplicate/i.test(stored.error.message ?? "")) throw stored.error;
        const saved = await ownerRpc("client_file_owner_finish_upload", {
          p_expected_actor_id: actorId, p_expected_tenant_id: activeTenantId, p_file_id: candidate.id,
        });
        if (!current()) return;
        if (saved.error?.code === "42501" || (isObject(saved.data) && saved.data.ok === false)) throw new Refused(refusalCode(saved));
        if (saved.error) throw saved.error;
      }
      const fresh = await reload();
      if (!current()) return;
      const row = fresh.files.find(f => f.id === candidate.id);
      if (!row || row.upload_state !== "ready" || row.visibility !== "internal" || row.source !== "business") throw new Error("Unconfirmed upload");
      l.candidate = null;
      setUpload({ kind: "saved", notice: `${candidate.name} is saved. It’s private to your team until you share it.`, id: candidate.id, name: candidate.name });
    } catch (error) {
      if (!current()) return;
      if (error instanceof Refused) {
        l.candidate = null;
        setUpload({ kind: "error", id: candidate.id, name: candidate.name, notice: uploadRefusal(error.code) });
      } else if (error instanceof ScopeChanged) {
        setUpload({ kind: "error", id: candidate.id, name: candidate.name, notice: SCOPE_CHANGED_MESSAGE });
      } else {
        setUpload(dispatched
          ? { kind: "uncertain", id: candidate.id, name: candidate.name, notice: `We couldn’t confirm ${candidate.name} was saved. Check before trying again.` }
          : { kind: "error", id: candidate.id, name: candidate.name, notice: "The upload couldn’t start. Check your connection and try again." });
      }
    } finally {
      if (l.generation === generation) l.writing = false;
    }
  }, [activeTenantId, actor, contactId, reload]);

  /** A new file, or the original file again for an upload that didn't finish (same id, same path). */
  const add = useCallback(async (file: File, resume?: { id: string; name: string; size: number | null; mime: string | null }) => {
    let mime: string;
    try { mime = clientDocumentMime(file); } catch (error) {
      setUpload({ kind: "error", id: null, name: file.name, notice: error instanceof Error ? error.message : "Choose a permitted file." });
      return;
    }
    const held = life.current.candidate;
    const target = resume ?? (held && upload.kind !== "saved" && upload.kind !== "idle" ? { id: held.id, name: held.name, size: held.size, mime: held.mime } : null);
    if (target && (target.name !== file.name || (target.size !== null && target.size !== file.size) || (target.mime && target.mime !== mime))) {
      setUpload({ kind: "continue", id: target.id, name: target.name, notice: `Choose ${target.name} — the same file — to finish this upload.` });
      return;
    }
    await run({ id: target?.id ?? crypto.randomUUID(), name: file.name, mime, size: file.size, file });
  }, [run, upload.kind]);

  /** Read-only: is the held upload saved? A saved one is confirmed; a stored one is finished; else ask for the file. */
  const check = useCallback(async () => {
    const held = life.current.candidate;
    if (!held || life.current.writing) return;
    await run({ ...held });
  }, [run]);

  const dismiss = useCallback(() => {
    if (life.current.writing) return;
    life.current.candidate = null; setUpload(idle());
  }, []);

  /** A 60-second link for one listed, saved file. Never stored. */
  const link = useCallback(async (file: OwnerFile): Promise<string> => {
    const listed = list?.files.find(f => f.id === file.id);
    if (!listed || listed.upload_state !== "ready" || listed.storage_path !== file.storage_path) throw new Error("This file isn’t available.");
    await actor();
    const result = await supabase.storage.from("client-files").createSignedUrl(file.storage_path, OWNER_LINK_SECONDS);
    if (result.error || !result.data?.signedUrl) throw new Error("This file couldn’t be opened. Try again.");
    return result.data.signedUrl;
  }, [actor, list]);

  return { phase, list, upload, reading, more, loadMore, reload, retry, setShared, add, check, dismiss, link };
}

/** `older` continues `shown`: its files after the ones already listed, never one twice; its has_more wins. */
function appendPage(shown: OwnerFileList, older: OwnerFileList): OwnerFileList {
  const seen = new Set(shown.files.map(f => f.id));
  return { contact_id: shown.contact_id, portal_connected: older.portal_connected,
    files: [...shown.files, ...older.files.filter(f => !seen.has(f.id))], has_more: older.has_more };
}

/** The reserved object path, which only the server decides. */
function reservedPath(data: unknown, id: string): string {
  const row = isObject(data) && isObject(data.file) ? data.file : data;
  if (!isObject(row) || (row.id !== undefined && row.id !== id && row.file_id !== id) || typeof row.storage_path !== "string") throw new Error("Upload reservation changed");
  if (/(^|\/)\.\.?($|\/)/.test(row.storage_path) || row.storage_path.includes("\\")) throw new Error("Upload reservation changed");
  return row.storage_path;
}
const reservedReady = (data: unknown) => {
  const row = isObject(data) && isObject(data.file) ? data.file : data;
  return isObject(row) && row.upload_state === "ready";
};

function uploadRefusal(code: string | null): string {
  switch (code) {
    case "CLIENT_FILES_UNAVAILABLE": return "Client files aren’t available for this account.";
    case "CONTACT_NOT_FOUND": return "This client’s record isn’t active, so files can’t be added.";
    case "FILE_SCOPE_CHANGED": return "Your workspace or role changed. Reopen this client to add files.";
    case "INVALID_FILE": return "Choose a PDF, JPG, PNG or DOCX file up to 20 MB.";
    case "FILE_RESERVATION_CONFLICT": return "That upload can’t be resumed with this file. Add it as a new file.";
    default: return "That file couldn’t be saved. Check it and try again.";
  }
}

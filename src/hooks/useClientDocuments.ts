import {useCallback, useEffect, useRef, useState} from "react";
import {supabase} from "@/integrations/supabase/client";
import {readClientPortalSelfProfile} from "@/lib/client-portal-self-profile";
import {CLIENT_DOCUMENT_COLUMNS, PORTAL_DOCUMENT_PAGE_SIZE, clientDocumentMime, portalDocumentFromUpload, readClientDocument,
  readPortalDocumentList, sameDocumentScope, type DocumentScope, type PortalDocument} from "@/lib/client-portal-documents";

type RpcResult = {data: unknown; error: {code?: string; message?: string} | null};
// These native functions are introduced by the paired forward migration. Keep
// the existing SDK/client; shared generated types are not a competing API store.
const fileRpc = (name: string, args: Record<string, unknown>) =>
  supabase.rpc(name as never, args as never) as unknown as PromiseLike<RpcResult>;
type Phase = "loading" | "ready" | "error" | "unavailable" | "signed_out";
type Upload = {kind: "idle" | "working" | "uncertain" | "finish" | "retry" | "saved" | "error"; notice: string; id: string | null};
type Candidate = {id: string; name: string; mime: string; size: number; scope: DocumentScope; file: File | null};
const idle = (): Upload => ({kind: "idle", notice: "", id: null});
const pageSize = PORTAL_DOCUMENT_PAGE_SIZE;
/** A signed link lives this long (seconds). It is minted per open and never stored. */
export const DOCUMENT_LINK_SECONDS = 60;
export type DocumentLinks = {view: string; download: string; expiresAt: number};
export type DocumentSummary = {shared: number; from_you: number};
async function wait<T>(value: PromiseLike<T>, deadline: number): Promise<T> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error("Request timed out");
  let timer: ReturnType<typeof setTimeout>;
  try {return await Promise.race([Promise.resolve(value), new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Request timed out")), remaining);
  })]);} finally {clearTimeout(timer!);}
}
class AccessFailure extends Error {}

/** Local document UI lifetime. Auth, native relationship, file and Storage policies own permission. */
export function useClientDocuments() {
  const [phase, setPhase] = useState<Phase>("loading"), [files, setFiles] = useState<PortalDocument[]>([]);
  const [summary, setSummary] = useState<DocumentSummary | null>(null);
  const [scope, setScope] = useState<DocumentScope | null>(null), [more, setMore] = useState(false);
  const [reading, setReading] = useState(false), [notice, setNotice] = useState("");
  const [upload, setUpload] = useState<Upload>(idle), [epoch, setEpoch] = useState(0);
  const life = useRef({alive: true, epoch: 0, read: 0, writing: false, recoveryAllowed: false,
    scope: null as DocumentScope | null, last: null as DocumentScope | null,
    files: [] as PortalDocument[], candidate: null as Candidate | null});
  const retire = useCallback((next: Phase, message: string) => {
    const l = life.current; ++l.epoch; ++l.read; l.scope = null; l.last = null; l.files = [];
    l.writing = false; l.recoveryAllowed = false; l.candidate = null;
    setEpoch(l.epoch); setScope(null); setFiles([]); setSummary(null); setMore(false); setReading(false);
    setPhase(next); setNotice(message); setUpload(idle());
  }, []);
  const verifiedScope = useCallback(async (deadline: number, expected?: DocumentScope): Promise<DocumentScope> => {
    const identity = await wait(supabase.auth.getUser(), deadline);
    if (identity.error || !identity.data.user) throw new AccessFailure("Sign in with your invited account to continue.");
    const actor = identity.data.user.id;
    if (expected && actor !== expected.actor) throw new AccessFailure("Your customer session changed. Reload Documents to continue.");
    const result = await wait(supabase.rpc("client_portal_self_profile"), deadline);
    if (result.error?.code === "42501" || (!result.error && !result.data)) throw new AccessFailure("Your customer access could not be verified. Contact the business for help.");
    const p = readClientPortalSelfProfile(result.data, actor);
    if (result.error || !p) throw new Error("Your customer information could not be verified.");
    const current = {actor, tenant: p.tenant_id, contact: p.id};
    const final = await wait(supabase.auth.getUser(), deadline);
    if (final.error || final.data.user?.id !== actor || (expected && !sameDocumentScope(expected, current))) {
      throw new AccessFailure("Your customer session changed. Reload Documents to continue.");
    }
    return current;
  }, []);
  const refresh = useCallback(async (append = false) => {
    const l = life.current;
    if (!l.alive || l.writing) return;
    const request = ++l.read, generation = l.epoch, deadline = Date.now() + 20_000;
    const current = () => l.alive && l.epoch === generation && l.read === request;
    setReading(true); setNotice(""); if (!append && !l.scope) setPhase("loading");
    try {
      const next = await verifiedScope(deadline); if (!current()) return;
      if (l.last && !sameDocumentScope(l.last, next)) {
        retire("unavailable", "Your customer context changed. Reload Documents to continue."); return;
      }
      // One closed server read decides what is listed (E09 Slice 4): shared files that are saved, and the
      // customer's own uploads. The browser never queries the file table for the list.
      const before = append ? l.files.at(-1)?.created_at ?? null : null;
      const result = await wait(fileRpc("client_portal_documents", {p_tenant_id: next.tenant, p_limit: pageSize, p_before: before}), deadline);
      if (!current()) return;
      if (result.error?.code === "42501") throw new AccessFailure("Your document access could not be verified.");
      if (result.error) throw new Error("Document read failed");
      if (result.data === null) throw new AccessFailure("Your customer access could not be verified. Contact the business for help.");
      const page = readPortalDocumentList(result.data, next);
      await verifiedScope(deadline, next); if (!current()) return;
      const merged = append ? [...l.files] : [];
      for (const row of page.files) {const index = merged.findIndex(f => f.id === row.id); if (index < 0) merged.push(row); else merged[index] = row;}
      l.scope = next; l.last = next; l.files = merged;
      setScope(next); setFiles(merged); setSummary(page.summary); setMore(page.has_more); setPhase("ready");
    } catch (error) {
      if (!current()) return;
      if (error instanceof AccessFailure) retire("unavailable", error.message);
      else {l.scope = null; setScope(null); setFiles([]); setSummary(null); setPhase("error"); setNotice("Your documents could not be loaded. Check your connection and try again.");}
    } finally {if (current()) setReading(false);}
  }, [retire, verifiedScope]);
  useEffect(() => {
    const l = life.current; l.alive = true; setEpoch(l.epoch);
    const {data: {subscription}} = supabase.auth.onAuthStateChange((event, session) => {
      if (!l.alive) return;
      if (event === "SIGNED_OUT" || !session) {retire("signed_out", "Sign in with your invited account to continue."); return;}
      if (session.user.id !== l.last?.actor) retire("loading", "");
      const generation = l.epoch;
      queueMicrotask(() => {if (l.alive && l.epoch === generation && !l.writing) void refresh();});
    });
    const focus = () => {if (l.alive && !l.writing) void refresh();};
    window.addEventListener("focus", focus); void refresh();
    return () => {l.alive = false; ++l.epoch; ++l.read; l.candidate = null; subscription.unsubscribe(); window.removeEventListener("focus", focus);};
  }, [refresh, retire]);
  useEffect(() => {
    if (!scope) return;
    const channel = supabase.channel(`client-documents-${scope.contact}`)
      .on("postgres_changes", {event: "*", schema: "public", table: "client_files", filter: `contact_id=eq.${scope.contact}`}, () => void refresh()).subscribe();
    return () => {void supabase.removeChannel(channel);};
  }, [scope, refresh]);

  const inspect = useCallback(async (candidate: Candidate, deadline: number) => {
    const result = await wait(fileRpc("client_portal_file_upload_status", {p_file_id: candidate.id, p_tenant_id: candidate.scope.tenant}), deadline);
    if (result.error) throw new Error("Upload status could not be checked");
    const value = result.data as {file?: unknown; object_verified?: unknown} | null;
    if (!value || Object.keys(value).length !== 2 || typeof value.object_verified !== "boolean" || !("file" in value)) throw new Error("Invalid upload status");
    const file = value.file === null ? null : readClientDocument(value.file, candidate.scope);
    if (file && (file.id !== candidate.id || file.uploaded_by_user_id !== candidate.scope.actor
      || file.original_filename !== candidate.name || file.mime_type !== candidate.mime || file.size_bytes !== candidate.size)) throw new Error("Upload result changed");
    return {file, object: value.object_verified};
  }, []);
  const confirm = useCallback(async (candidate: Candidate, deadline: number) => {
    const l = life.current, generation = l.epoch;
    const current = () => l.alive && l.epoch === generation && sameDocumentScope(l.scope, candidate.scope);
    if (!current()) return false;
    const result = await inspect(candidate, deadline);
    if (!result.file || result.file.upload_state !== "ready" || !result.object) return false;
    const read = await wait(supabase.from("client_files").select(CLIENT_DOCUMENT_COLUMNS)
      .eq("id", candidate.id).eq("tenant_id", candidate.scope.tenant).eq("contact_id", candidate.scope.contact).maybeSingle(), deadline);
    if (read.error) throw new Error("Saved document could not be reloaded");
    const file = readClientDocument(read.data, candidate.scope);
    if (file.id !== candidate.id || file.storage_path !== result.file.storage_path || file.upload_state !== "ready"
      || file.uploaded_by_user_id !== candidate.scope.actor || file.original_filename !== candidate.name
      || file.mime_type !== candidate.mime || file.size_bytes !== candidate.size) throw new Error("Saved document changed");
    await verifiedScope(deadline, candidate.scope);
    if (!current()) return false;
    l.files = [portalDocumentFromUpload(file), ...l.files.filter(f => f.id !== file.id)];
    setFiles(l.files); l.candidate = null;
    setUpload({kind: "saved", id: file.id, notice: "Document uploaded. It is saved for your team."});
    return true;
  }, [inspect, verifiedScope]);
  const transfer = useCallback(async (file?: File) => {
    const l = life.current, currentScope = l.scope;
    if (!l.alive || !currentScope || l.writing) return;
    const generation = l.epoch, current = () => l.alive && l.epoch === generation && sameDocumentScope(l.scope, currentScope);
    let candidate = l.candidate;
    if (candidate && !l.recoveryAllowed) return;
    if (candidate && !sameDocumentScope(candidate.scope, currentScope)) return;
    try {
      if (file) {
        const mime = clientDocumentMime(file);
        if (candidate && (candidate.name !== file.name || candidate.mime !== mime || candidate.size !== file.size)) throw new Error("Choose the original file to resume this upload.");
        candidate ??= {id: crypto.randomUUID(), name: file.name, mime, size: file.size, scope: currentScope, file};
        candidate.file = file;
      }
      if (!candidate) return;
    } catch (error) {setUpload({kind: "error", id: candidate?.id ?? null, notice: error instanceof Error ? error.message : "Choose a permitted file."}); return;}
    const attempt = candidate; l.candidate = attempt; l.writing = true; l.recoveryAllowed = false;
    const deadline = Date.now() + 120_000; let dispatched = false;
    setUpload({kind: "working", id: attempt.id, notice: "Saving your document…"});
    try {
      await verifiedScope(deadline, currentScope); if (!current()) return;
      // Retry uses the same canonical reservation ID and immutable object path.
      // Neither an overwrite nor a second file can result from a late reply.
      dispatched = true;
      const reserved = await wait(fileRpc("client_portal_begin_file_upload", {p_file_id: attempt.id, p_filename: attempt.name,
        p_expected_client_id: currentScope.contact, p_mime_type: attempt.mime, p_size_bytes: attempt.size, p_tenant_id: currentScope.tenant}), deadline);
      if (reserved.error) throw reserved.error;
      const row = readClientDocument(reserved.data, currentScope); if (!current()) return;
      if (row.id !== attempt.id || row.uploaded_by_user_id !== currentScope.actor) throw new Error("Upload reservation changed");
      const status = await inspect(attempt, deadline); if (!current()) return;
      if (row.upload_state !== "ready" && !status.object) {
        if (!attempt.file) {l.recoveryAllowed = true; setUpload({kind: "retry", id: attempt.id, notice: "Choose the original file to continue this unfinished upload."}); return;}
        setUpload({kind: "working", id: attempt.id, notice: "Uploading your document…"});
        const stored = await wait(supabase.storage.from("client-files").upload(row.storage_path, attempt.file, {contentType: attempt.mime, upsert: false}), deadline);
        if (stored.error) throw stored.error;
      }
      await verifiedScope(deadline, currentScope); if (!current()) return;
      setUpload({kind: "working", id: attempt.id, notice: "Saving your upload to your client record…"});
      const saved = await wait(fileRpc("client_portal_finish_file_upload", {p_file_id: attempt.id, p_tenant_id: currentScope.tenant}), deadline);
      if (saved.error) throw saved.error;
      if (!current() || !await confirm(attempt, deadline)) throw new Error("Unconfirmed upload");
    } catch (error) {
      if (!current()) return;
      if (error instanceof AccessFailure || (error as {code?: string})?.code === "42501") retire("unavailable", "Your customer access changed. Reload Documents to continue.");
      else setUpload({kind: dispatched ? "uncertain" : "error", id: attempt.id,
        notice: dispatched ? "We couldn’t confirm your upload. Check its saved status before trying again." : "Your document could not be started. Check your connection and try again."});
    } finally {if (l.alive && l.epoch === generation) l.writing = false;}
  }, [confirm, inspect, retire, verifiedScope]);
  const checkUpload = useCallback(async (row?: PortalDocument) => {
    const l = life.current, currentScope = l.scope;
    if (!currentScope || l.writing) return;
    const candidate = row ? l.candidate?.id === row.id ? l.candidate : {id: row.id, name: row.filename, mime: row.mime_type ?? "", size: row.size_bytes ?? 0, scope: currentScope, file: null} : l.candidate;
    if (!candidate || !sameDocumentScope(candidate.scope, currentScope) || (row && row.source !== "you")) return;
    const generation = l.epoch, current = () => l.alive && l.epoch === generation && sameDocumentScope(l.scope, currentScope);
    l.writing = true; l.candidate = candidate; l.recoveryAllowed = false;
    setUpload({kind: "working", id: candidate.id, notice: "Checking your saved upload…"});
    try {
      const deadline = Date.now() + 20_000; await verifiedScope(deadline, currentScope);
      const status = await inspect(candidate, deadline); if (!current()) return;
      if (status.file?.upload_state === "ready" && status.object) {if (!await confirm(candidate, deadline)) throw new Error("Unconfirmed upload");}
      else {await verifiedScope(deadline, currentScope); if (current()) {
        l.recoveryAllowed = true;
        setUpload({kind: status.object ? "finish" : "retry", id: candidate.id,
          notice: status.object ? "Your file is stored. Finish saving it to your client record." : "The transfer is unfinished. You can retry the same upload."});
      }}
    } catch (error) {if (current()) {
      if (error instanceof AccessFailure) retire("unavailable", error.message);
      else setUpload({kind: "uncertain", id: candidate.id, notice: "The upload status could not be confirmed. Check your connection and try again."});
    }} finally {if (l.alive && l.epoch === generation) l.writing = false;}
  }, [confirm, inspect, retire, verifiedScope]);
  const stopWaiting = useCallback(() => {
    const l = life.current;
    if (!l.alive || !l.writing || !l.candidate) return;
    ++l.epoch; ++l.read; l.writing = false; l.recoveryAllowed = false;
    setEpoch(l.epoch);
    setUpload({kind: "uncertain", id: l.candidate.id,
      notice: "Stopped waiting here. The upload may have reached your business; check its saved status before trying again."});
  }, []);
  /**
   * Two short-lived signed links for one listed, saved file: one to view, one that downloads under its
   * own name. The path comes only from the closed list read; Storage re-checks the file's permission
   * when each link is minted, and neither link is kept after the preview closes.
   */
  const retrieve = useCallback(async (row: PortalDocument): Promise<DocumentLinks | null> => {
    const l = life.current, expected = l.scope, generation = l.epoch;
    const listed = l.files.find(f => f.id === row.id);
    if (!expected || row.state !== "ready" || !listed || listed.storage_path !== row.storage_path) return null;
    try {
      const deadline = Date.now() + 20_000;
      await verifiedScope(deadline, expected);
      if (!l.alive || l.epoch !== generation) return null;
      const bucket = supabase.storage.from("client-files");
      const [view, download] = await wait(Promise.all([
        bucket.createSignedUrl(row.storage_path, DOCUMENT_LINK_SECONDS),
        bucket.createSignedUrl(row.storage_path, DOCUMENT_LINK_SECONDS, {download: row.filename}),
      ]), deadline);
      const minted = Date.now();
      if (view.error || download.error || !view.data?.signedUrl || !download.data?.signedUrl) {
        throw new Error("This document could not be opened. Try again or contact the business.");
      }
      await verifiedScope(deadline, expected);
      return l.alive && l.epoch === generation && sameDocumentScope(l.scope, expected)
        ? {view: view.data.signedUrl, download: download.data.signedUrl, expiresAt: minted + DOCUMENT_LINK_SECONDS * 1000} : null;
    } catch (error) {
      if (!l.alive || l.epoch !== generation) return null;
      if (error instanceof AccessFailure) {retire("unavailable", error.message); return null;}
      throw error;
    }
  }, [retire, verifiedScope]);
  const isCurrent = useCallback((generation: number) => life.current.alive && life.current.epoch === generation, []);
  return {phase, files, summary, scope, more, reading, notice, upload, epoch, refresh, transfer, checkUpload, stopWaiting, retrieve, isCurrent};
}

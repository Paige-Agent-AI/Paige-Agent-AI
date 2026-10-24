import {useCallback, useEffect, useRef, useState} from "react";
import {supabase} from "@/integrations/supabase/client";
import {useShellCustomerIdentity} from "@/lib/portal/customerIdentity";
import {captureClientPortalAuthorization, withClientPortalBusiness} from "@/lib/client-portal-scope";
import {readClientPortalSelfProfile} from "@/lib/client-portal-self-profile";
import {CLIENT_DOCUMENT_COLUMNS, PORTAL_DOCUMENT_PAGE_SIZE, clientDocumentMime, portalDocumentFromUpload, readClientDocument,
  readPortalDocumentList, sameDocumentScope, type DocumentScope, type PortalDocument} from "@/lib/client-portal-documents";
import {readCustomerChatFile, readCustomerChatFilePage, readCustomerChatFileStatus} from "@/lib/customer-chat-files";

type RpcResult = {data: unknown; error: {code?: string; message?: string} | null};
// Original native functions retain their existing server authority and signature.
// Keep the existing SDK/client; generated types are not another API store.
type FileRequest = PromiseLike<RpcResult> & {setHeader(name:string,value:string):FileRequest};
const fileRpc = (name: string, args: Record<string, unknown>, scope: DocumentScope, authorization: string) =>
  withClientPortalBusiness(supabase.rpc(name as never, args as never) as unknown as FileRequest, scope.tenant).setHeader("Authorization", authorization);
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

type PrivateDocumentPurpose = {kind: "customer_private"; threadId: string};
/** Local document UI lifetime. Auth, native relationship, file and Storage policies own permission. */
function useClientDocumentsConsumer(purpose?: PrivateDocumentPurpose) {
  const identity = useShellCustomerIdentity();
  const frame = identity?.viewer === "customer" ? identity.frame : null;
  const privateMode = purpose?.kind === "customer_private", privateThread = purpose?.threadId;
  const privateAllowed = !privateMode || !!frame && typeof privateThread === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(privateThread);
  const requested = frame ? {actor:frame.actorId,tenant:frame.profile.tenant_id,contact:frame.profile.id} : undefined;
  const identityKey = identity ? JSON.stringify([identity.viewer,requested?.actor,requested?.tenant,requested?.contact]) : "legacy";
  const requestedKey = privateMode ? JSON.stringify([identityKey,"customer_private",privateThread]) : identityKey;
  const enabled = privateAllowed && (!identity || identity.viewer === "staff" || !!frame && identity.phase === "ready" && !identity.checking);
  const [phase, setPhase] = useState<Phase>("loading"), [files, setFiles] = useState<PortalDocument[]>([]);
  const [summary, setSummary] = useState<DocumentSummary | null>(null);
  const [scope, setScope] = useState<DocumentScope | null>(null), [more, setMore] = useState(false);
  const [reading, setReading] = useState(false), [notice, setNotice] = useState("");
  const [upload, setUpload] = useState<Upload>(idle), [epoch, setEpoch] = useState(0);
  const life = useRef({alive: true, epoch: 0, read: 0, writing: false, recoveryAllowed: false,
    signedOut: false, scope: null as DocumentScope | null, last: null as DocumentScope | null,
    files: [] as PortalDocument[], candidate: null as Candidate | null});
  const viewEpoch = useRef(0), dataGeneration = useRef(-1), applied = useRef(requestedKey);
  const interrupted = useRef(false);
  const origin = useRef({key:requestedKey,generation:0,enabled});
  if(origin.current.key !== requestedKey || origin.current.enabled !== enabled) {
    const l=life.current;
    ++l.epoch; ++l.read;
    if(origin.current.key !== requestedKey) {
      ++viewEpoch.current; l.scope=null; l.last=null; l.files=[]; l.candidate=null;
      l.writing=false; l.recoveryAllowed=false; interrupted.current=false;
    } else if(l.writing && l.candidate) {
      l.writing=false; l.recoveryAllowed=false; interrupted.current=true;
    }
    origin.current={key:requestedKey,generation:origin.current.generation+1,enabled};
  }
  const generation=origin.current.generation;
  const scopeAlive=useCallback(()=>origin.current.generation===generation&&origin.current.enabled&&applied.current===requestedKey,[generation,requestedKey]);
  const requestedActor=requested?.actor,requestedTenant=requested?.tenant,requestedContact=requested?.contact;
  const retire = useCallback((next: Phase, message: string) => {
    const l = life.current; ++l.epoch; ++l.read; l.scope = null; l.last = null; l.files = [];
    l.writing = false; l.recoveryAllowed = false; l.candidate = null;
    ++viewEpoch.current; dataGeneration.current=origin.current.generation;
    setEpoch(viewEpoch.current); setScope(null); setFiles([]); setSummary(null); setMore(false); setReading(false);
    setPhase(next); setNotice(message); setUpload(idle());
  }, []);
  // This ephemeral request tuple never enters UI state, a candidate or storage.
  const verifiedAccess = useCallback(async (deadline: number, expected?: DocumentScope, valid:()=>boolean=scopeAlive): Promise<{scope:DocumentScope;authorization:string}> => {
    const current=()=>valid()&&scopeAlive()&&life.current.alive&&!life.current.signedOut&&Date.now()<deadline;
    if(!current())throw new AccessFailure("Your customer context changed.");
    const wanted=requestedActor&&requestedTenant&&requestedContact?{actor:requestedActor,tenant:requestedTenant,contact:requestedContact}:expected;
    const identity=await wait(supabase.auth.getUser(),deadline);
    if(identity.error||!identity.data.user)throw new AccessFailure("Sign in with your invited account to continue.");
    const actor=identity.data.user.id;
    if(!current()||wanted&&actor!==wanted.actor)throw new AccessFailure(privateMode?"Your customer session changed. Reopen the portal to continue.":"Your customer session changed. Reload Documents to continue.");
    let authorization:string;
    try{authorization=await wait(captureClientPortalAuthorization(supabase.auth,actor,current),deadline);}
    catch{throw new AccessFailure("Your customer session could not be checked.");}
    if(!current())throw new AccessFailure("Your customer context changed.");
    let request=wanted?supabase.rpc("client_portal_self_profile",{p_tenant_id:wanted.tenant}):supabase.rpc("client_portal_self_profile");
    if(wanted)request=withClientPortalBusiness(request,wanted.tenant);
    const result=await wait(request.setHeader("Authorization",authorization),deadline);
    if(result.error?.code==="42501"||!result.error&&!result.data)throw new AccessFailure("Your customer access could not be verified. Contact the business for help.");
    const p=result.error?null:readClientPortalSelfProfile(result.data,actor,wanted?.tenant);
    if(!p)throw new Error("Your customer information could not be verified.");
    const scope={actor,tenant:p.tenant_id,contact:p.id};
    if(privateMode){
      // Same original native service: recheck private thread, class and assistant
      // configuration before/after upload or signing, not just the self profile.
      const gate=await wait(fileRpc("client_portal_chat_files",{p_thread_id:privateThread,p_tenant_id:scope.tenant,p_limit:1},scope,authorization),deadline);
      if(gate.error?.code==="42501"||!gate.error&&!gate.data)throw new AccessFailure("Your private file access could not be verified. Reopen the portal to continue.");
      if(gate.error)throw new Error("Private file access could not be checked.");
      readCustomerChatFilePage(gate.data,scope);
      if(!current())throw new AccessFailure("Your customer context changed.");
    }
    // Keep the original actual-Auth check last: the additional private RPC may
    // await across a session change before the SDK delivers its Auth event.
    const final=await wait(supabase.auth.getUser(),deadline);
    if(final.error||final.data.user?.id!==actor||!current()||wanted&&!sameDocumentScope(wanted,scope)||expected&&!sameDocumentScope(expected,scope))
      throw new AccessFailure(privateMode?"Your customer session changed. Reopen the portal to continue.":"Your customer session changed. Reload Documents to continue.");
    return {scope,authorization};
  },[scopeAlive,requestedActor,requestedTenant,requestedContact,privateMode,privateThread]);
  const refresh = useCallback(async (append = false) => {
    const l = life.current;
    if (!l.alive || !scopeAlive() || l.signedOut || l.writing) return;
    const request = ++l.read, generation = l.epoch, deadline = Date.now() + 20_000;
    const current = () => l.alive && scopeAlive() && !l.signedOut && l.epoch === generation && l.read === request;
    setReading(true); setNotice(""); if (!append && !l.scope) setPhase("loading");
    try {
      const access = await verifiedAccess(deadline,undefined,current),next=access.scope; if (!current()) return;
      if (l.last && !sameDocumentScope(l.last, next)) {
        retire("unavailable", privateMode?"Your customer context changed. Reopen the portal to continue.":"Your customer context changed. Reload Documents to continue."); return;
      }
      // One closed server read decides what is listed (E09 Slice 4): shared files that are saved, and the
      // customer's own uploads. The browser never queries the file table for the list.
      // The next page starts strictly after the (created_at, id) of the last file shown, so a file saved in
      // the same instant as that one is never skipped.
      const last = append ? l.files.at(-1) ?? null : null;
      const result = await wait(fileRpc(privateMode?"client_portal_chat_files":"client_portal_documents", {p_tenant_id: next.tenant, p_limit: pageSize,
        ...(privateMode?{p_thread_id:privateThread}:{}),
        p_before: last?.created_at ?? null, p_before_id: last?.id ?? null},next,access.authorization), deadline);
      if (!current()) return;
      if (result.error?.code === "42501") throw new AccessFailure("Your document access could not be verified.");
      if (result.error) throw new Error("Document read failed");
      if (result.data === null) throw new AccessFailure("Your customer access could not be verified. Contact the business for help.");
      const privatePage=privateMode?readCustomerChatFilePage(result.data,next):null;
      const page=privatePage?{files:privatePage.files.map(portalDocumentFromUpload),summary:null,has_more:privatePage.has_more}
        :readPortalDocumentList(result.data,next);
      await verifiedAccess(deadline, next,current); if (!current()) return;
      const merged = append ? [...l.files] : [];
      for (const row of page.files) {const index = merged.findIndex(f => f.id === row.id); if (index < 0) merged.push(row); else merged[index] = row;}
      l.scope = next; l.last = next; l.files = merged; dataGeneration.current=origin.current.generation;
      setScope(next); setFiles(merged); setSummary(page.summary); setMore(page.has_more); setPhase("ready");
    } catch (error) {
      if (!current()) return;
      if (error instanceof AccessFailure) retire("unavailable", error.message);
      else {l.scope = null; l.files=[]; dataGeneration.current=origin.current.generation; setScope(null); setFiles([]); setSummary(null); setPhase("error"); setNotice("Your documents could not be loaded. Check your connection and try again.");}
    } finally {if (current()) setReading(false);}
  }, [retire, verifiedAccess, scopeAlive, privateMode, privateThread]);
  useEffect(() => {
    const l=life.current;l.alive=true;let listening=true;
    if(applied.current!==requestedKey){applied.current=requestedKey;setEpoch(viewEpoch.current);setScope(null);setFiles([]);setSummary(null);setMore(false);setReading(false);setUpload(idle());setNotice("");setPhase("loading");}
    if(interrupted.current){interrupted.current=false;setUpload({kind:"uncertain",id:l.candidate?.id??null,notice:"Your access was checked again. Check this upload's saved status before continuing."});}
    const {data:{subscription}}=supabase.auth.onAuthStateChange((event,session)=>{
      if(!listening||!l.alive)return;
      if(l.signedOut&&event!=="SIGNED_IN")return;
      if(event==="INITIAL_SESSION"&&session&&(!l.last||session.user.id===l.last.actor))return;
      if(event==="SIGNED_OUT"||!session){++origin.current.generation;l.signedOut=true;retire("signed_out","Sign in with your invited account to continue.");return;}
      if(l.signedOut||session.user.id!==l.last?.actor){++origin.current.generation;l.signedOut=false;retire("loading","");}
      const generation=l.epoch;
      queueMicrotask(()=>{if(listening&&l.alive&&l.epoch===generation&&!l.writing)void refresh();});
    });
    const focus=()=>{if(l.alive&&scopeAlive()&&!l.signedOut&&!l.writing)void refresh();};
    window.addEventListener("focus",focus);void refresh();
    return()=>{listening=false;l.alive=false;++l.epoch;++l.read;subscription.unsubscribe();window.removeEventListener("focus",focus);};
  },[refresh,retire,requestedKey,enabled,scopeAlive]);
  useEffect(() => {
    if (!scope) return;
    const channel = supabase.channel(privateMode?`client-private-files-${scope.contact}-${privateThread}`:`client-documents-${scope.contact}`)
      .on("postgres_changes", {event: "*", schema: "public", table: "client_files", filter: `contact_id=eq.${scope.contact}`}, () => void refresh()).subscribe();
    return () => {void supabase.removeChannel(channel);};
  }, [scope, refresh, privateMode, privateThread]);

  const inspect = useCallback(async (candidate: Candidate, deadline: number, authorization:string) => {
    const result = await wait(fileRpc(privateMode?"client_portal_chat_file_status":"client_portal_file_upload_status",
      {p_file_id: candidate.id, p_tenant_id: candidate.scope.tenant,...(privateMode?{p_thread_id:privateThread}:{})},candidate.scope,authorization), deadline);
    if (result.error) throw new Error("Upload status could not be checked");
    if(privateMode){const value=readCustomerChatFileStatus(result.data,candidate.scope,candidate.id);
      if(value.file&&(value.file.original_filename!==candidate.name||value.file.mime_type!==candidate.mime||value.file.size_bytes!==candidate.size))throw new Error("Upload result changed");
      return{file:value.file,object:value.object_verified};}
    const value = result.data as {file?: unknown; object_verified?: unknown} | null;
    if (!value || Object.keys(value).length !== 2 || typeof value.object_verified !== "boolean" || !("file" in value)) throw new Error("Invalid upload status");
    const file = value.file === null ? null : readClientDocument(value.file, candidate.scope);
    if (file && (file.id !== candidate.id || file.uploaded_by_user_id !== candidate.scope.actor
      || file.original_filename !== candidate.name || file.mime_type !== candidate.mime || file.size_bytes !== candidate.size)) throw new Error("Upload result changed");
    return {file, object: value.object_verified};
  }, [privateMode,privateThread]);
  const confirm = useCallback(async (candidate: Candidate, deadline: number, authorization:string) => {
    const l = life.current, generation = l.epoch;
    const current = () => l.alive && scopeAlive() && !l.signedOut && l.epoch === generation && sameDocumentScope(l.scope, candidate.scope);
    if (!current()) return false;
    const result = await inspect(candidate, deadline,authorization);
    if (!current()) return false;
    if (!result.file || result.file.upload_state !== "ready" || !result.object) return false;
    const read = await wait(supabase.from("client_files").select(CLIENT_DOCUMENT_COLUMNS+(privateMode?",customer_chat_thread_id":""))
      .eq("id", candidate.id).eq("tenant_id", candidate.scope.tenant).eq("contact_id", candidate.scope.contact).setHeader("x-client-portal-business",candidate.scope.tenant).setHeader("Authorization",authorization).maybeSingle(), deadline);
    if (read.error) throw new Error("Saved document could not be reloaded");
    const file = privateMode?readCustomerChatFile(read.data,candidate.scope):readClientDocument(read.data, candidate.scope);
    if (file.id !== candidate.id || file.storage_path !== result.file.storage_path || file.upload_state !== "ready"
      || file.uploaded_by_user_id !== candidate.scope.actor || file.original_filename !== candidate.name
      || file.mime_type !== candidate.mime || file.size_bytes !== candidate.size) throw new Error("Saved document changed");
    await verifiedAccess(deadline, candidate.scope,current);
    if (!current()) return false;
    l.files = [portalDocumentFromUpload(file), ...l.files.filter(f => f.id !== file.id)];
    setFiles(l.files); l.candidate = null;
    setUpload({kind: "saved", id: file.id, notice: privateMode?"File saved privately. It has not been sent in a message yet.":"Document uploaded. It is saved for your team."});
    return true;
  }, [inspect, verifiedAccess,scopeAlive,privateMode]);
  const transfer = useCallback(async (file?: File, reservationId?: string) => {
    const l = life.current, currentScope = l.scope;
    if (!l.alive || !scopeAlive() || l.signedOut || !currentScope || l.writing) return;
    const generation = l.epoch, current = () => l.alive && scopeAlive() && !l.signedOut && l.epoch === generation && sameDocumentScope(l.scope, currentScope);
    let candidate = l.candidate;
    if (candidate && !l.recoveryAllowed) return;
    if (candidate && !sameDocumentScope(candidate.scope, currentScope)) return;
    try {
      if (file) {
        const mime = clientDocumentMime(file);
        if(reservationId&&(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(reservationId)
          ||candidate&&candidate.id!==reservationId))throw new Error("Choose the original file to resume this upload.");
        if (candidate && (candidate.name !== file.name || candidate.mime !== mime || candidate.size !== file.size)) throw new Error("Choose the original file to resume this upload.");
        candidate ??= {id: reservationId??crypto.randomUUID(), name: file.name, mime, size: file.size, scope: currentScope, file};
        candidate.file = file;
      }
      if (!candidate) return;
    } catch (error) {setUpload({kind: "error", id: candidate?.id ?? null, notice: error instanceof Error ? error.message : "Choose a permitted file."}); return;}
    const attempt = candidate; l.candidate = attempt; l.writing = true; l.recoveryAllowed = false;
    const deadline = Date.now() + 120_000; let dispatched = false;
    setUpload({kind: "working", id: attempt.id, notice: "Saving your document…"});
    try {
      const access=await verifiedAccess(deadline,currentScope,current); if (!current()) return;
      // Retry uses the same canonical reservation ID and immutable object path.
      // Neither an overwrite nor a second file can result from a late reply.
      dispatched = true;
      const reserved = await wait(fileRpc(privateMode?"client_portal_begin_chat_file_upload":"client_portal_begin_file_upload", {p_file_id: attempt.id, p_filename: attempt.name,
        ...(privateMode?{p_thread_id:privateThread}:{}),
        p_expected_client_id: currentScope.contact, p_mime_type: attempt.mime, p_size_bytes: attempt.size, p_tenant_id: currentScope.tenant},currentScope,access.authorization), deadline);
      if (reserved.error) throw reserved.error;
      const row = privateMode?readCustomerChatFile(reserved.data,currentScope):readClientDocument(reserved.data, currentScope); if (!current()) return;
      if (row.id !== attempt.id || row.uploaded_by_user_id !== currentScope.actor) throw new Error("Upload reservation changed");
      const status = await inspect(attempt, deadline,access.authorization); if (!current()) return;
      if (row.upload_state !== "ready" && !status.object) {
        if (!attempt.file) {l.recoveryAllowed = true; setUpload({kind: "retry", id: attempt.id, notice: "Choose the original file to continue this unfinished upload."}); return;}
        setUpload({kind: "working", id: attempt.id, notice: "Uploading your document…"});
        const stored = await wait(supabase.storage.from("client-files").setHeader("Authorization",access.authorization).upload(row.storage_path, attempt.file, {contentType: attempt.mime, upsert: false}), deadline);
        if (stored.error) throw stored.error;
      }
      const finalAccess=await verifiedAccess(deadline,currentScope,current); if (!current()) return;
      setUpload({kind: "working", id: attempt.id, notice: privateMode?"Saving your private file…":"Saving your upload to your client record…"});
      const saved = await wait(fileRpc("client_portal_finish_file_upload", {p_file_id: attempt.id, p_tenant_id: currentScope.tenant},currentScope,finalAccess.authorization), deadline);
      if (saved.error) throw saved.error;
      if (!current() || !await confirm(attempt, deadline,finalAccess.authorization)) throw new Error("Unconfirmed upload");
      return privateMode ? attempt.id : undefined;
    } catch (error) {
      if (!current()) return;
      if (error instanceof AccessFailure || (error as {code?: string})?.code === "42501") retire("unavailable", privateMode?"Your customer access changed. Reopen the portal to continue.":"Your customer access changed. Reload Documents to continue.");
      else setUpload({kind: dispatched ? "uncertain" : "error", id: attempt.id,
        notice: dispatched ? "We couldn’t confirm your upload. Check its saved status before trying again." : "Your document could not be started. Check your connection and try again."});
    } finally {if (l.alive && l.epoch === generation) l.writing = false;}
  }, [confirm, inspect, retire, verifiedAccess,scopeAlive,privateMode,privateThread]);
  const checkUpload = useCallback(async (row?: PortalDocument) => {
    const l = life.current, currentScope = l.scope;
    if (!l.alive || !scopeAlive() || l.signedOut || !currentScope || l.writing) return;
    const candidate = row ? l.candidate?.id === row.id ? l.candidate : {id: row.id, name: row.filename, mime: row.mime_type ?? "", size: row.size_bytes ?? 0, scope: currentScope, file: null} : l.candidate;
    if (!candidate || !sameDocumentScope(candidate.scope, currentScope) || (row && row.source !== "you")) return;
    const generation = l.epoch, current = () => l.alive && scopeAlive() && !l.signedOut && l.epoch === generation && sameDocumentScope(l.scope, currentScope);
    l.writing = true; l.candidate = candidate; l.recoveryAllowed = false;
    setUpload({kind: "working", id: candidate.id, notice: "Checking your saved upload…"});
    try {
      const deadline = Date.now() + 20_000; const access=await verifiedAccess(deadline,currentScope,current);
      const status = await inspect(candidate, deadline,access.authorization); if (!current()) return;
      if (status.file?.upload_state === "ready" && status.object) {
        if (!await confirm(candidate, deadline,access.authorization)) throw new Error("Unconfirmed upload");
        return privateMode ? candidate.id : undefined;
      }
      else {await verifiedAccess(deadline, currentScope,current); if (current()) {
        l.recoveryAllowed = true;
        setUpload({kind: status.object ? "finish" : "retry", id: candidate.id,
          notice: status.object ? privateMode?"Your file is stored. Finish saving it privately.":"Your file is stored. Finish saving it to your client record." : "The transfer is unfinished. You can retry the same upload."});
      }}
    } catch (error) {if (current()) {
      if (error instanceof AccessFailure) retire("unavailable", error.message);
      else setUpload({kind: "uncertain", id: candidate.id, notice: "The upload status could not be confirmed. Check your connection and try again."});
    }} finally {if (l.alive && l.epoch === generation) l.writing = false;}
  }, [confirm, inspect, retire, verifiedAccess,scopeAlive,privateMode]);
  const stopWaiting = useCallback(() => {
    const l = life.current;
    if (!l.alive || !scopeAlive() || l.signedOut || !l.writing || !l.candidate) return;
    ++l.epoch; ++l.read; l.writing = false; l.recoveryAllowed = false;
    setUpload({kind: "uncertain", id: l.candidate.id,
      notice: privateMode?"Stopped waiting here. Your private file may still be uploading; check its saved status before trying again.":"Stopped waiting here. The upload may have reached your business; check its saved status before trying again."});
  }, [scopeAlive,privateMode]);
  /**
   * Two short-lived signed links for one listed, saved file: one to view, one that downloads under its
   * own name. The path comes only from the closed list read; Storage re-checks the file's permission
   * when each link is minted, and neither link is kept after the preview closes.
   */
  const retrieve = useCallback(async (row: PortalDocument): Promise<DocumentLinks | null> => {
    const l = life.current, expected = l.scope, generation = l.epoch;
    const listed = l.files.find(f => f.id === row.id);
    if (!l.alive || !scopeAlive() || l.signedOut || !expected || row.state !== "ready" || !listed || listed.storage_path !== row.storage_path) return null;
    try {
      const deadline = Date.now() + 20_000;
      const access=await verifiedAccess(deadline,expected,()=>l.alive&&scopeAlive()&&!l.signedOut&&l.epoch===generation);
      if (!l.alive || l.epoch !== generation) return null;
      const bucket = supabase.storage.from("client-files").setHeader("Authorization",access.authorization);
      const [view, download] = await wait(Promise.all([
        bucket.createSignedUrl(row.storage_path, DOCUMENT_LINK_SECONDS),
        bucket.createSignedUrl(row.storage_path, DOCUMENT_LINK_SECONDS, {download: row.filename}),
      ]), deadline);
      const minted = Date.now();
      if (view.error || download.error || !view.data?.signedUrl || !download.data?.signedUrl) {
        throw new Error("This document could not be opened. Try again or contact the business.");
      }
      await verifiedAccess(deadline,expected,()=>l.alive&&scopeAlive()&&!l.signedOut&&l.epoch===generation);
      return l.alive && scopeAlive() && !l.signedOut && l.epoch === generation && sameDocumentScope(l.scope, expected)
        ? {view: view.data.signedUrl, download: download.data.signedUrl, expiresAt: minted + DOCUMENT_LINK_SECONDS * 1000} : null;
    } catch (error) {
      if (!l.alive || l.epoch !== generation) return null;
      if (error instanceof AccessFailure) {retire("unavailable", error.message); return null;}
      throw error;
    }
  }, [retire, verifiedAccess,scopeAlive]);
  const isCurrent=useCallback((expected:number)=>life.current.alive&&scopeAlive()&&!life.current.signedOut&&viewEpoch.current===expected&&dataGeneration.current===origin.current.generation&&!!life.current.scope,[scopeAlive]);
  const masked=!scopeAlive()||dataGeneration.current!==origin.current.generation;
  return {phase:!privateAllowed?"unavailable" as const:masked?"loading" as const:phase,files:masked?[]:files,summary:masked?null:summary,scope:masked?null:scope,more:masked?false:more,reading:masked?enabled:reading,notice:!privateAllowed?"Your private conversation could not be verified.":masked?"":notice,upload:privateMode&&masked?idle():upload,epoch:Math.max(epoch,viewEpoch.current),refresh,transfer,checkUpload,stopWaiting,retrieve,isCurrent};
}

export type PrivateClientDocuments = ReturnType<typeof useClientDocumentsConsumer>;
type OriginalClientDocuments = Omit<PrivateClientDocuments, "transfer" | "checkUpload"> & {
  transfer: (file?: File) => Promise<void>;
  checkUpload: (row?: PortalDocument) => Promise<void>;
};
// Existing no-argument callers keep their original void-returning API. The
// explicit private purpose alone exposes its independently verified saved ID.
export function useClientDocuments(purpose: PrivateDocumentPurpose): PrivateClientDocuments;
export function useClientDocuments(): OriginalClientDocuments;
export function useClientDocuments(purpose?: PrivateDocumentPurpose): PrivateClientDocuments | OriginalClientDocuments {
  return useClientDocumentsConsumer(purpose);
}

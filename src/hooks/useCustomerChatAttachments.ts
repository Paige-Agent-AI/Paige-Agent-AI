import {useCallback, useEffect, useRef, useState, type ClipboardEvent, type DragEvent} from "react";
import {useClientDocuments} from "./useClientDocuments";
import {transferFiles, hasFileDrag} from "./useChatDocumentUpload";
import {selectCustomerChatFiles, type CustomerChatFileDraft, type CustomerChatFileSelection} from "@/lib/customer-chat-files";
import type {DocumentScope} from "@/lib/client-portal-documents";

export type CustomerAttachmentDraft = CustomerChatFileDraft & {phase: "selected" | "saving" | "saved" | "check"};
export type CustomerAttachmentPreparation = {status: "ready"; ids: string[]} | {status: "not_ready" | "changed"};
type Operation = {cancelled: boolean; cancel: () => void; interrupted: Promise<undefined>;
  fileId: string | null; dispatched: boolean; previousPhase: CustomerAttachmentDraft["phase"]};
type DraftState = {
  key: string; epoch: number; alive: boolean; files: CustomerAttachmentDraft[];
  issues: CustomerChatFileSelection["issues"]; notice: string; operation: Operation | null;
  scope: DocumentScope | null; choiceGeneration: number; pendingChoice: readonly File[] | null;
};

function interruptDraftOperation(life: DraftState, operation: Operation) {
  operation.cancel(); life.operation = null;
  life.files.forEach(file => {
    if (file.id === operation.fileId && file.phase === "saving")
      file.phase = operation.dispatched ? "check" : operation.previousPhase;
  });
  life.notice = operation.dispatched
    ? "Your access was checked again. Check the original upload before continuing."
    : "Your selected files are kept. No upload started here.";
}

/** Ephemeral composer selection only. The original Documents hook owns every
 * reservation, upload, verification, link and uncertain-result recovery.
 * This does not submit a message, extract content or persist another file store.
 */
export function useCustomerChatAttachments(threadId: string | null, available: boolean) {
  const documents = useClientDocuments({kind: "customer_private", threadId: threadId ?? ""});
  const latest = useRef(documents); latest.current = documents;
  const admitted = useRef(available); admitted.current = available;
  const origin = useRef<DraftState | null>(null);
  // The original Documents epoch retires actor/business/contact/thread changes.
  // A temporary masked recheck is not a new owner for these local File objects.
  // No file is exposed or dispatched until current native access returns.
  const scope = documents.scope ?? origin.current?.scope ?? null;
  const key = JSON.stringify([threadId, documents.epoch, scope]);
  const makeState = (): DraftState => ({key, epoch: documents.epoch, scope, alive: true,
    files: [], issues: [], notice: "", operation: null, choiceGeneration: 0, pendingChoice: null});
  if (!origin.current || origin.current.key !== key) {
    if (origin.current) {origin.current.alive = false; origin.current.operation?.cancel();}
    origin.current = makeState();
  }
  const life = origin.current;
  const [snapshot, setSnapshot] = useState({life, files: life.files, issues: life.issues, notice: "", busy: false});
  const current = useCallback(() => origin.current === life && life.alive && admitted.current
    && latest.current.phase === "ready" && latest.current.isCurrent(life.epoch), [life]);
  const publish = useCallback(() => {
    if (current()) setSnapshot({life, files: [...life.files], issues: [...life.issues], notice: life.notice, busy: !!life.operation});
  }, [life, current]);
  useEffect(() => {
    life.alive = true;
    return () => {life.alive = false; life.operation?.cancel();};
  }, [life]);
  const begin = useCallback((): Operation | null => {
    if (!current() || life.operation) return null;
    let release!: () => void;
    const interrupted = new Promise<undefined>(resolve => {release = () => resolve(undefined);});
    const operation: Operation = {cancelled: false, interrupted, fileId: null, dispatched: false, previousPhase: "selected",
      cancel: () => {operation.cancelled = true; release();}};
    life.operation = operation; life.notice = ""; publish();
    return operation;
  }, [life, current, publish]);
  const finish = useCallback((operation: Operation) => {
    if (life.operation === operation) {
      if (!current()) interruptDraftOperation(life, operation); else life.operation = null;
      publish();
    }
  }, [life, current, publish]);
  const save = useCallback(async (file: CustomerAttachmentDraft, operation: Operation, check: boolean) => {
    if (!current() || operation.cancelled) return false;
    operation.fileId = file.id; operation.dispatched = false; operation.previousPhase = file.phase;
    file.phase = "saving"; publish();
    try {
      const result = await Promise.race([Promise.resolve().then(() => {
        if (!current() || operation.cancelled) return undefined;
        operation.dispatched = true;
        return check ? latest.current.checkUpload() : latest.current.transfer(file.file, file.id);
      }), operation.interrupted]);
      if (!current() || operation.cancelled) return false;
      // Only the original independently verified object + metadata result can
      // identify a saved selection. Never promote a different returned file.
      file.phase = result === file.id ? "saved" : "check";
      life.notice = result === file.id ? "File saved privately. It has not been sent yet."
        : "Check this upload before continuing. Your other selected files are kept.";
      publish();
      return result === file.id;
    } catch {
      if (current() && !operation.cancelled) {
        file.phase = "check"; life.notice = "The upload could not be confirmed. Check its saved status."; publish();
      }
      return false;
    }
  }, [life, current, publish]);
  const append = useCallback((incoming: readonly File[]) => {
    if (!current() || life.operation || life.files.some(f => f.phase === "check")) return;
    const selection = selectCustomerChatFiles(life.files, incoming);
    life.files = selection.files.map(file => life.files.find(previous => previous.id === file.id) ?? {...file, phase: "selected"});
    life.issues = selection.issues; life.notice = ""; publish();
  }, [life, current, publish]);
  const beginSelection = useCallback(() => {
    if (!current() || life.operation || life.files.some(file => file.phase === "check")) return null;
    const choice = ++life.choiceGeneration;
    return (incoming: readonly File[]) => {
      if (origin.current !== life || !life.alive || latest.current.epoch !== life.epoch
        || choice !== life.choiceGeneration) return;
      ++life.choiceGeneration; // One chooser completion, never an upload/send receipt.
      if (!incoming.length || life.operation || life.files.some(file => file.phase === "check")) return;
      if (current()) append(incoming);
      else life.pendingChoice = [...incoming];
    };
  }, [life, current, append]);
  useEffect(() => {
    if (!current()) {
      const operation = life.operation;
      if (operation) interruptDraftOperation(life, operation);
      return;
    }
    const pending = life.pendingChoice; life.pendingChoice = null;
    if (pending) append(pending); else publish();
  }, [life, current, publish, append, available, documents.phase, documents.epoch, documents.isCurrent]);
  const handlePaste = useCallback((event: Pick<ClipboardEvent, "clipboardData" | "preventDefault">) => {
    const files = transferFiles(event.clipboardData);
    if (!files.length) return; // Text, HTML and URLs keep native insertion; never fetch or invent a file.
    event.preventDefault();
    append(files);
  }, [append]);
  const handleDrop = useCallback((event: Pick<DragEvent, "dataTransfer" | "preventDefault" | "stopPropagation">) => {
    if (!hasFileDrag(event.dataTransfer) && !event.dataTransfer.files?.length) return;
    event.preventDefault(); event.stopPropagation();
    append(transferFiles(event.dataTransfer));
  }, [append]);
  const handleDragOver = useCallback((event: Pick<DragEvent, "dataTransfer" | "preventDefault" | "stopPropagation">) => {
    if (!hasFileDrag(event.dataTransfer)) return;
    event.preventDefault(); event.stopPropagation();
    event.dataTransfer.dropEffect = current() && !life.operation && !life.files.some(f => f.phase === "check") ? "copy" : "none";
  }, [life, current]);
  const remove = useCallback((id: string) => {
    if (!current() || life.operation) return;
    const file = life.files.find(f => f.id === id);
    if (!file || file.phase === "check" || file.phase === "saving") return;
    // Removing a selection never deletes an original stored object.
    life.files = life.files.filter(f => f.id !== id); life.issues = []; publish();
  }, [life, current, publish]);
  const prepare = useCallback(async (): Promise<CustomerAttachmentPreparation> => {
    if (!current()) return {status: "changed"};
    if (life.files.some(f => f.phase === "check")) return {status: "not_ready"};
    const operation = begin(); if (!operation) return {status: "not_ready"};
    const selected = [...life.files];
    try {
      for (const file of selected) {
        if (!current() || operation.cancelled) return {status: current() ? "not_ready" : "changed"};
        if (file.phase !== "saved" && !await save(file, operation, false)) {
          return {status: current() ? "not_ready" : "changed"};
        }
      }
      if (!current()) return {status: "changed"};
      return operation.cancelled ? {status: "not_ready"} : {status: "ready", ids: selected.map(f => f.id)};
    } finally {finish(operation);}
  }, [life, current, begin, finish, save]);
  const recover = useCallback(async (id: string, resume: boolean) => {
    if (!current()) return false;
    const file = life.files.find(f => f.id === id), upload = latest.current.upload;
    if (!file || file.phase !== "check" || upload.id !== id
      || resume && !["retry", "finish"].includes(upload.kind)) return false;
    const operation = begin(); if (!operation) return false;
    try {return await save(file, operation, !resume);} finally {finish(operation);}
  }, [life, current, begin, finish, save]);
  const stop = useCallback(() => {
    if (!current() || !life.operation) return;
    const operation = life.operation;
    if (operation.dispatched) latest.current.stopWaiting();
    operation.cancel(); life.operation = null;
    life.files.forEach(file => {
      if (file.phase === "saving" && file.id === operation.fileId)
        file.phase = operation.dispatched ? "check" : operation.previousPhase;
    });
    life.notice = operation.dispatched ? "Stopped waiting here. Check the original upload before continuing."
      : "Stopped before the upload started. Your selected files are kept.";
    publish();
  }, [life, current, publish]);
  const releaseSentSelection = useCallback((ids: readonly string[]) => {
    if (!current() || life.operation || ids.length !== life.files.length
      || life.files.some((file, index) => file.phase !== "saved" || file.id !== ids[index])) return false;
    // The caller uses this only after the original native message acceptance.
    // It clears a local selection; it cannot create a send receipt or delete files.
    life.files = []; life.issues = []; life.notice = ""; publish(); return true;
  }, [life, current, publish]);
  const visible = snapshot.life === life && current();
  const nativeUpload = visible && snapshot.files.some(file => file.id === documents.upload.id)
    ? documents.upload : {kind: "idle" as const, id: null, notice: ""};
  return {
    files: visible ? snapshot.files : [], issues: visible ? snapshot.issues : [],
    notice: visible ? snapshot.notice : "", busy: visible && snapshot.busy, available: current(),
    nativeUpload, openFile:documents.retrieve, append, beginSelection, handlePaste, handleDrop, handleDragOver, remove, prepare,
    check: (id: string) => recover(id, false), resume: (id: string) => recover(id, true), stop, releaseSentSelection,
  };
}

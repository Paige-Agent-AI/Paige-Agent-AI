import { useState, useCallback, useRef, useEffect, type Dispatch, type SetStateAction } from "react";
import { useToast } from "@/hooks/use-toast";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export type AttachedDocKind = "pdf" | "image" | "docx";

const ACCEPTED_MIME_BY_KIND: Record<AttachedDocKind, string[]> = {
  pdf: ["application/pdf"],
  image: ["image/jpeg", "image/jpg", "image/png", "image/webp"],
  docx: [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ],
};

const ALL_ACCEPT_STRING =
  "application/pdf,image/jpeg,image/png,image/webp," +
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function detectKind(mime: string, name: string): AttachedDocKind | null {
  if (ACCEPTED_MIME_BY_KIND.pdf.includes(mime)) return "pdf";
  if (ACCEPTED_MIME_BY_KIND.image.includes(mime)) return "image";
  if (ACCEPTED_MIME_BY_KIND.docx.includes(mime)) return "docx";
  // Extension fallback is for missing/generic browser MIME, never an explicit unsupported type.
  if (mime && mime !== "application/octet-stream") return null;
  if (/\.docx$/i.test(name)) return "docx";
  if (/\.pdf$/i.test(name)) return "pdf";
  if (/\.(jpe?g|png|webp)$/i.test(name)) return "image";
  return null;
}

export interface AttachedDocument {
  file: File;
  name: string;
  kind: AttachedDocKind;
  mimeType: string;
  size: number;
  /** base64 of the raw bytes (for PDF + image). Empty for docx. */
  base64: string;
  /** Plain-text content extracted client-side (DOCX only). */
  textContent?: string;
}

async function fileToBase64(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(i, i + chunkSize));
  }
  return btoa(binary);
}

// The paige-ai-chat edge caps document.textContent at 200k chars (a ZodError → hard 400 above
// that) and only inlines the first 80k into the model turn. Cap here (§18 one home) so a
// legitimate long DOCX under the 10MB file gate can't hard-fail the send and silently drop the
// attachment — lossless vs what the model actually reads.
const MAX_DOCX_TEXT_CHARS = 80_000;

async function extractDocxText(file: File): Promise<string> {
  // Lazy-load mammoth so it doesn't bloat the initial chunk.
  const mammoth = await import("mammoth/mammoth.browser");
  const arrayBuffer = await file.arrayBuffer();
  // mammoth's browser build ships no types for extractRawText.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await (mammoth as any).extractRawText({ arrayBuffer });
  const text = (result?.value || "").trim();
  return text.length > MAX_DOCX_TEXT_CHARS ? text.slice(0, MAX_DOCX_TEXT_CHARS) : text;
}

export interface ChatDocumentUploadOptions {
  /** Complete composer identity, including the requested conversation. null fails closed. */
  scopeKey?: string | null;
  enabled?: boolean;
}

function transferFiles(data: DataTransfer): File[] {
  // Browsers can expose one payload in both lists. Prefer files, then fall back to real items.
  const files = Array.from(data.files ?? []);
  if (files.length) return files;
  return Array.from(data.items ?? []).filter(item => item.kind === "file")
    .map(item => item.getAsFile()).filter((file): file is File => file !== null);
}

function hasFileDrag(data: DataTransfer): boolean {
  return Array.from(data.types ?? []).includes("Files")
    || Array.from(data.items ?? []).some(item => item.kind === "file");
}

function documentMime(file: File, kind: AttachedDocKind): string {
  if (file.type && file.type !== "application/octet-stream") return file.type === "image/jpg" ? "image/jpeg" : file.type;
  if (kind === "pdf") return "application/pdf";
  if (kind === "docx") return ACCEPTED_MIME_BY_KIND.docx[0];
  return /\.jpe?g$/i.test(file.name) ? "image/jpeg" : /\.webp$/i.test(file.name) ? "image/webp" : "image/png";
}

export function useChatDocumentUpload({ scopeKey = "unscoped", enabled = true }: ChatDocumentUploadOptions = {}) {
  const [state, setState] = useState<{ scope: string | null; epoch: number; doc: AttachedDocument | null; processing: boolean; drag: boolean }>({ scope: scopeKey, epoch: 0, doc: null, processing: false, drag: false });
  const owner = useRef({ scope: scopeKey, epoch: 0, generation: 0, enabled, mounted: true, processing: false });
  // Fence during render, before scope-switch effects or a late promise can deliver. Epoch prevents ABA.
  if (owner.current.scope !== scopeKey) {
    owner.current.scope = scopeKey;
    owner.current.epoch += 1;
    owner.current.generation += 1;
    owner.current.processing = false;
  }
  owner.current.enabled = enabled;
  const scopeEpoch = owner.current.epoch;
  useEffect(() => {
    setState({ scope: scopeKey, epoch: scopeEpoch, doc: null, processing: false, drag: false });
  }, [scopeKey, scopeEpoch]);
  useEffect(() => {
    const lifetime = owner.current;
    lifetime.mounted = true;
    return () => { lifetime.mounted = false; lifetime.generation += 1; };
  }, []);
  const visible = state.scope === scopeKey && state.epoch === scopeEpoch && scopeKey !== null;
  const attachedDoc = visible ? state.doc : null;
  const isProcessingFile = visible && state.processing;
  const isDragOver = visible && enabled && state.drag;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const processFile = useCallback(
    async (file: File) => {
      const current = owner.current;
      if (!current.mounted || !current.enabled || current.scope === null) {
        toast({ title: "Attachment not ready", description: "Wait for this conversation to be ready, then attach your file." });
        return;
      }
      const scope = current.scope;
      const epoch = current.epoch;
      const generation = ++current.generation;
      const accepted = () => owner.current.mounted && owner.current.scope === scope
        && owner.current.epoch === epoch && owner.current.generation === generation;
      current.processing = false;
      setState(prev => ({ scope, epoch, doc: prev.scope === scope && prev.epoch === epoch ? prev.doc : null, processing: false, drag: false }));
      const kind = detectKind(file.type, file.name);
      if (!kind) {
        toast({
          title: "Unsupported file type",
          description: "Paige can read PDF, JPG, PNG, WEBP, and DOCX files.",
          variant: "destructive",
        });
        return;
      }

      if (file.size > MAX_FILE_SIZE) {
        toast({
          title: "File too large",
          description: "Maximum file size is 10MB.",
          variant: "destructive",
        });
        return;
      }

      current.processing = true;
      setState(prev => ({ scope, epoch, doc: prev.scope === scope && prev.epoch === epoch ? prev.doc : null, processing: true, drag: false }));
      try {
        let document: AttachedDocument;
        if (kind === "docx") {
          const textContent = await extractDocxText(file);
          if (!accepted()) return;
          if (!textContent) {
            toast({
              title: "Could not read DOCX",
              description:
                "The document appears empty or unreadable. Try saving it as a PDF.",
              variant: "destructive",
            });
            return;
          }
          document = {
            file,
            name: file.name,
            kind,
            mimeType: documentMime(file, kind),
            size: file.size,
            base64: "",
            textContent,
          };
        } else {
          const base64 = await fileToBase64(file);
          if (!accepted()) return;
          document = {
            file,
            name: file.name,
            kind,
            mimeType: documentMime(file, kind),
            size: file.size,
            base64,
          };
        }
        setState(prev => {
          if (!accepted()) return prev;
          return { scope, epoch, doc: document, processing: false, drag: false };
        });
      } catch (err) {
        if (!accepted()) return;
        console.error("File processing failed:", err);
        toast({
          title: "Error reading file",
          description:
            "Could not process the file. Please try a different one.",
          variant: "destructive",
        });
      } finally {
        if (accepted()) {
          owner.current.processing = false;
          setState(prev => accepted() ? { ...prev, processing: false } : prev);
        }
      }
    },
    [toast],
  );

  const stageFiles = useCallback((files: File[]) => {
    if (!files.length) return;
    const supported = files.find(file => detectKind(file.type, file.name) && file.size <= MAX_FILE_SIZE);
    const first = supported ?? files[0];
    if (files.length > 1) toast({ title: "One attachment at a time", description: supported
      ? "Only the first supported file within 10MB is selected. Attach the others in separate messages."
      : "None of these files can be attached. Choose a supported file up to 10MB." });
    // A replacement is intentional, but must be communicated instead of silently losing a chip.
    if (supported && state.scope === owner.current.scope && state.epoch === owner.current.epoch && state.doc && owner.current.enabled) {
      toast({ title: "Replacing attachment", description: `The new file will replace ${state.doc.name} when it is ready.` });
    }
    void processFile(first);
  }, [processFile, state.doc, state.scope, state.epoch, toast]);

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      stageFiles(Array.from(e.target.files ?? []));
      if (e.target) e.target.value = "";
    },
    [stageFiles],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!hasFileDrag(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = owner.current.enabled && owner.current.scope !== null ? "copy" : "none";
    const { scope, epoch } = owner.current;
    setState(prev => ({ scope, epoch, doc: prev.scope === scope && prev.epoch === epoch ? prev.doc : null, processing: owner.current.processing, drag: true }));
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
    e.preventDefault();
    e.stopPropagation();
    setState(prev => ({ ...prev, drag: false }));
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      if (!hasFileDrag(e.dataTransfer) && !e.dataTransfer.files?.length) return;
      e.preventDefault();
      e.stopPropagation();
      setState(prev => ({ ...prev, drag: false }));
      stageFiles(transferFiles(e.dataTransfer));
    },
    [stageFiles],
  );

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const files = transferFiles(e.clipboardData);
    if (!files.length) return; // Native text/URL/HTML insertion, no URL fetching.
    e.preventDefault(); // Actual file payload wins over its accompanying text representation.
    stageFiles(files);
  }, [stageFiles]);

  const clearDrag = useCallback(() => setState(prev => ({ ...prev, drag: false })), []);
  const preventFileNavigation = useCallback((e: React.DragEvent) => {
    if (!hasFileDrag(e.dataTransfer) && !e.dataTransfer.files?.length) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "none";
    clearDrag();
    if (e.type === "drop") toast({ title: "Drop on the message box", description: "Drop your file directly onto the composer to attach it." });
  }, [clearDrag, toast]);

  const setAttachedDoc: Dispatch<SetStateAction<AttachedDocument | null>> = useCallback(value => {
    owner.current.generation += 1;
    owner.current.processing = false;
    const scope = owner.current.scope;
    const epoch = owner.current.epoch;
    setState(prev => ({ scope, epoch, doc: typeof value === "function" ? value(prev.scope === scope && prev.epoch === epoch ? prev.doc : null) : value, processing: false, drag: false }));
  }, []);

  const removeAttachment = useCallback(() => {
    setAttachedDoc(null);
  }, [setAttachedDoc]);

  const openFilePicker = useCallback(() => {
    if (!owner.current.enabled || owner.current.scope === null) return;
    fileInputRef.current?.click();
  }, []);

  return {
    attachedDoc,
    isProcessingFile,
    isDragOver,
    fileInputRef,
    acceptString: ALL_ACCEPT_STRING,
    handleFileSelect,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handlePaste,
    clearDrag,
    preventFileNavigation,
    processingFileNow: () => owner.current.processing,
    removeAttachment,
    openFilePicker,
    setAttachedDoc,
  };
}

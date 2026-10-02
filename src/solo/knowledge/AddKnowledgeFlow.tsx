import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  ExtractionConsumerError, readKnowledgeExtractionReview, readKnowledgeExtractionStatus,
  submitKnowledgeExtraction, type ExtractionClient, type ExtractionInput, type ExtractionReference, type ExtractionReview,
} from "@/lib/knowledge-extraction-service";
import {
  KnowledgeReviewServiceError, readKnowledgePublicationStatus, saveKnowledgeReview, sha256Hex,
} from "@/lib/knowledge-review-service";
import { KnowledgeServiceError, submitKnowledgePublication } from "@/lib/knowledge-service";

type HaltAction = "retry-submit" | "check-extraction" | "reread" | "retry-publish" | "check-publication";
type Halt = { title: string; message: string; action: HaltAction | null };
type Step = "choose" | "extracting" | "review" | "ready" | "publishing" | "done";

/** The governed add flow: submit a source, review what Paige extracted, publish the exact
 * reviewed text. Every uncertain state is named honestly and never resolved by a second,
 * different write — a retry replays the same intent, and recovery settles the rest.
 */
export function AddKnowledgeFlow({ tenantId, onPublished, onClose }: {
  tenantId: string; onPublished?: () => void; onClose: () => void;
}) {
  const [step, setStep] = useState<Step>("choose");
  const [mode, setMode] = useState<"paste" | "file">("paste");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [reviewContent, setReviewContent] = useState("");
  const [summary, setSummary] = useState("");
  const [category, setCategory] = useState("");
  const [tags, setTags] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [halt, setHalt] = useState<Halt | null>(null);
  const reference = useRef<ExtractionReference | null>(null);
  const review = useRef<ExtractionReview | null>(null);
  const savedRevision = useRef<number | null>(null);
  const publishWorkId = useRef<string | null>(null);
  const extractIntent = useRef<string | null>(null);
  const publishIntent = useRef<string | null>(null);
  const busy = useRef(false);
  const mounted = useRef(true);
  const scope = useRef({ tenantId });
  const pollRun = useRef(0);
  if (scope.current.tenantId !== tenantId) scope.current = { tenantId };
  const attemptScope = scope.current;
  useEffect(() => {
    mounted.current = true;
    const run = pollRun.current;
    return () => { mounted.current = false; pollRun.current = run + 1; };
  }, []);
  const current = () => mounted.current && scope.current === attemptScope;
  // The generated supabase client's rpc() keys on a known function-name union; the shared
  // ports take a plain name, so the call is widened once here.
  const rpcByName = supabase.rpc as unknown as (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
  const client: ExtractionClient = {
    functions: { invoke: (name, options) => supabase.functions.invoke(name, options) },
    rpc: rpcByName,
  };
  const extractionScope = () => ({ tenantId, isCurrent: () => current() });
  const stop = (next: Halt) => { setHalt(next); setNotice(null); };

  const loadReview = async (ref: ExtractionReference) => {
    const read = await readKnowledgeExtractionReview(client, extractionScope(), ref);
    if (!current()) return;
    if (read.phase !== "awaiting_review" || !read.pending_review) {
      stop({ title: "Review unavailable", message: "The extracted review is no longer available for this source. Nothing was published; add the source again if it should be re-read.", action: null });
      return;
    }
    review.current = read;
    setReviewContent(read.pending_review.reviewed_content ?? read.pending_review.extracted_content);
    setStep("review");
    setNotice(null);
  };

  const watchExtraction = async (ref: ExtractionReference, attempt: number, run: number) => {
    if (!current() || pollRun.current !== run) return;
    let status;
    try { status = await readKnowledgeExtractionStatus(client, extractionScope(), ref); }
    catch {
      if (current() && pollRun.current === run) stop({ title: "Reading status failed", message: "Paige's progress could not be read right now. The reading itself was not cancelled — check again in a moment.", action: "check-extraction" });
      return;
    }
    if (!current() || pollRun.current !== run) return;
    if (status.work_status === "succeeded") { await loadReview(ref); return; }
    if (status.work_status === "claimed" || status.work_status === "expired") {
      if (attempt >= 40) { stop({ title: "Still reading", message: "Paige is still reading this source. You can close this — the reading continues, and the source appears in Knowledge only after you review and publish it.", action: "check-extraction" }); return; }
      setNotice("Paige is reading your source…");
      setTimeout(() => void watchExtraction(ref, attempt + 1, run), 1500);
      return;
    }
    if (status.work_status === "blocked") { stop({ title: "Reading paused", message: status.safe_summary ?? "Reading is paused because workspace access changed. Restore access, then check again.", action: "check-extraction" }); return; }
    if (status.work_status === "outcome_unknown") { stop({ title: "Reading outcome unconfirmed", message: "Paige could not confirm whether this reading completed. Recovery will reconcile it — do not submit the source again; check its status instead.", action: "check-extraction" }); return; }
    stop({ title: "Reading failed", message: status.safe_summary ?? "Paige could not read this source. Nothing was added to Knowledge.", action: null });
  };

  /** A file is uploaded to the workspace bucket first; extraction reads it from there. A
   * lost acknowledgement after upload may leave the stored object behind — cleanup belongs
   * to the reconciled lifecycle, not to a second browser write.
   */
  const uploadFile = async (): Promise<string> => {
    if (!file) throw new ExtractionConsumerError("EXTRACTION_INPUT_INVALID", "Choose a file.");
    const safe = file.name.replace(/[^\w.-]/g, "_");
    const path = `${tenantId}/${crypto.randomUUID()}_${safe}`;
    const { error: uploadError } = await supabase.storage.from("tenant-knowledge").upload(path, file);
    if (uploadError) throw new ExtractionConsumerError("EXTRACTION_INPUT_INVALID", "The file could not be uploaded. Check your connection and try again.");
    return path;
  };

  const submit = async () => {
    if (busy.current || !tenantId) return;
    const trimmed = title.trim();
    if (!trimmed || trimmed.length > 300) { setNotice("Give the source a title of 1–300 characters."); return; }
    if (mode === "paste" && !content.trim()) { setNotice("Paste the text Paige should read."); return; }
    if (mode === "file" && !file) { setNotice("Choose a text file for Paige to read."); return; }
    if (mode === "file" && file && !/\.(txt|md|markdown|csv|json)$/i.test(file.name)) { setNotice("Paige reads .txt, .md, .markdown, .csv and .json files. Other formats arrive with expanded format support."); return; }
    if (mode === "file" && file && file.size > 2097152) { setNotice("Paige reads text files up to 2 MB — try a smaller one."); return; }
    busy.current = true; setHalt(null); setNotice("Sending to Paige…"); setStep("extracting");
    try {
      if (!extractIntent.current) extractIntent.current = crypto.randomUUID();
      const intentId = extractIntent.current;
      const input: ExtractionInput = mode === "paste"
        ? { intent_id: intentId, title: trimmed, kind: "paste", content }
        : { intent_id: intentId, title: trimmed, kind: "file", path: await uploadFile() };
      const submission = await submitKnowledgeExtraction(client, extractionScope(), input);
      if (!current()) return;
      reference.current = submission.reference;
      const run = ++pollRun.current;
      setNotice("Paige is reading your source…");
      setTimeout(() => void watchExtraction(submission.reference, 0, run), 800);
    } catch (error) {
      if (!current()) return;
      if (error instanceof ExtractionConsumerError && error.submissionUncertain) {
        stop({ title: "Submission unconfirmed", message: "Paige may or may not have received this source — it was not rejected. Retry sends the same request again, never a duplicate.", action: "retry-submit" });
      } else if (error instanceof ExtractionConsumerError) {
        stop({ title: "Submission refused", message: plainRefusal(error), action: null });
      } else {
        stop({ title: "Submission failed", message: "The source could not be sent. Retry sends the same request again, never a duplicate.", action: "retry-submit" });
      }
    } finally { busy.current = false; }
  };

  const saveReview = async () => {
    if (busy.current || step !== "review" || !review.current || !reference.current || !tenantId) return;
    const parsedTags = [...new Set(tags.split(",").map(tag => tag.trim()).filter(Boolean))];
    if (!title.trim() || title.trim().length > 300 || summary.length > 2000 || category.length > 100 || parsedTags.length > 20 || parsedTags.some(tag => tag.length > 60)) {
      setNotice("Use a title of 1–300 characters, a summary up to 2,000, a category up to 100, and at most 20 tags of 60 characters each.");
      return;
    }
    if (!reviewContent.trim()) { setNotice("Keep at least some of the extracted text — this exact text becomes the Knowledge source."); return; }
    busy.current = true; setHalt(null); setNotice("Saving your review…");
    try {
      const saved = await saveKnowledgeReview(supabase, tenantId, review.current.document_id, review.current.extraction_work_id, review.current.revision, reviewContent, { title: title.trim(), summary: summary || null, category: category || null, tags: parsedTags });
      if (!current()) return;
      savedRevision.current = saved.revision;
      setStep("ready");
      setNotice(saved.outcome === "capability_completed_unrecorded" ? "Review saved. The activity receipt could not be recorded; do not repeat the save." : "Review saved.");
    } catch (error) {
      if (!current()) return;
      if (error instanceof KnowledgeReviewServiceError && error.code === "40001") {
        stop({ title: "Review changed", message: "This source changed since you opened it — it may have been reviewed elsewhere. Reload the current review before saving again.", action: "reread" });
      } else if (error instanceof KnowledgeReviewServiceError && ["42501", "22023", "P0002", "55000"].includes(error.code)) {
        stop({ title: "Review refused", message: "The save was refused. Check your workspace and access, then reload the review before trying again.", action: "reread" });
      } else {
        stop({ title: "Save unconfirmed", message: "Paige could not confirm this save. Do not repeat it — reload the review and check whether your text is already saved.", action: "reread" });
      }
    } finally { busy.current = false; }
  };

  const publish = async (retry = false) => {
    if (busy.current || (!retry && step !== "ready") || !reference.current || savedRevision.current === null || !tenantId) return;
    busy.current = true; setHalt(null); setNotice("Publishing…");
    if (!publishIntent.current) publishIntent.current = crypto.randomUUID();
    try {
      const hash = await sha256Hex(reviewContent);
      const submission = await submitKnowledgePublication(supabase, tenantId, reference.current.documentId, reference.current.workId, savedRevision.current, publishIntent.current, hash);
      if (!current()) return;
      publishWorkId.current = submission.work_id;
      setStep("publishing");
      const run = ++pollRun.current;
      setNotice("Paige is publishing the reviewed text…");
      setTimeout(() => void watchPublication(submission.work_id, 0, run), 800);
    } catch (error) {
      if (!current()) return;
      if (error instanceof KnowledgeServiceError && error.code === "55000" && error.message.includes("KNOWLEDGE_PUBLICATION_PENDING")) {
        stop({ title: "Already publishing", message: "A publication for this source is already in flight. It will appear in Knowledge when it completes — do not start another.", action: null });
      } else if (error instanceof KnowledgeServiceError) {
        stop({ title: "Publication refused", message: plainRefusal(error), action: null });
      } else {
        stop({ title: "Publication unconfirmed", message: "Paige could not confirm whether publishing started. Recovery will reconcile it — do not publish again; check the source in Knowledge in a minute.", action: null });
      }
    } finally { busy.current = false; }
  };

  const watchPublication = async (workId: string, attempt: number, run: number) => {
    if (!current() || pollRun.current !== run) return;
    let status;
    try { status = await readKnowledgePublicationStatus(supabase, workId); }
    catch {
      if (current() && pollRun.current === run) stop({ title: "Publication status failed", message: "The publication's progress could not be read right now. Publishing was not cancelled — check again in a moment.", action: "check-publication" });
      return;
    }
    if (!current() || pollRun.current !== run) return;
    if (status.phase === "resolved" && status.status === "succeeded") {
      setStep("done"); setNotice("Published. The reviewed text is now part of Knowledge.");
      onPublished?.();
      return;
    }
    if (status.phase === "working") {
      if (attempt >= 40) { stop({ title: "Still publishing", message: "Paige is still publishing this source. You can close this — it will appear in Knowledge when it completes.", action: "check-publication" }); return; }
      setNotice("Paige is publishing the reviewed text…");
      setTimeout(() => void watchPublication(workId, attempt + 1, run), 1500);
      return;
    }
    if (status.phase === "paused") { stop({ title: "Publication paused", message: "Publishing is paused because workspace access changed. Restore access, then check again.", action: "check-publication" }); return; }
    if (status.phase === "reconcile") { stop({ title: "Publication unconfirmed", message: "Paige could not confirm whether publishing completed. Recovery will reconcile it — do not publish again; check the source in Knowledge in a minute.", action: "check-publication" }); return; }
    publishIntent.current = null;
    stop({ title: "Publication failed", message: "The publication did not complete and nothing was changed in Knowledge. Your review is still saved — you can publish it again.", action: "retry-publish" });
  };

  return <DialogContent className="max-w-xl max-h-[90dvh] overflow-y-auto">
    <DialogHeader>
      <DialogTitle>{step === "done" ? "Published to Knowledge" : step === "publishing" ? "Publishing" : step === "ready" ? "Publish to Knowledge" : step === "review" ? "Review what Paige read" : step === "extracting" ? "Paige is reading" : "Add Knowledge"}</DialogTitle>
      <DialogDescription>
        {step === "choose" && "Paige reads the source first; you review the exact text, then publish it to Knowledge."}
        {step === "extracting" && "The reading continues even if you close this."}
        {step === "review" && `Edit the text and details — this exact text becomes the Knowledge source.${review.current ? ` Revision ${review.current.revision}.` : ""}`}
        {step === "ready" && "Your review is saved. Publishing makes the exact reviewed text searchable and usable for this business."}
        {step === "publishing" && "Publishing continues even if you close this."}
        {step === "done" && "The reviewed text is now part of Knowledge for this business."}
      </DialogDescription>
    </DialogHeader>
    {halt ? <div role="alert" className="space-y-3">
      <p className="font-medium">{halt.title}</p>
      <p className="text-sm">{halt.message}</p>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Close</Button>
        {halt.action === "retry-submit" && <Button onClick={() => { setHalt(null); setStep("choose"); void submit(); }}>Retry same request</Button>}
        {halt.action === "check-extraction" && reference.current && <Button onClick={() => { setHalt(null); setStep("extracting"); const run = ++pollRun.current; setNotice("Checking Paige's reading…"); void watchExtraction(reference.current!, 0, run); }}>Check reading</Button>}
        {halt.action === "reread" && reference.current && <Button onClick={() => { setHalt(null); setNotice("Reading the current review…"); loadReview(reference.current!).catch(() => stop({ title: "Review unavailable", message: "The current review could not be read. Your draft is still here; try again in a moment.", action: "reread" })); }}>Reload review</Button>}
        {halt.action === "retry-publish" && <Button onClick={() => { setHalt(null); setStep("ready"); void publish(true); }}>Publish again</Button>}
        {halt.action === "check-publication" && publishWorkId.current && <Button onClick={() => { setHalt(null); setStep("publishing"); const run = ++pollRun.current; setNotice("Checking the publication…"); void watchPublication(publishWorkId.current!, 0, run); }}>Check publication</Button>}
      </div>
    </div> : <div className="space-y-4">
      {notice && <p role="status" className="text-sm">{notice}</p>}
      {(step === "choose" || step === "extracting") && <>
        <div className="space-y-1.5"><Label>Source type</Label>
          <div className="flex gap-2" role="group" aria-label="Source type">
            {(["paste", "file"] as const).map(value => <Button key={value} type="button" variant={mode === value ? "default" : "outline"} aria-pressed={mode === value} disabled={step === "extracting"} onClick={() => setMode(value)}>{value === "paste" ? "Pasted text" : "Text file"}</Button>)}
          </div>
        </div>
        <div className="space-y-1.5"><Label htmlFor="knowledge-add-title">Title</Label>
          <Input id="knowledge-add-title" value={title} onChange={event => setTitle(event.target.value)} disabled={step === "extracting"} maxLength={300} placeholder="e.g. Discovery call script" />
        </div>
        {mode === "paste"
          ? <div className="space-y-1.5"><Label htmlFor="knowledge-add-content">Text for Paige to read</Label>
              <Textarea id="knowledge-add-content" value={content} onChange={event => setContent(event.target.value)} disabled={step === "extracting"} rows={8} placeholder="Paste the exact text Paige should learn from." />
            </div>
          : <div className="space-y-1.5"><Label htmlFor="knowledge-add-file">Text file (.txt, .md, .markdown, .csv, .json)</Label>
              <Input id="knowledge-add-file" type="file" accept=".txt,.md,.markdown,.csv,.json" onChange={event => setFile(event.target.files?.[0] ?? null)} disabled={step === "extracting"} />
            </div>}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={step === "extracting"}>Close</Button>
          <Button onClick={() => void submit()} disabled={step === "extracting"}>{step === "extracting" ? "Reading…" : "Send to Paige"}</Button>
        </div>
      </>}
      {step === "review" && <>
        <div className="space-y-1.5"><Label htmlFor="knowledge-review-content">Reviewed text — this exact text becomes the source</Label>
          <Textarea id="knowledge-review-content" value={reviewContent} onChange={event => setReviewContent(event.target.value)} rows={10} maxLength={480000} />
        </div>
        <div className="space-y-1.5"><Label htmlFor="knowledge-review-title">Title</Label>
          <Input id="knowledge-review-title" value={title} onChange={event => setTitle(event.target.value)} maxLength={300} />
        </div>
        <div className="space-y-1.5"><Label htmlFor="knowledge-review-summary">Summary</Label>
          <Textarea id="knowledge-review-summary" value={summary} onChange={event => setSummary(event.target.value)} maxLength={2000} />
        </div>
        <div className="space-y-1.5"><Label htmlFor="knowledge-review-category">Category</Label>
          <Input id="knowledge-review-category" value={category} onChange={event => setCategory(event.target.value)} maxLength={100} />
        </div>
        <div className="space-y-1.5"><Label htmlFor="knowledge-review-tags">Tags, separated by commas</Label>
          <Input id="knowledge-review-tags" value={tags} onChange={event => setTags(event.target.value)} />
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button onClick={() => void saveReview()}>Save review</Button>
        </div>
      </>}
      {step === "ready" && <div className="space-y-3">
        <p className="text-sm">“{title.trim()}” is reviewed and saved. Publish it to make it part of Knowledge — Paige will index the exact reviewed text.</p>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Finish later</Button>
          <Button onClick={() => void publish()}>Publish to Knowledge</Button>
        </div>
      </div>}
      {(step === "publishing" || step === "done") && <div className="flex flex-wrap justify-end gap-2">
        {step === "publishing" && <Button variant="outline" onClick={onClose}>Close</Button>}
        {step === "done" && <Button onClick={onClose}>Done</Button>}
      </div>}
    </div>}
  </DialogContent>;
}

function plainRefusal(error: unknown): string {
  if (error instanceof Error && error.message && !/^(EXTRACTION|KNOWLEDGE)_/.test(error.message)) return error.message;
  return "The request was refused. Check the source, your workspace, and your access, then try again.";
}

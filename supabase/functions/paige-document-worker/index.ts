import { downloadKnowledgeText, runKnowledgeExtraction } from '../_shared/knowledge-extraction.ts';
import { runKnowledgePublication } from '../_shared/knowledge-publication-worker.ts';
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { callModel } from "../_shared/model-router.ts";
import {
  buildDocumentAuthoringPrompt,
  parseDocumentModelOutput,
  validateDocumentBrief,
} from "../_shared/document-production.ts";
import { adminClient, isAuthorizedInternalCaller, json } from "../_shared/systems-check-http.ts";

type StartedWork = {
  work_id: string;
  work_status: "claimed" | "blocked";
  server_idempotency_key: string;
  tenant_id: string;
  initiating_user_id: string;
  thread_id: string;
  attempt_count: number;
  request_payload: unknown;
};

function rpcMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) return String((error as { message?: unknown }).message ?? "");
  return String(error ?? "");
}

async function settleFailure(
  admin: SupabaseClient,
  work: StartedWork,
  status: "failed" | "outcome_unknown",
  errorCode: string,
  summary: string,
): Promise<boolean> {
  const { error } = await admin.rpc("settle_paige_document_work_failure", {
    _work_id: work.work_id,
    _server_idempotency_key: work.server_idempotency_key,
    _new_status: status,
    _error_code: errorCode,
    _safe_summary: summary,
  });
  if (error) {
    console.error("[paige-document-worker] settlement failed", { work_id: work.work_id, reason: error.message });
    return false;
  }
  return true;
}

async function runOne(admin: SupabaseClient, workId: string): Promise<Record<string, unknown>> {
  const { data, error } = await admin.rpc("start_paige_document_work_execution", { _work_id: workId });
  if (error) {
    const message = error.message ?? "";
    if (message.includes("DURABLE_WORK_ALREADY_DISPATCHED") || message.includes("DURABLE_WORK_NOT_CLAIMABLE")) {
      return { ok: true, work_id: workId, duplicate_dispatch_prevented: true };
    }
    throw error;
  }
  const work = (Array.isArray(data) ? data[0] : data) as StartedWork | undefined;
  if (!work) return { ok: true, work_id: workId, duplicate_dispatch_prevented: true };
  if (work.work_status === "blocked") {
    return { ok: false, work_id: workId, status: "blocked", blocked_reason: "authority_changed" };
  }

  const checked = validateDocumentBrief(work.request_payload);
  if (!checked.ok) {
    await settleFailure(admin, work, "failed", checked.code, checked.message);
    return { ok: false, work_id: workId, status: "failed", error_code: checked.code };
  }

  let providerDispatched = false;
  try {
    providerDispatched = true;
    const generated = await callModel("text", "frontier", buildDocumentAuthoringPrompt(checked.value), {
      tenantId: work.tenant_id,
      actorUserId: work.initiating_user_id,
      actorRole: "admin_or_coach",
      callerFunction: "paige-document-worker",
      taskId: work.work_id,
      persist: false,
      metadata: { work_id: work.work_id, attempt: work.attempt_count, document_type: checked.value.doc_type },
    });
    if (generated.needs_config || typeof generated.content !== "string" || !generated.content.trim()) {
      await settleFailure(admin, work, "failed", "model_unavailable", "Document authoring is unavailable right now. The work was not completed.");
      return { ok: false, work_id: workId, status: "failed", error_code: "model_unavailable" };
    }
    const draft = parseDocumentModelOutput(generated.content, checked.value);
    const { data: completed, error: completeError } = await admin.rpc("complete_paige_document_work", {
      _work_id: work.work_id,
      _server_idempotency_key: work.server_idempotency_key,
      _doc_type: draft.docType,
      _title: draft.title,
      _blocks: draft.blocks,
      _provider: generated.provider,
      _model: generated.model,
      _tokens_used: (generated.tokens_in ?? 0) + (generated.tokens_out ?? 0),
      _latency_ms: generated.latency_ms,
    });
    if (completeError) throw completeError;
    const row = (Array.isArray(completed) ? completed[0] : completed) as {
      content_id?: string;
      work_status?: "blocked" | "succeeded";
    } | undefined;
    if (row?.work_status === "blocked") {
      return { ok: false, work_id: workId, status: "blocked", blocked_reason: "version_conflict" };
    }
    if (row?.work_status !== "succeeded" || !row.content_id) {
      throw new Error("DURABLE_DOCUMENT_SUCCESS_READBACK_MISSING");
    }
    return {
      ok: true,
      work_id: workId,
      status: "succeeded",
      content_id: row.content_id,
      verified_readback: true,
    };
  } catch (error) {
    const message = rpcMessage(error);
    const deterministic = message.startsWith("DOCUMENT_OUTPUT_")
      || message.includes("DURABLE_DOCUMENT_OUTPUT_INVALID")
      || message.includes("DURABLE_DOCUMENT_TARGET_NOT_FOUND");
    await settleFailure(
      admin,
      work,
      deterministic || !providerDispatched ? "failed" : "outcome_unknown",
      deterministic ? "document_output_invalid" : "provider_outcome_unknown",
      deterministic
        ? "Paige could not produce a valid document from this brief. The work was not completed."
        : "Paige is reconciling document work whose outcome is not yet known.",
    );
    return {
      ok: false,
      work_id: workId,
      status: deterministic || !providerDispatched ? "failed" : "outcome_unknown",
      error_code: deterministic ? "document_output_invalid" : "provider_outcome_unknown",
    };
  }
}

async function runPublication(admin: SupabaseClient, workId: string): Promise<Record<string, unknown>> {
  return runKnowledgePublication(admin, workId);
}

async function runKnowledge(admin: SupabaseClient, workId: string): Promise<Record<string, unknown>> {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return runKnowledgeExtraction(admin, workId, path => downloadKnowledgeText(
    `${url}/storage/v1/object/authenticated/tenant-knowledge/${path.split("/").map(encodeURIComponent).join("/")}`,
    { Authorization: `Bearer ${key}`, apikey: key },
  ));
}

async function rpc0(admin: SupabaseClient, name: string, args: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const { data, error } = await admin.rpc(name, args);
  if (error) return null;
  return (data ?? null) as Record<string, unknown> | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json(200, { ok: true });
  if (req.method !== "POST") return json(405, { ok: false, error: "method_not_allowed" });
  const admin = adminClient();
  if (!(await isAuthorizedInternalCaller(req, admin))) return json(401, { ok: false, error: "unauthorized" });

  const body = await req.json().catch(() => ({})) as { mode?: unknown; work_id?: unknown };
  if (body.mode === "knowledge-run" && typeof body.work_id === "string") {
    try { return json(200, await runKnowledge(admin, body.work_id)); }
    catch { return json(409, { ok: false, work_id: body.work_id, error: "knowledge_work_not_claimable" }); }
  }
  if (body.mode === "knowledge-publish" && typeof body.work_id === "string") {
    try { return json(200, await runPublication(admin, body.work_id)); }
    catch { return json(409, { ok: false, work_id: body.work_id, error: "knowledge_publication_not_claimable" }); }
  }
  if (body.mode === "run" && typeof body.work_id === "string") {
    try { return json(200, await runOne(admin, body.work_id)); }
    catch (error) {
      console.error("[paige-document-worker] run failed before dispatch", { work_id: body.work_id, reason: rpcMessage(error) });
      return json(500, { ok: false, work_id: body.work_id, error: "worker_failed" });
    }
  }
  if (body.mode === "sweep") {
    const { data, error } = await admin.rpc("recover_paige_document_work", { _limit: 10 });
    if (error) return json(500, { ok: false, error: "recovery_failed" });
    const ids = (Array.isArray(data) ? data : []).map((row: { work_id?: unknown }) => String(row.work_id ?? "")).filter(Boolean);
    const results: Array<Record<string, unknown>> = [];
    for (const id of ids) results.push(await runOne(admin, id));
    // Same cron tick, isolated Knowledge recovery; existing document result shape remains.
    const knowledgeResults: Array<Record<string, unknown>> = [];
    const knowledge = await admin.rpc("recover_knowledge_extraction", { _limit: 10 });
    if (!knowledge.error) {
      for (const row of Array.isArray(knowledge.data) ? knowledge.data : []) {
        try { knowledgeResults.push(await runKnowledge(admin, String(row.work_id))); }
        catch { knowledgeResults.push({ ok: false, work_id: row.work_id, status: "outcome_unknown" }); }
      }
    }
    // Publication recovery reconciles lost acknowledgements (never re-embedding a started
    // dispatch), requeues missed wakes for this same re-drive, and records committed
    // generations as succeeded.
    const publicationResults: Array<Record<string, unknown>> = [];
    const publication = await admin.rpc("recover_knowledge_publication", { _limit: 10 });
    if (!publication.error) {
      for (const row of Array.isArray(publication.data) ? publication.data : []) {
        const w = await rpc0(admin, "start_knowledge_publication", { _work_id: String(row.work_id) });
        // Only re-drive rows still claimable after reconciliation; committed ones returned above.
        if (w?.status === "claimed") {
          try { publicationResults.push(await runPublication(admin, String(row.work_id))); }
          catch { publicationResults.push({ ok: false, work_id: row.work_id, status: "outcome_unknown" }); }
        }
      }
    }
    return json(200, { ok: true, recovered: ids.length, results, knowledge_results: knowledgeResults, knowledge_recovery_available: !knowledge.error, publication_results: publicationResults, publication_recovery_available: !publication.error });
  }
  return json(400, { ok: false, error: "invalid_request" });
});

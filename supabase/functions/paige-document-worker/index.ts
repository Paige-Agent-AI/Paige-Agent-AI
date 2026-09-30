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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json(200, { ok: true });
  if (req.method !== "POST") return json(405, { ok: false, error: "method_not_allowed" });
  const admin = adminClient();
  if (!(await isAuthorizedInternalCaller(req, admin))) return json(401, { ok: false, error: "unauthorized" });

  const body = await req.json().catch(() => ({})) as { mode?: unknown; work_id?: unknown };
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
    return json(200, { ok: true, recovered: ids.length, results });
  }
  return json(400, { ok: false, error: "invalid_request" });
});

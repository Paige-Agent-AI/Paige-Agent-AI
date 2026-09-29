import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * One form's intake: where its submissions go (pipeline → stage, alert email) and what visitors
 * actually typed. Read on demand when the owner opens the form, never with the whole catalog, so
 * visitors' answers load only for the form being looked at.
 *
 * Reads are tenant-scoped by RLS and by an explicit tenant filter. The one write is
 * growth_form_set_intake(), which re-checks that the caller is an owner or admin of the form's own
 * business and writes the routing where the submission processor reads it.
 */

export type FormIntakeSettings = {
  autoCreateDeal: boolean;
  pipelineId: string | null;
  stageId: string | null;
  notifyEmail: string | null;
};

export type FormIntakeField = {
  key: string;
  label: string;
  type: string;
  options?: Array<string | { label: string; value: string }>;
};

export type FormIntakeSubmission = {
  id: string;
  createdAt: string;
  state: "pending" | "claimed" | "done" | "error" | string;
  contactId: string | null;
  dealId: string | null;
  alertSentAt: string | null;
  alertSkippedReason: string | null;
  answers: Record<string, unknown>;
};

export type FormIntakeState = {
  phase: "loading" | "ready" | "error" | "missing";
  settings: FormIntakeSettings | null;
  fields: FormIntakeField[];
  submissions: FormIntakeSubmission[];
  hasMore: boolean;
  loadingMore: boolean;
};

type FormRow = {
  auto_create_deal: boolean | null;
  pipeline_id: string | null;
  stage_id: string | null;
  notify_email: string | null;
  schema_json: unknown;
};

type SubmissionRow = {
  id: string;
  created_at: string;
  processing_state: string;
  contact_id: string | null;
  deal_id: string | null;
  alert_sent_at: string | null;
  alert_skipped_reason: string | null;
  payload_json: Record<string, unknown> | null;
};

export const FORM_INTAKE_PAGE_SIZE = 20;

const SUBMISSION_COLUMNS =
  "id,created_at,processing_state,contact_id,deal_id,alert_sent_at,alert_skipped_reason,payload_json";

/** The form's fields in order, whether the schema is sectioned or a bare list. */
export function formIntakeFields(schema: unknown): FormIntakeField[] {
  const record = schema as { sections?: unknown } | null;
  const sections: unknown[] = Array.isArray(record?.sections)
    ? record!.sections as unknown[]
    : Array.isArray(schema) ? [{ fields: schema }] : [];
  const out: FormIntakeField[] = [];
  for (const section of sections) {
    const fields = (section as { fields?: unknown })?.fields;
    if (!Array.isArray(fields)) continue;
    for (const field of fields) {
      const f = field as Partial<FormIntakeField> | null;
      if (!f || typeof f.key !== "string" || !f.key) continue;
      out.push({ key: f.key, label: typeof f.label === "string" && f.label ? f.label : f.key, type: typeof f.type === "string" ? f.type : "text", options: Array.isArray(f.options) ? f.options : undefined });
    }
  }
  return out;
}

function toSubmission(row: SubmissionRow): FormIntakeSubmission {
  return {
    id: row.id,
    createdAt: row.created_at,
    state: row.processing_state,
    contactId: row.contact_id,
    dealId: row.deal_id,
    alertSentAt: row.alert_sent_at,
    alertSkippedReason: row.alert_skipped_reason,
    answers: row.payload_json && typeof row.payload_json === "object" ? row.payload_json : {},
  };
}

/** The server's refusal, in the owner's words: the seam raises "GROWTH_<CODE>: <sentence>". */
function refusalMessage(error: { message?: string } | null): string {
  const text = error?.message ?? "";
  const sentence = text.replace(/^GROWTH_[A-Z_]+:\s*/, "").trim();
  if (/^GROWTH_[A-Z_]+:/.test(text) && sentence) return sentence.charAt(0).toUpperCase() + sentence.slice(1) + ".";
  return "That didn't save. Nothing was changed — try again in a moment.";
}

export function useFormIntake(tenantId: string | null, formId: string, pageSize = FORM_INTAKE_PAGE_SIZE) {
  const [state, setState] = useState<FormIntakeState>({
    phase: "loading", settings: null, fields: [], submissions: [], hasMore: false, loadingMore: false,
  });
  const [attempt, setAttempt] = useState(0);
  const live = useRef(true);
  useEffect(() => () => { live.current = false; }, []);

  useEffect(() => {
    let current = true;
    setState({ phase: "loading", settings: null, fields: [], submissions: [], hasMore: false, loadingMore: false });
    if (!tenantId) { setState((s) => ({ ...s, phase: "error" })); return; }
    void (async () => {
      const [formResponse, submissionResponse] = await Promise.all([
        supabase
          .from("growth_forms")
          .select("auto_create_deal,pipeline_id,stage_id,notify_email,schema_json" as never)
          .eq("id", formId)
          .eq("tenant_id", tenantId)
          .maybeSingle(),
        supabase
          .from("growth_form_submissions")
          .select(SUBMISSION_COLUMNS as never)
          .eq("tenant_id", tenantId)
          .eq("form_id", formId)
          .order("created_at", { ascending: false })
          .range(0, pageSize),
      ]);
      if (!current) return;
      if (formResponse.error || submissionResponse.error) {
        console.error("[form-intake] read failed", formResponse.error ?? submissionResponse.error);
        setState((s) => ({ ...s, phase: "error" }));
        return;
      }
      const form = formResponse.data as unknown as FormRow | null;
      if (!form) { setState((s) => ({ ...s, phase: "missing" })); return; }
      const rows = (submissionResponse.data ?? []) as unknown as SubmissionRow[];
      setState({
        phase: "ready",
        settings: {
          autoCreateDeal: form.auto_create_deal === true,
          pipelineId: form.pipeline_id,
          stageId: form.stage_id,
          notifyEmail: form.notify_email,
        },
        fields: formIntakeFields(form.schema_json),
        submissions: rows.slice(0, pageSize).map(toSubmission),
        hasMore: rows.length > pageSize,
        loadingMore: false,
      });
    })();
    return () => { current = false; };
  }, [tenantId, formId, pageSize, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  const loadMore = useCallback(async () => {
    if (!tenantId || state.loadingMore || !state.hasMore) return;
    const offset = state.submissions.length;
    setState((s) => ({ ...s, loadingMore: true }));
    const { data, error } = await supabase
      .from("growth_form_submissions")
      .select(SUBMISSION_COLUMNS as never)
      .eq("tenant_id", tenantId)
      .eq("form_id", formId)
      .order("created_at", { ascending: false })
      .range(offset, offset + pageSize);
    if (!live.current) return;
    if (error) {
      console.error("[form-intake] load more failed", error);
      setState((s) => ({ ...s, loadingMore: false }));
      return;
    }
    const rows = (data ?? []) as unknown as SubmissionRow[];
    setState((s) => {
      const seen = new Set(s.submissions.map((row) => row.id));
      const next = rows.slice(0, pageSize).map(toSubmission).filter((row) => !seen.has(row.id));
      return { ...s, submissions: [...s.submissions, ...next], hasMore: rows.length > pageSize, loadingMore: false };
    });
  }, [tenantId, formId, pageSize, state.loadingMore, state.hasMore, state.submissions.length]);

  /** Save through the one write seam. Success means the server returned the saved row. */
  const save = useCallback(async (next: FormIntakeSettings): Promise<{ ok: boolean; message: string }> => {
    const { data, error } = await supabase.rpc("growth_form_set_intake" as never, {
      p_form_id: formId,
      p_auto_create_deal: next.autoCreateDeal,
      p_pipeline_id: next.autoCreateDeal ? next.pipelineId : null,
      p_stage_id: next.autoCreateDeal ? next.stageId : null,
      p_notify_email: next.notifyEmail?.trim() ? next.notifyEmail.trim() : null,
    } as never);
    const row = data as unknown as FormRow | null;
    if (error || !row) {
      if (error) console.error("[form-intake] save refused", error);
      return { ok: false, message: refusalMessage(error) };
    }
    if (live.current) {
      setState((s) => ({
        ...s,
        settings: {
          autoCreateDeal: row.auto_create_deal === true,
          pipelineId: row.pipeline_id,
          stageId: row.stage_id,
          notifyEmail: row.notify_email,
        },
      }));
    }
    return { ok: true, message: "Saved" };
  }, [formId]);

  return { ...state, retry, loadMore, save };
}

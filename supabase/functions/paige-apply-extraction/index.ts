// paige-apply-extraction — the WRITE half of the document proposal seam.
//
// Owner ruling: "any profile/client update is a clear human-reviewed proposal. Never auto-write
// extracted fields." `paige-ai-chat` now stops at the proposal. This is what runs when a person
// looks at that proposal and says yes.
//
// THE ONE RULE THAT SHAPES EVERYTHING HERE: THE REQUEST CANNOT SUPPLY A VALUE.
// It supplies an upload id and a list of field KEYS. Every value written is re-read from the
// extraction this server stored when it produced the proposal. If approval carried values, the
// browser would be deciding what lands on a credit profile, and the human would be approving one
// thing while the server wrote whatever came back — which is not an approval, it is a form post
// wearing one. The key list is intersected with a CLOSED set (`APPROVABLE_KEYS`), so a key nobody
// designed cannot be applied however it is spelled in the body.
//
// §9 — the caller is authorized against the upload row itself, on their OWN JWT, before anything
// is read. The service-role client is used only AFTER that check passes, and only to call the
// owning contract.
//
// §37 — `sync-credit-report-data` is called with exactly the payload shape its four other
// producers send. That contract is untouched by this slice.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { z } from "https://esm.sh/zod@3.22.4";
import { APPROVABLE_KEYS, buildCreditProposal, buildCreditSyncPayload } from "../_shared/credit-extraction-payload.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const bodySchema = z.object({
  upload_id: z.string().uuid(),
  // What the person ticked. An empty list is a legitimate outcome — "none of these" — and is
  // treated as a decline rather than an error.
  approved_keys: z.array(z.string().max(64)).max(32),
});

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Sign in and try again." }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // The caller's own client. Every authorization read below happens on THIS one, so RLS applies
  // and `auth.uid()` is the real caller — not a service-role context where both are absent.
  const asCaller = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: { user }, error: authError } = await asCaller.auth.getUser();
  if (authError || !user) return json({ error: "Sign in and try again." }, 401);

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return json({ error: "That request didn't look right. Try approving from the card again." }, 400);
  }

  // ── Authorization: the caller must be able to SEE this upload on their own credentials. ──
  // RLS on `credit_report_uploads` decides that, which is why this read is on `asCaller`. A
  // service-role read here would return any row to anyone and turn an id in a request body into a
  // cross-tenant write primitive (§59 — the grant is never the guard).
  const { data: upload, error: uploadErr } = await asCaller
    .from("credit_report_uploads")
    .select("id, user_id, client_id, analysis_status, extraction_review_state, analysis_result")
    .eq("id", body.upload_id)
    .maybeSingle();

  if (uploadErr) {
    console.error("[apply-extraction] upload read failed:", uploadErr.message);
    return json({ error: "I couldn't open that document record. Try again in a moment." }, 500);
  }
  if (!upload) {
    // Deliberately the same answer for "does not exist" and "not yours": a different message for
    // each turns this endpoint into a probe for which upload ids are real.
    return json({ error: "I couldn't find that document in this workspace." }, 404);
  }

  if (upload.extraction_review_state === "applied") {
    // Idempotent by state. A double-tap on Approve, or a retry after a dropped response, must not
    // write the same report twice — `sync-credit-report-data` upserts by account, but inquiries
    // and negative items would duplicate.
    return json({ ok: true, already_applied: true, applied_keys: [] });
  }
  if (upload.extraction_review_state !== "awaiting_review") {
    return json({ error: "That document isn't waiting for review any more." }, 409);
  }

  const structured = upload.analysis_result as Record<string, any> | null;
  if (!structured || typeof structured !== "object") {
    return json({ error: "I no longer have the reading of that document, so there's nothing to apply." }, 409);
  }

  // ── Rebuild the payload AND the proposal from the stored extraction. ──
  // The proposal is re-derived rather than trusted from the request, so what is approvable here is
  // exactly what a person could have been shown.
  const payload = buildCreditSyncPayload(structured, upload.user_id as string, (upload.client_id as string | null) ?? null);
  const proposal = buildCreditProposal(String(upload.id), structured, payload);
  const offered = new Set(proposal.fields.map((f) => f.key));

  // ── The key list, intersected with what was ACTUALLY OFFERED — not merely with the closed set. ──
  //
  // §13 — INTERSECTING WITH `APPROVABLE_KEYS` ALONE WAS NOT ENOUGH, and an independent reviewer
  // drove the gap. `buildCreditProposal` deliberately OMITS a score outside 300–850, because a
  // value the model did not plausibly read must never be shown to a human as something extracted
  // from their document. But the apply path checked only "is this key in the closed set" and "is
  // the value non-null" — so naming `credit_score_experian` in the request body wrote a stored 999
  // straight onto `profiles`, a fabricated score the person was never shown and could not have
  // approved.
  //
  // The closed set says which keys EXIST. The proposal says which keys were OFFERED for this
  // document. Only the second is an answer to "what could this person have agreed to", and it is
  // the one the gate needs.
  const approved = new Set(
    body.approved_keys.filter((k): k is typeof APPROVABLE_KEYS[number] =>
      (APPROVABLE_KEYS as readonly string[]).includes(k) && offered.has(k)),
  );

  const admin = createClient(supabaseUrl, serviceKey);

  if (approved.size === 0) {
    // Declining everything is a real answer, not a failure. Guarded like the apply path so a
    // decline cannot overwrite a state something else already moved, and audited for the same
    // reason an apply is: "the person said no" is a decision worth being able to reconstruct.
    const { data: declined } = await admin
      .from("credit_report_uploads")
      .update({ extraction_review_state: "declined" })
      .eq("id", body.upload_id)
      .eq("extraction_review_state", "awaiting_review")
      .select("id");
    if (declined?.length) {
      const { error: declineAuditErr } = await admin.from("audit_logs").insert({
        user_id: user.id,
        entity: "credit_report",
        entity_id: body.upload_id,
        action: "extraction_declined",
        data: { offered_keys: [...offered], source: "paige_chat_extraction_proposal" },
      });
      if (declineAuditErr) console.error("[apply-extraction] decline audit write failed:", declineAuditErr.message);
    }
    return json({ ok: true, declined: true, applied_keys: [] });
  }

  const scores: Record<string, unknown> = {};
  if (approved.has("credit_score_equifax") && payload.scores?.equifax != null) scores.equifax = payload.scores.equifax;
  if (approved.has("credit_score_experian") && payload.scores?.experian != null) scores.experian = payload.scores.experian;
  if (approved.has("credit_score_transunion") && payload.scores?.transunion != null) scores.transunion = payload.scores.transunion;

  const scoped = {
    ...payload,
    scores,
    negative_items: approved.has("negative_items") ? payload.negative_items : [],
    positive_accounts: approved.has("positive_accounts") ? payload.positive_accounts : [],
    hard_inquiries: approved.has("hard_inquiries") ? payload.hard_inquiries : [],
    // Disputes and discrepancies are DERIVED from items the person may not have approved, so they
    // are dropped rather than inferred. Proposing them separately is a later decision, not one to
    // make silently here.
    priority_disputes: [],
    discrepancies: [],
  };

  // ── CLAIM THE ROW FIRST, then write. ──
  //
  // §13 — THE PREVIOUS ORDER WAS READ-THEN-WRITE AND ITS IDEMPOTENCE WAS DECORATIVE. The
  // `already_applied` check above ran against a row that was only stamped `applied` AFTER the sync
  // returned, and the stamp had no state predicate. An independent reviewer fired two approvals of
  // the same row concurrently: both returned 200 and both reached the sync. The only thing standing
  // between a double-tap and duplicated `credit_inquiries` and `credit_negative_items` rows was the
  // browser card disabling its own button.
  //
  // The update below is a compare-and-set: it moves the row out of `awaiting_review` and returns
  // the row only if IT made that transition. A second caller finds nothing to claim and stops. The
  // status is rolled back on a sync failure so the person can retry rather than lose the proposal —
  // which is why the claim is a distinct state rather than the final one.
  const { data: claimed, error: claimErr } = await admin
    .from("credit_report_uploads")
    .update({ extraction_review_state: "applied", last_analyzed_at: new Date().toISOString() })
    .eq("id", body.upload_id)
    .eq("extraction_review_state", "awaiting_review")
    .select("id");
  if (claimErr) {
    console.error("[apply-extraction] claim failed:", claimErr.message);
    return json({ error: "I couldn't save those just now. Nothing was changed — try again." }, 500);
  }
  if (!claimed?.length) {
    // Somebody else claimed it between the read above and here. Not an error to the person: the
    // thing they asked for is happening.
    return json({ ok: true, already_applied: true, applied_keys: [] });
  }

  // Releasing the claim is needed on BOTH failure shapes below — a non-2xx sync RESPONSE and a
  // transport REJECTION (the fetch itself throwing: DNS, connection reset, timeout). ONE closure so
  // the two load-bearing properties can never drift between the paths: it reads its own error
  // (postgrest RESOLVES a rejection rather than throwing, so a silently-failed release would leave
  // exactly the unrecoverable `applied`-with-nothing-applied state this exists to prevent), and it
  // is CONDITIONAL on the row still being `applied` (so a concurrent decline is not stomped back to
  // awaiting_review, resurrecting a proposal the person just dismissed).
  const releaseClaimOrLog = async () => {
    const { data: released, error: relErr } = await admin.from("credit_report_uploads")
      .update({ extraction_review_state: "awaiting_review" })
      .eq("id", body.upload_id)
      .eq("extraction_review_state", "applied")
      .select("id").maybeSingle();
    if (relErr || !released) {
      console.error("[apply-extraction] CLAIM NOT RELEASED", JSON.stringify({
        upload_id: body.upload_id,
        code: relErr?.code ?? null,
        message: relErr?.message ?? (released ? null : "row was no longer claimed"),
      }));
    }
  };

  // ── Perform the write through the owning contract. ──
  // The fetch is wrapped: a transport REJECTION (the fetch throwing before any response) is NOT the
  // same as a non-2xx response, and #729 finding 3 was that only the latter released the claim. This
  // handler has NO outer try/catch around the write (the one at the top only guards body parsing), so
  // an un-caught throw here escaped `serve` and left the row `applied` with nothing applied. Now a
  // rejection takes the same audit + conditional release + truthful "nothing was changed" as a 5xx.
  let syncResponse: Response;
  let syncBody: any;
  try {
    syncResponse = await fetch(`${supabaseUrl}/functions/v1/sync-credit-report-data`, {
      method: "POST",
      headers: { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(scoped),
    });
    syncBody = await syncResponse.json().catch(() => ({ error: "Could not parse sync response" }));
  } catch (transportErr) {
    console.error("[apply-extraction] sync transport rejected:", (transportErr as Error)?.message);
    await admin.from("audit_logs").insert({
      user_id: user.id,
      entity: "credit_report",
      action: "extraction_apply_failed",
      entity_id: body.upload_id,
      data: { status: null, approved_keys: [...approved], error: "sync_transport_rejected" },
    });
    await releaseClaimOrLog();
    return json({ error: "I couldn't reach the profile service just now. Nothing was changed — try again." }, 502);
  }

  if (!syncResponse.ok) {
    console.error("[apply-extraction] sync failed:", syncResponse.status, syncBody);
    await admin.from("audit_logs").insert({
      user_id: user.id,
      entity: "credit_report",
      action: "extraction_apply_failed",
      entity_id: body.upload_id,
      data: { status: syncResponse.status, approved_keys: [...approved], error: syncBody?.error ?? null },
    });
    // RELEASE THE CLAIM (the same closure the transport-rejection path uses) so the person can try
    // again rather than losing the proposal. Without it a transient sync failure would leave the row
    // `applied` with nothing applied — unrecoverable from the card.
    await releaseClaimOrLog();
    return json({ error: "I couldn't save those to the profile. Nothing was changed — try again." }, 502);
  }

  // ── Classify the sync's OWN verdict (#734). ──
  // A 200 from the sync means the RUN completed, not that the WRITES landed: the callee now
  // reports per-group outcomes. An approval must not settle as terminal `applied` when some or
  // all of what the person approved failed to write, was skipped (no profile row to write to),
  // or the outcome cannot be verified (fail closed on a missing verdict). The claim is released
  // so the person can try again — the writer dedups (pinned by scripts/sync-credit-report-data
  // check §12), so a retry converges instead of duplicating. What DID land stays landed; the
  // sentence below says exactly that rather than "nothing was changed".
  const outcome = syncBody?.results?.outcome;
  const failedGroups: string[] = Array.isArray(outcome?.failed_groups) ? outcome.failed_groups : [];
  const skippedGroups: string[] = Array.isArray(outcome?.skipped_groups) ? outcome.skipped_groups : [];
  const complete = outcome?.status === "complete" && failedGroups.length === 0 && skippedGroups.length === 0;
  if (!complete) {
    console.error("[apply-extraction] sync incomplete:", JSON.stringify({ status: outcome?.status ?? "unreported", failedGroups, skippedGroups }));
    await admin.from("audit_logs").insert({
      user_id: user.id,
      entity: "credit_report",
      action: "extraction_apply_failed",
      entity_id: body.upload_id,
      data: {
        status: syncResponse.status,
        approved_keys: [...approved],
        error: "sync_incomplete",
        sync_outcome: outcome ?? null,
      },
    });
    await releaseClaimOrLog();
    // Truthful by class: total failure says nothing saved; a partial says what saved and what
    // didn't; a skip names the no-profile-row reason; an unreported outcome fails closed.
    let sentence: string;
    if (!outcome) {
      sentence = "The profile service didn't report what saved, so I'm not marking this done. Nothing was marked as applied — try again.";
    } else if (outcome.status === "failed") {
      sentence = "None of it saved. Nothing was marked as applied — try again.";
    } else {
      const notSaved = [...failedGroups, ...skippedGroups.map((g: string) => `${g} (no profile row for it)`)];
      sentence = `Some of it saved, but these parts didn't: ${notSaved.join(", ")}. Nothing was marked as applied — try again; a retry won't duplicate what already saved.`;
    }
    return json({ error: sentence, partial: outcome?.status === "partial" }, 502);
  }

  // ATTRIBUTION (§13): what a person approved, when, and which of it was applied. Written with the
  // column shape `audit_logs` actually has — `entity`/`entity_id`/`data`, never
  // `resource_type`/`resource_id`/`metadata`, which errors 42703 and is why two other chat writes
  // have been producing no audit row at all.
  const { error: auditErr } = await admin.from("audit_logs").insert({
    user_id: user.id,
    entity: "credit_report",
    action: "extraction_applied",
    entity_id: body.upload_id,
    data: {
      approved_keys: [...approved],
      negative_items: scoped.negative_items.length,
      positive_accounts: scoped.positive_accounts.length,
      hard_inquiries: scoped.hard_inquiries.length,
      scores_applied: Object.keys(scores),
      source: "paige_chat_extraction_proposal",
    },
  });
  // Awaited and checked, not fire-and-forget: an approval nobody can reconstruct afterwards is not
  // an attributable write. A failure here does not undo the sync, so it is reported, not swallowed.
  if (auditErr) console.error("[apply-extraction] audit write failed:", auditErr.message);

  return json({ ok: true, applied_keys: [...approved], audit_recorded: !auditErr });
});

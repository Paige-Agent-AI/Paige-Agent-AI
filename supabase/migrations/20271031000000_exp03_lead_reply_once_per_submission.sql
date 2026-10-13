-- ============================================================================
-- Experience 03 · S3 "PAIGE works your leads" — a reply to a new lead, drafted once, sent only
-- through the governed email door, and never marked done when nothing was sent.
--
-- OWNER RULING (2026-10-13): a submitted inquiry is not marketing consent; a direct reply to it is
-- permitted but goes out only from the business's verified email through the EXISTING governed email
-- command (comms-email-command / comms.email_send — 20270597000000_comms_email_send.sql). There is no
-- second sender path. Provider acceptance is not delivery. AI drafting is opt-in per form.
--
-- WHAT THIS DOES:
--   1. growth_form_submissions.lead_reply_skipped_reason — why the processor filed no reply draft.
--   2. One owner.lead_followup per (business, submission): a UNIQUE partial index, so a raced or
--      retried processor run is refused 23505 (read by growth-process-submission as "already drafted").
--   3. growth_forms.lead_reply_enabled (default false) — the per-form opt-in to AI-drafted replies.
--      Settable ONLY through the audited growth_form_set_intake seam (an owner/admin of the form's own
--      business), never by a direct browser write — the same guard shape as notify_email.
--   4. growth_form_set_intake gains a 6-argument form ending in _lead_reply_enabled (NULL = unchanged).
--      The 5-argument form is KEPT, unchanged in signature, defaults and grants, and now delegates with
--      NULL — so every existing caller keeps working (see the §37 inventory below).
--   5. A guard on paige_pending_approvals: an approval that stands for a send_via_approval action can
--      only become approved/sent when it names a governed email that the provider ACCEPTED, for the
--      same business and the same person. Declining stays free. This closes every approve path
--      (execute-approval, paige-mcp decide_pending_approval, paige-bridge update_pending_approval, a
--      direct RLS-admitted write) that could mark a send action done with nothing sent.
--   6. public.lead_reply_record_send(approval, operation) — the one way the owner's reply screen
--      records the governed send's outcome on the approval.
--
-- §37 PRODUCER INVENTORY — growth_form_set_intake (every caller, each kept working):
--   * src/solo/useFormIntake.ts:206 — supabase.rpc with the 5 named p_* args → the 5-arg form (kept).
--     (form-intake.tsx and studio/FormSettings.tsx reach it only through this hook.)
--   * supabase/tests/public_form_intake.sql — positional 5-arg calls, and has_function_privilege on the
--     5-arg signature → unchanged signature and grants, so unchanged results.
--   * supabase/tests/operator_company_workspace_authority.sql:92-94 — positional 5-arg calls → unchanged.
--   * scripts/live-drive/harness/{form-intake-mount,studio-mount}/supabase-stub.ts — in-memory stubs,
--     no database. growth-process-submission only READS the columns this seam writes.
--   WHY TWO SIGNATURES, NOT ONE WITH A DEFAULT: a 6-arg function whose last parameter has a DEFAULT
--   makes every 5-arg call ambiguous ("function ... is not unique", measured 2026-10-13 on PG 17), and
--   dropping the 5-arg form breaks public_form_intake.sql's has_function_privilege on that signature.
--   So the 6-arg form has no defaults (PostgREST picks it only when _lead_reply_enabled is passed) and
--   the 5-arg form is a thin delegate — one body, two doors, the second exactly as it was.
--
-- §37 PRODUCER INVENTORY — writers that move a paige_pending_approvals row to approved/sent (each was
-- checked against guard 5; none legitimately approves a send kind without a governed send):
--   * execute-approval (service role) — after this change it REFUSES send kinds with 409 before any
--     write; it still approves non-send actions, non-action approvals and orchestration acts, none of
--     which the guard touches (their metadata.action_id is absent or names a non-send kind).
--   * send-message (service role) — marks an approval approved after a send ONLY when called with
--     approval_id; its only caller with approval_id was execute-approval's send path, now refused for
--     send kinds. A legacy cs_draft approval WITHOUT an action_id is unaffected.
--   * paige-mcp decide_pending_approval (service role) — a status write with no send. For a send kind
--     it is now refused by this guard (42501), which is the defect being closed; reject/escalate/
--     request_changes stay allowed.
--   * paige-bridge update_pending_approval (n8n, service role) — a raw status/metadata patch. Same as
--     above; it can also REPLACE metadata, so the guard reads the action from the stored metadata, the
--     new metadata AND paige_actions.approval_id — removing action_id in the same write cannot launder it.
--   * src/ (browser) — approval-direct-write-lint already forbids an approved write from the frontend;
--     ApprovalRow/decline writes 'rejected', which stays allowed.
--   * SQL: email_campaign_*/email_sequence_* approve their own campaign_send approvals (metadata carries
--     a version id, never an action_id); paige_reconcile_orchestration_acts approves orchestration
--     companions (event_id/act_id). Neither names a send action, so neither is affected.
--   * trg_ppa_sync_action marks the ACTION done when its approval goes approved/sent — that is exactly
--     the false completion this guard prevents upstream; it is not itself an approval writer.
--   HONEST NOTE (§13/§58): this means NO send_via_approval approval (client.followup, owner.followup_email,
--   owner.sms_nudge, comms-draft-reply, sales.work_followup, finance.retainer_reminder,
--   social.post_publish) can be approved any more except an owner.lead_followup recorded through (6).
--   Before this, approving one through execute-approval sent it via send-message; that path is removed
--   by the owner ruling ("no second sender path"). Those drafts can still be declined. A governed
--   review-and-send for the other kinds is follow-up work.
--
-- REVERSIBILITY: additive. Reverse by dropping the guard triggers and their functions,
-- lead_reply_record_send, the 6-arg growth_form_set_intake (re-applying the 5-arg body from
-- 20270518000000), the index and the two columns. No row is written, moved or deleted by this file.
-- Idempotent: replaying it is a no-op.
-- ============================================================================

-- ── 1. Why the processor did not draft a reply for this lead ────────────────────────────────────
-- The twin of alert_skipped_reason (20270518000000_public_form_intake.sql). NULL = drafted, or none planned.
ALTER TABLE public.growth_form_submissions
  ADD COLUMN IF NOT EXISTS lead_reply_skipped_reason text;

COMMENT ON COLUMN public.growth_form_submissions.lead_reply_skipped_reason IS
  'Why no reply draft was filed for this lead (e.g. no_contact_email, no_email_sender, business_hourly_cap). Written by growth-process-submission; NULL when a draft was filed or none was planned.';

-- ── 2. One owner.lead_followup per (business, submission) ───────────────────────────────────────
-- A pre-existing duplicate would make CREATE UNIQUE INDEX fail with a bare 23505; say what it is
-- instead, so the deploy fails loudly with the reason and nothing is deleted on our behalf (§13).
DO $$
DECLARE
  _dupes int;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes
              WHERE schemaname = 'public' AND indexname = 'uq_paige_actions_lead_followup_submission') THEN
    RETURN;
  END IF;
  SELECT count(*) INTO _dupes FROM (
    SELECT 1 FROM public.paige_actions
     WHERE action_kind = 'owner.lead_followup' AND payload->>'submission_id' IS NOT NULL
     GROUP BY tenant_id, payload->>'submission_id'
    HAVING count(*) > 1
  ) d;
  IF _dupes > 0 THEN
    RAISE EXCEPTION 'LEAD_REPLY_DUPLICATES: % submission(s) already carry more than one owner.lead_followup action; resolve them before this index can be created', _dupes
      USING ERRCODE = '23505';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_paige_actions_lead_followup_submission
  ON public.paige_actions (tenant_id, (payload->>'submission_id'))
  WHERE action_kind = 'owner.lead_followup';

COMMENT ON INDEX public.uq_paige_actions_lead_followup_submission IS
  'Experience 03: at most one owner.lead_followup (reply draft) per form submission per business. Actions without a submission_id are unaffected (NULLs are distinct).';

-- ── 3. The per-form opt-in to AI-drafted replies ────────────────────────────────────────────────
ALTER TABLE public.growth_forms
  ADD COLUMN IF NOT EXISTS lead_reply_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.growth_forms.lead_reply_enabled IS
  'Owner opt-in: when true, growth-process-submission files one AI-drafted reply (owner.lead_followup) per new lead for the owner to review and send. Set only through growth_form_set_intake() (an owner/admin, audited). Default false.';

-- Turning this on makes the platform spend model calls on every lead the form brings in and puts a
-- drafted email in front of the owner, so it changes only through the audited owner/admin seam.
-- growth_forms_tenant_manage lets any member of the business update the row; a direct browser write
-- (role authenticated/anon) of this one column is refused. The seam runs as its definer, and
-- service/migration contexts are trusted, so neither is affected. Mirrors
-- growth_forms_guard_notify_email (20270518000000).
CREATE OR REPLACE FUNCTION public.growth_forms_guard_lead_reply()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') AND (
       (TG_OP = 'INSERT' AND NEW.lead_reply_enabled IS TRUE)
    OR (TG_OP = 'UPDATE' AND NEW.lead_reply_enabled IS DISTINCT FROM OLD.lead_reply_enabled)) THEN
    RAISE EXCEPTION 'GROWTH_FORBIDDEN: an owner or admin turns on drafted replies through growth_form_set_intake'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.growth_forms_guard_lead_reply() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_growth_forms_guard_lead_reply ON public.growth_forms;
CREATE TRIGGER trg_growth_forms_guard_lead_reply
  BEFORE INSERT OR UPDATE OF lead_reply_enabled ON public.growth_forms
  FOR EACH ROW EXECUTE FUNCTION public.growth_forms_guard_lead_reply();

-- ── 4. growth_form_set_intake, now able to set lead_reply_enabled ───────────────────────────────
-- The body is 20270518000000's, plus one column. _lead_reply_enabled NULL leaves the setting as it is.
-- Only a business account (Solo or a sub-account) can turn replies on: an agency or enterprise
-- account manages businesses rather than answering leads itself, and the processor never drafts for one.
CREATE OR REPLACE FUNCTION public.growth_form_set_intake(
  p_form_id            uuid,
  p_auto_create_deal   boolean,
  p_pipeline_id        uuid,
  p_stage_id           uuid,
  p_notify_email       text,
  _lead_reply_enabled  boolean
)
RETURNS public.growth_forms
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _caller uuid := auth.uid();
  _form   public.growth_forms;
  _email  text := NULLIF(btrim(COALESCE(p_notify_email, '')), '');
  _row    public.growth_forms;
BEGIN
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'GROWTH_FORBIDDEN: sign in to change a form' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO _form FROM public.growth_forms WHERE id = p_form_id;
  IF _form.id IS NULL THEN
    RAISE EXCEPTION 'GROWTH_NOT_FOUND: form not found' USING ERRCODE = 'P0002';
  END IF;

  -- §9/§59: authority comes from membership in the FORM'S OWN business, never a global role.
  IF NOT public.is_tenant_admin(_form.tenant_id) THEN
    RAISE EXCEPTION 'GROWTH_FORBIDDEN: only an owner or admin of this business can change its forms'
      USING ERRCODE = '42501';
  END IF;

  IF COALESCE(p_auto_create_deal, false) THEN
    IF p_pipeline_id IS NULL THEN
      RAISE EXCEPTION 'GROWTH_INVALID_INTAKE: choose the pipeline new leads go into' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.pipelines p WHERE p.id = p_pipeline_id AND p.tenant_id = _form.tenant_id) THEN
      RAISE EXCEPTION 'GROWTH_INVALID_INTAKE: that pipeline is not in this business' USING ERRCODE = '22023';
    END IF;
    IF p_stage_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.pipeline_stages s WHERE s.id = p_stage_id AND s.pipeline_id = p_pipeline_id
    ) THEN
      RAISE EXCEPTION 'GROWTH_INVALID_INTAKE: that stage is not in the chosen pipeline' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF _email IS NOT NULL AND (length(_email) > 254 OR _email !~* '^[^@\s,;<>"]+@[^@\s,;<>"]+\.[^@\s,;<>"]+$') THEN
    RAISE EXCEPTION 'GROWTH_INVALID_INTAKE: that alert address is not a valid email' USING ERRCODE = '22023';
  END IF;

  IF _lead_reply_enabled IS TRUE AND NOT EXISTS (
    SELECT 1 FROM public.tenants t
     WHERE t.id = _form.tenant_id AND t.account_type IN ('standalone', 'sub_account')
  ) THEN
    RAISE EXCEPTION 'GROWTH_INVALID_INTAKE: drafted replies to new leads are for a business account'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.growth_forms SET
    auto_create_contact = auto_create_contact OR COALESCE(p_auto_create_deal, false),
    auto_create_deal    = COALESCE(p_auto_create_deal, false),
    pipeline_id         = CASE WHEN COALESCE(p_auto_create_deal, false) THEN p_pipeline_id ELSE pipeline_id END,
    stage_id            = CASE WHEN COALESCE(p_auto_create_deal, false) THEN p_stage_id ELSE stage_id END,
    notify_email        = _email,
    lead_reply_enabled  = COALESCE(_lead_reply_enabled, lead_reply_enabled)
  WHERE id = _form.id
  RETURNING * INTO _row;

  IF EXISTS (SELECT 1 FROM public.growth_form_automations a WHERE a.form_id = _form.id) THEN
    IF _row.auto_create_deal THEN
      INSERT INTO public.growth_form_automations (tenant_id, form_id, target_slug, order_index, enabled, config_json, created_by)
      VALUES (_form.tenant_id, _form.id, 'contact_upsert', 10, true, '{}'::jsonb, _caller)
      ON CONFLICT (form_id, target_slug) DO UPDATE SET enabled = true, updated_at = now();

      INSERT INTO public.growth_form_automations (tenant_id, form_id, target_slug, order_index, enabled, config_json, created_by)
      VALUES (_form.tenant_id, _form.id, 'pipeline_attach', 20, true,
              jsonb_strip_nulls(jsonb_build_object('pipeline_id', _row.pipeline_id, 'stage_id', _row.stage_id)), _caller)
      ON CONFLICT (form_id, target_slug) DO UPDATE SET
        enabled     = true,
        config_json = (public.growth_form_automations.config_json - 'pipeline_id' - 'stage_id') || EXCLUDED.config_json,
        updated_at  = now();
    ELSE
      UPDATE public.growth_form_automations SET enabled = false, updated_at = now()
      WHERE form_id = _form.id AND target_slug = 'pipeline_attach';
    END IF;
  END IF;

  INSERT INTO public.audit_logs (user_id, entity, action, entity_id, data)
  VALUES (_caller, 'growth_forms', 'growth_form_set_intake', _row.id,
          jsonb_build_object('tenant_id', _row.tenant_id,
                             'auto_create_deal', _row.auto_create_deal,
                             'pipeline_id', _row.pipeline_id,
                             'stage_id', _row.stage_id,
                             'notify_email_set', _row.notify_email IS NOT NULL,
                             'lead_reply_enabled', _row.lead_reply_enabled));

  RETURN _row;
END;
$$;

REVOKE ALL ON FUNCTION public.growth_form_set_intake(uuid, boolean, uuid, uuid, text, boolean) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.growth_form_set_intake(uuid, boolean, uuid, uuid, text, boolean) TO authenticated;

-- The 5-argument form every existing caller uses: same signature, same defaults, same grants (a
-- CREATE OR REPLACE keeps the ACL), now one line that leaves lead_reply_enabled as it is.
CREATE OR REPLACE FUNCTION public.growth_form_set_intake(
  p_form_id          uuid,
  p_auto_create_deal boolean,
  p_pipeline_id      uuid DEFAULT NULL,
  p_stage_id         uuid DEFAULT NULL,
  p_notify_email     text DEFAULT NULL
)
RETURNS public.growth_forms
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.growth_form_set_intake(p_form_id, p_auto_create_deal, p_pipeline_id, p_stage_id, p_notify_email, NULL::boolean);
END;
$$;

REVOKE ALL ON FUNCTION public.growth_form_set_intake(uuid, boolean, uuid, uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.growth_form_set_intake(uuid, boolean, uuid, uuid, text) TO authenticated;

-- ── 5. A send action's approval is approved only by a send the provider accepted ────────────────
-- The defect (exp03 round-1 review): every approve path — execute-approval's acknowledge fallback,
-- paige-mcp decide_pending_approval, paige-bridge update_pending_approval, a direct status write the
-- approvals RLS admits — could flip a send_via_approval approval to approved; trg_ppa_sync_action then
-- marked the action DONE, and nothing had been sent (§13). Production 2026-10-13 holds 125 pending
-- client.followup approvals in the legacy draft shape; approving any of them must never mark it done.
--
-- An approval "stands for a send" when ANY of these names an action whose kind's executor is
-- send_via_approval: the stored metadata.action_id, the new metadata.action_id, or a paige_actions row
-- whose approval_id is this approval. Reading all three means a write that also rewrites or drops
-- metadata.action_id cannot launder the row past this check.
--
-- Such an approval may become approved/sent/executed ONLY when metadata.governed_send names a messages
-- row that is the governed email send (meta.comms_email_binding) and:
--   * the binding's state is provider_accepted (accepted by the provider — not proof of delivery);
--   * the binding's operation_id equals governed_send.operation_id;
--   * the message is in the approval's business, and to the same person as every send action it stands for;
--   * the message was created no earlier than the approval (an older email cannot be re-used as proof);
--   * no OTHER approved/sent approval already names the same message (one send proves one approval).
-- Declined/rejected/skipped/changes_requested/escalated are never restricted. Applies to every role,
-- service role included: there is no trusted path that may complete a send without a send.
CREATE OR REPLACE FUNCTION public.paige_guard_send_approval_requires_governed_send()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  _uuid      constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  _ids       uuid[] := ARRAY[]::uuid[];
  _raw       text;
  _gs        jsonb;
  _mid       text;
  _op        text;
  _msg       public.messages%ROWTYPE;
  _tenant    uuid;
BEGIN
  IF NEW.status IS NULL OR NEW.status NOT IN ('approved', 'sent', 'executed') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  _raw := NEW.metadata->>'action_id';
  IF _raw ~ _uuid THEN _ids := _ids || _raw::uuid; END IF;
  IF TG_OP = 'UPDATE' THEN
    _raw := OLD.metadata->>'action_id';
    IF _raw ~ _uuid THEN _ids := _ids || _raw::uuid; END IF;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.paige_actions a
      JOIN public.paige_action_kinds k ON k.slug = a.action_kind
     WHERE k.executor = 'send_via_approval'
       AND (a.id = ANY (_ids) OR a.approval_id = NEW.id)
  ) THEN
    RETURN NEW;  -- not an outbound-message approval: every other approval is untouched (§58)
  END IF;

  _gs  := NEW.metadata->'governed_send';
  _mid := CASE WHEN jsonb_typeof(_gs) = 'object' THEN _gs->>'message_id' END;
  _op  := CASE WHEN jsonb_typeof(_gs) = 'object' THEN _gs->>'operation_id' END;

  IF _mid IS NOT NULL AND _mid ~ _uuid AND _op IS NOT NULL AND _op ~ _uuid THEN
    SELECT * INTO _msg FROM public.messages WHERE id = _mid::uuid;
  END IF;

  _tenant := NEW.tenant_id;

  IF _msg.id IS NULL
     OR NOT (_msg.meta ? 'comms_email_binding')
     OR _msg.meta#>>'{comms_email_binding,state}' IS DISTINCT FROM 'provider_accepted'
     OR _msg.meta#>>'{comms_email_binding,operation_id}' IS DISTINCT FROM lower(_op)
     OR _tenant IS NULL OR _msg.tenant_id IS DISTINCT FROM _tenant
     OR _msg.contact_id IS NULL
     OR _msg.created_at < NEW.created_at
     OR EXISTS (
          SELECT 1
            FROM public.paige_actions a
            JOIN public.paige_action_kinds k ON k.slug = a.action_kind
           WHERE k.executor = 'send_via_approval'
             AND (a.id = ANY (_ids) OR a.approval_id = NEW.id)
             AND (a.tenant_id IS DISTINCT FROM _msg.tenant_id OR a.contact_id IS DISTINCT FROM _msg.contact_id))
     OR EXISTS (
          SELECT 1 FROM public.paige_pending_approvals o
           WHERE o.id <> NEW.id
             AND o.status IN ('approved', 'sent', 'executed')
             AND o.metadata#>>'{governed_send,message_id}' = _msg.id::text)
  THEN
    RAISE EXCEPTION 'SEND_REQUIRES_GOVERNED_SEND: an outbound message is approved only once the business''s verified email has sent it; it can still be declined'
      USING ERRCODE = '42501',
            HINT = 'Send it through the governed email command, then record it with lead_reply_record_send.';
  END IF;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.paige_guard_send_approval_requires_governed_send() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_paige_guard_send_approval_requires_governed_send ON public.paige_pending_approvals;
CREATE TRIGGER trg_paige_guard_send_approval_requires_governed_send
  BEFORE INSERT OR UPDATE ON public.paige_pending_approvals
  FOR EACH ROW EXECUTE FUNCTION public.paige_guard_send_approval_requires_governed_send();

-- ── 6. Recording the governed send on the reply's approval ──────────────────────────────────────
-- The owner's reply screen sends the (possibly edited) reply through comms-email-command
-- (comms.email_send: server-resolved recipient and sender, fingerprint approval, operation_id), then
-- calls this with that operation. This reads the outcome the door recorded — never a client claim —
-- and writes it on the approval:
--   provider_accepted          → approval approved with metadata.governed_send (guard 5 checks it),
--                                the lead's last_contacted_at stamped; {ok:true, delivery_confirmed:false}
--   prepared|dispatching|unknown → metadata.governed_send records the state, approval stays pending;
--                                {ok:false, state}
--   failed|refused             → approval stays pending, nothing written; {ok:false, state}
--   no such send for this lead → {ok:false, state:'not_found'}
-- Idempotent: recording the same accepted operation again returns the same answer and writes nothing.
-- §59: SECURITY DEFINER, so the body re-derives the caller's authority — an active owner/admin of the
-- approval's business, which must be the caller's active business. No identity parameter is trusted.
CREATE OR REPLACE FUNCTION public.lead_reply_record_send(_approval_id uuid, _operation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  _caller uuid := auth.uid();
  _ap     public.paige_pending_approvals%ROWTYPE;
  _act    public.paige_actions%ROWTYPE;
  _msg    public.messages%ROWTYPE;
  _state  text;
  _gs     jsonb;
  _raw    text;
BEGIN
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'LEAD_REPLY_FORBIDDEN: sign in to record a reply' USING ERRCODE = '42501';
  END IF;
  IF _approval_id IS NULL OR _operation_id IS NULL THEN
    RAISE EXCEPTION 'LEAD_REPLY_INVALID: an approval and a send operation are required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO _ap FROM public.paige_pending_approvals WHERE id = _approval_id FOR UPDATE;

  -- One refusal for "no such approval" and "not yours", so another business's approval ids are not
  -- confirmed to exist. Authority: active owner/admin of the approval's business, and that business is
  -- the caller's active one (§9/§59).
  IF _ap.id IS NULL OR _ap.tenant_id IS NULL
     OR _ap.tenant_id IS DISTINCT FROM public.current_user_tenant_id()
     OR NOT EXISTS (
          SELECT 1 FROM public.tenant_members m
           WHERE m.tenant_id = _ap.tenant_id AND m.user_id = _caller
             AND m.status = 'active' AND m.role IN ('owner', 'admin')) THEN
    RAISE EXCEPTION 'LEAD_REPLY_FORBIDDEN: only an owner or admin of this business can record its replies'
      USING ERRCODE = '42501';
  END IF;

  -- The reply action: named by the approval AND pointing back at it, in the same business.
  _raw := _ap.metadata->>'action_id';
  IF _raw ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
    SELECT * INTO _act FROM public.paige_actions a
     WHERE a.id = _raw::uuid AND a.approval_id = _ap.id AND a.tenant_id = _ap.tenant_id;
  END IF;
  IF _act.id IS NULL OR _act.action_kind IS DISTINCT FROM 'owner.lead_followup' OR _act.contact_id IS NULL THEN
    RAISE EXCEPTION 'LEAD_REPLY_WRONG_KIND: only a drafted reply to a new lead is recorded here' USING ERRCODE = '22023';
  END IF;

  IF _ap.status = 'approved' THEN
    IF _ap.metadata#>>'{governed_send,operation_id}' = _operation_id::text THEN
      RETURN jsonb_build_object('ok', true, 'state', 'provider_accepted', 'delivery_confirmed', false,
        'approval_id', _ap.id, 'message_id', _ap.metadata#>>'{governed_send,message_id}',
        'operation_id', _operation_id, 'replayed', true);
    END IF;
    RAISE EXCEPTION 'LEAD_REPLY_ALREADY_RECORDED: this reply was already recorded as sent by another send'
      USING ERRCODE = '55000';
  END IF;
  IF _ap.status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'LEAD_REPLY_NOT_PENDING: this reply is no longer waiting to be sent' USING ERRCODE = '55000';
  END IF;

  -- The governed send for this operation, in this business, to this lead. The operation_id is unique
  -- across messages (messages_comms_email_operation), so this is at most one row.
  SELECT * INTO _msg FROM public.messages m
   WHERE m.meta#>>'{comms_email_binding,operation_id}' = _operation_id::text
     AND m.tenant_id = _ap.tenant_id
     AND m.contact_id = _act.contact_id
     AND m.channel_type = 'email' AND m.direction = 'outbound';
  IF _msg.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'state', 'not_found', 'delivery_confirmed', false,
      'approval_id', _ap.id, 'operation_id', _operation_id);
  END IF;

  _state := _msg.meta#>>'{comms_email_binding,state}';
  _gs := jsonb_build_object('message_id', _msg.id, 'operation_id', _operation_id, 'state', _state, 'recorded_at', now());

  IF _state = 'provider_accepted' THEN
    UPDATE public.paige_pending_approvals SET
      status              = 'approved',
      reviewed_by_user_id = _caller,
      reviewed_at         = now(),
      sent_at             = COALESCE(_msg.sent_at, now()),
      metadata            = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('governed_send', _gs)
    WHERE id = _ap.id;
    UPDATE public.clients SET last_contacted_at = now()
     WHERE id = _act.contact_id AND tenant_id = _ap.tenant_id;
    RETURN jsonb_build_object('ok', true, 'state', _state, 'delivery_confirmed', false,
      'approval_id', _ap.id, 'message_id', _msg.id, 'operation_id', _operation_id);
  END IF;

  IF _state IN ('prepared', 'dispatching', 'unknown') THEN
    UPDATE public.paige_pending_approvals SET
      metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('governed_send', _gs)
    WHERE id = _ap.id;
  END IF;

  -- failed | refused (and any state this function does not know) leave the approval as it was.
  RETURN jsonb_build_object('ok', false, 'state', COALESCE(_state, 'unknown'), 'delivery_confirmed', false,
    'approval_id', _ap.id, 'message_id', _msg.id, 'operation_id', _operation_id);
END;
$$;

REVOKE ALL ON FUNCTION public.lead_reply_record_send(uuid, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.lead_reply_record_send(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.lead_reply_record_send(uuid, uuid) IS
  'Experience 03: records the governed email send (comms.email_send operation) of a drafted lead reply on its approval. Approves only on provider_accepted (never claims delivery); otherwise records the state and leaves it pending. Owner/admin of the caller''s active business only.';

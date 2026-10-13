-- ============================================================================
-- Experience 03 · S3 "PAIGE works your leads" — one reply draft per form submission.
--
-- growth-process-submission now files ONE owner.lead_followup action when a Solo business's form
-- produces a contact with an email and the business can send email (see
-- supabase/functions/growth-process-submission/lead-reply.ts). The processor already checks for an
-- existing action before filing, but a check-then-insert can race (a re-claimed submission, a sweeper
-- retry running beside a slow first attempt). This index makes "one reply draft per submission" a fact
-- the database enforces: a second owner.lead_followup carrying the same submission_id in the same
-- business is refused with 23505, which the processor reads as "already drafted" (success).
--
-- What this does NOT change (§58): owner.lead_followup's catalogue row — send_via_approval,
-- requires_approval = true, default lane confirm, approval_type cs_draft — and the two safety CHECKs
-- on paige_action_kinds (chk_send_requires_approval, chk_auto_lane_safe) are untouched. Nothing here
-- can send; only the owner's approval through execute-approval ever does.
--
-- Additive only. Idempotent: replaying this file is a no-op.
-- ============================================================================

-- 1. Why the processor did not draft a reply for this lead, when it did not (the twin of
--    alert_skipped_reason, 20270518000000_public_form_intake.sql). NULL = drafted, or never planned.
ALTER TABLE public.growth_form_submissions
  ADD COLUMN IF NOT EXISTS lead_reply_skipped_reason text;

COMMENT ON COLUMN public.growth_form_submissions.lead_reply_skipped_reason IS
  'Why no reply draft was filed for this lead (e.g. no_contact_email, no_email_sender, business_hourly_cap). Written by growth-process-submission; NULL when a draft was filed or none was planned.';

-- 2. One owner.lead_followup per (business, submission).
--    A pre-existing duplicate would make CREATE UNIQUE INDEX fail with a bare 23505; say what it is
--    instead, so the deploy fails loudly with the reason and nothing is deleted on our behalf (§13).
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

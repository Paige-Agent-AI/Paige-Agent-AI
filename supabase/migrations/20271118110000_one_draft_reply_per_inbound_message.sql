-- ============================================================================
-- Experience 03 — one draft reply per inbound message.
--
-- WHY. Re-review N1 of #2976: handle-inbound-email files the comms-draft-reply action with
-- check-then-insert, so two concurrent deliveries of the same SendGrid post (SendGrid retries, or
-- the same post landing twice) can each file a draft and the owner sees two drafts for one reply.
--
-- WHAT. A partial unique index, the same shape as uq_paige_actions_lead_followup_submission:
-- (tenant_id, payload->>'message_id') for action_kind = 'comms-draft-reply'. handle-inbound-email
-- treats the resulting 23505 as "already filed".
--
-- PRODUCTION (read 2026-10-27, SELECT only): 4 comms-draft-reply actions, all with a message_id,
-- no duplicates, so the index builds without touching any row.
--
-- REVERSAL: DROP INDEX public.uq_paige_actions_draft_reply_message.
-- ============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS uq_paige_actions_draft_reply_message
  ON public.paige_actions (tenant_id, (payload ->> 'message_id'))
  WHERE action_kind = 'comms-draft-reply' AND payload ? 'message_id';

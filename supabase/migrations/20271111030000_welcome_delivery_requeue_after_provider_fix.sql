-- Welcome delivery re-queue after the provider-sender-identity fix (2026-10-19).
--
-- Live truth before this migration: the sole fulfilled Solo Beta enrollment's
-- welcome delivery is state='needs_attention', attempt_count=8,
-- last_error_code='provider_rejected' (sendgrid_403 "from address does not
-- match a verified Sender Identity"), sent_at NULL, provider_message_id NULL.
-- The lifecycle caps failed attempts at 5 into needs_attention and the drainer
-- never scans that state, so the row is stranded even though the send path is
-- now repaired (definitive sender-identity 403 falls back to the live Resend
-- arm; a 403 sends nothing, so the requeue cannot duplicate).
--
-- Guarded one-shot: only provider-rejected rows that never produced any send
-- receipt are re-armed to retryable_failure with an immediate next attempt.
-- Idempotent by predicate — after the drainer retries, the row leaves
-- needs_attention and this UPDATE no longer matches; successful sends land in
-- state='sent' with provider_message_id set.

UPDATE solo_beta_welcome_deliveries
SET state = 'retryable_failure',
    next_attempt_at = now(),
    updated_at = now()
WHERE state = 'needs_attention'
  AND last_error_code = 'provider_rejected'
  AND sent_at IS NULL
  AND provider_message_id IS NULL;

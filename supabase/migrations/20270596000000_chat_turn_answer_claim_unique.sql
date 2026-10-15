-- ============================================================================================
-- C4c — ONE ANSWER PER QUESTION: a partial unique index on the existing chat transcript.
--
-- docs/delivery/paige-conversational-loop-c4.md §2c. When PAIGE cannot continue an objective
-- without one fact only the person has, she asks (`ask_choices`); the assistant turn that carries
-- the question IS the ask (`bundle_ref.paige_ask`, `turn_state.state = 'ASK_USER'`). The person's
-- answer is appended as their own turn carrying `bundle_ref.paige_resume = {kind: 'answer', key:
-- 'answer:<ask_id>', from_turn_id}` — and only then is PAIGE called to continue the same objective.
--
-- This index makes that claim exactly-once: per thread, at most ONE user turn may carry a given
-- resume key. A second answer to the same question — a double tap, a second tab, a transport retry,
-- a reload that sends again — is refused by the database (SQLSTATE 23505, surfaced through
-- `paige_chat_turn_append`), and the chat handler then refuses the request before any model call.
--
-- THE FOUR JUSTIFICATIONS (the C4 rule for any database addition):
--
--  1. WHAT FACT HAS NO HOME. "This question was answered by exactly one request." Turns are
--     append-only — `authenticated` has SELECT only, and no UPDATE path to `paige_chat_turns`
--     exists in supabase/ or src/ — so nothing can be flipped in place, and `paige_chat_turn_append`
--     is an unconditional INSERT. Two concurrent answers both land and both run the model; prod
--     showed 18 adjacent identical user turns < 2 min apart in 30 days (C4 grounding), so this is
--     not hypothetical. A read-then-append check in the handler cannot close the race on its own.
--  2. WHY `turn_state` CANNOT HOLD IT. It is jsonb inside ONE row: it cannot enforce uniqueness
--     across rows, cannot be updated after insert (append-only), and its contract forbids ids and
--     prose (supabase/functions/_shared/paige-turn/contract.ts, header). It is also owner-forgeable
--     through the append RPC's grant, so it is never authority.
--  3. WHY `paige_durable_work` CANNOT HOLD IT. A question and its answer are dialogue, not durable
--     work: that table is service-only (forced RLS, no policies, no grants to authenticated), its
--     terminal rows are immutable and its identity fields trigger-frozen, and its unique keys are
--     (tenant, initiating user, intent) and the idempotency key — not "one reply per question".
--     Turning answers into work rows would give the conversation a second job lifecycle.
--  4. WHY THIS IS NOT A SECOND WORKFLOW ENGINE. No table, column, function, trigger, state machine,
--     worker, scheduler or lease is added. It is one partial index on the transcript that already
--     holds both turns — the same precedent as `paige_chat_turns_work_uk` (20270418000000), which
--     makes a durable-work completion land exactly once. The resume runs in the existing chat loop.
--
-- SCOPE OF THE INDEX, exactly:
--   · role = 'user' only — an assistant turn's `paige_resume` (C4a/C4b's approval record, and the
--     answer record on the continuation) is a record, not a claim, and is never constrained;
--   · rows that carry `paige_resume` only — every other turn (NULL key) is untouched, and a row
--     whose key is NULL can never conflict (NULLs are distinct in a unique index);
--   · per thread — the same key in another thread is another question.
-- A thread owner can forge a `paige_resume` key on their OWN thread through the append grant; the
-- only effect is to make their own question unanswerable (a refusal that says so). It grants nothing:
-- the key is never read as authority, only as "this question already has its answer".
--
-- Additive and non-destructive: CREATE INDEX IF NOT EXISTS on an existing table. No code path wrote
-- `paige_resume` on a USER turn before this change (C4a/C4b write it on assistant turns only — read in
-- source, not measured on production in this slice), so the build is not expected to meet duplicates;
-- if it ever did, the migration fails loudly rather than skipping.
--
-- §32 OWED, stated rather than implied: the pgTAP proof (supabase/tests/chat_turn_answer_claim_unique.sql)
-- and the two-connection race (scripts/proof/chat-answer-claim-race.mjs) show the index BEHAVES; the
-- persisted-apply confirmation — the `schema_migrations` row on prod and the index present in
-- `pg_indexes` — is owed after merge (deploy-migrations.yml) and is not claimed here.
-- ============================================================================================

CREATE UNIQUE INDEX IF NOT EXISTS paige_chat_turns_resume_uk
  ON public.paige_chat_turns (thread_id, ((bundle_ref -> 'paige_resume' ->> 'key')))
  WHERE role = 'user' AND bundle_ref ? 'paige_resume';

COMMENT ON INDEX public.paige_chat_turns_resume_uk IS
  'C4c: at most one USER turn per thread may carry a given bundle_ref.paige_resume.key (answer:<ask_id>) — one answer per question, enforced by the database. Not authority: a claim, never an approval.';

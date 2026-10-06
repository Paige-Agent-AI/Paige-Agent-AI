-- ============================================================================
-- C4c — one answer per question (20270596000000_chat_turn_answer_claim_unique).
--
-- Proves the partial unique index `paige_chat_turns_resume_uk` does exactly what the chat handler
-- relies on, and nothing more:
--   · a second USER turn in the same thread carrying the same `paige_resume.key` is refused with
--     23505 — directly, and through `paige_chat_turn_append` as the thread's own owner (the path the
--     handler uses, under the caller's JWT);
--   · the same key in ANOTHER thread is another question and is accepted;
--   · ASSISTANT turns are never constrained (C4a/C4b's approval record and the answer record on the
--     continuation live there);
--   · a turn with no `paige_resume`, or one whose key is NULL, never conflicts.
-- The two-connection race (two committed sessions, one wins) is scripts/proof/chat-answer-claim-race.mjs.
--
-- Synthetic fixtures only. Rolls back.
-- ============================================================================
BEGIN;

SELECT plan(11);

INSERT INTO auth.users (id, aud, role, email) VALUES
  ('c4c00000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'c4c-answer-owner@tests.invalid');
INSERT INTO public.tenants (id, slug, name, status, account_type, account_number_prefix, features) VALUES
  ('c4c00000-0000-4000-8000-000000000010', 'c4c-answer-a', 'C4c Answer A', 'active', 'standalone', 'CQA', '{}'::jsonb);
INSERT INTO public.tenant_members (tenant_id, user_id, role, status, is_owner, joined_at) VALUES
  ('c4c00000-0000-4000-8000-000000000010', 'c4c00000-0000-4000-8000-000000000001', 'owner', 'active', true, now());
INSERT INTO public.paige_chat_threads (id, caller_user_id, tenant_id, lens, title) VALUES
  ('c4c00000-0000-4000-8000-000000000020', 'c4c00000-0000-4000-8000-000000000001', 'c4c00000-0000-4000-8000-000000000010', 'coach', 'Answer claim proof A'),
  ('c4c00000-0000-4000-8000-000000000021', 'c4c00000-0000-4000-8000-000000000001', 'c4c00000-0000-4000-8000-000000000010', 'coach', 'Answer claim proof B');

SELECT ok(
  EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'paige_chat_turns'
           AND indexname = 'paige_chat_turns_resume_uk'
           AND indexdef ILIKE 'CREATE UNIQUE INDEX%'
           AND indexdef ILIKE '%WHERE%role%user%paige_resume%'),
  'the answer-claim index exists, is UNIQUE, and is partial on user turns that carry paige_resume'
);

-- The first answer to a question lands.
SELECT lives_ok($$
  INSERT INTO public.paige_chat_turns (thread_id, role, content, bundle_ref) VALUES
    ('c4c00000-0000-4000-8000-000000000020', 'user', 'Start it November 1.',
     '{"paige_resume":{"kind":"answer","key":"answer:c4c00000-0000-4000-8000-0000000000a1","from_turn_id":"c4c00000-0000-4000-8000-0000000000b1"}}'::jsonb)
$$, 'the first answer to a question is accepted');

-- A second answer to the SAME question in the SAME thread is refused by the database.
SELECT throws_ok($$
  INSERT INTO public.paige_chat_turns (thread_id, role, content, bundle_ref) VALUES
    ('c4c00000-0000-4000-8000-000000000020', 'user', 'Start it November 1.',
     '{"paige_resume":{"kind":"answer","key":"answer:c4c00000-0000-4000-8000-0000000000a1","from_turn_id":"c4c00000-0000-4000-8000-0000000000b1"}}'::jsonb)
$$, '23505', NULL, 'a second answer to the same question in the same thread fails with 23505');

-- …even when everything but the key differs (another wording, another from_turn_id, skipped).
SELECT throws_ok($$
  INSERT INTO public.paige_chat_turns (thread_id, role, content, bundle_ref) VALUES
    ('c4c00000-0000-4000-8000-000000000020', 'user', 'Use your best guess.',
     '{"paige_resume":{"kind":"answer","key":"answer:c4c00000-0000-4000-8000-0000000000a1","from_turn_id":"c4c00000-0000-4000-8000-0000000000b2","skipped":true}}'::jsonb)
$$, '23505', NULL, 'the key alone decides: a different wording or a skip of the same question is refused too');

SELECT lives_ok($$
  INSERT INTO public.paige_chat_turns (thread_id, role, content, bundle_ref) VALUES
    ('c4c00000-0000-4000-8000-000000000021', 'user', 'Start it November 1.',
     '{"paige_resume":{"kind":"answer","key":"answer:c4c00000-0000-4000-8000-0000000000a1","from_turn_id":"c4c00000-0000-4000-8000-0000000000b1"}}'::jsonb)
$$, 'the same key in another thread is another question and is accepted');

SELECT lives_ok($$
  INSERT INTO public.paige_chat_turns (thread_id, role, content, bundle_ref) VALUES
    ('c4c00000-0000-4000-8000-000000000020', 'assistant', 'x', '{"paige_resume":{"kind":"answer","key":"answer:c4c00000-0000-4000-8000-0000000000a1"}}'::jsonb),
    ('c4c00000-0000-4000-8000-000000000020', 'assistant', 'y', '{"paige_resume":{"kind":"answer","key":"answer:c4c00000-0000-4000-8000-0000000000a1"}}'::jsonb)
$$, 'assistant turns are never constrained, even with an identical key');

SELECT lives_ok($$
  INSERT INTO public.paige_chat_turns (thread_id, role, content, bundle_ref) VALUES
    ('c4c00000-0000-4000-8000-000000000020', 'user', 'hello', NULL),
    ('c4c00000-0000-4000-8000-000000000020', 'user', 'hello', NULL),
    ('c4c00000-0000-4000-8000-000000000020', 'user', 'hello', '{"turn_state":{}}'::jsonb),
    ('c4c00000-0000-4000-8000-000000000020', 'user', 'hello', '{"turn_state":{}}'::jsonb)
$$, 'ordinary user turns (no paige_resume) never conflict');

SELECT lives_ok($$
  INSERT INTO public.paige_chat_turns (thread_id, role, content, bundle_ref) VALUES
    ('c4c00000-0000-4000-8000-000000000020', 'user', 'a', '{"paige_resume":{"kind":"answer"}}'::jsonb),
    ('c4c00000-0000-4000-8000-000000000020', 'user', 'b', '{"paige_resume":{"kind":"answer"}}'::jsonb)
$$, 'a paige_resume with a NULL key never conflicts (NULLs are distinct)');

-- Through the append RPC, as the thread's own owner — the exact call the chat handler makes.
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.sub', 'c4c00000-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claims', '{"sub":"c4c00000-0000-4000-8000-000000000001","role":"authenticated"}', true);

SELECT lives_ok($$
  SELECT public.paige_chat_turn_append('c4c00000-0000-4000-8000-000000000020'::uuid, 'user', 'Make it 10 monthly payments.',
    NULL, NULL, NULL, NULL, NULL,
    '{"paige_resume":{"kind":"answer","key":"answer:c4c00000-0000-4000-8000-0000000000a2","from_turn_id":"c4c00000-0000-4000-8000-0000000000b3"}}'::jsonb, NULL)
$$, 'the owner''s first answer through paige_chat_turn_append is accepted');

SELECT throws_ok($$
  SELECT public.paige_chat_turn_append('c4c00000-0000-4000-8000-000000000020'::uuid, 'user', 'Make it 10 monthly payments.',
    NULL, NULL, NULL, NULL, NULL,
    '{"paige_resume":{"kind":"answer","key":"answer:c4c00000-0000-4000-8000-0000000000a2","from_turn_id":"c4c00000-0000-4000-8000-0000000000b3"}}'::jsonb, NULL)
$$, '23505', NULL, 'a second answer through paige_chat_turn_append surfaces 23505 to the caller (the handler''s refusal signal)');

RESET role;

SELECT is(
  (SELECT count(*)::int FROM public.paige_chat_turns
    WHERE thread_id = 'c4c00000-0000-4000-8000-000000000020' AND role = 'user'
      AND bundle_ref -> 'paige_resume' ->> 'key' = 'answer:c4c00000-0000-4000-8000-0000000000a2'),
  1,
  'exactly one answer row exists for that question after the refused second append'
);

SELECT * FROM finish();
ROLLBACK;

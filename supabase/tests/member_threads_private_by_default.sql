-- A member's private conversation with Paige is hidden from an operator by default, openable on
-- purpose, and recorded when opened (owner ruling 2026-09-28, after a super_admin acting as a
-- workspace was shown a member's conversation as their own). Synthetic fixtures; rolled back.
BEGIN;
SELECT plan(31);

INSERT INTO auth.users (id, aud, role, email) VALUES
  ('0a5c0000-0000-4000-8000-000000000001','authenticated','authenticated','threads-super@tests.invalid'),
  ('0a5c0000-0000-4000-8000-000000000002','authenticated','authenticated','threads-platform@tests.invalid'),
  ('0a5c0000-0000-4000-8000-000000000003','authenticated','authenticated','threads-member@tests.invalid'),
  ('0a5c0000-0000-4000-8000-000000000004','authenticated','authenticated','threads-other@tests.invalid');
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
INSERT INTO public.user_roles (user_id, role) VALUES
  ('0a5c0000-0000-4000-8000-000000000001','super_admin'),
  ('0a5c0000-0000-4000-8000-000000000002','platform_admin'),
  ('0a5c0000-0000-4000-8000-000000000003','admin')
ON CONFLICT DO NOTHING;
SELECT set_config('request.jwt.claims','',true);

INSERT INTO public.tenants (id, slug, name, owner_user_id, status, account_type, features, brand) VALUES
  ('0a5c0000-0000-4000-8000-00000000a001','threads-proof-one','Threads Proof One',
   '0a5c0000-0000-4000-8000-000000000003','active','standalone','{}'::jsonb,'{}'::jsonb),
  ('0a5c0000-0000-4000-8000-00000000a002','threads-proof-two','Threads Proof Two',
   '0a5c0000-0000-4000-8000-000000000004','active','standalone','{}'::jsonb,'{}'::jsonb);
INSERT INTO public.tenant_members (tenant_id, user_id, role, status, is_owner, joined_at) VALUES
  ('0a5c0000-0000-4000-8000-00000000a001','0a5c0000-0000-4000-8000-000000000003','owner','active',true,now()),
  ('0a5c0000-0000-4000-8000-00000000a002','0a5c0000-0000-4000-8000-000000000004','owner','active',true,now());
INSERT INTO public.profiles (user_id, active_tenant_id, full_name) VALUES
  ('0a5c0000-0000-4000-8000-000000000001',NULL,'Proof Operator'),
  ('0a5c0000-0000-4000-8000-000000000002',NULL,'Proof Platform Admin'),
  ('0a5c0000-0000-4000-8000-000000000003','0a5c0000-0000-4000-8000-00000000a001','Proof Member'),
  ('0a5c0000-0000-4000-8000-000000000004','0a5c0000-0000-4000-8000-00000000a002','Proof Other')
ON CONFLICT (user_id) DO UPDATE SET active_tenant_id = EXCLUDED.active_tenant_id, full_name = EXCLUDED.full_name;

-- The member's private conversation, with a folded summary Paige's memory would pick up; another
-- workspace's private conversation; and the operator's own thread in workspace one.
INSERT INTO public.paige_chat_threads (id, tenant_id, caller_user_id, lens, title, summary, message_count, last_message_at) VALUES
  ('0a5c0000-0000-4000-8000-0000000000f1','0a5c0000-0000-4000-8000-00000000a001',
   '0a5c0000-0000-4000-8000-000000000003','coach','Member private title','MEMBER PRIVATE SUMMARY',2,now()),
  ('0a5c0000-0000-4000-8000-0000000000f2','0a5c0000-0000-4000-8000-00000000a002',
   '0a5c0000-0000-4000-8000-000000000004','coach','Other workspace title',NULL,1,now()),
  ('0a5c0000-0000-4000-8000-0000000000f3','0a5c0000-0000-4000-8000-00000000a001',
   '0a5c0000-0000-4000-8000-000000000001','coach','Operator own title',NULL,0,now());
-- A member's Studio-session thread: it lives in the Studio gallery, so it is neither listed nor
-- openable here.
INSERT INTO public.studio_sessions (id, tenant_id) VALUES
  ('0a5c0000-0000-4000-8000-0000000000e1','0a5c0000-0000-4000-8000-00000000a001');
INSERT INTO public.paige_chat_threads (id, tenant_id, caller_user_id, lens, title, message_count, last_message_at, studio_session_id) VALUES
  ('0a5c0000-0000-4000-8000-0000000000f4','0a5c0000-0000-4000-8000-00000000a001',
   '0a5c0000-0000-4000-8000-000000000003','coach','Member studio session',1,now(),
   '0a5c0000-0000-4000-8000-0000000000e1');
INSERT INTO public.paige_chat_turns (thread_id, role, content) VALUES
  ('0a5c0000-0000-4000-8000-0000000000f1','user','member question'),
  ('0a5c0000-0000-4000-8000-0000000000f1','assistant','paige answer to the member');

CREATE FUNCTION pg_temp.as_caller(_uid uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _uid::text, 'role', 'authenticated')::text, true);
END $$;
-- Runs as the table owner: the capability grant is not the caller's to change.
CREATE FUNCTION pg_temp.set_act_as_in_force(_role text, _on boolean) RETURNS void
LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE public.platform_operator_role_capabilities
     SET in_force = _on,
         pending = CASE WHEN _on THEN NULL ELSE 'withdrawn by this test' END
   WHERE role = _role AND capability = 'tenant.act_as'
$$;
-- One transaction has one now(): a re-enter after an exit would tie with it, and the exit wins a
-- tie. This moves the operator's latest enter a minute on, as time would.
CREATE FUNCTION pg_temp.later_enter(_actor uuid) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE public.paige_audit_log SET created_at = now() + interval '1 minute'
   WHERE actor_user_id = _actor AND action = 'operator.tenant.enter' AND created_at = now()
$$;
CREATE FUNCTION pg_temp.opens() RETURNS int LANGUAGE sql SECURITY DEFINER AS $$
  SELECT count(*)::int FROM public.paige_audit_log
   WHERE action = 'operator.thread.open' AND target_id = '0a5c0000-0000-4000-8000-0000000000f1'
$$;
CREATE FUNCTION pg_temp.thread_exists(_id uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$
  SELECT EXISTS (SELECT 1 FROM public.paige_chat_threads WHERE id = _id)
$$;

-- Grant surface.
SELECT ok(NOT has_function_privilege('anon','public.operator_open_member_thread(uuid)','EXECUTE'),
  'the audited open is not callable anonymously');
SELECT ok(NOT has_function_privilege('anon','public.operator_list_member_threads()','EXECUTE'),
  'the member list is not callable anonymously');
SELECT ok(NOT has_function_privilege('authenticated','public.operator_open_act_as_tenant()','EXECUTE'),
  'the act-as receipt helper (from #1554) is not a door of its own');

SET LOCAL ROLE authenticated;

-- The member still reads their own conversation.
SELECT pg_temp.as_caller('0a5c0000-0000-4000-8000-000000000003');
SELECT is((SELECT count(*)::int FROM public.paige_chat_threads WHERE id = '0a5c0000-0000-4000-8000-0000000000f1'), 1,
  'the member reads their own thread');
SELECT is((SELECT count(*)::int FROM public.paige_chat_turns WHERE thread_id = '0a5c0000-0000-4000-8000-0000000000f1'), 2,
  'the member reads their own turns');

-- The super_admin, acting as the workspace.
SELECT pg_temp.as_caller('0a5c0000-0000-4000-8000-000000000001');
SELECT is(public.operator_enter_tenant('0a5c0000-0000-4000-8000-00000000a001') ->> 'active_tenant_id',
  '0a5c0000-0000-4000-8000-00000000a001', 'the super_admin enters the workspace');

-- Hidden by default: not in a read, not in the transcript, not in Paige's memory.
SELECT is((SELECT count(*)::int FROM public.paige_chat_threads
            WHERE tenant_id = '0a5c0000-0000-4000-8000-00000000a001' AND lens = 'coach' AND contact_id IS NULL), 1,
  'the panel''s default list returns only the operator''s own thread');
SELECT is((SELECT count(*)::int FROM public.paige_chat_threads WHERE id = '0a5c0000-0000-4000-8000-0000000000f1'), 0,
  'a direct read of the member''s thread returns nothing');
SELECT is((SELECT count(*)::int FROM public.paige_chat_turns WHERE thread_id = '0a5c0000-0000-4000-8000-0000000000f1'), 0,
  'a direct read of the member''s turns returns nothing');
SELECT is((SELECT count(*)::int FROM public.paige_chat_threads WHERE id = '0a5c0000-0000-4000-8000-0000000000f2'), 0,
  'another workspace''s private thread is not readable either');
SELECT ok(position('MEMBER PRIVATE SUMMARY' in public.paige_operating_memory(NULL, 10, NULL)::text) = 0,
  'Paige''s operating memory for the operator carries no member''s private summary');
SELECT is((SELECT count(*)::int FROM public.paige_chat_threads WHERE id = '0a5c0000-0000-4000-8000-0000000000f3'), 1,
  'the operator still reads their own thread');

-- Openable on purpose, and recorded.
SELECT is((SELECT count(*)::int FROM public.operator_list_member_threads()), 1,
  'the operator sees that one member conversation exists');
SELECT is((SELECT owner_name FROM public.operator_list_member_threads()), 'Proof Member',
  'the list names whose it is');
SELECT is(pg_temp.opens(), 0, 'listing records no open');
SELECT is(jsonb_array_length(public.operator_open_member_thread('0a5c0000-0000-4000-8000-0000000000f1') -> 'turns'), 2,
  'opening it on purpose returns its turns');
SELECT is(pg_temp.opens(), 1, 'opening it records one operator.thread.open');
SELECT throws_ok($$SELECT public.operator_open_member_thread('0a5c0000-0000-4000-8000-0000000000f2')$$,
  'P0002', 'member_thread_not_available', 'a thread in another workspace cannot be opened');
SELECT throws_ok($$SELECT public.operator_open_member_thread('0a5c0000-0000-4000-8000-0000000000f4')$$,
  'P0002', 'member_thread_not_available', 'a member''s Studio-session thread is not opened here');
SELECT throws_ok($$SELECT public.operator_open_member_thread('0a5c0000-0000-4000-8000-0000000000f3')$$,
  'P0002', 'member_thread_not_available', 'the open is only for other people''s private threads');

-- A delete cannot reach a thread the operator cannot see — filtered or bare.
DELETE FROM public.paige_chat_threads WHERE id = '0a5c0000-0000-4000-8000-0000000000f1';
SELECT ok(pg_temp.thread_exists('0a5c0000-0000-4000-8000-0000000000f1'),
  'the operator cannot delete the member''s private thread');
DELETE FROM public.paige_chat_threads WHERE true;
SELECT ok(pg_temp.thread_exists('0a5c0000-0000-4000-8000-0000000000f1'),
  'a delete that reads no column still cannot reach the member''s private thread');
SELECT ok(NOT pg_temp.thread_exists('0a5c0000-0000-4000-8000-0000000000f3'),
  'the operator''s own thread is still theirs to delete');

-- Not acting: nothing to open. A self-set pointer is not an act-as.
SELECT ok((public.operator_exit_tenant() ->> 'exited')::boolean IS NOT FALSE, 'the super_admin exits');
UPDATE public.profiles SET active_tenant_id = '0a5c0000-0000-4000-8000-00000000a001'
 WHERE user_id = '0a5c0000-0000-4000-8000-000000000001';
SELECT throws_ok($$SELECT public.operator_open_member_thread('0a5c0000-0000-4000-8000-0000000000f1')$$,
  '42501', 'operator_not_acting', 'a pointer with no open enter receipt cannot open a member''s thread');
SELECT is(pg_temp.opens(), 1, 'a refused open records nothing');

-- The capability is the super_admin's today (G1's default rule for an unlisted capability).
SELECT pg_temp.as_caller('0a5c0000-0000-4000-8000-000000000002');
SELECT throws_ok($$SELECT * FROM public.operator_list_member_threads()$$,
  '42501', 'operator_member_threads_not_permitted', 'a platform_admin does not hold the capability');

-- Withdrawing act-as closes the door even inside an act-as already open: the member-thread
-- capability is not a standing pass around tenant.act_as (Codex review of 1b81bb3d).
SELECT pg_temp.as_caller('0a5c0000-0000-4000-8000-000000000001');
SELECT is(public.operator_enter_tenant('0a5c0000-0000-4000-8000-00000000a001') ->> 'active_tenant_id',
  '0a5c0000-0000-4000-8000-00000000a001', 'the super_admin enters the workspace again');
RESET ROLE;
SELECT pg_temp.later_enter('0a5c0000-0000-4000-8000-000000000001');
SELECT pg_temp.set_act_as_in_force('super_admin', false);
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_caller('0a5c0000-0000-4000-8000-000000000001');
SELECT throws_ok($$SELECT * FROM public.operator_list_member_threads()$$,
  '42501', 'operator_member_threads_not_permitted', 'with act-as withdrawn, the list is refused inside an open act-as');
SELECT throws_ok($$SELECT public.operator_open_member_thread('0a5c0000-0000-4000-8000-0000000000f1')$$,
  '42501', 'operator_member_threads_not_permitted', 'with act-as withdrawn, the open is refused inside an open act-as');
SELECT is(pg_temp.opens(), 1, 'a refused open after withdrawal records nothing');

SELECT * FROM finish();
ROLLBACK;

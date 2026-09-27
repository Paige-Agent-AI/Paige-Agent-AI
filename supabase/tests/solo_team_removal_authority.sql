-- An Owner removes ONE Admin or Member from the workspace they are in — and nobody else can.
-- Behavioural proof against the APPLIED schema: `supabase db reset` replays every migration from
-- zero, so these assertions run against 20261048000000 as the pipeline actually applies it, not
-- against a function created inside the test and discarded with it. Synthetic fixtures, always
-- rolled back, no production data.
--
-- WHY THIS FILE EXISTS RATHER THAN A PREVIEW-BRANCH TRANSCRIPT. The earlier applied-schema evidence
-- for this migration was taken on a Supabase Preview branch under version 20261044000000, and the
-- migration has since been renumbered twice past collisions on main. Restating that transcript at a
-- version no preview has ever seen would be exactly the promotion of a weaker evidence class this
-- programme keeps refusing. Preview is also not dependable here — the project hits its concurrent
-- preview-branch limit — so the proof lives in `database-contract`, which resets and replays every
-- time.
--
-- THE HALF THAT MATTERS MOST is not the RPC. Before this migration any tenant Admin could DELETE
-- any membership row, every Owner's included, straight through PostgREST — and `anon` and
-- `authenticated` both held TRUNCATE, which RLS does not apply to at all. A guarded function in
-- front of an unguarded table is decoration, so the table privileges are asserted here first.
BEGIN;

SELECT plan(40);

-- ── The table, before the function ──────────────────────────────────────────────────────────────
-- SELECT is deliberately retained: roughly ten browser reads depend on it.
SELECT ok(
  has_table_privilege('authenticated', 'public.tenant_members', 'SELECT'),
  'browser callers can still READ the roster — the reads this surface is built on are untouched'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.tenant_members', 'DELETE'),
  'a tenant admin can no longer DELETE a membership row directly'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.tenant_members', 'UPDATE'),
  'nor UPDATE one — writing status to inactive ends access exactly as a delete does, only quieter'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.tenant_members', 'INSERT'),
  'nor INSERT one — self-granting a membership is the same boundary seen from the other side'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.tenant_members', 'TRUNCATE'),
  'nor TRUNCATE — measured, not assumed: RLS does not apply to TRUNCATE at all'
);
SELECT ok(
  NOT has_table_privilege('anon', 'public.tenant_members', 'DELETE'),
  'anonymous callers cannot DELETE a membership row'
);
SELECT ok(
  NOT has_table_privilege('anon', 'public.tenant_members', 'TRUNCATE'),
  'anonymous callers cannot TRUNCATE the membership table'
);
SELECT ok(
  NOT has_table_privilege('anon', 'public.tenant_members', 'UPDATE'),
  'anonymous callers cannot UPDATE a membership row'
);

-- THE CONTROL FOR EVERYTHING ABOVE, and the reason this file can claim the TRUNCATE revoke at all.
--
-- Raised by the peer read of this diff: the browser-role grants on `tenant_members` come from the
-- platform's own blanket privileges, NOT from any migration in this repo — so if a from-zero replay
-- never granted `anon` those verbs in the first place, every `NOT has_table_privilege` assertion
-- above would pass whether or not line 177 of the migration exists. A guard that cannot observe
-- itself is decoration, and TRUNCATE is the headline claim.
--
-- So rather than argue it, this measures it: a NEIGHBOURING table this migration never touches must
-- still carry the grant. If it does, the environment demonstrably distinguishes revoked from
-- not-revoked, and the assertions above are real. If it does NOT, this fails loudly and tells us the
-- privilege half of this file proves nothing here — which is the honest outcome, not a silent pass.
SELECT ok(
  has_table_privilege('anon', 'public.tenants', 'TRUNCATE'),
  'a table this migration does not touch still carries the platform grant — so the revokes above are measuring something'
);

-- ── Reachability of the one supported route ─────────────────────────────────────────────────────
SELECT ok(
  has_function_privilege('authenticated', 'public.remove_solo_team_member(uuid,uuid)', 'EXECUTE'),
  'the Owner reaches removal from the browser — this RPC is the supported route, not a back door'
);
SELECT ok(
  NOT has_function_privilege('anon', 'public.remove_solo_team_member(uuid,uuid)', 'EXECUTE'),
  'anonymous callers cannot reach removal'
);
SELECT ok(
  (SELECT prosecdef FROM pg_proc WHERE oid = 'public.remove_solo_team_member(uuid,uuid)'::regprocedure),
  'removal is SECURITY DEFINER — which is only safe because its body re-derives the caller (§59)'
);
SELECT is(
  (SELECT array_to_string(proconfig, ',') FROM pg_proc
    WHERE oid = 'public.remove_solo_team_member(uuid,uuid)'::regprocedure),
  'search_path=public, pg_temp',
  'and it is pinned to a fixed search_path'
);

-- ── Fixtures ────────────────────────────────────────────────────────────────────────────────────
INSERT INTO auth.users (id, aud, role, email) VALUES
  ('d1000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'rm-owner@tests.invalid'),
  ('d1000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'rm-coowner@tests.invalid'),
  ('d1000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'rm-admin@tests.invalid'),
  ('d1000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'rm-member@tests.invalid'),
  ('d1000000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'rm-coach@tests.invalid'),
  ('d1000000-0000-0000-0000-000000000006', 'authenticated', 'authenticated', 'rm-suspended@tests.invalid'),
  ('d1000000-0000-0000-0000-000000000007', 'authenticated', 'authenticated', 'rm-outsider@tests.invalid'),
  ('e1000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'rm-b-owner@tests.invalid');

INSERT INTO public.tenants
  (id, slug, name, status, account_type, account_number_prefix, account_number, features)
VALUES
  ('d1000000-0000-0000-0000-00000000dddd', 'removal-authority-a', 'Removal Authority A', 'active', 'standalone', 'RAA', 9320001, '{}'::jsonb),
  ('e1000000-0000-0000-0000-00000000eeee', 'removal-authority-b', 'Removal Authority B', 'active', 'standalone', 'RAB', 9320002, '{}'::jsonb);

INSERT INTO public.tenant_members (tenant_id, user_id, role, status, is_owner, joined_at) VALUES
  ('d1000000-0000-0000-0000-00000000dddd', 'd1000000-0000-0000-0000-000000000001', 'owner',  'active',    true,  now() - interval '10 days'),
  ('d1000000-0000-0000-0000-00000000dddd', 'd1000000-0000-0000-0000-000000000002', 'owner',  'active',    true,  now() - interval '9 days'),
  ('d1000000-0000-0000-0000-00000000dddd', 'd1000000-0000-0000-0000-000000000003', 'admin',  'active',    false, now() - interval '8 days'),
  ('d1000000-0000-0000-0000-00000000dddd', 'd1000000-0000-0000-0000-000000000004', 'member', 'active',    false, now() - interval '7 days'),
  ('d1000000-0000-0000-0000-00000000dddd', 'd1000000-0000-0000-0000-000000000005', 'member',  'active',    false, now() - interval '6 days'),
  ('d1000000-0000-0000-0000-00000000dddd', 'd1000000-0000-0000-0000-000000000006', 'admin',  'suspended', false, now() - interval '5 days'),
  -- Workspace B. The SAME admin belongs here too, and joined B FIRST — so B is their earliest
  -- membership, which is what makes the multi-workspace assertions below meaningful.
  ('e1000000-0000-0000-0000-00000000eeee', 'e1000000-0000-0000-0000-000000000001', 'owner',  'active',    true,  now() - interval '30 days'),
  ('e1000000-0000-0000-0000-00000000eeee', 'd1000000-0000-0000-0000-000000000003', 'admin',  'active',    false, now() - interval '20 days');

INSERT INTO public.profiles (user_id, active_tenant_id) VALUES
  ('d1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-00000000dddd'),
  ('d1000000-0000-0000-0000-000000000002', 'd1000000-0000-0000-0000-00000000dddd'),
  ('d1000000-0000-0000-0000-000000000003', 'd1000000-0000-0000-0000-00000000dddd'),
  ('d1000000-0000-0000-0000-000000000004', 'd1000000-0000-0000-0000-00000000dddd'),
  ('d1000000-0000-0000-0000-000000000005', 'd1000000-0000-0000-0000-00000000dddd'),
  -- The SUSPENDED admin's pointer is NULL, and that is not tidying — it is required.
  -- `guard_active_tenant_membership()` fires on UPDATE of profiles and demands an ACTIVE
  -- membership in the named workspace, and this INSERT ... ON CONFLICT DO UPDATE becomes an
  -- UPDATE because `handle_new_user` already created a row when the auth user was inserted.
  -- Pointing a suspended membership's profile at that workspace therefore raises 42501 and
  -- aborts the whole file. It is also the truthful state: a suspended person is not sitting
  -- in the workspace they are suspended from.
  ('d1000000-0000-0000-0000-000000000006', NULL),
  ('d1000000-0000-0000-0000-000000000007', NULL),
  ('e1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-00000000eeee')
ON CONFLICT (user_id) DO UPDATE SET active_tenant_id = EXCLUDED.active_tenant_id;

-- Something the admin authored, so "authored history survives removal" is a claim about a real row
-- rather than an assertion about an empty set.
INSERT INTO public.audit_logs (user_id, entity, action, entity_id, data)
VALUES ('d1000000-0000-0000-0000-000000000003', 'tenant_member', 'authored_before_removal',
        'd1000000-0000-0000-0000-00000000dddd', '{}'::jsonb);

-- ── No session at all ───────────────────────────────────────────────────────────────────────────
SELECT ok(auth.uid() IS NULL, 'no JWT is present yet');
SELECT throws_ok(
  $$SELECT public.remove_solo_team_member(
      'd1000000-0000-0000-0000-000000000004'::uuid,
      'd1000000-0000-0000-0000-00000000dddd'::uuid)$$,
  '42501', 'authentication required in an active workspace',
  'removal without a session is refused'
);

-- ── An Admin is not an Owner ────────────────────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims', '{"sub":"d1000000-0000-0000-0000-000000000003"}', true);
SELECT is(auth.uid(), 'd1000000-0000-0000-0000-000000000003'::uuid, 'the admin is the caller');
SELECT is(public.current_user_tenant_id(), 'd1000000-0000-0000-0000-00000000dddd'::uuid,
  'and their active workspace resolves to A');
SELECT throws_ok(
  $$SELECT public.remove_solo_team_member(
      'd1000000-0000-0000-0000-000000000004'::uuid,
      'd1000000-0000-0000-0000-00000000dddd'::uuid)$$,
  '42501', 'only the workspace owner may remove someone from this workspace',
  'an admin cannot remove anyone — this is the authority the screen claims, proved in the body'
);
SELECT is(
  (SELECT count(*)::int FROM public.tenant_members
    WHERE tenant_id = 'd1000000-0000-0000-0000-00000000dddd'
      AND user_id = 'd1000000-0000-0000-0000-000000000004'),
  1,
  'and the target is still there afterwards'
);

-- ── The Owner, and everything that must still fail closed ───────────────────────────────────────
SELECT set_config('request.jwt.claims', '{"sub":"d1000000-0000-0000-0000-000000000001"}', true);
SELECT is(public.current_user_tenant_id(), 'd1000000-0000-0000-0000-00000000dddd'::uuid,
  'the owner acts in workspace A');

SELECT throws_ok(
  $$SELECT public.remove_solo_team_member(
      'd1000000-0000-0000-0000-000000000001'::uuid,
      'd1000000-0000-0000-0000-00000000dddd'::uuid)$$,
  '42501', 'you cannot remove yourself from this workspace',
  'an owner cannot remove themselves'
);
SELECT throws_ok(
  $$SELECT public.remove_solo_team_member(
      'd1000000-0000-0000-0000-000000000002'::uuid,
      'd1000000-0000-0000-0000-00000000dddd'::uuid)$$,
  '42501', 'an owner cannot be removed from this workspace here',
  'nor a co-owner — which is what makes the SOLE owner unreachable by construction, not by a count'
);
SELECT throws_ok(
  $$SELECT public.remove_solo_team_member(
      'd1000000-0000-0000-0000-000000000004'::uuid,
      'e1000000-0000-0000-0000-00000000eeee'::uuid)$$,
  '42501', 'your active workspace changed before this could run; nothing was removed',
  'naming a different workspace aborts — the argument is a refusal token, never a selector'
);
SELECT throws_ok(
  $$SELECT public.remove_solo_team_member(
      'd1000000-0000-0000-0000-000000000007'::uuid,
      'd1000000-0000-0000-0000-00000000dddd'::uuid)$$,
  'P0001', 'that person is not on this workspace''s team',
  'naming somebody outside the workspace is refused'
);
SELECT throws_ok(
  $$SELECT public.remove_solo_team_member(
      NULL, 'd1000000-0000-0000-0000-00000000dddd'::uuid)$$,
  'P0001', 'name the person to remove',
  'naming nobody is refused rather than interpreted'
);
SELECT throws_ok(
  $$SELECT public.remove_solo_team_member(
      'd1000000-0000-0000-0000-000000000005'::uuid,
      'd1000000-0000-0000-0000-00000000dddd'::uuid)$$,
  'P0001', 'only an Admin or a Member can be removed from this workspace',
  'a legacy specialised permission (Coach) is out of scope here rather than silently reinterpreted'
);

-- ── The outcome ─────────────────────────────────────────────────────────────────────────────────
SELECT is(
  (SELECT public.remove_solo_team_member(
      'd1000000-0000-0000-0000-000000000003'::uuid,
      'd1000000-0000-0000-0000-00000000dddd'::uuid) ->> 'tenant_id'),
  'd1000000-0000-0000-0000-00000000dddd',
  'the owner removes an Admin, and the result names the workspace it acted in'
);
SELECT is(
  (SELECT count(*)::int FROM public.tenant_members
    WHERE tenant_id = 'd1000000-0000-0000-0000-00000000dddd'
      AND user_id = 'd1000000-0000-0000-0000-000000000003'),
  0,
  'their membership in A is gone'
);

-- THE ASSERTIONS THAT DECIDE WHETHER DELETION IS THE RIGHT MODEL. A removal is one workspace
-- ending one person's access — not an account closure, and not a reach into anywhere else.
SELECT is(
  (SELECT role::text FROM public.tenant_members
    WHERE tenant_id = 'e1000000-0000-0000-0000-00000000eeee'
      AND user_id = 'd1000000-0000-0000-0000-000000000003'),
  'admin',
  'their membership in workspace B is untouched — a removal reaches exactly one workspace'
);
SELECT is(
  (SELECT count(*)::int FROM auth.users WHERE id = 'd1000000-0000-0000-0000-000000000003'),
  1,
  'their identity survives'
);
SELECT is(
  (SELECT count(*)::int FROM public.profiles WHERE user_id = 'd1000000-0000-0000-0000-000000000003'),
  1,
  'their profile survives'
);
SELECT is(
  (SELECT active_tenant_id FROM public.profiles WHERE user_id = 'd1000000-0000-0000-0000-000000000003'),
  NULL::uuid,
  'their pointer at the workspace they left is cleared — the state #815 had to be released first for'
);
SELECT is(
  (SELECT count(*)::int FROM public.audit_logs
    WHERE user_id = 'd1000000-0000-0000-0000-000000000003'
      AND action = 'authored_before_removal'),
  1,
  'what they authored before is still keyed to them'
);
SELECT is(
  (SELECT count(*)::int FROM public.audit_logs
    WHERE action = 'member_removed'
      AND data ->> 'target_user_id' = 'd1000000-0000-0000-0000-000000000003'),
  1,
  'the removal itself is recorded once'
);
-- REMOVAL IS NOT A ONE-WAY DOOR, proven by actually re-inviting them.
--
-- This assertion used to count rows in `tenant_invite_tokens` and expect 0 — which was vacuous:
-- nothing in this file ever writes that table, so it was 0 before the migration existed, after it,
-- and if the function body were emptied. It also tested the wrong table; the concern was a lingering
-- row in `tenant_members`. Named by the peer read of this diff.
--
-- The real proof runs the invitation seam released in #815 against the person who was just removed.
-- `create_solo_team_invite` refuses with 'this person already belongs to the workspace' if ANY
-- membership row survives, status filter or not — so a successful re-invite is exactly the evidence
-- that removal left nothing behind, and it ties the two releases together end to end.
SELECT is(
  (SELECT public.create_solo_team_invite(
      'd1000000-0000-0000-0000-000000000001'::uuid,
      'd1000000-0000-0000-0000-00000000dddd'::uuid,
      'rm-admin@tests.invalid', 'admin', NULL, NULL) ->> 'tenant_id'),
  'd1000000-0000-0000-0000-00000000dddd',
  'the removed person can be invited back into the same workspace — removal left nothing behind'
);

-- A suspended membership is removable. The lookup deliberately carries no status filter: a filter
-- could only HIDE the row, and a hidden row is both unremovable here and still counted as "already
-- belongs to the workspace" by the invitation functions — permanently stuck, both ways.
SELECT lives_ok(
  $$SELECT public.remove_solo_team_member(
      'd1000000-0000-0000-0000-000000000006'::uuid,
      'd1000000-0000-0000-0000-00000000dddd'::uuid)$$,
  'a suspended member can be removed rather than left permanently stuck'
);
SELECT is(
  (SELECT count(*)::int FROM public.tenant_members
    WHERE tenant_id = 'd1000000-0000-0000-0000-00000000dddd'),
  4,
  'workspace A is down to its two owners, the member and the coach'
);
SELECT is(
  (SELECT count(*)::int FROM public.tenant_members
    WHERE tenant_id = 'e1000000-0000-0000-0000-00000000eeee'),
  2,
  'and workspace B is exactly as it was'
);

-- ── A LIMIT, asserted rather than left to be discovered ─────────────────────────────────────────
-- The workspace comes from `current_user_tenant_id()`, whose second arm is the caller's EARLIEST
-- active membership. An owner with a null pointer therefore acts in whichever workspace they joined
-- first, which may not be the one in front of them — and removal answers "your active workspace
-- changed" rather than removing the wrong person. That is the safe direction, and it is the same
-- divergence #815 repaired for invitations and did NOT repair generally. Asserted here so the limit
-- is recorded evidence instead of a later surprise.
SELECT set_config('request.jwt.claims', '{"sub":"e1000000-0000-0000-0000-000000000001"}', true);
UPDATE public.profiles SET active_tenant_id = NULL
 WHERE user_id = 'e1000000-0000-0000-0000-000000000001';
SELECT is(
  public.current_user_tenant_id(), 'e1000000-0000-0000-0000-00000000eeee'::uuid,
  'a null pointer falls back to the earliest active membership'
);
SELECT throws_ok(
  $$SELECT public.remove_solo_team_member(
      'd1000000-0000-0000-0000-000000000003'::uuid,
      'd1000000-0000-0000-0000-00000000dddd'::uuid)$$,
  '42501', 'your active workspace changed before this could run; nothing was removed',
  'and a workspace the fallback did not choose is REFUSED — never removed from by guess'
);

SELECT * FROM finish();
ROLLBACK;

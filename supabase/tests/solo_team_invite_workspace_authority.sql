-- An invitation goes to the workspace the operator NAMED. Behavioural proof against the applied
-- schema: `supabase db reset` replays every migration from zero, so these assertions run against
-- 20261047000000 as the pipeline actually applies it — not against a function created inside the
-- test. Synthetic fixtures; always rolled back.
--
-- THE TRAP THIS FILE EXISTS TO CATCH. `auth.uid()` is NULL for every statement below, exactly as it
-- is inside `solo-team-invitations` (service_role client). Any repair that resolved the workspace
-- through `current_user_tenant_id()` would return NULL here and every one of these creates would
-- raise. That the outcome tests PASS with no JWT present is the regression test for it.
BEGIN;

SELECT plan(43);

-- ── Reachability ────────────────────────────────────────────────────────────────────────────────
SELECT ok(
  NOT has_function_privilege('anon', 'public.create_solo_team_invite(uuid,uuid,text,text,text,text,boolean,uuid,jsonb)', 'EXECUTE'),
  'anonymous callers cannot create a team invitation'
);
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.create_solo_team_invite(uuid,uuid,text,text,text,text,boolean,uuid,jsonb)', 'EXECUTE'),
  'browser callers cannot create a team invitation directly'
);
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.resend_solo_team_invite(uuid,uuid,uuid)', 'EXECUTE'),
  'browser callers cannot resend a team invitation directly'
);
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.revoke_solo_team_invite(uuid,uuid,uuid)', 'EXECUTE'),
  'browser callers cannot revoke a team invitation directly'
);
SELECT ok(
  has_function_privilege('service_role', 'public.create_solo_team_invite(uuid,uuid,text,text,text,text,boolean,uuid,jsonb)', 'EXECUTE'),
  'the edge function''s service role can reach create'
);
-- Asserted for all three, symmetrically. Coverage gap caught by adversarial review: with only
-- create asserted, dropping either remaining GRANT left 36/36 green while Resend and Revoke
-- failed for every operator.
SELECT ok(
  has_function_privilege('service_role', 'public.resend_solo_team_invite(uuid,uuid,uuid)', 'EXECUTE'),
  'the edge function''s service role can reach resend'
);
SELECT ok(
  has_function_privilege('service_role', 'public.revoke_solo_team_invite(uuid,uuid,uuid)', 'EXECUTE'),
  'the edge function''s service role can reach revoke'
);
SELECT ok(
  has_function_privilege('service_role', 'public.solo_team_invite_authority(uuid,uuid)', 'EXECUTE'),
  'the resolver is reachable by the role its callers run as'
);
SELECT ok(
  NOT has_function_privilege('anon', 'public.resend_solo_team_invite(uuid,uuid,uuid)', 'EXECUTE'),
  'anonymous callers cannot resend a team invitation'
);
SELECT ok(
  NOT has_function_privilege('anon', 'public.revoke_solo_team_invite(uuid,uuid,uuid)', 'EXECUTE'),
  'anonymous callers cannot revoke a team invitation'
);
SELECT ok(
  NOT has_function_privilege('anon', 'public.solo_team_invite_authority(uuid,uuid)', 'EXECUTE'),
  'anonymous callers cannot reach the authority resolver'
);
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.solo_team_invite_authority(uuid,uuid)', 'EXECUTE'),
  'the authority resolver holds no browser grant of its own'
);
SELECT ok(
  NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.solo_team_invite_authority(uuid,uuid)'::regprocedure),
  'the authority resolver is SECURITY INVOKER — it is granted no privilege of its own beyond its callers'
);

-- The guessing signatures are GONE, not merely superseded. PostgREST resolves an overload by the
-- argument names supplied, so a surviving 5-argument form is the vulnerability one omitted
-- parameter away.
SELECT ok(
  to_regprocedure('public.create_solo_team_invite(uuid,text,text,text,text)') IS NULL,
  'the old create signature no longer exists'
);
SELECT ok(
  to_regprocedure('public.resend_solo_team_invite(uuid,uuid)') IS NULL,
  'the old resend signature no longer exists'
);
SELECT ok(
  to_regprocedure('public.revoke_solo_team_invite(uuid,uuid)') IS NULL,
  'the old revoke signature no longer exists'
);

-- ── Fixtures ────────────────────────────────────────────────────────────────────────────────────
INSERT INTO auth.users (id, aud, role, email) VALUES
  ('a1000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'inv-owner@tests.invalid'),
  ('a1000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'inv-admin@tests.invalid'),
  ('a1000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'inv-member@tests.invalid'),
  ('a1000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'inv-suspended@tests.invalid'),
  ('a1000000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'inv-outsider@tests.invalid'),
  ('b1000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'inv-b-owner@tests.invalid');

INSERT INTO public.tenants
  (id, slug, name, status, account_type, account_number_prefix, account_number, features)
VALUES
  ('a1000000-0000-0000-0000-00000000aaaa', 'invite-authority-a', 'Invite Authority A', 'active', 'standalone', 'IAA', 9310001, '{}'::jsonb),
  ('b1000000-0000-0000-0000-00000000bbbb', 'invite-authority-b', 'Invite Authority B', 'active', 'standalone', 'IAB', 9310002, '{}'::jsonb),
  ('c1000000-0000-0000-0000-00000000cccc', 'invite-authority-c', 'Invite Authority C', 'active', 'standalone', 'IAC', 9310003, '{}'::jsonb);

INSERT INTO public.profiles (user_id, active_tenant_id) VALUES
  ('a1000000-0000-0000-0000-000000000001', NULL),
  ('a1000000-0000-0000-0000-000000000002', NULL),
  ('a1000000-0000-0000-0000-000000000003', NULL),
  ('a1000000-0000-0000-0000-000000000004', NULL),
  ('a1000000-0000-0000-0000-000000000005', NULL),
  ('b1000000-0000-0000-0000-000000000001', NULL)
ON CONFLICT (user_id) DO UPDATE SET active_tenant_id = EXCLUDED.active_tenant_id;

INSERT INTO public.tenant_members (tenant_id, user_id, role, status, is_owner, joined_at) VALUES
  -- The owner of A. Also, later, a member of B — the multi-workspace owner.
  ('a1000000-0000-0000-0000-00000000aaaa', 'a1000000-0000-0000-0000-000000000001', 'owner', 'active', true, now() - interval '10 days'),
  ('a1000000-0000-0000-0000-00000000aaaa', 'a1000000-0000-0000-0000-000000000002', 'admin', 'active', false, now() - interval '9 days'),
  ('a1000000-0000-0000-0000-00000000aaaa', 'a1000000-0000-0000-0000-000000000003', 'member', 'active', false, now() - interval '8 days'),
  ('a1000000-0000-0000-0000-00000000aaaa', 'a1000000-0000-0000-0000-000000000004', 'admin', 'suspended', false, now() - interval '7 days'),
  -- B, owned by someone else. U1 is only an ADMIN here; U2 is a member, and joined B FIRST.
  ('b1000000-0000-0000-0000-00000000bbbb', 'b1000000-0000-0000-0000-000000000001', 'owner', 'active', true, now() - interval '20 days'),
  ('b1000000-0000-0000-0000-00000000bbbb', 'a1000000-0000-0000-0000-000000000001', 'admin', 'active', false, now() - interval '5 days'),
  ('b1000000-0000-0000-0000-00000000bbbb', 'a1000000-0000-0000-0000-000000000002', 'member', 'active', false, now() - interval '30 days');

-- U2 carries a STALE-but-legitimate pointer: it names B, where they are only a member, while their
-- invitation authority lives in A. Under the old code this pointer decided the workspace.
UPDATE public.profiles SET active_tenant_id = 'b1000000-0000-0000-0000-00000000bbbb'
 WHERE user_id = 'a1000000-0000-0000-0000-000000000002';

-- ── The defect, stated as an assertion ───────────────────────────────────────────────────────────
SELECT ok(
  (SELECT active_tenant_id FROM public.profiles WHERE user_id = 'a1000000-0000-0000-0000-000000000001') IS NULL,
  'the owner of A has no active-workspace pointer — the state this repair exists for'
);
SELECT ok(auth.uid() IS NULL, 'no JWT is present, exactly as inside the service-role edge function');

-- THE OUTCOME TEST. A sole owner with a null pointer invites somebody to the workspace they named.
SELECT lives_ok(
  $$SELECT public.create_solo_team_invite(
      'a1000000-0000-0000-0000-000000000001'::uuid,
      'a1000000-0000-0000-0000-00000000aaaa'::uuid,
      'first@tests.invalid', 'member', 'Ops Lead', 'Owns handoffs.')$$,
  'an owner with a null pointer can invite to the workspace they named'
);
SELECT is(
  (SELECT tenant_id FROM public.tenant_invite_tokens WHERE email = 'first@tests.invalid'),
  'a1000000-0000-0000-0000-00000000aaaa'::uuid,
  'the invitation landed in the workspace that was named'
);
SELECT is(
  (SELECT default_role::text FROM public.tenant_invite_tokens WHERE email = 'first@tests.invalid'),
  'member',
  'the invitation carries the permission that was asked for'
);
SELECT is(
  (SELECT public.create_solo_team_invite(
      'a1000000-0000-0000-0000-000000000001'::uuid,
      'a1000000-0000-0000-0000-00000000aaaa'::uuid,
      'echo@tests.invalid', 'admin', NULL, NULL) ->> 'tenant_id'),
  'a1000000-0000-0000-0000-00000000aaaa',
  'the result names the workspace it acted in, so a caller can prove it was not redirected'
);

-- The stale pointer is ignored rather than obeyed.
SELECT is(
  (SELECT public.create_solo_team_invite(
      'a1000000-0000-0000-0000-000000000002'::uuid,
      'a1000000-0000-0000-0000-00000000aaaa'::uuid,
      'stale@tests.invalid', 'member', NULL, NULL) ->> 'tenant_id'),
  'a1000000-0000-0000-0000-00000000aaaa',
  'an admin whose stale pointer names another workspace still invites to the one they named'
);

-- The multi-workspace owner reaches their OTHER workspace by naming it, and only by naming it.
SELECT is(
  (SELECT public.create_solo_team_invite(
      'a1000000-0000-0000-0000-000000000001'::uuid,
      'b1000000-0000-0000-0000-00000000bbbb'::uuid,
      'second@tests.invalid', 'member', NULL, NULL) ->> 'tenant_id'),
  'b1000000-0000-0000-0000-00000000bbbb',
  'a multi-workspace operator invites into whichever workspace they name'
);

-- ── Everything that must fail closed ────────────────────────────────────────────────────────────
SELECT throws_ok(
  $$SELECT public.create_solo_team_invite(
      'a1000000-0000-0000-0000-000000000001'::uuid, NULL,
      'nowhere@tests.invalid', 'member', NULL, NULL)$$,
  '42501', 'the workspace for this invitation was not named',
  'an unnamed workspace is refused, never chosen'
);
SELECT throws_ok(
  $$SELECT public.create_solo_team_invite(
      NULL, 'a1000000-0000-0000-0000-00000000aaaa'::uuid,
      'noactor@tests.invalid', 'member', NULL, NULL)$$,
  '42501', 'not authorized to manage team invitations',
  'an unknown actor is refused'
);
SELECT throws_ok(
  $$SELECT public.create_solo_team_invite(
      'a1000000-0000-0000-0000-000000000001'::uuid,
      'c1000000-0000-0000-0000-00000000cccc'::uuid,
      'wrong@tests.invalid', 'member', NULL, NULL)$$,
  '42501', 'only an owner or admin may manage team invitations in that workspace',
  'naming a workspace the actor does not belong to is refused'
);
SELECT throws_ok(
  $$SELECT public.create_solo_team_invite(
      'a1000000-0000-0000-0000-000000000003'::uuid,
      'a1000000-0000-0000-0000-00000000aaaa'::uuid,
      'bymember@tests.invalid', 'member', NULL, NULL)$$,
  '42501', 'only an owner or admin may manage team invitations in that workspace',
  'a plain member cannot invite, and a null pointer never becomes a promotion'
);
SELECT throws_ok(
  $$SELECT public.create_solo_team_invite(
      'a1000000-0000-0000-0000-000000000004'::uuid,
      'a1000000-0000-0000-0000-00000000aaaa'::uuid,
      'bysuspended@tests.invalid', 'member', NULL, NULL)$$,
  '42501', 'only an owner or admin may manage team invitations in that workspace',
  'a suspended admin cannot invite'
);
SELECT throws_ok(
  $$SELECT public.create_solo_team_invite(
      'a1000000-0000-0000-0000-000000000005'::uuid,
      'a1000000-0000-0000-0000-00000000aaaa'::uuid,
      'byoutsider@tests.invalid', 'member', NULL, NULL)$$,
  '42501', 'only an owner or admin may manage team invitations in that workspace',
  'somebody with no membership anywhere cannot invite'
);
-- U1 is an ADMIN of B, so B is reachable; but an admin of A naming B must still be scoped to B.
SELECT throws_ok(
  $$SELECT public.create_solo_team_invite(
      'a1000000-0000-0000-0000-000000000002'::uuid,
      'b1000000-0000-0000-0000-00000000bbbb'::uuid,
      'aadmin-into-b@tests.invalid', 'member', NULL, NULL)$$,
  '42501', 'only an owner or admin may manage team invitations in that workspace',
  'an admin of A is only a member of B, so naming B is refused rather than honoured'
);

-- Protections that already shipped, still standing.
SELECT throws_ok(
  $$SELECT public.create_solo_team_invite(
      'a1000000-0000-0000-0000-000000000001'::uuid,
      'a1000000-0000-0000-0000-00000000aaaa'::uuid,
      'owner@tests.invalid', 'owner', NULL, NULL)$$,
  -- EXP08 owners (20271119020008): Owner is now a permission the ACCOUNT HOLDER can choose (owner
  -- ruling R1). This business has no account holder of record (owner_user_id is not set), so even its
  -- owner is refused, with the authored no-holder sentence. Proven in full by exp08_owner_invitations.sql.
  'Invite Authority A has no account holder right now, so no one can add owners or change another owner''s access. Contact the Paige team.',
  'an invitation still cannot grant ownership without the account holder'
);
SELECT throws_ok(
  $$SELECT public.create_solo_team_invite(
      'a1000000-0000-0000-0000-000000000001'::uuid,
      'a1000000-0000-0000-0000-00000000aaaa'::uuid,
      'viewer@tests.invalid', 'viewer', NULL, NULL)$$,
  'team invitations may grant only Owner, Admin or Member',
  'an unknown permission is still refused'
);
SELECT throws_ok(
  $$SELECT public.create_solo_team_invite(
      'a1000000-0000-0000-0000-000000000001'::uuid,
      'a1000000-0000-0000-0000-00000000aaaa'::uuid,
      'not-an-email', 'member', NULL, NULL)$$,
  'a valid email address is required',
  'an invalid address is still refused'
);
SELECT throws_ok(
  $$SELECT public.create_solo_team_invite(
      'a1000000-0000-0000-0000-000000000001'::uuid,
      'a1000000-0000-0000-0000-00000000aaaa'::uuid,
      'inv-member@tests.invalid', 'member', NULL, NULL)$$,
  'this person already belongs to the workspace',
  'an existing teammate is still refused'
);

-- ── Resend and revoke carry the same proof ──────────────────────────────────────────────────────
SELECT lives_ok(
  $$SELECT public.resend_solo_team_invite(
      'a1000000-0000-0000-0000-000000000001'::uuid,
      'a1000000-0000-0000-0000-00000000aaaa'::uuid,
      (SELECT id FROM public.tenant_invite_tokens
        WHERE email = 'first@tests.invalid' AND revoked_at IS NULL))$$,
  'an owner with a null pointer can resend in the workspace they named'
);
SELECT is(
  (SELECT count(*) FROM public.tenant_invite_tokens
    WHERE email = 'first@tests.invalid' AND revoked_at IS NULL),
  1::bigint,
  'a resend leaves exactly one live invitation, the old token revoked'
);
SELECT is(
  (SELECT count(*) FROM public.tenant_invite_tokens
    WHERE email = 'first@tests.invalid'
      AND tenant_id <> 'a1000000-0000-0000-0000-00000000aaaa'::uuid),
  0::bigint,
  'the resend re-entry never resolved to a different workspace than the create it delegates to'
);
SELECT throws_ok(
  $$SELECT public.resend_solo_team_invite(
      'a1000000-0000-0000-0000-000000000001'::uuid,
      'b1000000-0000-0000-0000-00000000bbbb'::uuid,
      (SELECT id FROM public.tenant_invite_tokens
        WHERE email = 'first@tests.invalid' AND revoked_at IS NULL))$$,
  'team invitation not found',
  'an invitation in another workspace is invisible to a resend, not merely forbidden'
);
SELECT throws_ok(
  $$SELECT public.revoke_solo_team_invite(
      'a1000000-0000-0000-0000-000000000001'::uuid,
      'b1000000-0000-0000-0000-00000000bbbb'::uuid,
      (SELECT id FROM public.tenant_invite_tokens
        WHERE email = 'first@tests.invalid' AND revoked_at IS NULL))$$,
  'pending team invitation not found',
  'a revoke cannot reach across a workspace boundary by id'
);
SELECT lives_ok(
  $$SELECT public.revoke_solo_team_invite(
      'a1000000-0000-0000-0000-000000000001'::uuid,
      'a1000000-0000-0000-0000-00000000aaaa'::uuid,
      (SELECT id FROM public.tenant_invite_tokens
        WHERE email = 'first@tests.invalid' AND revoked_at IS NULL))$$,
  'an owner with a null pointer can revoke in the workspace they named'
);
SELECT is(
  (SELECT count(*) FROM public.tenant_invite_tokens
    WHERE email = 'first@tests.invalid' AND revoked_at IS NULL),
  0::bigint,
  'the revoked invitation is no longer live'
);

-- The pointer was never written to by any of this. Removal is what clears it (#799), not invitation.
SELECT ok(
  (SELECT active_tenant_id FROM public.profiles WHERE user_id = 'a1000000-0000-0000-0000-000000000001') IS NULL,
  'the invitation path neither reads nor repairs the pointer — it simply no longer depends on it'
);

SELECT * FROM finish();
ROLLBACK;

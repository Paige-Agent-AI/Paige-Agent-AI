-- A Solo owner invites a teammate, and that person accepts and lands in the owner's business.
--
-- End to end through the functions the product calls, never a copied body or a hand-written token:
-- the owner's invitation is created by `create_solo_team_invite` exactly as the `solo-team-invitations`
-- edge function calls it (service role, the owner's verified id as `_actor`), and the invitee accepts
-- through `accept_solo_team_invite` as the real browser role, which is what `JoinWorkspace` calls for
-- the `/join/{token}` link the invitation email carries.
--
-- Whole-shell: two unrelated Solo businesses each invite a different person, one with Member and one
-- with Admin permission. Each invitee must land in the business that invited them, and only there,
-- with the permission, the work title and the responsibilities the owner chose, on an active seat that
-- is not an ownership, with the invitation consumed exactly once.
--
-- Isolated local/CI database only. Synthetic users; no email is sent. All fixtures roll back.
BEGIN;
SELECT plan(18);

INSERT INTO public.tenants
  (id, slug, name, status, account_type, account_number_prefix, account_number, features)
VALUES
  ('e9510000-0000-0000-0000-00000000000a', 'invite-e2e-a', 'Invite end to end A', 'active', 'standalone', 'IEA', 9395101, '{}'),
  ('e9510000-0000-0000-0000-00000000000b', 'invite-e2e-b', 'Invite end to end B', 'active', 'standalone', 'IEB', 9395102, '{}');

INSERT INTO auth.users (id, aud, role, email, email_confirmed_at) VALUES
  ('e9520000-0000-0000-0000-0000000000a0', 'authenticated', 'authenticated', 'owner-a@tests.invalid', now()),
  ('e9520000-0000-0000-0000-0000000000b0', 'authenticated', 'authenticated', 'owner-b@tests.invalid', now()),
  ('e9520000-0000-0000-0000-0000000000a1', 'authenticated', 'authenticated', 'member-a@tests.invalid', now()),
  ('e9520000-0000-0000-0000-0000000000b1', 'authenticated', 'authenticated', 'admin-b@tests.invalid', now());

INSERT INTO public.tenant_members (tenant_id, user_id, role, status, is_owner, joined_at) VALUES
  ('e9510000-0000-0000-0000-00000000000a', 'e9520000-0000-0000-0000-0000000000a0', 'owner', 'active', true, now()),
  ('e9510000-0000-0000-0000-00000000000b', 'e9520000-0000-0000-0000-0000000000b0', 'owner', 'active', true, now());

-- The owner's send, as the edge function makes it: service role, the verified owner as `_actor`.
CREATE FUNCTION pg_temp.owner_invites(_owner uuid, _tenant uuid, _email text, _permission text,
                                      _title text, _responsibilities text)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE _out jsonb;
BEGIN
  SET LOCAL ROLE service_role;
  _out := public.create_solo_team_invite(_owner, _tenant, _email, _permission, _title, _responsibilities);
  RESET ROLE;
  RETURN _out;
END $$;

-- The invitee's acceptance, as `JoinWorkspace` makes it: the browser's authenticated role and JWT.
CREATE FUNCTION pg_temp.invitee_accepts(_actor uuid, _token text)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE _tenant uuid;
BEGIN
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', _actor, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  _tenant := public.accept_solo_team_invite(_token);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '{}', true);
  RETURN _tenant;
END $$;

CREATE TEMP TABLE sent (label text PRIMARY KEY, invite jsonb NOT NULL);
INSERT INTO sent VALUES
  ('member', pg_temp.owner_invites('e9520000-0000-0000-0000-0000000000a0', 'e9510000-0000-0000-0000-00000000000a',
     'member-a@tests.invalid', 'member', 'Client success lead', 'Onboards new clients')),
  ('admin', pg_temp.owner_invites('e9520000-0000-0000-0000-0000000000b0', 'e9510000-0000-0000-0000-00000000000b',
     'admin-b@tests.invalid', 'admin', 'Operations manager', 'Runs the weekly schedule'));

-- 1-2. Each invitation was created in the business its owner named, for the permission chosen.
SELECT is((SELECT (invite->>'tenant_id')::uuid FROM sent WHERE label = 'member'),
  'e9510000-0000-0000-0000-00000000000a'::uuid, 'the Member invitation is created in the business that sent it');
SELECT is((SELECT (invite->>'tenant_id')::uuid FROM sent WHERE label = 'admin'),
  'e9510000-0000-0000-0000-00000000000b'::uuid, 'the Admin invitation is created in the business that sent it');

-- 3-4. Each invitee accepts, and acceptance answers with the business that invited them.
SELECT is(pg_temp.invitee_accepts('e9520000-0000-0000-0000-0000000000a1', (SELECT invite->>'token' FROM sent WHERE label = 'member')),
  'e9510000-0000-0000-0000-00000000000a'::uuid, 'the Member invitee accepts into the business that invited them');
SELECT is(pg_temp.invitee_accepts('e9520000-0000-0000-0000-0000000000b1', (SELECT invite->>'token' FROM sent WHERE label = 'admin')),
  'e9510000-0000-0000-0000-00000000000b'::uuid, 'the Admin invitee accepts into the business that invited them');

-- 5-8. Each lands on exactly one seat there, with the permission, title and responsibilities chosen.
SELECT is((SELECT count(*) FROM public.tenant_members
            WHERE tenant_id = 'e9510000-0000-0000-0000-00000000000a' AND user_id = 'e9520000-0000-0000-0000-0000000000a1'),
  1::bigint, 'the Member invitee holds one seat in the business that invited them');
SELECT ok((SELECT role = 'member' AND status = 'active' AND NOT is_owner
                  AND job_title = 'Client success lead' AND responsibilities = 'Onboards new clients'
             FROM public.tenant_members
            WHERE tenant_id = 'e9510000-0000-0000-0000-00000000000a' AND user_id = 'e9520000-0000-0000-0000-0000000000a1'),
  'the Member seat is active, is Member, is not an ownership, and carries the chosen title and responsibilities');
SELECT is((SELECT count(*) FROM public.tenant_members
            WHERE tenant_id = 'e9510000-0000-0000-0000-00000000000b' AND user_id = 'e9520000-0000-0000-0000-0000000000b1'),
  1::bigint, 'the Admin invitee holds one seat in the business that invited them');
SELECT ok((SELECT role = 'admin' AND status = 'active' AND NOT is_owner
                  AND job_title = 'Operations manager' AND responsibilities = 'Runs the weekly schedule'
             FROM public.tenant_members
            WHERE tenant_id = 'e9510000-0000-0000-0000-00000000000b' AND user_id = 'e9520000-0000-0000-0000-0000000000b1'),
  'the Admin seat is active, is Admin, is not an ownership, and carries the chosen title and responsibilities');

-- 9-10. Neither lands in the other business.
SELECT is((SELECT count(*) FROM public.tenant_members
            WHERE tenant_id = 'e9510000-0000-0000-0000-00000000000b' AND user_id = 'e9520000-0000-0000-0000-0000000000a1'),
  0::bigint, 'the Member invitee holds no seat in a business that did not invite them');
SELECT is((SELECT count(*) FROM public.tenant_members
            WHERE tenant_id = 'e9510000-0000-0000-0000-00000000000a' AND user_id = 'e9520000-0000-0000-0000-0000000000b1'),
  0::bigint, 'the Admin invitee holds no seat in a business that did not invite them');

-- 11-12. Each opens in the business that invited them.
SELECT is((SELECT active_tenant_id FROM public.profiles WHERE user_id = 'e9520000-0000-0000-0000-0000000000a1'),
  'e9510000-0000-0000-0000-00000000000a'::uuid, 'the Member invitee opens in the business that invited them');
SELECT is((SELECT active_tenant_id FROM public.profiles WHERE user_id = 'e9520000-0000-0000-0000-0000000000b1'),
  'e9510000-0000-0000-0000-00000000000b'::uuid, 'the Admin invitee opens in the business that invited them');

-- 13-14. Each invitation is consumed exactly once, and says when.
SELECT ok((SELECT uses = 1 AND last_used_at IS NOT NULL FROM public.tenant_invite_tokens
            WHERE id = (SELECT (invite->>'id')::uuid FROM sent WHERE label = 'member')),
  'the Member invitation is consumed once, with its acceptance time');
SELECT ok((SELECT uses = 1 AND last_used_at IS NOT NULL FROM public.tenant_invite_tokens
            WHERE id = (SELECT (invite->>'id')::uuid FROM sent WHERE label = 'admin')),
  'the Admin invitation is consumed once, with its acceptance time');

-- 15-16. Each business's record says who invited whom and that it was accepted.
SELECT is((SELECT count(*) FROM public.audit_logs
            WHERE action = 'team_invite_created'
              AND entity_id IN (SELECT (invite->>'id')::uuid FROM sent)),
  2::bigint, 'both invitations are recorded as created');
SELECT is((SELECT count(*) FROM public.audit_logs
            WHERE action = 'team_invite_accepted'
              AND entity_id IN (SELECT (invite->>'id')::uuid FROM sent)),
  2::bigint, 'both acceptances are recorded');

-- 17-18. An invitation cannot be used twice, and nobody else can use it.
SELECT throws_ok(
  format('SELECT pg_temp.invitee_accepts(%L, %L)', 'e9520000-0000-0000-0000-0000000000a1',
         (SELECT invite->>'token' FROM sent WHERE label = 'member')),
  NULL, NULL, 'an accepted invitation cannot be accepted again');
INSERT INTO sent VALUES
  ('unclaimed', pg_temp.owner_invites('e9520000-0000-0000-0000-0000000000b0', 'e9510000-0000-0000-0000-00000000000b',
     'someone-else@tests.invalid', 'member', NULL, NULL));
SELECT throws_ok(
  format('SELECT pg_temp.invitee_accepts(%L, %L)', 'e9520000-0000-0000-0000-0000000000a1',
         (SELECT invite->>'token' FROM sent WHERE label = 'unclaimed')),
  '42501', NULL, 'an invitation addressed to one person cannot be accepted by another');

SELECT * FROM finish();
ROLLBACK;

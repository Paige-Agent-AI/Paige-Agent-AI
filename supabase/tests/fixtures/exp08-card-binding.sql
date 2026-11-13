-- Included by the original complete A2b fixture, after native24. Synthetic identities only.
RESET ROLE;
-- The older A2b fixture predates the RELEASED current-identity guard. Replay its
-- original independently tested helper patch; do not weaken production30's source pin.
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS banned_until timestamptz;
\ir ../../../scripts/proof/exp08-team-hub-identity-currentness-patch.sql
\ir ../../migrations/20271133000030_exp08_card_binding_projection.sql
-- Same forward carrier replay is idempotent and preserves native function identity.
SELECT 'public.team_hub_card_binding(uuid,text[])'::regprocedure::oid AS binding_oid \gset
\ir ../../migrations/20271133000030_exp08_card_binding_projection.sql
SELECT pg_temp.check('public.team_hub_card_binding(uuid,text[])'::regprocedure::oid=:'binding_oid'::oid,
 'binding: forward replay preserves original projection identity');
SELECT pg_temp.check((SELECT p.prosecdef AND p.provolatile='s' AND p.proconfig=ARRAY['search_path=""']
 AND pg_get_userbyid(p.proowner)='postgres' AND p.proacl::text='{postgres=X/postgres,authenticated=X/postgres}'
 AND md5(replace(p.prosrc,chr(13),''))='a94bc7933fc6fe20a015dd9f4dbc7c6e'
 FROM pg_proc p WHERE p.oid='public.team_hub_card_binding(uuid,text[])'::regprocedure),
 'binding: exact native body and minimal execution ACL');
CREATE FUNCTION pg_temp.binding(actor text,tokens text[],expected_actor text DEFAULT NULL,as_role text DEFAULT 'authenticated')
RETURNS jsonb LANGUAGE sql AS $$
 SELECT pg_temp.j(actor,format('public.team_hub_card_binding(%L::uuid,%L::text[])',
  coalesce(expected_actor,actor),tokens),as_role) $$;
SELECT fingerprint AS binding_card_fp FROM public.paige_pending_confirmations WHERE id=:'c_good'::uuid \gset
SELECT fingerprint AS binding_chat_fp FROM public.paige_pending_confirmations WHERE id=:'c_tool'::uuid \gset
SELECT fingerprint AS binding_foreign_fp FROM public.paige_pending_confirmations WHERE id=:'c_tenant'::uuid \gset
SELECT md5((SELECT jsonb_agg(to_jsonb(p) ORDER BY id)::text FROM public.paige_pending_confirmations p)) AS binding_proposals_before,
 md5((SELECT jsonb_agg(to_jsonb(c) ORDER BY message_id)::text FROM public.team_hub_message_cards c)) AS binding_cards_before \gset
SELECT pg_temp.check(pg_temp.binding(:'u2',ARRAY[:'binding_card_fp',:'binding_chat_fp','0123456789abcdef'])
 =jsonb_build_object('ok',true,'bound',jsonb_build_array(:'binding_card_fp')),
 'binding: own unbound and unknown tokens pass while the own consumed card remains excluded');
SELECT pg_temp.check(pg_temp.binding(:'u3',ARRAY[:'binding_card_fp'])='{"ok":true,"bound":[]}'::jsonb
 AND pg_temp.binding(:'u7',ARRAY[:'binding_card_fp'])='{"ok":true,"bound":[]}'::jsonb,
 'binding: other actor and other tenant learn no private card binding');
SELECT pg_temp.check(pg_temp.binding(:'u2',ARRAY[:'binding_card_fp'],:'u3')->>'ok'='false'
 AND pg_temp.binding(:'u2',ARRAY[:'binding_foreign_fp'])->>'ok'='false',
 'binding: forged actor and own foreign-workspace proposal refuse the batch');
SELECT pg_temp.check(pg_temp.binding(:'u2','{}')='{"ok":true,"bound":[]}'::jsonb
 AND pg_temp.binding(:'u2',ARRAY[:'binding_card_fp',:'binding_card_fp'])
 =jsonb_build_object('ok',true,'bound',jsonb_build_array(:'binding_card_fp')),
 'binding: empty and duplicate token payloads have complete deterministic answers');
SELECT pg_temp.check(pg_temp.binding(:'u2',NULL)->>'ok'='false'
 AND pg_temp.binding(:'u2',ARRAY[NULL::text])->>'ok'='false'
 AND pg_temp.binding(:'u2',ARRAY['not-a-fingerprint'])->>'ok'='false'
 AND pg_temp.binding(:'u2',ARRAY['AAAAAAAAAAAAAAAA'])->>'ok'='false'
 AND pg_temp.binding(:'u2',ARRAY[ARRAY[:'binding_card_fp']])->>'ok'='false'
 AND pg_temp.binding(:'u2',array_fill(:'binding_card_fp'::text,ARRAY[101]))->>'ok'='false',
 'binding: null, malformed, upper-case, multidimensional and oversized inputs refuse');
SELECT pg_temp.check(pg_temp.binding(NULL,ARRAY[:'binding_card_fp'],:'u2')->>'ok'='false'
 AND pg_temp.binding(:'u2',ARRAY[:'binding_card_fp'],NULL,'anon') ? 'error'
 AND pg_temp.binding(:'u2',ARRAY[:'binding_card_fp'],NULL,'service_role') ? 'error',
 'binding: anonymous identity and non-caller execution roles cannot use projection');
SELECT pg_temp.check(pg_temp.j(:'u2','(SELECT jsonb_agg(to_jsonb(c)) FROM public.team_hub_message_cards c)') ? 'error'
 AND pg_temp.j(:'u2','(SELECT jsonb_agg(to_jsonb(c)) FROM public.team_hub_agent_turns c)') ? 'error',
 'binding: authenticated caller still cannot SELECT protected tables directly');
BEGIN;
UPDATE public.tenant_members SET team_hub_access=false WHERE user_id=:'u2'::uuid AND tenant_id=:'ta'::uuid;
SELECT pg_temp.check(pg_temp.binding(:'u2',ARRAY[:'binding_card_fp'])#>>'{bound,0}'=:'binding_card_fp',
 'binding: loss of Hub access does not make an old private card redeemable in Chat');
ROLLBACK;
BEGIN;
UPDATE public.tenant_members SET status='suspended' WHERE user_id=:'u2'::uuid;
SELECT pg_temp.check(pg_temp.binding(:'u2',ARRAY[:'binding_chat_fp'])->>'ok'='false',
 'binding: suspended membership refuses even an unbound approval');
ROLLBACK;
BEGIN;
UPDATE auth.users SET banned_until=now()+interval '1 hour' WHERE id=:'u2'::uuid;
SELECT pg_temp.check(pg_temp.binding(:'u2',ARRAY[:'binding_chat_fp'])->>'ok'='false',
 'binding: banned identity refuses');
ROLLBACK;
BEGIN;
-- Use the independent ordinary actor without a completed-card cascade; this fixture's
-- historical seat-ended writer is not the later production lifecycle implementation.
DELETE FROM public.tenant_members WHERE user_id=:'u7'::uuid;
SELECT pg_temp.check(pg_temp.binding(:'u7',ARRAY['0123456789abcdef'])->>'ok'='false',
 'binding: revoked membership refuses');
ROLLBACK;
SELECT pg_temp.check(
 md5((SELECT jsonb_agg(to_jsonb(p) ORDER BY id)::text FROM public.paige_pending_confirmations p))=:'binding_proposals_before'
 AND md5((SELECT jsonb_agg(to_jsonb(c) ORDER BY message_id)::text FROM public.team_hub_message_cards c))=:'binding_cards_before',
 'binding: lookups change no proposal, decision, card or effect');
\o
SELECT 'EXP08_CARD_BINDING_CONTRACT:'||jsonb_build_object('body_md5',md5(replace(p.prosrc,chr(13),'')),
 'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text,'stable',p.provolatile='s')::text
 FROM pg_proc p WHERE p.oid='public.team_hub_card_binding(uuid,text[])'::regprocedure;
\echo 'PASS: original native card-binding scope, input, private-table, revoked actor and no-write regressions'
\o /dev/null

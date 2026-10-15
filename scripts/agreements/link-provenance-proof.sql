-- INT-163 / #1395 — proof that the MANUAL LINK door refuses the same blank document the SEND door
-- refuses, and that it refuses nothing else.
--
-- WHY THIS FILE EXISTS AS A PROOF RATHER THAN A CLAIM. The defect it guards against was invisible
-- precisely because the code path LOOKED correct: `issue_agreement_signing_link` already refused to
-- freeze an uploaded document, so reading it gave the impression uploads were handled. It was the
-- ALREADY-frozen row it had nothing to say about, and no assertion anywhere exercised one. So this
-- drives both an affected row and an unaffected one, and asserts on the MESSAGE and not only the
-- SQLSTATE — the pre-existing refusal on this path raises 23514 as well, so a state code alone
-- cannot tell "refused for the right reason" from "refused for the old one".
\pset tuples_only on
\pset format unaligned
SELECT set_config('test.tenant','aaaaaaaa-0000-4000-8000-000000000001',false);
SELECT set_config('test.uid','11111111-0000-4000-8000-000000000001',false);
SELECT set_config('test.admin','true',false);
SELECT set_config('test.member','true',false);

-- NO FIXTURE INSERTS A SIGNER. `trg_agreement_seed_counterparty` (20270405000000:103) seeds the
-- counterparty from the contact's email on insert, so every agreement below already has exactly one
-- signer at position 1 — which is the shape a real agreement has. Adding another by hand produced a
-- second row at the same position, and `signing_order` is unique only by the body of
-- `add_agreement_signer` (20270405000000:186-190) and not by any index, so nothing would have refused it.

-- Like pg_temp.probe in contract-proof.sql, but it also inspects the message. Both emit the same
-- failure vocabulary the runner greps for, so a regression here fails the run without the runner
-- needing to know what this file asserts.
CREATE OR REPLACE FUNCTION pg_temp.probe_msg(label text, stmt text, expect_state text, expect_fragment text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE _state text; _msg text;
BEGIN
  BEGIN
    EXECUTE stmt;
    RETURN format('%-46s  NO ERROR - GUARANTEE IS FALSE', label);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS _state = RETURNED_SQLSTATE, _msg = MESSAGE_TEXT;
    RETURN format('%-46s  %s  %s', label, _state,
      CASE WHEN _state = expect_state AND position(expect_fragment IN _msg) > 0
           THEN 'PASS'
           ELSE 'UNEXPECTED (wanted '||expect_state||' + "'||expect_fragment||'", got '||_state||' / '||left(_msg,70)||')'
      END);
  END;
END $$;

-- An uploaded-document agreement, with a signer, frozen the way the PRE-FIX send path froze one:
-- a real digest, a real storage key, and a `presented-` marker meaning "this came from rendering
-- the text body" — which for an upload is a blank page.
CREATE TEMP TABLE l_old AS SELECT (public.create_agreement_signing(
  'aaaaaaaa-0000-4000-8000-000000000001','c1111111-0000-4000-8000-000000000001',NULL,
  'Signed Statement of Work','tenant_upload',NULL,
  'aaaaaaaa-0000-4000-8000-000000000001/uploads/sow.pdf') ->> 'signing_id')::uuid AS id;
UPDATE public.paige_agreements SET
  content_sha256 = repeat('b',64),
  content_storage_key = 'aaaaaaaa-0000-4000-8000-000000000001/'||id||'/presented-9f1c2d3e-0000-4000-8000-000000000001.pdf',
  status = 'sent', sent_at = now()
WHERE id = (SELECT id FROM l_old);

\echo '--- L1 a pre-fix blank upload is REFUSED a link, with the reason that fits it ---'
SELECT pg_temp.probe_msg('L1 pre-fix blank refused',
  format('SELECT public.issue_agreement_signing_link(''aaaaaaaa-0000-4000-8000-000000000001'',%L,30)',(SELECT id FROM l_old)),
  'PA001','not the file that was uploaded');

\echo '--- L1b the refusal wrote NOTHING: no token was minted on the way to raising ---'
SELECT 'L1b token_hash_still_null = '||(s.token_hash IS NULL)::text
FROM public.paige_agreement_signers s, l_old WHERE s.agreement_id = l_old.id;

-- THE POSITIVE CONTROL, and the reason L1 means anything. Identical row in every respect EXCEPT the
-- marker the fixed send path writes. A function that simply refused all uploads would pass L1 and
-- fail here.
CREATE TEMP TABLE l_new AS SELECT (public.create_agreement_signing(
  'aaaaaaaa-0000-4000-8000-000000000001','c1111111-0000-4000-8000-000000000001',NULL,
  'Countersigned Retainer','tenant_upload',NULL,
  'aaaaaaaa-0000-4000-8000-000000000001/uploads/retainer.pdf') ->> 'signing_id')::uuid AS id;
UPDATE public.paige_agreements SET
  content_sha256 = repeat('c',64),
  content_storage_key = 'aaaaaaaa-0000-4000-8000-000000000001/'||id||'/presented-source-9f1c2d3e-0000-4000-8000-000000000002.pdf',
  status = 'sent', sent_at = now()
WHERE id = (SELECT id FROM l_new);

\echo '--- L2 an upload frozen by the FIXED path still gets its link (positive control) ---'
SELECT 'L2 token_is_64_hex = '||((public.issue_agreement_signing_link(
  'aaaaaaaa-0000-4000-8000-000000000001',(SELECT id FROM l_new),30) ->> 'token') ~ '^[0-9a-f]{64}$')::text;

-- A frozen digest with nowhere to find the bytes. No shipped path produces this; if one ever does,
-- the document is unlocatable and therefore unprovable, which is the same failure by another route.
CREATE TEMP TABLE l_nokey AS SELECT (public.create_agreement_signing(
  'aaaaaaaa-0000-4000-8000-000000000001','c1111111-0000-4000-8000-000000000001',NULL,
  'Orphaned Upload','tenant_upload',NULL,
  'aaaaaaaa-0000-4000-8000-000000000001/uploads/orphan.pdf') ->> 'signing_id')::uuid AS id;
UPDATE public.paige_agreements SET content_sha256 = repeat('d',64), status='sent', sent_at=now()
WHERE id = (SELECT id FROM l_nokey);

\echo '--- L3 frozen with NO storage key is refused too (a hash pointing at nothing proves nothing) ---'
SELECT pg_temp.probe_msg('L3 frozen-without-key refused',
  format('SELECT public.issue_agreement_signing_link(''aaaaaaaa-0000-4000-8000-000000000001'',%L,30)',(SELECT id FROM l_nokey)),
  'PA001','not the file that was uploaded');

-- THE SECOND POSITIVE CONTROL. The overwhelmingly common agreement is a TEXT body, and it must be
-- untouched by any of this. Without this line, a check that caught every agreement would still pass
-- L1 and L3.
CREATE TEMP TABLE l_text AS SELECT (public.create_agreement_signing(
  'aaaaaaaa-0000-4000-8000-000000000001','c1111111-0000-4000-8000-000000000001',NULL,
  'Ordinary Letter','paige_draft','The body of an ordinary agreement.') ->> 'signing_id')::uuid AS id;

\echo '--- L4 a text agreement is unaffected and still gets its link (positive control) ---'
SELECT 'L4 token_is_64_hex = '||((public.issue_agreement_signing_link(
  'aaaaaaaa-0000-4000-8000-000000000001',(SELECT id FROM l_text),30) ->> 'token') ~ '^[0-9a-f]{64}$')::text;

-- An upload that was never sent has no frozen document at all. It must keep the ORIGINAL refusal —
-- "use the send path" — because that one is true and actionable: sending IS what freezes it. If the
-- new check shadowed it, an owner with a perfectly good new upload would be told to throw it away
-- and start again. Both raise 23514, so only the message distinguishes them.
CREATE TEMP TABLE l_unsent AS SELECT (public.create_agreement_signing(
  'aaaaaaaa-0000-4000-8000-000000000001','c1111111-0000-4000-8000-000000000001',NULL,
  'Fresh Upload','tenant_upload',NULL,
  'aaaaaaaa-0000-4000-8000-000000000001/uploads/fresh.pdf') ->> 'signing_id')::uuid AS id;

\echo '--- L5 an unsent upload keeps the OLD refusal; the new one does not shadow it ---'
SELECT pg_temp.probe_msg('L5 unsent upload -> send path',
  format('SELECT public.issue_agreement_signing_link(''aaaaaaaa-0000-4000-8000-000000000001'',%L,30)',(SELECT id FROM l_unsent)),
  '23514','use the send path');

-- A pre-fix blank that also has no signer. Two refusals apply; the useful one is the dead end, not
-- the step on the way to it. This asserts the deliberate ordering, which is otherwise the kind of
-- decision a later edit undoes without noticing it was a decision.
CREATE TEMP TABLE l_nosigner AS SELECT (public.create_agreement_signing(
  'aaaaaaaa-0000-4000-8000-000000000001','c1111111-0000-4000-8000-000000000001',NULL,
  'Blank And Unaddressed','tenant_upload',NULL,
  'aaaaaaaa-0000-4000-8000-000000000001/uploads/nobody.pdf') ->> 'signing_id')::uuid AS id;
DELETE FROM public.paige_agreement_signers WHERE agreement_id = (SELECT id FROM l_nosigner);
UPDATE public.paige_agreements SET
  content_sha256 = repeat('e',64),
  content_storage_key = 'aaaaaaaa-0000-4000-8000-000000000001/'||id||'/presented-9f1c2d3e-0000-4000-8000-000000000003.pdf',
  status = 'sent', sent_at = now()
WHERE id = (SELECT id FROM l_nosigner);

\echo '--- L6 the document problem is reported ahead of the missing signer ---'
SELECT pg_temp.probe_msg('L6 document refusal precedes signer',
  format('SELECT public.issue_agreement_signing_link(''aaaaaaaa-0000-4000-8000-000000000001'',%L,30)',(SELECT id FROM l_nosigner)),
  'PA001','not the file that was uploaded');

-- The marker is a PATH SEGMENT, not a substring of a filename. A key whose basename merely contains
-- the letters is not something the fixed path produced, and a later "simplification" to a bare
-- substring test would silently start accepting one.
CREATE TEMP TABLE l_lookalike AS SELECT (public.create_agreement_signing(
  'aaaaaaaa-0000-4000-8000-000000000001','c1111111-0000-4000-8000-000000000001',NULL,
  'Lookalike Key','tenant_upload',NULL,
  'aaaaaaaa-0000-4000-8000-000000000001/uploads/lookalike.pdf') ->> 'signing_id')::uuid AS id;
UPDATE public.paige_agreements SET
  content_sha256 = repeat('f',64),
  content_storage_key = 'aaaaaaaa-0000-4000-8000-000000000001/'||id||'/notpresented-source-1.pdf',
  status = 'sent', sent_at = now()
WHERE id = (SELECT id FROM l_lookalike);

\echo '--- L7 a key that only LOOKS like the fixed markers is still refused ---'
SELECT pg_temp.probe_msg('L7 lookalike key refused',
  format('SELECT public.issue_agreement_signing_link(''aaaaaaaa-0000-4000-8000-000000000001'',%L,30)',(SELECT id FROM l_lookalike)),
  'PA001','not the file that was uploaded');

-- Drives real refusals and asserts the SQLSTATE each CLASS requires. The message is printed so a
-- reader can see the sentence an operator would now receive — the whole point of the change.
\pset tuples_only on
\pset format unaligned
CREATE OR REPLACE FUNCTION pg_temp.probe(label text, stmt text, expect text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE s text; m text;
BEGIN
  BEGIN
    EXECUTE stmt;
    RETURN format('%-46s NO ERROR - the refusal did not fire', label);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS s = RETURNED_SQLSTATE, m = MESSAGE_TEXT;
    RETURN format('%-46s %s  %s  %s', label, s,
      CASE WHEN s = expect THEN 'PASS' ELSE 'UNEXPECTED (wanted '||expect||')' END, left(m, 70));
  END;
END $$;

\echo '--- PA002: a validation refusal, whose sentence the operator is meant to read ---'
SELECT pg_temp.probe('D1 arrangement kind not recognised',
 $$SELECT public.save_client_agreement('aaaaaaaa-0000-4000-8000-000000000001',NULL,'c1111111-0000-4000-8000-000000000001','00000000-0000-4000-8000-0000000000f1','fortnightly','negotiated')$$,'PA002');
SELECT pg_temp.probe('D2 instalments with no count',
 $$SELECT public.save_client_agreement('aaaaaaaa-0000-4000-8000-000000000001',NULL,'c1111111-0000-4000-8000-000000000001','00000000-0000-4000-8000-0000000000f1','installment','negotiated',NULL,100000,'usd')$$,'PA002');
SELECT pg_temp.probe('D3 recurring with no cadence',
 $$SELECT public.save_client_agreement('aaaaaaaa-0000-4000-8000-000000000001',NULL,'c1111111-0000-4000-8000-000000000001','00000000-0000-4000-8000-0000000000f1','recurring','negotiated',NULL,100000,'usd')$$,'PA002');
SELECT pg_temp.probe('D4 negotiated with no amount',
 $$SELECT public.save_client_agreement('aaaaaaaa-0000-4000-8000-000000000001',NULL,'c1111111-0000-4000-8000-000000000001','00000000-0000-4000-8000-0000000000f1','one_time','negotiated')$$,'PA002');
SELECT pg_temp.probe('D5 unknown client',
 $$SELECT public.save_client_agreement('aaaaaaaa-0000-4000-8000-000000000001',NULL,'00000000-0000-4000-8000-00000000dead','00000000-0000-4000-8000-0000000000f1','one_time','negotiated',NULL,100000,'usd')$$,'PA002');
SELECT pg_temp.probe('D6 unknown offer',
 $$SELECT public.save_client_agreement('aaaaaaaa-0000-4000-8000-000000000001',NULL,'c1111111-0000-4000-8000-000000000001','00000000-0000-4000-8000-0000000000ba','one_time','negotiated',NULL,100000,'usd')$$,'PA002');

\echo '--- 42501: authorization and scope keep their own code, and their own surface copy ---'
SELECT pg_temp.probe('D7 workspace changed under the form',
 $$SELECT public.save_client_agreement('bbbbbbbb-0000-4000-8000-000000000009',NULL,'c1111111-0000-4000-8000-000000000001','00000000-0000-4000-8000-0000000000f1','one_time','negotiated',NULL,100000,'usd')$$,'42501');
SELECT pg_temp.probe('D8 editing an agreement not in this workspace',
 $$SELECT public.save_client_agreement('aaaaaaaa-0000-4000-8000-000000000001','00000000-0000-4000-8000-00000000f00d','c1111111-0000-4000-8000-000000000001','00000000-0000-4000-8000-0000000000f1','one_time','negotiated',NULL,100000,'usd')$$,'42501');

\echo '--- the clamp: a rejected value is echoed back bounded, never unbounded ---'
-- The four refusals that quote the caller's rejected value quote it BECAUSE it failed an allow-list,
-- so it is arbitrary text. `left(…, 40)` at the raise site is half the bound; the hook holds the
-- other half. This asserts the SQL half: 300 characters in, at most 40 back.
CREATE OR REPLACE FUNCTION pg_temp.echoed_length(stmt text) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE m text;
BEGIN
  EXECUTE stmt;
  RETURN -1;                                   -- no refusal fired at all
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS m = MESSAGE_TEXT;
  RETURN length(substring(m from ': (.*)$'));  -- just the echoed value, not the sentence
END $$;

SELECT 'D9 echoed value clamped to 40 = '||(pg_temp.echoed_length(
  format($$SELECT public.save_client_agreement('aaaaaaaa-0000-4000-8000-000000000001',NULL,'c1111111-0000-4000-8000-000000000001','00000000-0000-4000-8000-0000000000f1',%L,'negotiated')$$, repeat('z',300))
) = 40)::text;

-- EXP04 O5 paired current-financial context. Original applied 10004/60009/220004 remain immutable.
-- Same private observation and caller-JWT context, same actor/customer/thread/intent/currentness/ACL.
-- Explicit financial3 read, with payment2/financial3 markers for the original strict decoder.
-- No new writer, permission, provider, ledger, approval, scheduler or Chat admission.
BEGIN;
DO $before_source$
DECLARE p pg_catalog.pg_proc%ROWTYPE;
BEGIN
 SELECT * INTO STRICT p FROM pg_catalog.pg_proc WHERE oid='public._client_portal_invoice_observation_for_client(uuid,uuid)'::regprocedure;
 IF pg_catalog.md5(p.prosrc) NOT IN ('83f32502da913d873d3454e4fc12671d','ac2601955788964e062e6ec89db8b350') OR pg_catalog.pg_get_userbyid(p.proowner)<>'postgres' OR p.prosecdef IS DISTINCT FROM false OR p.provolatile<>'v' OR p.proparallel<>'u' OR p.proisstrict OR p.proleakproof OR p.proretset OR p.pronargs<>2 OR p.prokind<>'f' OR p.provariadic<>0 OR p.proargmodes IS NOT NULL OR p.proallargtypes IS NOT NULL OR p.prolang<>(SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql') OR p.prorettype<>'jsonb'::regtype OR p.pronargdefaults<>0 OR p.proargdefaults IS NOT NULL OR p.proargnames IS DISTINCT FROM ARRAY['_tenant','_client']::text[] OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[] OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres}' THEN
  RAISE EXCEPTION 'Original CURA financial source/authority drift: _client_portal_invoice_observation_for_client(uuid,uuid)' USING ERRCODE='23514';
 END IF;
 SELECT * INTO STRICT p FROM pg_catalog.pg_proc WHERE oid='public.client_portal_assistant_invoices_context(uuid,uuid)'::regprocedure;
 IF pg_catalog.md5(p.prosrc) NOT IN ('941f8a729275f5bfaf8f152284917a01','aa0155e08f043cc81ede721d46e708cb') OR pg_catalog.pg_get_userbyid(p.proowner)<>'postgres' OR p.prosecdef IS DISTINCT FROM true OR p.provolatile<>'v' OR p.proparallel<>'u' OR p.proisstrict OR p.proleakproof OR p.proretset OR p.pronargs<>2 OR p.prokind<>'f' OR p.provariadic<>0 OR p.proargmodes IS NOT NULL OR p.proallargtypes IS NOT NULL OR p.prolang<>(SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql') OR p.prorettype<>'jsonb'::regtype OR p.pronargdefaults<>0 OR p.proargdefaults IS NOT NULL OR p.proargnames IS DISTINCT FROM ARRAY['p_thread','p_intent']::text[] OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[] OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres,authenticated=X/postgres}' THEN
  RAISE EXCEPTION 'Original CURA financial source/authority drift: client_portal_assistant_invoices_context(uuid,uuid)' USING ERRCODE='23514';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc WHERE oid='public._client_portal_invoice_facts_for_client(uuid,uuid,integer,jsonb,date,integer)'::regprocedure AND pg_catalog.md5(prosrc)='1a622edb93cf9041638be41b615020c4' AND NOT prosecdef AND pg_catalog.pg_get_userbyid(proowner)='postgres' AND proconfig=ARRAY['search_path=""']::text[] AND proacl::text='{postgres=X/postgres}') THEN
  RAISE EXCEPTION 'Original current financial facts require reconciliation' USING ERRCODE='23514'; END IF;
END $before_source$;

CREATE OR REPLACE FUNCTION public._client_portal_invoice_observation_for_client(_tenant uuid, _client uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE read_at timestamptz:=statement_timestamp(); calendar jsonb; facts jsonb; query jsonb; identity text;
BEGIN
 IF _tenant IS NULL OR _client IS NULL OR NOT EXISTS(
  SELECT 1 FROM public.clients c WHERE c.id=_client AND c.tenant_id=_tenant) THEN
  RAISE EXCEPTION 'CLIENT_INVOICE_UNAVAILABLE' USING ERRCODE='42501';
 END IF;
 calendar:=public._business_time_zone_for_tenant(_tenant,read_at);
 query:=jsonb_build_object('limit',5,'after',null,'as_of_date',calendar->'local_date');
 facts:=public._client_portal_invoice_facts_for_client(_tenant,_client,5,null,(calendar->>'local_date')::date,3);
 identity:=encode(extensions.digest(jsonb_build_object(
  'schema_version',1,'tenant_id',_tenant,'client_id',_client,'query',query,
  'calendar',calendar-'read_at','facts',facts-'read_at')::text,'sha256'),'hex');
 RETURN jsonb_build_object('schema_version',1,'tenant_id',_tenant,'client_id',_client,
  'query',query,'calendar',calendar,'facts',facts,'observation_identity',identity,'read_at',read_at);
END;
$function$;

CREATE OR REPLACE FUNCTION public.client_portal_assistant_invoices_context(p_thread uuid, p_intent uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE actor uuid:=auth.uid(); frame jsonb; t public.paige_chat_threads; snapshot jsonb; accepted boolean;
 observation jsonb; facts jsonb; billing jsonb;
BEGIN
 IF actor IS NULL OR p_thread IS NULL OR p_intent IS NULL THEN
  RAISE EXCEPTION 'CUSTOMER_INVOICES_FORBIDDEN' USING ERRCODE='42501'; END IF;
 frame:=public.client_portal_frame();
 SELECT * INTO t FROM public.paige_chat_threads WHERE id=p_thread;
 IF NOT FOUND OR NOT public.paige_chat_customer_thread_authorized(p_thread)
  OR t.caller_user_id IS DISTINCT FROM actor OR t.audience IS DISTINCT FROM 'customer_private'
  OR frame->>'actor_id' IS DISTINCT FROM actor::text OR frame#>>'{profile,id}' IS DISTINCT FROM t.contact_id::text
  OR frame#>>'{profile,tenant_id}' IS DISTINCT FROM t.tenant_id::text THEN
  RAISE EXCEPTION 'CUSTOMER_INVOICES_FORBIDDEN' USING ERRCODE='42501'; END IF;
 SELECT bundle_ref->'customer_invoices' INTO snapshot FROM public.paige_chat_turns
  WHERE thread_id=p_thread AND role='user' AND interactive_intent_id=p_intent
   AND interactive_actor_id=actor AND interactive_tenant_id=t.tenant_id;
 accepted:=FOUND;
 IF accepted AND snapshot IS NULL THEN
  RETURN jsonb_build_object('thread_id',p_thread,'intent_id',p_intent,'mode','legacy','snapshot',NULL,'billing',NULL);
 END IF;
 -- A legacy general conversation carries NO financial facts and does not gain
 -- financial authority. Fresh/bound invoice reads retain the ORIGINAL Auth and
 -- request-business header evaluation; refusal never disables general CURA.
 IF public._client_portal_billing_client(t.tenant_id) IS DISTINCT FROM t.contact_id THEN
  RAISE EXCEPTION 'CUSTOMER_INVOICES_FORBIDDEN' USING ERRCODE='42501'; END IF;
 observation:=public._client_portal_invoice_observation_for_client(t.tenant_id,t.contact_id);
 IF NOT accepted THEN
  snapshot:=jsonb_build_object('version',1,'kind','customer_invoices','actor_id',actor,'tenant_id',t.tenant_id,
   'contact_id',t.contact_id,'thread_id',p_thread,'intent_id',p_intent,
   'observation_identity',observation->'observation_identity','captured_at',observation->'read_at'); END IF;
 IF NOT public._client_invoices_snapshot_current(actor,t.tenant_id,t.contact_id,p_thread,p_intent,snapshot)
  OR observation->>'observation_identity' IS DISTINCT FROM snapshot->>'observation_identity' THEN
  RAISE EXCEPTION 'CUSTOMER_INVOICES_SOURCE_WITHDRAWN' USING ERRCODE='42501'; END IF;
 facts:=observation->'facts';
 -- Same fixed five-row query/full balances; no internal provenance in model data.
 -- Retain accepted capture time, not the volatile timestamp of this revalidation.
 billing:=jsonb_build_object('tenant_id',t.tenant_id,'contact_id',t.contact_id,'captured_at',snapshot->'captured_at',
  'calendar',jsonb_build_object('state',observation#>'{calendar,state}','zone',observation#>'{calendar,zone}',
   'local_date',observation#>'{calendar,local_date}'),'invoices',facts->'invoices','balances',facts->'balances',
  'payment_evidence_version',facts->'payment_evidence_version','financial_evidence_version',facts->'financial_evidence_version',
  'invoice_count',facts->'invoice_count','open_count',facts->'open_count','has_more',facts->'has_more','next_cursor',facts->'next_cursor');
 RETURN jsonb_build_object('thread_id',p_thread,'intent_id',p_intent,'mode',CASE WHEN accepted THEN 'bound' ELSE 'fresh' END,
  'snapshot',snapshot,'billing',billing);
END $function$;
DO $after_source$
DECLARE p pg_catalog.pg_proc%ROWTYPE;
BEGIN
 SELECT * INTO STRICT p FROM pg_catalog.pg_proc WHERE oid='public._client_portal_invoice_observation_for_client(uuid,uuid)'::regprocedure;
 IF pg_catalog.md5(p.prosrc) <> 'ac2601955788964e062e6ec89db8b350' OR pg_catalog.pg_get_userbyid(p.proowner)<>'postgres' OR p.prosecdef IS DISTINCT FROM false OR p.provolatile<>'v' OR p.proparallel<>'u' OR p.proisstrict OR p.proleakproof OR p.proretset OR p.pronargs<>2 OR p.prokind<>'f' OR p.provariadic<>0 OR p.proargmodes IS NOT NULL OR p.proallargtypes IS NOT NULL OR p.prolang<>(SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql') OR p.prorettype<>'jsonb'::regtype OR p.pronargdefaults<>0 OR p.proargdefaults IS NOT NULL OR p.proargnames IS DISTINCT FROM ARRAY['_tenant','_client']::text[] OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[] OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres}' THEN
  RAISE EXCEPTION 'Original CURA financial source/authority drift: _client_portal_invoice_observation_for_client(uuid,uuid)' USING ERRCODE='23514';
 END IF;
 SELECT * INTO STRICT p FROM pg_catalog.pg_proc WHERE oid='public.client_portal_assistant_invoices_context(uuid,uuid)'::regprocedure;
 IF pg_catalog.md5(p.prosrc) <> 'aa0155e08f043cc81ede721d46e708cb' OR pg_catalog.pg_get_userbyid(p.proowner)<>'postgres' OR p.prosecdef IS DISTINCT FROM true OR p.provolatile<>'v' OR p.proparallel<>'u' OR p.proisstrict OR p.proleakproof OR p.proretset OR p.pronargs<>2 OR p.prokind<>'f' OR p.provariadic<>0 OR p.proargmodes IS NOT NULL OR p.proallargtypes IS NOT NULL OR p.prolang<>(SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql') OR p.prorettype<>'jsonb'::regtype OR p.pronargdefaults<>0 OR p.proargdefaults IS NOT NULL OR p.proargnames IS DISTINCT FROM ARRAY['p_thread','p_intent']::text[] OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[] OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres,authenticated=X/postgres}' THEN
  RAISE EXCEPTION 'Original CURA financial source/authority drift: client_portal_assistant_invoices_context(uuid,uuid)' USING ERRCODE='23514';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc WHERE oid='public._client_portal_invoice_facts_for_client(uuid,uuid,integer,jsonb,date,integer)'::regprocedure AND pg_catalog.md5(prosrc)='1a622edb93cf9041638be41b615020c4' AND NOT prosecdef AND pg_catalog.pg_get_userbyid(proowner)='postgres' AND proconfig=ARRAY['search_path=""']::text[] AND proacl::text='{postgres=X/postgres}') THEN
  RAISE EXCEPTION 'Original current financial facts require reconciliation' USING ERRCODE='23514'; END IF;
END $after_source$;
COMMIT;

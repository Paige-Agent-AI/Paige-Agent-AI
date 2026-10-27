-- Original accepted-intent observation only. No request, dispatch, scan, worker,
-- grant, approval, new result reader or execution admission.
BEGIN;
SET LOCAL lock_timeout='3s';

DO $manual_observation$
DECLARE
 fn regprocedure:='public.read_paige_durable_observation(uuid,uuid,uuid)'::regprocedure;
 source text; definition text; changed text; restored text; prior_acl aclitem[]; i integer;
 before_fragments text[]:=ARRAY[
  $a$artifact uuid; matched bigint; accepted boolean; recovery text;$a$,
  $a$ if not exists(select 1 from public.tenants where id=tenant and status='active') or not exists(select 1 from public.tenant_members where tenant_id=tenant and user_id=actor and status='active') then return null; end if;$a$,
  $a$ if not ((w.capability_key='document_generate' and w.work_kind='document_authoring') or (w.capability_key='deep_research' and w.work_kind='research')) then return null; end if;$a$,
  $a$ -- Original chat intent and domain work intent are deliberately distinct for documents.$a$,
  $a$ if w.status='succeeded' and w.terminal_outcome->'verified_readback'='true'::jsonb and w.settled_at is not null and w.settled_at<=now() and w.settled_at>=w.created_at then$a$
 ];
 after_fragments text[]:=ARRAY[
  $a$artifact uuid; matched bigint; accepted boolean; recovery text; manual_verified boolean:=false; manual_receipt uuid;$a$,
  $a$ if not exists(select 1 from public.tenant_members where tenant_id=tenant and user_id=actor and status='active') then return null; end if;$a$,
  $a$ if not ((w.capability_key='document_generate' and w.work_kind='document_authoring') or (w.capability_key='deep_research' and w.work_kind='research') or (w.capability_key='systems.check' and w.work_kind='systems_check')) then return null; end if;
 -- Preserve the original active-only predicate for every incumbent purpose.
 -- Manual eligibility is the ORIGINAL current Work reader's decision below.
 if w.capability_key<>'systems.check' and not exists(select 1 from public.tenants where id=tenant and status='active') then return null; end if;$a$,
  $a$ -- Reuse the ORIGINAL closed-purpose/current Metric/SOLO Work reader.
 -- Neither the stored initiating actor nor this observation grants authority.
 if w.capability_key='systems.check' then
  if t.audience is distinct from 'workspace' or not exists(
   select 1 from public.get_paige_durable_work(w.id) q
    where q.work_id=w.id and q.capability_key='systems.check' and q.work_kind='systems_check'
     and q.work_status=w.status and q.attempt_count=1 and q.max_attempts=1
  ) then return null; end if;
 end if;
 -- Original chat intent and domain work intent are deliberately distinct for documents.$a$,
  $a$ if w.capability_key='systems.check' then
  -- A prepared/claimed request or delivery acknowledgment is never completion.
  -- Do not reread mutable corrective findings or create a missing receipt.
  if w.status='succeeded' and w.settled_at is not null and w.claimed_at is not null
    and w.created_at<=w.claimed_at and w.claimed_at<=w.settled_at and w.settled_at<=now() then
   select count(*),min(e.id::text)::uuid into matched,manual_receipt
   from public.paige_systems_check_run r
   join public.paige_workspace_events e on e.tenant_id=w.tenant_id
    and e.actor_id=w.initiating_user_id and e.source_kind='system_check'
    and e.source_id=w.id and e.source_revision=0 and e.outcome='check_completed'
    and e.capability_key is null
    and e.detail=jsonb_build_object('version',1,'work_id',w.id,'run_id',w.id,
     'scope','tenant','scan_flavor','manual','action_filing','none',
     'check_count',r.check_count,'pass_count',r.pass_count,'fail_count',r.fail_count)
   where r.id=w.id and r.work_id=w.id and r.tenant_id=w.tenant_id
    and r.scan_flavor='manual' and r.selected_runner_keys is null
    and r.triggered_by->>'scope'='tenant' and r.triggered_by->>'action_filing'='none'
    and r.started_at>=w.claimed_at and r.completed_at>=r.started_at and r.completed_at<=w.settled_at
    and r.check_count>=0 and r.pass_count>=0 and r.fail_count>=0
    and r.pass_count::bigint+r.fail_count::bigint<=r.check_count
    and w.terminal_outcome=jsonb_build_object('verified_readback',true,'run_id',w.id,
     'check_count',r.check_count,'pass_count',r.pass_count,'fail_count',r.fail_count)
    and not exists(select 1 from public.paige_systems_check_run other where other.work_id=w.id and other.id<>w.id);
   manual_verified:=matched=1;
  end if;
  recovery:=case when w.status in ('expired','outcome_unknown') then 'reconciliation_required'
   when w.status='succeeded' and not manual_verified then 'terminal_unverified' else 'observed' end;
  return jsonb_build_object('workId',w.id,'threadId',_thread,'intentId',_intent,'workIntentId',w.intent_id,
   'tenantId',tenant,'actorId',actor,'state',w.status,'version',w.version,'recoveryState',recovery,
   'approvalState','unavailable','cancelled',w.status='cancelled','artifactVerified',false,'artifactRef',null,
   'observationKind','systems_check','receiptVerified',manual_verified,
   'receiptRef',case when manual_verified then manual_receipt else null end);
 end if;
 if w.status='succeeded' and w.terminal_outcome->'verified_readback'='true'::jsonb and w.settled_at is not null and w.settled_at<=now() and w.settled_at>=w.created_at then$a$
 ];
BEGIN
 SELECT p.prosrc,pg_get_functiondef(p.oid),p.proacl INTO source,definition,prior_acl
  FROM pg_proc p WHERE p.oid=fn;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=fn AND p.prosecdef AND p.provolatile='s'
  AND pg_get_userbyid(p.proowner)='postgres' AND p.proconfig=ARRAY['search_path=""']
  AND p.proargnames=ARRAY['_thread','_intent','_work']::text[] AND p.prorettype='jsonb'::regtype
  AND p.proacl=ARRAY['postgres=X/postgres','authenticated=X/postgres']::aclitem[])
 THEN RAISE EXCEPTION 'MANUAL_OBSERVATION_METADATA_CHANGED'; END IF;
 -- Delegate current permission and the exact manual tuple, never duplicate it.
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid='public.get_paige_durable_work(uuid)'::regprocedure
  AND md5(p.prosrc)='d953ea9965f31193d3dbf2f184114730' AND p.prosecdef AND p.provolatile='s'
  AND pg_get_userbyid(p.proowner)='postgres' AND p.proconfig=ARRAY['search_path=""']
  AND p.proacl=ARRAY['postgres=X/postgres','authenticated=X/postgres']::aclitem[])
 THEN RAISE EXCEPTION 'MANUAL_OBSERVATION_WORK_READER_CHANGED'; END IF;
 IF md5(source) IS DISTINCT FROM 'f51bc9d05cc13f03d98d95e09361c0fd' THEN
  restored:=source;
  FOR i IN REVERSE array_length(after_fragments,1)..1 LOOP
   IF (length(restored)-length(replace(restored,after_fragments[i],'')))/length(after_fragments[i])<>1
    THEN RAISE EXCEPTION 'MANUAL_OBSERVATION_SOURCE_CHANGED'; END IF;
   restored:=replace(restored,after_fragments[i],before_fragments[i]);
  END LOOP;
  IF md5(restored) IS DISTINCT FROM 'f51bc9d05cc13f03d98d95e09361c0fd'
   THEN RAISE EXCEPTION 'MANUAL_OBSERVATION_SOURCE_CHANGED'; END IF;
  RETURN;
 END IF;
 changed:=source;
 FOR i IN 1..array_length(before_fragments,1) LOOP
  IF (length(changed)-length(replace(changed,before_fragments[i],'')))/length(before_fragments[i])<>1
   THEN RAISE EXCEPTION 'MANUAL_OBSERVATION_ANCHOR_CHANGED'; END IF;
  changed:=replace(changed,before_fragments[i],after_fragments[i]);
  definition:=replace(definition,before_fragments[i],after_fragments[i]);
 END LOOP;
 EXECUTE definition;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=fn AND md5(p.prosrc)=md5(changed)
  AND p.proacl IS NOT DISTINCT FROM prior_acl AND p.prosecdef AND p.provolatile='s'
  AND pg_get_userbyid(p.proowner)='postgres' AND p.proconfig=ARRAY['search_path=""']
  AND p.proargnames=ARRAY['_thread','_intent','_work']::text[] AND p.prorettype='jsonb'::regtype)
 THEN RAISE EXCEPTION 'MANUAL_OBSERVATION_METADATA_CHANGED'; END IF;
END $manual_observation$;
COMMIT;

-- Extend the existing authenticated read with the original Document completion pair.
-- No worker, lease, dispatch or receipt writes are performed during recovery.
begin;
set local lock_timeout = '3s';

do $migration$
declare
  reader regprocedure := 'public.read_paige_durable_continuation(uuid,uuid,uuid)'::regprocedure;
  source text;
  definition text;
  original_acl aclitem[];
  declarations text := ' objective text;';
  tail text := ' return jsonb_build_object(';
  finish text := $finish$ -- The original observer validates the saved artifact and its completion turn.
 if w.work_kind = 'document_authoring' and w.status = 'succeeded' and w.attempt_count > 0 then
  observation := public.read_paige_durable_observation(_thread, _intent, _work);
  if observation->'artifactVerified' = 'true'::jsonb then
   select count(*), min(e.id::text)::uuid into receipt_count, receipt
   from public.paige_workspace_events e
   where e.tenant_id = tenant and e.actor_id = actor
    and e.source_kind = 'capability_run' and e.source_id = w.id and e.source_revision = 0
    and e.capability_key = 'document_generate' and e.outcome = 'capability_succeeded'
    and e.job_attempt_id = w.id::text || ':' || w.attempt_count::text
    and e.detail @> jsonb_build_object(
     'work_id', w.id, 'content_id', observation->'artifactRef',
     'document_revision', w.terminal_outcome->'document_revision', 'verified_readback', true);
   if receipt_count = 1 then
    completion := jsonb_build_object('completion', jsonb_build_object(
     'resultRef', observation->'artifactRef', 'receiptRef', receipt));
   end if;
  end if;
 end if;
 return completion || jsonb_build_object($finish$;
begin
  select p.prosrc, pg_get_functiondef(p.oid), p.proacl into source, definition, original_acl
  from pg_proc p
  where p.oid = reader and p.prosecdef and p.provolatile = 's'
   and pg_get_userbyid(p.proowner) = 'postgres' and p.proconfig = array['search_path=""']
   and p.proargnames = array['_thread','_intent','_work']::text[] and p.prorettype = 'jsonb'::regtype
   and p.proacl = array['postgres=X/postgres','authenticated=X/postgres']::aclitem[];
  if md5(source) is distinct from '1f5e67e692b09b305f3546ed32a445f1'
   or (length(source) - length(replace(source, declarations, ''))) <> length(declarations)
   or (length(source) - length(replace(source, tail, ''))) <> length(tail) then
    raise exception 'C4D_CONTINUATION_READER_CHANGED';
  end if;

  definition := replace(definition, declarations,
    declarations || E'\n observation jsonb;\n receipt_count bigint;\n receipt uuid;\n completion jsonb := ''{}''::jsonb;');
  execute replace(definition, tail, finish);

  if not exists (select 1 from pg_proc p where p.oid = reader and p.proacl is not distinct from original_acl
   and p.prosecdef and p.provolatile = 's' and p.proconfig = array['search_path=""']
   and pg_get_userbyid(p.proowner) = 'postgres') then
    raise exception 'C4D_CONTINUATION_READER_AUTHORITY_CHANGED';
  end if;
end $migration$;
commit;

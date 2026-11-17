-- Extend the existing authenticated read with the original Document completion pair.
-- No worker, lease, dispatch or receipt writes are performed during recovery.
begin;
set local lock_timeout = '3s';

-- Stamp the digest of the exact persisted body on the existing append-only receipt.
-- Preserve the separate Business Review receipt detail.
do $document_receipt$
declare
  writer regprocedure := 'public.complete_paige_document_work(uuid,text,text,text,jsonb,text,text,integer,integer)'::regprocedure;
  source text;
  definition text;
  original_acl aclitem[];
  before_receipt text := $body$      'verified_readback', true,
      'document_purpose', _artifact_meta->>'document_purpose'
    )
  );$body$;
  after_receipt text := $body$      'verified_readback', true,
      'document_purpose', _artifact_meta->>'document_purpose'
    ) || case when _doc_type = 'business_review' then '{}'::jsonb else jsonb_build_object(
      'document_sha256', encode(sha256(convert_to(_content.body, 'UTF8')), 'hex')
    ) end
  );$body$;
begin
  select p.prosrc, pg_get_functiondef(p.oid), p.proacl into source, definition, original_acl
  from pg_proc p
  where p.oid = writer and p.prosecdef and p.provolatile = 'v'
   and pg_get_userbyid(p.proowner) = 'postgres' and p.proconfig = array['search_path=""']
   and p.proacl = array['postgres=X/postgres','service_role=X/postgres']::aclitem[];
  if md5(source) is distinct from 'f9024a108431a8839c1148c4aff0bfe2'
   or (length(source) - length(replace(source, before_receipt, ''))) <> length(before_receipt) then
    raise exception 'C4D_DOCUMENT_RECEIPT_WRITER_CHANGED';
  end if;

  execute replace(definition, before_receipt, after_receipt);
  if not exists (select 1 from pg_proc p where p.oid = writer and p.proacl is not distinct from original_acl
   and p.prosecdef and p.provolatile = 'v' and p.proconfig = array['search_path=""']
   and pg_get_userbyid(p.proowner) = 'postgres' and p.prosrc = replace(source, before_receipt, after_receipt)) then
    raise exception 'C4D_DOCUMENT_RECEIPT_WRITER_READBACK_CHANGED';
  end if;
end $document_receipt$;

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
   join public.marketing_content m on m.id = (observation->>'artifactRef')::uuid
    and m.tenant_id = w.tenant_id and m.work_id = w.id
   where e.tenant_id = tenant and e.actor_id = actor
    and e.source_kind = 'capability_run' and e.source_id = w.id and e.source_revision = 0
    and e.capability_key = 'document_generate' and e.outcome = 'capability_succeeded'
    and e.job_attempt_id = w.id::text || ':' || w.attempt_count::text
    and e.detail @> jsonb_build_object(
     'work_id', w.id, 'content_id', observation->'artifactRef',
     'document_revision', w.terminal_outcome->'document_revision', 'verified_readback', true,
     'document_sha256', encode(sha256(convert_to(m.body, 'UTF8')), 'hex'));
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

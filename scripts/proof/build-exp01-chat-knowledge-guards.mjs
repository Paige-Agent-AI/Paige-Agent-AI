import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const path='scripts/proof/exp01-chat-knowledge-candidate.sql',source=readFileSync(path,'utf8').replaceAll('\r\n','\n');
const signatures=[
 ['_paige_chat_knowledge_scope','uuid,uuid,uuid',false,'void',0,[]],
 ['_paige_chat_knowledge_source','uuid,uuid,uuid',false,'jsonb',0,[]],
 ['_paige_chat_knowledge_intake_source','uuid,uuid,uuid',false,'jsonb',0,[]],
 ['inspect_paige_chat_knowledge_intake','uuid,uuid,uuid,uuid',true,'jsonb',0,['authenticated']],
 ['stage_paige_chat_knowledge_intake','uuid,uuid,uuid,uuid,uuid,uuid,integer,uuid,text,integer',true,'jsonb',0,['authenticated']],
 ['inspect_paige_chat_knowledge_link','uuid,uuid,uuid,uuid',true,'jsonb',0,['authenticated']],
 ['save_paige_chat_knowledge_link','uuid,uuid,uuid,uuid,uuid,uuid,integer,uuid,text,integer',true,'jsonb',0,['authenticated']],
 ['list_paige_chat_knowledge_links','uuid,uuid,uuid,uuid,integer',true,'jsonb',2,['authenticated']],
];
const rows=signatures.map(([name,args,definer,type,defaults,grantees])=>{
 const start=source.indexOf('CREATE OR REPLACE FUNCTION public.'+name+'(');assert.ok(start>0);
 const tail=source.slice(start),delimiter=/\bAS (\$(?:\w+)?\$)/.exec(tail);assert.ok(delimiter);
 const begin=delimiter.index+delimiter[0].length,end=tail.indexOf(delimiter[1],begin);assert.ok(end>begin);
 return `  ('public.${name}(${args})','${createHash('md5').update(tail.slice(begin,end)).digest('hex')}',${definer},'${type}',${defaults},ARRAY[${grantees.map(g=>`'${g}'`).join(',')}]::text[])`;
});
const guard=`DO $chat_install$
DECLARE expected record; f record; installed integer:=0; columns integer; indexes integer;
BEGIN
 FOR expected IN SELECT * FROM (VALUES
${rows.join(',\n')}
 ) v(signature,body_hash,definer,return_type,defaults_count,grantees) LOOP
  SELECT * INTO f FROM pg_proc WHERE oid=to_regprocedure(expected.signature);
  IF NOT FOUND THEN CONTINUE; END IF;
  installed:=installed+1;
  IF md5(f.prosrc)<>expected.body_hash OR f.proowner<>current_user::regrole
   OR f.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql') OR f.prokind<>'f'
   OR f.provolatile<>'v' OR f.proparallel<>'u' OR f.prorettype<>expected.return_type::regtype
   OR f.proretset OR f.proisstrict OR f.proleakproof OR f.pronargdefaults<>expected.defaults_count
   OR pg_get_expr(f.proargdefaults,0) IS DISTINCT FROM (CASE WHEN expected.defaults_count=2 THEN 'NULL::uuid, 20' ELSE NULL END)
   OR f.prosecdef IS DISTINCT FROM expected.definer OR f.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
   OR EXISTS(SELECT 1 FROM unnest(expected.grantees) r WHERE NOT has_function_privilege(r,f.oid,'EXECUTE'))
   OR EXISTS(SELECT 1 FROM aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a
    WHERE a.privilege_type<>'EXECUTE' OR a.grantor<>f.proowner
     OR (a.grantee<>f.proowner AND NOT EXISTS(SELECT 1 FROM unnest(expected.grantees) r WHERE a.grantee=r::regrole::oid))
     OR (a.grantee<>f.proowner AND a.is_grantable)) THEN
   RAISE EXCEPTION 'CHAT_KNOWLEDGE_INSTALL_DRIFT'; END IF;
 END LOOP;
 IF installed NOT IN (0,8) THEN RAISE EXCEPTION 'CHAT_KNOWLEDGE_PARTIAL_INSTALL'; END IF;
 IF has_table_privilege('authenticated','public.paige_durable_work','UPDATE')
  OR has_table_privilege('anon','public.paige_durable_work','UPDATE')
  OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.paige_durable_work'::regclass) THEN
  RAISE EXCEPTION 'CHAT_KNOWLEDGE_STORAGE_DRIFT'; END IF;
 SELECT count(*) INTO columns FROM pg_attribute WHERE attrelid='public.paige_durable_work'::regclass
  AND attname='chat_source_link' AND NOT attisdropped;
 IF EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.paige_durable_work'::regclass
  AND attname='chat_source_link' AND NOT attisdropped AND (atttypid<>'jsonb'::regtype OR attnotnull OR atthasdef)) THEN
  RAISE EXCEPTION 'CHAT_KNOWLEDGE_COLUMN_DRIFT'; END IF;
 SELECT count(*) INTO indexes FROM pg_class WHERE oid=to_regclass('public.paige_work_chat_knowledge_source');
 IF installed=0 AND (columns<>0 OR indexes<>0) OR installed=8 AND (columns<>1 OR indexes<>1) THEN
  RAISE EXCEPTION 'CHAT_KNOWLEDGE_PARTIAL_INSTALL'; END IF;
 IF installed=8 AND NOT EXISTS(SELECT 1 FROM pg_index i WHERE i.indexrelid=to_regclass('public.paige_work_chat_knowledge_source')
  AND i.indrelid='public.paige_durable_work'::regclass AND i.indisvalid AND i.indisready AND NOT i.indisunique
  AND pg_get_indexdef(i.indexrelid)='CREATE INDEX paige_work_chat_knowledge_source ON public.paige_durable_work USING btree (tenant_id, initiating_user_id, ((chat_source_link ->> ''threadId''::text)), id) WHERE (chat_source_link IS NOT NULL)') THEN
  RAISE EXCEPTION 'CHAT_KNOWLEDGE_INDEX_DRIFT'; END IF;
END $chat_install$;`;
const begin='-- E01_CHAT_INSTALL_GUARD_BEGIN',end='-- E01_CHAT_INSTALL_GUARD_END';
assert.equal(source.split(begin).length,2);assert.equal(source.split(end).length,2);
const result=source.slice(0,source.indexOf(begin)+begin.length)+'\n'+guard+'\n'+source.slice(source.indexOf(end));
if(process.argv.includes('--check'))assert.equal(result,source);else writeFileSync(path,result);
console.log('Exact original Chat Knowledge install/replay guard '+(process.argv.includes('--check')?'PASS':'generated'));

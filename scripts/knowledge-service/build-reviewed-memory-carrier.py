"""Build a LOCAL unversioned atomic carrier from the original reviewed producers.

Generation is not database verification, publication, application or acceptance.
No SQL is executed here. A versioned migration requires separate ordered release.
"""
import hashlib
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[2]
HERE = pathlib.Path(__file__).resolve().parent


def original_function(name, filename):
    source = (ROOT / 'supabase/migrations' / filename).read_text(encoding='utf-8')
    matches = re.findall(r'CREATE OR REPLACE FUNCTION public\.' + name + r'\([\s\S]+?\$function\$;', source, re.I)
    if len(matches) != 1:
        raise ValueError('Original function source drift: ' + name)
    return matches[0]


def body_hash(source):
    parts = source.split('$function$')
    if len(parts) != 3:
        raise ValueError('Original function delimiter drift')
    return hashlib.md5(parts[1].encode('utf-8')).hexdigest()


def transaction_body(filename):
    source = (HERE / filename).read_text(encoding='utf-8')
    if len(re.findall(r'^BEGIN;$', source, re.M)) != 1 or len(re.findall(r'^COMMIT;$', source, re.M)) != 1:
        raise ValueError('Candidate transaction structure drift: ' + filename)
    return re.sub(r'^(BEGIN|COMMIT);\n?', '', source, flags=re.M)


def build():
    record = original_function('record_paige_memory', '20270599000000_s5_owner_memory_backfill.sql')
    reader = original_function('get_paige_memory', '20261223000000_paige_memory_governed_contract.sql')
    forget = original_function('forget_paige_memory', '20261223000000_paige_memory_governed_contract.sql')
    if [body_hash(s) for s in [record, reader, forget]] != [
        '2ca751faa9d87bc6c4a586fd607847d0', '6f0ecfc77ce855160db184e6770000f4', 'f145788514336a0ae4e48aa950c82b55',
    ]:
        raise ValueError('Original Memory body drift')
    needle = '  ORDER BY m.created_at DESC\n'
    if reader.count(needle) != 1:
        raise ValueError('Original reader insertion point drift')
    predicate = (HERE / 'reviewed-memory-context-predicate.sql').read_text(encoding='utf-8')
    reader = reader.replace(needle, predicate + needle, 1)
    if body_hash(reader) != '6f815ab77dac205aa2fef761716f8e30':
        raise ValueError('Reviewed reader body drift')
    guard = """DO $dependency_guard$
DECLARE expected record; f record; target oid;
BEGIN
 FOR expected IN SELECT * FROM (VALUES
  ('public.knowledge_actor_authorized(uuid,uuid)','a05876e786e8a6e7e3e15783cde684aa',
   'sql','s','boolean',0,NULL::text,'service_role'),
  ('public.read_tenant_knowledge(uuid,uuid,integer,integer)','9ee43da246514e9fb88b96a23c584d37',
   'plpgsql','v','jsonb',3,'NULL::uuid, 50, 0','authenticated')
 ) v(signature,body_hash,language,volatility,return_type,defaults_count,defaults_text,grantee) LOOP
  target:=to_regprocedure(expected.signature);
  IF target IS NULL THEN RAISE EXCEPTION 'PAIGE_MEMORY_SOURCE_DRIFT'; END IF;
  SELECT * INTO STRICT f FROM pg_proc WHERE oid=target;
  IF md5(f.prosrc)<>expected.body_hash OR f.proowner<>current_user::regrole
   OR f.prolang IS DISTINCT FROM (SELECT oid FROM pg_language WHERE lanname=expected.language)
   OR f.prokind<>'f' OR f.prorettype<>expected.return_type::regtype OR f.proretset
   OR f.provolatile::text<>expected.volatility OR f.pronargdefaults<>expected.defaults_count
   OR pg_get_expr(f.proargdefaults,0) IS DISTINCT FROM expected.defaults_text
   OR f.proparallel<>'u' OR f.proisstrict OR f.proleakproof OR NOT f.prosecdef
   OR f.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
   OR NOT has_function_privilege(expected.grantee,f.oid,'EXECUTE')
   OR EXISTS(SELECT 1 FROM aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a
    WHERE a.privilege_type<>'EXECUTE' OR a.grantor<>f.proowner
     OR a.grantee NOT IN (f.proowner,expected.grantee::regrole::oid)
     OR (a.grantee<>f.proowner AND a.is_grantable)) THEN
   RAISE EXCEPTION 'PAIGE_MEMORY_SOURCE_DRIFT';
  END IF;
 END LOOP;
END $dependency_guard$;
DO $original_guard$
DECLARE expected record; f record; target oid;
BEGIN
 FOR expected IN SELECT * FROM (VALUES
  ('public.record_paige_memory(text,text,uuid,jsonb,boolean,text,uuid,uuid)',
   ARRAY['2ca751faa9d87bc6c4a586fd607847d0','11f56fb9590bbb1d7fec074f2fb3c67e'],
   'uuid','v',false,6,'NULL::uuid, ''{}''::jsonb, false, ''proposed''::text, NULL::uuid, NULL::uuid'),
  ('public.get_paige_memory(text[],integer,uuid,uuid)',
   ARRAY['6f0ecfc77ce855160db184e6770000f4','6f815ab77dac205aa2fef761716f8e30'],
   'record','s',true,4,'NULL::text[], 50, NULL::uuid, NULL::uuid'),
  ('public.forget_paige_memory(uuid,uuid,uuid)',
   ARRAY['f145788514336a0ae4e48aa950c82b55'],
   'boolean','v',false,2,'NULL::uuid, NULL::uuid')
 ) v(signature,body_hashes,return_type,volatility,returns_set,defaults_count,defaults_text) LOOP
  target:=to_regprocedure(expected.signature);
  IF target IS NULL THEN RAISE EXCEPTION 'PAIGE_MEMORY_SOURCE_DRIFT'; END IF;
  SELECT * INTO STRICT f FROM pg_proc WHERE oid=target;
  IF NOT(md5(f.prosrc)=ANY(expected.body_hashes)) OR f.proowner<>current_user::regrole
   OR f.prolang IS DISTINCT FROM (SELECT oid FROM pg_language WHERE lanname='plpgsql')
   OR f.prokind<>'f' OR f.prorettype<>expected.return_type::regtype
   OR f.provolatile::text<>expected.volatility OR f.proretset IS DISTINCT FROM expected.returns_set
   OR f.pronargdefaults<>expected.defaults_count
   OR pg_get_expr(f.proargdefaults,0) IS DISTINCT FROM expected.defaults_text
   OR f.proparallel<>'u' OR f.proisstrict OR f.proleakproof OR NOT f.prosecdef
   OR f.proconfig IS DISTINCT FROM ARRAY['search_path=public']::text[]
   OR has_function_privilege('anon',f.oid,'EXECUTE')
   OR NOT has_function_privilege('authenticated',f.oid,'EXECUTE')
   OR NOT has_function_privilege('service_role',f.oid,'EXECUTE')
   OR EXISTS(SELECT 1 FROM aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a
    WHERE a.privilege_type<>'EXECUTE' OR a.grantor<>f.proowner
     OR a.grantee NOT IN (f.proowner,'authenticated'::regrole::oid,'service_role'::regrole::oid)
     OR (a.grantee<>f.proowner AND a.is_grantable)) THEN
   RAISE EXCEPTION 'PAIGE_MEMORY_SOURCE_DRIFT';
  END IF;
 END LOOP;
END $original_guard$;
"""
    return ('-- LOCAL UNVERSIONED CARRIER. NOT RELEASED OR APPLIED. Native verification owed.\nBEGIN;\n'
            + guard + reader + '\n' + transaction_body('reviewed-memory-candidate.sql')
            + '\n' + transaction_body('reviewed-memory-lifecycle-candidate.sql') + '\nCOMMIT;\n')


if __name__ == '__main__':
    target = HERE / 'reviewed-memory-carrier.sql'
    content = build()
    target.write_text(content, encoding='utf-8', newline='\n')
    print('LOCAL carrier generated:', target.name, hashlib.sha256(content.encode('utf-8')).hexdigest())

"""Build the same private source validators into a guarded, repeatable candidate.

Build-time only: no database, credentials, runtime authority or migration version.
Original domain writers must still validate source and approval in one transaction.
"""
import argparse
import hashlib
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[2]
DEPENDENCIES = [
    ('public.knowledge_utf16_length(text)', 'ac0ec20d31948a93814074a35bc59e81', 'sql', 'i', 's', 'integer', False, 0, None, ['authenticated', 'service_role']),
    ('public.knowledge_actor_authorized(uuid,uuid)', 'a05876e786e8a6e7e3e15783cde684aa', 'sql', 's', 'u', 'boolean', True, 0, None, ['service_role']),
    ('public.lock_knowledge_extraction_authority(uuid,uuid)', '788d27bc980fee58e6272c3e53ca6096', 'plpgsql', 'v', 'u', 'boolean', True, 0, None, ['service_role']),
    ('public.read_tenant_knowledge(uuid,uuid,integer,integer)', '9ee43da246514e9fb88b96a23c584d37', 'plpgsql', 'v', 'u', 'jsonb', True, 3, 'NULL::uuid, 50, 0', ['authenticated']),
]


def literal(value):
    if value is None:
        return 'NULL::text'
    if isinstance(value, bool):
        return 'true' if value else 'false'
    if isinstance(value, int):
        return str(value)
    if isinstance(value, list):
        return 'ARRAY[' + ','.join(literal(v) for v in value) + ']::text[]'
    return "'" + value.replace("'", "''") + "'"


def guard(specs, label, absent_allowed=False):
    rows = ',\n  '.join('(' + ','.join(literal(v) for v in row) + ')' for row in specs)
    absence = 'CONTINUE;' if absent_allowed else "RAISE EXCEPTION 'KNOWLEDGE_SOURCE_INSTALL_DRIFT';"
    return f"""DO ${label}$
DECLARE expected record; f record; target oid;
BEGIN
 FOR expected IN SELECT * FROM (VALUES
  {rows}
 ) v(signature,body_hash,language,volatility,parallel,return_type,definer,defaults_count,defaults_text,grantees) LOOP
  target:=to_regprocedure(expected.signature);
  IF target IS NULL THEN {absence} END IF;
  SELECT * INTO STRICT f FROM pg_proc WHERE oid=target;
  IF md5(f.prosrc)<>expected.body_hash OR f.proowner<>current_user::regrole
   OR f.prolang IS DISTINCT FROM (SELECT oid FROM pg_language WHERE lanname=expected.language)
   OR f.prokind<>'f' OR f.prorettype<>expected.return_type::regtype OR f.proretset
   OR f.provolatile::text<>expected.volatility OR f.proparallel::text<>expected.parallel
   OR f.prosecdef IS DISTINCT FROM expected.definer OR f.proisstrict OR f.proleakproof
   OR f.pronargdefaults<>expected.defaults_count
   OR pg_get_expr(f.proargdefaults,0) IS DISTINCT FROM expected.defaults_text
   OR f.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
   OR EXISTS(SELECT 1 FROM unnest(expected.grantees) r WHERE NOT has_function_privilege(r,f.oid,'EXECUTE'))
   OR EXISTS(SELECT 1 FROM aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a
    WHERE a.privilege_type<>'EXECUTE' OR a.grantor<>f.proowner
     OR (a.grantee<>f.proowner AND NOT EXISTS(SELECT 1 FROM unnest(expected.grantees) r WHERE a.grantee=r::regrole::oid))
     OR (a.grantee<>f.proowner AND a.is_grantable)) THEN
   RAISE EXCEPTION 'KNOWLEDGE_SOURCE_INSTALL_DRIFT';
  END IF;
 END LOOP;
END ${label}$;
"""


def build():
    sources = []
    candidates = []
    for name, signature, tag, parallel, result in [
        ('native-source-quotation.sql', 'public.knowledge_utf16_excerpt_matches(text,integer,integer,text)', 'quote', 's', 'boolean'),
        ('native-source-binding.sql', 'public.lock_knowledge_source_evidence(uuid,uuid,jsonb,jsonb)', 'binding', 'u', 'jsonb'),
    ]:
        source = (ROOT / 'scripts/knowledge-service' / name).read_text(encoding='utf8')
        statements = source[source.index('CREATE FUNCTION '):source.rindex('COMMIT;')]
        body = re.search(r'AS \$' + tag + r'\$(.*?)\$' + tag + r'\$;', statements, re.S)
        if body is None:
            raise ValueError('Original function body unavailable: ' + name)
        candidates.append((signature, hashlib.md5(body[1].encode('utf8')).hexdigest(), 'plpgsql', 'i' if tag == 'quote' else 'v', parallel, result, False, 0, None, []))
        sources.append(statements.replace('CREATE FUNCTION ', 'CREATE OR REPLACE FUNCTION ', 1))
    return ('-- PRIVATE original source-evidence installation candidate; UNVERSIONED/UNPUBLISHED.\n'
            '-- No public/service execution or domain approval. Invoke in the original writer transaction.\nBEGIN;\n'
            + guard(DEPENDENCIES, 'source_dependencies')
            + guard(candidates, 'source_existing', True)
            + '\n'.join(sources)
            + guard(candidates, 'source_installed') + 'COMMIT;\n')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', default='scripts/knowledge-service/native-source-evidence-install.sql')
    args = parser.parse_args()
    target = (ROOT / args.output).resolve()
    if ROOT not in target.parents:
        parser.error('Output must remain in the original repository')
    target.write_text(build(), encoding='utf8', newline='\n')
    print('Built private source candidate:', target.relative_to(ROOT))

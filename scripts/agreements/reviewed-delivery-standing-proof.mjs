import assert from 'node:assert/strict';

/** Guard/ABI/source proof on the original native signing fixture. This fixture
 * does NOT contain the full Work/Sales schema or genuine customer JWTs, so it
 * must not be described as a successful authenticated public-RPC read. */
export function proveReviewedDeliveryStanding({sql,read,tenant,c,prepared}){
 let checks=0;const equal=(a,b,message)=>{assert.deepEqual(a,b,message);checks++;};
 const json=q=>JSON.parse(sql(q));
 const publicRead='public.read_client_engagement_status(uuid,uuid)';
 const privateRead='public._sales_client_reviewed_delivery(uuid,uuid,uuid)';
 const effectiveRead='public._sales_client_effective_terms(uuid,uuid,uuid)';
 const path='supabase/migrations/20271120102504_e04_reviewed_delivery_standing.sql';
 const migration=read(path),guard=migration.slice(migration.indexOf('DO $reader$'),migration.lastIndexOf('COMMIT;'));
 const meta=identity=>json(`SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid='${identity}'::regprocedure;`);
 const bodyHash=identity=>sql(`SELECT md5(prosrc) FROM pg_proc WHERE oid='${identity}'::regprocedure;`);
 const definition=identity=>sql(`SELECT pg_get_functiondef('${identity}'::regprocedure);`).replaceAll('\r\n','\n');
 equal(bodyHash(publicRead),'4680297b25322dca36b44dbaaf528a39','Original accepted-terms public reader is the exact input');
 equal(bodyHash(privateRead),'93f5fb101c0c54acab9ac2ac4a4f37e3','Original private delivery source is unchanged');
 const publicMeta=meta(publicRead),privateMeta=meta(privateRead),effectiveMeta=meta(effectiveRead),before=definition(publicRead);
 sql(migration);
 const after=definition(publicRead);
 equal(bodyHash(publicRead),'9a5f7a5d0964b3fb0fbce8f11f97bbd2','Exact additive public body is installed');
 equal(meta(publicRead),publicMeta,'Every original public pg_proc property except body is retained, including OID/ABI/ACL');
 equal(meta(privateRead),privateMeta,'Mounting grants no private authority');
 equal(meta(effectiveRead),effectiveMeta,'Original effective snapshot authority is preserved');
 const anchor=migration.split('$anchor$')[1],replacement=migration.split('$replacement$')[1];
 equal(after.replace(replacement,anchor),before,'Removing only the additive field reproduces the entire original definition');
 sql(migration);
 equal(definition(publicRead),after,'Complete mounting migration replays exactly');
 equal(meta(publicRead),publicMeta,'Replay retains original public OID/ABI/ACL');
 equal(json(`SELECT jsonb_build_array(has_function_privilege('anon','${publicRead}','EXECUTE'),
  has_function_privilege('authenticated','${publicRead}','EXECUTE'),has_function_privilege('service_role','${publicRead}','EXECUTE'));`),
  [false,true,false],'Original public role grants are unchanged');
 for(const identity of [privateRead,effectiveRead]){
  equal(json(`SELECT jsonb_build_array(has_function_privilege('anon','${identity}','EXECUTE'),
   has_function_privilege('authenticated','${identity}','EXECUTE'),has_function_privilege('service_role','${identity}','EXECUTE'));`),
   [false,false,false],'No caller gets direct private execution: '+identity);
 }
 const drift=identity=>`DO $drift$ DECLARE b text;d text;BEGIN SELECT prosrc,pg_get_functiondef(oid) INTO b,d FROM pg_proc
  WHERE oid='${identity}'::regprocedure;EXECUTE replace(d,b,b||E'\n-- synthetic drift, original anchors retained');END $drift$;`;
 for(const patch of [
  `ALTER FUNCTION ${publicRead} STABLE;`,
  `ALTER FUNCTION ${publicRead} SECURITY INVOKER;`,
  `ALTER FUNCTION ${publicRead} SET search_path=public;`,
  `GRANT EXECUTE ON FUNCTION ${publicRead} TO anon;`,
  `GRANT EXECUTE ON FUNCTION ${publicRead} TO service_role;`,
  `REVOKE EXECUTE ON FUNCTION ${publicRead} FROM authenticated;`,
  `GRANT EXECUTE ON FUNCTION ${privateRead} TO PUBLIC;`,
  `GRANT EXECUTE ON FUNCTION ${privateRead} TO authenticated;`,
  `GRANT EXECUTE ON FUNCTION ${privateRead} TO service_role;`,
  `ALTER FUNCTION ${privateRead} SECURITY DEFINER;`,
  `ALTER FUNCTION ${effectiveRead} SET search_path=public;`,
  drift(publicRead),drift(privateRead),drift(effectiveRead),
 ]){
  assert.throws(()=>sql('BEGIN;'+patch+guard+'ROLLBACK;'),/23514:[\s\S]*changed/);checks++;
 }
 equal(meta(publicRead),publicMeta,'All hostile metadata tests rolled back without changing authority');
 equal(definition(publicRead),after,'Hostile source tests leave the exact mounted source intact');
 for(const role of ['anon','service_role']){
  assert.throws(()=>sql(`SET ROLE ${role};SELECT read_client_engagement_status('${tenant}','${prepared.payload.source.client_id}');`),/42501:|permission denied/);checks++;
 }
 for(const role of ['anon','authenticated','service_role']){
  assert.throws(()=>sql(`SET ROLE ${role};SELECT _sales_client_reviewed_delivery('${tenant}','${prepared.payload.source.client_id}','${c.terms}');`),/42501:|permission denied/);checks++;
 }
 return {checks,migrationReplay:2,scope:'Actual original public reader source/complete metadata, additive inverse, guarded replay and ACL refusals; private helper remains owner-only. Reduced synthetic fixture: no successful complete-schema public RPC, genuine customer JWT, Work writers, artifact bytes, mounted UI or customer acceptance.'};
}

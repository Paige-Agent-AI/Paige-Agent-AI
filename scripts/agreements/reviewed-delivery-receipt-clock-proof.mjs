import assert from 'node:assert/strict';

/** Native source/metadata and hostile-input controls, not hosted acceptance. */
export function proveReviewedDeliveryReceiptClock({sql,read,tenant,c,prepared}){
 let checks=0;const equal=(a,b,label)=>{assert.deepEqual(a,b,label);checks++;};
 const json=q=>JSON.parse(sql(q));
 const identity='public._sales_client_reviewed_delivery(uuid,uuid,uuid)';
 const metadata=()=>json(`SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid='${identity}'::regprocedure;`);
 const definition=()=>sql(`SELECT pg_get_functiondef('${identity}'::regprocedure);`).replaceAll('\r\n','\n');
 const hash=()=>sql(`SELECT md5(prosrc) FROM pg_proc WHERE oid='${identity}'::regprocedure;`);
 const readback=(patch='')=>json('BEGIN;'+patch+`SELECT _sales_client_reviewed_delivery('${tenant}','${prepared.payload.source.client_id}','${c.terms}');ROLLBACK;`);
 // The old reduced fixture omitted the canonical audit timestamp column. Keep
 // that limitation explicit; the separate full-schema proof uses real writers.
 sql(`ALTER TABLE public.audit_logs ADD COLUMN created_at timestamptz NOT NULL DEFAULT '2026-10-20T11:00Z';`);
 const beforeMeta=metadata(),before=definition(),original=readback();
 equal(hash(),'93f5fb101c0c54acab9ac2ac4a4f37e3','Exact original private projection before receipt-clock repair');
 const migration=read('supabase/migrations/20271121142004_e04_delivery_receipt_clock.sql');
 const guard=migration.slice(migration.indexOf('DO $receipt_clock$'),migration.lastIndexOf('COMMIT;'));
 sql(migration);const after=definition();
 equal(hash(),'b0ec45d7adb8c38e6b582ac2cd00dbbb','Exact receipt-clock correction installed');
 equal(metadata(),beforeMeta,'Every original OID/ABI/owner/config/volatility/ACL is retained');
 equal(after.replace(migration.split('$replacement$')[1],migration.split('$anchor$')[1]),before,'Only the original mismatched clock comparison changes');
 equal(readback(),original,'Existing supported version and decision evidence is unchanged');
 sql(migration);equal(definition(),after,'Receipt-clock migration replays exactly');
 equal(metadata(),beforeMeta,'Replay retains every original authority property');
 const sameTransaction=`UPDATE operations_delivery_submissions SET reviewed_at='2026-10-20T12:30Z' WHERE state='approved';`;
 equal(readback(sameTransaction),original,'Wall-clock review can follow transaction-clock release without losing the actual supported decision');
 equal(readback("UPDATE audit_logs SET created_at='2026-10-21T11:00Z' WHERE action='delivery_reviewed';").state,'unavailable','A review receipt after release still withholds acceptance');
 equal(readback("DELETE FROM audit_logs WHERE action='delivery_reviewed';").state,'unavailable','Missing actual internal-review evidence still withholds acceptance');
 for(const patch of [
  `ALTER FUNCTION ${identity} SECURITY DEFINER;`,
  `ALTER FUNCTION ${identity} VOLATILE;`,
  `ALTER FUNCTION ${identity} SET search_path=public;`,
  `GRANT EXECUTE ON FUNCTION ${identity} TO authenticated;`,
  `GRANT EXECUTE ON FUNCTION ${identity} TO service_role;`,
  `DO $drift$ DECLARE b text;d text;BEGIN SELECT prosrc,pg_get_functiondef(oid) INTO b,d FROM pg_proc WHERE oid='${identity}'::regprocedure;EXECUTE replace(d,b,b||E'\n-- synthetic source drift');END $drift$;`,
 ]){assert.throws(()=>sql('BEGIN;'+patch+guard+'ROLLBACK;'),/23514:[\s\S]*changed/);checks++;}
 equal(metadata(),beforeMeta,'All hostile metadata patches roll back without authority changes');
 equal(definition(),after,'All hostile source patches leave the exact corrected body');
 return {checks,migrationReplay:2,scope:'Original private native projection, consistent receipt chronology, inverse/OID/ABI/ACL/replay/refusal controls; reduced Work shapes, no hosted customer or provider acceptance'};
}

// Exact original source reconstruction, never a runtime normalizer or applier.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
const md5=s=>createHash('md5').update(s).digest('hex');
export function planningHistorySource(repo){
 const read=p=>readFileSync(join(repo,p),'utf8').replace(/\r\n/g,'\n');
 const calendar=read('scripts/proof/exp05-zion-calendar-read-candidate.sql');
 const sig='public._team_hub_planning_read_annotations(public.team_hub_agent_turns)';
 const anchor=`('${sig}','4e6ea1c3dfc9355d366e10e88807f019',$source$`;
 assert.equal(calendar.split(anchor).length,2,'One whole original Calendar history definition');
 let original=calendar.split(anchor)[1].split('$source$')[0];
 assert.equal(md5(original),'3450c2fe42682d9091e3e316ecde0f00');
 const task=read('supabase/migrations/20271130010105_exp05_zion_original_task_references_earlier.sql');
 const edits=[...task.matchAll(/\('public\._team_hub_planning_read_annotations\(public\.team_hub_agent_turns\)',([01]),'3450c2fe42682d9091e3e316ecde0f00','f31a93f9774a628bb1c0c24128fd4674',\$old\$([\s\S]*?)\$old\$,\$new\$([\s\S]*?)\$new\$\)/g)];
 assert.equal(edits.length,2,'Only the two complete original Task history edits');
 for(const [,index,before,after] of edits){
  assert.equal(Number(index),edits.findIndex(e=>e[1]===index));
  assert.equal(original.split(before).length,2,'One exact original Task history preimage');
  original=original.replace(before,()=>after);
 }
 assert.equal(md5(original),'f31a93f9774a628bb1c0c24128fd4674','Complete original native history preimage');
 const before="md5(p.prosrc)='5545c370d54a7baef54ba37f9619e729'";
 const after="md5(p.prosrc) IN ('5545c370d54a7baef54ba37f9619e729','da16cf7c4a5341338b16a010fdfcc605')";
 assert.equal(original.split(before).length,2);
 const current=original.replace(before,()=>after);
 assert.equal(md5(current),'cc46be59b917b6eceb6df323f74b451f');
 assert.equal(current.replace(after,()=>before),original,'Whole-source scalar inverse is byte-exact');
 return {sig,original,current};
}

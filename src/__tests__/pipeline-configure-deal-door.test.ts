import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
const source=readFileSync('supabase/functions/paige-ai-chat/index.ts','utf8');
const start=source.indexOf('          // The structural pipeline door');
const end=source.indexOf('          if ((tc.function.name === "mission_create"',start);
if(start<0||end<start)throw Error('Missing pre-approval pipeline guard');
const guard=new Function('tc','gateArgs','toolResults',`for(let i=0;i<1;i++){${source.slice(start,end)}return true;}return false;`) as (tc:unknown,args:unknown,results:unknown[])=>boolean;
describe('actual pre-approval structural pipeline guard',()=>{
 it.each(['create-deal','create_deal','assign-contact','',null])('refuses alternate CRM write %j',type=>{const results:unknown[]=[];expect(guard({id:'call',function:{name:'pipeline_configure'}},{command:{type}},results)).toBe(false);expect(results).toHaveLength(1);});
 it.each(['create-pipeline','move-deal','create-folder'])('preserves declared structural act %s',type=>{const results:unknown[]=[];expect(guard({function:{name:'pipeline_configure'}},{command:{type}},results)).toBe(true);expect(results).toEqual([]);});
});

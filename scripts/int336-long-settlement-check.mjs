import assert from 'node:assert/strict';
import {createInteractiveExecution} from '../supabase/functions/_shared/paige-turn/interactive.ts';
let executor='old';let settled=false;
setTimeout(()=>{settled=true;executor=null},20000);
const next=createInteractiveExecution('next',{state:async()=>({latest:'next',executor}),acquire:async()=>{if(executor)return false;executor='next';return true},release:async()=>executor=null});
await next.acquire();assert.equal(settled,true);assert.equal(executor,'next');await next.release();
console.log('PASS: real20s consequential settlement retains old token and new canonical turn begins afterward');

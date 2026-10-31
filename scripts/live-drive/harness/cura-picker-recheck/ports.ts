import {useSyncExternalStore} from "react";
const scope={actor:"e0993000-0000-4000-8000-000000000001",tenant:"e0993000-0000-4000-8000-000000000002",contact:"e0993000-0000-4000-8000-000000000003"};
let value={phase:"ready",epoch:1,scope:scope as typeof scope|null};
const listeners=new Set<()=>void>(),subscribe=(fn:()=>void)=>{listeners.add(fn);return()=>{listeners.delete(fn);};};
const snapshot=()=>value;
const isCurrent=(epoch:number)=>value.phase==="ready"&&value.epoch===epoch;
const forbidden=()=>{throw new Error("No native, Storage, model or provider operation is allowed in this source frame.");};
export function setChecking(checking:boolean){value={...value,phase:checking?"loading":"ready",scope:checking?null:scope};listeners.forEach(fn=>fn());}
export function retire(){value={...value,epoch:value.epoch+1};listeners.forEach(fn=>fn());}
export function useFixtureState(){return useSyncExternalStore(subscribe,snapshot,snapshot);}
export function useClientDocuments(){return{...useFixtureState(),isCurrent,upload:{kind:"idle",id:null,notice:""},transfer:forbidden,checkUpload:forbidden,stopWaiting:forbidden,retrieve:forbidden};}

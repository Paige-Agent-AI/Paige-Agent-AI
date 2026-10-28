// Local rendered evidence ONLY: original components/hooks, synthetic SDK IO.
// No credentials, network, provider, customer or business mutations.
export const ids = { actor: 'e09a0000-0000-4000-8000-000000000001', tenant: 'e09a0000-0000-4000-8000-000000000002', client: 'e09a0000-0000-4000-8000-000000000003', calendar: 'e09a0000-0000-4000-8000-000000000004' };
let mode = 'saved', creates = 0; const records = new Map<string,Record<string,unknown>>();
const listeners = new Set<()=>void>();
export const subscribe = (f:()=>void) => { listeners.add(f); return ()=>{listeners.delete(f)}; };
export const count = () => creates;
export const selectCase = (value:string) => {mode=value;listeners.forEach(f=>f())};
const slot = () => {const d=new Date();d.setUTCDate(d.getUTCDate()+2);d.setUTCHours(14,0,0,0);return d.toISOString()};
const safe = (body:Record<string,unknown>,booking:Record<string,unknown>)=>({ok:true,state:'saved',tenant_id:body.tenant_id,client_id:body.client_id,request_id:body.request_id,replayed:false,booking:{id:booking.id,title:booking.title,start_at:booking.start_at,end_at:booking.end_at,timezone:booking.timezone,status:booking.status}});
export const supabase = {
 auth: {getUser:async()=>({data:{user:{id:ids.actor}},error:null}),getSession:async()=>({data:{session:{user:{id:ids.actor},access_token:'synthetic-render-only'}},error:null}),
  onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},
 rpc:(name:string,args:Record<string,unknown>={})=>{
  const headers:Record<string,string>={}; const q={setHeader:(k:string,v:string)=>{headers[k]=v;return q},abortSignal:()=>q,
   then:(resolve:(v:unknown)=>void,reject?:(e:unknown)=>void)=>Promise.resolve().then(()=>{
    if(name==='client_portal_booking_calendars'){
     if(mode==='read-error')throw new Error('Synthetic interrupted options');
     return{data:{tenant_id:args.p_tenant_id,client_id:args.p_expected_client_id,calendars:mode==='empty'?[]:[{id:ids.calendar,slug:'test-check-in',title:'Client check-in',description:'Review your progress and agree on next steps.',duration_min:30,timezone:'UTC'}],has_more:false,next_after_slug:null},error:null};
    }
    if(name==='client_portal_sessions')return{data:{tenant_id:args.p_tenant_id,server_now:new Date().toISOString(),next_before:null,sessions:[...records.values()].filter(b=>b.tenant_id===args.p_tenant_id).map(b=>({id:b.id,title:b.title,start_at:b.start_at,end_at:b.end_at,timezone:b.timezone,status:b.status,kind:'single',location:{type:'phone',label:'Phone call',join_url:null,kind:'phone'},calendar:{slug:'test-check-in',duration_min:30,appointment_type_id:null,accent:null},change:{can_cancel:false,can_reschedule:false,deadline:null,reason:'CALENDAR_UNAVAILABLE'}}))},error:null};
    throw new Error('Unexpected local SDK read: '+name);
   }).then(resolve,reject)};return q;
 },
 functions:{invoke:async(name:string,{body}:{body:Record<string,unknown>})=>{
  if(name!=='public-booking'||body.mode!=='customer')throw new Error('Unexpected local endpoint');
  if(body.action==='availability')return{data:{slots:mode==='no-times'?[]:[slot(),new Date(Date.parse(slot())+3600000).toISOString()],durationMin:30,timezone:'UTC',calendar:{id:ids.calendar,slug:'test-check-in',title:'Client check-in',bookingHorizonDays:60,appointmentTypes:[],intakeQuestions:mode==='intake'?[{id:'focus',label:'What would you like to work on?',type:'textarea',required:true,options:[],placeholder:null}]:[],locationOptions:[{type:'phone'}]}},error:null};
  if(body.action==='reconcile'){const b=records.get(String(body.request_id));return{data:b?safe(body,b):{state:'unverified'},error:null};}
  if(body.action!=='create')throw new Error('Unexpected local booking action');
  creates++;listeners.forEach(f=>f());
  if(mode==='taken')return{data:{state:'refused',code:'SLOT_UNAVAILABLE'},error:null};
  if(mode==='held')return{data:{state:'refused',code:'COMMS_PROVIDER_EXECUTION_DISABLED'},error:null};
  const b={id:crypto.randomUUID(),title:'Client check-in',start_at:String(body.start),end_at:new Date(Date.parse(String(body.start))+1800000).toISOString(),timezone:'UTC',status:'scheduled'};
  records.set(String(body.request_id),{...b,tenant_id:body.tenant_id});
  if(mode==='unknown')throw new Error('Synthetic lost response after saved work');
  return{data:safe(body,b),error:null};
 }}
};

// UI waiting only. A deadline never proves an invitation write did not finish.
export async function portalInvitationUiDeadline<T>(work:PromiseLike<T>):Promise<T>{
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{return await Promise.race([Promise.resolve(work),new Promise<T>((_,reject)=>{timer=setTimeout(()=>reject(Error('ui_deadline')),30000)})])}
 finally{clearTimeout(timer)}
}

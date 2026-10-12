/** Refuse normalization of nonexistent local times; the owner must confirm the exact deadline. */
export function resolveHandoffLocalDeadline(value:string):{iso:string;label:string}|null {
 const match=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);if(!match)return null;
 const [year,month,day,hour,minute]=match.slice(1).map(Number);const date=new Date(value);
 if(!Number.isFinite(date.getTime())||date.getFullYear()!==year||date.getMonth()!==month-1||date.getDate()!==day||date.getHours()!==hour||date.getMinutes()!==minute)return null;
 return {iso:date.toISOString(),label:date.toLocaleString(undefined,{year:"numeric",month:"short",day:"numeric",hour:"numeric",minute:"2-digit",timeZoneName:"short"})};
}

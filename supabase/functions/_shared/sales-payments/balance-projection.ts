/** Validate the one canonical receivable balance; evidence classes remain separate. */
export function readAllocatedBalance(value:Record<string,unknown>,total:number):{manual:number;verified:number;allocated:number;remaining:number}|null {
 const amount=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>=0;
 const manual=value.manual_recorded_cents,remaining=value.remaining_cents;
 const hasSplit=value.provider_verified_cents!==undefined||value.allocated_cents!==undefined;
 const verified=hasSplit?value.provider_verified_cents:0,allocated=hasSplit?value.allocated_cents:manual;
 if(!amount(total)||!amount(manual)||!amount(verified)||!amount(allocated)||!amount(remaining)||
  !Number.isSafeInteger(manual+verified)||allocated!==manual+verified||allocated>total||remaining!==total-allocated)return null;
 return {manual,verified,allocated,remaining};
}

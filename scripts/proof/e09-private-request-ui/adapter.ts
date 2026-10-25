// Explicit local rendering port: a rendered view cannot invoke a real backend.
const refused=()=>{throw new Error('No native/Auth operation is permitted by this view-only rendering port');};
export const supabase={rpc:refused,auth:{getUser:refused,onAuthStateChange:refused}};

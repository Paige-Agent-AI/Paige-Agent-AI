// Synthetic authority fixture only; never authenticated owner proof.
export function useTenantContext(){return {activeTenantId:'11111111-1111-4111-8111-111111111111',accountContextLoading:false};}
export const useOptionalTenantContext=useTenantContext;

import { useTenantContext as original } from "../../../exp08-team-hub-agents-a1c/harness/src/mock-tenant";
export const useTenantContext = () => { const context = original(); return { ...context, activeTenant: { ...context.activeTenant, account_number: 4242424 } }; };

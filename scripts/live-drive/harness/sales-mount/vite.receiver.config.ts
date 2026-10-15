import path from 'node:path';
import base from './vite.config';
export default {...base,resolve:{...base.resolve,alias:[{find:'@/hooks/useTenantContext',replacement:path.resolve(import.meta.dirname,'receiver-tenant-fixture.ts')},{find:'@/integrations/supabase/client',replacement:path.resolve(import.meta.dirname,'receiver-client-fixture.ts')},...base.resolve.alias.filter(a=>a.find!=='./useInvoiceBillingSources')]},build:{outDir:path.resolve(import.meta.dirname,'../../artifacts/sales-receiver-build'),emptyOutDir:true},preview:{host:'127.0.0.1',port:5247,strictPort:true}};

import path from 'node:path';
import {defineConfig} from 'vite';
import base from '../sales-domain-mount/vite.config';
const fixture=path.join(import.meta.dirname,'fixture.ts');
export default defineConfig({...base,root:import.meta.dirname,resolve:{alias:[
 {find:'@/hooks/useTenantContext',replacement:fixture},
 {find:'@/integrations/supabase/client',replacement:fixture},
 {find:'../useSalesInvoiceDrafts',replacement:fixture},
 {find:'../useSoloCommercialTerms',replacement:fixture},
 {find:'../useCatalogOffers',replacement:fixture},
 {find:'./useInvoiceBillingSources',replacement:fixture},
 {find:'./useSoloCampaigns',replacement:path.resolve(import.meta.dirname,'../sales-domain-mount/pipeline-fixture.ts')},
 ...base.resolve!.alias as {find:string;replacement:string}[],
]},server:{host:'127.0.0.1',port:5287,strictPort:true}});

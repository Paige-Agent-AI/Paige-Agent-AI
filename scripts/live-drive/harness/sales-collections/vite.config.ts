import path from 'node:path';
import {defineConfig} from 'vite';
import base from '../sales-invoice-lifecycle/vite.config';
const fixture=path.join(import.meta.dirname,'fixture.ts');
export default defineConfig({...base,root:import.meta.dirname,resolve:{alias:[{find:'@/integrations/supabase/client',replacement:fixture},{find:'./useSoloCampaigns',replacement:fixture},{find:'../../useSoloCommercialTerms',replacement:fixture},{find:'../useSoloCommercialTerms',replacement:fixture},...base.resolve!.alias as {find:string;replacement:string}[]]},server:{host:'127.0.0.1',port:5293,strictPort:true}});

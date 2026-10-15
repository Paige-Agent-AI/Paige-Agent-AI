import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react-swc';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../../',import.meta.url));
export default defineConfig({root,optimizeDeps:{entries:['scripts/proof/e04-client-commercial-ui/fixtures/index.html']},plugins:[react()],resolve:{alias:[
 {find:'@/integrations/supabase/client',replacement:fileURLToPath(new URL('./fixtures/sdk.ts',import.meta.url))},
 {find:'@',replacement:fileURLToPath(new URL('../../../src',import.meta.url))}
]},define:{'import.meta.env.VITE_SUPABASE_URL':JSON.stringify('https://fixture.invalid'),'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY':JSON.stringify('synthetic-publishable')},server:{host:'127.0.0.1',port:54382,strictPort:true}});

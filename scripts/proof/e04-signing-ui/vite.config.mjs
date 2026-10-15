import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react-swc';
import {fileURLToPath} from 'node:url';
export default defineConfig({
  root:fileURLToPath(new URL('../../../',import.meta.url)),plugins:[react()],
  optimizeDeps:{entries:['scripts/proof/e04-signing-ui/fixtures/index.html']},
  resolve:{alias:[
    {find:'@/integrations/supabase/client',replacement:fileURLToPath(new URL('./fixtures/sdk.ts',import.meta.url))},
    {find:'@',replacement:fileURLToPath(new URL('../../../src',import.meta.url))},
  ]},server:{host:'127.0.0.1',port:54383,strictPort:true},
});

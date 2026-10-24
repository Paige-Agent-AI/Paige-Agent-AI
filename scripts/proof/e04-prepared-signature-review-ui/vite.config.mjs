import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react-swc';
import {fileURLToPath} from 'node:url';
export default defineConfig({root:fileURLToPath(new URL('../../../',import.meta.url)),base:'./',plugins:[react()],resolve:{alias:[{find:'@/integrations/supabase/client',replacement:fileURLToPath(new URL('./sdk.ts',import.meta.url))},{find:'@',replacement:fileURLToPath(new URL('../../../src',import.meta.url))}]},build:{outDir:fileURLToPath(new URL('../../../../../outputs/e04-effective-review-prototype/compiled-c23-source',import.meta.url)),emptyOutDir:false,rollupOptions:{input:fileURLToPath(new URL('./index.html',import.meta.url))}}});

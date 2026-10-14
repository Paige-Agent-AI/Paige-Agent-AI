// DEV ONLY. Isolated entry; never imported by src or the production build.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const mount=path.dirname(fileURLToPath(import.meta.url)),repo=path.resolve(mount,'../../../..'),fixture=path.join(mount,'weekly-responsibility.fixture.ts');
export default defineConfig({root:mount,publicDir:path.join(repo,'public'),plugins:[react()],cacheDir:path.join(mount,'.weekly-responsibility-cache'),css:{postcss:repo},optimizeDeps:{entries:['weekly-responsibility.html']},resolve:{alias:[
  {find:/^@\/integrations\/supabase\/client$/,replacement:fixture},
  {find:/^@\/hooks\/(useTenantContext|useScopedUserId|usePaigeThreads|useChatDocumentUpload|useTierFeatures)$/,replacement:fixture},
  {find:/^@\/lib\/playbook$/,replacement:fixture},
  {find:'@',replacement:path.join(repo,'src')},
]},define:{'import.meta.env.VITE_SUPABASE_URL':JSON.stringify('https://synthetic.invalid'),'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY':JSON.stringify('not-a-credential')},build:{outDir:path.resolve(repo,'../../outputs/connected-weekly-rendered-review/native-bundle'),emptyOutDir:false,copyPublicDir:false,cssCodeSplit:false,rollupOptions:{input:path.join(mount,'weekly-responsibility.html'),output:{inlineDynamicImports:true}}},server:{host:'127.0.0.1',port:5207,strictPort:true,fs:{allow:[repo]}}});

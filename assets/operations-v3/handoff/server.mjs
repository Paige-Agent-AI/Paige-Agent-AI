import { createServer } from '../operations-implementation/node_modules/vite/dist/node/index.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwind from '../operations-implementation/node_modules/tailwindcss/lib/index.js';
import autoprefixer from '../operations-implementation/node_modules/autoprefixer/lib/autoprefixer.js';
import loadConfig from '../operations-implementation/node_modules/tailwindcss/loadConfig.js';
const root = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(root, process.argv[3] ?? '../operations-implementation');
const tw = loadConfig(path.join(app,'tailwind.config.ts'));
tw.content = [path.join(app,'src/**/*.{ts,tsx}'),path.join(root,'*.tsx')];
const server = await createServer({configFile:false,root,envDir:root,cacheDir:path.join(root,`.vite-${process.argv[2]??8771}`),publicDir:path.join(app,'public'),
  plugins:[{name:'explicit-root-fixture-ports',enforce:'pre',resolveId(source,importer){
    if(source==='@/components/admin/voice/DialPadTrigger'||source.replace(/\\/g,'/').endsWith('/src/components/admin/voice/DialPadTrigger'))return path.join(root,'voice-fixture.tsx');
    const mocks=['@/hooks/useTenantContext','@/hooks/usePlanList','@/solo/useSoloCommercialTerms','@/solo/useSoloAgreementSignings','@/hooks/useKnowledgeDocuments','@/integrations/supabase/client'];
    if(mocks.includes(source)||mocks.some(name=>source.replace(/\\/g,'/').endsWith('/src/'+name.slice(2)))||(source==='./useOperationsPeople'&&importer?.replace(/\\/g,'/').endsWith('/OperationsWorkspace.tsx')))return path.join(root,'root-fixtures.tsx');
  }}],
  esbuild:{jsx:'automatic'},css:{postcss:{plugins:[tailwind(tw),autoprefixer()]}},
  resolve:{alias:{'@':path.join(app,'src'),'react-router-dom':path.join(app,'node_modules/react-router-dom'),'next-themes':path.join(app,'node_modules/next-themes'),react:path.join(app,'node_modules/react'),
    'react-dom':path.join(app,'node_modules/react-dom')},dedupe:['react','react-dom']},
  server:{host:'127.0.0.1',port:Number(process.argv[2]??8771),strictPort:true,fs:{allow:[root,app]}}});
await server.listen();server.printUrls();


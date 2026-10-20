import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const app = process.argv[3] ? path.resolve(process.argv[3]) : path.resolve(root, '../../..');
const require = createRequire(path.join(app, 'package.json'));
const { createServer } = await import(pathToFileURL(path.join(app, 'node_modules/vite/dist/node/index.js')).href);
const tailwind = require('tailwindcss'), autoprefixer = require('autoprefixer'), loadConfig = require('tailwindcss/loadConfig');
const tw = loadConfig(path.join(app,'tailwind.config.ts'));
tw.content = [path.join(app,'src/**/*.{ts,tsx}'),path.join(root,'*.tsx')];
const server = await createServer({configFile:false,root,envDir:root,cacheDir:path.join(root,`.vite-${process.argv[2]??8771}`),publicDir:path.join(app,'public'),
  plugins:[{name:'explicit-root-fixture-ports',enforce:'pre',resolveId(source,importer){
    if(source==='@/components/admin/voice/DialPadTrigger'||source.replace(/\\/g,'/').endsWith('/src/components/admin/voice/DialPadTrigger'))return path.join(root,'voice-fixture.tsx');
    if(source==='@/integrations/supabase/client'||source.replace(/\\/g,'/').endsWith('/src/integrations/supabase/client'))return path.join(root,'root-fixtures.tsx');
  }}],
  esbuild:{jsx:'automatic'},css:{postcss:{plugins:[tailwind(tw),autoprefixer()]}},
  resolve:{alias:{'@':path.join(app,'src'),'react-router-dom':path.join(app,'node_modules/react-router-dom'),'next-themes':path.join(app,'node_modules/next-themes'),react:path.join(app,'node_modules/react'),
    'react-dom':path.join(app,'node_modules/react-dom')},dedupe:['react','react-dom']},
  server:{host:'127.0.0.1',port:Number(process.argv[2]??8771),strictPort:true,fs:{allow:[root,app]}}});
await server.listen();server.printUrls();


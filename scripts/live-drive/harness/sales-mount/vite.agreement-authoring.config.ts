import path from 'node:path';
import base from './vite.config';
const ports = path.resolve(import.meta.dirname, 'agreement-authoring-ports.ts');
export default { ...base,
  plugins: [...base.plugins, { name: 'local-authoring-history', configureServer(server) {
    server.middlewares.use((request, _response, next) => {
      if (request.url?.startsWith('/solo/')) request.url = '/agreement-authoring.html' + (request.url.includes('?') ? request.url.slice(request.url.indexOf('?')) : '');
      next();
    });
  } }],
  resolve: { ...base.resolve, alias: [
    { find: '@/hooks/useTenantContext', replacement: ports },
    { find: './useSoloCommercialTerms', replacement: ports },
    { find: './useSoloAgreementSignings', replacement: ports },
    { find: '@/integrations/supabase/client', replacement: path.resolve(import.meta.dirname, 'agreement-authoring-client.ts') },
    ...base.resolve.alias,
  ] },
  server: { host: '127.0.0.1', port: 5293, strictPort: true, warmup: { clientFiles: [path.resolve(import.meta.dirname, 'agreement-authoring.tsx'), path.resolve(import.meta.dirname, '../../../../src/solo/sales/AgreementPreparationWorkspace.tsx')] } },
};

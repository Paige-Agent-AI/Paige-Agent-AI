import path from 'node:path';
import base from '../operations-release-mount/vite.config';
const ports=path.join(import.meta.dirname,'ports.ts');
export default {...base,root:import.meta.dirname,cacheDir:path.join(import.meta.dirname,'../../../../node_modules/.vite/operations-clean-inspection'),
 resolve:{...base.resolve,alias:base.resolve.alias.map(entry=>({...entry,replacement:entry.replacement.endsWith('stubs.ts')?ports:entry.replacement}))},
 server:{host:'127.0.0.1',port:5187,strictPort:true,fs:{allow:[path.resolve(import.meta.dirname,'../../../..')]}}};

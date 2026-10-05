import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react-swc';
import path from 'node:path';
export default defineConfig({root:import.meta.dirname,plugins:[react()],resolve:{alias:{'@':path.resolve(import.meta.dirname,'../../../../src')}},server:{host:'127.0.0.1',port:5301,strictPort:true,fs:{allow:[path.resolve(import.meta.dirname,'../../../..')]}}});

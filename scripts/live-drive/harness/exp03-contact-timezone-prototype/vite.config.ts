import path from "node:path";
import {defineConfig} from "vite";
import react from "@vitejs/plugin-react-swc";
const repo=path.resolve(import.meta.dirname,"../../../..");
export default defineConfig({root:import.meta.dirname,publicDir:path.join(repo,"public"),cacheDir:path.join(repo,"node_modules/.vite/exp03-contact-timezone-prototype"),css:{postcss:repo},plugins:[react()],resolve:{alias:[{find:/^@\/integrations\/supabase\/client$/,replacement:path.join(import.meta.dirname,"ports.ts")},{find:"@",replacement:path.join(repo,"src")}]},server:{host:"127.0.0.1",port:5273,strictPort:true,fs:{allow:[repo]}}});

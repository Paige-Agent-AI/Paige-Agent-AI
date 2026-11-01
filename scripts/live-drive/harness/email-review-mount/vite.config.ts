import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
const repo = path.resolve(import.meta.dirname,"../../../..");
export default defineConfig({root:import.meta.dirname,plugins:[react()],resolve:{alias:{"@":path.join(repo,"src")}},server:{host:"127.0.0.1",port:5263,strictPort:true}});

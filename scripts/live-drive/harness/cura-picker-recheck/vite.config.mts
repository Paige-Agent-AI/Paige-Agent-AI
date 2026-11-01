import {defineConfig} from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root=path.dirname(fileURLToPath(import.meta.url)),project=path.resolve(root,"../../../..");
export default defineConfig({root,cacheDir:path.join(project,".cache/e09-picker-vite"),publicDir:path.join(project,"public"),
  plugins:[react(),{name:"private-picker-synthetic-ports",enforce:"pre",resolveId(source,importer){
    if(!importer?.replaceAll("\\","/").endsWith("/src/hooks/useCustomerChatAttachments.ts"))return;
    if(source==="./useClientDocuments")return path.join(root,"ports.ts");
    if(source==="./useChatDocumentUpload")return path.join(root,"unused-paste-ports.ts");
  }}],resolve:{alias:{"@":path.join(project,"src")}},css:{postcss:project},
  server:{host:"127.0.0.1",port:4197,strictPort:true,hmr:false,fs:{allow:[project]}}});

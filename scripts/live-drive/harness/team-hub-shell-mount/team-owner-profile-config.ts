import path from "node:path";
import assert from "node:assert/strict";
import {defineConfig} from "vite";
import original from "./vite.config";
const aliases=original.resolve!.alias as {find:RegExp|string;replacement:string}[];
assert(aliases[0].find instanceof RegExp&&aliases[0].find.test("@/integrations/supabase/client"));
export default defineConfig({...original,cacheDir:path.resolve(import.meta.dirname,"../../../../node_modules/.vite/harness-team-owner-profile"),resolve:{...original.resolve,alias:[{...aliases[0],replacement:path.join(import.meta.dirname,"team-owner-profile-supabase-stub.ts")},...aliases.slice(1)]},server:{host:"127.0.0.1",port:0,strictPort:false}});

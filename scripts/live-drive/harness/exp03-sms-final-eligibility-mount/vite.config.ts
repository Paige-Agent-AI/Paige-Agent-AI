import path from "node:path";
import base from "../exp03-composer-inline-check-mount/vite.config";
export default {...base,root:import.meta.dirname,cacheDir:path.resolve(import.meta.dirname,"../../../../node_modules/.vite/exp03-sms-final-eligibility"),
resolve:{...base.resolve,alias:base.resolve!.alias!.map(e=>e.replacement.endsWith("stubs.ts")?{...e,replacement:path.join(import.meta.dirname,"stubs.ts")}:e)},
server:{...base.server,port:5256}};

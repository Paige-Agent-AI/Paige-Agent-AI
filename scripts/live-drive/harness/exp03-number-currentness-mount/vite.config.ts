import path from "node:path";
import base from "../exp03-calling-authority-mount/vite.config";
export default {...base,root:import.meta.dirname,cacheDir:path.resolve(import.meta.dirname,"../../../../node_modules/.vite/exp03-number-currentness"),resolve:{...base.resolve,alias:base.resolve!.alias!.map(entry=>entry.replacement.endsWith("stubs.ts")?{...entry,replacement:path.join(import.meta.dirname,"stubs.ts")}:entry)},server:{...base.server,port:5274}};

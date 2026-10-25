// Node's application type pass traverses the existing direct Edge helper tests.
// Resolve the two Deno specifiers to the installed API types there. Actual pinned
// runtime dependencies and parser behavior are separately type-checked/run by Deno.
// No runtime alias, permissive `any` declaration or type-check suppression.
declare module "npm:fflate@0.8.2" {
  export {Inflate} from "fflate";
}
declare module "npm:@xmldom/xmldom@0.8.15" {
  export {DOMParser} from "@xmldom/xmldom";
}

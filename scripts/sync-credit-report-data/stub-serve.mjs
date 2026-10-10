/**
 * Stands in for Deno std `serve`. Captures the handler instead of binding a port,
 * so a check can invoke the REAL request handler directly with a crafted Request.
 * Identical contract to scripts/apply-extraction/stub-serve.mjs.
 */
let captured = null;
export function serve(handler) {
  captured = handler;
  return { finished: Promise.resolve() };
}
export function capturedHandler() {
  if (!captured) throw new Error("stub-serve: the module under test never called serve()");
  return captured;
}

import { afterAll, afterEach, expect } from "vitest";

// Keep these outside vi.stubGlobal: unstubAllGlobals/restoreAllMocks must restore
// the blocked defaults, not Node's real transports. Tests can still supply doubles.
const attempts: string[] = [];
function forbidden(transport: string): never {
  // Deliberately omit URL/header/body: failed tests must not print credentials or data.
  attempts.push(transport);
  throw new Error(`UNIT_NETWORK_FORBIDDEN:${transport}: supply an explicit test double`);
}

globalThis.fetch = (() => forbidden("fetch")) as typeof fetch;
Object.defineProperty(globalThis, "WebSocket", {
  configurable: true,
  writable: true,
  value: class {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    constructor() { forbidden("WebSocket"); }
  },
});

function assertNoEscape() {
  // A consumer may catch a transport error. That does not make its test hermetic.
  // Do not reset on beforeEach: import-time and late asynchronous attempts count too.
  expect(attempts, "UNIT_NETWORK_FORBIDDEN: unmocked transport attempted; Release/CI owns isolation, the named test owner supplies its double").toEqual([]);
}
afterEach(assertNoEscape);
afterAll(assertNoEscape);

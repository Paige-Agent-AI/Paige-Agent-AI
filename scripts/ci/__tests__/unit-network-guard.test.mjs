import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repo = realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.."));
const fixtureParent = realpathSync(path.join(repo, "scripts/ci"));
const vitest = path.join(repo, "node_modules/vitest/vitest.mjs");
const cases = {
  "caught-fetch": `it('caught fetch', async () => { try { await fetch('https://fixture.invalid'); } catch {} expect(true).toBe(true); });`,
  "caught-websocket": `it('caught socket', () => { try { new WebSocket('wss://fixture.invalid'); } catch {} expect(true).toBe(true); });`,
  "import-time": `try { await fetch('https://fixture.invalid'); } catch {} it('import succeeds', () => { expect(true).toBe(true); });`,
  "unstub-restoration": `it('double', async () => { vi.stubGlobal('fetch', vi.fn(async () => 'double')); expect(await fetch('https://fixture.invalid')).toBe('double'); vi.unstubAllGlobals(); }); it('restored default', async () => { try { await fetch('https://fixture.invalid'); } catch {} expect(true).toBe(true); });`,
  "spy-restoration": `it('spy double', () => { vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve('double')); vi.restoreAllMocks(); }); it('restored default', async () => { try { await fetch('https://fixture.invalid'); } catch {} expect(true).toBe(true); });`,
  "socket-restoration": `it('socket double', () => { vi.stubGlobal('WebSocket', class {}); new WebSocket('wss://fixture.invalid'); vi.unstubAllGlobals(); }); it('restored default', () => { try { new WebSocket('wss://fixture.invalid'); } catch {} expect(true).toBe(true); });`,
};

function runFixture(source, guarded) {
  const dir = mkdtempSync(path.join(fixtureParent, ".unit-network-proof-"));
  const relative = path.relative(repo, dir).split(path.sep).join('/');
  try {
    // Both modes replace native transports BEFORE any test imports. Even the
    // failing-first baseline cannot contact a real endpoint.
    writeFileSync(path.join(dir, "native.ts"), `globalThis.fetch = (() => { throw new Error('FAKE_NATIVE_FETCH'); }) as typeof fetch; Object.defineProperty(globalThis, 'WebSocket', { configurable: true, writable: true, value: class { constructor() { throw new Error('FAKE_NATIVE_SOCKET'); } } });`);
    writeFileSync(path.join(dir, "fixture.test.ts"), `import { it, expect, vi } from 'vitest';\n${source}\n`);
    writeFileSync(path.join(dir, "config.ts"), `import base from '../../../vitest.config.ts'; export default { ...base, test: { ...base.test, setupFiles: [${JSON.stringify(`${relative}/native.ts`)}${guarded ? ", ...(base.test?.setupFiles ?? [])" : ""}], include: [${JSON.stringify(`${relative}/fixture.test.ts`)}] } };`);
    const result = spawnSync(process.execPath, [vitest, "run", "--config", path.join(dir, "config.ts"), "--maxWorkers", "1", "--no-file-parallelism"], { cwd: repo, encoding: "utf8", timeout: 45000, windowsHide: true });
    assert.ifError(result.error);
    return { status: result.status, output: `${result.stdout ?? ''}\n${result.stderr ?? ''}` };
  } finally {
    const resolved = realpathSync(dir);
    assert.equal(path.dirname(resolved), fixtureParent, "cleanup stays in the verified fixture parent");
    assert.ok(path.basename(resolved).startsWith('.unit-network-proof-'));
    rmSync(resolved, { recursive: true, force: true });
  }
}

for (const [name, source] of Object.entries(cases)) {
  test(`${name}: baseline silently passes; candidate fails closed`, () => {
    const baseline = runFixture(source, false);
    assert.equal(baseline.status, 0, "safe fake-native baseline must reproduce the missing enforcement");
    assert.match(baseline.output, /passed/);
    const candidate = runFixture(source, true);
    assert.notEqual(candidate.status, 0, "caught transport attempts must make Vitest fail");
    assert.match(candidate.output, /UNIT_NETWORK_FORBIDDEN/);
  });
}

test("explicit fetch and WebSocket doubles remain usable", () => {
  const result = runFixture(`it('explicit doubles', async () => { vi.stubGlobal('fetch', vi.fn(async () => 'double')); vi.stubGlobal('WebSocket', class { readyState = 1; }); expect(await fetch('https://fixture.invalid')).toBe('double'); expect(new WebSocket('wss://fixture.invalid').readyState).toBe(1); vi.unstubAllGlobals(); });`, true);
  assert.equal(result.status, 0, "explicit doubles must pass the actual guarded setup");
  assert.match(result.output, /passed/);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { isProofDescendant } from './e09-proof-path.mjs';

test('POSIX root ancestor permits the normalized isolated proof directory', () => {
  assert.equal(isProofDescendant('/', '/work/e09-invite-proof', path.posix), true);
  assert.equal(isProofDescendant('/repo', '/repo/work/proof', path.posix), true);
});
test('POSIX equal, parent traversal and shared-prefix siblings are refused', () => {
  for (const target of ['/repo', '/repo/../outside', '/repository/proof']) {
    assert.equal(isProofDescendant('/repo', target, path.posix), false, target);
  }
});
test('Windows descendants work while different drives and sibling prefixes refuse', () => {
  assert.equal(isProofDescendant('C:\\task', 'C:\\task\\work\\proof', path.win32), true);
  assert.equal(isProofDescendant('C:\\', 'C:\\work\\proof', path.win32), true);
  for (const target of ['C:\\task', 'C:\\task\\..\\outside', 'C:\\task-other\\proof', 'D:\\task\\proof']) {
    assert.equal(isProofDescendant('C:\\task', target, path.win32), false, target);
  }
});

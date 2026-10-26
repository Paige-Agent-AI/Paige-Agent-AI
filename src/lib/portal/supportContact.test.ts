import { describe, expect, it } from 'vitest';
import { normalizePortalSupportEmail, portalSupportHref } from './supportContact';
describe('Public business support contact links',()=>{
 it('normalizes the saved address and encodes a recipient without sending',()=>{
  expect(normalizePortalSupportEmail(' care+portal@northwind.example ')).toBe('care+portal@northwind.example');
  expect(portalSupportHref('care+portal@northwind.example')).toBe('mailto:care%2Bportal%40northwind.example');
 });
 it.each([null,undefined,42,{},'', 'a@example.com\r\nBcc:private@example.com', 'a@example.com?subject=other', 'a@example.com,b@example.com','a..b@example.com','support@paigeagent.ai','Privacy@PaigeAgent.ai','no-reply@mail.paigeagent.ai','x'.repeat(250)+'@example.com'])('withholds unsafe/platform contact %j',value=>{
  expect(normalizePortalSupportEmail(value)).toBeNull();expect(portalSupportHref(value)).toBeNull();
 });
});

import {beforeEach, expect, it, vi} from "vitest";
import {clientPortalEntry, rememberClientPortalBusiness, clientPortalBusinessHref, CLIENT_PORTAL_CHOOSE_HREF} from "./client-portal-entry";
const a = "e0915000-0000-0000-0000-000000000001", b = "e0915000-0000-0000-0000-000000000002";
beforeEach(() => sessionStorage.clear());
it("stores only an opaque actor-keyed per-tab business hint", () => {
  rememberClientPortalBusiness(a, b);
  expect(Object.entries(sessionStorage)).toEqual([[`client-portal-business:${a}`, b]]);
  expect(clientPortalEntry(a, "").businessId).toBe(b);
  expect(clientPortalEntry(b, "").businessId).toBeNull();
  expect(clientPortalEntry(null, "").businessId).toBeNull();
});
it("explicit valid entry overrides the saved hint without writing it", () => {
  rememberClientPortalBusiness(a, b);
  expect(clientPortalEntry(a, `?business=${a}`)).toEqual({businessId: a, choose: false, invalid: false, intentional: true});
  expect(clientPortalEntry(a, "").businessId).toBe(b);
  expect(clientPortalEntry(a, "?chooseBusiness=1")).toEqual({businessId: null, choose: true, invalid: false, intentional: true});
});
it.each(["?business=", "?business=owner", `?business=${a}&business=${b}`, `?business=${a}&chooseBusiness=1`, "?chooseBusiness=0", "?chooseBusiness=1&chooseBusiness=1"])("invalid explicit intent %s never falls back to a saved business", search => {
  rememberClientPortalBusiness(a, b);
  expect(clientPortalEntry(a, search)).toEqual({businessId: null, choose: false, invalid: true, intentional: true});
});
it("ignores malformed stored hints and unrelated shell query parameters", () => {
  sessionStorage.setItem(`client-portal-business:${a}`, "staff");
  expect(clientPortalEntry(a, "?stay=1")).toEqual({businessId: null, choose: false, invalid: false, intentional: false});
  expect(clientPortalBusinessHref(b)).toBe(`/app?business=${b}`);
  expect(CLIENT_PORTAL_CHOOSE_HREF).toBe("/app?chooseBusiness=1");
  expect(() => clientPortalBusinessHref("/admin")).toThrow();
  rememberClientPortalBusiness("staff", a); expect(sessionStorage.length).toBe(1);
});
it("optional storage failures do not prevent explicit entry", () => {
  const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {throw new Error("disabled");});
  expect(clientPortalEntry(a, "").businessId).toBeNull();
  expect(clientPortalEntry(a, `?business=${b}`).businessId).toBe(b); get.mockRestore();
  const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {throw new Error("disabled");});
  expect(() => rememberClientPortalBusiness(a, b)).not.toThrow(); set.mockRestore();
});

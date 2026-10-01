import { describe, expect, it } from "vitest";
import {
  UnavailableSecureBrowserWorker,
  assertNoSensitiveBrowserMaterial,
  normalizeSecureBrowserTarget,
  normalizeSecureBrowserPurpose,
  validateSecureBrowserScope,
} from "../../supabase/functions/_shared/secure-browser-contract";

const safeScope = {
  mode: "read_only",
  allowedOrigins: ["https://example.com/account"],
  allowedReadKinds: ["status", "date"],
  downloads: "quarantine_only",
  consequentialActions: "disabled",
} as const;

describe("Paige Secure Browser provider-neutral contract", () => {
  it("normalizes a public HTTPS target to origin-only metadata", () => {
    expect(normalizeSecureBrowserTarget("https://Example.com/private?token=not-retained")).toEqual({
      origin: "https://example.com",
      displayHost: "example.com",
    });
  });

  it("rejects local, insecure, and credential-bearing targets", () => {
    expect(() => normalizeSecureBrowserTarget("http://example.com")).toThrow("https");
    expect(() => normalizeSecureBrowserTarget("https://localhost")).toThrow("public");
    expect(() => normalizeSecureBrowserTarget("https://user:pass@example.com")).toThrow("credentials");
  });

  it("keeps the MVP read-only and quarantine-only", () => {
    expect(validateSecureBrowserScope(safeScope)).toEqual({
      ...safeScope,
      allowedOrigins: ["https://example.com"],
    });
    expect(() => validateSecureBrowserScope({ ...safeScope, consequentialActions: "enabled" })).toThrow("action_execution_disabled");
  });

  it("rejects recursively nested sensitive material", () => {
    expect(() => assertNoSensitiveBrowserMaterial({ result: { cookie: "redacted" } })).toThrow("sensitive_field");
    expect(() => assertNoSensitiveBrowserMaterial({ status: "not connected" })).not.toThrow();
    expect(() => assertNoSensitiveBrowserMaterial({ note: "access token: abcdefghijk" })).toThrow("sensitive_value");
    expect(() => assertNoSensitiveBrowserMaterial({ notes: ["token: abcdefghijk"] })).toThrow("sensitive_value");
  });

  it("refuses credential-like purpose values before persistence", () => {
    expect(normalizeSecureBrowserPurpose("Review quarterly filing status")).toBe("Review quarterly filing status");
    expect(() => normalizeSecureBrowserPurpose("Sign in, password: hunter123"))
      .toThrow("sensitive_value");
    expect(() => normalizeSecureBrowserPurpose("Use bearer abcdefghijklmnop"))
      .toThrow("sensitive_value");
    expect(() => normalizeSecureBrowserPurpose("Use eyJabcdefghij.abcdefghij.abcdefghij"))
      .toThrow("sensitive_value");
    expect(() => normalizeSecureBrowserPurpose("Use client secret: abcdefghijk"))
      .toThrow("sensitive_value");
  });

  it("returns truthful unavailability without creating a worker session", async () => {
    const worker = new UnavailableSecureBrowserWorker();
    await expect(worker.openSession()).resolves.toEqual({
      ok: false,
      session: null,
      status: "unavailable",
      reason: "worker_under_setup",
    });
    await expect(worker.captureDownload()).resolves.toEqual({
      ok: false,
      reason: "download_unavailable",
    });
  });
});

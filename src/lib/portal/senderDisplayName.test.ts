import { describe, expect, it } from "vitest";
import { senderDisplayName } from "../../../supabase/functions/_shared/email/sender-display-name";

// Round 2 (compliance #2): send-message fell back to "Paige Agent" as the From name of a business's email to its
// own client. The client hears from the business; with nothing configured, the business's own name.
describe("senderDisplayName", () => {
  it("keeps the configured sender name first", () => {
    expect(senderDisplayName({ fromName: "Northwind Studio Team", tenantName: "Northwind Studio", platformDefault: "X" })).toBe("Northwind Studio Team");
  });
  it("falls back to the business's own name, before any platform default", () => {
    expect(senderDisplayName({ fromName: null, tenantName: "  Northwind Studio ", platformDefault: "Platform Mail" })).toBe("Northwind Studio");
  });
  it("uses the platform's configured default only when no business name resolved, and never invents one", () => {
    expect(senderDisplayName({ fromName: "", tenantName: null, platformDefault: "Platform Mail" })).toBe("Platform Mail");
    expect(senderDisplayName({ fromName: null, tenantName: null, platformDefault: null })).toBeNull();
  });
  it("never names PAIGE by itself", () => {
    expect(String(senderDisplayName({ fromName: null, tenantName: null, platformDefault: undefined }))).not.toMatch(/paige/i);
  });
});

import { describe, it, expect } from "vitest";
import { isZapierMcpAddress, ZAPIER_MCP_URL } from "../../supabase/functions/_shared/zapier-mcp-address";

describe("Zapier MCP address", () => {
  // The address Zapier hands out TODAY: /api/v1/connect, OAuth, and the copy-to-clipboard
  // form carries a query string. github.com/zapier/zapier-mcp documents this exact URL.
  const current = "https://mcp.zapier.com/api/v1/connect";
  // The legacy shape, still valid for servers created before the move. Secret in the path.
  const good = "https://mcp.zapier.com/api/mcp/s/ABC123xyz/mcp";

  it("accepts the address Zapier issues today", () =>
    expect(isZapierMcpAddress(current)).toBe(true));
  it("accepts it with the query Zapier's copy button appends (the reported failure)", () => {
    // Owner-reported: pasting this left the button dead on "Remove everything from the ?".
    // Nothing downstream is harmed -- the well-known URL is built from origin + pathname,
    // and the RFC 8707 resource indicator comes from Zapier's metadata, not this string.
    expect(isZapierMcpAddress(current + "?t=abc123")).toBe(true);
  });
  it("still accepts the legacy server address", () => expect(isZapierMcpAddress(good)).toBe(true));
  it("accepts one pasted with surrounding whitespace (the reported failure)", () => {
    const pasted = "  " + good + "\n";
    expect(isZapierMcpAddress(pasted)).toBe(true);
  });
  it("accepts a capitalised host", () => {
    const caps = "https://MCP.ZAPIER.COM/api/mcp/s/ABC123xyz/mcp";
    expect(isZapierMcpAddress(caps)).toBe(true);
  });
  it("rejects a non-Zapier host", () =>
    expect(isZapierMcpAddress("https://example.com/api/mcp/s/x/mcp")).toBe(false));
  it("rejects a Zapier link that is not an MCP server", () =>
    expect(isZapierMcpAddress("https://mcp.zapier.com/app/editor")).toBe(false));
  it("rejects junk", () => expect(isZapierMcpAddress("mcp server")).toBe(false));
  it("rejects a fragment, which is never sent to a server", () =>
    expect(isZapierMcpAddress(good + "#frag")).toBe(false));
  it("rejects an explicit empty address", () => expect(isZapierMcpAddress("   ")).toBe(false));
  it("pins the credential-free default to the documented shared MCP resource", () => {
    expect(ZAPIER_MCP_URL).toBe(current);
    expect(isZapierMcpAddress(ZAPIER_MCP_URL)).toBe(true);
  });
  it.each(["http://mcp.zapier.com/api/v1/connect", "https://name:password@mcp.zapier.com/api/v1/connect", "https://mcp.zapier.com.foreign.example/api/v1/connect"])("rejects an insecure or credential-bearing destination %s", value=>expect(isZapierMcpAddress(value)).toBe(false));
});

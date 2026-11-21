// Zapier's documented shared MCP endpoint. It contains no customer credential.
export const ZAPIER_MCP_URL = "https://mcp.zapier.com/api/v1/connect";

// Preserve address-bearing deployed callers and existing legacy server addresses.
// New Solo callers need no address field; the original edge writer supplies the default.
export function isZapierMcpAddress(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "mcp.zapier.com"
      && !url.username && !url.password && !url.hash
      && (url.pathname.startsWith("/api/v1/") || url.pathname.startsWith("/api/mcp/"));
  } catch { return false; }
}

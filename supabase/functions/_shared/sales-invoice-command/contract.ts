export const SALES_INVOICE_ACTIONS = {
  "invoice.publish": "sales_publish_invoice",
  "invoice.record_manual_payment": "sales_record_manual_payment",
  "invoice.reverse_manual_payment": "sales_reverse_manual_payment",
  "invoice.void": "sales_void_invoice",
  "invoice.link_create": "sales_create_invoice_link",
  "invoice.email_send": "billing_send_invoice",
  "invoice.sms_send": "billing_send_invoice",
} as const;

export type SalesInvoiceAction = keyof typeof SALES_INVOICE_ACTIONS;
export type SalesInvoiceCommand = Record<string, unknown> & {
  action: SalesInvoiceAction; invoice_id: string; expected_version: number;
};
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const FINGERPRINT = /^[0-9a-f]{16}$/;

/** Browser/model input never includes the governance stamp or generated access token. */
export function parseSalesInvoiceCommand(value: unknown): SalesInvoiceCommand {
  const invalid = (): never => { throw new TypeError("SALES_INVOICE_COMMAND_INVALID"); };
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  const v = value as Record<string, unknown>;
  if (typeof v.action !== "string" || !Object.prototype.hasOwnProperty.call(SALES_INVOICE_ACTIONS, v.action)) return invalid();
  const action = v.action as SalesInvoiceAction;
  if (typeof v.invoice_id !== "string" || !UUID.test(v.invoice_id) || !Number.isSafeInteger(v.expected_version) || (v.expected_version as number) < 1) return invalid();
  const out: SalesInvoiceCommand = { action, invoice_id: v.invoice_id.toLowerCase(), expected_version: v.expected_version as number };
  const allowed = new Set(["action", "invoice_id", "expected_version"]);
  const text = (key: string, max: number, required = false): string | null => {
    allowed.add(key);
    const item = v[key];
    if (item === undefined || item === null) return required ? invalid() : null;
    if (typeof item !== "string" || item.length > max || (required && !item.trim())) return invalid();
    return item;
  };
  if (action === "invoice.email_send" || action === "invoice.sms_send") {
    allowed.add("connector_id");
    if (action === "invoice.sms_send" && v.connector_id !== undefined && v.connector_id !== null) return invalid();
    if (action === "invoice.sms_send" && (v.connector_id === undefined || v.connector_id === null)) {
      out.connector_id = null;
    } else {
      if (typeof v.connector_id !== "string" || !UUID.test(v.connector_id)) return invalid();
      out.connector_id = v.connector_id.toLowerCase();
    }
  } else if (action === "invoice.record_manual_payment") {
    for (const key of ["amount_cents", "currency", "method", "received_at"]) allowed.add(key);
    if (!Number.isSafeInteger(v.amount_cents) || (v.amount_cents as number) <= 0 || (v.amount_cents as number) > 2147483647 || v.currency !== "usd") return invalid();
    if (typeof v.method !== "string" || !["zelle", "cash", "wire", "check", "bank_transfer", "other"].includes(v.method)) return invalid();
    if (typeof v.received_at !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(v.received_at) || !Number.isFinite(Date.parse(v.received_at))) return invalid();
    const receivedAt = new Date(v.received_at).toISOString();
    if (receivedAt.slice(0, 19) !== v.received_at.slice(0, 19)) return invalid();
    Object.assign(out, { amount_cents: v.amount_cents, currency: "usd", method: v.method, received_at: receivedAt, reference: text("reference", 200), notes: text("notes", 2000) });
  } else if (action === "invoice.reverse_manual_payment") {
    allowed.add("payment_id");
    if (typeof v.payment_id !== "string" || !UUID.test(v.payment_id)) return invalid();
    Object.assign(out, { payment_id: v.payment_id.toLowerCase(), reason: text("reason", 500, true) });
  } else if (action === "invoice.void") {
    out.reason = text("reason", 500, true);
  } else if (action === "invoice.link_create") {
    allowed.add("expires_in_days"); allowed.add("grant_scope");
    if (!Number.isInteger(v.expires_in_days) || (v.expires_in_days as number) < 1 || (v.expires_in_days as number) > 30 || (v.grant_scope !== undefined && v.grant_scope !== "share")) return invalid();
    Object.assign(out, { expires_in_days: v.expires_in_days, grant_scope: "share" });
  }
  if (Object.keys(v).some(key => !allowed.has(key))) return invalid();
  return out;
}

// Portal message body rules (E09) — the ONE home both sides of the customer <-> business thread
// count against. client_portal_send_message and comms_portal_reply accept 1..4000 characters after
// trimming, and Postgres length() counts Unicode code points while a JS string's .length counts
// UTF-16 units (an emoji is 1 to the server and 2 to .length). Counting code points here keeps the
// composers from refusing messages the server accepts.

/** Most characters a portal message may carry, as the server counts them. */
export const PORTAL_MESSAGE_MAX = 4000;

/** Characters in the trimmed body, counted the way the server counts them. */
export const portalBodyLength = (body: string): number => Array.from(body.trim()).length;

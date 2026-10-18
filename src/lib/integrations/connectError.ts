/**
 * connectError — the ONE home (§18) for turning a `supabase.functions.invoke()`
 * failure into an honest, friendly, code-aware message for a tenant.
 *
 * WHY THIS EXISTS (Cowork #156): `supabase.functions.invoke()` returns
 * `{ data, error }`. On a NON-2xx response the framework sets `data = null` and
 * `error` to a `FunctionsHttpError` whose `.context` is the raw `Response` — the
 * honest JSON body (e.g. `{ error: "gmail_oauth_not_configured" }`) lives INSIDE
 * that Response, not on `data`. Call sites that read the code from `data` only
 * therefore miss it on a non-2xx and fall through to `error.message`, which is the
 * raw framework string "Edge Function returned a non-2xx status code" — jargon a
 * coach should NEVER see (§3/§13/§36). This helper reads the code from BOTH shapes
 * (2xx-with-error on `data`, and non-2xx from the Response body), maps known codes
 * to plain-English copy, and ALWAYS falls back to a friendly line — never the raw
 * message.
 *
 * PURE + framework-agnostic: it returns `{ code, message }` and shows nothing
 * itself. The caller decides toast vs. inline note (a needs-config state is an
 * honest inline note, not a red error scream — §13/§36).
 */

export interface ResolvedFunctionError {
  /** The honest machine code we extracted, or null when none was present. */
  code: string | null;
  /** Coach-readable, one-read copy (§36). Never the raw framework message (§13). */
  message: string;
}

/**
 * A short human phrase naming what the tenant was trying to do, e.g.
 * "connect Gmail", "disconnect Zoom", "connect your SMTP server". It drives the
 * generic-fallback and permission copy so they read naturally for connect AND
 * disconnect alike. No jargon (§3) — say "connect"/"sign in", never "OAuth".
 */
type ActionPhrase = string;

// ---------------------------------------------------------------------------
// Code → copy map. Provider-specific "not switched on yet" lines are keyed by the
// EXACT code each edge function emits (verified against source, not guessed):
//   gmail-oauth-start           → "gmail_oauth_not_configured"          (500)
//   google-calendar-oauth-start → "google_oauth_not_configured"         (500)
//   zoom-oauth-start            → "zoom_oauth_not_configured"           (500)
// smtp-connect's failure codes are folded in so SMTP shares this one home too.
// ---------------------------------------------------------------------------

// Honest "not switched on yet" copy — a needs-config state is NOT an error scream.
const NOT_CONFIGURED_COPY: Record<string, string> = {
  gmail_oauth_not_configured:
    "Gmail sign-in isn’t switched on yet — it needs a quick verification step before it goes live. You can verify a sending domain to start sending today, or check back shortly.",
  google_oauth_not_configured:
    "Google Calendar sign-in isn’t switched on yet — it needs a quick verification step before it goes live. Check back shortly and we’ll have it ready.",
  // Defensive aliases (§13): the calendar function currently emits
  // "google_oauth_not_configured", but tolerate these adjacent spellings so a
  // future rename can't silently leak the raw framework message.
  google_calendar_oauth_not_configured:
    "Google Calendar sign-in isn’t switched on yet — it needs a quick verification step before it goes live. Check back shortly and we’ll have it ready.",
  gcal_oauth_not_configured:
    "Google Calendar sign-in isn’t switched on yet — it needs a quick verification step before it goes live. Check back shortly and we’ll have it ready.",
  zoom_oauth_not_configured:
    "Zoom sign-in isn’t switched on yet — it needs a quick verification step before it goes live. Check back shortly and we’ll have it ready.",
};

// SMTP reachability / credential codes (from smtp-connect) — honest, specific copy.
const SMTP_COPY: Record<string, string> = {
  smtp_host_not_allowed:
    "That host or port isn’t allowed. Use your provider’s public mail server (ports 465, 587, 25, or 2525) — internal addresses are blocked for safety.",
  smtp_port_not_allowed: "Use a standard mail port: 465, 587, 25, or 2525.",
  smtp_host_invalid: "That server address doesn’t look right — check it and try again.",
  smtp_host_unresolvable: "We couldn’t find that mail server. Double-check the host name.",
  smtp_host_unreachable: "We couldn’t reach that mail server on that port. Check the host and port.",
  smtp_connect_failed: "We couldn’t reach that mail server. Check the host, port, and login, then try again.",
  invalid_from_address: "Enter a valid from-address (e.g. you@yourdomain.com).",
  missing_fields: "Fill in the server, port, username, password, and from-address.",
  invalid_json: "Something went wrong sending your details. Please try again.",
  no_tenant_for_user: "Your account isn’t attached to a workspace yet.",
  vault_write_failed: "We couldn’t securely store your credentials just now. Try again in a moment.",
  connector_update_failed: "We couldn’t save that connection just now. Try again in a moment.",
  connector_insert_failed: "We couldn’t save that connection just now. Try again in a moment.",
};

// Numbers and carrier registration. These codes are the whole reason the server
// bothers to emit a stable code instead of a sentence — each one has a DIFFERENT
// thing the person should do next, and the generic "please try again in a moment"
// is wrong for every one of them. Two are actively harmful:
//
//   • `number_unavailable` — retrying is the one thing that will never work.
//   • `number_bought_but_record_failed` — the number WAS bought and IS being billed;
//     telling someone it didn't complete invites a second purchase of a second number.
//
// `LEGAL_PROFILE_REQUIRED` is the default state of every workspace that has not
// filled in its business profile, so without it the commonest outcome of pressing
// "Draft with Paige" was an instruction to try again, forever.
const COMMS_COPY: Record<string, string> = {
  domain_operation_unconfirmed:
    "That sending-domain change may have started. Don’t repeat it. Open the workspace where you started, refresh the current sending-domain state, and confirm the original outcome before continuing.",
  number_unavailable:
    "That number was taken while you were looking at it. Search again and pick another — this one won’t come back.",
  twilio_subaccount_not_provisioned:
    "This business doesn’t have a messaging account yet, so there’s nothing to buy a number into.",
  inbound_webhook_secret_missing:
    "Messaging isn’t finished being set up for this business yet, so a number can’t be attached safely.",
  number_bought_but_record_failed:
    "The number was bought and you are being billed for it, but we couldn’t attach it to this business. Don’t buy another — tell us and we’ll attach this one.",
  // Only reachable once a lane SENDS the amount it displayed. Both are the server
  // refusing to charge a price the person was not shown — the good outcome, but only
  // if the copy says what happened, or "buy" just looks broken.
  price_changed:
    "That number’s price changed while you were looking at it, so nothing was bought. Search again to see what it costs now.",
  price_unverifiable:
    "We couldn’t confirm this number’s price, so nothing was bought. Try again shortly — no charge was made.",
  phone_number_required: "Pick a number from the search results first.",
  LEGAL_PROFILE_REQUIRED:
    "Carriers need your legal business name before a registration can be prepared. Add it in Setup, then come back.",
  MISSING_LEGAL_NAME:
    "Carriers need your legal business name before a registration can be saved. Add it in Setup, then come back.",
  MISSING_USE_CASE: "Say what you use texting for — carriers read that line.",
  MISSING_DESCRIPTION: "The description carriers read can’t be empty.",
  MISSING_SAMPLES: "Include at least one real sample message — carriers check them.",
  // The two RPCs raise UPPERCASE hints and `PERMISSION_CODES` holds only lowercase
  // "forbidden", so a permanent authorization refusal fell through to "try again in a
  // moment" — advice that will never work. Reachable, not theoretical: the buttons gate on
  // `is_current_user_tenant_admin` while the RPC requires a GLOBAL admin/coach row, so a
  // tenant admin without one sees the control, clicks, and is told to retry.
  FORBIDDEN: "You don’t have permission to change this business’s numbers — ask a workspace admin.",
  NUMBER_ID_REQUIRED: "We couldn’t tell which number you meant. Reload and try again.",
  NUMBER_NOT_FOUND: "We couldn’t find that number on this business.",
  NUMBER_NOT_ACTIVE: "That number isn’t active, so it can’t be the one you send from.",
  NAME_TOO_LONG: "That name is too long — keep it under 120 characters.",
  NO_TENANT: "We couldn’t tell which business you’re in.",
  TENANT_MISMATCH: "That number belongs to a different business.",
  TENANT_REQUIRED: "We couldn’t tell which business this is for.",
  REGISTRATION_IMMUTABLE:
    "This registration has moved past preparation, so its wording is locked. Changes now go through the carrier.",
};

/** Codes that mean "you lack the role to do this". */
const PERMISSION_CODES = new Set(["unauthorized", "forbidden"]);

/**
 * Pull the honest JSON BODY out of an invoke() result, handling BOTH shapes:
 *  (a) 2xx-with-error: the code sits on `data.error`.
 *  (b) non-2xx: `data` is null and the code is in the `FunctionsHttpError`'s
 *      `.context` Response body — read it with a guarded `.json()`.
 * Also tolerates `.context` already being a parsed object (version differences).
 *
 * The BODY rather than one field, because a function that answers
 * `{ error: "write_failed", code: "MCP_FORBIDDEN" }` puts the part a caller needs in the
 * second key, and a reader that only ever returned `error` made those callers unreachable
 * on exactly the responses they were written for.
 */
export async function readFunctionErrorBody(
  error: unknown,
  data: unknown,
): Promise<Record<string, unknown> | null> {
  // Shape (a): a JSON body was returned on a 2xx (or the client parsed it onto data).
  // `error` may be a bare code string OR a structured `{ code, message }` — both are
  // shapes functions in this repo actually return, and accepting only the string one
  // made every structured refusal look like no body at all.
  if (data && typeof data === "object") {
    const err = (data as Record<string, unknown>).error;
    if (typeof err === "string" || (err && typeof err === "object" && !Array.isArray(err))) {
      return data as Record<string, unknown>;
    }
  }

  // Shape (b): non-2xx → the body lives on FunctionsHttpError.context (the Response).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const context = (error as any)?.context;
  if (!context) return null;

  // Prefer a duck-typed check over `instanceof Response` — instanceof is brittle
  // across the esm.sh / bundler boundary. If .json exists, it's Response-like.
  if (typeof context.json === "function") {
    try {
      const body = await context.json();
      return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
    } catch {
      // Non-JSON body (HTML error page, empty, already-consumed) — do NOT throw.
      return null;
    }
  }

  // Some versions expose an already-parsed object on .context.
  if (typeof context === "object") return context as Record<string, unknown>;

  return null;
}

async function extractCode(error: unknown, data: unknown): Promise<string | null> {
  const body = await readFunctionErrorBody(error, data);
  const raw = body?.error;
  if (typeof raw === "string") return raw.length > 0 ? raw : null;
  // TWO SHAPES, both real. Most functions answer `{ error: "some_code" }`, but the
  // A2P pair answers `{ error: { code, message } }` — a structured error their own
  // headers document. Reading only the string form meant every structured refusal
  // arrived here as "no code" and fell to the generic try-again line, including
  // LEGAL_PROFILE_REQUIRED, which is the state of a workspace that has not filled in
  // its business profile — that is, the commonest one. The server named the problem
  // precisely and we threw the name away.
  const nested = (raw && typeof raw === "object" && !Array.isArray(raw))
    ? (raw as { code?: unknown }).code
    : null;
  return typeof nested === "string" && nested.length > 0 ? nested : null;
}

/**
 * Turn a `supabase.functions.invoke()` failure into `{ code, message }`.
 *
 * @param args.error  the `error` returned by invoke() (a FunctionsHttpError on non-2xx)
 * @param args.data   the `data` returned by invoke() (carries `.error` on a 2xx-with-error)
 * @param args.action a short verb phrase, e.g. "connect Gmail" / "disconnect Zoom",
 *                    used only for the generic + permission fallbacks so they read
 *                    naturally. No jargon (§3).
 */
export async function resolveFunctionError(args: {
  error: unknown;
  data: unknown;
  action: ActionPhrase;
}): Promise<ResolvedFunctionError> {
  const { error, data, action } = args;
  const code = await extractCode(error, data);

  // Keep the real reason for support, but NEVER surface it to the tenant (§13).
  if (code) {
    console.debug(`[connectError] ${action} failed with code:`, code);
  } else if (error) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    console.debug(`[connectError] ${action} failed:`, (error as any)?.message ?? error);
  }

  if (code && NOT_CONFIGURED_COPY[code]) {
    return { code, message: NOT_CONFIGURED_COPY[code] };
  }
  if (code && SMTP_COPY[code]) {
    return { code, message: SMTP_COPY[code] };
  }
  if (code && COMMS_COPY[code]) {
    return { code, message: COMMS_COPY[code] };
  }
  if (code && PERMISSION_CODES.has(code)) {
    return {
      code,
      message: `You don’t have permission to ${action} — ask a workspace admin.`,
    };
  }
  if (code === "origin_required") {
    return {
      code,
      message: "We couldn’t start the connection from this page. Please refresh and try again.",
    };
  }

  // GENERIC fallback — an unknown code, or no code at all (a non-2xx with no honest
  // body, a network blip). NEVER the raw framework message (§13/§36).
  return {
    code,
    message: `We couldn’t ${action} just now. Please try again in a moment.`,
  };
}

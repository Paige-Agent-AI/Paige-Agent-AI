// The public intake rules for growth form submissions, kept pure so they can be proven without a
// network (growth-intake.test.ts). growth-public-submit is the only caller: it decides WHO may post
// (origin, bot trap, rate limits) and this module decides WHAT a post may contain — only the form's
// own fields, each shaped the way its field type allows. Nothing here names an account.

export type IntakeField = {
  key: string;
  type?: string;
  label?: string;
  required?: boolean;
  options?: Array<string | { label: string; value: string }>;
  visible_when?: unknown;
};

export type IntakeSchema = { sections?: Array<{ fields?: IntakeField[]; visible_when?: unknown }> } | IntakeField[][] | null;

/** Hosts a public form may be submitted from: the platform's own domain and its business
 *  subdomains (<slug>.paigeagent.ai). HTTPS only. Vercel preview hosts are deliberately not
 *  accepted: *.vercel.app names are registrable by anyone, so no suffix rule can tell ours apart. */
export function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false;
  let url: URL;
  try { url = new URL(origin); } catch { return false; }
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  return host === "paigeagent.ai" || host.endsWith(".paigeagent.ai");
}

/** Every real form sends its (empty) bot-trap field and how long the visitor spent on it. A filled
 *  trap, a missing trap or timing, or a submission faster than a person can type, is a bot — so a
 *  script cannot skip the trap by leaving the fields out. */
export function looksLikeBot(trap: unknown, elapsedMs: unknown): boolean {
  if (typeof trap !== "string" || trap.trim() !== "") return true;
  if (typeof elapsedMs !== "number" || !Number.isFinite(elapsedMs) || elapsedMs < 1500) return true;
  return false;
}

function sectionsOf(schema: IntakeSchema): Array<{ fields: IntakeField[]; visible_when?: unknown }> {
  if (!schema) return [];
  if (Array.isArray(schema)) return schema.map((fields) => ({ fields: Array.isArray(fields) ? fields : [] }));
  const secs = Array.isArray(schema.sections) ? schema.sections : [];
  return secs.map((s) => ({ fields: Array.isArray(s?.fields) ? s.fields : [], visible_when: s?.visible_when }));
}

const optionValue = (o: string | { value: string }) => (typeof o === "string" ? o : o?.value);
const EMAIL = /^[^@\s]{1,64}@[^@\s]+\.[^@\s]{2,}$/;

/** A single, well-formed address (used before an address becomes an email header). */
export function isEmailAddress(v: unknown): v is string {
  return typeof v === "string" && v.length <= 254 && EMAIL.test(v) && !/[\r\n,;<>"]/.test(v);
}
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Shape one answer by its field's type. Returns undefined when the value is not acceptable. */
function shape(field: IntakeField, raw: unknown): unknown {
  const type = field.type ?? "text";
  const opts = Array.isArray(field.options) ? field.options.map(optionValue).filter((v) => typeof v === "string") : [];
  const str = (max: number) => (typeof raw === "string" ? raw.trim().slice(0, max) : undefined);
  switch (type) {
    case "email": {
      const v = str(254);
      return v && EMAIL.test(v) ? v.toLowerCase() : undefined;
    }
    case "tel": {
      const v = str(40);
      return v && /^[+()\-.\s\d]{5,32}(\s*(x|ext\.?|#)\s*\d{1,6})?$/i.test(v) ? v : undefined;
    }
    case "number":
    case "currency": {
      const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
      return Number.isFinite(n) && Math.abs(n) < 1e12 ? n : undefined;
    }
    case "date": {
      const v = str(10);
      return v && DATE.test(v) ? v : undefined;
    }
    case "ssn4": {
      const v = str(4);
      return v && /^\d{4}$/.test(v) ? v : undefined;
    }
    case "select":
    case "radio": {
      return typeof raw === "string" && opts.includes(raw) ? raw : undefined;
    }
    case "checkbox": {
      if (opts.length === 0) return typeof raw === "boolean" ? raw : undefined;
      if (!Array.isArray(raw)) return undefined;
      const picked = raw.filter((v): v is string => typeof v === "string" && opts.includes(v));
      return picked.length === raw.length ? Array.from(new Set(picked)) : undefined;
    }
    case "textarea":
      return str(5000) || undefined;
    default:
      return str(500) || undefined;
  }
}

const answered = (v: unknown) =>
  v !== undefined && v !== null && v !== "" && v !== false && !(Array.isArray(v) && v.length === 0);

export type IntakeResult = {
  answers: Record<string, unknown>;
  /** Keys the visitor sent that the form does not have — dropped, and reported to the caller. */
  unknownKeys: string[];
  /** Keys the form has whose sent value its field type does not allow — dropped and reported. */
  invalidKeys: string[];
  /** Required fields (that always show) left unanswered. */
  missingRequired: string[];
};

/** Keep only the form's own fields, each in the shape its type allows. */
export function sanitizeAnswers(schema: IntakeSchema, raw: unknown): IntakeResult {
  const input = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const answers: Record<string, unknown> = {};
  const invalidKeys: string[] = [];
  const missingRequired: string[] = [];
  const known = new Set<string>();

  for (const section of sectionsOf(schema)) {
    for (const field of section.fields) {
      if (!field?.key) continue;
      known.add(field.key);
      const sent = input[field.key];
      if (sent !== undefined && sent !== null && sent !== "") {
        const v = shape(field, sent);
        if (v === undefined) invalidKeys.push(field.key);
        else answers[field.key] = v;
      }
      // A field (or its section) that shows only on a branch is not required when unseen, and the
      // server cannot know which branch the visitor took — only always-shown fields are enforced.
      const conditional = field.visible_when != null || section.visible_when != null;
      if (field.required && !conditional && !answered(answers[field.key])) missingRequired.push(field.key);
    }
  }

  const unknownKeys = Object.keys(input).filter((k) => !known.has(k));
  return { answers, unknownKeys, invalidKeys, missingRequired };
}

const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "ref", "gclid", "fbclid"];

/** Campaign and click tags only (the same keys the form page reads from its URL), each a short string. */
export function sanitizeUtm(raw: unknown): Record<string, string> {
  const input = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out: Record<string, string> = {};
  for (const k of UTM_KEYS) {
    const v = input[k];
    if (typeof v === "string" && v.trim()) out[k] = v.trim().slice(0, 200);
  }
  return out;
}

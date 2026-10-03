// Turns the questions Paige writes in the Studio chat into a GrowthFormSchema the database accepts
// (growth_form_upsert re-validates; this keeps the model from having to know the storage shape).
// Keys follow the conventions the submission processor reads (email, phone, full_name, company),
// so a form Paige builds makes a real contact without the owner wiring anything. Pure: no I/O.

const TYPES = new Set(["text", "email", "tel", "number", "date", "textarea", "select", "radio", "checkbox"]);
const CHOICE = new Set(["select", "radio", "checkbox"]);

export interface BuiltForm { ok: true; schema: { submit_label: string; sections: Array<{ title: string; description?: string; fields: Array<Record<string, unknown>> }> } }
export interface FormBuildError { ok: false; error: string }

function slugKey(label: string): string {
  const k = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
  return k || "answer";
}

/** The conventional key for a question, so submissions map onto the contact. */
function conventionalKey(label: string, type: string): string | null {
  const l = label.toLowerCase();
  if (type === "email") return "email";
  if (type === "tel") return "phone";
  if (/\b(full name|your name|^name$|name)\b/.test(l) && !/\b(company|business|organi[sz]ation|first|last)\b/.test(l)) return "full_name";
  if (/\bfirst name\b/.test(l)) return "first_name";
  if (/\blast name\b/.test(l)) return "last_name";
  if (/\b(company|business name|organi[sz]ation)\b/.test(l)) return "company";
  return null;
}

// deno-lint-ignore no-explicit-any
export function buildFormSchemaFromQuestions(args: any): BuiltForm | FormBuildError {
  const questions = Array.isArray(args?.questions) ? args.questions : [];
  if (questions.length === 0) return { ok: false, error: "A form needs at least one question." };
  if (questions.length > 40) return { ok: false, error: "That's too many questions for one form (40 at most)." };
  const seen = new Set<string>();
  const fields: Array<Record<string, unknown>> = [];
  let emailMapped = false;
  for (const q of questions) {
    const label = typeof q?.label === "string" ? q.label.trim().slice(0, 200) : "";
    const type = typeof q?.type === "string" ? q.type : "";
    if (!label) return { ok: false, error: "Every question needs a label." };
    if (!TYPES.has(type)) return { ok: false, error: `"${label}" has an answer type the form can't show (${type || "none"}).` };
    const options = Array.isArray(q?.options)
      ? q.options.filter((o: unknown) => typeof o === "string" && o.trim()).map((o: string) => o.trim().slice(0, 120)).slice(0, 30)
      : [];
    if (CHOICE.has(type) && options.length === 0) return { ok: false, error: `"${label}" needs answer choices.` };

    let key = conventionalKey(label, type) ?? slugKey(label);
    let n = 2;
    const base = key;
    while (seen.has(key)) key = `${base}_${n++}`;
    seen.add(key);

    const field: Record<string, unknown> = { key, label, type, required: q?.required === true };
    if (CHOICE.has(type)) field.options = options;
    if (key === "email" && !emailMapped) { field.maps_to = "clients.email"; emailMapped = true; }
    fields.push(field);
  }
  const intro = typeof args?.intro === "string" ? args.intro.trim().slice(0, 400) : "";
  const submit = typeof args?.submit_label === "string" && args.submit_label.trim() ? args.submit_label.trim().slice(0, 40) : "Send";
  return {
    ok: true,
    schema: { submit_label: submit, sections: [{ title: "", ...(intro ? { description: intro } : {}), fields }] },
  };
}

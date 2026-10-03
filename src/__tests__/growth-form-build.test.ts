// @vitest-environment node
// The Studio chat's form tool: Paige writes questions, this turns them into the stored schema.
// Pins that a Paige-built form makes a real contact (conventional keys + the email mapping) and that
// a malformed question is refused with a plain reason instead of saving a broken form.
import { describe, expect, it } from "vitest";
import { buildFormSchemaFromQuestions } from "../../supabase/functions/_shared/growth-form-build.ts";

describe("Paige-built forms", () => {
  it("names the identity questions the way the submission processor reads them", () => {
    const r = buildFormSchemaFromQuestions({
      questions: [
        { label: "Full name", type: "text", required: true },
        { label: "Work email", type: "email", required: true },
        { label: "Phone", type: "tel" },
        { label: "Company", type: "text" },
        { label: "What do you want help with?", type: "radio", options: ["Growth strategy", "Operations"] },
      ],
    });
    if ("error" in r) throw new Error(r.error);
    const keys = r.schema.sections[0].fields.map((f) => f.key);
    expect(keys).toEqual(["full_name", "email", "phone", "company", "what_do_you_want_help_with"]);
    expect(r.schema.sections[0].fields[1].maps_to).toBe("clients.email");
  });

  it("keeps keys unique and carries the intro and button text", () => {
    const r = buildFormSchemaFromQuestions({
      intro: "We come back within one business day.",
      submit_label: "Request a call",
      questions: [{ label: "Notes", type: "textarea" }, { label: "Notes", type: "textarea" }],
    });
    if ("error" in r) throw new Error(r.error);
    expect(r.schema.sections[0].fields.map((f) => f.key)).toEqual(["notes", "notes_2"]);
    expect(r.schema.sections[0].description).toBe("We come back within one business day.");
    expect(r.schema.submit_label).toBe("Request a call");
  });

  it("refuses a choice question with no choices, an unknown type, or no questions", () => {
    expect(buildFormSchemaFromQuestions({ questions: [{ label: "Budget", type: "select" }] })).toEqual({ ok: false, error: '"Budget" needs answer choices.' });
    expect(buildFormSchemaFromQuestions({ questions: [{ label: "SSN", type: "ssn4" }] }).ok).toBe(false);
    expect(buildFormSchemaFromQuestions({ questions: [] }).ok).toBe(false);
  });

  it("does not treat a business name as the person's name", () => {
    const r = buildFormSchemaFromQuestions({ questions: [{ label: "Business name", type: "text" }] });
    if ("error" in r) throw new Error(r.error);
    expect(r.schema.sections[0].fields[0].key).toBe("company");
  });
});

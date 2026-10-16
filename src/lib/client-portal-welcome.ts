import { readClientPortalSelfProfile, type ClientPortalSelfProfile } from "./client-portal-self-profile";
import type { IntakeField } from "./playbook/types";

export type WelcomeAnswer = string | number | null;
export interface ClientWelcomeState {
  status: "ready" | "configuration_required";
  profile: ClientPortalSelfProfile;
  fields: IntakeField[];
  answers: Record<string, WelcomeAnswer>;
  intake_updated_at: string | null;
  intake_submitted_at: string | null;
  expected_token: string | null;
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const timestamp = (v: unknown) => v === null || (typeof v === "string" && Number.isFinite(Date.parse(v)));
const contactKeys = new Set(["full_name","first_name","last_name","name","email","phone"]);
const keys = ["status","profile","fields","answers","intake_updated_at","intake_submitted_at","expected_token"];

/** Strict response validation only. Actual Auth and native relationship own authority. */
export function readClientWelcomeState(value: unknown, actor: string, expected: { id: string; tenant_id: string }): ClientWelcomeState | null {
  if (!object(value) || Object.keys(value).length !== keys.length || Object.keys(value).some(k => !keys.includes(k))) return null;
  const profile = readClientPortalSelfProfile(value.profile,actor,expected.tenant_id);
  if (!profile || profile.id !== expected.id || !["ready","configuration_required"].includes(String(value.status))
    || !Array.isArray(value.fields) || value.fields.length > 50 || !object(value.answers)
    || !timestamp(value.intake_updated_at) || !timestamp(value.intake_submitted_at)) return null;
  const fields: IntakeField[] = [], seen = new Set<string>();
  for (const f of value.fields) {
    if (!object(f) || Object.keys(f).some(k => !["key","label","type","required","options"].includes(k))
      || typeof f.key !== "string" || !/^[a-z0-9][a-z0-9_]{0,63}$/.test(f.key) || seen.has(f.key) || contactKeys.has(f.key)
      || typeof f.label !== "string" || !f.label.trim() || f.label.length > 200 || typeof f.required !== "boolean"
      || typeof f.type !== "string" || !["text","longtext","select","number","date","phone","address"].includes(f.type)) return null;
    if (f.type === "select") {
      if (!Array.isArray(f.options) || !f.options.length || f.options.length > 100
        || f.options.some(o => typeof o !== "string" || !o.trim() || o.length > 200)
        || new Set(f.options).size !== f.options.length) return null;
    } else if ("options" in f) return null;
    seen.add(f.key);
    fields.push({key:f.key,label:f.label,type:f.type as IntakeField["type"],required:f.required,
      ...(f.type === "select" ? {options:[...(f.options as string[])]} : {})});
  }
  const answers: Record<string, WelcomeAnswer> = {};
  for (const [key,v] of Object.entries(value.answers)) {
    if (!seen.has(key) || !(v === null || typeof v === "string" || (typeof v === "number" && Number.isFinite(v)))) return null;
    answers[key] = v as WelcomeAnswer;
  }
  if (value.status === "configuration_required") {
    if (fields.length || Object.keys(answers).length || value.expected_token !== null) return null;
  } else if (typeof value.expected_token !== "string" || !/^[a-f0-9]{32}$/.test(value.expected_token)) return null;
  return {status:value.status as ClientWelcomeState["status"],profile,fields,answers,
    intake_updated_at:value.intake_updated_at as string|null,intake_submitted_at:value.intake_submitted_at as string|null,
    expected_token:value.expected_token as string|null};
}

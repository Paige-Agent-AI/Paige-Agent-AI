/** Presentation of the original stored draft arguments only. No validation,
 * registration, approval, persistence, readiness or execution authority. */
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
function brief(value: unknown, limit: number): string | null {
  if (typeof value !== "string") return null;
  // Bound work before normalizing. A distant value is not pulled into a preview.
  const flat = value.slice(0, 4096)
    // eslint-disable-next-line no-control-regex -- presentation-only control removal
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ")
    .replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g, "")
    .replace(/\s+/g, " ").trim();
  if (!flat) return null;
  // The bounded UTF-16 slice can end between an emoji's two units. Keep the
  // display well formed without scanning or changing the original arguments.
  const points = Array.from(flat, point => {
    const code = point.codePointAt(0)!;
    return code >= 0xd800 && code <= 0xdfff ? "\ufffd" : point;
  });
  return points.slice(0, limit).join("") + (points.length > limit || value.length > 4096 ? "…" : "");
}

export function automationDraftSummary(value: unknown): string {
  const a = object(value) ? value : {};
  const name = brief(a.name, 120);
  const trigger = brief(a.trigger_key, 100);
  const steps = Array.isArray(a.steps) ? a.steps : [];
  const lines = [name ? `Save draft “${name}”.` : "Save an automation draft.",
    trigger === "contact.created" ? "When a new contact is added:" : trigger ? `Configured trigger: ${trigger}.` : "Trigger needs review."];
  // This is the original schema's maximum, not a new workflow engine or limit.
  for (let i = 0; i < Math.min(steps.length, 20); i++) {
    const step = object(steps[i]) ? steps[i] : {};
    const config = object(step.config) ? step.config : {};
    if (step.action_kind === "owner.task" && !step.tool_key) {
      const title = brief(config.title, 160), description = brief(config.description, 240);
      lines.push(`${i + 1}. Prepare an internal task${title ? `: “${title}”` : " (title needs review)"}.${description ? ` Description preview: ${description}` : ""}`);
      if (Object.keys(config).some(key => !["title", "description"].includes(key))) {
        lines.push("Additional task settings are not shown and require review; this does not verify a supported configuration.");
      }
    } else {
      // Never stringify arbitrary configs, recipients, credentials or model context.
      const kind = brief(step.tool_key, 80) ?? brief(step.action_kind, 80);
      lines.push(`${i + 1}. ${kind ? `Configured step: ${kind}.` : "Step needs review."} Configuration and execution support are not verified by this preview.`);
    }
  }
  if (!steps.length) lines.push("No steps are available to review.");
  if (steps.length > 20) lines.push("Additional steps are not shown; review the process before approving.");
  lines.push("Draft only. No task is created or process enabled by saving this draft. Future execution, provider readiness and applicable approvals remain separate.");
  return lines.join("\n");
}

/** Exact pre-processing refusal; never describes a turn whose work may have started. */
export const RECOVERY_READ_ONLY_REFUSAL = {
  code: "INTERACTIVE_RECOVERY_READ_ONLY",
  message: "An earlier response was interrupted, and its outcomes still need checking. Your message was recorded, but new actions and attachments are on hold. You can still ask questions about existing records.",
} as const;

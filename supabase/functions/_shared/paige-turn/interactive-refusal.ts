// One explanation for the native recovery hold: HTTP feedback and its original
// conversation record must agree. This is feedback, never recovery authority.
export const RECOVERY_READ_ONLY_REFUSAL = {
  code: "INTERACTIVE_RECOVERY_READ_ONLY",
  message: "An earlier response was interrupted, and its outcomes still need checking. Your message was recorded, but new actions and attachments are on hold. You can still ask questions about existing records.",
} as const;

type ProviderError = { code?: number | string };

/** Normalize supported destinations without guessing an international country. */
export function normalizeDialNumber(raw: string): string {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/[^\d]/g, "");
  if (trimmed.startsWith("+")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return digits;
}

export function isDialableNumber(value: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(value);
}

export function acquireCallStart(
  lock: { current: boolean },
  hasActiveCall: boolean,
): boolean {
  if (hasActiveCall || lock.current) return false;
  lock.current = true;
  return true;
}

export function isExpiredVoiceSessionError(error: unknown): boolean {
  const code = String((error as ProviderError | null)?.code ?? "");
  return code === "20101" || code === "20104" || code === "31205";
}

/** Drop an expired SDK Device so retry must mint a fresh tenant-scoped token. */
export function discardExpiredVoiceDevice<T extends { destroy: () => void }>(
  error: unknown,
  device: T,
  holder: { current: T | null },
  deferDestroy = false,
): boolean {
  if (!isExpiredVoiceSessionError(error)) return false;
  if (holder.current === device) holder.current = null;
  if (!deferDestroy) {
    try {
      device.destroy();
    } catch {
      // The stale reference is already gone; a failed SDK teardown cannot be reused.
    }
  }
  return true;
}

/** Destroy and clear a Device whose teardown was deferred for an accepted call. */
export function destroyDeferredVoiceDevice<T extends { destroy: () => void }>(
  holder: { current: T | null },
): boolean {
  const device = holder.current;
  if (!device) return false;
  holder.current = null;
  try {
    device.destroy();
  } catch {
    // Clearing first guarantees the expired object cannot be retained or reused.
  }
  return true;
}

/** Safe owner-facing categories; never surface raw provider messages or payloads. */
export function providerCallErrorMessage(error: unknown): string {
  const code = String((error as ProviderError | null)?.code ?? "");
  if (code === "21211" || code === "21217") {
    return "Enter a valid phone number, including the country code.";
  }
  if (isExpiredVoiceSessionError(error)) {
    return "Your calling session expired. Retry the call.";
  }
  if (code === "31005" || code === "31009") {
    return "We could not reach the calling provider. Retry.";
  }
  // The callee's side, not the provider's: Voice SDK SIP errors TemporarilyUnavailable (31480),
  // BusyHere (31486) and Decline (31603). Same wording as the server's call log: Twilio reports a
  // declined call to the status callback as CallStatus=no-answer, logged "No answer.", so 31603
  // says "No answer." too rather than telling the owner a different story than the call log.
  if (code === "31480" || code === "31603") return "No answer.";
  if (code === "31486") return "The line was busy.";
  return "The provider rejected this call. Check the number and retry.";
}

export function voiceHistoryStatus(status: string): {
  label: "Initiated" | "Completed" | "Failed" | "Received";
  state: "pending" | "success" | "error";
} | null {
  if (status === "queued") return { label: "Initiated", state: "pending" };
  if (status === "delivered" || status === "read") return { label: "Completed", state: "success" };
  if (status === "failed") return { label: "Failed", state: "error" };
  if (status === "received") return { label: "Received", state: "success" };
  return null;
}

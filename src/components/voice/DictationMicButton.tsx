/**
 * DictationMicButton — the one shared mic control for every composer (#170).
 *
 * Tap once to record and tap again to stop; pointer release never ends capture.
 * dictated words are handed back via `onText` for the composer to append. It
 * drives the shared `useDictation` hook (§18 one home) so every composer
 * behaves identically.
 *
 * §11: the mic is NEUTRAL/indigo — a mic is not an "act", so gold stays on Send.
 * Motion-safe (every pulse guards `motion-reduce`), token-only, jargon-free.
 */
import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { Mic, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useDictation, type DictationInsertionPoint } from "@/lib/voice/useDictation";
import type { ButtonProps } from "@/components/ui/button";

interface DictationMicButtonProps {
  /** Receives each finalized transcript segment (no leading space). */
  onText: (segment: string, insertionPoint?: DictationInsertionPoint | null) => void;
  /** Surface a plain, jargon-free failure (e.g. via a toast). */
  onError?: (message: string) => void;
  disabled?: boolean;
  size?: ButtonProps["size"];
  variant?: ButtonProps["variant"];
  /** Optional visible label (toolbar style). Icon-only when omitted. */
  label?: string;
  /** Label shown while actively listening (defaults to `label`). */
  activeLabel?: string;
  /** Show ongoing compact state; safety-stop and error reasons are always visible. */
  showStatus?: boolean;
  /** A customer composer can reserve a readable full-width status row. */
  statusLayout?: "inline" | "composer-row";
  /** Authenticated composer context epoch used to invalidate a recording generation. */
  scopeEpoch: string;
  /** True from mic request through provider finalization; lets the composer hold Send. */
  onActiveChange?: (active: boolean) => void;
  /** Owning composer; preserves its caret even when focus crosses toolbar controls. */
  composerRef?: RefObject<HTMLTextAreaElement | HTMLInputElement>;
  className?: string;
}

export function DictationMicButton({
  onText,
  onError,
  disabled,
  size = "icon",
  variant = "ghost",
  label,
  activeLabel,
  showStatus = false,
  statusLayout = "inline",
  scopeEpoch,
  onActiveChange,
  composerRef,
  className,
}: DictationMicButtonProps) {
  const [resultVisible, setResultVisible] = useState(false);
  const resultTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const insertionPointRef = useRef<DictationInsertionPoint | null>(null);
  const handleText = (segment: string) => {
    if (insertionPointRef.current) onText(segment, insertionPointRef.current);
    else onText(segment);
    setResultVisible(true);
    if (resultTimerRef.current) clearTimeout(resultTimerRef.current);
    resultTimerRef.current = setTimeout(() => {
      resultTimerRef.current = null;
      setResultVisible(false);
    }, 2_000);
  };
  const dictation = useDictation({ onText: handleText, onError, scopeEpoch });
  const { status, failure, notice, supported, start, stop, isActive } = dictation;
  const onActiveChangeRef = useRef(onActiveChange);
  onActiveChangeRef.current = onActiveChange;
  const statusId = useId();

  useEffect(() => () => {
    if (resultTimerRef.current) clearTimeout(resultTimerRef.current);
  }, []);

  useEffect(() => {
    onActiveChangeRef.current?.(isActive);
  }, [isActive]);

  useEffect(() => () => {
    onActiveChangeRef.current?.(false);
  }, []);

  useEffect(() => {
    if ((disabled || !supported) && (
      status === "requesting" || status === "connecting" || status === "listening"
    )) {
      stop();
    }
  }, [disabled, status, stop, supported]);

  const rememberInsertionPoint = (fallback: EventTarget | null) => {
    const candidate = composerRef?.current ?? fallback;
    if (!(candidate instanceof HTMLTextAreaElement) && !(candidate instanceof HTMLInputElement)) return;
    insertionPointRef.current = { offset: candidate.selectionStart ?? candidate.value.length };
  };

  const begin = () => {
    if (disabled || !supported || (status !== "idle" && status !== "error")) return;
    if (resultTimerRef.current) clearTimeout(resultTimerRef.current);
    resultTimerRef.current = null;
    setResultVisible(false);
    void start();
  };
  const toggle = () => {
    if (disabled || !supported || status === "transcribing") return;
    if (status === "requesting" || status === "connecting" || status === "listening") {
      stop();
      return;
    }
    begin();
  };

  const unsupported = !supported;
  const isDisabled = disabled || unsupported;
  const activationUnavailable = isDisabled || status === "transcribing";
  const isCapturing = status === "requesting" || status === "connecting" || status === "listening";
  const failed = status === "error";

  const state = unsupported
    ? "unsupported"
    : failure ?? (notice ? "notice" : status === "idle" && resultVisible ? "success" : status);
  const stateLabel = unsupported
    ? "Mic unsupported"
    : failure === "permission-denied"
      ? "Mic permission off"
      : failure === "provider-failure"
        ? "Voice typing failed"
        : failure === "unavailable"
          ? "Voice typing unavailable"
          : notice
            ? notice
            : status === "requesting"
              ? "Requesting mic"
              : status === "connecting"
                ? "Connecting"
                : status === "listening"
                  ? "Listening · tap to stop"
                  : status === "transcribing"
                    ? "Finishing"
                    : resultVisible
                      ? "Added to draft"
                      : "";
  const statusVisible = unsupported || failed || !!notice || (showStatus && (status !== "idle" || resultVisible));

  const title = unsupported
    ? "Voice typing isn't supported in this browser"
    : status === "requesting"
      ? "Requesting microphone access — tap to stop"
      : status === "connecting"
        ? "Connecting voice typing — tap to stop"
        : status === "listening"
          ? "Listening — tap to stop"
          : status === "transcribing"
            ? "Finishing voice typing"
            : failed
              ? dictation.error ?? "Voice typing isn't available right now"
              : "Tap to dictate";

  const accessibleLabel = unsupported
    ? "Voice typing unsupported"
    : failure === "permission-denied"
      ? "Microphone permission off"
      : failure === "provider-failure"
        ? "Voice typing failed — tap to retry"
        : failure === "unavailable"
          ? "Voice typing unavailable — tap to retry"
          : status === "requesting"
            ? "Requesting microphone access — tap to stop"
            : status === "connecting"
              ? "Connecting voice typing — tap to stop"
              : status === "listening"
                ? "Listening — tap to stop"
                : status === "transcribing"
                  ? "Finishing recorded speech"
                  : "Start voice typing";

  const button = (
    <Button
      type="button"
      variant={variant}
      size={size}
      disabled={isDisabled}
      aria-disabled={activationUnavailable}
      aria-label={accessibleLabel}
      aria-describedby={statusVisible ? statusId : undefined}
      aria-pressed={isCapturing}
      title={title}
      className={cn(
        "select-none touch-none",
        // Active = indigo (never gold): a soft filled tint + a motion-safe ring.
        isCapturing &&
          "bg-primary/10 text-primary ring-2 ring-primary/50 animate-pulse motion-reduce:animate-none",
        className,
      )}
      onPointerDown={() => rememberInsertionPoint(document.activeElement)}
      onFocus={(event) => rememberInsertionPoint(event.relatedTarget)}
      onClick={toggle}
    >
      {isCapturing
        ? <Square aria-hidden className={cn(size === "icon" ? "h-3.5 w-3.5 fill-current" : "mr-1.5 h-3.5 w-3.5 fill-current")} />
        : <Mic aria-hidden className={cn(size === "icon" ? "h-4 w-4" : "mr-1.5 h-3.5 w-3.5")} />}
      {label && <span>{isCapturing ? activeLabel ?? label : label}</span>}
    </Button>
  );

  if (!showStatus && !statusVisible) return button;
  const statusMessage = statusVisible ? (
    <span
      id={statusId}
      data-dictation-state={statusLayout === "composer-row" ? state : undefined}
      role={failed || unsupported ? "alert" : "status"}
      aria-live={failed || unsupported ? "assertive" : "polite"}
      className={cn(
        statusLayout === "composer-row"
          ? "order-last basis-full min-w-0 text-sm font-medium leading-normal"
          : "max-w-52 text-[10px] font-medium leading-tight",
        failed || unsupported ? "text-destructive" : "text-muted-foreground",
      )}
    >
      {stateLabel}
    </span>
  ) : null;
  if (statusLayout === "composer-row") return <>{button}{statusMessage}</>;
  return (
    <span className="inline-flex min-w-0 flex-none items-center gap-1.5" data-dictation-state={state}>
      {button}
      {statusMessage}
    </span>
  );
}

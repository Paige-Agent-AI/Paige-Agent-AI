import React from "react";

import { STUDIO_SESSION_ID } from "./studio-reference";
export { STUDIO_SESSION_ID } from "./studio-reference";

/** Opens the existing shell host. An ID is a navigation pointer only; this
 * component cannot create, seed, approve or publish a project. */
export function StudioLaunchButton({ sessionId, children = "Open Studio", className, disabled = false }: {
  sessionId?: string;
  children?: React.ReactNode;
  className?: string;
  disabled?: boolean;
}) {
  const invalid = sessionId !== undefined && !STUDIO_SESSION_ID.test(sessionId);
  return <button type="button" className={className} data-solo-vibe-studio-launcher disabled={disabled || invalid}
    onClick={event => window.dispatchEvent(new CustomEvent("paige-studio", { detail: {
      returnFocus: event.currentTarget, ...(sessionId ? { sessionId } : {}),
    } }))}>{children}</button>;
}

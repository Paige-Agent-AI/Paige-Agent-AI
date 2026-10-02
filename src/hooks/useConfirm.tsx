import * as React from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ConfirmOptions {
  /** Bold, one-line question — what's about to happen. */
  title: string;
  /** The consequence spelled out plainly. Optional. */
  description?: React.ReactNode;
  /** Label on the confirming button. Defaults to "Confirm". */
  actionLabel?: string;
  /** Label on the dismiss button. Defaults to "Cancel". */
  cancelLabel?: string;
  /** When true the action button carries the destructive (red) treatment. */
  destructive?: boolean;
  /** Optional connected control to restore after the dialog finishes closing. */
  returnFocus?: () => HTMLElement | null;
}

interface ConfirmState extends ConfirmOptions {
  open: boolean;
  resolve?: (value: boolean) => void;
}

const CLOSED: ConfirmState = { open: false, title: "" };

/**
 * useConfirm — a reusable, accessible, promise-based confirmation flow built on
 * the shared AlertDialog primitive. Replaces native window.confirm().
 *
 * Usage:
 *   const { confirm, dialog } = useConfirm();
 *   // ...render {dialog} once in the component tree
 *   const ok = await confirm({ title: "Delete this note?", destructive: true });
 *   if (!ok) return;
 *
 * Gold discipline (§11): the confirm button never uses gold. Destructive actions
 * use --destructive; non-destructive confirms use the default button treatment.
 */
export function useConfirm() {
  const [state, setState] = React.useState<ConfirmState>(CLOSED);

  const confirm = React.useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setState({ ...options, open: true, resolve });
    });
  }, []);

  const settle = React.useCallback(
    (value: boolean) => {
      state.resolve?.(value);
      setState((prev) => ({ ...prev, open: false, resolve: undefined }));
    },
    [state],
  );

  const dialog = (
    <AlertDialog
      open={state.open}
      onOpenChange={(next) => {
        // Any dismissal (Esc, overlay, X) resolves as declined.
        if (!next) settle(false);
      }}
    >
      <AlertDialogContent onCloseAutoFocus={(event) => {
        const target = state.returnFocus?.();
        if (target?.isConnected) { event.preventDefault(); target.focus(); }
      }}>
        <AlertDialogHeader>
          <AlertDialogTitle>{state.title}</AlertDialogTitle>
          {state.description ? (
            <AlertDialogDescription>{state.description}</AlertDialogDescription>
          ) : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => settle(false)}>
            {state.cancelLabel ?? "Cancel"}
          </AlertDialogCancel>
          <AlertDialogAction
            className={cn(
              state.destructive &&
                buttonVariants({ variant: "destructive" }),
            )}
            onClick={() => settle(true)}
          >
            {state.actionLabel ?? "Confirm"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { confirm, dialog };
}

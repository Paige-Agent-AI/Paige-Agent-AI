import React, { useEffect, useId, useState } from "react";
import { useTheme } from "next-themes";
import { X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import "./contextual-suggestion.css";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: React.ReactElement;
  title: string;
  description: string;
  children: React.ReactNode;
  /** Page/full-chat consumers use a sheet even on a wide screen. */
  sidePanel?: boolean;
  onCloseAutoFocus?: (event: Event) => void;
};

/** Governed source owners supply the content. This presentation reads or executes nothing. */
export function ContextualSuggestion({ open, onOpenChange, trigger, title, description, children, sidePanel = true, onCloseAutoFocus }: Props) {
  const { resolvedTheme } = useTheme();
  const titleId = useId(), descriptionId = useId();
  const [wide, setWide] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(min-width: 1081px)");
    const update = () => setWide(sidePanel && media.matches);
    update(); media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [sidePanel]);
  const theme = resolvedTheme === "dark" ? "dark" : "light";
  const closeFocus = (event: Event) => {
    // A responsive presentation handoff is not a request to return focus outside it.
    if (open) event.preventDefault(); else onCloseAutoFocus?.(event);
  };
  if (wide) return <Popover open={open} onOpenChange={onOpenChange}>
    <PopoverTrigger asChild>{trigger}</PopoverTrigger>
    <PopoverContent data-pg={theme} className="csu-surface" side="left" align="end" sideOffset={12} collisionPadding={12} role="dialog" aria-labelledby={titleId} aria-describedby={descriptionId} onCloseAutoFocus={closeFocus}>
      <header className="csu-heading"><h2 id={titleId}>{title}</h2><p id={descriptionId}>{description}</p><button type="button" aria-label="Close suggestions" onClick={() => onOpenChange(false)}><X size={16} aria-hidden /></button></header>
      <div className="csu-content">{children}</div>
    </PopoverContent>
  </Popover>;
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogTrigger asChild>{trigger}</DialogTrigger>
    <DialogContent data-pg={theme} className="csu-surface csu-sheet" overlayClassName="csu-scrim" onCloseAutoFocus={closeFocus}>
      <header className="csu-heading"><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></header>
      <div className="csu-content">{children}</div>
    </DialogContent>
  </Dialog>;
}

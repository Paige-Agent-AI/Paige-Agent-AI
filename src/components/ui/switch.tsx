import * as React from "react";
import * as SwitchPrimitives from "@radix-ui/react-switch";

import { cn } from "@/lib/utils";

/**
 * WCAG 1.4.11: an enabled OFF switch must be identifiable at 3:1 against what it sits on. The off state draws
 * its edge and a smaller thumb in --muted-foreground (held at text contrast in both themes); the on state keeps
 * the indigo --primary track with a --background thumb. Never gold: a switch is a setting, not the act (§11).
 * Disabled switches keep opacity-50 (WCAG exempts inactive controls) and always carry a reason at the call site.
 */
const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    className={cn(
      "peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 transition-colors data-[state=checked]:border-transparent data-[state=checked]:bg-primary data-[state=unchecked]:border-muted-foreground data-[state=unchecked]:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
    ref={ref}
  >
    <SwitchPrimitives.Thumb
      className={cn(
        "pointer-events-none block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition-transform data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0 data-[state=unchecked]:scale-[0.7] data-[state=unchecked]:bg-muted-foreground data-[state=unchecked]:shadow-none",
      )}
    />
  </SwitchPrimitives.Root>
));
Switch.displayName = SwitchPrimitives.Root.displayName;

export { Switch };

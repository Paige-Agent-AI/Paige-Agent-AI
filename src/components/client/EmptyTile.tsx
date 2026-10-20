import { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Props = {
  icon?: ReactNode;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
};

/**
 * The action keeps the neighbouring tiles' 36px height (size sm) and reaches the 44px touch target
 * through an invisible extension above and below, so nothing visible moves. It hovers to muted with
 * the label in foreground: the outline button's own --secondary hover is near-black under a dark
 * label in light theme.
 */
export const EMPTY_TILE_ACTION =
  "relative mt-4 after:absolute after:inset-x-0 after:-inset-y-[5px] after:content-[''] hover:bg-muted hover:text-foreground";

/**
 * Consistent empty-state for client-view tiles. Use whenever a tile has no
 * real records yet — never seed sample data. Pair with a single primary CTA
 * that produces the missing data.
 */
export function EmptyTile({ icon, title, description, actionLabel, onAction, className }: Props) {
  return (
    <Card className={cn("border-dashed", className)}>
      <CardContent className="flex flex-col items-center justify-center text-center py-8 px-6">
        {icon ? <div className="mb-3 text-muted-foreground/70">{icon}</div> : null}
        <div className="text-sm font-medium">{title}</div>
        {description ? (
          <p className="text-xs text-muted-foreground mt-1 max-w-sm">{description}</p>
        ) : null}
        {actionLabel && onAction ? (
          <Button size="sm" variant="outline" className={EMPTY_TILE_ACTION} onClick={onAction}>
            {actionLabel}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

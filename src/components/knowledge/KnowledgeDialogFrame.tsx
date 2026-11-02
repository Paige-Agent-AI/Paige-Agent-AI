import type { ReactNode } from 'react';
import { DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

/** One focus trap belongs to the intake dialog; embedded original flows are sections. */
export function KnowledgeDialogFrame({embedded,title,description,children,className,onCloseAutoFocus}: {
  embedded?: boolean; title?: ReactNode; description?: ReactNode; children: ReactNode;
  className?: string; onCloseAutoFocus?: (event: Event) => void;
}) {
  if(embedded)return <section className="min-w-0 space-y-4">
    {title&&<h3 className="font-semibold">{title}</h3>}
    {description&&<p className="text-sm text-muted-foreground">{description}</p>}{children}
  </section>;
  return <DialogContent className={className} onCloseAutoFocus={onCloseAutoFocus}>
    <DialogHeader>{title&&<DialogTitle>{title}</DialogTitle>}{description&&<DialogDescription>{description}</DialogDescription>}</DialogHeader>
    {children}
  </DialogContent>;
}
